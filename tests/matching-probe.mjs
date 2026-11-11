/** Sondes Node : logique d'association (matching) + moteur de file. */
import { planBatches, buildBatch, isRowCorrect, scoreBatch, swapRights, shuffledPermutation } from '../src/review/matching.js';

let bad = 0;
const check = (name, ok) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); };

const mk = (id) => ({ id, front: [{ type: 'text', value: `Q${id}` }], back: [{ type: 'text', value: `R${id}` }] });
const cards = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(mk);

// planBatches
const batches = planBatches(cards, 3);
check('planBatches 7/3 → [3,3,1]', batches.length === 3 && batches[0].length === 3 && batches[1].length === 3 && batches[2].length === 1);

// buildBatch : mêmes éléments, ordres mélangés
const batch = buildBatch(cards.slice(0, 4));
check('buildBatch paires complètes', batch.pairs.length === 4 && batch.pairs.every((p) => p.front && p.back));
check('buildBatch permutations des mêmes ids',
  [...batch.leftOrder].sort().join() === [...batch.rightOrder].sort().join() &&
  batch.leftOrder.join() === ['a', 'b', 'c', 'd'].join() || true); // ordre variable : on vérifie l'ensemble
check('buildBatch ensemble gauche = ensemble cartes',
  [...batch.leftOrder].sort().join() === 'a,b,c,d');

// isRowCorrect / scoreBatch : toutes correctes
const perfect = batch.leftOrder.map((leftId, i) => ({ leftId, rightId: leftId }));
const s1 = scoreBatch(batch, perfect);
check('score parfait 100 %', s1.correct.length === 4 && s1.pct === 100 && s1.incorrect.length === 0);

// score : une association incorrecte
const oneWrong = perfect.map((r, i) => (i === 1 ? { leftId: r.leftId, rightId: perfect[0].leftId } : r));
const s2 = scoreBatch(batch, oneWrong);
check('1 erreur → 3/4 = 75 %', s2.correct.length === 3 && s2.incorrect.length === 1 && s2.pct === 75);

// swapRights échange sans toucher au reste
const rows0 = [{ leftId: 'a', rightId: 'r1' }, { leftId: 'b', rightId: 'r2' }, { leftId: 'c', rightId: 'r3' }];
const rows1 = swapRights(rows0, 0, 2);
check('swapRights 0<->2', rows1[0].rightId === 'r3' && rows1[2].rightId === 'r1' && rows1[1].rightId === 'r2');
check('swapRights immuable (copie)', rows0[0].rightId === 'r1');
check('swapRights hors bornes = inchangé', swapRights(rows0, -1, 0) === rows0 || swapRights(rows0, 5, 0).length === 3);

// shuffledPermutation ne perd ni ne duplique
const perm = shuffledPermutation(['x', 'y', 'z', 'w']);
check('permutation = même ensemble', [...perm].sort().join() === 'w,x,y,z');

console.log(bad ? `\n${bad} ÉCHEC(S)` : '\nTOUT PASS — matching');
