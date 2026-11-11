/**
 * Référentiel métier au-dessus d'IndexedDB : dossiers, fichiers, decks, cartes,
 * blobs (médias), statistiques de cartes, réglages.
 *
 * Règles de cohérence :
 * - déplacer un fichier/dossier = changer `folderId` (identité conservée → historique conservé) ;
 * - suppression en cascade = une seule transaction (dossier→fichiers→decks→cartes→stats→blobs) ;
 * - les statistiques sont indexées par `cardId` : jamais d'orphelin (supprimées avec la carte).
 */
import { runTx, reqToPromise, Stores } from './db.js';
import { newId, nowIso } from '../core/ids.js';
import { mapStorageError, RevizError } from '../core/errors.js';

// ------------------------------------------------------------------ Réglages

export async function getSetting(key, fallback = undefined) {
  const s = await runTx([Stores.SETTINGS], 'readonly', (h) => reqToPromise(h[Stores.SETTINGS], 'get', key));
  return s ? s.value : fallback;
}

export async function setSetting(key, value) {
  await runTx([Stores.SETTINGS], 'readwrite', (h) => { h[Stores.SETTINGS].put({ key, value }); });
}

export async function getSettingsBulk(keys, fallbacks = {}) {
  const out = { ...fallbacks };
  await runTx([Stores.SETTINGS], 'readonly', async (h) => {
    for (const k of keys) {
      const rec = await reqToPromise(h[Stores.SETTINGS], 'get', k);
      out[k] = rec ? rec.value : fallbacks[k];
    }
  });
  return out;
}

/** Tous les enregistrements de réglages bruts [{key,value}] (pour la sauvegarde complète). */
export async function loadAllSettings() {
  const out = [];
  await runTx([Stores.SETTINGS], 'readonly', async (h) => {
    await new Promise((resolve, reject) => {
      const req = h[Stores.SETTINGS].openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve();
        out.push(cur.value);
        cur.continue();
      };
      req.onerror = () => reject(mapStorageError(req.error));
    });
  });
  return out;
}

/**
 * Sauvegarde d'un enregistrement de réglage brut ({key,value}) — restauration.
 */
export async function putSettingRecord(rec) {
  await runTx([Stores.SETTINGS], 'readwrite', (h) => { h[Stores.SETTINGS].put(rec); });
}

/**
 * RESTAURATION COMPLÈTE : remplace la TOTALITÉ de la base en une seule
 * transaction (dossiers, fichiers, decks, cartes, blobs, stats, réglages).
 * Tout ou rien : en cas d'erreur, la base reste dans l'état précédent.
 * L'appelant doit avoir validé le snapshot (backup.js) et confirmé auprès de
 * l'utilisateur AVANT l'appel : c'est destructif.
 */
export async function restoreDatabaseSnapshot({ folders = [], files = [], decks = [], cards = [], blobs = [], stats = [], settings = [], reviewLog = [], exams = [] }) {
  await runTx(
    [Stores.FOLDERS, Stores.FILES, Stores.DECKS, Stores.CARDS, Stores.BLOBS, Stores.STATS, Stores.SETTINGS, Stores.LOG, Stores.EXAMS],
    'readwrite',
    async (h) => {
      const specs = [
        [h[Stores.FOLDERS], folders], [h[Stores.FILES], files], [h[Stores.DECKS], decks],
        [h[Stores.CARDS], cards], [h[Stores.BLOBS], blobs], [h[Stores.STATS], stats],
        [h[Stores.SETTINGS], settings], [h[Stores.LOG], reviewLog], [h[Stores.EXAMS], exams],
      ];
      for (const [store, recs] of specs) {
        store.clear();
        for (const r of recs) store.put(r);
      }
    },
  );
}

// ------------------------------------------------------------------ Dossiers

