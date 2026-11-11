/**
 * Agrégation des statistiques (global / par deck / par dossier / par carte).
 * Toutes les lectures se font en une passe (bulk) — aucune écriture.
 * Les stats sont indexées par cardId ; le rattachement carte → deck → dossier
 * permet les agrégats par dossier (le deck suit son dossier même après déplacement).
 */
import {
  loadAllCards, loadAllDecks, getAllStats, loadAllFiles, loadFolderTree, getAllReviewLog,
} from '../storage/repo.js';
import { dueNowCount } from '../srs/scheduler.js';

export async function collectStats(now = Date.now()) {
  const [cards, decks, statRecs, files, tree] = await Promise.all([
    loadAllCards(), loadAllDecks(), getAllStats(), loadAllFiles(), loadFolderTree(),
  ]);
  const statsByCard = new Map(statRecs.map((s) => [s.cardId, s]));
  const deckOfCard = new Map(cards.map((c) => [c.id, c.deckId]));
  const deckById = new Map(decks.map((d) => [d.id, d]));
  const folderOfDeck = new Map();
  for (const f of files) if (f.kind === 'deck' && f.deckId) folderOfDeck.set(f.deckId, f.folderId);
  const folderById = new Map(tree.folders.map((f) => [f.id, f]));
  // chemin lisible "A / B" pour l'affichage
  const pathOf = (folderId) => {
    const parts = [];
    let cur = folderId == null ? null : folderById.get(folderId);
    let guard = 0;
    while (cur && guard++ < 50) { parts.unshift(cur.name); cur = cur.parentId == null ? null : folderById.get(cur.parentId); }
    return parts.length ? parts.join(' / ') : 'Racine';
  };

  const blank = () => ({ cards: 0, reviews: 0, correct: 0, incorrect: 0, dueNow: 0, due24h: 0, due7d: 0 });
  const global = blank();
  const perDeck = new Map(decks.map((d) => [d.id, blank()]));
  const perFolder = new Map(); // folderId (null = racine) → agrégat

  const add = (agg, card, s) => {
    agg.cards++;
    if (!s) { agg.dueNow++; return; }
    agg.reviews += s.reviews || 0;
    agg.correct += s.correct || 0;
    agg.incorrect += s.incorrect || 0;
    if (!s.dueAt || s.dueAt <= now) agg.dueNow++;
    else if (s.dueAt <= now + 86400000) agg.due24h++;
    else if (s.dueAt <= now + 7 * 86400000) agg.due7d++;
  };
  const addToFolder = (folderId, card, s) => {
    const key = folderId == null ? null : folderId;
    if (!perFolder.has(key)) perFolder.set(key, { ...blank(), path: pathOf(key) });
    add(perFolder.get(key), card, s);
  };

  for (const c of cards) {
    const s = statsByCard.get(c.id) || null;
    add(global, c, s);
    const d = perDeck.get(c.deckId);
    if (d) add(d, c, s);
    addToFolder(folderOfDeck.get(c.deckId) ?? null, c, s);
  }

  // cartes enrichies pour le tableau détaillé (les plus en retard d'abord)
  const cardRows = cards
    .map((c) => {
      const s = statsByCard.get(c.id) || null;
      const deck = deckById.get(c.deckId);
      return {
        card: c,
        deckName: deck ? deck.name : '?',
        deckId: c.deckId,
        stats: s,
        dueAt: s?.dueAt ?? null,
        success: s && s.reviews ? Math.round((s.correct / s.reviews) * 100) : null,
      };
    })
    .sort((a, b) => (a.dueAt ?? -1) - (b.dueAt ?? -1));

  return {
    cards, decks, statsByCard, tree,
    global,
    perDeck: decks.map((d) => ({ deck: d, ...perDeck.get(d.id), path: pathOf(folderOfDeck.get(d.id) ?? null) })),
    perFolder: [...perFolder.values()].sort((a, b) => a.path.localeCompare(b.path, 'fr')),
    cardRows,
    dueTotal: dueNowCount(cards, statsByCard, now),
  };
}

export function rate(correct, total) {
  return total > 0 ? Math.round((correct / total) * 100) : null;
}

// ---------------------------------------------------------------------------
// Tableau de bord graphique — 100 % données réelles (cardStats + reviewLog).
// Aucune valeur inventée : un jour sans révision reste à 0, une métrique sans
// données est signalée comme vide plutôt que simulée.
// ---------------------------------------------------------------------------

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

const pad2 = (n) => String(n).padStart(2, '0');

