/**
 * Mode examen (#/exam préparation · #/exam/run déroulé · #/exam/result/:id · #/exam/history).
 *
 * Préparation : sélection MULTIPLE de decks (dossier = toute sa descendance),
 * nombre de questions, durée, difficulté, types autorisés, mélange aléatoire.
 * La sélection est un état réel (Set de deckIds) reflété dans les compteurs.
 *
 * Déroulé : une question à la fois, chronomètre global, barre de progression,
 * grille de navigation (retour en arrière et modification avant validation),
 * passer une question, terminer avant la fin du temps. À expiration du
 * chronomètre, la phase de réponse est clôturée automatiquement. L'état est
 * persisté dans sessionStorage : un rechargement d'onglet reprend l'examen.
 *
 * Correction : correction différée — les questions à réponse subjective
 * (flashcard, réponse libre) sont AUTOÉVALUÉES par l'utilisateur (aucun
 * jugement prétendument IA) ; les types objectifs (QCM, trous, calcul,
 * association) sont corrigés automatiquement.
 *
 * Résultats : note /20, %, bonnes/mauvaises/non traitées, temps utilisé,
 * notions à retravailler, correction détaillée avec réponses attendues.
 * Les résultats d'examen ne touchent JAMAIS les statistiques de révision.
 */
import { el, toast, confirmDialog } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { renderBlocks } from '../render/blocks.js';
import { prefetchBlobUrls } from '../render/bloburls.js';
import { libraryOverview } from '../review/engine.js';
import { typedInteraction } from '../review/interactions.js';
import { fmtDateTime } from '../core/utils.js';
import {
  EXAM_TYPES, EXAM_TYPE_LABEL, AUTO_GRADED, DIFFICULTIES,
  poolForDeckIds, poolSummary, selectQuestions, buildItems,
  gradeItem, finalizeExam, gradeOver20, getExam, getAllExams,
} from '../exam/exam-service.js';

const RUN_KEY = 'reviz.examRun';
const RELAUNCH_KEY = 'reviz.examRelaunch';

function saveRun(run) { sessionStorage.setItem(RUN_KEY, JSON.stringify(run)); }
function loadRun() {
  try { return JSON.parse(sessionStorage.getItem(RUN_KEY) || 'null'); } catch (_) { return null; }
}
function clearRun() { sessionStorage.removeItem(RUN_KEY); }

function fmtDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `${r} s`;
  return `${m} min ${String(r).padStart(2, '0')} s`;
}

/** Blobs utilisés par les instantanés (préchargement pour la réactivité). */
function snapshotBlobIds(items) {
  const ids = [];
  for (const it of items) {
    for (const face of [it.snapshot?.front, it.snapshot?.back]) {
      for (const b of face || []) if (b.blobId) ids.push(b.blobId);
    }
  }
  return ids;
}

// ============================================================ Préparation

