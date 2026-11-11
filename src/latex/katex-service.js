/**
 * Service centralisé de rendu LaTeX (KaTeX).
 *
 * Choix de sécurité :
 * - `trust: false` : aucune exécution de code / URL externes à partir du LaTeX ;
 * - `throwOnError: false` : une formule invalide s'affiche en rose sans casser la carte ;
 * - le code source LaTeX est TOUJOURS conservé tel quel dans les données : le HTML
 *   rendu n'est jamais persisté, il est recalculé à l'affichage.
 */
import katex from '../../vendor/katex/katex.mjs';

const KATEX_OPTS = {
  throwOnError: false,
  errorColor: '#ff2e9a',
  trust: false,
  strict: false,
  output: 'html', // pas de MathML : évite les doublons de lecture et simplifie le responsive
};

/** Rendu d'une expression LaTeX en HTML (chaîne). `display` = mode bloc ($$). */
export function latexToString(source, display = false) {
  try {
    return katex.renderToString(source, { ...KATEX_OPTS, displayMode: display });
  } catch (e) {
    // Dernière barrière : ne jamais faire planter l'app pour une formule.
    return `<span class="latex-error">Formule invalide : ${escapeHtml(String(e.message || e))}</span>`;
  }
}

/** Rend inline dans un élément DOM existant. */
export function renderMathIn(el, source, display = false) {
  el.innerHTML = latexToString(source, display);
}

/**
 * Découpe un texte en segments pour supporter la convention $...$ / $$...$$ :
 *   "Une masse m avec $\\vec{F}=m\\vec{a}$" → [texte, math inline]
 * Respecte l'échappement \$ (pas de math pour un dollar échappé).
 * Exporté pour réutilisation (édition, fiches, tests unitaires).
 */
export function splitMath(text) {
  const segs = [];
  let buf = '';
  let i = 0;
  const isSpace = (c) => c === ' ' || c === '\t' || c === '\n';
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\' && (text[i + 1] === '$' || text[i + 1] === '\\')) {
      buf += text[i + 1] === '$' ? '$' : '\\\\';
      i += 2;
      continue;
    }
    const isBlock = ch === '$' && text[i + 1] === '$';
    if (ch === '$') {
      // Le délimiteur ouvrant doit être précédé d'un séparateur ou d'un début de texte
      // pour éviter de casser les nombres avec devise ("3 $").
      const prev = text[i - 1];
      const prevOk = i === 0 || isSpace(prev);
      // $$ → formule en bloc
      const closer = isBlock ? text.indexOf('$$', i + 2) : null;
      const singleCloser = !isBlock ? findSingleCloser(text, i + 1) : -1;
      const useCloser = isBlock ? closer : singleCloser;
      if (useCloser === -1 || (useCloser === i + 1)) {
        buf += ch; i += isBlock ? 2 : 1; continue;
      }
      if (!prevOk && !isBlock) { buf += ch; i += 1; continue; }
      const inner = text.slice(i + (isBlock ? 2 : 1), useCloser);
      if (buf) { segs.push({ type: 'text', value: buf }); buf = ''; }
      segs.push({ type: 'math', value: inner, display: isBlock });
      i = useCloser + (isBlock ? 2 : 1);
      continue;
    }
    buf += ch;
    i += 1;
  }
  if (buf) segs.push({ type: 'text', value: buf });
  return segs;
}

/** Trouve le $ fermeur d'une expression inline : ignore les dollars échappés (\$). */
function findSingleCloser(text, start) {
  for (let j = start; j < text.length; j++) {
    if (text[j] === '\\') { j++; continue; }
    if (text[j] === '$') return j;
    if (text[j] === '\n') return -1; // une formule inline ne passe pas sur plusieurs lignes
  }
  return -1;
}

/**
 * Rend un TEXTE_block (texte courant échapé) contenant possiblement du $...$/$$...$$
 * dans un élément DOM. Chaque segment est rendu séparément pour qu'une erreur
 * locale n'abîme pas le reste.
 */
export function renderTextWithMath(el, text) {
  el.textContent = '';
  for (const seg of splitMath(text ?? '')) {
    if (seg.type === 'text') {
      const span = document.createElement('span');
      span.textContent = seg.value;
      el.appendChild(span);
    } else {
      const wrap = document.createElement(seg.display ? 'div' : 'span');
      wrap.className = seg.display ? 'tex-display' : 'tex-inline';
      wrap.innerHTML = latexToString(seg.value, seg.display);
      el.appendChild(wrap);
    }
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
