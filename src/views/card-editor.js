/**
 * Éditeur de carte (#/card/<deckId>/<cardId|new>).
 *
 * - recto/verso clairement séparés (onglets), rendu final prévisualisable pill ("Aperçu") ;
 * - blocs ordonnés : texte (avec $…$ / $$…$$), LaTeX pur, image, GIF ;
 *   réordonnancement ↕, suppression, types convertibles ;
 * - prévisualisation immédiate pendant la saisie ;
 * - sauvegarde automatique (débouncée) dans IndexedDB à chaque modification.
 */
import { el, toast, confirmDialog } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { getDeck, listCards, putBlob, updateCard } from '../storage/repo.js';
import { renderBlocks } from '../render/blocks.js';
import { latexToString, splitMath } from '../latex/katex-service.js';
import { IMAGE_MIMES } from '../core/constants.js';

/** Types de question et gabarits de données structurée. */
const CARD_TYPES = [
  { id: 'basic', label: 'Flashcard' },
  { id: 'qcm', label: 'QCM' },
  { id: 'cloze', label: 'Texte à trous' },
  { id: 'free', label: 'Réponse libre' },
  { id: 'calc', label: 'Calcul' },
  { id: 'match', label: 'Association' },
];
const DATA_TEMPLATES = {
  qcm: () => ({ options: [{ text: '', correct: true }, { text: '', correct: false }], multi: false }),
  cloze: () => ({ text: '', holes: [] }),
  free: () => ({ answer: '' }),
  calc: () => ({ answer: '', tolerance: 0 }),
  match: () => ({ pairs: [{ left: '', right: '' }, { left: '', right: '' }] }),
};

