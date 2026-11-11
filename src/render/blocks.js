/**
 * Rendu des blocs de contenu d'une face de carte.
 *
 * Un bloc = { type:'text'|'latex', value } ou { type:'image'|'gif', blobId, alt }.
 * Les blocs sont rendus dans l'ordre (spécification .reviz).
 * Le texte "text" supporte la convention $...$ / $$...$$ via le service LaTeX :
 * une formule invalide s'affiche en rose sans casser le reste du bloc.
 */
import { latexToString, splitMath } from '../latex/katex-service.js';
import { getBlobUrl } from './bloburls.js';

/** Rend les blocs dans `container`. Retourne une promesse (chargement des médias). */
export async function renderBlocks(container, blocks) {
  container.textContent = '';
  for (const b of blocks || []) {
    await renderSingleBlock(container, b);
  }
  return container;
}

async function renderSingleBlock(container, b) {
  if (!b || !b.type) return;
  if (b.type === 'text') {
    const div = document.createElement('div');
    div.className = 'blk blk-text';
    renderTextWithMathInto(div, b.value ?? '');
    container.appendChild(div);
    return;
  }
  if (b.type === 'latex') {
    const div = document.createElement('div');
    // Un bloc latex englobé par $$...$$ est rendu en mode bloc ; sinon inline.
    const trimmed = (b.value || '').trim();
    const isDisplay = trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length >= 4;
    div.className = `blk blk-latex ${isDisplay ? 'tex-display-wrap' : ''}`;
    div.innerHTML = latexToString(isDisplay ? trimmed.slice(2, -2) : trimmed, isDisplay);
    container.appendChild(div);
    return;
  }
  if (b.type === 'image' || b.type === 'gif') {
    const img = document.createElement('img');
    img.className = 'blk blk-media';
    img.alt = b.alt || 'média de la carte';
    img.loading = 'lazy';
    const url = await getBlobUrl(b.blobId);
    if (url) {
      img.src = url;
      container.appendChild(img);
    } else {
      container.appendChild(errEl('Média introuvable dans la base locale. Réimportez le deck ou l\u2019image.'));
    }
    return;
  }
  // Type inconnu d'une version future du format : affiché sans crasher.
  container.appendChild(errEl(`Bloc non pris en charge : ${b.type}`));
}

/** Texte courant échappé + rendu des $...$ / $$...$. */
function renderTextWithMathInto(el, text) {
  el.textContent = '';
  for (const seg of splitMath(text)) {
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

function errEl(msg) {
  const p = document.createElement('p');
  p.className = 'blk-error';
  p.textContent = msg;
  return p;
}
