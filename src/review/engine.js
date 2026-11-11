/**
 * Moteur de session de révision.
 *
 * Responsabilités :
 *  - déterminer les decks concernés par une source (deck unique, dossier avec
 *    DESCENDANCE EXCLUSIVE — jamais les dossiers frères ni parents, racine = tout) ;
 *  - ordonner les cartes (SRS : en retard d'abord, puis nouvelles) et plafonner la session ;
 *  - enregistrer chaque résultat IMMÉDIATEMENT dans cardStats (aucune perte si
 *    l'onglet est fermé en cours de session).
 */
import {
  loadAllFiles, loadFolderTree, loadAllDecks, loadAllCards,
  recordAnswer,
} from '../storage/repo.js';
import { orderForSession, dueNowCount } from '../srs/scheduler.js';
import { DEFAULT_SETTINGS } from '../core/constants.js';

/**
 * Ensemble des dossiers d'une sous-arborescence (la racine incluse).
 */
export function subtreeFolderIds(tree, folderId) {
  const doomed = new Set([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of tree.folders) {
      if (doomed.has(f.id)) continue;
      if (doomed.has(f.parentId)) { doomed.add(f.id); changed = true; }
    }
  }
  return doomed;
}

/**
 * Decks concernés par une source de session.
 * @param {{kind:'all'|'folder'|'deck', folderId?:string|null, deckId?:string}} source
 *   - all    : toute la bibliothèque ;
 *   - folder : decks du dossier ET de toute sa descendance uniquement ;
 *   - deck   : un seul deck.
 * @returns {Promise<{decks:object[], fileByDeck:Map}>}
 */
export async function decksForSource(source) {
  const [tree, files, decks] = await Promise.all([loadFolderTree(), loadAllFiles(), loadAllDecks()]);
  let deckIds;
  if (source.kind === 'deck') {
    deckIds = new Set([source.deckId]);
  } else if (source.kind === 'folder') {
    const sub = subtreeFolderIds(tree, source.folderId);
    deckIds = new Set(files.filter((f) => f.kind === 'deck' && f.deckId && sub.has(f.folderId)).map((f) => f.deckId));
  } else {
    deckIds = new Set(files.filter((f) => f.kind === 'deck' && f.deckId).map((f) => f.deckId));
  }
  const kept = decks.filter((d) => deckIds.has(d.id));
  const fileByDeck = new Map(files.filter((f) => f.kind === 'deck' && f.deckId && deckIds.has(f.deckId)).map((f) => [f.deckId, f]));
  return { decks: kept, fileByDeck };
}

/**
 * Cartes ordonnées d'une session (dues/nouvelles d'abord), plafonnées.
 * @returns {Promise<{cards:object[], statsMap:Map}>}
 */
export async function sessionCards(deckIds, maxCards) {
  const [allCards, allStats] = await Promise.all([loadAllCards(), (await import('../storage/repo.js')).getAllStats()]);
  const set = new Set(deckIds);
  const cards = allCards.filter((c) => set.has(c.deckId));
  const statsMap = new Map(allStats.map((s) => [s.cardId, s]));
  const ordered = orderForSession(cards, statsMap);
  return { cards: ordered.slice(0, maxCards), statsMap };
}

/**
 * Enregistre UN résultat immédiatement (répétition espacée + compteurs + journal).
 * Une seule transaction : stats et journal seront cohérents même en cas d'échec.
 * Retourne les stats mises à jour (pour l'affichage éventuel).
 */
export async function recordCardResult(cardId, correct, now = Date.now(), t = undefined) {
  const { getStatsFor } = await import('../storage/repo.js');
  const prev = await getStatsFor(cardId);
  const { updateStats } = await import('../srs/scheduler.js');
  const { stats } = updateStats(prev, correct, now);
  await recordAnswer(cardId, stats, correct ? 1 : 0, now, t);
  return stats;
}

/** Réglages de session (lecture + défauts). */
export async function sessionSettings() {
  const { getSettingsBulk } = await import('../storage/repo.js');
  return getSettingsBulk(
    ['countdownSeconds', 'maxCardsPerSession', 'associationPairsDesktop', 'associationPairsMobile', 'defaultDirection', 'defaultFreeMode'],
    { ...DEFAULT_SETTINGS },
  );
}

/** Taille de lot d'association selon la largeur d'écran. */
export function batchSizeFor(settings) {
  return window.matchMedia('(max-width: 760px)').matches
    ? settings.associationPairsMobile
    : settings.associationPairsDesktop;
}

