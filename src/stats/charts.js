/**
 * Briques de graphiques SVG purs (aucune bibliothèque externe).
 * Chaque fonction retourne une CHAÎNE SVG — la vue l'insère via innerHTML.
 * Infobulles natives via <title> (survol desktop / appui long mobile).
 * Aucune donnée fictive : les valeurs viennent des agrégats réels du service.
 * Couleurs alignées sur la palette de styles.css (azur/indigo/rose/or/vert/rouge).
 */

const TXT = 'rgba(233,238,255,0.72)';
const GRID = 'rgba(255,255,255,0.09)';

export const PALETTE = {
  ok: '#23e39c',
  gold: '#ffb800',
  danger: '#ff3b5c',
  accent: '#ff2e9a',
  azur: '#2293f7',
  indigo: '#4654ee',
  violet: '#5b2ee0',
  dim: 'rgba(255,255,255,0.14)',
};

/** Échappement HTML pour textes insérés dans le SVG (noms de decks, dates…). */
function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

const fmtInt = (n) => String(Math.round(n));

/**
 * Anneau (donut) de répartition. parts = [{ value, color, label }]
 * centerLabel / centerSub affichés au centre (ex : « 87 % », « réussite »).
 */
export function donut({ parts, size = 168, thickness = 20, centerLabel = '', centerSub = '' }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const r = (size - thickness) / 2;
  const c = size / 2;
  const C = 2 * Math.PI * r;
  let segs = '';
  if (total > 0) {
    let offset = 0;
    for (const p of parts) {
      if (p.value <= 0) continue;
      const len = (p.value / total) * C;
      segs += `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${p.color}" `
        + `stroke-width="${thickness}" stroke-linecap="butt" `
        + `stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" `
        + `stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${c} ${c})">`
        + `<title>${esc(p.label)} : ${fmtInt(p.value)}</title></circle>`;
      offset += len;
    }
  } else {
    segs = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${PALETTE.dim}" stroke-width="${thickness}"><title>Aucune donnée</title></circle>`;
  }
  return `<svg viewBox="0 0 ${size} ${size}" class="chart-donut" role="img" width="${size}" height="${size}">`
    + `${segs}`
    + `<text x="${c}" y="${c - 2}" text-anchor="middle" class="donut-big">${esc(centerLabel)}</text>`
    + `<text x="${c}" y="${c + 16}" text-anchor="middle" fill="${TXT}" font-size="11">${esc(centerSub)}</text>`
    + `</svg>`;
}

/**
 * Courbe d'évolution. points = [{ label, v }] (v entre 0 et yMax).
 * Seuls les points réellement mesurés sont tracés (aucun jour inventé).
 */
export function lineChart({ points, w = 560, h = 170, color = PALETTE.azur, yMax = 100, unit = '%' }) {
  if (points.length < 2) {
    return `<svg viewBox="0 0 ${w} ${h}" class="chart-line" width="100%" height="${h}">`
      + `<text x="${w / 2}" y="${h / 2}" text-anchor="middle" fill="${TXT}" font-size="12">Pas encore assez de jours révisés pour une courbe</text></svg>`;
  }
  const padL = 34, padR = 10, padT = 10, padB = 22;
  const iw = w - padL - padR, ih = h - padT - padB;
  const x = (i) => padL + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v) => padT + ih - (Math.max(0, Math.min(yMax, v)) / yMax) * ih;
  let grid = '';
  for (const gv of [0, 50, 100]) {
    grid += `<line x1="${padL}" y1="${y(gv * (yMax / 100))}" x2="${w - padR}" y2="${y(gv * (yMax / 100))}" stroke="${GRID}" stroke-width="1"/>`
      + `<text x="${padL - 6}" y="${y(gv * (yMax / 100)) + 3}" text-anchor="end" fill="${TXT}" font-size="10">${gv * (yMax / 100)}${esc(unit)}</text>`;
  }
  const pts = points.map((p, i) => ({ px: x(i), py: y(p.v), p }));
  const poly = pts.map((q) => `${q.px.toFixed(1)},${q.py.toFixed(1)}`).join(' ');
  const area = `${padL},${y(0)} ${poly} ${x(points.length - 1).toFixed(1)},${y(0)}`;
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));
  let dots = '', labels = '';
  pts.forEach((q, i) => {
    dots += `<circle cx="${q.px.toFixed(1)}" cy="${q.py.toFixed(1)}" r="3.2" fill="${color}"><title>${esc(q.p.label)} : ${fmtInt(q.p.v)}${esc(unit)}</title></circle>`;
    if (i % labelEvery === 0 || i === points.length - 1) {
      labels += `<text x="${q.px.toFixed(1)}" y="${h - 6}" text-anchor="middle" fill="${TXT}" font-size="10">${esc(q.p.label)}</text>`;
    }
  });
  return `<svg viewBox="0 0 ${w} ${h}" class="chart-line" width="100%" height="${h}" preserveAspectRatio="none" style="max-width:${w}px">`
    + `${grid}`
    + `<polygon points="${area}" fill="${color}" opacity="0.14"/>`
    + `<polyline points="${poly}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`
    + `${dots}${labels}`
    + `</svg>`;
}

/**
 * Barres verticales (révisions par jour). values = [{ label, v, title }]
 * Les jours sans révision restent visibles à 0 (donnée réelle : « rien ce jour »).
 */
