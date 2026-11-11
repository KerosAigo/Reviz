/**
 * Composants d'interaction par TYPE de question — partagés entre la session
 * de révision (correction immédiate) et le mode examen (correction différée).
 *
 * Chaque fabrique reçoit les données typées de la carte (card.data) et une
 * valeur de réponse préexistante (reprise d'examen) + un rappel onInput.
 * Elle retourne :
 *   node           — DOM à insérer ;
 *   read()         — valeur courante au format `given` attendu par
 *                    exam-service.gradeItem ;
 *   answered()     — la réponse est-elle complète ?
 *   revealCorrect(correct) — marque visuellement la correction (révision).
 *
 * Formats `given` (identiques côté correcteur) :
 *   qcm    : tableau des indices choisis
 *   cloze  : tableau de chaînes (une par trou)
 *   calc   : chaîne (nombre ou expression)
 *   match  : tableau de chaînes aligné sur data.pairs (droite choisie)
 *   basic/free : chaîne
 */
import { el } from '../ui/components.js';
import { renderBlocks } from '../render/blocks.js';

/** Types à données structurées (card.type !== undefined). */
export const TYPED_TYPES = Object.freeze(['qcm', 'cloze', 'free', 'calc', 'match']);

export function isTypedCard(card) {
  return !!card && !!card.type && card.type !== 'basic';
}

// ---------------------------------------------------------------- QCM

export function qcmInteraction(data, seed, onInput, { disabled = false } = {}) {
  const options = data.options || [];
  const selected = new Set(Array.isArray(seed) ? seed : []);
  const list = el('div.ex-options');
  const nodes = [];

  options.forEach((o, oi) => {
    const on = selected.has(oi);
    const opt = el('label.ex-option', { class: on ? 'on' : '' }, [
      el('input', {
        type: data.multi ? 'checkbox' : 'radio',
        name: `qcm-${Math.random().toString(36).slice(2, 8)}`,
        checked: on,
        disabled,
        onchange: () => {
          if (data.multi) {
            if (input.checked) selected.add(oi); else selected.delete(oi);
          } else {
            selected.clear(); selected.add(oi);
          }
          nodes.forEach((n, ni) => n.classList.toggle('on', selected.has(ni)));
          onInput && onInput(read());
        },
      }),
      el('span', {}, [String(o.text ?? '')]),
    ]);
    const input = opt.querySelector('input');
    nodes.push(opt);
    list.appendChild(opt);
  });

  function read() { return [...selected].sort((a, b) => a - b); }
  function answered() { return selected.size > 0; }
  function revealCorrect(correct) {
    nodes.forEach((n, ni) => {
      const isGood = !!(options[ni] && options[ni].correct);
      n.classList.toggle('ok', isGood && correct);
      n.classList.toggle('ko', selected.has(ni) !== isGood);
    });
  }
  return { node: list, read, answered, revealCorrect };
}

// ---------------------------------------------------------------- Texte à trous

export function clozeInteraction(data, seed, onInput, { disabled = false } = {}) {
  const holes = data.holes || [];
  const arr = Array.isArray(seed) ? seed.slice(0, holes.length) : holes.map(() => '');
  while (arr.length < holes.length) arr.push('');
  const line = el('div.ex-cloze');
  const inputs = [];

  String(data.text || '').split(/\{\{(\d+)\}\}/).forEach((part, pi) => {
    if (pi % 2 === 0) {
      if (part) line.appendChild(el('span', {}, [part]));
    } else {
      const hi = Number(part);
      const inp = el('input.text-input.ex-cloze-input', {
        disabled,
        oninput: () => {
          arr[hi] = inp.value;
          onInput && onInput(read());
        },
      });
      inp.value = arr[hi] || '';
      inputs[hi] = inp;
      line.appendChild(inp);
    }
  });

  function read() { return arr.slice(); }
  function answered() { return arr.every((v) => typeof v === 'string' && v.trim() !== ''); }
  function revealCorrect(correct) {
    holes.forEach((h, hi) => {
      const inp = inputs[hi];
      if (!inp) return;
      inp.disabled = true;
      inp.placeholder = h.answers.join(' / ');
      inp.classList.add(correct ? 'ok' : 'ko');
    });
  }
  return { node: line, read, answered, revealCorrect };
}

// ---------------------------------------------------------------- Calcul

export function calcInteraction(data, seed, onInput, { disabled = false, placeholder = 'Réponse numérique ou expression' } = {}) {
  const inp = el('input.text-input', { disabled, placeholder });
  inp.value = typeof seed === 'string' ? seed : '';
  inp.addEventListener('input', () => { onInput && onInput(read()); });

  function read() { return inp.value; }
  function answered() { return inp.value.trim() !== ''; }
  function revealCorrect(correct) {
    inp.disabled = true;
    if (!correct) {
      inp.placeholder = `Attendu : ${data.answer ?? '?'}`;
      inp.classList.add('ko');
    } else {
      inp.classList.add('ok');
    }
  }
  return { node: inp, read, answered, revealCorrect };
}

