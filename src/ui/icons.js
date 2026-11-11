/**
 * Bibliothèque d'icônes SVG inline (trait fin, style cohérent avec la direction
 * artistique). Chaque icône est une fonction → chaîne SVG 24x24.
 */
const S = (inner, fill = 'none') =>
  `<svg viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

export const icons = {
  home: () => S('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>'),
  folder: () => S('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  folderPlus: () => S('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v6M9 14h6"/>'),
  edit: () => S('<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M14 7l3 3"/>'),
  play: () => S('<path d="M7 4.5v15l12-7.5z"/><path d="M7 20l-0.0 0"/>'),
  chart: () => S('<path d="M4 20h16"/><path d="M6 16v-4M11 16V8M16 16v-7"/>'),
  gear: () => S('<circle cx="12" cy="12" r="3.2"/><path d="M19 12a7 7 0 0 0-.14-1.4l2-1.55-2-3.46-2.36.95A7 7 0 0 0 14 5.2L13.5 2.7h-3L10 5.2a7 7 0 0 0-2.4 1.34l-2.36-.95-2 3.46 2 1.55a7 7 0 0 0 0 2.8l-2 1.55 2 3.46 2.36-.95A7 7 0 0 0 10 18.8l.5 2.5h3l.5-2.5a7 7 0 0 0 2.4-1.34l2.36.95 2-3.46-2-1.55A7 7 0 0 0 19 12z"/>'),
  cards: () => S('<rect x="7" y="3" width="12" height="16" rx="2"/><path d="M4 7v11a3 3 0 0 0 3 3h9"/>'),
  pdf: () => S('<path d="M6 2h9l4 4v16H6z"/><path d="M15 2v4h4"/><path d="M9 14h6M9 17h4"/>'),
  image: () => S('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9" r="1.6"/><path d="m5 19 5-5 3 3 3-3 3 3"/>'),
  note: () => S('<path d="M5 3h14v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'),
  code: () => S('<path d="m9 8-5 4 5 4"/><path d="m15 8 5 4-5 4"/>'),
  back: () => S('<path d="M15 5l-7 7 7 7"/>'),
  plus: () => S('<path d="M12 5v14M5 12h14"/>'),
  trash: () => S('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>'),
  check: () => S('<path d="m5 13 4 4 10-11"/>'),
  x: () => S('<path d="M6 6l12 12M18 6 6 18"/>'),
  download: () => S('<path d="M12 4v11"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/>'),
  upload: () => S('<path d="M12 15V4"/><path d="m7 9 5-5 5 5"/><path d="M4 20h16"/>'),
  chevronUp: () => S('<path d="m6 15 6-6 6 6"/>'),
  chevronDown: () => S('<path d="m6 9 6 6 6-6"/>'),
  chevronRight: () => S('<path d="m9 6 6 6-6 6"/>'),
  eye: () => S('<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/>'),
  swap: () => S('<path d="M7 8h13l-3-3"/><path d="M17 16H4l3 3"/>'),
  clock: () => S('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>'),
  save: () => S('<path d="M5 3h11l4 4v14H5z"/><path d="M8 3v5h7V3"/><rect x="8" y="13" width="8" height="7"/>'),
  zip: () => S('<path d="M6 2h9l4 4v16H6z"/><path d="M15 2v4h4"/><path d="M10 8h2M10 11h2M10 14h2"/>'),
  timer: () => S('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2"/><path d="M9 2h6"/>'),
  palette: () => S('<circle cx="12" cy="12" r="9"/><circle cx="9" cy="9" r="1.2" fill="currentColor"/><circle cx="15" cy="9" r="1.2" fill="currentColor"/><circle cx="9.5" cy="15" r="1.2" fill="currentColor"/><circle cx="14.5" cy="14.5" r="1.2" fill="currentColor"/>'),
  sparkle: () => S('<path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z"/>'),
  crown: () => S('<path d="m4 18 1.5-11L10 12l2-8 2 8 4.5-5L20 18z"/>'),
  filter: () => S('<path d="M4 5h16l-6.5 7.5V18l-3 2v-7.5z"/>'),
  target: () => S('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>'),
  layers: () => S('<path d="M12 3 3 8l9 5 9-5z"/><path d="m4 13 8 4.5L20 13"/>'),
  calendar: () => S('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M8 14h3"/>'),
  info: () => S('<circle cx="12" cy="12" r="9"/><path d="M12 10.5V17"/><circle cx="12" cy="7.5" r="0.6" fill="currentColor"/>'),
  file: () => S('<path d="M6 2h9l4 4v16H6z"/><path d="M15 2v4h4"/>'),
  search: () => S('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.5-4.5"/>'),
  list: () => S('<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/>'),
  spinner: () => S('<path d="M12 3a9 9 0 0 1 9 9"/><path d="M21 12a9 9 0 0 1-9 9"/><path d="M12 21a9 9 0 0 1-9-9"/><path d="M3 12a9 9 0 0 1 9-9" opacity=".25"/>'),
};

/** Icône configurée : <span class="icon">svg</span> */
export function icon(name, cls = '') {
  const fn = icons[name] || icons.info;
  const span = document.createElement('span');
  span.className = `icon ${cls}`;
  span.innerHTML = fn();
  return span;
}