export async function examPrepView(viewEl) {
  viewEl.textContent = '';

  const relaunch = (() => {
    try { return JSON.parse(sessionStorage.getItem(RELAUNCH_KEY) || 'null'); } catch (_) { return null; }
  })();

  let cfg = {
    deckIds: new Set(relaunch?.deckIds || []),
    count: Number.isFinite(relaunch?.count) ? relaunch.count : 10,
    durationMin: Number.isFinite(relaunch?.durationMin) ? relaunch.durationMin : 20,
    difficulty: relaunch?.difficulty || 'toutes',
    types: new Set(relaunch?.types || ['basic']),
    shuffle: relaunch?.shuffle !== false,
  };

  const overview = await libraryOverview();

  // decks descendants de chaque dossier (calculé une fois sur les nodes)
  const folderDecks = new Map();
  for (let i = 0; i < overview.nodes.length; i++) {
    const n = overview.nodes[i];
    if (n.type !== 'folder') continue;
    const ids = [];
    for (let j = i + 1; j < overview.nodes.length && overview.nodes[j].depth > n.depth; j++) {
      if (overview.nodes[j].type === 'deck') ids.push(overview.nodes[j].deckId);
    }
    folderDecks.set(n.folderId, ids);
  }
  const allDeckIds = overview.decks.map((d) => d.id);

  const title = el('h3.panel-title', {}, [icon('target', 'i16'), el('span', {}, ['Préparer un examen'])]);

  // ---- arbre multi-sélection
  let treeBox;
  function twistie(onOpen, onToggle) {
    const t = el('span.twistie', { role: 'button', tabindex: 0 }, [icon('chevronDown', 'i12')]);
    t.addEventListener('click', (e) => { e.stopPropagation(); onToggle(); });
    t.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onToggle(); } });
    t.classList.toggle('closed', !onOpen);
    return t;
  }

  function rowSelected(node) {
    if (node.type === 'all') return cfg.deckIds.size > 0 && cfg.deckIds.size === allDeckIds.length;
    if (node.type === 'folder') {
      const ids = folderDecks.get(node.folderId) || [];
      return ids.length > 0 && ids.every((id) => cfg.deckIds.has(id));
    }
    return cfg.deckIds.has(node.deckId);
  }

  function toggleNode(node) {
    const ids = node.type === 'all' ? allDeckIds
      : node.type === 'folder' ? (folderDecks.get(node.folderId) || [])
      : [node.deckId];
    const allOn = ids.every((id) => cfg.deckIds.has(id));
    if (allOn) for (const id of ids) cfg.deckIds.delete(id);
    else for (const id of ids) cfg.deckIds.add(id);
    renderTree();
    refreshPool();
  }

  const expanded = new Set();
  function treeRow(n) {
    const row = el('div.exam-tree-row', { dataset: { depth: String(n.depth) } });
    row.style.setProperty('--depth', String(n.depth));
    if (n.type === 'deckOffset') { row.style.display = 'none'; return row; }
    if (n.type === 'deck') {
      const sel = rowSelected(n);
      row.className = `exam-tree-row deck${sel ? ' sel' : ''}`;
      row.appendChild(el('span', { role: 'button', tabindex: 0, style: 'display:flex;align-items:center;gap:8px;flex:1;cursor:pointer', onclick: () => toggleNode(n) }, [
        icon('cards', 'i16'), el('span.tree-name', {}, [n.name]),
      ]));
      row.appendChild(el('span.tree-count', {}, [String(n.agg?.cards ?? '')]));
      row.tabIndex = 0;
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleNode(n); } });
      return row;
    }
    const open = expanded.has(n.folderId ?? '__root__');
    row.className = `exam-tree-row folder${rowSelected(n) ? ' sel' : ''}`;
    row.appendChild(twistie(open, () => {
      const key = n.folderId ?? '__root__';
      if (expanded.has(key)) expanded.delete(key); else expanded.add(key);
      renderTree();
    }));
    row.appendChild(el('span', { role: 'button', tabindex: 0, style: 'display:flex;align-items:center;gap:8px;flex:1;cursor:pointer', onclick: () => toggleNode(n) }, [
      icon('folder', 'i16'), el('span.tree-name', {}, [n.name]),
    ]));
    row.appendChild(el('span.tree-count', {}, [String(n.agg?.cards ?? '')]));
    row.tabIndex = 0;
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleNode(n); } });
    return row;
  }

  function renderTree() {
    if (!treeBox) return;
    treeBox.textContent = '';
    const allRow = el('div.exam-tree-row all', { dataset: { depth: '0' } });
    allRow.className = `exam-tree-row all${rowSelected({ type: 'all' }) ? ' sel' : ''}`;
    allRow.appendChild(el('span', { role: 'button', tabindex: 0, style: 'display:flex;align-items:center;gap:8px;flex:1;cursor:pointer', onclick: () => toggleNode({ type: 'all' }) }, [
      icon('layers', 'i16'), el('span.tree-name', {}, ['Toute la bibliothèque']),
    ]));
    allRow.appendChild(el('span.tree-count', {}, [String(overview.totalCards)]));
    treeBox.appendChild(allRow);
    for (const n of overview.nodes) treeBox.appendChild(treeRow(n));
  }

  // ---- compteurs annoncés (réels, recalculés à chaque changement)
  const kpisHost = el('div.prep-kpis', { id: 'exam-kpis' }, [el('span.chip', {}, ['…'])]);

  let pool = { cards: [], statsMap: new Map(), deckNames: new Map() };
  let summary = { byType: {}, byDiff: {}, total: 0 };

  async function refreshPool() {
    if (!treeBox) return;
    pool = cfg.deckIds.size
      ? await poolForDeckIds(cfg.deckIds)
      : { cards: [], statsMap: new Map(), deckNames: new Map() };
    summary = poolSummary(pool.cards, pool.statsMap);
    // un type sans carte disparaît de la sélection — MAIS seulement s'il y a
    // des cartes : un vivier vide (rien de sélectionné) ne doit pas vider les
    // types choisis.
    if (summary.total > 0) {
      for (const t of [...cfg.types]) if (!summary.byType[t]) cfg.types.delete(t);
    }
    renderKpis();
    renderTypePills();
    renderTree();
  }

  function renderKpis() {
    const questionsAnnoncées = Math.min(cfg.count, summary.total);
    const box = el('div.prep-kpis', { id: 'exam-kpis' }, [
      el('span.prep-kpi', { title: 'Decks sélectionnés' }, [icon('cards'), el('span.kpi-num', {}, [String(cfg.deckIds.size)])]),
      el('span.prep-kpi', { title: 'Cartes disponibles dans la sélection' }, [icon('layers'), el('span.kpi-num', {}, [String(summary.total)])]),
      el('span.prep-kpi', { title: 'Questions de l\u2019examen' }, [icon('target'), el('span.kpi-num', {}, [String(questionsAnnoncées)])]),
      el('span.prep-kpi', { title: 'Durée' }, [icon('timer'), el('span.kpi-num', {}, [`${cfg.durationMin} min`])]),
    ]);
    kpisHostEl.replaceWith(box);
    kpisHostEl = box;
  }
  let kpisHostEl = kpisHost;

  const countInput = el('input.text-input', {
    type: 'number', min: '1', max: '200', value: String(cfg.count),
    onchange: (e) => { const v = Math.max(1, Math.min(200, Number(e.target.value) || 1)); cfg.count = v; e.target.value = String(v); renderKpis(); },
  });

  const typePills = el('div.radio-row', { id: 'exam-types' });
  function renderTypePills() {
    typePills.textContent = '';
    for (const t of EXAM_TYPES) {
      const n = summary.byType[t] || 0;
      if (n === 0) continue; // pas de faux bouton : type absent → masqué
      const lab = el('label.radio-pill', {}, [
        el('input', { type: 'checkbox', checked: cfg.types.has(t), onchange: (e) => { if (e.target.checked) cfg.types.add(t); else { cfg.types.delete(t); if (!cfg.types.size) { e.target.checked = true; cfg.types.add(t); toast('Au moins un type de question est nécessaire.', 'info'); } } } }),
        el('span', {}, [`${EXAM_TYPE_LABEL[t]} (${n})`]),
      ]);
      typePills.appendChild(lab);
    }
    if (!typePills.children.length) typePills.appendChild(el('span.dialog-msg', {}, ['Aucun type disponible dans la sélection.']));
  }

  function diffRow() {
    const row = el('div.radio-row');
    DIFFICULTIES.forEach((d) => {
      const label = d === 'toutes' ? 'Toutes' : d.charAt(0).toUpperCase() + d.slice(1);
      row.appendChild(el('label.radio-pill', {}, [
        el('input', { type: 'radio', name: 'exdiff', value: d, checked: cfg.difficulty === d, onchange: () => { cfg.difficulty = d; } }),
        el('span', {}, [label]),
      ]));
    });
    return row;
  }

  function durRow() {
    const row = el('div.radio-row');
    for (const m of [5, 10, 15, 20, 30, 45, 60]) {
      row.appendChild(el('label.radio-pill', {}, [
        el('input', { type: 'radio', name: 'exdur', value: String(m), checked: cfg.durationMin === m, onchange: () => { cfg.durationMin = m; renderKpis(); } }),
        el('span', {}, [`${m} min`]),
      ]));
    }
    return row;
  }

  const shufflePill = el('label.radio-pill', {}, [
    el('input', { type: 'checkbox', checked: cfg.shuffle, onchange: (e) => { cfg.shuffle = e.target.checked; } }),
    icon('swap', 'i16'), el('span', {}, ['Mélanger les questions']),
  ]);

  // ---- bannière de relance
  if (relaunch) {
    viewEl.appendChild(el('div.panel', { style: 'border-color:var(--c-accent-2)' }, [
      el('h3.panel-title', {}, [icon('swap', 'i16'), el('span', {}, ['Relance d\u2019un examen similaire'])]),
      el('p.dialog-msg', {}, ['Les réglages de l\u2019examen précédent sont préremplis. Modifiez-les librement avant de relancer.']),
    ]));
  }

  treeBox = el('div.exam-tree');
  renderTree();

  const startBtn = el('button.btn.btn-primary', { style: 'margin-top:18px;padding:14px 26px;font-size:.95rem', onclick: startExam },
    [icon('target'), el('span', {}, ['Démarrer l\u2019examen'])]);

  viewEl.appendChild(el('div.panel', {}, [
    title,
    el('span.field-label', {}, ['Contenu de l\u2019examen']),
    treeBox,
    el('span.field-label', {}, ['Aperçu']),
    kpisHostEl,
    el('span.field-label', {}, ['Nombre de questions']),
    countInput,
    el('span.field-label', {}, ['Durée de l\u2019examen']),
    durRow(),
    el('span.field-label', {}, ['Niveau de difficulté']),
    diffRow(),
    el('span.field-label', {}, ['Types de questions']),
    typePills,
    el('span.field-label', {}, ['Ordre']),
    shufflePill,
    startBtn,
  ]));

  await refreshPool();

  async function startExam() {
    if (!cfg.deckIds.size) { toast('Sélectionnez au moins un deck.', 'error'); return; }
    const { cards, statsMap, deckNames } = pool;
    const picked = selectQuestions(cards, statsMap, { ...cfg, count: cfg.count });
    if (!picked.length) { toast('Aucune question ne correspond à ces filtres.', 'error'); return; }
    const count = picked.length;
    if (count < cfg.count) toast(`Seulement ${count} question(s) disponibles — examen ajusté.`, 'info');
    const items = buildItems(picked, deckNames);
    const run = {
      config: {
        deckIds: [...cfg.deckIds], count, durationMin: cfg.durationMin,
        difficulty: cfg.difficulty, types: [...cfg.types], shuffle: cfg.shuffle,
      },
      startedAt: Date.now(),
      phase: 'answer',
      current: 0,
      status: 'completed',
      durationMs: 0,
      items,
    };
    saveRun(run);
    sessionStorage.removeItem(RELAUNCH_KEY);
    location.hash = '#/exam/run';
  }
}