export async function createFolder(name, parentId = null) {
  const folder = { id: newId(), parentId, name: name.trim(), createdAt: nowIso(), updatedAt: nowIso() };
  if (!folder.name) throw new RevizError('Le nom du dossier ne peut pas être vide.');
  await runTx([Stores.FOLDERS], 'readwrite', (h) => { h[Stores.FOLDERS].add(folder); });
  return folder;
}

export async function getFolder(id) {
  return runTx([Stores.FOLDERS], 'readonly', (h) => reqToPromise(h[Stores.FOLDERS], 'get', id));
}

export async function renameFolder(id, name) {
  name = name.trim();
  if (!name) throw new RevizError('Le nom du dossier ne peut pas être vide.');
  await runTx([Stores.FOLDERS], 'readwrite', async (h) => {
    const f = await reqToPromise(h[Stores.FOLDERS], 'get', id);
    if (!f) throw new RevizError('Dossier introuvable.');
    h[Stores.FOLDERS].put({ ...f, name, updatedAt: nowIso() });
  });
}

/** Retourne la liste [racine, ..., dossier], pour le fil d'Ariane. */
export async function getFolderPath(folderId) {
  const chain = [];
  let cursorId = folderId;
  let guard = 0;
  while (cursorId && guard++ < 100) {
    const f = await getFolder(cursorId);
    if (!f) break;
    chain.unshift(f);
    cursorId = f.parentId;
  }
  return chain;
}

/**
 * Détecte si `candidateParentId` est un descendant de `folderId` (ou le même).
 * Utilisé avant un déplacement de dossier pour empêcher un déplacement cyclique.
 */
export async function isDescendant(candidateId, folderId) {
  let cursor = candidateId;
  let guard = 0;
  while (cursor && guard++ < 1000) {
    if (cursor === folderId) return true;
    const f = await getFolder(cursor);
    if (!f) return false;
    cursor = f.parentId;
  }
  return false;
}

export async function listChildFolders(parentId) {
  const out = [];
  await runTx([Stores.FOLDERS], 'readonly', async (h) => {
    await allByIndex(h[Stores.FOLDERS], 'parentId', parentId, out);
  });
  out.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return out;
}

export async function listChildFiles(folderId) {
  const out = [];
  await runTx([Stores.FILES], 'readonly', async (h) => {
    await allByIndex(h[Stores.FILES], 'folderId', folderId, out);
  });
  out.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return out;
}

/** Traversée par index dans le store donné. `key == null` → parcourt tout et filtre sur null. */
export async function allByIndex(store, indexName, key, out) {
  await new Promise((resolve, reject) => {
    let cursorReq;
    if (key == null) {
      // les dossiers racines ont parentId === null : la clé d'index null n'est pas
      // adressable telle quelle → parcours complet filtré côté client.
      cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cur = cursorReq.result;
        if (!cur) return resolve();
        if (cur.value[indexName] == null) out.push(cur.value);
        cur.continue();
      };
    } else {
      cursorReq = store.index(indexName).openCursor(key);
      cursorReq.onsuccess = () => {
        const cur = cursorReq.result;
        if (!cur) return resolve();
        out.push(cur.value);
        cur.continue();
      };
    }
    cursorReq.onerror = () => reject(mapStorageError(cursorReq.error));
  });
}

/** Ensemble {parentId: [folders]} de toute l'arborescence (une seule lecture). */
export async function loadFolderTree() {
  const folders = [];
  await runTx([Stores.FOLDERS], 'readonly', async (h) => {
    await new Promise((resolve, reject) => {
      const req = h[Stores.FOLDERS].openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve();
        folders.push(cur.value);
        cur.continue();
      };
      req.onerror = () => reject(mapStorageError(req.error));
    });
  });
  const byParent = new Map();
  for (const f of folders) {
    const arr = byParent.get(f.parentId) || [];
    arr.push(f);
    byParent.set(f.parentId, arr);
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return { folders, byParent };
}

/**
 * Déplace un dossier (avec autorité anti-cycle). Tout le contenu suit implicitement.
 */
