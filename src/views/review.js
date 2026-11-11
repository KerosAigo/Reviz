/**
 * Révisions (#/review préparation · #/review/run session).
 *
 * Préparation (spécification §4.4) : source (bibliothèque / dossier / deck),
 * comptes annoncés AVANT lancement (decks, cartes, à réviser), mode
 * (réponse libre / association / alternance), sens, durée du compte à rebours.
 * La session ne démarre qu'après validation explicite.
 *
 * Session (#/review/run) :
 *  - réponse libre chronométrée : compte à rebours lisible (anneau + chiffres),
 *    révélation possible avant la fin, puis « Trouvé ! » / « Pas trouvé » ;
 *  - association : lots adaptés à l'écran, glisser-déposer (Pointer Events) +
 *    tap-tap pour échanger, modification possible avant validation, correction
 *    et score affichés ;
 *  - alternance : les deux modes se succèdent sur la même file de cartes ;
 *  - chaque résultat est écrit immédiatement dans cardStats.
 */
import { el, toast } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { renderBlocks } from '../render/blocks.js';
import { prefetchBlobUrls, getBlobUrl } from '../render/bloburls.js';
import {
  decksForSource, sessionCards, recordCardResult, sessionSettings, batchSizeFor,
  libraryOverview,
} from '../review/engine.js';
import { typedInteraction, isTypedCard, expectedTextOf } from '../review/interactions.js';
import { gradeItem } from '../exam/exam-service.js';
import { planBatches, buildBatch, scoreBatch, swapRights } from '../review/matching.js';
import { dueNowCount } from '../srs/scheduler.js';

const SESSION_KEY = 'reviz.sessionConfig';

// ============================================================ Préparation

