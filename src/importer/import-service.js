/**
 * Service d'importation commun.
 *
 * Ne se fie JAMAIS uniquement à l'extension :
 * 1. lecture des octets (+ limites de taille) ;
 * 2. détection du type réel par magic bytes (PDF, PNG/JPEG/GIF, ZIP → .reviz
 *    ou .revizlib selon le manifeste, HTML → simulation) ;
 * 3. validation spécifique (manifeste .reviz complet, dépendances externes des sims signalées) ;
 * 4. stockage des données + médias ;
 * 5. rattachement au dossier choisi ;
 * 6. messages d'erreur explicites, jamais silencieux.
 *
 * Conflits :
 *  - même NOM dans le dossier → suffixe « (2) » automatique, signalé dans le résumé ;
 *  - même IDENTIFIANT de deck → décision explicite utilisateur (remplacer / importer comme
 *    nouveau / annuler). Le remplacement conserve l'historique de révision des cartes
 *    (identifiants de cartes identiques).
 */
import { LIMITS, FILE_MAGIC } from '../core/constants.js';
import { ValidationError } from '../core/errors.js';
import {
  putBlob, createFile, listChildFiles, getDeck, loadAllCards,
  putCard, updateFileFields, getFileByDeckId, createDeckRecord, runDeckReplace,
  putFolderRecord, putFileRecord,
} from '../storage/repo.js';
import { runTx, Stores } from '../storage/db.js';
import { nowIso, newId } from '../core/ids.js';
import { unzipSync, strFromU8 } from '../../vendor/fflate/fflate.mjs';
import { LIB_FORMAT } from '../core/constants.js';
import {
  extractAndValidateReviz, blockToInternal, sniffImageMime,
} from '../format/reviz.js';
import { extractAndValidateRevizlib } from '../format/revizlib.js';

/** Détecte le vrai type d'un fichier à partir de ses octets. */
export function detectType(bytes) {
  for (const m of FILE_MAGIC) {
    let ok = true;
    for (let i = 0; i < m.bytes.length; i++) {
      if (bytes[i] !== m.bytes[i]) { ok = false; break; }
    }
    if (ok) return m.type;
  }
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 400));
  const trimmed = head.replace(/^\uFEFF/, '').trimStart().toLowerCase();
  if (/^<!doctype\s+html/.test(trimmed) || /^<html[\s>]/.test(trimmed)) return 'html';
  return 'unknown';
}

/** Nom unique dans un dossier : « nom (2).ext ». */
export function uniqueNameFor(existingNames, name) {
  const key = (n) => n.toLowerCase();
  if (!existingNames.has(key(name))) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let n = 2;
  while (existingNames.has(key(`${base} (${n})${ext}`))) n++;
  return `${base} (${n})${ext}`;
}

/**
 * Cherche des dépendances externes (http/https) dans une simulation : signalées à
 * l'utilisateur au moment de l'import et de l'ouverture, jamais chargées silencieusement.
 */
