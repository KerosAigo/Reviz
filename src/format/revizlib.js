/**
 * Format d'export de dossier complet `.revizlib` — lecture / écriture / validation.
 *
 * Un `.revizlib` capture un sous-arbre de dossiers AVEC tout son contenu :
 * decks (cartes + médias typés v2), PDF, images, simulations HTML, fiches.
 * Il NE contient PAS les statistiques de révision, réglages, journal ni examens
 * (pour cela : sauvegarde complète `.revizbak`).
 *
 * Conteneur : archive ZIP (fflate), même famille que `.revizbak` :
 *   manifest.json       format 'revizlib', version, date, compteurs, liste blobs
 *   data/folders.json   dossiers du sous-arbre (racine incluse, parentId null)
 *   data/files.json     entrées d'arborescence du sous-arbre
 *   data/decks.json     métadonnées des decks
 *   data/cards.json     cartes (blocs par blobId)
 *   data/blobs/<id>     contenu binaire de chaque blob
 *
 * Sécurité : mêmes protections que les autres archives (filtrage zip-bomb AVANT
 * décompression, limites, chemins). À l'import, jamais d'écrasement silencieux :
 * conflit d'identifiant de deck → décision explicite de l'utilisateur.
 */
import { unzipSync, zipSync, strToU8, strFromU8 } from '../../vendor/fflate/fflate.mjs';
import { LIB_FORMAT, LIB_FORMAT_VERSION, LIMITS } from '../core/constants.js';
import { ValidationError } from '../core/errors.js';
import { nowIso } from '../core/ids.js';
import { safePath, sniffImageMime } from './reviz.js';
import {
  loadFolderTree, loadAllFiles, loadAllDecks, loadAllCards, getBlob,
} from '../storage/repo.js';

/** Plafonds de cohérence internes (l'archive elle-même est bornée par LIMITS). */
const MAX_FOLDERS = 1000;
const MAX_FILES = 2000;
const MAX_DECKS = 500;
const MAX_TOTAL_CARDS = LIMITS.maxImportedCards * 10;

function collectSubtreeIds(folders, rootId) {
  const kids = new Map();
  for (const f of folders) {
    const arr = kids.get(f.parentId) || []; arr.push(f.id); kids.set(f.parentId, arr);
  }
  const out = new Set();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop();
    if (out.has(id)) continue;
    out.add(id);
    for (const c of kids.get(id) || []) stack.push(c);
  }
  return out;
}

// ------------------------------------------------------------------ Construction

/**
 * Cœur pur de la construction (testable sans IndexedDB) : assemble l'archive
 * à partir d'un instantané du sous-arbre déjà filtré.
 * @param {{folders:object[], files:object[], decks:object[], cards:object[]}} snapshot
 * @param {Function} blobLoader async (blobId) => {bytes, mimeType, nameHint, createdAt}|null
 * @returns {Promise<{bytes:Uint8Array, summary:object}>}
 */