export async function reviewPrepView(viewEl) {
  const settings = await sessionSettings();
  let source = { kind: 'all' };
  let mode = settings.defaultFreeMode || 'both';
  let direction = settings.defaultDirection || 'front-to-back';

  const overview = await libraryOverview();
  // dossiers du premier niveau ouverts par défaut (hiérarchie lisible d'emblée)
  const expanded = new Set(
    overview.nodes.filter((n) => n.type === 'folder' && n.depth === 0).map((n) => n.folderId),
  );

  viewEl.textContent = '';

  const title = el('h3.panel-title', {}, [icon('play'), el('span', {}, ['Nouvelle session de révision'])]);

  const infoGrid = el('div.review-prep-grid');

  // --- source : arbre visuel (dossiers + decks, compteurs réels)
  const treeHost = el('div.source-tree', { role: 'tree' });

  const sourceCard = el('div', {}, [
    el('span.field-label', {}, ['Cartes à réviser']),
    treeHost,
  ]);

  function countsPills(agg) {
    const pills = [];
    if (agg) {
      pills.push(el(`span.count-pill${agg.cards ? '' : '.zero'}`, { title: 'Cartes (sous-dossiers compris pour un dossier)' }, [
        icon('cards'), String(agg.cards),
      ]));
      pills.push(el(`span.count-pill${agg.due ? ' due' : '.zero'}`, { title: 'À réviser maintenant' }, [
        icon('clock'), String(agg.due),
      ]));
    }
    return el('span.src-counts', {}, pills);
  }

  function twistie(key, onClick) {
    const open = expanded.has(key);
    // <span> interactif (un <button> imbriqué dans le <button> de ligne est un
    // HTML invalide que les navigateurs recomposent — source du défaut d'affichage)
    const t = el(`span.src-twistie${open ? '.open' : ''}`, {
      role: 'button',
      tabindex: '0',
      title: open ? 'Replier' : 'Déplier',
      'aria-label': open ? 'Replier' : 'Déplier',
    }, [icon('chevronRight', 'i16')]);
    t.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    t.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onClick(); }
    });
    return t;
  }

  function allNode() {
    const n = { type: 'all', name: 'Toute la bibliothèque', agg: { cards: overview.totalCards, due: overview.totalDue } };
    const row = el(`button.src-node.all-node${source.kind === 'all' ? '.selected' : ''}`, {
      role: 'treeitem',
      onclick: () => { source = { kind: 'all' }; renderTree(); refreshCounts(); },
    }, [
      el('span.src-ico', {}, [icon('layers')]),
      el('span.src-name', {}, [n.name]),
      countsPills(n.agg),
    ]);
    return row;
  }

  function folderNode(n) {
    const fid = n.folderId ?? null;
    const selected = source.kind === 'folder' && source.folderId === fid;
    const row = el(`button.src-node.folder-row${selected ? '.selected' : ''}`, {
      role: 'treeitem',
      title: `Dossier : ${n.name} — ${n.agg.cards} carte(s), ${n.agg.due} à réviser`,
      onclick: () => {
        source = { kind: 'folder', folderId: fid };
        renderTree(); refreshCounts();
      },
    }, [
      twistie(n.folderId ?? '__root__', () => {
        const key = n.folderId ?? '__root__';
        if (expanded.has(key)) expanded.delete(key); else expanded.add(key);
        renderTree();
      }),
      el('span.src-ico', {}, [icon('folder')]),
      el('span.src-name', {}, [n.name]),
      countsPills(n.agg),
    ]);
    return row;
  }

  /** En-tête de groupe NON sélectionnable (ex : « Decks hors dossier »). */
  function groupNode(n) {
    const key = '__root__';
    return el('div.src-node.group-row', {}, [
      twistie(key, () => {
        if (expanded.has(key)) expanded.delete(key); else expanded.add(key);
        renderTree();
      }),
      el('span.src-ico', {}, [icon('folder')]),
      el('span.src-name', {}, [n.name]),
      countsPills(n.agg),
    ]);
  }

  function deckNode(n) {
    const selected = source.kind === 'deck' && source.deckId === n.deckId;
    return el(`button.src-node.deck-node${selected ? '.selected' : ''}`, {
      role: 'treeitem',
      title: `Deck : ${n.name} — ${n.agg.cards} carte(s), ${n.agg.due} à réviser`,
      onclick: () => {
        source = { kind: 'deck', deckId: n.deckId };
        renderTree(); refreshCounts();
      },
    }, [
      el('span.src-twistie', {}, []),
      el('span.src-ico', {}, [icon('cards')]),
      el('span.src-name', {}, [n.name]),
      countsPills(n.agg),
    ]);
  }

  function renderTree() {
    treeHost.textContent = '';
    treeHost.appendChild(allNode());
    // liste plate DFS : on masque la descendance des dossiers repliés
    const collapsedStack = []; // ancêtres repliés [{depth}]
    for (const n of overview.nodes) {
      while (collapsedStack.length && collapsedStack[collapsedStack.length - 1] >= n.depth) collapsedStack.pop();
      if (collapsedStack.length) continue; // ancêtre replié : masqué
      if (n.type === 'folder' || n.type === 'deckOffset') {
        const key = n.type === 'deckOffset' ? '__root__' : n.folderId;
        if (!expanded.has(key)) collapsedStack.push(n.depth);
      }
      treeHost.appendChild(
        n.type === 'deck' ? deckNode(n)
          : n.type === 'deckOffset'
            ? groupNode({ ...n, name: 'Decks hors dossier' })
            : folderNode(n),
      );
    }
  }

  // --- mode + sens + durée
  const modeCard = el('div', {}, [
    el('span.field-label', {}, ['Mode']),
    el('div.radio-row', {}, [
      modeRadio('free', 'Réponse libre', 'timer'),
      modeRadio('match', 'Association', 'swap'),
      modeRadio('both', 'Alternance', 'palette'),
    ]),
    el('span.field-label', {}, ['Sens (réponse libre)']),
    el('div.radio-row', {}, [
      dirRadio('front-to-back', 'Recto → Verso'),
      dirRadio('back-to-front', 'Verso → Recto'),
      dirRadio('mixed', 'Mixte'),
    ]),
    el('span.field-label', {}, ['Compte à rebours']),
    countdownRow(),
  ]);

  function modeRadio(kind, label, ic) {
    return el('label.radio-pill', {}, [
      el('input', { type: 'radio', name: 'mode', value: kind, checked: mode === kind, onchange: () => { mode = kind; } }),
      icon(ic, 'i16'), el('span', {}, [label]),
    ]);
  }
  function dirRadio(kind, label) {
    return el('label.radio-pill', {}, [
      el('input', { type: 'radio', name: 'dir', value: kind, checked: direction === kind, onchange: () => { direction = kind; } }),
      el('span', {}, [label]),
    ]);
  }
  function countdownRow() {
    const row = el('div.radio-row');
    for (const s of [5, 10, 20, 30]) {
      row.appendChild(el('label.radio-pill', {}, [
        el('input', { type: 'radio', name: 'cd', value: String(s), checked: settings.countdownSeconds === s, onchange: () => { settings.countdownSeconds = s; } }),
        el('span', {}, [`${s} s`]),
      ]));
    }
    return row;
  }

  // --- comptes annoncés (AVANT lancement — spécification §4.4)
  const countsCard = el('div', {}, [
    el('span.field-label', {}, ['Session annoncée']),
    el('div.prep-kpis', { id: 'prep-counts' }, [el('span.chip', {}, ['…'])]),
  ]);

  async function refreshCounts() {
    const { decks } = await decksForSource(source);
    const ids = decks.map((d) => d.id);
    const { cards, statsMap } = ids.length ? await sessionCards(ids, Number.MAX_SAFE_INTEGER) : { cards: [], statsMap: new Map() };
    const due = dueNowCount(cards, statsMap);
    const kpis = el('div.prep-kpis', { id: 'prep-counts' }, [
      el('span.prep-kpi', { title: 'Decks de la source' }, [
        icon('folder'), el('span.kpi-num', {}, [String(decks.length)]),
      ]),
      el('span.prep-kpi', { title: 'Cartes au total' }, [
        icon('cards'), el('span.kpi-num', {}, [String(cards.length)]),
      ]),
      el(`span.prep-kpi${due ? ' hot' : ''}`, { title: 'À réviser maintenant' }, [
        icon('clock'), el('span.kpi-num', {}, [String(due)]),
      ]),
      el('span.prep-kpi', { title: 'Plafond de cartes par session (réglable dans Réglages)' }, [
        icon('timer'), el('span.kpi-num', {}, [String(settings.maxCardsPerSession)]),
      ]),
    ]);
    const old = viewEl.querySelector('#prep-counts');
    old.replaceWith(kpis);
  }

  infoGrid.append(sourceCard, modeCard, countsCard);

  const startBtn = el('button.btn.btn-primary', { style: 'margin-top:18px;padding:14px 26px;font-size:.95rem', onclick: startSession },
    [icon('play'), el('span', {}, ['Démarrer la session'])]);

  viewEl.appendChild(el('div.panel', {}, [title, infoGrid, startBtn]));

  async function startSession() {
    if (source.kind === 'deck' && !source.deckId) { toast('Aucun deck disponible : créez ou importez un deck.', 'error'); return; }
    const { decks } = await decksForSource(source);
    if (!decks.length) { toast('Cette source ne contient aucun deck.', 'error'); return; }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ source, mode, direction, countdownSeconds: settings.countdownSeconds }));
    location.hash = '#/review/run';
  }

  renderTree();
  await refreshCounts();
}

