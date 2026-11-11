/**
 * Statistiques (#/stats) — TABLEAU DE BORD GRAPHIQUE.
 *
 * Lecture seule, alimentée exclusivement par les données réelles :
 *  - collectDashboard() : cardStats (compteurs, intervalles, dueAt) + reviewLog
 *    (journal des réponses horodaté) + arborescence (decks/dossiers) ;
 *  - charts.js : SVG purs (anneau, courbe, barres, calendrier, barres empilées).
 *
 * Panneaux : anneau de réussite, évolution, révisions/jour, répartition
 * maîtrise, calendrier d'activité, prochaines révisions, comparaison par deck
 * (indicateurs de difficulté, cliquable) et par dossier, cartes difficiles.
 * Interactif : fenêtre temporelle (7/30/90 j) et filtre par dossier.
 * Aucune donnée fictive : un jour sans révision reste à 0, pas de point inventé.
 */
import { el } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { collectDashboard } from '../stats/stats-service.js';
import { loadFolderTree, getAllExams } from '../storage/repo.js';
import { summarizeExams } from '../exam/exam-service.js';
import {
  donut, lineChart, barChart, calendarHeatmap, stackedBar, hBars, PALETTE,
} from '../stats/charts.js';

const DAYS_OPTIONS = [7, 30, 90];

