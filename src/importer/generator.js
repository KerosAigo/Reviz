/**
 * Génération DÉTERMINISTE de propositions de révisions à partir d'un texte
 * relu/corrigé par l'utilisateur (étape 2 de l'assistant d'import).
 *
 * HONNÊTETÉ (exigence du projet) :
 *  - ce sont des RÈGLES LOCALES explicables (motifs « X : Y », « X désigne Y »,
 *    chiffres/formules, énumérations), PAS une IA et PAS un résumé sémantique ;
 *  - chaque proposition porte sa TRACE (la phrase source) affichée dans l'UI ;
 *  - tout est éditable et désactivable AVANT enregistrement ;
 *  - aucune proposition n'est créée quand aucun motif fiable n'est trouvé.
 *
 * Déterminisme : le tirage des distracteurs/limites est piloté par un PRNG
 * semé sur le texte lui-même — même texte → mêmes propositions.
 */

// ------------------------------------------------------------------ PRNG déterministe

function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ découpe du texte

/** Découpe en phrases (ponctuation finale ; évite de couper les abréviations courtes).
 *  Les SAUTS DE LIGNE sont conservés comme séparateurs : un titre de PDF ne doit
 *  pas se coller à la phrase suivante (les lignes restent des unités). */
function splitSentences(text) {
  const units = [];
  for (const rawLine of String(text).split(/\n+/)) {
    const line = rawLine.replace(/\s{2,}/g, ' ').trim();
    if (!line) continue;
    const parts = line.split(/(?<=[.!?;])\s+(?=[«"'(\dA-ZÀ-ÿ])/u);
    for (const p of parts) { const s = p.trim(); if (s.length >= 12) units.push(s); }
  }
  return units;
}

/** Découpe en lignes structurées (titres / entrées de définition). */
function splitLines(text) {
  return text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
}

const PRONOUN_START = /^(il|elle|on|ce|cela|cet|cette|ces|ils|elles|nous|vous|je|tu|dont|qui|que|lequel|laquelle)\b/i;
const WEAK = /par exemple|notamment|c'est-à-dire|cf\.|etc\./i;

// ------------------------------------------------------------------ détection « terme : définition »

/**
 * Motifs de définition, par ordre de fiabilité :
 *  1) « Terme : définition… »            (ligne courte + deux-points)
 *  2) « X est / désigne / signifie … »
 *  3) « X, c'est … » / « on appelle X … »
 * Retourne { term, def, pattern } ou null. Term/def nettoyés.
 */
function matchDefinition(sentence) {
  const s = sentence.trim();
  // 1) deux-points : Terme (≤ 80 car., pas de point final) : reste
  let m = s.match(/^([«"']?[\wÀ-ÿ][^:.;!?]{2,79}[»"']?)\s*:\s*(.{20,})$/u);
  if (m && !PRONOUN_START.test(m[1])) {
    return { term: m[1].replace(/[«"']$/u, '').trim(), def: cleanDef(m[2]), pattern: 'deux-points' };
  }
  // 2) verbes définissoires (français + anglais courant)
  m = s.match(/^(.{3,80}?)\s+(?:est|sont|désigne|désignent|signifie|signifient|correspond à|correspondent à|means|denotes|designates|designate|refers to|is defined as|are defined as)\s+(.{15,})$/i);
  if (m && !PRONOUN_START.test(m[1]) && !WEAK.test(m[1])) {
    const term = m[1].replace(/^(?:le|la|les|un|une|des|l)\s+/i, '').replace(/\s*\(.+\)\s*$/, '').trim();
    if (term.length >= 3 && term.split(/\s+/).length <= 6) {
      return { term, def: cleanDef(m[2]), pattern: 'verbe' };
    }
  }
  // 3) « on appelle X … » / « we call X … » / « X, c'est … »
  m = s.match(/^(?:on\s+|we\s+)?(?:appelle|appelons|call)\s+(.{3,60}?)\s+(?:le\s+|la\s+|l'\s*|un\s+|une\s+|des\s+|the\s+|a\s+|an\s+|any\s+)?(.{15,})$/i);
  if (m) return { term: m[1].trim(), def: cleanDef(m[2]), pattern: 'appelle' };
  m = s.match(/^(.{3,60}?)\s*,\s*c'est\s+(.{15,})$/i);
  if (m && !PRONOUN_START.test(m[1])) return { term: m[1].trim(), def: cleanDef(m[2]), pattern: "c'est" };
  return null;
}

function cleanDef(d) {
  return String(d).replace(/\s*\.$/, '').replace(/\s{2,}/g, ' ').trim();
}

// ------------------------------------------------------------------ génération

export const KIND_META = {
  flash: { label: 'Flashcards', icon: 'cards' },
  qcm: { label: 'QCM', icon: 'check' },
  cloze: { label: 'Textes à trous', icon: 'edit' },
  free: { label: 'Réponses libres', icon: 'note' },
  calc: { label: 'Calculs', icon: 'target' },
  match: { label: 'Associations', icon: 'swap' },
  synth: { label: 'Synthèse', icon: 'list' },
};

const CAPS = { flash: 24, qcm: 10, cloze: 15, free: 8, calc: 10, match: 3 };

/**
 * Génère les propositions à partir du texte relu.
 * @param {string} text  texte corrigé par l'utilisateur
 * @returns {{items: Array<{kind, id, front, back, data, why, pattern}>}}
 */
export function generateProposals(text) {
  const items = [];
  if (!text || !text.trim()) return { items };
  const rand = mulberry32(hashString(text));
  const sentences = splitSentences(text);
  const lines = splitLines(text);

  // ---- 1) définitions (base de flashcards / QCM / libres / associations)
  const defs = [];
  const defSeen = new Set();
  for (const s of sentences) {
    const d = matchDefinition(s);
    if (!d) continue;
    d._src = s;
    const key = d.term.toLowerCase();
    if (defSeen.has(key) || d.def.length < 15 || d.def.length > 320) continue;
    defSeen.add(key);
    defs.push(d);
  }
  // lignes « Terme : … » courtes souvent plus fiables que les phrases
  for (const l of lines) {
    if (l.length > 220 || !l.includes(':')) continue;
    const d = matchDefinition(l);
    if (!d) continue;
    d._src = l;
    const key = d.term.toLowerCase();
    if (defSeen.has(key) || d.def.length < 15 || d.def.length > 320) continue;
    defSeen.add(key);
    defs.push(d);
  }
  if (defs.length > CAPS.flash + CAPS.qcm + CAPS.free) {
    // tirage déterministe, pas d'écrémage « intelligent » (honnêteté)
    const picked = [];
    const used = new Set();
    while (picked.length < defs.length && used.size < CAPS.flash + CAPS.qcm + CAPS.free) {
      const i = Math.floor(rand() * defs.length);
      if (!used.has(i)) { used.add(i); picked.push(defs[i]); }
    }
    defs.length = 0; defs.push(...picked);
  }

  // ---- 2) flashcards « terme → définition »
  for (const d of defs.slice(0, CAPS.flash)) {
    items.push({
      kind: 'flash', id: `flash-${items.length}`,
      front: `Que signifie « ${d.term} » ?`,
      back: d.def,
      data: null,
      why: d.pattern === 'deux-points' ? `Ligne source : « ${d.term} : … »` : `Phrase source : « ${trim(s(d))} »`,
      pattern: d.pattern,
      _sentence: s(d),
    });
  }

  // ---- 3) QCM (uniquement si ≥ 4 définitions : distracteurs issus du TEXTE lui-même)
  if (defs.length >= 4) {
    const nQcm = Math.min(CAPS.qcm, defs.length);
    const order = shuffle([...defs.keys()], rand);
    for (let k = 0; k < nQcm; k++) {
      const target = defs[order[k]];
      const distractors = defs.filter((d) => d !== target)
        .sort(() => rand() - 0.5).slice(0, 3).map((d) => d.def);
      if (distractors.length < 3) break;
      const options = shuffle([target.def, ...distractors], rand).map((text) => ({ text, correct: text === target.def }));
      items.push({
        kind: 'qcm', id: `qcm-${items.length}`,
        front: `Que signifie « ${target.term} » ?`,
        back: null,
        data: { options, multi: false },
        why: `Distracteurs issus des autres définitions du texte.`,
        pattern: 'verbe',
        _sentence: s(target),
      });
    }
  }

  // ---- 4) textes à trous : un élément clé par phrase (terme détecté, nombre ou formule $…$)
  let clozeCount = 0;
  for (const sentence of sentences) {
    if (clozeCount >= CAPS.cloze) break;
    if (sentence.length > 260 || sentence.length < 40) continue;
    const d = matchDefinition(sentence);
    let key = null;
    if (d && d.term.length >= 3) key = d.term;
    else {
      const formula = sentence.match(/\$[^$]{2,80}\$/);
      const num = sentence.match(/-?\d+(?:[.,]\d+)?(?:\s*(?:%|km|kg|m|s|ms|°|mois|ans|jours?|heures?|minutes?|secondes?))?\b/u);
      key = formula ? formula[0] : (num && num[0]);
    }
    if (!key) continue;
    const idx = sentence.indexOf(key);
    if (idx < 0) continue;
    const holeText = `${sentence.slice(0, idx)}{{0}}${sentence.slice(idx + key.length)}`;
    items.push({
      kind: 'cloze', id: `cloze-${items.length}`,
      front: null, back: null,
      data: { text: holeText, holes: [{ answers: [key] }] },
      why: `Trou = ${key.startsWith('$') ? 'formule' : (d ? 'terme défini' : 'valeur chiffrée')} dans la phrase source.`,
      pattern: 'trou',
      _sentence: sentence,
    });
    clozeCount++;
  }

  // ---- 5) réponses libres : « rédigez » sur les définitions les plus riches
  const freeDefs = defs.filter((d) => d.def.length >= 60);
  for (const d of freeDefs.slice(0, CAPS.free)) {
    items.push({
      kind: 'free', id: `free-${items.length}`,
      front: `Rédigez en vos mots : ${d.term}.`,
      back: null,
      data: { answer: d.def },
      why: 'Réponse de référence = définition détectée (autoévaluation prévue).',
      pattern: 'verbe',
      _sentence: s(d),
    });
  }

  // ---- 6) calculs : égalités arithmétiques explicites dans le texte
  let calcCount = 0;
  for (const sentence of sentences) {
    if (calcCount >= CAPS.calc) break;
    const m = sentence.match(/(\d+(?:[.,]\d+)?(?:\s*[+×x*/−-]\s*\d+(?:[.,]\d+)?){1,3})\s*(?:=|donne|vaut|font|fait)\s*(-?\d+(?:[.,]\d+)?)/i);
    if (!m) continue;
    const expr = m[1].replace(/\s+/g, ' ').replace(/[×x]/g, '*').replace(/−/g, '-').replace(/,/g, '.');
    const result = m[2].replace(/,/g, '.');
    items.push({
      kind: 'calc', id: `calc-${items.length}`,
      front: `Calculez : ${m[1]}`,
      back: null,
      data: { answer: result, tolerance: 0 },
      why: `Égalité explicite dans la phrase source (résultat = ${result}).`,
      pattern: 'calcul',
      _sentence: sentence,
    });
    calcCount++;
  }

  // ---- 7) associations : ≥ 3 définitions → un plateau (termes ↔ définitions)
  if (defs.length >= 3) {
    const nBoards = Math.min(CAPS.match, Math.floor(defs.length / 3));
    for (let b = 0; b < nBoards; b++) {
      const slice = defs.slice(b * 6, b * 6 + Math.min(6, defs.length - b * 6));
      if (slice.length < 3) break;
      items.push({
        kind: 'match', id: `match-${items.length}`,
        front: null, back: null,
        data: { pairs: slice.map((d) => ({ left: d.term, right: d.def })) },
        why: `${slice.length} paires terme/définition détectées.`,
        pattern: 'paires',
        _sentence: slice.map((d) => d.term).join(', '),
      });
    }
  }

  // ---- 8) synthèse : premier segment de chaque paragraphe (aucune réécriture)
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 40);
  if (paragraphs.length >= 2) {
    const bullets = paragraphs.slice(0, 12).map((p) => firstFragment(p));
    items.push({
      kind: 'synth', id: `synth-0`,
      front: 'Synthèse du document',
      back: bullets,
      data: null,
      why: `Première phrase de chacun des ${bullets.length} paragraphes (aucune reformulation).`,
      pattern: 'synthese',
      _sentence: paragraphs[0].slice(0, 120),
    });
  }

  return { items: items.map(stripInternal) };

  function s(d) { return d._src || ''; }
}

function trim(s, n = 110) { return s.length > n ? `${s.slice(0, n)}…` : s; }
function stripInternal(it) { const { _sentence, ...rest } = it; return rest; }

function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Premier fragment d'un paragraphe (phrase ou segment avant deux-points). */
function firstFragment(paragraph) {
  const flat = paragraph.replace(/\n+/g, ' ').trim();
  const m = flat.match(/^([\wÀ-ÿ][^:]{4,90}):\s*(.{20,})/u);
  if (m) return `• ${m[1]} : ${trim(cleanDef(m[2]), 140)}`;
  const sent = flat.split(/(?<=[.!?])\s+/u)[0];
  return `• ${trim(sent, 160)}`;
}