/** Clé de jour locale YYYY-MM-DD (base du calendrier). */
function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Étiquette courte fr : « 3 nov. » */
function dayLabel(ms) {
  return new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

/**
 * Agrégats pour le dashboard graphique (#/stats).
 * @param {number} days      fenêtre d'analyse temporelle (7 / 30 / 90)
 * @param {string|null} folderId  filtre dossier (descendance incluse) ; null = tout
 */
export async function collectDashboard(days = 30, folderId = null, now = Date.now()) {
  const [cards, decks, statRecs, files, tree, log] = await Promise.all([
    loadAllCards(), loadAllDecks(), getAllStats(), loadAllFiles(), loadFolderTree(), getAllReviewLog(),
  ]);
  const statsByCard = new Map(statRecs.map((s) => [s.cardId, s]));
  const deckById = new Map(decks.map((d) => [d.id, d]));

  // ---- filtre par dossier (descendance complète, comme le déplacement de fichiers)
  const folderById = new Map(tree.folders.map((f) => [f.id, f]));
  const deckFolder = new Map();
  for (const f of files) if (f.kind === 'deck' && f.deckId) deckFolder.set(f.deckId, f.folderId);
  let selectedDecks = null; // null = tout
  if (folderId != null) {
    const kidsOf = new Map();
    for (const f of tree.folders) {
      const arr = kidsOf.get(f.parentId) || [];
      arr.push(f.id); kidsOf.set(f.parentId, arr);
    }
    const scope = new Set([folderId]);
    const stack = [folderId];
    while (stack.length) {
      for (const k of kidsOf.get(stack.pop()) || []) {
        if (!scope.has(k)) { scope.add(k); stack.push(k); }
      }
    }
    selectedDecks = new Set(decks.filter((d) => scope.has(deckFolder.get(d.id))).map((d) => d.id));
  }
  const kept = (deckId) => !selectedDecks || selectedDecks.has(deckId);
  const keptCards = cards.filter((c) => kept(c.deckId));
  const keptCardIds = new Set(keptCards.map((c) => c.id));

  // ---- réussite globale (agrégat exact, identique à collectStats)
  let reviews = 0, correct = 0;
  for (const c of keptCards) {
    const s = statsByCard.get(c.id);
    if (s) { reviews += s.reviews || 0; correct += s.correct || 0; }
  }

  // ---- jour par jour depuis le journal (données réelles uniquement)
  const startDay = now - days * DAY;
  const byDay = new Map(); // key → { count, ok }
  for (const e of log) {
    if (!keptCardIds.has(e.cardId)) continue;
    if (e.at < startDay) continue;
    const k = dayKey(e.at);
    let d = byDay.get(k);
    if (!d) { d = { count: 0, ok: 0 }; byDay.set(k, d); }
    d.count++;
    d.ok += e.ok ? 1 : 0;
  }

  // ---- répartition par TYPE de question (champ `t` du journal ; absent = basic)
  // Les entrées 'repli' (historique antérieur à v2) sont comptées comme basic.
  const typeAgg = new Map();
  for (const e of log) {
    if (!keptCardIds.has(e.cardId)) continue;
    if (e.at < startDay) continue;
    const t = e.t || 'basic';
    let a = typeAgg.get(t);
    if (!a) { a = { count: 0, ok: 0 }; typeAgg.set(t, a); }
    a.count++;
    if (e.ok) a.ok++;
  }
  const typeRows = [...typeAgg.entries()]
    .map(([t, a]) => ({ type: t, count: a.count, ok: a.ok, rate: a.count ? Math.round((a.ok / a.count) * 100) : null }))
    .sort((a, b) => b.count - a.count);

  // série « révisions par jour » : TOUS les jours de la fenêtre (0 = réel zéro)
  const perDay = [];
  for (let i = days - 1; i >= 0; i--) {
    const dayStart = now - i * DAY;
    const d = byDay.get(dayKey(dayStart)) || { count: 0, ok: 0 };
    perDay.push({
      label: days <= 31 ? String(new Date(dayStart).getDate()) : dayLabel(dayStart),
      v: d.count,
      title: `${new Date(dayStart).toLocaleDateString('fr-FR')} : ${d.count} révision(s)`,
    });
  }

  // courbe d'évolution : SEULEMENT les jours avec au moins une révision
  // (aucun point fictif ; l'écart entre points = jours sans activité)
  const trend = [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([k, d]) => ({ label: dayLabel(Date.parse(`${k}T12:00:00`)), v: Math.round((d.ok / d.count) * 100) }));

  // calendrier : 16 semaines complètes alignées lundi → aujourd'hui
  const todayK = dayKey(now);
  const dow = (new Date(now).getDay() + 6) % 7; // lundi = 0
  const calStart = now - dow * DAY - 15 * 7 * DAY;
  const calendar = [];
  for (let i = 0; i < 16 * 7; i++) {
    const ms = calStart + i * DAY;
    const k = dayKey(ms);
    if (k > todayK) { calendar.push({ key: k, count: 0, future: true }); continue; }
    const d = byDay.get(k);
    calendar.push({
      key: k,
      count: d ? d.count : 0,
      title: `${new Date(ms).toLocaleDateString('fr-FR')} : ${d ? d.count : 0} révision(s)`,
    });
  }

  // ---- répartition maîtrise (buckets disjoints : difficile > nouveau > maîtrisé > en cours)
  const mastery = { difficult: 0, new: 0, mastered: 0, learning: 0 };
  for (const c of keptCards) {
    const s = statsByCard.get(c.id);
    if (!s || !s.reviews) { mastery.new++; continue; }
    if (s.reviews >= 3 && s.correct / s.reviews < 0.5) { mastery.difficult++; continue; }
    if ((s.interval || 0) >= 21) { mastery.mastered++; continue; }
    mastery.learning++;
  }

  // ---- prochaines révisions (buckets réels depuis dueAt)
  const upcoming = [
    { label: 'En retard', count: 0, color: '#ff3b5c' },
    { label: "Aujourd'hui", count: 0, color: '#ff2e9a' },
    { label: '≤ 2 j', count: 0, color: '#ffb800' },
    { label: '≤ 7 j', count: 0, color: '#2293f7' },
    { label: '≤ 30 j', count: 0, color: '#4654ee' },
    { label: 'Plus tard', count: 0, color: '#5b2ee0' },
  ];
  for (const c of keptCards) {
    const s = statsByCard.get(c.id);
    if (!s || !s.dueAt) { upcoming[0].count++; continue; }
    const dd = (s.dueAt - now) / DAY;
    if (s.dueAt <= now) upcoming[0].count++;
    else if (dd <= 1) upcoming[1].count++;
    else if (dd <= 2) upcoming[2].count++;
    else if (dd <= 7) upcoming[3].count++;
    else if (dd <= 30) upcoming[4].count++;
    else upcoming[5].count++;
  }

  // ---- chemins lisibles (identique à collectStats)
  const pathOf = (fid) => {
    const parts = [];
    let cur = fid == null ? null : folderById.get(fid);
    let guard = 0;
    while (cur && guard++ < 50) { parts.unshift(cur.name); cur = cur.parentId == null ? null : folderById.get(cur.parentId); }
    return parts.length ? parts.join(' / ') : 'Racine';
  };

  // ---- comparaison par deck (indicateur visuel de difficulté)
  const deckRows = [];
  for (const d of decks) {
    if (!kept(d.id)) continue;
    const dcards = keptCards.filter((c) => c.deckId === d.id);
    let r = 0, ok = 0, dueNow = 0;
    for (const c of dcards) {
      const s = statsByCard.get(c.id);
      if (s) { r += s.reviews || 0; ok += s.correct || 0; }
      if (!s || !s.dueAt || s.dueAt <= now) dueNow++;
    }
    const sr = r > 0 ? Math.round((ok / r) * 100) : null;
    deckRows.push({
      deckId: d.id, name: d.name, path: pathOf(deckFolder.get(d.id) ?? null),
      cards: dcards.length, reviews: r, rate: sr, dueNow,
      status: r === 0 ? 'new' : (sr < 50 ? 'danger' : sr < 70 ? 'warn' : 'ok'),
    });
  }
  deckRows.sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101)); // les plus faibles d'abord

  // ---- comparaison par dossier (agrégat des decks du scope)
  const perFolderMap = new Map();
  for (const row of deckRows) {
    const key = row.path;
    let agg = perFolderMap.get(key);
    if (!agg) { agg = { path: key, cards: 0, reviews: 0, correct: 0, dueNow: 0, decks: 0 }; perFolderMap.set(key, agg); }
    agg.decks++; agg.cards += row.cards; agg.reviews += row.reviews; agg.dueNow += row.dueNow;
    if (row.rate != null) agg.correct += Math.round((row.rate / 100) * row.reviews);
  }
  const folderRows = [...perFolderMap.values()]
    .map((a) => ({ ...a, rate: a.reviews > 0 ? Math.round((a.correct / a.reviews) * 100) : null }))
    .sort((a, b) => b.cards - a.cards);

  // ---- cartes les plus difficiles (≥ 3 révisions, taux croissant)
  const faceText = (face) => {
    for (const b of face || []) {
      if ((b.type === 'text' || b.type === 'latex') && b.value) return b.value;
    }
    return '(image)';
  };
  const difficultCards = keptCards
    .map((c) => {
      const s = statsByCard.get(c.id);
      if (!s || s.reviews < 3) return null;
      return {
        cardId: c.id, deckId: c.deckId,
        deckName: (deckById.get(c.deckId) || {}).name || '?',
        front: faceText(c.front).slice(0, 60),
        rate: Math.round((s.correct / s.reviews) * 100),
        reviews: s.reviews,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.rate - b.rate || b.reviews - a.reviews)
    .slice(0, 10);

  return {
    windowDays: days, folderId,
    totals: { cards: keptCards.length, decks: deckRows.length, reviews, correct },
    successRate: reviews > 0 ? Math.round((correct / reviews) * 100) : null,
    perDay, trend, calendar, todayKey: todayK, mastery, upcoming,
    deckRows, folderRows, difficultCards, typeRows,
    dueNow: dueNowCount(keptCards, statsByCard, now),
  };
}