export function findExternalRefs(html) {
  const refs = new Set();
  const attrRe = /<(?:script|img|link|iframe|video|audio|source)[^>]*?\b(?:src|href)\s*=\s*["'](https?:)?\/\/[^"']+["']/gi;
  const cssUrlRe = /url\s*\(\s*["']?(https?:)?\/\/[^)"']+/gi;
  for (const m of html.matchAll(attrRe)) refs.add(m[0]);
  for (const m of html.matchAll(cssUrlRe)) refs.add(m[0]);
  return [...refs];
}

function stripExt(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Identifie le format d'une archive ZIP par son manifeste (sans tout décompresser) :
 * 'revizlib' (export de dossier) ou 'reviz' (deck simple). En cas d'archive
 * illisible, renvoie 'reviz' : l'erreur détaillée sera levée par l'import.
 */
function peekArchiveFormat(bytes) {
  try {
    const parsed = unzipSync(bytes, { filter: (f) => f.name === 'manifest.json' });
    if (!parsed['manifest.json']) return 'reviz';
    const manifest = JSON.parse(strFromU8(parsed['manifest.json']));
    return manifest?.format === LIB_FORMAT ? LIB_FORMAT : 'reviz';
  } catch {
    return 'reviz';
  }
}

/**
 * Importe UN fichier. Retourne un résultat riche pour l'UI (jamais d'exception silencieuse).
 * @returns {Promise<{ok:boolean,name:string,kind?:string,error?:string,
 *   renamed?:boolean,replaced?:boolean,cards?:number,deckId?:string,
 *   externalDeps?:string[],cancelled?:boolean}>}
 */
export async function importSingleFile(file, folderId, opts = {}) {
  try {
    if (file.size > LIMITS.maxFileBytes) {
      return { ok: false, name: file.name, error: `Fichier trop volumineux : ${(file.size / 1048576).toFixed(1)} Mo (limite ${(LIMITS.maxFileBytes / 1048576).toFixed(0)} Mo).` };
    }
    if (file.size === 0) {
      return { ok: false, name: file.name, error: 'Fichier vide : rien à importer.' };
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = detectType(bytes);

    const siblings = await listChildFiles(folderId);
    const existing = new Set(siblings.map((f) => f.name.toLowerCase()));

    switch (type) {
      case 'zip':
        if (peekArchiveFormat(bytes) === LIB_FORMAT) {
          return await importRevizlibFile(bytes, folderId, existing, opts);
        }
        return await importRevizFile(bytes, folderId, existing, opts);
      case 'pdf': {
        const name = uniqueNameFor(existing, /\.pdf$/i.test(file.name) ? file.name : `${stripExt(file.name)}.pdf`);
        const b = await putBlob(bytes, 'application/pdf', name);
        await createFile({ kind: 'pdf', name, folderId, blobId: b.id, mimeType: 'application/pdf', size: bytes.length });
        return { ok: true, name, kind: 'pdf' };
      }
      case 'png':
      case 'jpeg':
      case 'gif': {
        const mime = sniffImageMime(bytes);
        const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[mime];
        const name = uniqueNameFor(existing, `${stripExt(file.name)}.${ext}`);
        const b = await putBlob(bytes, mime, name);
        await createFile({ kind: 'image', name, folderId, blobId: b.id, mimeType: mime, size: bytes.length });
        return { ok: true, name, kind: 'image' };
      }
      case 'html': {
        const name = uniqueNameFor(existing, `${stripExt(file.name)}.html`);
        const b = await putBlob(bytes, 'text/html', name);
        await createFile({ kind: 'sim', name, folderId, blobId: b.id, mimeType: 'text/html', size: bytes.length });
        return { ok: true, name, kind: 'sim', externalDeps: findExternalRefs(new TextDecoder().decode(bytes)) };
      }
      default:
        return { ok: false, name: file.name, error: 'Type de fichier non reconnu. Formats acceptés : .reviz, PDF, PNG, JPEG, GIF, HTML (simulation).' };
    }
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, name: file?.name || '?', error: e.message };
    return { ok: false, name: file?.name || '?', error: `Erreur d'importation : ${e?.message || e}` };
  }
}

/**
 * Importe plusieurs fichiers en séquence (une progression = un fichier importé).
 * @returns {Promise<{results: object[], succeeded: number, failed: number}>}
 */
export async function importManyFiles(files, folderId, opts = {}) {
  const results = [];
  for (const f of files) {
    const r = await importSingleFile(f, folderId, opts);
    results.push(r);
  }
  return {
    results,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
  };
}

// ------------------------------------------------------------------ .reviz

async function importRevizFile(bytes, folderId, existingNames, opts = {}) {
  const chooseAction = opts.onDeckConflict || (async () => 'new');
  const outcome = await extractAndValidateReviz(bytes, {
    chooseAction,
    getDeckById: (deckId) => getDeck(deckId),
  });
  if (!outcome) return { ok: true, name: opts.friendlyName || '?', cancelled: true };

  const { manifest, mediaMap, action } = outcome;
  const baseName = opts.friendlyName || manifest.deck.name || 'Deck importé';
  const cards = [...(manifest.cards || [])].sort((a, b) => (a.position || 0) - (b.position || 0));

  if (action === 'replace') {
    // Le deck existant est remplacé : mêmes ids → l'historique de révision est conservé.
    const deckId = manifest.deck.id;
    await runDeckReplace(deckId, {
      name: baseName,
      description: manifest.deck.description || '',
    }, async () => {
      // blocs construits hors transaction (médias créés séquentiellement)
      const mediaPath2blobId = new Map();
      for (const [path, { bytes: data, mimeType }] of mediaMap) {
        const rec = await putBlob(data, mimeType, path);
        mediaPath2blobId.set(path, rec.id);
      }
      return cards.map((c) => ({
        id: c.id,
        deckId, // REQUIS : la carte est indexée par deckId (bug v1 du chemin replace — corrigé)
        position: c.position || 0,
        front: (c.front || []).map((b) => blockToInternal(b, mediaPath2blobId)),
        back: (c.back || []).map((b) => blockToInternal(b, mediaPath2blobId)),
        // v2 : question typée (passage direct — validé par validateManifest)
        type: c.type || undefined,
        data: c.data || null,
        createdAt: c.createdAt || nowIso(),
        updatedAt: c.updatedAt || nowIso(),
      }));
    });
    // met à jour le nom du fichier correspondant
    const fRec = await getFileByDeckId(deckId);
    if (fRec) await updateFileFields(fRec.id, { name: baseName });
    else await createFile({ kind: 'deck', name: baseName, folderId, deckId });
    await cleanupOrphanBlobs();
    return { ok: true, name: baseName, kind: 'deck', replaced: true, cards: cards.length, deckId };
  }

  // Import comme nouveau deck
  const newDeckId = newId();
  const name = uniqueNameFor(existingNames, baseName);

  const mediaPath2blobId = new Map();
  for (const [path, { bytes: data, mimeType }] of mediaMap) {
    const rec = await putBlob(data, mimeType, path);
    mediaPath2blobId.set(path, rec.id);
  }

  await createDeckRecord({
    id: newDeckId, name, description: manifest.deck.description || '',
    createdAt: nowIso(), updatedAt: nowIso(),
  }, { folderId });

  let idx = 0;
  for (const c of cards) {
    await putCard({
      id: newId(),
      deckId: newDeckId,
      position: idx++,
      front: (c.front || []).map((b) => blockToInternal(b, mediaPath2blobId)),
      back: (c.back || []).map((b) => blockToInternal(b, mediaPath2blobId)),
      type: c.type || undefined,
      data: c.data || null,
      createdAt: c.createdAt || nowIso(),
      updatedAt: c.updatedAt || nowIso(),
    });
  }
  return { ok: true, name, kind: 'deck', cards: idx, deckId: newDeckId };
}

// ------------------------------------------------------------------ .revizlib

/**
 * Importe une archive `.revizlib` (dossier complet) : recrée le sous-arbre de
 * dossiers sous le dossier cible, puis tous ses fichiers (decks, PDF, images,
 * simulations, fiches). Les identifiants de decks/cartes SANS conflit sont
 * conservés ; en cas de conflit, décision explicite :
 *  - « remplacer » : le deck local est écrasé (historique conservé pour les
 *    cartes identiques) — NUN fichier d'arborescence créé pour lui ;
 *  - « comme nouveau » : deck indépendant (ids de deck ET de cartes remappés,
 *    donc aucune donnée locale écrasée) ;
 *  - « annuler » : l'archive est ignorée.
 * Les blobs sont toujours recréés (nouveaux ids, références remappées).
 */
async function importRevizlibFile(bytes, folderId, existingNames, opts = {}) {
  const v = await extractAndValidateRevizlib(bytes);
  const rootName = v.rootFolder.name || 'Dossier importé';

  // Conflits d'identifiants de decks → décision utilisateur
  const conflicts = [];
  for (const d of v.decks) {
    if (await getDeck(d.id)) conflicts.push(d);
  }
  let mode = 'new';
  if (conflicts.length) {
    mode = await (opts.onLibraryConflict || (async () => 'new'))({
      name: rootName, conflicts: conflicts.length, decks: v.decks.length,
    });
    if (mode === 'cancel') return { ok: true, name: rootName, kind: 'lib', cancelled: true };
  }
  const conflictIds = new Set(conflicts.map((c) => c.id));

  // 1. Dossiers : nouveaux ids, racine rattachée au dossier cible.
  const folderIdMap = new Map();
  for (const f of v.folders) folderIdMap.set(f.id, newId());
  for (const f of v.folders) {
    await putFolderRecord({
      id: folderIdMap.get(f.id),
      parentId: f.parentId == null ? folderId : folderIdMap.get(f.parentId),
      name: f.name,
      createdAt: f.createdAt || nowIso(), updatedAt: f.updatedAt || nowIso(),
    });
  }

  // 2. Blobs : recréés avec de nouveaux ids (contenu validé à l'extraction).
  const blobIdMap = new Map();
  for (const b of v.manifest.blobs || []) {
    const rec = await putBlob(v.blobBytes.get(b.id), b.mimeType || 'application/octet-stream', b.nameHint || '');
    blobIdMap.set(b.id, rec.id);
  }

  // 3. Decks : ids conservés si libres ; remappés si conflit importé « comme nouveau ».
  const deckIdMap = new Map();
  for (const d of v.decks) {
    deckIdMap.set(d.id, (conflictIds.has(d.id) && mode === 'new') ? newId() : d.id);
  }

  const remapBlocks = (face) => (face || []).map((b) => (b && b.blobId ? { ...b, blobId: blobIdMap.get(b.blobId) } : b));
  const cardsByDeck = new Map();
  for (const c of v.cards) {
    const arr = cardsByDeck.get(c.deckId) || []; arr.push(c); cardsByDeck.set(c.deckId, arr);
  }
  // Cartes remappées quand leur deck est remappé (aucun id local écrasé).
  const cardIdMap = new Map();
  for (const d of v.decks) {
    if (deckIdMap.get(d.id) !== d.id) {
      for (const c of cardsByDeck.get(d.id) || []) cardIdMap.set(c.id, newId());
    }
  }

  // 4. Decks + cartes.
  const filesByDeck = new Map();
  for (const f of v.files) if (f.kind === 'deck' && f.deckId) filesByDeck.set(f.deckId, f);

  let replacedCount = 0;
  for (const d of v.decks) {
    const targetDeckId = deckIdMap.get(d.id);
    const cards = (cardsByDeck.get(d.id) || []).sort((a, b) => (a.position || 0) - (b.position || 0));
    const buildCards = async () => cards.map((c) => ({
      id: cardIdMap.get(c.id) || c.id,
      deckId: targetDeckId,
      position: c.position || 0,
      front: remapBlocks(c.front),
      back: remapBlocks(c.back),
      type: c.type || undefined,
      data: c.data || null,
      createdAt: c.createdAt || nowIso(),
      updatedAt: c.updatedAt || nowIso(),
    }));
    if (conflictIds.has(d.id) && mode === 'replace') {
      // Mêmes ids → l'historique de révision des cartes identiques est conservé.
      await runDeckReplace(d.id, { name: d.name, description: d.description || '' }, buildCards);
      replacedCount++;
    } else {
      await createDeckRecord({
        id: targetDeckId, name: d.name, description: d.description || '',
        createdAt: d.createdAt || nowIso(), updatedAt: d.updatedAt || nowIso(),
      }, { folderId: folderIdMap.get(filesByDeck.get(d.id)?.folderId) });
      for (const c of await buildCards()) await putCard(c);
    }
  }

  // 5. Entrées d'arborescence. Les decks remplacés gardent leur fichier local.
  const usedNamesByFolder = new Map([[folderId, new Set(existingNames)]]);
  let createdFiles = 0;
  for (const f of v.files) {
    const targetFolder = folderIdMap.get(f.folderId);
    if (f.kind === 'deck' && f.deckId) {
      if (conflictIds.has(f.deckId) && mode === 'replace') continue; // deck existant : fichier local conservé
    }
    if (!usedNamesByFolder.has(targetFolder)) usedNamesByFolder.set(targetFolder, new Set());
    const names = usedNamesByFolder.get(targetFolder);
    const name = uniqueNameFor(names, f.name || 'sans nom');
    names.add(name.toLowerCase());
    await putFileRecord({
      id: newId(),
      folderId: targetFolder,
      kind: f.kind,
      name,
      deckId: f.deckId ? deckIdMap.get(f.deckId) : null,
      blobId: f.blobId ? blobIdMap.get(f.blobId) : null,
      mimeType: f.mimeType || null,
      size: f.size ?? null,
      text: f.text ?? null,
      createdAt: f.createdAt || nowIso(), updatedAt: f.updatedAt || nowIso(),
    });
    createdFiles++;
  }

  return {
    ok: true, name: rootName, kind: 'lib',
    folders: v.folders.length, files: createdFiles,
    decks: v.decks.length, cards: v.cards.length,
    replaced: replacedCount,
  };
}

/** Supprime les blobs qui ne sont plus référencés par aucune carte (après remplacement). */
export async function cleanupOrphanBlobs() {
  const cards = await loadAllCards();
  const used = new Set();
  for (const c of cards) {
    for (const face of [c.front, c.back]) for (const b of face || []) if (b.blobId) used.add(b.blobId);
  }
  const doomed = [];
  await runTx([Stores.BLOBS], 'readonly', async (h) => {
    await new Promise((resolve, reject) => {
      const req = h[Stores.BLOBS].openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve();
        if (!used.has(cur.value.id)) doomed.push(cur.value.id);
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
  });
  if (!doomed.length) return;
  await runTx([Stores.BLOBS], 'readwrite', (h) => {
    for (const id of doomed) h[Stores.BLOBS].delete(id);
  });
}

/** Vérifie et signale les dépendances manquantes d'une simulation à l'ouverture. */
export function simulationWarning(simExternalDeps, fileName) {
  if (!simExternalDeps || !simExternalDeps.length) return null;
  return `${fileName} fait référence à ${simExternalDeps.length} ressource(s) externe(s). Ces requêtes sont bloquées ; la simulation peut ne pas fonctionner totalement.`;
}
