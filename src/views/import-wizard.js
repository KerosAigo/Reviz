/**
 * Assistant « Générer des révisions » (#/import · #/import/<fileId>).
 *
 * 4 étapes : SOURCE → EXTRACTION → PROPOSITIONS → DESTINATION.
 *
 * Garanties (spécification Phase 6) :
 *  - le fichier source n'est JAMAIS modifié (lecture seule des octets) ;
 *  - le texte extrait est TOUJOURS relu/éditable par l'utilisateur avant
 *    génération ;
 *  - les propositions (règles locales, déterministes) sont éditable et
 *    désactivables une par une, avec la trace de leur phrase source ;
 *  - OCR local inexistant : image sans service configuré = message explicite
 *    + repli collage manuel. Le service externe est facultatif (réglages).
 */
import { el, toast, confirmDialog } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { reroute } from '../ui/reroute.js';
import { folderPickerDialog } from '../ui/folder-picker.js';
import {
  getFile, getBlob, loadAllFiles, loadAllDecks, createDeck, addCard,
  getSettingsBulk, loadFolderTree,
} from '../storage/repo.js';
import { detectType } from '../importer/import-service.js';
import { extractPdfText, ocrViaService, sanitizeExtracted, ENGINE_LABELS } from '../importer/extract.js';
import { generateProposals, KIND_META } from '../importer/generator.js';
import { DEFAULT_SETTINGS } from '../core/constants.js';

const STEP_LABELS = [
  ['upload', 'Source'],
  ['file', 'Extraction'],
  ['sparkle', 'Propositions'],
  ['folderPlus', 'Destination'],
];

