/**
 * Aperçu miniature des blocs (liste de decks). Version allégée du rendu complet :
 * texte/LaTeX rendus en inline, médias réduits. Isolé du rendu principal pour ne
 * pas charger les gros médias deux fois (lazy loading partagé via bloburls).
 */
import { latexToString, splitMath } from '../latex/katex-service.js';
import { getBlobUrl } from './bloburls.js';

export async function renderBlocksMiniPreview(container, blocks) {
  container.textContent = '';
  const blocks2 = blocks || [];
  if (!blocks2.length) {
    container.appendChild(emptyHint('(face vide)'));
    return;
  }
  for (const b of blocks2) {
    if (!b || !b.type) continue;
    if (b.type === 'text' || b.type === 'latex') {
      const value = b.value ?? '';
      if (b.type === 'latex') {
        const span = document.createElement('span');
        span.className = 'tex-inline';
        span.innerHTML = latexToString(value, false);
        container.appendChild(span);
        continue;
      }
      for (const seg of splitMath(value)) {
        if (seg.type === 'math') {
          const span = document.createElement('span');
          span.className = 'tex-inline';
          span.innerHTML = latexToString(seg.value, false);
          container.appendChild(span);
        } else {
          container.appendChild(document.createTextNode(seg.value));
        }
      }
      continue;
    }
    if (b.type === 'image' || b.type === 'gif') {
      const img = document.createElement('img');
      img.className = 'blk-media mini';
      img.loading = 'lazy';
      img.alt = b.alt || 'média';
      container.appendChild(img);
      const url = await getBlobUrl(b.blobId);
      if (url) img.src = url;
      else img.replaceWith(Object.assign(document.createElement('span'), { className: 'blk-error', textContent: 'média manquant' }));
      continue;
    }
    container.appendChild(emptyHint(`[bloc ${b.type}]`));
  }
}

function emptyHint(text) {
  const s = document.createElement('span');
  s.textContent = text;
  s.style.color = 'var(--c-text-dim)';
  return s;
}
