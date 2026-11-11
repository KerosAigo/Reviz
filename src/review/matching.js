/**
 * Logique d'association — fonctions PURES (testables hors navigateur).
 *
 * Une série (batch) contient N paires. Deux colonnes :
 *   - colonne gauche : les faces "question" (recto) dans un ordre mélangé ;
 *   - colonne droite : les faces "réponse" (verso) dans un ordre mélangé indépendant.
 * L'utilisateur forme N lignes ; une ligne = un élément gauche + un élément droit.
 *
 * rows : [{leftId, rightId}] — index = numéro de ligne.
 */

export function shuffledPermutation(ids) {
  const a = ids.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  // éviter l'identité parfaite (toutes les paires déjà correctes) quand N ≥ 2
  if (a.length >= 2 && a.every((id, i) => id === ids[i])) {
    [a[0], a[1]] = [a[1], a[0]];
  }
  return a;
}

/** Découpe une liste ordonnée de cartes en lots de `size`. */
export function planBatches(cards, size) {
  const out = [];
  for (let i = 0; i < cards.length; i += size) out.push(cards.slice(i, i + size));
  return out;
}

/**
 * Construit une série mélangée à partir de cartes.
 * @param {object[]} cards cartes (front/back = blocs)
 * @returns {{pairs:object[], leftOrder:string[], rightOrder:string[]}}
 *   pairs[i] : {cardId, front, back} ; leftOrder/rightOrder : permutations d'ids.
 */
export function buildBatch(cards) {
  const pairs = cards.map((c) => ({ cardId: c.id, front: c.front, back: c.back }));
  const ids = pairs.map((p) => p.cardId);
  const leftOrder = shuffledPermutation(ids);
  let rightOrder = shuffledPermutation(ids);
  // les deux colonnes ne doivent pas coïncider (série déjà résolue à l'écran)
  if (rightOrder.length >= 2 && rightOrder.join() === leftOrder.join()) {
    [rightOrder[0], rightOrder[1]] = [rightOrder[1], rightOrder[0]];
  }
  return { pairs, leftOrder, rightOrder };
}

/** La ligne (leftId, rightId) est-elle une paire correcte ? */
export function isRowCorrect(batch, leftId, rightId) {
  const p = batch.pairs.find((x) => x.cardId === leftId);
  return !!p && p.cardId === rightId;
}

/**
 * Score d'une série validée.
 * @returns {{correct:string[], incorrect:string[], pct:number|null, attempts:number}}
 */
export function scoreBatch(batch, rows) {
  const correct = [];
  const incorrect = [];
  for (const row of rows) {
    if (isRowCorrect(batch, row.leftId, row.rightId)) correct.push(row.leftId);
    else incorrect.push(row.leftId);
  }
  const attempts = correct.length + incorrect.length;
  return { correct, incorrect, pct: attempts ? Math.round((correct.length / attempts) * 100) : null, attempts };
}

/** Échange les éléments droits de deux lignes (utilisé par swap/tap). */
export function swapRights(rows, i, j) {
  if (i === j || i < 0 || j < 0 || i >= rows.length || j >= rows.length) return rows;
  const out = rows.slice();
  const tmp = { rightId: out[i].rightId };
  out[i] = { ...out[i], rightId: out[j].rightId };
  out[j] = { ...out[j], rightId: tmp.rightId };
  return out;
}
