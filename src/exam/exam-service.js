/**
 * Mode examen — service métier (aucune DOM ici).
 *
 * Principes :
 *  - les examens sont COMPLÈTEMENT séparés des statistiques de révision :
 *    ce service n'appelle JAMAIS recordCardResult / recordAnswer (cardStats et
 *    reviewLog ne sont pas touchés) ;
 *  - chaque question posée est enregistrée sous forme d'INSTANTANÉ (copie des
 *    blocs + données) : l'historique reste lisible même si la carte ou le deck
 *    est supprimé plus tard ;
 *  - la correction est automatique pour les types à réponse objective
 *    (qcm, trous, calcul, associations) et AUTOÉVALUÉE pour les réponses
 *    subjectives (flashcard, réponse libre) — aucun jugement prétendument IA ;
 *  - l'état d'un examen en cours est persisté dans sessionStorage pour
 *    survivre à un rechargement de l'onglet.
 */
import { loadAllCards, getAllStats, loadAllDecks, putExam, getExam, getAllExams, deleteExam } from '../storage/repo.js';
import { newId } from '../core/ids.js';

// ------------------------------------------------------------------ Types

/** Types de question exploitables en examen. 'basic' = flashcard classique. */
export const EXAM_TYPES = Object.freeze(['basic', 'qcm', 'cloze', 'free', 'calc', 'match']);
export const EXAM_TYPE_LABEL = Object.freeze({
  basic: 'Flashcard',
  qcm: 'QCM',
  cloze: 'Texte à trous',
  free: 'Réponse libre',
  calc: 'Calcul',
  match: 'Association',
});
/** Types corrigés automatiquement (les autres exigent une autoévaluation). */
export const AUTO_GRADED = new Set(['qcm', 'cloze', 'calc', 'match']);
export const DIFFICULTIES = Object.freeze(['toutes', 'facile', 'moyen', 'difficile']);

export function effectiveType(card) {
  return (card && card.type) || 'basic';
}

// ------------------------------------------------------------------ Vivier

/**
 * Cartes des decks sélectionnés + stats (lecture seule) + noms de decks.
 * @param {Iterable<string>} deckIds
 */
export async function poolForDeckIds(deckIds) {
  const set = new Set(deckIds);
  const [allCards, allStats, allDecks] = await Promise.all([loadAllCards(), getAllStats(), loadAllDecks()]);
  const cards = allCards.filter((c) => set.has(c.deckId));
  const statsMap = new Map(allStats.map((s) => [s.cardId, s]));
  const deckNames = new Map(allDecks.filter((d) => set.has(d.id)).map((d) => [d.id, d.name]));
  return { cards, statsMap, deckNames };
}

/**
 * Catégorisation de difficulté (honnête, dérivée des stats réelles) :
 *   facile    : intervalle SRS ≥ 21 j OU taux de réussite ≥ 80 % ;
 *   difficile : taux < 50 % avec au moins 3 révisions, OU carte jamais révisée
 *               (contenu inconnu = traité comme difficile) ;
 *   moyen     : tout le reste.
 */
export function difficultyOf(card, statsMap) {
  const s = statsMap.get(card.id);
  if (!s || !s.reviews) return 'difficile';
  const rate = (s.correct || 0) / Math.max(1, (s.correct || 0) + (s.incorrect || 0));
  if ((s.interval || 0) >= 21 || rate >= 0.8) return 'facile';
  if (rate < 0.5 && s.reviews >= 3) return 'difficile';
  return 'moyen';
}

/** Comptage réel par type et par difficulté — sert à l'écran de préparation. */
export function poolSummary(cards, statsMap) {
  const byType = {};
  for (const t of EXAM_TYPES) byType[t] = 0;
  const byDiff = { facile: 0, moyen: 0, difficile: 0 };
  for (const c of cards) {
    byType[effectiveType(c)] += 1;
    byDiff[difficultyOf(c, statsMap)] += 1;
  }
  return { byType, byDiff, total: cards.length };
}

/**
 * Sélectionne les questions de l'examen.
 * @param {object[]} cards   vivier
 * @param {Map} statsMap
 * @param {object} config    { deckIds, count, difficulty, types:Set, shuffle }
 */
export function selectQuestions(cards, statsMap, config) {
  const types = config.types instanceof Set ? config.types : new Set(config.types || []);
  let pool = cards.filter((c) => types.has(effectiveType(c)));
  if (config.difficulty && config.difficulty !== 'toutes') {
    pool = pool.filter((c) => difficultyOf(c, statsMap) === config.difficulty);
  }
  if (config.shuffle) pool = shuffle(pool);
  else {
    // ordre stable : par deck puis position de carte
    const orderKey = new Map();
    for (const c of pool) {
      const k = `${c.deckId}:${String(c.position ?? 0).padStart(6, '0')}`;
      orderKey.set(c, k);
    }
    pool = pool.slice().sort((a, b) => orderKey.get(a).localeCompare(orderKey.get(b)));
  }
  return pool.slice(0, Math.max(0, config.count || 0));
}

