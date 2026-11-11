/**
 * Fiche : ressource texte créée/importée par l'application qui contient du
 * LaTeX ($…$ / $$…$$). Rendu markdown léger + LaTeX sans exécution de code.
 *
 * Syntaxe gérée : titres (#..###), listes (- ), paragraphes, sauts de ligne,
 * gras **texte**, italique *texte*, LaTeX en ligne ($…$) et en bloc ($$…$$).
 * Tout le reste est échappé (aucun HTML arbitraire n'est injecté).
 */
import { splitMath, latexToString } from '../latex/katex-service.js';

/** Rend la fiche dans `root`. Exporté pour tests. */
export function renderFiche(root, text) {
  root.textContent = '';
  for (const { node } of parseFiche(String(text ?? ''))) root.appendChild(node);
}

/** Parse la fiche en liste de blocs {node}. */
export function parseFiche(text) {
  const out = [];
  let mode = 'p';
  let buffer = [];

  const flush = () => {
    if (!buffer.length) { mode = 'p'; return; }
    out.push(...blockNode(mode, buffer.join('\n')));
    buffer = [];
  };

  for (const line of text.split('\n')) {
    const t = line.trim();

    const heading = /^(#{1,4})\s+(.*)$/.exec(t);
    if (heading) { flush(); out.push(headingNode(heading[1].length, heading[2])); mode = 'p'; continue; }

    const li = /^[-*]\s+(.*)$/.exec(t);
    if (li) {
      if (mode !== 'li') flush();
      mode = 'li';
      buffer.push(li[1]);
      continue;
    }

    if (!t) { flush(); mode = 'p'; continue; }

    if (mode === 'li') { flush(); mode = 'p'; }
    buffer.push(line);
  }
  flush();
  return out;
}

function headingNode(level, content) {
  const h = document.createElement(`h${Math.min(6, level + 1)}`);
  h.appendChild(textWithInline(content));
  return { node: h };
}

/** Ligne/paragraphe en segments DOM : gras/italique + math inline/bloc. */
function textWithInline(content) {
  const frag = document.createDocumentFragment();
  for (const seg of splitMath(content)) {
    if (seg.type === 'math') {
      frag.appendChild(mathNode(seg.value, seg.display));
      continue;
    }
    emitEmphasis(frag, seg.value);
  }
  return frag;
}

function mathNode(source, display) {
  const wrap = document.createElement(display ? 'div' : 'span');
  wrap.className = display ? 'tex-display' : 'tex-inline';
  wrap.innerHTML = latexToString(source, display);
  return wrap;
}

function emitEmphasis(frag, text) {
  // **gras** puis *italique* — contenu texte pur, jamais de HTML brut
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
    const e = document.createElement(m[1] != null ? 'strong' : 'em');
    e.textContent = m[1] != null ? m[1] : m[2];
    frag.appendChild(e);
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
}

function blockNode(mode, content) {
  if (mode === 'li') {
    const ul = document.createElement('ul');
    for (const item of content.split('\n')) {
      const li = document.createElement('li');
      li.appendChild(textWithInline(item));
      ul.appendChild(li);
    }
    return [{ node: ul }];
  }
  const trimmed = content.trim();
  if (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length >= 4) {
    return [{ node: mathNode(trimmed.slice(2, -2), true) }];
  }
  const p = document.createElement('p');
  p.className = 'md';
  p.appendChild(textWithInline(content));
  return [{ node: p }];
}
