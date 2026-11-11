/**
 * Visualiseur d'image (PNG/JPEG/WebP/GIF — les GIF animés sont servis depuis
 * l'Object URL sans réencodage). Zoom simple via largeur contrôlée.
 */
export function openImageViewer(container, url, initialWidth = 100) {
  container.textContent = '';
  let widthPct = initialWidth;

  const img = document.createElement('img');
  img.alt = 'image importée';
  img.style.width = `${widthPct}%`;
  img.style.maxWidth = 'none';
  img.className = 'zoomable';
  img.src = url;

  const wrap = document.createElement('div');
  wrap.className = 'img-viewer';
  wrap.appendChild(img);

  const note = document.createElement('span');
  note.className = 'viewer-page-note';
  const upd = () => { note.textContent = `Zoom ${widthPct}%`; img.style.width = `${widthPct}%`; };
  upd();

  const toolbar = document.createElement('div');
  toolbar.className = 'viewer-toolbar';
  const mk = (label, fn) => {
    const b = document.createElement('button');
    b.className = 'btn btn-sm';
    b.textContent = label;
    b.onclick = fn;
    return b;
  };
  toolbar.append(
    mk('−', () => { widthPct = Math.max(20, widthPct / 1.25); upd(); }),
    note,
    mk('+', () => { widthPct = Math.min(400, widthPct * 1.25); upd(); }),
    mk('100 %', () => { widthPct = 100; upd(); }),
  );

  container.appendChild(toolbar);
  container.appendChild(wrap);
  wrap.addEventListener('dblclick', () => { widthPct = 100; upd(); });
}