export async function moveFolder(folderId, newParentId) {
  if (newParentId === folderId) throw new RevizError('Un dossier ne peut pas se contenir lui-même.');
  if (newParentId && await isDescendant(newParentId, folderId)) {
    throw new RevizError('Impossible de déplacer un dossier dans un de ses propres sous-dossiers.');
  }
  await runTx([Stores.FOLDERS], 'readwrite', async (h) => {
    const f = await reqToPromise(h[Stores.FOLDERS], 'get', folderId);
    if (!f) throw new RevizError('Dossier introuvable.');
    h[Stores.FOLDERS].put({ ...f, parentId: newParentId, updatedAt: nowIso() });
  });
}

/**
 * Déplace des fichiers vers un dossier. Une seule transaction : tout ou rien.
 */
export async function moveFiles(fileIds, newFolderId) {
  await runTx([Stores.FILES], 'readwrite', async (h) => {
    for (const id of fileIds) {
      const f = await reqToPromise(h[Stores.FILES], 'get', id);
      if (!f) throw new RevizError(`Fichier introuvable : ${id}`);
      h[Stores.FILES].put({ ...f, folderId: newFolderId, updatedAt: nowIso() });
    }
  });
}

/**
 * Supprime un dossier ET tout son contenu (fichiers, decks, cartes, stats, médias).
 * L'appelant doit avoir confirmé auprès de l'utilisateur. Une seule transaction.
 */
export async function deleteFolderCascade(folderId) {
  const { folders } = await loadFolderTree();
  const doomed = collectSubtreeIds(folders, folderId);
  await runTx([Stores.FOLDERS, Stores.FILES, Stores.DECKS, Stores.CARDS, Stores.BLOBS, Stores.STATS], 'readwrite', async (h) => {
    const files = [];
    await new Promise((resolve, reject) => {
      const req = h[Stores.FILES].openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve();
        if (doomed.has(cur.value.folderId)) { files.push(cur.value); cur.delete(); }
        cur.continue();
      };
      req.onerror = () => reject(mapStorageError(req.error));
    });
    for (const f of files) {
      if (f.kind === 'deck' && f.deckId) await deleteDeckData(h[Stores.DECKS], h[Stores.CARDS], h[Stores.STATS], h[Stores.BLOBS], f.deckId, new Set());
      else if (f.blobId) h[Stores.BLOBS].delete(f.blobId);
    }
    for (const id of doomed) h[Stores.FOLDERS].delete(id);
  });
}

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

// ------------------------------------------------------------------ Fichiers

export async function createFile({ kind, name, folderId, deckId = null, blobId = null, mimeType = null, size = null, text = null }) {
  const rec = {
    id: newId(),
    folderId,
    kind,
    name: name.trim() || 'sans nom',
    deckId, blobId, mimeType, size, text,
    createdAt: nowIso(), updatedAt: nowIso(),
  };
  await runTx([Stores.FILES], 'readwrite', (h) => { h[Stores.FILES].add(rec); });
  return rec;
}

export async function getFile(id) {
  return runTx([Stores.FILES], 'readonly', (h) => reqToPromise(h[Stores.FILES], 'get', id));
}

export async function updateFileFields(id, fields) {
  await runTx([Stores.FILES], 'readwrite', async (h) => {
    const f = await reqToPromise(h[Stores.FILES], 'get', id);
    if (!f) throw new RevizError('Fichier introuvable.');
    h[Stores.FILES].put({ ...f, ...fields, updatedAt: nowIso() });
  });
}

/**
 * Supprime des fichiers (une transaction). Pour un deck, cascade deck→cartes→stats
 * puis blobs orphelins uniquement (blobs référencés ailleurs sont conservés).
 */