// ============================================================ Session

export async function reviewSessionView(viewEl) {
  let config;
  try { config = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (_) { config = null; }
  viewEl.textContent = '';
  if (!config) {
    viewEl.appendChild(el('div.panel', {}, [
      el('h3.panel-title', {}, ['Aucune session configurée']),
      el('button.btn.primary', { onclick: () => { location.hash = '#/review'; } }, ['Préparer une session']),
    ]));
    return;
  }

  const settings = await sessionSettings();
  settings.countdownSeconds = config.countdownSeconds || settings.countdownSeconds;

  const { decks } = await decksForSource(config.source);
  const { cards } = await sessionCards(decks.map((d) => d.id), settings.maxCardsPerSession);

  if (!cards.length) {
    viewEl.appendChild(el('div.panel', {}, [
      el('h3.panel-title', {}, ['Rien à réviser']),
      el('p.dialog-msg', {}, ['La source sélectionnée ne contient aucune carte.']),
      el('button.btn.primary', { onclick: () => { location.hash = '#/review'; } }, ['Changer de source']),
    ]));
    return;
  }

  // préchargement des médias de la session (réactivité pendant la session)
  const blobIds = [];
  for (const c of cards) for (const face of [c.front, c.back]) for (const b of face || []) if (b.blobId) blobIds.push(b.blobId);
  await prefetchBlobUrls(blobIds);

  // file de segments : {type:'free', card} | {type:'match', batch}
  const queue = buildQueue(cards, config.mode, batchSizeFor(settings));
  let segIndex = 0;
  const tally = { correct: 0, incorrect: 0 };

  const stage = el('div.review-center');
  const head = el('div.panel', { style: 'padding:12px 16px' }, [
    el('div.btn-row', {}, [
      el('button.btn.btn-sm.ghost', { onclick: quitSession }, [icon('back', 'i16'), el('span', {}, ['Quitter'])]),
      el('span.progress-note', { id: 'seg-progress' }, ['']),
      el('span.chip.c-cyan', { id: 'seg-score' }, [icon('check'), el('span', {}, ['0 / 0'])]),
    ]),
  ]);
  viewEl.append(head, stage);

  function updateHead() {
    viewEl.querySelector('#seg-progress').textContent = `Séquence ${segIndex + 1} / ${queue.length} — ${decks.length} deck(s)`;
    viewEl.querySelector('#seg-score span:last-child').textContent = `${tally.correct} / ${tally.correct + tally.incorrect}`;
  }

  function runNext() {
    if (segIndex >= queue.length) return showSummary();
    updateHead();
    const seg = queue[segIndex];
    if (seg.type === 'free') renderFree(seg.card);
    else if (seg.type === 'typed') renderTyped(seg.card);
    else renderMatch(seg.batch);
  }

  // type réel de chaque carte (pour le journal des réponses)
  const typeOfCard = new Map(cards.map((c) => [c.id, c.type || 'basic']));

  async function onResults(results) {
    for (const { cardId, correct } of results) {
      try { await recordCardResult(cardId, correct, Date.now(), typeOfCard.get(cardId)); } catch (e) { toast(`Erreur d'enregistrement : ${e.message}`, 'error'); }
      if (correct) tally.correct++; else tally.incorrect++;
    }
  }

  function advance() { segIndex++; runNext(); }

  // -------------------------------------------------------- réponse libre
  function renderFree(card) {
    stage.textContent = '';
    const promptIsFront = pickDirection(card);
    const promptBlocks = promptIsFront ? card.front : card.back;
    const answerBlocks = promptIsFront ? card.back : card.front;

    const label = el('span.face-label', {}, [el('span.dot'), el('span', {}, [promptIsFront ? 'RECTO' : 'VERSO'])]);
    const promptCard = el('div.review-card');
    const answerHost = el('div', { style: 'display:none' });
    const answerCard = el('div.review-card', { style: 'margin-top:10px' });
    answerHost.appendChild(el('span.face-label', {}, [el('span.dot'), el('span', {}, [promptIsFront ? 'VERSO' : 'RECTO'])]));
    answerHost.appendChild(answerCard);

    const ring = countdownRing(settings.countdownSeconds);
    const revealBtn = el('button.btn.btn-primary', { onclick: reveal }, [icon('eye', 'i16'), el('span', {}, ['Révéler la réponse'])]);
    const actions = el('div.answer-choices', { style: 'display:none' }, [
      el('button.btn.btn-cyan', { onclick: () => answer(true) }, [icon('check'), el('span', {}, ['Trouvé !'])]),
      el('button.btn.btn-danger', { onclick: () => answer(false) }, [icon('x'), el('span', {}, ['Pas trouvé'])]),
    ]);

    stage.append(label, promptCard, ring.root, revealBtn, answerHost, actions);
    renderBlocks(promptCard, promptBlocks);

    let timer = null;
    let revealed = false;

    function reveal() {
      if (revealed) return;
      revealed = true;
      clearInterval(timer);
      ring.stop();
      ring.root.classList.add('done');
      answerHost.style.display = '';
      revealBtn.style.display = 'none';
      actions.style.display = '';
      renderBlocks(answerCard, answerBlocks);
      // réponse de référence d'une carte de type « réponse libre »
      if (card.type === 'free' && card.data && card.data.answer) {
        answerCard.appendChild(el('p.dialog-msg', {}, [String(card.data.answer)]));
      }
    }

    timer = setInterval(() => {
      const done = ring.tick();
      if (done) reveal(); // délai expiré → la réponse reste consultable
    }, 100);

    async function answer(correct) {
      clearInterval(timer);
      revealBtn.disabled = true;
      for (const b of actions.children) b.disabled = true;
      await onResults([{ cardId: card.id, correct }]);
      const chip = el('span.chip', { class: correct ? 'chip c-ok' : 'chip c-pink' }, [
        icon(correct ? 'check' : 'x'),
        el('span', {}, [correct ? 'Enregistré : trouvé' : 'Enregistré : pas trouvé']),
      ]);
      chip.style.marginTop = '10px';
      stage.appendChild(chip);
      setTimeout(advance, 650);
    }
  }

  // -------------------------------------------------------- question typée
  /**
   * QCM / texte à trous / calcul : correction IMMÉDIATE (mode révision).
   * Réponse libre typée : même flux que la flashcard (autoévaluation) avec
   * la réponse de référence affichée après révélation.
   */
  function renderTyped(card) {
    if (card.type === 'free') return renderFree(card); // autoévaluation + référence
    if (card.type === 'match') return renderTypedMatch(card);

    stage.textContent = '';
    const TYPE_LABEL = { qcm: 'QCM', cloze: 'TEXTE À TROUS', calc: 'CALCUL' };
    stage.appendChild(el('span.face-label', {}, [
      el('span.dot'),
      el('span', {}, [TYPE_LABEL[card.type] || 'QUESTION']),
    ]));

    const promptCard = el('div.review-card');
    stage.appendChild(promptCard);
    renderBlocks(promptCard, card.front || []);

    const inter = typedInteraction(card, null, null);
    stage.appendChild(inter.node);

    const checkBtn = el('button.btn.btn-primary', { onclick: check, style: 'margin-top:12px' },
      [icon('check', 'i16'), el('span', {}, ['Valider'])]);
    stage.appendChild(checkBtn);

    async function check() {
      const given = inter.read();
      if (!inter.answered()) { toast('Réponse incomplète.', 'info'); return; }
      const correct = gradeItem({ type: card.type, snapshot: { data: card.data }, given });
      inter.revealCorrect(correct);
      checkBtn.disabled = true;
      await onResults([{ cardId: card.id, correct }]);
      const chip = el('span.chip', { class: correct ? 'chip c-ok' : 'chip c-pink' }, [
        icon(correct ? 'check' : 'x'),
        el('span', {}, [correct ? 'Correct !' : 'Incorrect — la réponse attendue est surlignée']),
      ]);
      chip.style.marginTop = '10px';
      stage.appendChild(chip);
      const isLast = segIndex === queue.length - 1;
      stage.appendChild(el('div.match-validation', {}, [
        el('button.btn.btn-cyan', { onclick: advance }, [icon('play'), el('span', {}, [isLast ? 'Voir le récapitulatif' : 'Question suivante'])]),
      ]));
    }
  }

  /**
   * Carte de type « association » : réutilise le plateau d'association
   * existant (glisser-déposer + tap-tap) avec les paires DE la carte.
   * Résultat : une seule ligne de résultat pour la carte entière.
   */
  function renderTypedMatch(card) {
    const pairs = (card.data && card.data.pairs) || [];
    const pseudo = pairs.map((p, i) => ({
      id: `${card.id}#${i}`,
      front: [{ type: 'text', value: String(p.left) }],
      back: [{ type: 'text', value: String(p.right) }],
    }));
    const batch = buildBatch(pseudo);
    renderMatch(batch, (result) => [{
      cardId: card.id,
      correct: result.attempts > 0 && result.correct.length === result.attempts,
    }]);
  }

  function pickDirection(card) {
    if (config.direction === 'back-to-front') return false;
    if (config.direction === 'mixed') {
      const s = (card.id || '').charCodeAt(0) + Date.now() % 2;
      return s % 2 === 0; // déterministe par carte + variation de session
    }
    return true;
  }

  // -------------------------------------------------------- association
  function renderMatch(batch, resultsMapper = null) {
    stage.textContent = '';
    let rows = batch.pairs.map((p, i) => ({ leftId: batch.leftOrder[i], rightId: batch.rightOrder[i] }));
    let validated = false;
    let selectedRow = null; // ligne du cellule droite sélectionnée (tap)

    const board = el('div.match-board');
    const boardWrap = el('div', { style: 'position:relative;width:100%;display:flex;justify-content:center' }, [board]);
    const validateBtn = el('button.btn.btn-primary', { onclick: validate }, [icon('check'), el('span', {}, ['Valider la série'])]);
    const scoreNote = el('span.progress-note', {}, [`${batch.pairs.length} paires — glissez ou tapez deux cellules de droite pour les échanger`]);
    stage.append(el('span.face-label', {}, [el('span.dot'), el('span', {}, ['ASSOCIATION'])]), boardWrap, scoreNote, validateBtn);

    const cellsLeft = new Map();  // cardId → element
    const cellsRight = new Map();

    function draw() {
      board.textContent = '';
      cellsLeft.clear(); cellsRight.clear();
      rows.forEach((row, i) => {
        const pair = batch.pairs.find((p) => p.cardId === row.leftId);
        const rightPair = batch.pairs.find((p) => p.cardId === row.rightId);
        const num = el('span.line-num', {}, [String(i + 1)]);
        const leftCell = el('div.match-cell.grabbable', { style: 'position:relative' }, [num]);
        const hostL = el('div'); leftCell.appendChild(hostL); renderBlocks(hostL, pair.front);
        const rightCell = el('div.match-cell.grabbable');
        const hostR = el('div'); rightCell.appendChild(hostR); renderBlocks(hostR, rightPair.back);

        leftCell.dataset.cardId = row.leftId;
        rightCell.dataset.cardId = row.rightId;
        rightCell.dataset.rowIndex = String(i);
        attachPointer(rightCell, i);
        cellsLeft.set(row.leftId, leftCell);
        cellsRight.set(row.rightId, rightCell);
        board.appendChild(el('div.match-row', {}, [leftCell, rightCell]));
      });
    }
    draw();

    function attachPointer(cell, rowIndex) {
      let startX = 0, startY = 0, dragging = false, ghost = null, overRow = null;
      cell.addEventListener('pointerdown', (e) => {
        if (validated) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        startX = e.clientX; startY = e.clientY;
        try { cell.setPointerCapture(e.pointerId); } catch (_) { /* pointer synthétique ou déjà relâché */ }
        const move = (ev) => {
          if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 8) {
            dragging = true;
            cell.classList.add('dragging');
            ghost = el('div.drag-ghost', {}, [cell.cloneNode(true)]);
            document.body.appendChild(ghost);
          }
          if (dragging) {
            ghost.style.left = `${ev.clientX}px`;
            ghost.style.top = `${ev.clientY}px`;
            const target = dropRowFor(ev.clientX, ev.clientY, rowIndex);
            highlight(target);
          }
        };
        const up = (ev) => {
          cell.removeEventListener('pointermove', move);
          cell.removeEventListener('pointerup', up);
          cell.removeEventListener('pointercancel', up);
          if (dragging) {
            dragging = false;
            cell.classList.remove('dragging');
            ghost?.remove(); ghost = null;
            const target = dropRowFor(ev.clientX, ev.clientY, rowIndex);
            highlight(null);
            if (target != null && target !== rowIndex) {
              rows = swapRights(rows, rowIndex, target);
              selectedRow = null;
              draw();
            }
          } else {
            tapSelect(rowIndex);
          }
        };
        cell.addEventListener('pointermove', move);
        cell.addEventListener('pointerup', up);
        cell.addEventListener('pointercancel', up);
      });
    }

    function dropRowFor(x, y, originRow) {
      const els = document.elementsFromPoint(x, y);
      for (const e2 of els) {
        const cell = e2.closest?.('.match-cell');
        if (cell && cell.dataset.cardId !== undefined) {
          const idx = Number(cell.dataset.rowIndex);
          if (!Number.isNaN(idx) && idx !== originRow) return idx;
        }
        const rowEl = e2.closest?.('.match-row');
        if (rowEl) {
          const idx = [...board.querySelectorAll('.match-row')].indexOf(rowEl);
          if (idx >= 0 && idx !== originRow) return idx;
        }
      }
      return null;
    }

    function highlight(idx) {
      board.querySelectorAll('.match-cell.drop-target').forEach((c) => c.classList.remove('drop-target'));
      if (idx == null) return;
      const row = board.querySelectorAll('.match-row')[idx];
      row?.querySelectorAll('.match-cell').forEach((c) => c.classList.add('drop-target'));
    }

    function tapSelect(rowIndex) {
      if (selectedRow == null) {
        selectedRow = rowIndex;
        cellsRight.get(rows[rowIndex].rightId)?.classList.add('drop-target');
      } else if (selectedRow === rowIndex) {
        selectedRow = null;
        draw();
      } else {
        rows = swapRights(rows, selectedRow, rowIndex);
        selectedRow = null;
        draw();
      }
    }

    async function validate() {
      if (validated) return;
      validated = true;
      const result = scoreBatch(batch, rows);
      // coloration + score
      rows.forEach((row) => {
        const ok = result.correct.includes(row.leftId);
        const lc = cellsLeft.get(row.leftId); const rc = cellsRight.get(row.rightId);
        lc?.classList.add(ok ? 'correct' : 'incorrect');
        rc?.classList.add(ok ? 'correct' : 'incorrect');
        lc?.classList.remove('grabbable'); rc?.classList.remove('grabbable');
      });
      validateBtn.remove();
      scoreNote.textContent = `Score de la série : ${result.correct.length} / ${result.attempts} (${result.pct} %)`;
      const perCard = [
        ...result.correct.map((cardId) => ({ cardId, correct: true })),
        ...result.incorrect.map((cardId) => ({ cardId, correct: false })),
      ];
      await onResults(resultsMapper ? resultsMapper(result) : perCard);
      const isLast = segIndex === queue.length - 1;
      stage.appendChild(el('div.match-validation', {}, [
        el('button.btn.btn-cyan', { onclick: advance }, [icon('play'), el('span', {}, [isLast ? 'Voir le récapitulatif' : 'Série suivante'])]),
      ]));
    }
  }

  // -------------------------------------------------------- fin de session
  function showSummary() {
    stage.textContent = '';
    viewEl.querySelector('#seg-progress').textContent = 'Session terminée';
    const total = tally.correct + tally.incorrect;
    const pct = total ? Math.round((tally.correct / total) * 100) : null;
    stage.appendChild(el('div.session-over', {}, [
      el('span.chip.c-gold.score-chip', {}, [icon('crown'), el('span', {}, [`Session terminée — ${tally.correct} / ${total}${pct != null ? ` (${pct} %)` : ''}`])]),
      el('p.dialog-msg', {}, ['Résultats enregistrés — les cartes ratées reviendront plus tôt.']),
      el('div.btn-row', { style: 'justify-content:center' }, [
        el('button.btn.btn-primary', { onclick: () => { location.hash = '#/review'; } }, [icon('play'), el('span', {}, ['Nouvelle session'])]),
        el('button.btn', { onclick: () => { location.hash = '#/stats'; } }, [icon('chart'), el('span', {}, ['Voir les statistiques'])]),
      ]),
    ]));
  }

  function quitSession() {
    if (tally.correct + tally.incorrect > 0) toast('Résultats déjà enregistrés conservés.', 'info');
    location.hash = '#/review';
  }

  runNext();
}