// ============================================================ Déroulé

export async function examRunView(viewEl) {
  viewEl.textContent = '';
  const run = loadRun();
  if (!run || !Array.isArray(run.items) || !run.items.length) {
    viewEl.appendChild(el('div.panel', {}, [
      el('h3.panel-title', {}, ['Aucun examen en cours']),
      el('p.dialog-msg', {}, ['Un examen n\u2019a pas été trouvé ou a déjà été clôturé.']),
      el('button.btn.primary', { onclick: () => { location.hash = '#/exam'; } }, [icon('target', 'i16'), el('span', {}, ['Préparer un examen'])]),
    ]));
    return;
  }

  await prefetchBlobUrls(snapshotBlobIds(run.items));

  const timeLimitMs = (run.config.durationMin || 0) * 60000;
  const stage = el('div.review-center');

  const timerChip = el('span.chip.c-cyan', { id: 'exam-timer' }, [icon('timer'), el('span', {}, ['—'])]);
  const remainingChip = el('span.chip', { id: 'exam-remaining' }, [icon('target'), el('span', {}, [''])]);
  const bar = el('div.exam-bar', {}, [el('div.exam-bar-fill', { id: 'exam-bar-fill' })]);
  const grid = el('div.exam-grid', { id: 'exam-grid' });

  const head = el('div.panel', { style: 'padding:12px 16px' }, [
    el('div.btn-row', {}, [
      el('button.btn.btn-sm.ghost', { onclick: quitExam }, [icon('back', 'i16'), el('span', {}, ['Quitter'])]),
      timerChip, remainingChip,
      el('span.progress-note', { id: 'exam-progress' }, ['']),
      el('button.btn.btn-sm', { onclick: finishEarly }, [icon('check', 'i16'), el('span', {}, ['Terminer'])]),
    ]),
    bar, grid,
  ]);
  viewEl.append(head, stage);

  let ended = false;
  let timerInt = null;

  function remainingMs() { return timeLimitMs - (Date.now() - run.startedAt); }

  function tickTimer() {
    if (ended) return;
    const rem = remainingMs();
    if (rem <= 0) {
      timerChip.querySelector('span:last-child').textContent = '00:00';
      endAnswering('expired');
      return;
    }
    const s = Math.ceil(rem / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    timerChip.querySelector('span:last-child').textContent = `${mm}:${ss}`;
    timerChip.classList.toggle('urgent', rem < 60000);
  }

  function updateHead() {
    const answered = run.items.filter((it) => it.answered).length;
    remainingChip.querySelector('span:last-child').textContent = `${run.items.length - answered} restante(s)`;
    document.getElementById('exam-bar-fill')?.style.setProperty('width', `${Math.round((answered / run.items.length) * 100)}%`);
    const pg = viewEl.querySelector('#exam-progress');
    if (pg) pg.textContent = `Question ${run.current + 1} / ${run.items.length}`;
    grid.textContent = '';
    run.items.forEach((it, idx) => {
      const dot = el('button.exam-dot', {
        class: `exam-dot${idx === run.current ? ' current' : ''}${it.answered ? ' answered' : ''}`,
        title: `Question ${idx + 1}${it.answered ? '' : ' (non traitée)'}`,
        onclick: () => { if (ended) return; run.current = idx; saveRun(run); renderQuestion(); },
      }, [String(idx + 1)]);
      grid.appendChild(dot);
    });
  }

  function persistItem() { saveRun(run); updateHead(); }

  // -------------------------------------------------- phase de réponse
  function renderQuestion() {
    if (ended) return;
    const idx = run.current;
    const it = run.items[idx];
    stage.textContent = '';
    updateHead();

    stage.appendChild(el('span.face-label', {}, [
      el('span.dot'),
      el('span', {}, [`QUESTION ${idx + 1} / ${run.items.length} — ${EXAM_TYPE_LABEL[it.type] || 'Flashcard'} — ${it.snapshot.deckName || 'Deck'}`]),
    ]));

    const card = el('div.review-card');
    stage.appendChild(card);
    renderBlocks(card, it.snapshot.front || []);

    // saisie de la réponse — composants partagés avec le mode révision
    const inter = typedInteraction(
      { type: it.type, data: it.snapshot.data || {} },
      it.given ?? null,
      (v) => { it.given = v; persistItem(); },
    );
    stage.appendChild(inter.node);

    // navigation
    const nav = el('div.answer-choices', { style: 'margin-top:14px' });
    nav.appendChild(el('button.btn', { disabled: idx === 0, onclick: () => { run.current = idx - 1; saveRun(run); renderQuestion(); } },
      [icon('back', 'i16'), el('span', {}, ['Précédent'])]));
    nav.appendChild(el('button.btn.ghost', { onclick: () => skipQuestion(idx) },
      [el('span', {}, ['Passer'])]));
    if (idx < run.items.length - 1) {
      nav.appendChild(el('button.btn.btn-primary', { onclick: () => nextQuestion(idx) },
        [el('span', {}, ['Suivant']), icon('chevronRight', 'i16')]));
    } else {
      nav.appendChild(el('button.btn.btn-primary', { onclick: () => endAnswering('completed') },
        [icon('check', 'i16'), el('span', {}, ['Terminer l\u2019examen'])]));
    }
    stage.appendChild(nav);
  }

  /** Une question est « traitée » dès qu'une réponse non vide existe. */
  function isAnswered(it) {
    if (it.given == null) return false;
    if (typeof it.given === 'string') return it.given.trim() !== '';
    if (Array.isArray(it.given)) return it.given.length > 0 && it.given.every((g) => g !== '' && g != null);
    return false;
  }

  function syncAnswered(it) { it.answered = isAnswered(it); }

  function nextQuestion(idx) {
    syncAnswered(run.items[idx]);
    if (!run.items[idx].answered) toast('Réponse vide : question non traitée. Vous pourrez y revenir.', 'info');
    run.current = Math.min(idx + 1, run.items.length - 1);
    saveRun(run);
    renderQuestion();
  }

  function skipQuestion(idx) {
    run.items[idx].answered = false; // conservé en « non traité » (modifiable au retour)
    if (idx < run.items.length - 1) run.current = idx + 1;
    saveRun(run);
    renderQuestion();
  }

  async function finishEarly() {
    const ok = await confirmDialog({
      title: 'Terminer l\u2019examen maintenant ?',
      message: 'Les questions non traitées seront comptées comme non répondues. La correction suivra.',
      confirmLabel: 'Terminer',
    });
    if (ok) endAnswering('completed');
  }

  async function quitExam() {
    const ok = await confirmDialog({
      title: 'Abandonner l\u2019examen ?',
      message: 'Cet examen ne sera PAS enregistré et vos réponses seront perdues.',
      confirmLabel: 'Abandonner',
    });
    if (!ok) return;
    ended = true;
    if (timerInt) clearInterval(timerInt);
    clearRun();
    location.hash = '#/exam';
  }

  // -------------------------------------------------- clôture + correction
  function endAnswering(status) {
    if (ended) return;
    ended = true;
    if (timerInt) clearInterval(timerInt);
    for (const it of run.items) {
      syncAnswered(it);
      if (it.answered && AUTO_GRADED.has(it.type)) it.correct = gradeItem(it);
    }
    run.phase = 'correction';
    run.status = status;
    run.durationMs = status === 'expired'
      ? Math.max(0, Math.min(Date.now() - run.startedAt, timeLimitMs))
      : Date.now() - run.startedAt;
    saveRun(run);
    if (status === 'expired') toast('Temps écoulé : l\u2019examen a été clôturé automatiquement.', 'info');
    renderCorrection();
  }

  function pendingCorrection() {
    return run.items.filter((it) => it.answered && !AUTO_GRADED.has(it.type) && it.correct == null);
  }

  function renderCorrection() {
    stage.textContent = '';
    timerChip.style.display = 'none';
    remainingChip.style.display = 'none';
    document.getElementById('exam-bar-fill')?.style.setProperty('width', '100%');
    const pg = viewEl.querySelector('#exam-progress');
    if (pg) pg.textContent = 'Phase de correction';

    if (run.status === 'expired') {
      stage.appendChild(el('span.chip.c-pink', {}, [icon('timer'), el('span', {}, ['Temps écoulé — clôture automatique'])]));
    }

    const pending = pendingCorrection();
    if (!pending.length) return finalize();

    const it = pending[0];
    const idx = run.items.indexOf(it);

    stage.appendChild(el('span.face-label', {}, [
      el('span.dot'),
      el('span', {}, [`CORRECTION — Question ${idx + 1} (${EXAM_TYPE_LABEL[it.type] || 'Flashcard'})`]),
    ]));

    const prompt = el('div.review-card');
    stage.appendChild(prompt);
    renderBlocks(prompt, it.snapshot.front || []);

    if (typeof it.given === 'string' && it.given.trim()) {
      stage.appendChild(el('div.ex-given', {}, [
        el('span.face-label', {}, [el('span.dot'), el('span', {}, ['VOTRE RÉPONSE'])]),
        el('div.review-card', {}, [el('span', {}, [it.given])]),
      ]));
    }

    const expectHost = el('div.ex-given');
    expectHost.appendChild(el('span.face-label', {}, [el('span.dot'), el('span', {}, ['RÉPONSE ATTENDUE'])]));
    const expectCard = el('div.review-card');
    expectHost.appendChild(expectCard);
    if (it.type === 'free' && it.snapshot.data?.answer) {
      renderBlocks(expectCard, it.snapshot.back || []);
      expectCard.appendChild(el('p.dialog-msg', {}, [String(it.snapshot.data.answer)]));
    } else {
      renderBlocks(expectCard, it.snapshot.back || []);
    }
    stage.appendChild(expectHost);

    const actions = el('div.answer-choices', { style: 'margin-top:14px' }, [
      el('button.btn.btn-cyan', { onclick: () => selfAssess(it, true) }, [icon('check'), el('span', {}, ['Trouvé !'])]),
      el('button.btn.btn-danger', { onclick: () => selfAssess(it, false) }, [icon('x'), el('span', {}, ['Pas trouvé'])]),
    ]);
    stage.appendChild(actions);

    function selfAssess(item, correct) {
      item.correct = correct;
      item.points = correct ? 1 : 0;
      saveRun(run);
      renderCorrection();
    }
  }

  async function finalize() {
    try {
      const record = await finalizeExam(run, { status: run.status, durationMs: run.durationMs });
      clearRun();
      location.hash = `#/exam/result/${record.id}`;
    } catch (e) {
      toast(`Erreur d\u2019enregistrement : ${e.message}`, 'error');
    }
  }

  // démarrage
  if (run.phase === 'correction') renderCorrection();
  else {
    renderQuestion();
    timerInt = setInterval(tickTimer, 500);
    tickTimer();
  }

  return () => { if (timerInt) clearInterval(timerInt); ended = true; };
}

// ============================================================ Résultats

export async function examResultView(viewEl, hash) {
  viewEl.textContent = '';
  const m = (hash || '').match(/^#\/exam\/result\/([\w-]+)/);
  const record = m ? await getExam(m[1]) : null;
  if (!record) {
    viewEl.appendChild(el('div.panel', {}, [
      el('h3.panel-title', {}, ['Examen introuvable']),
      el('button.btn.primary', { onclick: () => { location.hash = '#/exam/history'; } }, [el('span', {}, ['Historique des examens'])]),
    ]));
    return;
  }

  await prefetchBlobUrls(snapshotBlobIds(record.items));

  const note20 = gradeOver20(record);
  const c = record.counts;
  const expired = record.status === 'expired';

  const head = el('div.panel', { style: 'text-align:center' }, [
    el('h3.panel-title', {}, [icon(expired ? 'timer' : 'crown', 'i16'), el('span', {}, [expired ? 'Examen clôturé (temps écoulé)' : 'Résultats de l\u2019examen'])]),
    el('div.ex-score', {}, [
      el('span.ex-note', {}, [note20 != null ? `${note20} / 20` : '— / 20']),
      el('span.ex-pct', {}, [record.pct != null ? `${record.pct} % de réussite` : 'Aucune question traitée']),
    ]),
    el('div.btn-row', { style: 'justify-content:center' }, [
      el('span.chip.c-ok', { title: 'Bonnes réponses' }, [icon('check'), el('span', {}, [String(c.correct)])]),
      el('span.chip.c-pink', { title: 'Mauvaises réponses' }, [icon('x'), el('span', {}, [String(c.incorrect)])]),
      el('span.chip', { title: 'Non traitées' }, [icon('clock'), el('span', {}, [String(c.skipped)])]),
      el('span.chip', { title: 'Temps utilisé' }, [icon('timer'), el('span', {}, [fmtDuration(record.durationMs)])]),
      el('span.chip', { title: 'Date' }, [icon('calendar'), el('span', {}, [fmtDateTime(record.createdAt)])]),
    ]),
    el('div.btn-row', { style: 'justify-content:center;margin-top:14px' }, [
      el('button.btn.btn-primary', { onclick: relaunchSimilar }, [icon('swap', 'i16'), el('span', {}, ['Relancer un examen similaire'])]),
      el('button.btn', { onclick: () => { location.hash = '#/exam/history'; } }, [icon('calendar', 'i16'), el('span', {}, ['Historique'])]),
      el('button.btn.ghost', { onclick: () => { location.hash = '#/'; } }, [icon('home', 'i16'), el('span', {}, ['Accueil'])]),
    ]),
  ]);
  viewEl.appendChild(head);

  // notions à retravailler (par deck, à partir des vraies erreurs)
  const wrong = record.items.filter((it) => it.answered && it.correct === false);
  const byDeck = new Map();
  for (const it of wrong) {
    const key = it.snapshot.deckName || it.deckId;
    byDeck.set(key, (byDeck.get(key) || 0) + 1);
  }
  if (byDeck.size) {
    viewEl.appendChild(el('div.panel', {}, [
      el('h3.panel-title', {}, [icon('filter', 'i16'), el('span', {}, ['Notions à retravailler'])]),
      el('div.chips-row', {}, [...byDeck.entries()].map(([deck, n]) =>
        el('span.chip.c-pink', {}, [icon('target'), el('span', {}, [`${deck} (${n})`])])),
      ),
    ]));
  }

  // questions réussies / échouées / non traitées
  const chipFor = (it, idx, cls, ic) => el('button.chip', { class: cls, title: 'Voir la correction', onclick: () => openCorrection(idx) }, [
    icon(ic), el('span', {}, [`Q${idx + 1} · ${it.snapshot.deckName || ''}`]),
  ]);
  const okItems = record.items.map((it, idx) => ({ it, idx })).filter(({ it }) => it.answered && it.correct === true);
  const skipItems = record.items.map((it, idx) => ({ it, idx })).filter(({ it }) => !it.answered);
  if (okItems.length || wrong.length || skipItems.length) {
    viewEl.appendChild(el('div.panel', {}, [
      el('h3.panel-title', {}, [icon('cards', 'i16'), el('span', {}, ['Questions'])]),
      okItems.length ? el('div.chips-row', {}, okItems.map(({ it, idx }) => chipFor(it, idx, 'chip c-ok', 'check'))) : null,
      wrong.length ? el('div.chips-row', { style: 'margin-top:8px' }, wrong.map((it) => chipFor(it, record.items.indexOf(it), 'chip c-pink', 'x'))) : null,
      skipItems.length ? el('div.chips-row', { style: 'margin-top:8px' }, skipItems.map(({ it, idx }) => chipFor(it, idx, 'chip', 'clock'))) : null,
    ]));
  }

  // correction détaillée
  const corr = el('div.panel', { id: 'ex-corr' }, [
    el('h3.panel-title', {}, [icon('eye', 'i16'), el('span', {}, ['Correction détaillée'])]),
  ]);
  record.items.forEach((it, idx) => {
    const details = el('details.ex-corr-item', { dataset: { idx: String(idx) } });
    const cls = !it.answered ? '' : it.correct ? 'ok' : 'ko';
    const st = !it.answered ? 'Non traitée' : it.correct ? 'Réussie' : 'Échouée';
    details.appendChild(el('summary', {}, [
      el('span.chip', { class: !it.answered ? '' : it.correct ? 'chip c-ok' : 'chip c-pink' }, [String(`Q${idx + 1} · ${st}`)]),
      el('span', {}, [it.snapshot.deckName || '']),
    ]));
    const body = el('div.ex-corr-body');
    const q = el('div.review-card');
    body.appendChild(q);
    renderBlocks(q, it.snapshot.front || []);
    if (it.answered) {
      body.appendChild(el('div.ex-given', {}, [
        el('span.face-label', {}, [el('span.dot'), el('span', {}, ['VOTRE RÉPONSE'])]),
        el('div.review-card', {}, [el('span', {}, [givenLabel(it)])]),
      ]));
    }
    body.appendChild(el('div.ex-given', {}, [
      el('span.face-label', {}, [el('span.dot'), el('span', {}, ['RÉPONSE ATTENDUE'])]),
      expectedNode(it),
    ]));
    details.appendChild(body);
    corr.appendChild(details);
  });
  viewEl.appendChild(corr);

  function openCorrection(idx) {
    const node = corr.querySelector(`details[data-idx="${idx}"]`);
    if (node) { node.open = true; node.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }

  function relaunchSimilar() {
    sessionStorage.setItem(RELAUNCH_KEY, JSON.stringify(record.config));
    location.hash = '#/exam';
  }
}

function givenLabel(it) {
  const g = it.given;
  if (g == null) return '—';
  if (typeof g === 'string') return g;
  if (Array.isArray(g)) {
    if (it.type === 'qcm') {
      const opts = it.snapshot.data?.options || [];
      return g.map((i) => opts[i]?.text ?? '?').join(' · ') || '—';
    }
    if (it.type === 'match') return g.map((v, i) => `${it.snapshot.data?.pairs?.[i]?.left ?? i} → ${v || '?'}`).join(' · ');
    return g.join(' · ') || '—';
  }
  return String(g);
}

/** Bloc « réponse attendue » d'un item (avec les blocs attendus si pertinents). */
function expectedNode(it) {
  const host = el('div');
  const card = el('div.review-card');
  host.appendChild(card);
  if (it.type === 'qcm') {
    const opts = (it.snapshot.data?.options || []).filter((o) => o.correct).map((o) => o.text);
    card.appendChild(el('span', {}, [opts.join(' · ') || '—']));
  } else if (it.type === 'cloze') {
    card.appendChild(el('span', {}, [(it.snapshot.data?.holes || []).map((h) => h.answers.join(' / ')).join(' · ') || '—']));
  } else if (it.type === 'calc') {
    const d = it.snapshot.data || {};
    const tol = Number(d.tolerance) ? ` (tolérance ± ${d.tolerance})` : '';
    card.appendChild(el('span', {}, [`${d.answer ?? '—'}${tol}`]));
  } else if (it.type === 'match') {
    card.appendChild(el('span', {}, [(it.snapshot.data?.pairs || []).map((p) => `${p.left} → ${p.right}`).join(' · ') || '—']));
  } else {
    renderBlocks(card, it.snapshot.back || []);
    if (it.type === 'free' && it.snapshot.data?.answer) {
      card.appendChild(el('p.dialog-msg', {}, [String(it.snapshot.data.answer)]));
    }
  }
  return host;
}

// ============================================================ Historique

export async function examHistoryView(viewEl) {
  viewEl.textContent = '';
  const exams = await getAllExams();

  const head = el('div.panel', {}, [
    el('h3.panel-title', {}, [icon('calendar', 'i16'), el('span', {}, ['Historique des examens'])]),
  ]);
  viewEl.appendChild(head);

  if (!exams.length) {
    viewEl.appendChild(el('div.panel', {}, [
      el('p.dialog-msg', {}, ['Aucun examen enregistré pour le moment.']),
      el('button.btn.primary', { onclick: () => { location.hash = '#/exam'; } }, [icon('target', 'i16'), el('span', {}, ['Préparer un examen'])]),
    ]));
    return;
  }

  const list = el('div');
  for (const e of exams) {
    const note = gradeOver20(e);
    const expired = e.status === 'expired';
    const row = el('button.exam-hist-row', { onclick: () => { location.hash = `#/exam/result/${e.id}`; } }, [
      el('span.chip', { class: expired ? 'chip c-pink' : 'chip c-ok' }, [icon(expired ? 'timer' : 'crown'), el('span', {}, [note != null ? `${note}/20` : '—'])]),
      el('span.exam-hist-meta', {}, [
        `${e.pct != null ? `${e.pct} %` : '—'} · ${e.counts.correct}✓ ${e.counts.incorrect}✗ ${e.counts.skipped}○ · ${fmtDuration(e.durationMs)}`,
      ]),
      el('span.exam-hist-date', {}, [fmtDateTime(e.createdAt)]),
    ]);
    list.appendChild(row);
  }
  viewEl.appendChild(el('div.panel', {}, [list]));
}