export async function deleteFiles(fileIds) {
  await runTx([Stores.FILES, Stores.DECKS, Stores.CARDS, Stores.BLOBS, Stores.STATS], 'readwrite', async (h) => {
    const blobIdsUsed = new Set();
    await new Promise((resolve, reject) => {
      const req = h[Stores.CARDS].openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve();
        for (const face of [cur.value.front, cur.value.back]) {
          for (const b of face || []) if (b.blobId) blobIdsUsed.add(b.blobId);
        }
        cur.continue();
      };
      req.onerror = () => reject(mapStorageError(req.error));
    });
    for (const id of fileIds) {
      const f = await reqToPromise(h[Stores.FILES], 'get', id);
      if (!f) continue;
      if (f.kind === 'deck' && f.deckId) {
        await deleteDeckData(h[Stores.DECKS], h[Stores.CARDS], h[Stores.STATS], h[Stores.BLOBS], f.deckId, blobIdsUsed);
      } else if (f.blobId) h[Stores.BLOBS].delete(f.blobId);
      h[Stores.FILES].delete(id);
    }
  });
}

/** Nettoyage des blobs de deck qui ne sont plus référencés par aucune carte. */
async function deleteDeckData(decksStore, cardsStore, statsStore, blobsStore, deckId, otherBlobRefs) {
  const cards = [];
  await new Promise((resolve, reject) => {
    const req = cardsStore.index('deckId').openCursor(deckId);
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return resolve();
      cards.push(cur.value);
      statsStore.delete(cur.value.id); // pas de statistiques orphelines
      cur.delete();
      cur.continue(); // REQUIS : delete() n'avance pas le curseur (hang sinon)
    };
    req.onerror = () => reject(mapStorageError(req.error));
  });
  // Vérification : les blobs du deck sont supprimés seulement s'ils ne sont utilisés
  // par aucune autre carte restante (tous decks confondus).
  const remain = [];
  await new Promise((resolve, reject) => {
    const req = cardsStore.openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return resolve();
      remain.push(cur.value);
      cur.continue();
    };
    req.onerror = () => reject(mapStorageError(req.error));
  });
  const stillUsed = new Set();
  for (const c of remain) {
    for (const face of [c.front, c.back]) for (const b of face || []) if (b.blobId) stillUsed.add(b.blobId);
  }
  const deckBlobIds = new Set();
  for (const c of cards) {
    for (const face of [c.front, c.back]) for (const b of face || []) if (b.blobId) deckBlobIds.add(b.blobId);
  }
  for (const bid of deckBlobIds) {
    if (!stillUsed.has(bid) && !otherBlobRefs.has(bid)) blobsStore.delete(bid);
  }
  decksStore.delete(deckId);
}

// ------------------------------------------------------------------ Decks

export async function createDeck(name, folderId, description = '') {
  const deck = { id: newId(), name: name.trim() || 'Nouveau deck', description: description || '', createdAt: nowIso(), updatedAt: nowIso() };
  const file = await createFile({ kind: 'deck', name: deck.name, folderId, deckId: deck.id });
  await runTx([Stores.DECKS], 'readwrite', (h) => { h[Stores.DECKS].add(deck); });
  return { deck, file };
}

export async function getDeck(id) {
  return runTx([Stores.DECKS], 'readonly', (h) => reqToPromise(h[Stores.DECKS], 'get', id));
}

export async function updateDeck(deckId, fields) {
  await runTx([Stores.DECKS], 'readwrite', async (h) => {
    const d = await reqToPromise(h[Stores.DECKS], 'get', deckId);
    if (!d) throw new RevizError('Deck introuvable.');
    h[Stores.DECKS].put({ ...d, ...fields, updatedAt: nowIso() });
  });
}

export async function deleteDeckFully(deckId) {
  await runTx([Stores.DECKS, Stores.CARDS, Stores.BLOBS, Stores.STATS], 'readwrite', async (h) => {
    const used = new Set();
    await new Promise((resolve, reject) => {
      const req = h[Stores.CARDS].openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve();
        for (const face of [cur.value.front, cur.value.back]) for (const b of face || []) if (b.blobId) used.add(b.blobId);
        cur.continue();
      };
      req.onerror = () => reject(mapStorageError(req.error));
    });
    await deleteDeckData(h[Stores.DECKS], h[Stores.CARDS], h[Stores.STATS], h[Stores.BLOBS], deckId, used);
  });
}