function shuffle(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ------------------------------------------------------------------ Instantanés

/**
 * Instantané autonome d'une question (JSON-serialisable, sessionStorage-ready).
 * Les blocs front/back sont copiés tels quels ; les blobId restent des
 * références (résolues au moment de l'affichage — voir views/exam.js).
 */
export function snapshotForCard(card, deckName) {
  return {
    cardId: card.id,
    deckId: card.deckId,
    deckName: deckName || '',
    type: effectiveType(card),
    front: JSON.parse(JSON.stringify(card.front || [])),
    back: JSON.parse(JSON.stringify(card.back || [])),
    data: card.data ? JSON.parse(JSON.stringify(card.data)) : null,
  };
}

/** Construit les items d'examen (données, sans réponses). */
export function buildItems(cards, deckNames) {
  return cards.map((card) => ({
    cardId: card.id,
    deckId: card.deckId,
    type: effectiveType(card),
    snapshot: snapshotForCard(card, deckNames.get(card.deckId)),
    given: null,
    answered: false,
    correct: null,
    points: 0,
  }));
}

// ------------------------------------------------------------------ Correction

/** Comparaison de texte souple : casse, accents et espaces ignorés. */
export function normalizeText(s) {
  return String(s ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Évaluateur d'expression arithmétique SANS eval/Function :
 * analyseur à priorité (shunting-yard) — + − × ÷ ^ %, parenthèses,
 * constantes pi/e, fonctions sqrt/abs. Entrée plafonnée. Lève en cas d'entrée
 * non arithmétique (sécurité).
 */
export function evaluateExpression(input) {
  const src = String(input ?? '').trim().replace(/,/g, '.').slice(0, 200);
  if (!src) throw new Error('Expression vide.');
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ') { i++; continue; }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const num = Number(src.slice(i, j));
      if (!Number.isFinite(num)) throw new Error(`Nombre invalide : « ${src.slice(i, j)} »`);
      tokens.push({ t: 'num', v: num });
      i = j;
      continue;
    }
    if (/[a-z]/i.test(ch)) {
      let j = i;
      while (j < src.length && /[a-z]/i.test(src[j])) j++;
      const word = src.slice(i, j).toLowerCase();
      if (word === 'pi') tokens.push({ t: 'num', v: Math.PI });
      else if (word === 'e') tokens.push({ t: 'num', v: Math.E });
      else if (word === 'sqrt' || word === 'abs') tokens.push({ t: 'fn', v: word });
      else throw new Error(`Symbole non autorisé : « ${word} »`);
      i = j;
      continue;
    }
    if ('+-*/^%()'.includes(ch)) { tokens.push({ t: 'op', v: ch }); i++; continue; }
    throw new Error(`Caractère non autorisé : « ${ch} »`);
  }
  // unaire : num/op attendu après +,-,*,/,^,(
  const prec = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '^': 3 };
  const out = [];
  const ops = [];
  let expectOperand = true;
  const apply = (op) => {
    const b = out.pop();
    const a = out.pop();
    if (a === undefined || b === undefined) throw new Error('Expression incomplète.');
    switch (op) {
      case '+': out.push(a + b); break;
      case '-': out.push(a - b); break;
      case '*': out.push(a * b); break;
      case '/': out.push(a / b); break;
      case '%': out.push(a % b); break;
      case '^': out.push(a ** b); break;
      default: throw new Error(`Opérateur inconnu : ${op}`);
    }
  };
  for (const tk of tokens) {
    if (tk.t === 'num') { out.push(tk.v); expectOperand = false; continue; }
    if (tk.t === 'fn') { ops.push(tk); continue; }
    if (tk.v === '(') { ops.push(tk); expectOperand = true; continue; }
    if (tk.v === ')') {
      while (ops.length && ops[ops.length - 1].v !== '(') apply(ops.pop().v);
      if (!ops.length) throw new Error('Parenthèse non équilibrée.');
      ops.pop();
      if (ops.length && ops[ops.length - 1].t === 'fn') {
        const v = out.pop();
        if (v === undefined) throw new Error('Expression incomplète.');
        out.push(ops.pop().v === 'sqrt' ? Math.sqrt(Math.max(0, v)) : Math.abs(v));
      }
      expectOperand = false;
      continue;
    }
    // opérateur binaire
    if (expectOperand && (tk.v === '+' || tk.v === '-')) { out.push(0); expectOperand = false; } // unaire
    while (ops.length && ops[ops.length - 1].v !== '(' && prec[ops[ops.length - 1].v] >= prec[tk.v]) apply(ops.pop().v);
    ops.push(tk);
    expectOperand = true;
  }
  while (ops.length) {
    const op = ops.pop();
    if (op.v === '(') throw new Error('Parenthèse non équilibrée.');
    if (op.t === 'fn') {
      const v = out.pop();
      if (v === undefined) throw new Error('Expression incomplète.');
      out.push(op.v === 'sqrt' ? Math.sqrt(Math.max(0, v)) : Math.abs(v));
    } else apply(op.v);
  }
  const val = out.pop();
  if (out.length || val === undefined || !Number.isFinite(val)) throw new Error('Expression invalide.');
  return val;
}