export async function buildLibraryArchive(snapshot, blobLoader) {
  const { folders, files, decks, cards } = snapshot;

  // Blobs référencés (cartes + entrées d'arborescence du sous-arbre).
  const blobIds = new Set();
  for (const c of cards) {
    for (const face of [c.front, c.back]) for (const b of face || []) if (b.blobId) blobIds.add(b.blobId);
  }
  for (const f of files) if (f.blobId) blobIds.add(f.blobId);

  const blobRecords = [];
  const entries = {};
  let missing = [];
  for (const id of blobIds) {
    const rec = await blobLoader(id);
    if (!rec) { missing.push(id); continue; }
    const u8 = rec.bytes instanceof Uint8Array ? rec.bytes : new Uint8Array(rec.bytes?.buffer ?? rec.bytes);
    blobRecords.push({ id, mimeType: rec.mimeType, size: u8.length, nameHint: rec.nameHint || '' });
    entries[`data/blobs/${id}`] = u8;
  }
  if (missing.length) {
    throw new ValidationError(`Export impossible, des médias sont absents de la base : ${missing.map((i) => String(i).slice(0, 8)).join(', ')}.`);
  }

  const manifest = {
    format: LIB_FORMAT,
    formatVersion: LIB_FORMAT_VERSION,
    createdAt: nowIso(),
    counts: {
      folders: folders.length, files: files.length,
      decks: decks.length, cards: cards.length, blobs: blobRecords.length,
    },
    blobs: blobRecords,
  };

  entries['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  entries['data/folders.json'] = strToU8(JSON.stringify(folders));
  entries['data/files.json'] = strToU8(JSON.stringify(files));
  entries['data/decks.json'] = strToU8(JSON.stringify(decks));
  entries['data/cards.json'] = strToU8(JSON.stringify(cards));

  const bytes = zipSync(entries, { mtime: new Date(), level: 6 });
  return { bytes, summary: manifest.counts };
}

/**
 * Exporte un dossier ET tout son contenu (récursif) en archive `.revizlib`.
 * @param {string} folderId
 * @returns {Promise<{bytes:Uint8Array, summary:object}>}
 */
export async function buildFolderArchive(folderId) {
  const [tree, allFiles, allDecks, allCards] = await Promise.all([
    loadFolderTree(), loadAllFiles(), loadAllDecks(), loadAllCards(),
  ]);
  const subtree = collectSubtreeIds(tree.folders, folderId);
  if (!subtree.has(folderId)) throw new ValidationError('Dossier introuvable.');
  const folders = tree.folders.filter((f) => subtree.has(f.id));
  // Racine de l'archive : le dossier exporté a toujours parentId null dans l'archive
  // (l'appareil cible choisira son emplacement à l'import).
  const files = allFiles.filter((f) => subtree.has(f.folderId));
  const deckIds = new Set(files.filter((f) => f.kind === 'deck' && f.deckId).map((f) => f.deckId));
  const decks = allDecks.filter((d) => deckIds.has(d.id));
  const cards = allCards.filter((c) => deckIds.has(c.deckId));
  return buildLibraryArchive(
    { folders, files, decks, cards },
    async (id) => {
      const rec = await getBlob(id);
      if (!rec) return null;
      const bytes = rec.bytes instanceof Uint8Array ? rec.bytes
        : rec.bytes instanceof Blob ? new Uint8Array(await rec.bytes.arrayBuffer())
          : new Uint8Array(rec.bytes?.buffer ?? rec.bytes);
      return { bytes, mimeType: rec.mimeType, nameHint: rec.nameHint };
    },
  );
}

// ------------------------------------------------------------------ Extraction & validation

/** Lit une archive non fiable avec les protections partagées (zip-bomb, chemins). */
function openArchive(bytes) {
  try {
    let uncompressedTotal = 0;
    let entries = 0;
    return unzipSync(bytes, {
      filter: (file) => {
        entries += 1;
        if (entries > LIMITS.maxArchiveEntries) throw new ValidationError('Archive suspecte : trop d\u2019entrées.');
        if (!file.originalSize) return true;
        uncompressedTotal += file.originalSize;
        if (uncompressedTotal > LIMITS.maxArchiveUncompressed) throw new ValidationError('Archive suspecte : contenu décompressé trop volumineux (possible archive-piège).');
        if (file.originalSize > LIMITS.maxFileBytes) throw new ValidationError(`Fichier trop volumineux dans l'archive : ${file.name}`);
        if (!safePath(file.name)) throw new ValidationError(`Chemin non autorisé dans l'archive : ${file.name}`);
        return true;
      },
    });
  } catch (e) {
    throw new ValidationError(e instanceof ValidationError ? e.message : 'Archive illisible ou corrompue (pas un fichier .revizlib valide ?).', e);
  }
}

function readJson(archive, name) {
  const rec = archive[name];
  if (!rec) return null;
  try {
    return JSON.parse(strFromU8(rec));
  } catch (e) {
    throw new ValidationError(`${name} n'est pas du JSON valide.`, e);
  }
}

/**
 * Valide une archive `.revizlib` et retourne son contenu prêt pour l'import.
 * @param {Uint8Array} bytes
 * @returns {Promise<{manifest, folders, files, decks, cards, blobBytes, rootFolder}>}
 */
export async function extractAndValidateRevizlib(bytes) {
  if (bytes.length > LIMITS.maxFileBytes) {
    throw new ValidationError(`Archive trop volumineuse (${(bytes.length / 1048576).toFixed(1)} Mo, limite ${(LIMITS.maxFileBytes / 1048576).toFixed(0)} Mo).`);
  }
  const archive = openArchive(bytes);
  const manifest = readJson(archive, 'manifest.json');
  if (!manifest || typeof manifest !== 'object') throw new ValidationError('Fichier .revizlib incomplet : manifest.json absent.');
  if (manifest.format !== LIB_FORMAT) {
    throw new ValidationError(`Ce n'est pas un export de dossier Reviz (format « ${manifest.format ?? '?'} » au lieu de « ${LIB_FORMAT} »).`);
  }
  if (typeof manifest.formatVersion !== 'number' || manifest.formatVersion <= 0 || manifest.formatVersion > LIB_FORMAT_VERSION) {
    throw new ValidationError(`Version de format non prise en charge (${manifest.formatVersion ?? '?'}). Le fichier vient d'une version plus récente de l'application.`);
  }

  const data = {};
  for (const name of ['folders', 'files', 'decks', 'cards']) {
    const parsed = readJson(archive, `data/${name}.json`);
    if (!Array.isArray(parsed)) throw new ValidationError(`Fichier .revizlib incomplet : data/${name}.json absent ou illisible.`);
    data[name] = parsed;
  }
  const { folders, files, decks, cards } = data;
  if (folders.length > MAX_FOLDERS || files.length > MAX_FILES || decks.length > MAX_DECKS || cards.length > MAX_TOTAL_CARDS) {
    throw new ValidationError('Archive suspecte : trop d\u2019éléments dans le manifeste.');
  }

  // --- arborescence de dossiers : ids uniques, un seul parent null (racine), pas de cycle
  const folderIds = new Set();
  for (const f of folders) {
    if (!f || !f.id || typeof f.name !== 'string') throw new ValidationError('Dossier invalide dans l\u2019archive.');
    if (folderIds.has(f.id)) throw new ValidationError(`Identifiant de dossier en doublon : ${f.id}`);
    folderIds.add(f.id);
  }
  let roots = 0;
  for (const f of folders) {
    if (f.parentId == null) roots++;
    else if (!folderIds.has(f.parentId)) throw new ValidationError(`Dossier « ${f.name} » : parent inconnu dans l'archive.`);
  }
  if (roots !== 1) throw new ValidationError('L\u2019archive doit contenir exactement une racine de dossier.');
  const root = folders.find((f) => f.parentId == null);
  for (const f of folders) { // remontée bornée : chaque chaîne doit finir sur la racine
    let cur = f;
    let guard = 0;
    while (cur.parentId != null && guard++ <= folders.length) cur = folders.find((x) => x.id === cur.parentId);
    if (guard > folders.length) throw new ValidationError('Arborescence cyclique dans l\u2019archive.');
  }

  // --- fichiers : dossier connu, kind connu, deck reference cohérente
  const deckIds = new Set();
  for (const d of decks) {
    if (!d || !d.id || typeof d.name !== 'string') throw new ValidationError('Deck invalide dans l\u2019archive.');
    if (deckIds.has(d.id)) throw new ValidationError(`Identifiant de deck en doublon : ${d.id}`);
    deckIds.add(d.id);
  }
  const seenDeckFile = new Set();
  for (const f of files) {
    if (!f || !f.id) throw new ValidationError('Fichier invalide dans l\u2019archive.');
    if (!folderIds.has(f.folderId)) throw new ValidationError(`Fichier « ${f.name || f.id} » : dossier inconnu dans l'archive.`);
    if (f.kind === 'deck') {
      if (!f.deckId || !deckIds.has(f.deckId)) throw new ValidationError(`Fichier « ${f.name} » : deck introuvable dans l'archive.`);
      if (seenDeckFile.has(f.deckId)) throw new ValidationError(`Deux fichiers pointent vers le même deck : ${f.deckId}`);
      seenDeckFile.add(f.deckId);
    } else if (f.kind !== 'pdf' && f.kind !== 'image' && f.kind !== 'sim' && f.kind !== 'fiche') {
      throw new ValidationError(`Type de fichier inconnu dans l'archive : ${f.kind}`);
    }
  }
  // Chaque deck doit avoir son entrée d'arborescence (sinon import orphelin).
  for (const d of decks) {
    if (!seenDeckFile.has(d.id)) throw new ValidationError(`Deck « ${d.name} » sans fichier d'arborescence dans l'archive.`);
  }

  // --- cartes : deck connu, ids uniques, faces valides, plafond par deck
  const cardIds = new Set();
  const cardsPerDeck = new Map();
  for (const c of cards) {
    if (!c || !c.id) throw new ValidationError('Carte invalide dans l\u2019archive.');
    if (cardIds.has(c.id)) throw new ValidationError(`Identifiant de carte en doublon : ${c.id}`);
    cardIds.add(c.id);
    if (!c.deckId || !deckIds.has(c.deckId)) throw new ValidationError(`Carte ${String(c.id).slice(0, 8)} : deck inconnu dans l'archive.`);
    if (typeof c.position !== 'number') throw new ValidationError(`Carte ${String(c.id).slice(0, 8)} : position manquante.`);
    cardsPerDeck.set(c.deckId, (cardsPerDeck.get(c.deckId) || 0) + 1);
    for (const faceName of ['front', 'back']) {
      if (!Array.isArray(c[faceName])) throw new ValidationError(`Carte ${String(c.id).slice(0, 8)} : ${faceName === 'front' ? 'recto' : 'verso'} absent.`);
    }
  }
  for (const [deckId, n] of cardsPerDeck) {
    if (n > LIMITS.maxImportedCards) {
      const d = decks.find((x) => x.id === deckId);
      throw new ValidationError(`Deck « ${d?.name ?? deckId} » : trop de cartes (${n} > ${LIMITS.maxImportedCards}).`);
    }
  }

  // --- blobs déclarés : binaire présent ; images vérifiées par magic bytes
  const blobBytes = new Map();
  for (const b of manifest.blobs || []) {
    if (!b || !b.id) throw new ValidationError('Média invalide dans le manifeste.');
    const rec = archive[`data/blobs/${b.id}`];
    if (!rec) throw new ValidationError(`Média manquant dans l'archive : ${String(b.id).slice(0, 8)}…`);
    if (b.mimeType && b.mimeType.startsWith('image/')) {
      const real = sniffImageMime(rec);
      if (!real) throw new ValidationError(`Média illisible (type inconnu) : ${String(b.id).slice(0, 8)}…`);
      if (real !== b.mimeType) throw new ValidationError(`Type de média incohérent : ${String(b.id).slice(0, 8)}… (déclaré ${b.mimeType}, réel ${real}).`);
    }
    blobBytes.set(b.id, rec);
  }
  // blobIds référencés sans déclaration : erreur explicite
  const declared = new Set(blobBytes.keys());
  for (const c of cards) {
    for (const face of [c.front, c.back]) for (const b of face || []) {
      if (b.blobId && !declared.has(b.blobId)) throw new ValidationError(`Carte ${String(c.id).slice(0, 8)} : média non déclaré dans l'archive.`);
    }
  }
  for (const f of files) {
    if (f.blobId && !declared.has(f.blobId)) throw new ValidationError(`Fichier « ${f.name} » : média non déclaré dans l'archive.`);
  }

  return {
    manifest, folders, files, decks, cards, blobBytes,
    rootFolder: root,
    summary: { ...manifest.counts, createdAt: manifest.createdAt },
  };
}

/** Résumé court pour l'UI (confirmation / résumé d'import). */
export function libSummary(v) {
  return `1 dossier, ${v.folders.length - 1} sous-dossier(s), ${v.decks.length} deck(s), ${v.cards.length} carte(s), ${v.files.length} fichier(s)`;
}