// ------------------------------------------------------------------ Cartes

export async function listCards(deckId) {
  const out = [];
  await runTx([Stores.CARDS], 'readonly', async (h) => {
    await allByIndex(h[Stores.CARDS], 'deckId', deckId, out);
  });
  out.sort((a, b) => a.position - b.position);
  return out;
}

export async function putCard(card) {
  await runTx([Stores.CARDS], 'readwrite', (h) => { h[Stores.CARDS].put(card); });
}

/**
 * Ajoute une carte à la fin d'un deck, avec normalisation des positions.
 * `extra` : champs additionnels (type, data) pour les cartes typées.
 */
export async function addCard(deckId, front, back, extra = {}) {
  const card = {
    id: newId(), deckId, position: -1,
    front: front.map(normalizeBlock), back: back.map(normalizeBlock),
    ...extra,
    createdAt: nowIso(), updatedAt: nowIso(),
  };
  await runTx([Stores.CARDS], 'readwrite', async (h) => {
    const count = await reqToPromise(h[Stores.CARDS].index('deckId'), 'count', deckId);
    card.position = count;
    h[Stores.CARDS].put(card);
  });
  return card;
}

/**
 * Réordonne par échange de position avec un voisin (drag léger des flèches).
 * Une seule transaction : les deux cartes changent ensemble.
 */
export async function swapCardPositions(cardA, dir) {
  const cards = [];
  await runTx([Stores.CARDS], 'readonly', async (h) => {
    await allByIndex(h[Stores.CARDS], 'deckId', cardA.deckId, cards);
  });
  cards.sort((a, b) => a.position - b.position);
  const idx = cards.findIndex((c) => c.id === cardA.id);
  const otherIdx = idx + dir;
  if (otherIdx < 0 || otherIdx >= cards.length) return false;
  await runTx([Stores.CARDS], 'readwrite', async (h) => {
    const a = cards[idx], b = cards[otherIdx];
    h[Stores.CARDS].put({ ...a, position: otherIdx, updatedAt: nowIso() });
    h[Stores.CARDS].put({ ...b, position: idx, updatedAt: nowIso() });
  });
  return true;
}

export async function updateCard(cardId, fields) {
  await runTx([Stores.CARDS], 'readwrite', async (h) => {
    const c = await reqToPromise(h[Stores.CARDS], 'get', cardId);
    if (!c) throw new RevizError('Carte introuvable.');
    h[Stores.CARDS].put({ ...c, ...fields, updatedAt: nowIso() });
  });
}

export async function deleteCard(card) {
  await runTx([Stores.CARDS, Stores.STATS], 'readwrite', (h) => {
    h[Stores.CARDS].delete(card.id);
    h[Stores.STATS].delete(card.id);
  });
}

export function normalizeBlock(b) {
  if (!b || typeof b !== 'object') return b;
  if (b.type === 'text' || b.type === 'latex') return { type: b.type, value: b.value ?? '' };
  if (b.type === 'image' || b.type === 'gif') return { type: b.type, blobId: b.blobId, alt: b.alt || '' };
  return b;
}

/** Fichier (entrée arborescence) correspondant à un deck. */
export async function getFileByDeckId(deckId) {
  const out = [];
  await runTx([Stores.FILES], 'readonly', async (h) => {
    await allByIndex(h[Stores.FILES], 'deckId', deckId, out);
  });
  return out[0] || null;
}