// ============================================================ File de segments

function buildQueue(cards, mode, batchSize) {
  const typed = (c) => isTypedCard(c);
  const posOf = new Map(cards.map((c, i) => [c, i]));
  const basics = cards.filter((c) => !typed(c));

  // segments « classiques » (position d'origine conservée pour l'insertion)
  const segs = [];
  if (mode === 'match') {
    for (const batch of planBatches(basics, batchSize)) {
      if (batch.length >= 2) segs.push({ at: posOf.get(batch[0]), type: 'match', batch: buildBatch(batch) });
      else if (batch.length) segs.push({ at: posOf.get(batch[0]), type: 'free', card: batch[0] });
    }
  } else if (mode === 'free') {
    for (const c of basics) segs.push({ at: posOf.get(c), type: 'free', card: c });
  } else {
    // alternance : 1 réponse libre, puis 1 lot d'association, etc.
    // (l'alternance opère uniquement sur les cartes classiques)
    let i = 0;
    let turn = 0;
    while (i < basics.length) {
      if (turn % 2 === 0) {
        segs.push({ at: posOf.get(basics[i]), type: 'free', card: basics[i++] });
      } else {
        const take = Math.min(batchSize, basics.length - i);
        if (take >= 2) segs.push({ at: posOf.get(basics[i]), type: 'match', batch: buildBatch(basics.slice(i, i + take)) });
        else for (let k = 0; k < take; k++) segs.push({ at: posOf.get(basics[i + k]), type: 'free', card: basics[i + k] });
        i += take;
      }
      turn++;
    }
  }

  // cartes typées (qcm, trous, libre, calcul, association) : chacune son
  // segment, insérée à sa position d'origine — aucune carte n'est perdue.
  const typedSegs = cards
    .map((c, i) => (typed(c) ? { at: i, type: 'typed', card: c } : null))
    .filter(Boolean);

  return [...segs, ...typedSegs]
    .sort((a, b) => a.at - b.at)
    .map((s) => (s.type === 'typed' ? { type: 'typed', card: s.card } : s.type === 'match' ? { type: 'match', batch: s.batch } : { type: 'free', card: s.card }));
}