export async function cardEditorView(viewEl, hash) {
  const m = hash.match(/^#\/card\/([\w-]+)(?:\/([\w-]+))?/) || [];
  const [, deckId, cardId] = m;
  const deck = await getDeck(deckId);
  viewEl.textContent = '';
  if (!deck) {
    viewEl.appendChild(el('div.panel', {}, [el('h3.panel-title', {}, ['Deck introuvable'])]));
    return;
  }

  const cards = await listCards(deck.id);
  let card;
  if (cardId && cardId !== 'new') {
    card = cards.find((c) => c.id === cardId);
    if (!card) {
      viewEl.appendChild(el('div.panel', {}, [el('h3.panel-title', {}, ['Carte introuvable'])]));
      return;
    }
  } else {
    card = { id: null, deckId: deck.id, position: cards.length, front: [], back: [], type: undefined, data: null, createdAt: null, updatedAt: null };
  }

  let face = 'front';          // onglet actif
  let dirty = false;
  let committed = false;
  let saveTimer = null;

  // ------------------------------------------------------------- structure
  const backBtn = el('button.btn.btn-sm.ghost', { onclick: () => finish() }, [icon('back', 'i16'), el('span', {}, ['Retour au deck'])]);

  const faceTabs = el('div.face-tabs');
  const tabFront = el('button.face-tab', {}, [el('span', {}, ['Recto'])]);
  const tabBack = el('button.face-tab', {}, [el('span', {}, ['Verso'])]);
  faceTabs.append(tabFront, tabBack);

  const editorArea = el('div.block-list');
  const addRow = el('div.btn-row', { style: 'margin:10px 0' }, [
    el('button.btn.btn-sm', { onclick: () => addBlock('text') }, [icon('edit', 'i16'), el('span', {}, ['Texte'])]),
    el('button.btn.btn-sm', { onclick: () => addBlock('latex') }, [icon('sparkle', 'i16'), el('span', {}, ['LaTeX'])]),
    el('button.btn.btn-sm', { onclick: () => addBlockMedia('image') }, [icon('image', 'i16'), el('span', {}, ['Image'])]),
    el('button.btn.btn-sm', { onclick: () => addBlockMedia('gif') }, [icon('play', 'i16'), el('span', {}, ['Animation GIF'])]),
  ]);

  const previewBtn = el('button.btn.btn-sm', { onclick: togglePreview }, [icon('eye', 'i16'), el('span', {}, ['Aperçu du rendu'])]);
  const previewHost = el('div.card-face-preview', { style: 'display:none;margin-top:10px' });

  const saveChip = el('span.chip', {}, [icon('save'), el('span', { id: 'save-state' }, ['Enregistré'])]);

  // ------------------------------------------------------------- type de question
  const typePillsRow = el('div.radio-row', { id: 'type-pills' });
  const typeArea = el('div.type-area');
  let currentType = card.type || 'basic';

  function renderTypePills() {
    typePillsRow.textContent = '';
    for (const t of CARD_TYPES) {
      typePillsRow.appendChild(el('label.radio-pill', {}, [
        el('input', {
          type: 'radio', name: 'card-type', value: t.id,
          checked: currentType === t.id,
          onchange: () => switchType(t.id),
        }),
        el('span', {}, [t.label]),
      ]));
    }
  }

  async function switchType(id) {
    if (id === currentType) return;
    const hasContent = card.data && Object.values(card.data).some((v) =>
      Array.isArray(v) ? v.length > 0 : (v ?? '') !== '');
    if (hasContent) {
      const ok = await confirmDialog({
        title: 'Changer le type de la question ?',
        message: 'Les données du type actuel (propositions, trous, paires…) seront perdues.',
        confirmLabel: 'Changer',
      });
      if (!ok) { renderTypePills(); return; }
    }
    currentType = id;
    card.type = id === 'basic' ? undefined : id;
    card.data = id === 'basic' ? null : DATA_TEMPLATES[id]();
    scheduleSave(true);
    renderTypePills();
    renderTypeEditor();
  }

  function renderTypeEditor() {
    typeArea.textContent = '';
    if (currentType === 'basic' || !card.data) return;
    const editors = {
      qcm: renderQcmEditor,
      cloze: renderClozeEditor,
      free: renderFreeEditor,
      calc: renderCalcEditor,
      match: renderMatchEditor,
    };
    (editors[currentType] || (() => {}))();
  }

  function renderQcmEditor() {
    const box = el('div');
    const draw = () => {
      box.textContent = '';
      card.data.options.forEach((o, i) => {
        const row = el('div.qcm-edit-row');
        const inp = el('input.text-input', { placeholder: `Proposition ${i + 1}` });
        inp.value = o.text || '';
        inp.addEventListener('input', () => { o.text = inp.value; scheduleSave(); });
        row.appendChild(inp);
        row.appendChild(el('label.radio-pill.qcm-ok', { title: 'Bonne réponse' }, [
          el('input', { type: 'checkbox', checked: !!o.correct, onchange: (e) => {
            o.correct = e.target.checked;
            if (!card.data.multi && o.correct) {
              card.data.options.forEach((oo, j) => { if (j !== i) oo.correct = false; });
              draw();
            }
            scheduleSave();
          } }),
          icon('check', 'i16'),
        ]));
        row.appendChild(el('button.btn.icon-btn.btn-danger', { title: 'Supprimer la proposition', onclick: async () => {
          if (card.data.options.length <= 2) { toast('Un QCM demande au moins 2 propositions.', 'info'); return; }
          card.data.options.splice(i, 1);
          scheduleSave(true); draw();
        } }, [icon('trash', 'i16')]));
        box.appendChild(row);
      });
    };
    draw();
    typeArea.appendChild(el('span.field-label', {}, ['Propositions']));
    typeArea.appendChild(box);
    typeArea.appendChild(el('div.btn-row', { style: 'margin:8px 0' }, [
      el('button.btn.btn-sm', { onclick: () => {
        if (card.data.options.length >= 8) { toast('8 propositions maximum.', 'info'); return; }
        card.data.options.push({ text: '', correct: false });
        scheduleSave(true); draw();
      } }, [icon('plus', 'i16'), el('span', {}, ['Proposition'])]),
      el('label.radio-pill', {}, [
        el('input', { type: 'checkbox', checked: !!card.data.multi, onchange: (e) => { card.data.multi = e.target.checked; scheduleSave(); } }),
        el('span', {}, ['Plusieurs bonnes réponses']),
      ]),
    ]));
  }

  function renderClozeEditor() {
    const ta = el('textarea.text-input', { placeholder: 'Phrase avec des trous marqués {{0}}, {{1}}…' });
    ta.value = card.data.text || '';
    ta.addEventListener('input', () => { card.data.text = ta.value; syncHoles(); scheduleSave(); renderPreview(); });

    const insertBtn = el('button.btn.btn-sm', { onclick: () => {
      const n = card.data.holes.length;
      const pos = ta.selectionStart ?? ta.value.length;
      ta.value = ta.value.slice(0, pos) + `{{${n}}}` + ta.value.slice(ta.selectionEnd ?? pos);
      card.data.text = ta.value;
      card.data.holes.push({ answers: [] });
      syncHoles();
      scheduleSave(true);
      renderTypeEditor();
    } }, [icon('plus', 'i16'), el('span', {}, ['Ajouter un trou'])]);

    const holesBox = el('div');
    const drawHoles = () => {
      holesBox.textContent = '';
      card.data.holes.forEach((h, i) => {
        const row = el('div.qcm-edit-row');
        const inp = el('input.text-input', { placeholder: 'Réponse(s) acceptée(s), séparées par une virgule' });
        inp.value = (h.answers || []).join(', ');
        inp.addEventListener('input', () => {
          h.answers = inp.value.split(',').map((s) => s.trim()).filter(Boolean);
          scheduleSave();
        });
        row.appendChild(inp);
        row.appendChild(el('button.btn.icon-btn.btn-danger', { title: 'Supprimer ce trou', onclick: () => {
          card.data.holes.splice(i, 1);
          renumberHoles();
          scheduleSave(true);
          renderTypeEditor();
        } }, [icon('trash', 'i16')]));
        holesBox.appendChild(row);
      });
    };
    drawHoles();

    function syncHoles() {
      // auto-création : un marqueur {{n}} tapé à la main doit générer son entrée
      const found = new Set([...String(card.data.text || '').matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])));
      const max = found.size ? Math.max(...found) : -1;
      while (card.data.holes.length <= max) card.data.holes.push({ answers: [] });
      if (found.size) {
        // retirer les trous qui ne sont plus référencés dans le texte
        card.data.holes = card.data.holes.filter((_, i) => found.has(i));
      }
      drawHoles();
    }
    function renumberHoles() {
      // réécrit les marqueurs dans l'ordre d'apparition
      let n = 0;
      card.data.text = String(card.data.text || '').replace(/\{\{\d+\}\}/g, () => `{{${n++}}}`);
    }

    typeArea.appendChild(el('span.field-label', {}, ['Phrase à trous']));
    typeArea.appendChild(ta);
    typeArea.appendChild(el('div.btn-row', { style: 'margin:8px 0' }, [insertBtn]));
    typeArea.appendChild(el('span.field-label', {}, ['Réponses acceptées par trou']));
    typeArea.appendChild(holesBox);
  }

  function renderFreeEditor() {
    const ta = el('textarea.text-input', { placeholder: 'Réponse de référence (éléments attendus)' });
    ta.value = card.data.answer || '';
    ta.addEventListener('input', () => { card.data.answer = ta.value; scheduleSave(); });
    typeArea.appendChild(el('span.field-label', {}, ['Réponse de référence']));
    typeArea.appendChild(ta);
  }

  function renderCalcEditor() {
    const ans = el('input.text-input', { placeholder: 'Réponse exacte (nombre ou expression : 3*sqrt(2))' });
    ans.value = card.data.answer ?? '';
    ans.addEventListener('input', () => { card.data.answer = ans.value; scheduleSave(); });
    const tol = el('input.text-input', { type: 'number', min: '0', step: 'any', placeholder: 'Tolérance (0 = exact)' });
    tol.value = String(card.data.tolerance ?? 0);
    tol.addEventListener('input', () => { card.data.tolerance = Number(tol.value) || 0; scheduleSave(); });
    typeArea.appendChild(el('span.field-label', {}, ['Réponse exacte']));
    typeArea.appendChild(ans);
    typeArea.appendChild(el('span.field-label', {}, ['Tolérance numérique']));
    typeArea.appendChild(tol);
  }

  function renderMatchEditor() {
    const box = el('div');
    const draw = () => {
      box.textContent = '';
      card.data.pairs.forEach((p, i) => {
        const row = el('div.qcm-edit-row');
        const l = el('input.text-input', { placeholder: `Notion ${i + 1} (gauche)` });
        l.value = p.left || '';
        l.addEventListener('input', () => { p.left = l.value; scheduleSave(); });
        const r = el('input.text-input', { placeholder: 'Associe à… (droite)' });
        r.value = p.right || '';
        r.addEventListener('input', () => { p.right = r.value; scheduleSave(); });
        row.append(l, r);
        row.appendChild(el('button.btn.icon-btn.btn-danger', { title: 'Supprimer la paire', onclick: () => {
          if (card.data.pairs.length <= 2) { toast('Une association demande au moins 2 paires.', 'info'); return; }
          card.data.pairs.splice(i, 1);
          scheduleSave(true); draw();
        } }, [icon('trash', 'i16')]));
        box.appendChild(row);
      });
    };
    draw();
    typeArea.appendChild(el('span.field-label', {}, ['Paires']));
    typeArea.appendChild(box);
    typeArea.appendChild(el('div.btn-row', { style: 'margin:8px 0' }, [
      el('button.btn.btn-sm', { onclick: () => {
        if (card.data.pairs.length >= 10) { toast('10 paires maximum.', 'info'); return; }
        card.data.pairs.push({ left: '', right: '' });
        scheduleSave(true); draw();
      } }, [icon('plus', 'i16'), el('span', {}, ['Paire'])]),
    ]));
  }

  renderTypePills();
  renderTypeEditor();

  const panel = el('div.panel', {}, [
    el('div.btn-row', { style: 'margin-bottom:12px' }, [
      backBtn,
      el('span.progress-note', {}, [`Carte ${card.id ? (cards.findIndex((c) => c.id === card.id) + 1) : cards.length + 1} / ${cards.length + (card.id ? 0 : 1)} — ${deck.name}`]),
      saveChip,
    ]),
  ]);

  const editPanel = el('div.panel', {}, [
    el('h3.panel-title', {}, [icon('edit'), el('span', {}, ['Contenu de la carte'])]),
    el('span.field-label', {}, ['Type de question']),
    typePillsRow,
    typeArea,
    faceTabs,
    editorArea,
    addRow,
    el('p.hint', {},
      ['Texte : mélangez librement du texte et des formules avec ', el('code', {}, ['$…$']), ' (en ligne) et ', el('code', {}, ['$$…$$']), ' (bloc).', el('br'),
        'Le bloc LaTeX pur accepte le code LaTeX directement. Images/GIF importés au moment de l\u2019ajout.']),
    el('div.btn-row', { style: 'margin-top:12px' }, [
      previewBtn,
      el('button.btn.btn-sm.btn-danger', { onclick: deleteCardNow }, [icon('trash', 'i16'), el('span', {}, ['Supprimer cette carte'])]),
    ]),
    previewHost,
  ]);

  viewEl.appendChild(panel);
  viewEl.appendChild(editPanel);

  // ------------------------------------------------------------- onglets
  function setActiveFace(f) {
    face = f;
    tabFront.classList.toggle('active', f === 'front');
    tabBack.classList.toggle('active', f === 'back');
    renderEditor();
  }
  tabFront.onclick = () => setActiveFace('front');
  tabBack.onclick = () => setActiveFace('back');
  setActiveFace('front');

  // ------------------------------------------------------------- rendu éditeur
  function renderEditor() {
    editorArea.textContent = '';
    const blocks = card[face];
    if (!blocks.length) {
      editorArea.appendChild(el('div.empty-state', { style: 'padding:14px' }, [el('p', {}, [face === 'front' ? 'Recto vide — ajoutez un bloc ci-dessous.' : 'Verso vide — ajoutez un bloc ci-dessous.'])]));
    }
    blocks.forEach((b, i) => editorArea.appendChild(blockEditor(b, i)));
    renderPreview();
  }

  function blockEditor(block, index) {
    const faceBlocks = card[face];
    const typeSel = el('select.text-input', { onchange: changeType }, [
      el('option', { value: 'text' }, ['Texte']),
      el('option', { value: 'latex' }, ['LaTeX']),
      el('option', { value: 'image' }, ['Image']),
      el('option', { value: 'gif' }, ['GIF']),
    ]);
    typeSel.value = block.type;

    const head = el('div.block-head', {}, [
      el('span.progress-note', {}, [`Bloc ${index + 1}`]),
      typeSel,
      el('span', { style: 'flex:1' }),
      index > 0 ? el('button.btn.icon-btn.order-btn', { title: 'Monter', onclick: () => moveBlock(index, -1) }, [icon('chevronUp', 'i16')]) : null,
      index < faceBlocks.length - 1 ? el('button.btn.icon-btn.order-btn', { title: 'Descendre', onclick: () => moveBlock(index, +1) }, [icon('chevronDown', 'i16')]) : null,
      el('button.btn.icon-btn.btn-danger', { title: 'Supprimer le bloc', onclick: () => removeBlock(index) }, [icon('trash', 'i16')]),
    ]);

    const box = el('div.block-editor', {}, [head]);

    if (block.type === 'text' || block.type === 'latex') {
      const input = el('textarea.text-input', { placeholder: block.type === 'text' ? 'Votre texte. Formules : $…$ ou $$…$$' : '\\frac{a}{b}\\quad x^2\\quad \\vec{F}=m\\vec{a}' });
      input.value = block.value || '';
      input.addEventListener('input', () => {
        block.value = input.value;
        scheduleSave();
        renderPreviewLive();
      });
      const live = el('div.block-preview');
      const grid = el('div.block-preview-grid', {}, [
        input,
        live,
      ]);
      input._live = live;
      box.appendChild(grid);
      renderLive(live, block);
    } else {
      // image/gif
      const img = el('img.blk-media', { alt: block.alt || '', style: 'max-height:130px;margin:0 auto 8px;display:block' });
      const pick = el('button.btn.btn-sm', { onclick: () => pickMedia(block, img) }, [icon('upload', 'i16'), el('span', {}, [block.blobId ? 'Remplacer le média' : 'Choisir un fichier'])]);
      const altInput = el('input.text-input', { placeholder: 'Description de l\u2019image (alt)', value: block.alt || '' });
      altInput.addEventListener('input', () => { block.alt = altInput.value; scheduleSave(); });
      img.dataset.blobId = block.blobId || '';
      const sizeWarn = el('span', { style: 'font-size:.72rem;color:var(--c-text-dim)' }, []);
      box.appendChild(el('div', {}, [img, pick, sizeWarn]));
      box.appendChild(el('span.field-label', {}, ['Alt (accessibilité)']));
      box.appendChild(altInput);
      hydrateImg(img, block);
    }

    return box;

    function changeType(ev) {
      const t = ev.target.value;
      if (t === block.type) return;
      if ((t === 'image' || t === 'gif') && (block.type === 'text' || block.type === 'latex')) {
        // texte → média : nouveau bloc média vierge
        block.type = t;
        block.blobId = block.blobId || null;
        block.alt = block.alt || '';
        delete block.value;
      } else if ((t === 'text' || t === 'latex') && (block.type === 'image' || block.type === 'gif')) {
        block.type = t;
        block.value = block.value || '';
        delete block.blobId;
        delete block.alt;
      } else if (t === 'image' || t === 'gif') {
        block.type = t; // image ↔ gif : média conservé
      } else {
        block.type = t; // text ↔ latex : contenu conservé
      }
      scheduleSave(true);
      renderEditor();
    }
  }

  function renderLive(live, block) {
    live.textContent = '';
    if (block.type === 'latex') {
      live.innerHTML = latexToString(block.value || '', /^\$\$[\s\S]*\$\$$/.test((block.value || '').trim()));
    } else {
      for (const seg of splitMath(block.value || '')) {
        if (seg.type === 'text') live.appendChild(document.createTextNode(seg.value));
        else {
          const span = document.createElement(seg.display ? 'div' : 'span');
          span.className = seg.display ? 'tex-display' : 'tex-inline';
          span.innerHTML = latexToString(seg.value, seg.display);
          live.appendChild(span);
        }
      }
    }
  }

  function renderPreviewLive() {
    // met à jour uniquement les zones live de l'éditeur
    for (const ta of editorArea.querySelectorAll('textarea.text-input')) {
      let blockRef = null;
      const bi = [...editorArea.children].findIndex((c) => c.contains(ta));
      if (bi >= 0) blockRef = card[face][bi];
      if (blockRef) renderLive(ta._live, blockRef);
    }
  }

  function renderPreview() {
    previewHost.textContent = '';
    const label = el('div', { style: 'font-size:.62rem;font-weight:800;letter-spacing:.14em;color:var(--c-text-dim);margin-bottom:8px' }, (
      (face === 'front' ? 'RECTO — RENDU FINAL' : 'VERSO — RENDU FINAL')));
    previewHost.appendChild(label);
    const host = el('div');
    previewHost.appendChild(host);
    renderBlocks(host, card[face]);
  }

  function togglePreview() {
    const hidden = previewHost.style.display === 'none';
    previewHost.style.display = hidden ? 'block' : 'none';
    if (hidden) renderPreview();
  }

  // ------------------------------------------------------------- blocs : opérations
  function addBlock(type) {
    card[face].push(type === 'text' ? { type, value: '' } : { type, value: '' });
    scheduleSave(true);
    renderEditor();
    // focus sur le nouveau champ
    const lastTa = editorArea.querySelector('div.block-editor:last-child textarea');
    if (lastTa) lastTa.focus();
  }

  function addBlockMedia(kind) {
    card[face].push({ type: kind, blobId: null, alt: '' });
    scheduleSave(true);
    renderEditor();
  }

  function moveBlock(index, dir) {
    const blocks = card[face];
    const other = index + dir;
    if (other < 0 || other >= blocks.length) return;
    [blocks[index], blocks[other]] = [blocks[other], blocks[index]];
    scheduleSave();
    renderEditor();
  }

  async function removeBlock(index) {
    const okd = await confirmDialog({ title: 'Supprimer ce bloc ?', message: 'Le contenu de ce bloc (texte, formule ou média) sera perdu.', confirmLabel: 'Supprimer le bloc' });
    if (!okd) return;
    card[face].splice(index, 1);
    scheduleSave(true);
    renderEditor();
  }

  function pickMedia(block, img) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = block.type === 'gif' ? 'image/gif' : [...IMAGE_MIMES].join(',');
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      if (f.size > 20 * 1024 * 1024) { toast('Média trop volumineux (limite 20 Mo par image).', 'error'); return; }
      const bytes = new Uint8Array(await f.arrayBuffer());
      try {
        const mime = block.type === 'gif' ? 'image/gif' : sniff(bytes);
        if (!mime) { toast('Format d\u2019image non reconnu (PNG, JPEG, WebP, GIF).', 'error'); return; }
        if (block.type === 'gif' && mime !== 'image/gif') { toast('Ce fichier n\u2019est pas un GIF.', 'error'); return; }
        const rec = await putBlob(bytes, mime, f.name);
        const prev = block.blobId;
        block.blobId = rec.id;
        block.alt = block.alt || '';
        scheduleSave(true);
        hydrateImg(img, block);
        toast(prev ? 'Média remplacé.' : 'Média ajouté.', 'success');
      } catch (e) {
        toast(e?.message || 'Échec de l\u2019ajout du média.', 'error');
      }
    };
    input.click();
  }

  /** Sniff MIME image par magic bytes (aucune confiance en l'extension). */
  function sniff(bytes) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif';
    if (bytes.length > 11 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
    return null;
  }

  async function hydrateImg(img, block) {
    img.src = '';
    if (!block.blobId) { img.removeAttribute('src'); img.alt = 'Aucun média choisi'; return; }
    const { getBlobUrl } = await import('../render/bloburls.js');
    const url = await getBlobUrl(block.blobId);
    if (url) img.src = url;
    else img.alt = 'média introuvable';
  }

  // ------------------------------------------------------------- sauvegarde
  function scheduleSave(flushSoon = false) {
    dirty = true;
    setSaveState('Modifications en cours…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(commit, flushSoon ? 250 : 800);
  }

  async function commit() {
    if (!dirty) return;
    try {
      if (!card.id) {
        const { addCard } = await import('../storage/repo.js');
        const extra = card.type ? { type: card.type, data: card.data } : {};
        const created = await addCard(deck.id, card.front, card.back, extra);
        card.id = created.id;
        card.position = created.position;
        card.createdAt = created.createdAt;
      } else {
        card.updatedAt = new Date().toISOString();
        await updateCard(card.id, {
          front: card.front, back: card.back, position: card.position,
          type: card.type ?? undefined, data: card.data ?? null,
        });
      }
      dirty = false;
      committed = true;
      setSaveState('Enregistré');
    } catch (e) {
      setSaveState('Échec — resauvegarde…');
      toast(e?.message || 'Échec de l\u2019enregistrement automatique.', 'error');
      setTimeout(() => commit(), 2500); // resauvegarde automatique
    }
  }

  function setSaveState(text) {
    const span = panel.querySelector('#save-state');
    if (span) span.textContent = text;
  }

  async function deleteCardNow() {
    if (!card.id) { toast('Carte non encore enregistrée : rien à supprimer.','info'); return; }
    const okd = await confirmDialog({ title: 'Supprimer cette carte ?', message: 'Historique de révision également effacé.', confirmLabel: 'Supprimer' });
    if (!okd) return;
    clearTimeout(saveTimer); dirty = false;
    const { deleteCard: delCard } = await import('../storage/repo.js');
    await delCard(card);
    toast('Carte supprimée.', 'success');
    location.hash = `#/deck/${deck.id}`;
  }

  /** Retour au deck : sauvegarde immédiate si nécessaire (aucune perte au clic retour). */
  async function finish() {
    if (dirty) { clearTimeout(saveTimer); await commit(); }
    location.hash = `#/deck/${deck.id}`;
  }
  // (finish est lié au bouton retour)
}