export async function importWizardView(viewEl, hash) {
  const fromFile = (hash.match(/^#\/import\/([\w-]+)/) || [])[1] || null;

  const state = {
    step: 'source',
    source: null,        // { name, bytes, mime, fileId, kind:'pdf'|'image' } | { kind:'text', name }
    extraction: null,    // { engine, text, pages? }
    items: [],           // propositions (avec included, éditables)
    dest: { mode: 'new', name: '', folderId: null, deckId: null },
  };

  viewEl.textContent = '';

  const head = el('div.panel', { style: 'margin-bottom:12px' }, [
    el('h3.panel-title', {}, [icon('sparkle'), el('span', {}, ['Générer des révisions'])]),
    el('div.wizard-steps', {}, []),
  ]);
  viewEl.appendChild(head);
  const body = el('div');
  viewEl.appendChild(body);

  drawSteps();
  renderStep();

  function drawSteps() {
    const row = head.querySelector('.wizard-steps');
    row.textContent = '';
    const idx = STEP_LABELS.findIndex((_, i) =>
      ['source', 'extract', 'proposals', 'dest'][i] === state.step);
    STEP_LABELS.forEach(([ic, label], i) => {
      row.appendChild(el('span.wizard-step', { class: i === idx ? 'current' : i < idx ? 'done' : '' }, [
        icon(i < idx ? 'check' : ic, 'i16'),
        el('span', {}, [label]),
      ]));
      if (i < STEP_LABELS.length - 1) row.appendChild(el('span.wizard-sep', {}, ['›']));
    });
  }

  function renderStep() {
    drawSteps();
    body.textContent = '';
    ({ source: sourceStep, extract: extractStep, proposals: proposalsStep, dest: destStep })[state.step]();
  }

  // ------------------------------------------------------------- ÉTAPE 1 : SOURCE
  function sourceStep() {
    const panel = el('div.panel', {}, [el('h3.panel-title', {}, [icon('upload'), el('span', {}, ['Choisir une source'])])]);

    // a) fichiers locaux (PDF / image)
    const b1 = el('button.wizard-card', { onclick: pickFiles }, [
      icon('pdf'), el('span.t', {}, ['PDF ou image']), el('span.d', {}, ['Fichiers de cet appareil']),
    ]);
    // b) ressource déjà importée
    const b2 = el('button.wizard-card', { onclick: showExisting }, [
      icon('folder'), el('span.t', {}, ['Ressource existante']), el('span.d', {}, ['PDF ou image déjà dans la bibliothèque']),
    ]);
    // c) collage manuel
    const b3 = el('button.wizard-card', { onclick: manualText }, [
      icon('edit'), el('span.t', {}, ['Coller un texte']), el('span.d', {}, ['Repli manuel — aucune extraction']),
    ]);
    panel.append(b1, b2, b3);
    const note = el('p.hint', { style: 'margin-top:12px' }, [
      el('span.chip', {}, [icon('info'), el('span', {}, ['Le fichier source n\u2019est jamais modifié — lecture seule'])]),
    ]);
    panel.appendChild(note);
    body.appendChild(panel);
  }

  async function showExisting() {
    const files = (await loadAllFiles()).filter((f) => f.kind === 'pdf' || f.kind === 'image');
    const panel = document.querySelector('.wizard-existing');
    if (panel) panel.remove();
    const box = el('div.panel.wizard-existing', { style: 'margin-top:12px' }, [
      el('h3.panel-title', {}, [icon('folder'), el('span', {}, [`Ressources disponibles (${files.length})`])]),
    ]);
    if (!files.length) {
      box.appendChild(el('p.dialog-msg', {}, ['Aucun PDF ni image dans la bibliothèque.']));
    }
    for (const f of files) {
      const row = el('button.wizard-file', { onclick: () => useExistingResource(f.id) }, [
        icon(f.kind === 'pdf' ? 'pdf' : 'image', 'i18'),
        el('span', {}, [f.name]),
        el('span.chip', {}, [f.kind.toUpperCase()]),
      ]);
      box.appendChild(row);
    }
    body.appendChild(box);
  }

  function pickFiles() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.png,.jpeg,.jpg,.webp';
    input.onchange = async () => {
      const f = input.files[0];
      if (!f) return;
      const bytes = new Uint8Array(await f.arrayBuffer());
      const t = detectType(bytes);
      if (t !== 'pdf' && t !== 'png' && t !== 'jpeg' && t !== 'gif' && t !== 'webp') {
        toast('Fichier non reconnu : PDF ou image attendu (vérification des octets).', 'error');
        return;
      }
      state.source = {
        kind: t === 'pdf' ? 'pdf' : 'image',
        name: f.name, bytes, mime: f.type || 'application/octet-stream', fileId: null,
      };
      state.dest.name = defaultDeckName(f.name);
      state.step = 'extract';
      renderStep();
      runExtraction();
    };
    input.click();
  }

  async function useExistingResource(fileId) {
    const f = await getFile(fileId);
    if (!f) { toast('Ressource introuvable.', 'error'); return; }
    if (f.kind !== 'pdf' && f.kind !== 'image') { toast('Seuls PDF et images sont pris en charge ici.', 'error'); return; }
    const rec = await getBlob(f.blobId);
    if (!rec) { toast('Données de la ressource absentes de la base locale.', 'error'); return; }
    const bytes = rec.bytes instanceof Blob ? new Uint8Array(await rec.bytes.arrayBuffer()) : new Uint8Array(rec.bytes);
    const t = detectType(bytes);
    state.source = { kind: f.kind, name: f.name, bytes, mime: f.mimeType || '', fileId: f.id };
    state.dest.name = defaultDeckName(f.name);
    state.step = 'extract';
    renderStep();
    runExtraction();
  }

  function manualText() {
    state.source = { kind: 'text', name: 'Texte collé' };
    state.extraction = { engine: 'collage-manuel', text: '' };
    state.step = 'extract';
    renderStep();
  }

  function defaultDeckName(fileName) {
    const dot = fileName.lastIndexOf('.');
    return (dot > 0 ? fileName.slice(0, dot) : fileName).slice(0, 60);
  }

  // ------------------------------------------------------------- ÉTAPE 2 : EXTRACTION
  let extracting = false;
  async function runExtraction() {
    if (extracting) return;
    const src = state.source;
    if (!src) return;
    extracting = true;
    const chipZone = document.getElementById('wiz-status');
    if (chipZone) chipZone.textContent = '';
    try {
      if (src.kind === 'pdf') {
        const chip = statusChip('spinner', `Extraction de la couche texte…`, 'info');
        chipZone && chipZone.appendChild(chip);
        const res = await extractPdfText(src.bytes, {
          onProgress: (done, total) => { const s = chip.querySelector('span:last-child'); if (s) s.textContent = `Extraction… page ${done}/${total}`; },
        });
        if (res.empty) {
          toast('Ce PDF n\u2019a aucune couche texte (scan). Collez le texte manuellement ou configurez un service OCR.', 'error', 5000);
        }
        state.extraction = { engine: res.engine, text: sanitizeExtracted(res.text), pages: res.pages };
      } else if (src.kind === 'image') {
        const settings = await getSettingsBulk(['ocrUrl'], { ...DEFAULT_SETTINGS });
        const url = String(settings.ocrUrl || '').trim();
        if (!url) {
          state.extraction = { engine: 'collage-manuel', text: '', warning: 'no-ocr' };
          toast('Aucune OCR locale : collez le texte manuellement ou configurez un service externe (Réglages).', 'error', 5200);
        } else {
          const chip = statusChip('spinner', 'Service OCR externe…', 'info');
          chipZone && chipZone.appendChild(chip);
          const res = await ocrViaService(src.bytes, src.mime, url);
          state.extraction = { engine: res.engine, text: sanitizeExtracted(res.text) };
        }
      }
    } catch (e) {
      state.extraction = { engine: 'collage-manuel', text: '', warning: 'ocr-failed' };
      toast(`Extraction impossible : ${e.message || e}`, 'error', 5200);
    }
    extracting = false;
    renderStep();
  }

  function statusChip(ic, text, kind) {
    return el('span.chip', { class: kind ? `chip ${kind === 'error' ? 'c-pink' : ''}` : 'chip' }, [
      icon(ic, 'i16'), el('span', {}, [text]),
    ]);
  }

  function extractStep() {
    const ex = state.extraction || { engine: 'collage-manuel', text: '' };
    const src = state.source;
    const panel = el('div.panel', {}, [
      el('h3.panel-title', {}, [icon('file'), el('span', {}, ['Texte extrait — À RELIRE'])]),
      el('div.chips-row', { id: 'wiz-status', style: 'margin:8px 0' }, [
        el('span.chip', {}, [icon('info', 'i16'), el('span', {}, [ENGINE_LABELS[ex.engine] || ex.engine])]),
        src && src.kind === 'pdf' && ex.pages ? el('span.chip', {}, [el('span', {}, [`${ex.pages} page(s)`])]) : null,
        ex.text ? el('span.chip', {}, [el('span', {}, [`${ex.text.length} caractères`])]) : null,
      ]),
    ]);

    const ta = el('textarea.text-input.wiz-text', { rows: 14, spellcheck: 'false' });
    ta.value = ex.text || '';
    ta.placeholder = 'Collez ou corrigez ici le texte du document…';
    ta.addEventListener('input', () => { state.extraction.text = ta.value; });
    panel.appendChild(ta);

    if (ex.warning === 'no-ocr' || ex.warning === 'ocr-failed') {
      panel.appendChild(el('div.viewer-warn', {}, [
        icon('info', 'i18'),
        el('div', {}, [
          el('div', {}, ['Aucune OCR n\u2019est exécutée sur cet appareil (aucun moteur embarqué — pas de prétention).']),
          el('div', {}, ['Repli : collez le texte ci-dessus, ou configurez votre propre service dans Réglages → « Service OCR externe ».']),
        ]),
      ]));
    }

    const btns = el('div.btn-row', { style: 'margin-top:12px' }, [
      (src && src.kind === 'pdf') || (src && src.kind === 'image')
        ? el('button.btn', { onclick: runExtraction }, [icon('swap', 'i16'), el('span', {}, ['Ré-extraire'])]) : null,
      el('button.btn', { onclick: () => { state.step = 'source'; state.extraction = null; renderStep(); } },
        [icon('back', 'i16'), el('span', {}, ['Changer de source'])]),
      el('button.btn.btn-primary', { onclick: generate }, [icon('sparkle', 'i16'), el('span', {}, ['Générer les propositions'])]),
    ]);
    panel.appendChild(btns);
    body.appendChild(panel);
  }

  function generate() {
    const text = state.extraction?.text || '';
    if (!text.trim()) { toast('Le texte est vide : collez d\u2019abord un contenu.', 'error'); return; }
    const { items } = generateProposals(text);
    state.items = items.map((it) => ({ ...it, included: true }));
    if (!state.items.length) {
      toast('Aucun motif fiable trouvé dans ce texte (définitions, valeurs, égalités). Complétez ou corrigez le texte puis régénérez.', 'error', 5200);
      return;
    }
    state.step = 'proposals';
    renderStep();
  }

  // ------------------------------------------------------------- ÉTAPE 3 : PROPOSITIONS
  function proposalsStep() {
    const titleSpan = el('span', {}, [`Propositions — ${state.items.filter((i) => i.included).length} retenue(s)`]);
    state.titleSpan = titleSpan;
    const panel = el('div.panel', {}, [
      el('h3.panel-title', {}, [icon('sparkle'), titleSpan]),
      el('div.chips-row', { style: 'margin:8px 0' }, [
        el('span.chip', { title: 'Règles locales explicables (définitions, valeurs, égalités) — ni IA, ni résumé automatique' }, [
          icon('info', 'i16'), el('span', {}, ['Généré par règles locales — à relire']),

        ]),
        el('span.chip', { title: 'Le tirage dépend uniquement du texte : même texte → mêmes propositions' }, [
          el('span', {}, ['Déterministe']),
        ]),
      ]),
    ]);

    const kinds = [...new Set(state.items.map((i) => i.kind))];
    for (const kind of kinds) {
      const meta = KIND_META[kind] || { label: kind, icon: 'note' };
      const group = el('div.wiz-group', {}, [
        el('div.wiz-group-head', {}, [
          icon(meta.icon, 'i16'), el('span', {}, [meta.label]),
        ]),
      ]);
      for (const it of state.items.filter((i) => i.kind === kind)) {
        group.appendChild(itemEditor(it));
      }
      panel.appendChild(group);
    }

    panel.appendChild(el('div.btn-row', { style: 'margin-top:14px' }, [
      el('button.btn.btn-sm', { onclick: toggleAll.bind(null, true) }, [el('span', {}, ['Tout retenir'])]),
      el('button.btn.btn-sm', { onclick: toggleAll.bind(null, false) }, [el('span', {}, ['Tout écarter'])]),
      el('button.btn', { onclick: regenerate }, [icon('swap', 'i16'), el('span', {}, ['Régénérer depuis le texte'])]),
      el('button.btn.btn-primary', { onclick: toDest }, [icon('chevronRight', 'i16'), el('span', {}, ['Continuer'])]),
    ]));
    body.appendChild(panel);
  }

  function toggleAll(v) {
    state.items.forEach((i) => { i.included = v; });
    renderStep();
  }

  function regenerate() {
    void confirmDialog({
      title: 'Régénérer depuis le texte ?',
      message: 'Vos corrections des propositions actuelles seront perdues (le texte relui est conservé).',
      confirmLabel: 'Régénérer',
    }).then((okd) => { if (okd) generate(); });
  }

  function itemEditor(it) {
    const wrap = el('div.wiz-item', {});
    const top = el('div.wiz-item-head', {}, [
      el('input', {
        type: 'checkbox', checked: it.included,
        onchange: (e) => {
          it.included = e.target.checked;
          wrap.classList.toggle('excluded', !it.included);
          if (state.titleSpan) state.titleSpan.textContent = `Propositions — ${state.items.filter((x) => x.included).length} retenue(s)`;
        },
      }),
    ]);
    const title = el('span', {}, [KIND_META[it.kind].label]);
    top.appendChild(title);
    wrap.appendChild(top);

    const area = el('div.wiz-item-body');
    wrap.appendChild(area);

    // éditeurs par type — minimal mais réel
    if (it.kind === 'flash' || it.kind === 'synth') {
      const f = el('input.text-input', { value: it.front || '', placeholder: 'Recto' });
      f.addEventListener('input', () => { it.front = f.value; });
      const b = el('textarea.text-input', { rows: it.kind === 'synth' ? 6 : 3, placeholder: 'Verso' });
      b.value = it.kind === 'synth' ? (it.back || []).join('\n') : (it.back || '');
      b.addEventListener('input', () => { it.back = it.kind === 'synth' ? b.value.split('\n').filter(Boolean) : b.value; });
      area.append(field('Recto', f), field('Verso', b));
    } else if (it.kind === 'qcm') {
      const f = el('input.text-input', { value: it.front || '', placeholder: 'Question' });
      f.addEventListener('input', () => { it.front = f.value; });
      area.appendChild(field('Question', f));
      const optsBox = el('div');
      const drawOpts = () => {
        optsBox.textContent = '';
        (it.data.options || []).forEach((o, oi) => {
          const row = el('div.qcm-edit-row', { style: 'display:flex;gap:6px;margin:4px 0' }, [
            el('input', { type: 'radio', name: `wiz-qcm-${it.id}`, checked: !!o.correct, title: 'Bonne réponse', onchange: () => { it.data.options.forEach((x, xi) => { x.correct = xi === oi; }); drawOpts(); } }),
            el('input.text-input', { value: o.text, style: 'flex:1' }),
            el('button.btn.btn-sm', { title: 'Retirer cette proposition' }, ['✕']),
          ]);
          const txt = row.children[1];
          txt.addEventListener('input', () => { o.text = txt.value; });
          row.children[2].onclick = () => { it.data.options.splice(oi, 1); drawOpts(); };
          optsBox.appendChild(row);
        });
      };
      drawOpts();
      area.append(field('Propositions (cocher la bonne)', optsBox),
        el('button.btn.btn-sm', { style: 'margin-top:4px', onclick: () => { it.data.options.push({ text: '', correct: false }); drawOpts(); } }, [icon('plus', 'i16'), el('span', {}, ['Ajouter'])]));
    } else if (it.kind === 'cloze') {
      const t = el('input.text-input', { value: it.data.text, placeholder: 'Phrase avec {{0}}, {{1}}…' });
      t.addEventListener('input', () => {
        it.data.text = t.value;
        // synchronisation des trous avec les marqueurs (comme dans l'éditeur de carte)
        const found = [...String(t.value).matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
        const max = found.length ? Math.max(...found) : -1;
        while (it.data.holes.length <= max) it.data.holes.push({ answers: [] });
        it.data.holes = it.data.holes.filter((_, i) => found.includes(i));
        drawHoles();
      });
      area.appendChild(field('Phrase à trous', t));
      const holesBox = el('div');
      const drawHoles = () => {
        holesBox.textContent = '';
        it.data.holes.forEach((h, hi) => {
          const inp = el('input.text-input', { value: (h.answers || []).join(' ; '), placeholder: `Réponses acceptées (trou ${hi}) — séparées par « ; »`, style: 'width:100%' });
          inp.addEventListener('input', () => { h.answers = inp.value.split(';').map((x) => x.trim()).filter(Boolean); });
          holesBox.appendChild(el('div', { style: 'margin:4px 0' }, [inp]));
        });
      };
      drawHoles();
      area.appendChild(field('Réponses acceptées', holesBox));
    } else if (it.kind === 'free') {
      const f = el('input.text-input', { value: it.front || '', placeholder: 'Consigne' });
      f.addEventListener('input', () => { it.front = f.value; });
      const r = el('textarea.text-input', { rows: 3, placeholder: 'Réponse de référence (autoévaluation)' });
      r.value = it.data.answer || '';
      r.addEventListener('input', () => { it.data.answer = r.value; });
      area.append(field('Consigne', f), field('Réponse de référence', r));
    } else if (it.kind === 'calc') {
      const f = el('input.text-input', { value: it.front || '', placeholder: 'Énoncé du calcul' });
      f.addEventListener('input', () => { it.front = f.value; });
      const a = el('input.text-input', { value: it.data.answer ?? '', placeholder: 'Réponse', style: 'width:140px' });
      a.addEventListener('input', () => { it.data.answer = a.value; });
      const tol = el('input.text-input', { value: String(it.data.tolerance ?? 0), placeholder: 'Tolérance', style: 'width:100px' });
      tol.addEventListener('input', () => { const v = Number(tol.value.replace(',', '.')); it.data.tolerance = Number.isFinite(v) ? v : 0; });
      area.append(field('Énoncé', f), field('Réponse', el('div', { style: 'display:flex;gap:8px' }, [a, tol])));
    } else if (it.kind === 'match') {
      const pairsBox = el('div');
      const drawPairs = () => {
        pairsBox.textContent = '';
        it.data.pairs.forEach((p, pi) => {
          const l = el('input.text-input', { value: p.left, style: 'flex:1' });
          const r = el('input.text-input', { value: p.right, style: 'flex:1' });
          l.addEventListener('input', () => { p.left = l.value; });
          r.addEventListener('input', () => { p.right = r.value; });
          const row = el('div.qcm-edit-row', { style: 'display:flex;gap:6px;margin:4px 0' }, [l, r,
            el('button.btn.btn-sm', { title: 'Retirer cette paire' }, ['✕'])]);
          row.children[2].onclick = () => { it.data.pairs.splice(pi, 1); drawPairs(); };
          pairsBox.appendChild(row);
        });
      };
      drawPairs();
      area.append(field('Paires (gauche ↔ droite)', pairsBox),
        el('button.btn.btn-sm', { style: 'margin-top:4px', onclick: () => { it.data.pairs.push({ left: '', right: '' }); drawPairs(); } }, [icon('plus', 'i16'), el('span', {}, ['Ajouter une paire'])]));
    }

    // trace honnête de la source
    if (it.why) {
      area.appendChild(el('p.wiz-why', { title: it.why }, [icon('search', 'i14'), el('span', {}, [it.why])]));
    }
    return wrap;
  }

  function field(label, node) {
    return el('div', { style: 'margin:8px 0' }, [
      el('div.field-label', {}, [label]),
      node,
    ]);
  }

  function toDest() {
    if (!state.items.some((i) => i.included)) { toast('Aucune proposition retenue.', 'error'); return; }
    state.step = 'dest';
    renderStep();
  }

  // ------------------------------------------------------------- ÉTAPE 4 : DESTINATION
  let saving = false;
  function destStep() {
    const counts = state.items.filter((i) => i.included).reduce((m, i) => { m[i.kind] = (m[i.kind] || 0) + 1; return m; }, {});
    const panel = el('div.panel', {}, [
      el('h3.panel-title', {}, [icon('folderPlus'), el('span', {}, ['Destination'])]),
      el('div.chips-row', { style: 'margin:8px 0' }, Object.entries(counts).map(([k, n]) =>
        el('span.chip', {}, [el('span', {}, [`${n} ${KIND_META[k].label.toLowerCase()}`])]))),
    ]);

    // mode : nouveau deck / deck existant
    const modeRow = el('div.radio-row', {}, [
      el('label.radio-pill', {}, [
        el('input', { type: 'radio', name: 'wiz-dest', value: 'new', checked: state.dest.mode === 'new', onchange: () => { state.dest.mode = 'new'; renderStep(); } }),
        el('span', {}, ['Nouveau deck']),
      ]),
      el('label.radio-pill', {}, [
        el('input', { type: 'radio', name: 'wiz-dest', value: 'existing', checked: state.dest.mode === 'existing', onchange: () => { state.dest.mode = 'existing'; renderStep(); } }),
        el('span', {}, ['Deck existant']),
      ]),
    ]);
    panel.appendChild(field('Où enregistrer ?', modeRow));

    if (state.dest.mode === 'new') {
      const name = el('input.text-input', { value: state.dest.name || '', placeholder: 'Nom du deck' });
      name.addEventListener('input', () => { state.dest.name = name.value; });
      const folderBtn = el('button.btn', { onclick: pickFolder }, [
        icon('folder', 'i16'), el('span', { id: 'wiz-folder-label' }, [folderLabel()]),
      ]);
      panel.append(field('Nom du deck', name), field('Dossier', folderBtn));
    } else {
      const sel = el('select.text-input', {});
      loadAllDecks().then((decks) => {
        sel.textContent = '';
        sel.appendChild(el('option', { value: '' }, ['— Choisir un deck —']));
        for (const d of decks) sel.appendChild(el('option', { value: d.id }, [d.name]));
        if (state.dest.deckId) sel.value = state.dest.deckId;
      });
      sel.addEventListener('change', () => { state.dest.deckId = sel.value || null; });
      panel.appendChild(field('Deck cible', sel));
    }

    panel.appendChild(el('div.btn-row', { style: 'margin-top:14px' }, [
      el('button.btn', { onclick: () => { state.step = 'proposals'; renderStep(); } }, [icon('back', 'i16'), el('span', {}, ['Retour'])]),
      el('button.btn.btn-primary', { onclick: save }, [icon('check', 'i16'), el('span', {}, ['Enregistrer dans la bibliothèque'])]),
    ]));
    body.appendChild(panel);

    async function pickFolder() {
      const tree = await loadFolderTree();
      const pick = await folderPickerDialog(tree.byParent, {
        allowRoot: true, currentId: state.dest.folderId,
        title: 'Dossier du nouveau deck', actionLabel: 'Choisir',
      });
      if (pick.cancelled) return;
      state.dest.folderId = pick.folderId;
      const treeMap = new Map(tree.folders.map((f) => [f.id, f]));
      state.dest.folderName = state.dest.folderId ? treeMap.get(state.dest.folderId)?.name || '' : '';
      renderStep();
    }

    function folderLabel() {
      return state.dest.folderId ? state.dest.folderName || state.dest.folderId.slice(0, 8) : 'Racine';
    }
  }

  async function save() {
    if (saving) return;
    const included = state.items.filter((i) => i.included);
    if (!included.length) { toast('Aucune proposition retenue.', 'error'); return; }
    let deckId = null;
    try {
      saving = true;
      if (state.dest.mode === 'new') {
        if (!state.dest.name.trim()) { toast('Donnez un nom au nouveau deck.', 'error'); saving = false; return; }
        const { deck } = await createDeck(state.dest.name.trim(), state.dest.folderId, 'Importé depuis un document (assistant)');
        deckId = deck.id;
      } else {
        if (!state.dest.deckId) { toast('Choisissez le deck cible.', 'error'); saving = false; return; }
        deckId = state.dest.deckId;
      }
      let n = 0;
      for (const it of included) {
        // eslint-disable-next-line no-await-in-loop
        await saveItem(deckId, it);
        n++;
      }
      toast(`${n} carte(s) enregistrée(s) dans la bibliothèque.`, 'success');
      location.hash = `#/deck/${deckId}`;
    } catch (e) {
      toast(`Échec de l'enregistrement : ${e.message || e}`, 'error');
    }
    saving = false;
  }

  async function saveItem(deckId, it) {
    const txtBlock = (v) => ({ type: 'text', value: String(v ?? '') });
    switch (it.kind) {
      case 'flash':
        await addCard(deckId, [txtBlock(it.front)], [txtBlock(it.back)]);
        break;
      case 'synth':
        await addCard(deckId, [txtBlock(it.front)], (it.back || []).map(txtBlock));
        break;
      case 'qcm':
      case 'cloze':
      case 'calc':
      case 'match':
      case 'free':
        await addCard(deckId, it.front ? [txtBlock(it.front)] : [], [], { type: it.kind, data: it.data });
        break;
      default:
        await addCard(deckId, [txtBlock(it.front || '')], [txtBlock(it.back || '')]);
    }
  }
}
