/**
 * Accès bas niveau IndexedDB.
 *
 * Conventions :
 * - une opération = un enregistrement ; une opération multi-enregistrements = une transaction unique
 *   (voir repo.js) pour que l'arborescence ne puisse pas rester dans un état incohérent ;
 * - toutes les fonctions retournent des Promises et convertissent les erreurs en messages clairs.
 */
import { DB_NAME, DB_VERSION } from '../core/constants.js';
import { mapStorageError } from '../core/errors.js';

let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const tx = req.transaction; // transaction de montée de version
      if (!db.objectStoreNames.contains('folders')) {
        const s = db.createObjectStore('folders', { keyPath: 'id' });
        s.createIndex('parentId', 'parentId');
      }
      if (!db.objectStoreNames.contains('files')) {
        const s = db.createObjectStore('files', { keyPath: 'id' });
        s.createIndex('folderId', 'folderId');
        s.createIndex('kind', 'kind');
        s.createIndex('deckId', 'deckId');
      }
      if (!db.objectStoreNames.contains('decks')) {
        db.createObjectStore('decks', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('cards')) {
        const s = db.createObjectStore('cards', { keyPath: 'id' });
        s.createIndex('deckId', 'deckId');
      }
      if (!db.objectStoreNames.contains('blobs')) {
        db.createObjectStore('blobs', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('cardStats')) {
        db.createObjectStore('cardStats', { keyPath: 'cardId' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      // v2 : journal des réponses (un événement réel par réponse) — base des
      // graphiques d'activité/évolution. Repli honnête : pour les cartes
      // révisées AVANT cette version, un seul événement est dérivé des
      // données réelles connues (jour de lastReviewedAt, agrégat correct vs
      // incorrect), marqué kind:'repli' ; rien n'est inventé.
      if (!db.objectStoreNames.contains('reviewLog')) {
        db.createObjectStore('reviewLog', { keyPath: 'seq', autoIncrement: true });
        // (dans la transaction de montée : erreur de lecture → la montée
        // échoue toute seule, aucun gestionnaire custom nécessaire)
        const statsStore = tx.objectStore('cardStats');
        const logStore = tx.objectStore('reviewLog');
        const seedReq = statsStore.openCursor();
        seedReq.onsuccess = () => {
          const cur = seedReq.result;
          if (!cur) return;
          const s = cur.value;
          if (s && s.lastReviewedAt) {
            const at = Date.parse(s.lastReviewedAt);
            if (Number.isFinite(at)) {
              logStore.add({ cardId: s.cardId, ok: (s.correct || 0) >= (s.incorrect || 0) ? 1 : 0, at, kind: 'repli' });
            }
          }
          cur.continue();
        };
      }
      // v3 : historique des examens. Chaque examen est autonome (il contient
      // des instantanés des questions posées), donc aucune clé étrangère ni
      // index vers decks/cards : supprimer un deck ne détruit pas l'historique.
      if (!db.objectStoreNames.contains('exams')) {
        db.createObjectStore('exams', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(mapStorageError(req.error));
    req.onblocked = () => reject(new Error('Un autre onglet bloque la mise à jour de la base. Fermez les autres onglets de Reviz.'));
  });
  return dbPromise;
}

/**
 * Exécute `fn(tx)` dans une transaction sur `stores` (noms) en mode `mode`.
 * `fn` reçoit un objet { [storeName]: store } et peut y faire put/get/delete/cursor.
 * La promesse est résolue une fois la transaction COMPLÈTEMENT écrite (durabilité).
 */
export async function runTx(stores, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const handles = {};
    for (const name of stores) handles[name] = tx.objectStore(name);
    let fnError = null;
    let result;
    try {
      result = fn(handles);
    } catch (e) {
      fnError = mapStorageError(e);
      try { tx.abort(); } catch (_) { /* déjà annulée */ }
    }
    tx.oncomplete = () => (fnError ? reject(fnError) : resolve(result));
    tx.onerror = () => reject(mapStorageError(tx.error));
    tx.onabort = () => reject(mapStorageError(tx.error || new Error('Transaction annulée')));
  });
}

/** Wrappers pratiques du niveau bas. */
export function reqToPromise(store, method, ...args) {
  return new Promise((resolve, reject) => {
    const req = store[method](...args);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(mapStorageError(req.error));
  });
}

export const Stores = Object.freeze({
  FOLDERS: 'folders',
  FILES: 'files',
  DECKS: 'decks',
  CARDS: 'cards',
  BLOBS: 'blobs',
  STATS: 'cardStats',
  SETTINGS: 'settings',
  LOG: 'reviewLog',
  EXAMS: 'exams',
});