// ---------------------------------------------------------------- Réponse saisie (flashcard / libre)

export function textInteraction(seed, onInput, { placeholder = 'Votre réponse…', disabled = false } = {}) {
  const ta = el('textarea.text-input', { placeholder, disabled });
  ta.value = typeof seed === 'string' ? seed : '';
  ta.addEventListener('input', () => { onInput && onInput(read()); });

  function read() { return ta.value; }
  function answered() { return ta.value.trim() !== ''; }
  function revealCorrect(correct) { ta.classList.add(correct ? 'ok' : 'ko'); }
  return { node: ta, read, answered, revealCorrect };
}

// ---------------------------------------------------------------- Associations

/**
 * Composant d'association compact (pills) — utilisé par le mode examen,
 * où la réponse doit rester modifiable et persistable.
 * Les paires sont des chaînes : given = [droite choisie pour chaque gauche].
 */
export function matchInteraction(data, seed, onInput, { disabled = false } = {}) {
  const pairs = data.pairs || [];
  const arr = Array.isArray(seed) ? seed.slice(0, pairs.length) : pairs.map(() => '');
  while (arr.length < pairs.length) arr.push('');
  const box = el('div.ex-match');
  const rowOpts = [];

  pairs.forEach((p, li) => {
    const row = el('div.ex-match-row');
    row.appendChild(el('span.ex-match-left', {}, [String(p.left)]));
    const opts = el('div.ex-match-opts');
    const optsList = [];
    pairs.forEach((q) => {
      const b = el('button.ex-match-opt', {
        type: 'button',
        disabled,
        onclick: () => {
          arr[li] = arr[li] === q.right ? '' : q.right;
          sync();
          onInput && onInput(read());
        },
      }, [String(q.right)]);
      optsList.push({ b, right: q.right, li });
      opts.appendChild(b);
    });
    row.appendChild(opts);
    box.appendChild(row);
    rowOpts.push(optsList);
  });

  function sync() {
    for (const optsList of rowOpts) {
      for (const { b, right, li } of optsList) {
        b.classList.toggle('on', arr[li] === right);
        b.disabled = disabled;
      }
    }
  }
  sync();

  function read() { return arr.slice(); }
  function answered() { return arr.every((v) => typeof v === 'string' && v.trim() !== ''); }
  function revealCorrect(correct) {
    pairs.forEach((p, li) => {
      if (arr[li] !== p.right) {
        rowOpts[li].find((o) => o.right === p.right)?.b.classList.add('ok');
      }
    });
  }
  return { node: box, read, answered, revealCorrect };
}

// ---------------------------------------------------------------- Fabrique unifiée

/**
 * Interaction pour une carte typée donnée.
 * @param {object} card  carte (type + data)
 * @param {*} seed       valeur `given` préexistante (ou null)
 * @param {function} onInput  rappel à chaque modification
 * @param {object} opts  { disabled }
 */
export function typedInteraction(card, seed, onInput, opts = {}) {
  const data = card.data || {};
  switch (card.type) {
    case 'qcm': return qcmInteraction(data, seed, onInput, opts);
    case 'cloze': return clozeInteraction(data, seed, onInput, opts);
    case 'calc': return calcInteraction(data, seed, onInput, opts);
    case 'match': return matchInteraction(data, seed, onInput, opts);
    case 'free': return textInteraction(seed, onInput, { ...opts, placeholder: 'Votre réponse rédigée…' });
    default: return textInteraction(seed, onInput, opts);
  }
}

/** Bloc « réponse attendue » typée (texte simple). */
export function expectedTextOf(card) {
  const data = card.data || {};
  switch (card.type) {
    case 'qcm': return (data.options || []).filter((o) => o.correct).map((o) => o.text).join(' · ') || '—';
    case 'cloze': return (data.holes || []).map((h) => h.answers.join(' / ')).join(' · ') || '—';
    case 'calc': {
      const tol = Number(data.tolerance) ? ` (tolérance ± ${data.tolerance})` : '';
      return `${data.answer ?? '—'}${tol}`;
    }
    case 'match': return (data.pairs || []).map((p) => `${p.left} → ${p.right}`).join(' · ') || '—';
    case 'free': return data.answer || '';
    default: return '';
  }
}

/** Rendu des blocs recto dans un conteneur (helper pratique). */
export function renderPrompt(container, card) {
  return renderBlocks(container, card.front || []);
}