/** Crée seulement l'enregistrement deck (+ son entrée arborescence). */
export async function createDeckRecord(deck, { folderId = null } = {}) {
  await runTx([Stores.DECKS, Stores.FILES], 'readwrite', (h) => {
    h[Stores.DECKS].add(deck);
    if (folderId !== undefined) {
      h[Stores.FILES].put({
        id: newId(), folderId, kind: 'deck', name: deck.name, deckId: deck.id,
        blobId: null, mimeType: null, size: null, text: null,
        createdAt: deck.createdAt || nowIso(), updatedAt: deck.updatedAt || nowIso(),
      });
    }
  });
  return deck;
}

/**
 * Remplace le CONTENU d'un deck en une seule transaction :
 * métadonnées mises à jour, anciennes cartes supprimées, nouvelles cartes écrites.
 * Les statistiques (cardStats) ne sont PAS touchées : si les ids de cartes sont
 * identiques, l'historique de révision est automatiquement conservé.
 * `buildCards()` (async) doit retourner les cartes nouvelles.
 */
export async function runDeckReplace(deckId, deckFields, buildCards) {
  const newCards = await buildCards();
  await runTx([Stores.DECKS, Stores.CARDS], 'readwrite', async (h) => {
    const deck = await reqToPromise(h[Stores.DECKS], 'get', deckId);
    if (!deck) throw new RevizError('Deck introuvable pour le remplacement.');
    h[Stores.DECKS].put({ ...deck, ...deckFields, updatedAt: nowIso() });
    await new Promise((resolve, reject) => {
      const req = h[Stores.CARDS].index('deckId').openCursor(deckId);
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve();
        cur.delete();
        cur.continue();
      };
      req.onerror = () => reject(mapStorageError(req.error));
    });
    for (const c of newCards) h[Stores.CARDS].put(c);
  });
}

// ------------------------------------------------------------------ Blobs

export async function putBlob(bytes, mimeType, nameHint = '') {
  const rec = { id: newId(), bytes, mimeType, size: bytes.size ?? bytes.byteLength, nameHint, createdAt: nowIso() };
  await runTx([Stores.BLOBS], 'readwrite', (h) => { h[Stores.BLOBS].add(rec); });
  return rec;
}

export async function getBlob(id) {
  if (!id) return null;
  return runTx([Stores.BLOBS], 'readonly', (h) => reqToPromise(h[Stores.BLOBS], 'get', id));
}

export async function putBlobRecord(rec) {
  await runTx([Stores.BLOBS], 'readwrite', (h) => { h[Stores.BLOBS].put(rec); });
}

// ------------------------------------------------------------------ Statistiques

export const EMPTY_STATS = Object.freeze({ reviews: 0, correct: 0, incorrect: 0, lastReviewedAt: null });

export async function getAllStats() {
  const out = [];
  await runTx([Stores.STATS], 'readonly', async (h) => {
    await new Promise((resolve, reject) => {
      const req = h[Stores.STATS].openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve();
        out.push(cur.value);
        cur.continue();
      };
      req.onerror = () => reject(mapStorageError(req.error));
    });
  });
  return out;
}

export async function getStatsFor(cardId) {
  return runTx([Stores.STATS], 'readonly', async (h) => {
    const s = await reqToPromise(h[Stores.STATS], 'get', cardId);
    return s || null;
  });
}

/** Écrit/met à jour la ligne de stats d'une carte (clé = cardId). */
export async function putStatsRecord(cardId, stats) {
  await runTx([Stores.STATS], 'readwrite', (h) => {
    h[Stores.STATS].put({ cardId, ...stats });
  });
}

/**
 * Enregistre UNE réponse en une seule transaction atomique :
 * mise à jour des stats de la carte + un événement dans le journal des
 * réponses (base des graphiques d'activité et d'évolution).
 * @param {number} ok 1 (trouvé) ou 0 (pas trouvé)
 * @param {number} at  horodatage ms (généralement Date.now())
 */