/**
 * Arborescence visuelle de la bibliothèque avec compteurs RÉELS, pour choix
 * graphique de la source de session :
 *   { decksAt: Map<deckId, {cards, due}>, nodes: [{type:'all'|'folder'|'deckOffset'|'deck', ...}] }
 * Les carts de dossier incluent TOUTE la descendance (cartes + dues).
 * `deckOffset` = groupe de decks à la racine de la bibliothèque (aucun dossier).
 */
export async function libraryOverview() {
  const [tree, files, decks, cards, stats] = await Promise.all([
    loadFolderTree(), loadAllFiles(), loadAllDecks(), loadAllCards(), (await import('../storage/repo.js')).getAllStats(),
  ]);
  const statsMap = new Map(stats.map((s) => [s.cardId, s]));
  const perDeck = new Map(); // deckId → {cards, due}
  for (const c of cards) {
    let agg = perDeck.get(c.deckId);
    if (!agg) { agg = { cards: 0, due: 0 }; perDeck.set(c.deckId, agg); }
    agg.cards++;
    const s = statsMap.get(c.id);
    if (!s || !s.dueAt || s.dueAt <= Date.now()) agg.due++;
  }
  const deckFolder = new Map();
  for (const f of files) if (f.kind === 'deck' && f.deckId) deckFolder.set(f.deckId, f.folderId);

  // agrégats par dossier (descendance complète)
  const kidsOf = new Map();
  for (const f of tree.folders) {
    const arr = kidsOf.get(f.parentId) || [];
    arr.push(f.id); kidsOf.set(f.parentId, arr);
  }
  const aggFolder = new Map(); // folderId → {decks, cards, due}
  const measure = (folderId) => {
    let agg = aggFolder.get(folderId);
    if (agg) return agg;
    agg = { decks: 0, cards: 0, due: 0 };
    aggFolder.set(folderId, agg); // garde-fou cycles
    for (const dc of kidsOf.get(folderId) || []) {
      const sub = measure(dc);
      agg.decks += sub.decks; agg.cards += sub.cards; agg.due += sub.due;
    }
    for (const d of decks) {
      if (deckFolder.get(d.id) === folderId) {
        agg.decks++;
        const a = perDeck.get(d.id) || { cards: 0, due: 0 };
        agg.cards += a.cards; agg.due += a.due;
      }
    }
    return agg;
  };
  for (const f of tree.folders) measure(f.id);
  measure(null); // agrégat global (descendance complète) — sert de garde-fou

  // groupe « decks hors dossier » : decks RACINE uniquement (sans descendance)
  const rootOnlyAgg = { decks: 0, cards: 0, due: 0 };
  for (const d of decks) {
    if (deckFolder.get(d.id) === null) {
      rootOnlyAgg.decks++;
      const a = perDeck.get(d.id) || { cards: 0, due: 0 };
      rootOnlyAgg.cards += a.cards; rootOnlyAgg.due += a.due;
    }
  }

  const byId = new Map(tree.folders.map((f) => [f.id, f]));
  const nodes = [];
  const pushFolder = (folderId, depth) => {
    const agg = aggFolder.get(folderId);
    if (folderId !== null && agg && agg.decks === 0 && !(kidsOf.get(folderId) || []).length) return; // dossier vide : masqué
    const f = folderId === null ? null : byId.get(folderId);
    nodes.push({ type: 'folder', folderId, depth, name: f ? f.name : 'Dossier', agg });
    for (const dc of kidsOf.get(folderId) || []) pushFolder(dc, depth + 1);
    for (const d of decks) {
      if (deckFolder.get(d.id) === folderId) {
        nodes.push({ type: 'deck', deckId: d.id, depth: depth + 1, name: d.name, agg: perDeck.get(d.id) || { cards: 0, due: 0 } });
      }
    }
  };
  const hasRootDecks = rootOnlyAgg.decks > 0;
  for (const f of tree.folders) if (f.parentId === null) pushFolder(f.id, 0);
  if (hasRootDecks) nodes.push({ type: 'deckOffset', depth: 0, agg: rootOnlyAgg });
  if (hasRootDecks) {
    for (const d of decks) {
      if (deckFolder.get(d.id) === null) {
        nodes.push({ type: 'deck', deckId: d.id, depth: 1, name: d.name, agg: perDeck.get(d.id) || { cards: 0, due: 0 } });
      }
    }
  }
  const totalCards = cards.length;
  const totalDue = dueNowCount(cards, statsMap);
  return { nodes, decks, byId, rootAgg: rootOnlyAgg, totalCards, totalDue, perDeck, hasRootDecks };
}