/** Vrai si la réponse (texte unique) correspond à une des réponses acceptées. */
function textMatchesAny(given, answers) {
  const g = normalizeText(given);
  if (!g) return false;
  return (answers || []).some((a) => {
    const na = normalizeText(a);
    if (!na) return false;
    if (na === g) return true;
    // accepte aussi un nombre écrit différemment (1,5 vs 1.5) si les deux se parsent
    try {
      const fa = evaluateExpression(na);
      const fg = evaluateExpression(g);
      if (Number.isFinite(fa) && Number.isFinite(fg)) return Math.abs(fa - fg) < 1e-9;
    } catch (_) { /* pas arithmétique : comparaison textuelle seulement */ }
    return false;
  });
}

/**
 * Corrige automatiquement un item. Retourne true/false, ou null si le type
 * n'est pas auto-corrigable (basic/free → autoévaluation).
 * @param {object} item  item d'examen (snapshot.data + given)
 */
export function gradeItem(item) {
  const data = item.snapshot?.data || {};
  const given = item.given;
  if (given === null || given === undefined || given === '') return false;
  switch (item.type) {
    case 'qcm': {
      const selected = new Set(Array.isArray(given) ? given : [given]);
      const expected = new Set((data.options || []).map((o, idx) => (o.correct ? idx : -1)).filter((x) => x >= 0));
      if (selected.size !== expected.size) return false;
      for (const s of selected) if (!expected.has(s)) return false;
      return true;
    }
    case 'cloze': {
      const holes = data.holes || [];
      if (!Array.isArray(given) || given.length !== holes.length) return false;
      return holes.every((h, idx) => textMatchesAny(given[idx], h.answers));
    }
    case 'calc': {
      let expected;
      try { expected = evaluateExpression(data.answer); } catch (_) { return null; } // réponse de référence invalide : autoévaluation
      let got;
      try { got = evaluateExpression(given); } catch (_) { return false; }
      const tol = Number(data.tolerance) || 0;
      return Math.abs(got - expected) <= tol;
    }
    case 'match': {
      const pairs = data.pairs || [];
      if (!Array.isArray(given) || given.length !== pairs.length) return false;
      return pairs.every((p, idx) => normalizeText(given[idx]) === normalizeText(p.right));
    }
    default:
      return null; // basic / free → autoévaluation différée
  }
}

// ------------------------------------------------------------------ Clôture

/**
 * Calcule les résultats et PERSISTE l'examen.
 * @param {object} run    état d'exécution (config + items remplis)
 * @param {{status:'completed'|'expired', durationMs:number}} meta
 * @returns {Promise<object>} enregistrement sauvegardé
 */
export async function finalizeExam(run, meta) {
  const answered = run.items.filter((it) => it.answered);
  let earned = 0;
  for (const it of answered) {
    it.points = it.correct === true ? 1 : 0;
    earned += it.points;
  }
  const record = {
    id: newId(),
    createdAt: new Date().toISOString(),
    config: JSON.parse(JSON.stringify(run.config)),
    items: run.items.map((it) => ({
      cardId: it.cardId,
      deckId: it.deckId,
      type: it.type,
      snapshot: it.snapshot,
      given: it.given ?? null,
      answered: !!it.answered,
      correct: it.answered ? !!it.correct : null,
      points: it.points || 0,
    })),
    score: { earned, possible: answered.length },
    pct: answered.length ? Math.round((earned / answered.length) * 100) : null,
    counts: {
      total: run.items.length,
      answered: answered.length,
      correct: run.items.filter((it) => it.answered && it.correct === true).length,
      incorrect: run.items.filter((it) => it.answered && it.correct === false).length,
      skipped: run.items.length - answered.length,
    },
    durationMs: meta.durationMs,
    timeLimitMs: (run.config.durationMin || 0) * 60000,
    status: meta.status,
  };
  await putExam(record);
  return record;
}

/** Note sur 20 (affichage). */
export function gradeOver20(record) {
  if (!record.score.possible) return null;
  return Math.round((record.score.earned / record.score.possible) * 20 * 100) / 100;
}

/** Agrégat de l'historique (pour le panneau statistiques « Examens »). */
export function summarizeExams(exams) {
  const done = exams.filter((e) => e.status === 'completed' || e.status === 'expired');
  const pcts = done.map((e) => e.pct).filter((p) => typeof p === 'number');
  return {
    count: done.length,
    avgPct: pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null,
    bestPct: pcts.length ? Math.max(...pcts) : null,
    lastPct: pcts.length ? pcts[0] : null,
  };
}

export { getExam, getAllExams, deleteExam };
