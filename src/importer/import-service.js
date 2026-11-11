/**
 * Service d'importation commun.
 *
 * Ne se fie JAMAIS uniquement à l'extension :
 * 1. lecture des octets (+ limites de taille) ;
 * 2. détection du type réel par magic bytes (PDF, PNG/JPEG/GIF, ZIP → .reviz, HTML → simulation) ;
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
} from '../storage/repo.js';
import { runTx, Stores } from '../storage/db.js';
import { nowIso, newId } from '../core/ids.js';
import {
  extractAndValidateReviz, blockToInternal, sniffImageMime,
} from '../format/reviz.js';

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