export async function statsView(viewEl) {
  const tree = await loadFolderTree();
  const state = { days: 30, folderId: null };
  viewEl.textContent = '';
  const root = el('div.stats-dash');
  viewEl.append(root);

  // options du filtre dossier : puce « Tout » + chaque dossier (indenté par profondeur)
  const ordered = []; // dossiers ordonnés par profondeur (parcours de l'arbre)
  const depthOf = new Map();
  const byParent = new Map();
  for (const f of tree.folders) {
    const arr = byParent.get(f.parentId) || [];
    arr.push(f); byParent.set(f.parentId, arr);
  }
  const walk = (parentId, depth) => {
    for (const f of byParent.get(parentId) || []) {
      depthOf.set(f.id, depth);
      ordered.push(f);
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);

  async function render() {
    root.textContent = '';
    root.append(el('div.dash-loading', {}, [icon('chart'), el('span', {}, ['Chargement…'])]));
    const d = await collectDashboard(state.days, state.folderId);
    const exams = await getAllExams();
    root.textContent = '';
    root.append(
      toolbar(),
      kpis(d),
      grid(
        successPanel(d),
        trendPanel(d),
        perDayPanel(d),
        masteryPanel(d),
        calendarPanel(d),
        upcomingPanel(d),
        deckPanel(d),
        folderPanel(d),
        difficultPanel(d),
        typePanel(d),
        examsPanel(exams),
      ),
    );
  }

  // ---------------------------------------------------------------- panneaux
  function panel(title, ic, body, cls = '') {
    return el(`div.panel.dash-panel${cls ? `.${cls}` : ''}`, {}, [
      el('h3.panel-title', {}, [icon(ic), el('span', {}, [title])]),
      ...[].concat(body).flat(2),
    ]);
  }

  function toolbar() {
    const seg = el('div.seg', { role: 'group' }, DAYS_OPTIONS.map((n) =>
      el(`button.seg-btn${state.days === n ? '.active' : ''}`, {
        onclick: () => { state.days = n; render(); },
      }, [`${n} j`])));
    const chips = el('div.chip-scroll', {}, [
      el(`button.chip${state.folderId === null ? '.chip-on' : ''}`, {
        title: 'Statistiques de toute la bibliothèque',
        onclick: () => { state.folderId = null; render(); },
      }, [icon('layers'), el('span', {}, ['Tout'])]),
      ...ordered.map((f) => el(`button.chip${state.folderId === f.id ? '.chip-on' : ''}`, {
        title: f.name,
        style: `padding-left:${10 + depthOf.get(f.id) * 14}px`,
        onclick: () => { state.folderId = f.id; render(); },
      }, [icon('folder'), el('span', {}, [f.name])])),
    ]);
    return el('div.dash-toolbar', {}, [
      el('span.toolbar-label', {}, [icon('filter'), el('span', {}, ['Période'])]),
      seg,
      chips,
    ]);
  }

  function kpis(d) {
    const dueTile = el(`div.kpi${d.dueNow > 0 ? '.kpi-alert' : ''}`, {
      role: 'button',
      title: d.dueNow > 0 ? 'Lancer une session de révision' : 'Rien à réviser pour le moment',
      onclick: () => { if (d.dueNow > 0) location.hash = '#/review'; },
    }, [
      el('span.kpi-ico', {}, [icon('clock')]),
      el('span.kpi-num', {}, [String(d.dueNow)]),
      el('span.kpi-cap', {}, ['À réviser']),
    ]);
    return el('div.kpi-grid', {}, [
      el('div.kpi', {}, [
        el('span.kpi-ico.i-azur', {}, [icon('cards')]),
        el('span.kpi-num', {}, [String(d.totals.cards)]),
        el('span.kpi-cap', {}, ['Cartes']),
      ]),
      dueTile,
      el('div.kpi', {}, [
        el('span.kpi-ico.i-gold', {}, [icon('chart')]),
        el('span.kpi-num', {}, [String(d.totals.reviews)]),
        el('span.kpi-cap', {}, ['Révisions']),
      ]),
      el('div.kpi', {}, [
        el('span.kpi-ico.i-ok', {}, [icon('check')]),
        el('span.kpi-num', {}, [d.successRate == null ? '—' : `${d.successRate}%`]),
        el('span.kpi-cap', {}, ['Réussite']),
      ]),
    ]);
  }

  function successPanel(d) {
    const inc = d.totals.reviews - d.totals.correct;
    const svg = donut({
      parts: d.totals.reviews > 0 ? [
        { value: d.totals.correct, color: PALETTE.ok, label: 'Trouvé' },
        { value: inc, color: PALETTE.danger, label: 'Pas trouvé' },
      ] : [],
      centerLabel: d.successRate == null ? '—' : `${d.successRate}%`,
      centerSub: 'réussite',
    });
    const wrap = el('div.donut-wrap'); wrap.innerHTML = svg;
    const legend = el('div.legend', {}, [
      legItem(PALETTE.ok, 'Trouvé', d.totals.correct),
      legItem(PALETTE.danger, 'Pas trouvé', inc),
    ]);
    return panel('Réussite', 'target', [wrap, legend], 'p-donut');
  }

  function trendPanel(d) {
    const wrap = el('div.chart-wrap'); wrap.innerHTML = lineChart({ points: d.trend });
    return panel('Évolution (jours révisés)', 'sparkle', [wrap, el('p.chart-note', {}, ['Taux de réussite par jour — seuls les jours avec révision sont tracés.'])], 'p-trend');
  }

  function perDayPanel(d) {
    const wrap = el('div.chart-wrap'); wrap.innerHTML = barChart({ values: d.perDay });
    return panel('Révisions par jour', 'list', [wrap], 'p-perday');
  }

  function masteryPanel(d) {
    const m = d.mastery;
    const parts = [
      { value: m.mastered, color: PALETTE.ok, label: 'Maîtrisées' },
      { value: m.learning, color: PALETTE.azur, label: 'En cours' },
      { value: m.difficult, color: PALETTE.danger, label: 'Difficiles' },
      { value: m.new, color: PALETTE.dim, label: 'Nouvelles' },
    ];
    const wrap = el('div.mastery-bar'); wrap.innerHTML = stackedBar({ parts });
    const legend = el('div.legend.legend-wrap', {}, parts.map((p) => legItem(p.color, p.label, p.value)));
    return panel('Répartition des cartes', 'layers', [wrap, legend], 'p-mastery');
  }

  function calendarPanel(d) {
    const wrap = el('div.cal-wrap'); wrap.innerHTML = calendarHeatmap({ days: d.calendar, todayKey: d.todayKey });
    return panel('Activité (16 semaines)', 'calendar', [wrap], 'p-calendar');
  }

  function upcomingPanel(d) {
    const max = Math.max(1, ...d.upcoming.map((b) => b.count));
    const wrap = el('div.hbars');
    wrap.innerHTML = hBars({
      rows: d.upcoming.map((b) => ({
        label: b.label, value: b.count, max, color: b.color,
        sub: String(b.count), title: `${b.label} : ${b.count} carte(s)`,
      })),
    });
    return panel('Prochaines révisions', 'clock', [wrap], 'p-upcoming');
  }

  function deckPanel(d) {
    if (!d.deckRows.length) {
      return panel('Par deck', 'cards', [el('div.chart-empty', {}, ['Aucun deck'])], 'p-decks');
    }
    const colorOf = { ok: PALETTE.ok, warn: PALETTE.gold, danger: PALETTE.danger, new: PALETTE.dim };
    const wrap = el('div.hbars.hbars-click');
    wrap.innerHTML = hBars({
      rows: d.deckRows.map((r) => ({
        label: r.name,
        value: r.rate ?? 0,
        max: 100,
        color: colorOf[r.status],
        sub: r.rate == null ? 'nouveau' : `${r.rate} %`,
        title: `${r.name} — ${r.path} : ${r.rate == null ? 'jamais révisé' : `${r.rate} % de réussite`}, ${r.cards} carte(s), ${r.dueNow} à réviser`,
      })),
    });
    // lignes cliquables : on reprend les nœuds générés et on branche le clic
    [...wrap.children].forEach((node, i) => {
      const r = d.deckRows[i];
      node.classList.add('hbar-link');
      node.addEventListener('click', () => { location.hash = `#/deck/${r.deckId}`; });
    });
    const legend = el('div.legend.legend-wrap', {}, [
      legItem(PALETTE.ok, '≥ 70 %', null),
      legItem(PALETTE.gold, '50–69 %', null),
      legItem(PALETTE.danger, '< 50 %', null),
      legItem(PALETTE.dim, 'Jamais révisé', null),
    ]);
    return panel('Par deck (les plus faibles d\u2019abord)', 'cards', [wrap, legend], 'p-decks');
  }

  function folderPanel(d) {
    if (!d.folderRows.length) {
      return panel('Par dossier', 'folder', [el('div.chart-empty', {}, ['Aucun dossier'])], 'p-folders');
    }
    const max = Math.max(1, ...d.folderRows.map((r) => r.cards));
    const wrap = el('div.hbars');
    wrap.innerHTML = hBars({
      rows: d.folderRows.map((r) => ({
        label: r.path,
        value: r.cards,
        max,
        color: PALETTE.azur,
        sub: `${r.cards} c.`,
        title: `${r.path} : ${r.cards} cartes, ${r.decks} deck(s), ${r.rate == null ? 'jamais révisé' : `${r.rate} % de réussite`}`,
      })),
    });
    return panel('Par dossier', 'folder', [wrap], 'p-folders');
  }

  function difficultPanel(d) {
    if (!d.difficultCards.length) {
      return panel('Cartes difficiles', 'spark', [el('div.chart-empty', {}, ['Aucune carte difficile (3 révisions ou plus avec moins de 50 % de réussite).'])], 'p-diff');
    }
    const chips = el('div.diff-chips', {}, d.difficultCards.map((c) =>
      el('button.diff-chip', {
        title: `${c.deckName} — ${c.rate} % sur ${c.reviews} révisions`,
        onclick: () => { location.hash = `#/deck/${c.deckId}`; },
      }, [
        el('span.badge-rate', {}, [`${c.rate}%`]),
        el('span.diff-front', {}, [c.front || '(carte)']),
      ])));
    return panel('Cartes difficiles', 'spark', [chips], 'p-diff');
  }

  const TYPE_LABELS = { basic: 'Flashcards', qcm: 'QCM', cloze: 'Textes à trous', free: 'Réponses libres', calc: 'Calculs', match: 'Associations' };
  function typePanel(d) {
    if (!d.typeRows.length) {
      return panel('Par type de question', 'list', [el('div.chart-empty', {}, ['Aucune réponse enregistrée'])], 'p-types');
    }
    const max = Math.max(1, ...d.typeRows.map((r) => r.count));
    const wrap = el('div.hbars');
    wrap.innerHTML = hBars({
      rows: d.typeRows.map((r) => ({
        label: TYPE_LABELS[r.type] || r.type,
        value: r.count, max, color: PALETTE.azur,
        sub: `${r.count}${r.rate != null ? ` · ${r.rate} %` : ''}`,
        title: `${TYPE_LABELS[r.type] || r.type} : ${r.count} réponse(s), ${r.rate != null ? `${r.rate} % de réussite` : 'sans note'}`,
      })),
    });
    return panel('Par type de question', 'list', [wrap], 'p-types');
  }

  function examsPanel(exams) {
    // PANNEAU SÉPARÉ : les examens ne sont JAMAIS mélangés aux statistiques de
    // révision (cardStats/reviewLog). Agrégats uniquement sur l'historique réel.
    const s = summarizeExams(exams);
    if (!s.count) {
      return panel('Examens', 'target', [
        el('div.chart-empty', {}, ['Aucun examen passé.']),
        el('button.btn.btn-sm', { onclick: () => { location.hash = '#/exam'; } }, [icon('target', 'i16'), el('span', {}, ['Préparer un examen'])]),
      ], 'p-exams');
    }
    const rows = [
      { label: 'Examens passés', value: s.count, max: Math.max(1, s.count), color: PALETTE.azur, sub: String(s.count) },
      { label: 'Moyenne', value: s.avgPct ?? 0, max: 100, color: PALETTE.gold, sub: s.avgPct != null ? `${s.avgPct} %` : '—' },
      { label: 'Meilleur', value: s.bestPct ?? 0, max: 100, color: PALETTE.ok, sub: s.bestPct != null ? `${s.bestPct} %` : '—' },
    ];
    const wrap = el('div.hbars');
    wrap.innerHTML = hBars({ rows });
    return panel('Examens', 'target', [
      wrap,
      el('button.btn.btn-sm', { onclick: () => { location.hash = '#/exam/history'; } }, [icon('calendar', 'i16'), el('span', {}, ['Historique complet'])]),
    ], 'p-exams');
  }

  function legItem(color, label, value) {
    return el('span.leg', {}, [
      el('span.dot', { style: `background:${color}` }),
      el('span.leg-label', {}, [label]),
      value == null ? null : el('span.leg-num', {}, [String(value)]),
    ]);
  }

  function grid(...panels) {
    return el('div.dash-grid', {}, panels);
  }

  await render();
}