export async function recordAnswer(cardId, stats, ok, at = Date.now(), t = undefined) {
  await runTx([Stores.STATS, Stores.LOG], 'readwrite', (h) => {
    // `t` = type de question (qcm, cloze, free, calc, match…). Absent pour
    // les enregistrements antérieurs → traité comme 'basic' à la lecture.
    const entry = { cardId, ok, at };
    if (t) entry.t = t;
    h[Stores.STATS].put({ cardId, ...stats });
    h[Stores.LOG].add(entry);
  });
}

/** Journal complet des réponses (ordre chronologique, ancien → récent). */
export async function getAllReviewLog() {
  const out = [];
  await runTx([Stores.LOG], 'readonly', async (h) => {
    await new Promise((resolve, reject) => {
      const req = h[Stores.LOG].openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve();
        out.push(cur.value);
        cur.continue();
      };
      req.onerror = () => reject(mapStorageError(req.error));
    });
  });
  out.sort((a, b) => a.at - b.at);
  return out;
}

/** BULK : toutes les stats d'une liste de cartes en 1 transaction. */
export async function getStatsBulk(cardIds) {
  const map = new Map();
  await runTx([Stores.STATS], 'readonly', async (h) => {
    for (const id of cardIds) {
      const s = await reqToPromise(h[Stores.STATS], 'get', id);
      map.set(id, s || null);
    }
  });
  return map;
}

// ------------------------------------------------------------------ Examens

/**
 * Les examens sont des enregistrements autonomes : { id, createdAt, config,
 * items:[{cardId, deckId, type, snapshot, given, correct, points}], score,
 * pct, counts, durationMs, timeLimitMs, status }.
 * Aucun impact sur cardStats / reviewLog : les résultats d'examen ne se
 * mélangent jamais aux statistiques de révision.
 */
export async function putExam(exam) {
  await runTx([Stores.EXAMS], 'readwrite', (h) => { h[Stores.EXAMS].put(exam); });
}

export async function getExam(id) {
  return runTx([Stores.EXAMS], 'readonly', (h) => reqToPromise(h[Stores.EXAMS], 'get', id));
}

/** Tous les examens, du plus récent au plus ancien. */
export async function getAllExams() {
  const out = [];
  await runTx([Stores.EXAMS], 'readonly', async (h) => {
    await new Promise((resolve, reject) => {
      const req = h[Stores.EXAMS].openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve();
        out.push(cur.value);
        cur.continue();
      };
      req.onerror = () => reject(mapStorageError(req.error));
    });
  });
  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt, 'fr'));
  return out;
}

export async function deleteExam(id) {
  await runTx([Stores.EXAMS], 'readwrite', (h) => { h[Stores.EXAMS].delete(id); });
}

// ------------------------------------------------------------------ Chargement bulk

export async function loadAllFiles() {
  const out = [];
  await runTx([Stores.FILES], 'readonly', async (h) => {
    await new Promise((resolve, reject) => {
      const req = h[Stores.FILES].openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve();
        out.push(cur.value);
        cur.continue();
      };
      req.onerror = () => reject(mapStorageError(req.error));
    });
  });
  return out;
}

export async function loadAllCards() {
  const out = [];
  await runTx([Stores.CARDS], 'readonly', async (h) => {
    await new Promise((resolve, reject) => {
      const req = h[Stores.CARDS].openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve();
        out.push(cur.value);
        cur.continue();
      };
      req.onerror = () => reject(mapStorageError(req.error));
    });
  });
  return out;
}

export async function loadAllDecks() {
  const out = [];
  await runTx([Stores.DECKS], 'readonly', async (h) => {
    await new Promise((resolve, reject) => {
      const req = h[Stores.DECKS].openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve();
        out.push(cur.value);
        cur.continue();
      };
      req.onerror = () => reject(mapStorageError(req.error));
    });
  });
  return out;
}

/** "@" helper requête par index (réutilisé par les curseurs). */
async function reqToPromiseIdx(store, method, ...args) {
  return reqToPromise(store, method, ...args);
}
void reqToPromiseIdx;