// ============================================================ Anneau de compte à rebours

function countdownRing(seconds) {
  const R = 36;
  const CIRC = 2 * Math.PI * R;
  const root = el('div.countdown', { role: 'timer', 'aria-label': 'Compte à rebours' });
  root.innerHTML = `
    <svg viewBox="0 0 84 84">
      <circle cx="42" cy="42" r="${R}" fill="rgba(6,9,34,.55)" stroke="rgba(255,255,255,.15)" stroke-width="6"/>
      <circle class="prog" cx="42" cy="42" r="${R}" fill="none" stroke="#19d3e8" stroke-width="6"
        stroke-linecap="round" stroke-dasharray="${CIRC}" stroke-dashoffset="0" transform="rotate(-90 42 42)"/>
    </svg>
    <span class="num">${seconds}</span>`;
  const prog = root.querySelector('.prog');
  const num = root.querySelector('.num');
  const t0 = performance.now();
  const totalMs = seconds * 1000;
  let stopped = false;

  function tick() {
    if (stopped) return true;
    const elapsed = performance.now() - t0;
    const frac = Math.max(0, 1 - elapsed / totalMs);
    prog.setAttribute('stroke-dashoffset', String(CIRC * (1 - frac)));
    num.textContent = String(Math.ceil(frac * seconds));
    root.classList.toggle('warn', elapsed / totalMs > 0.6);
    return elapsed >= totalMs;
  }
  function stop() { stopped = true; }
  return { root, tick, stop };
}
