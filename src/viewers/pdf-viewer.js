/**
 * Visualiseur PDF (PDF.js vendored, worker local).
 * Navigation page/préc., zoom avant/arrière + ajustement.
 * Les PDF sont affichés TELS QUELS (aucune interprétation du contenu).
 */
import * as pdfjsLib from '../../vendor/pdfjs/pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.mjs';


export async function openPdf(container, bytes, fileName = 'document') {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const doc = await pdfjsLib.getDocument({
    data,
    cMapUrl: '/vendor/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/vendor/pdfjs/standard_fonts/',
    wasmUrl: '/vendor/pdfjs/wasm/',
    enableXfa: true,
  }).promise;

  container.textContent = '';
  let page = 1;
  let zoom = 1;          // 1 = ajusté à la largeur
  let renderedPage = 0;
  let renderedZoom = 0;
  let renderTask = null;
  let destroyed = false;

  const canvas = document.createElement('canvas');
  const scroll = document.createElement('div');
  scroll.className = 'pdf-scroll';
  scroll.appendChild(canvas);

  const note = document.createElement('span');
  note.className = 'viewer-page-note';
  const noteText = () => { note.textContent = `Page ${page} / ${doc.numPages} — zoom ${Math.round(zoom * 100)}%`; };
  noteText();

  const btn = (iconHtml, title, fn, disabled = false) => {
    const b = document.createElement('button');
    b.className = 'btn btn-sm';
    b.title = title;
    b.innerHTML = iconHtml;
    b.onclick = fn;
    b.disabled = disabled;
    return b;
  };

  const toolbar = document.createElement('div');
  toolbar.className = 'viewer-toolbar';
  toolbar.append(
    btn('◀', 'Page précédente', () => goToPage(page - 1)),
    note, btn('▶', 'Page suivante', () => goToPage(page + 1)),
    btn('−', 'Dézoomer', () => setZoom(zoom / 1.25)),
    btn('+', 'Zoomer', () => setZoom(zoom * 1.25)),
    btn('⤢', 'Ajuster à la largeur', () => setZoom(1)),
  );
  container.appendChild(toolbar);
  container.appendChild(scroll);

  async function goToPage(p) {
    if (p < 1 || p > doc.numPages) return;
    page = p;
    noteText();
    await renderCurrent();
  }
  function setZoom(z) {
    zoom = Math.min(4, Math.max(0.4, z));
    noteText();
    return renderCurrent();
  }

  async function renderCurrent() {
    if (destroyed) return;
    if (renderTask) renderTask.cancel();
    const pageObj = await doc.getPage(page);
    const widthPx = scroll.clientWidth - 24;
    const base = pageObj.getViewport({ scale: 1 });
    const scale = zoom === 1 ? (widthPx / base.width) : zoom;
    const viewport = pageObj.getViewport({ scale: Math.max(0.2, scale) });
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const ctx = canvas.getContext('2d');
    if (renderTask) try { renderTask.cancel(); } catch (_) { /* déjà annulée */ }
    renderTask = pageObj.render({ canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
    try {
      await renderTask.promise;
      renderedPage = page;
      renderedZoom = zoom;
    } catch (e) {
      if (!/cancel/i.test(String(e?.name))) {
        canvas.replaceWith(Object.assign(document.createElement('p'), { className: 'blk-error', textContent: `Rendu impossible : ${e.message || e}` }));
      }
    }
  }

  const onResize = () => { if (renderedPage === page) renderCurrent(); };
  window.addEventListener('resize', onResize);

  await renderCurrent();

  return {
    destroy: () => {
      destroyed = true;
      window.removeEventListener('resize', onResize);
      try { renderTask?.cancel(); } catch (_) { /* ignore */ }
      doc.destroy();
    },
    setZoom,
  };
}