export function barChart({ values, w = 560, h = 150, color = PALETTE.gold, yLabelEvery = 25 }) {
  if (!values.length) {
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}"><text x="${w / 2}" y="${h / 2}" text-anchor="middle" fill="${TXT}" font-size="12">Aucune révision sur la période</text></svg>`;
  }
  const padL = 34, padR = 8, padT = 10, padB = 20;
  const iw = w - padL - padR, ih = h - padT - padB;
  const vMax = Math.max(1, ...values.map((d) => d.v));
  const step = iw / values.length;
  const bw = Math.max(2, Math.min(26, step * 0.62));
  let out = '';
  for (const gv of [0, vMax]) {
    const yy = padT + ih - (gv / vMax) * ih;
    out += `<line x1="${padL}" y1="${yy}" x2="${w - padR}" y2="${yy}" stroke="${GRID}"/>`
      + `<text x="${padL - 6}" y="${yy + 3}" text-anchor="end" fill="${TXT}" font-size="10">${fmtInt(gv)}</text>`;
  }
  values.forEach((d, i) => {
    const bh = (d.v / vMax) * ih;
    const bx = padL + i * step + (step - bw) / 2;
    const by = padT + ih - bh;
    out += d.v > 0
      ? `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${color}"><title>${esc(d.title || `${d.label} : ${d.v}`)}</title></rect>`
      : `<rect x="${bx.toFixed(1)}" y="${(padT + ih - 1.5).toFixed(1)}" width="${bw.toFixed(1)}" height="1.5" rx="0" fill="${PALETTE.dim}"><title>${esc(d.title || `${d.label} : 0`)}</title></rect>`;
  });
  const labelEvery = Math.max(1, Math.ceil(values.length / 6));
  values.forEach((d, i) => {
    if (i % labelEvery === 0 || i === values.length - 1) {
      const cx = padL + i * step + step / 2;
      out += `<text x="${cx.toFixed(1)}" y="${h - 5}" text-anchor="middle" fill="${TXT}" font-size="10">${esc(d.label)}</text>`;
    }
  });
  void yLabelEvery;
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" style="max-width:${w}px">${out}</svg>`;
}

/**
 * Calendrier d'activité (grille type contribution graph).
 * days = [{ key: 'YYYY-MM-DD', count }] — ordonné, une case par jour.
 * weeks = nombre de colonnes (semaines). Les jours futurs sont grisés clairs.
 */
export function calendarHeatmap({ days, todayKey, cell = 13, gap = 3 }) {
  if (!days.length) {
    return `<div class="chart-empty">Aucun jour révisé enregistré</div>`;
  }
  const weeks = Math.ceil(days.length / 7);
  const w = weeks * (cell + gap) + 26;
  const h = 7 * (cell + gap) + 6;
  const scale = (n) => {
    if (n <= 0) return 'rgba(255,255,255,0.07)';
    if (n <= 5) return 'rgba(34,147,247,0.35)';
    if (n <= 15) return 'rgba(34,147,247,0.6)';
    if (n <= 30) return '#2293f7';
    if (n <= 60) return '#5b2ee0';
    return '#ff2e9a';
  };
  let out = '';
  days.forEach((d, i) => {
    const col = Math.floor(i / 7);
    const row = i % 7;
    const x = 24 + col * (cell + gap);
    const y = 4 + row * (cell + gap);
    const future = todayKey && d.key > todayKey;
    out += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" `
      + `fill="${future ? 'rgba(255,255,255,0.03)' : scale(d.count)}">`
      + `<title>${esc(d.title || `${d.key} : ${d.count} révision(s)`)}</title></rect>`;
  });
  // repères de mois (1er du mois)
  let month = null;
  days.forEach((d, i) => {
    const mm = d.key.slice(0, 7);
    if (mm !== month) {
      month = mm;
      const col = Math.floor(i / 7);
      out += `<text x="${24 + col * (cell + gap)}" y="0" fill="${TXT}" font-size="9"></text>`;
    }
  });
  const letters = ['L', '', 'M', '', 'J', '', 'S']; // lundi en haut
  letters.forEach((L, row) => {
    if (L) out += `<text x="10" y="${4 + row * (cell + gap) + cell - 3}" fill="${TXT}" font-size="9">${L}</text>`;
  });
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="max-width:${w}px" height="${h}">${out}</svg>`;
}

/**
 * Barres empilées horizontales (répartition maîtrise).
 * parts = [{ value, color, label }] — segments cliquables côté vue si besoin.
 */
export function stackedBar({ parts, h = 26 }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const w = 100; // viewBox en % via width 100%
  let segs = '';
  let x = 0;
  if (total > 0) {
    for (const p of parts) {
      if (p.value <= 0) continue;
      const bw = (p.value / total) * w;
      segs += `<rect x="${x.toFixed(2)}" y="0" width="${Math.max(bw - 0.6, 0).toFixed(2)}" height="${h}" rx="5" fill="${p.color}"><title>${esc(p.label)} : ${fmtInt(p.value)}</title></rect>`;
      x += bw;
    }
  } else {
    segs = `<rect x="0" y="0" width="${w}" height="${h}" rx="5" fill="${PALETTE.dim}"><title>Aucune carte</title></rect>`;
  }
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" style="display:block">${segs}</svg>`;
}

/**
 * Barres de comparaison horizontales (par deck / par dossier).
 * rows = [{ label, value, max, color, title, sub }] — rendu HTML (labels lisibles).
 */
export function hBars({ rows }) {
  const out = [];
  for (const r of rows) {
    const pct = r.max > 0 ? Math.max(2, Math.round((r.value / r.max) * 100)) : 0;
    out.push(
      `<div class="hbar-row" title="${esc(r.title || r.label)}">`
      + `<span class="hbar-label">${esc(r.label)}</span>`
      + `<span class="hbar-track"><span class="hbar-fill" style="width:${r.max > 0 ? pct : 0}%;background:${r.color}"></span></span>`
      + `<span class="hbar-value">${esc(r.sub ?? fmtInt(r.value))}</span>`
      + `</div>`,
    );
  }
  return out.join('');
}
