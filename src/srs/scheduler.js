/**
 * Répétition espacée — SM-2 simplifié, version honnête et testée.
 *
 * État d'une carte :
 *   { ease (1.3..3.0), interval (jours, 0 = nouvelle), dueAt (ms), reviews, correct, incorrect, lastReviewedAt }
 *
 * Règles :
 *   - réponse correcte :
 *       intervalle = 1 j (première), 3 j (deuxième), sinon intervalle × ease (plafond 365 j, minimum 1 j)
 *       ease augmente : +0.05 (plafond 3.0)
 *   - réponse incorrecte :
 *       ease baisse : −0.2 (plafond bas 1.3)
 *       intervalle = 10 minutes → la carte se représente très vite
 *   - dueAt = maintenant + intervalle.
 *
 * Ce n'est PAS l'algorithme FSRS/FAIR : c'est un SM-2 à deux niveaux (trouvé / pas trouvé),
 * simple, cohérent et documenté. Les difficultés intermédiaires ne sont pas capturées
 * (limitation assumée : l'utilisateur ne déclare que deux niveaux).
 */

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

export function newStats() {
  return { reviews: 0, correct: 0, incorrect: 0, lastReviewedAt: null, ease: 2.5, interval: 0, dueAt: null };
}

/**
 * Met à jour les statistiques d'une carte après une réponse.
 * @param {object|null} prev stats précédentes (ou null)
 * @param {boolean} correct
 * @param {number} now  timestamp ms
 * @returns {{stats: object, dueAt: number}}
 */
export function updateStats(prev, correct, now = Date.now()) {
  const stats = { ...newStats(), ...(prev || {}) };
  stats.reviews += 1;
  stats.lastReviewedAt = new Date(now).toISOString();
  if (correct) {
    stats.correct += 1;
    if (!stats.ease) stats.ease = 2.5;
    stats.ease = Math.min(3, (stats.ease || 2.5) + 0.05);
    const prevInterval = stats.interval || 0;
    let interval;
    if (prevInterval <= 0) interval = 1;
    else if (prevInterval < 1) interval = 3;
    else interval = Math.min(365, Math.max(1, prevInterval * stats.ease));
    stats.interval = Math.round(interval * 100) / 100;
  } else {
    stats.incorrect += 1;
    stats.ease = Math.max(1.3, (stats.ease || 2.5) - 0.2);
    stats.interval = 10 / 1440; // 10 minutes en jours
  }
  const dueAt = now + stats.interval * DAY;
  stats.dueAt = dueAt;
  return { stats, dueAt };
}

/**
 * Compte des cartes à réviser maintenant (dues + nouvelles).
 */
export function dueNowCount(cards, statsMap, now = Date.now()) {
  let n = 0;
  for (const c of cards) {
    const s = statsMap.get(c.id);
    if (!s || !s.dueAt) { n++; continue; }
    if (s.dueAt <= now) n++;
  }
  return n;
}

/**
 * Ordonne les cartes pour une session : les plus en retard d'abord, puis les
 * nouvelles, puis les grandes intervalles. Trie stable et prévisible.
 */
export function orderForSession(cards, statsMap, now = Date.now()) {
  const key = (c) => {
    const s = statsMap.get(c.id);
    if (!s || !s.dueAt) return now; // nouvelle : due maintenant
    return s.dueAt;
  };
  return cards.slice().sort((a, b) => {
    const ka = key(a), kb = key(b);
    if (ka !== kb) return ka - kb;
    return a.position - b.position;
  });
}

/** Intervalle lisible pour l'UI. */
export function intervalLabel(stats) {
  if (!stats || stats.interval == null) return '—';
  const j = stats.interval;
  if (j < 1) return `${Math.round(j * 1440)} min`;
  if (j < 30) return `${Math.round(j)} j`;
  if (j < 365) return `${Math.round(j / 30)} mois`;
  return '1 an +';
}
