/**
 * Réglages (#/settings).
 *
 * - Paramètres de session de révision (compte à rebours, plafond de cartes,
 *   tailles de lot d'association, sens et mode par défaut) ;
 * - stockage : estimation réelle via navigator.storage.estimate(), demande de
 *   persistance (navigator.storage.persist) — l'état affiché est celui accordé
 *   par le navigateur, sans valeur inventée ;
 * - sauvegarde complète `.revizbak` (création/téléchargement) et restauration
 *   avec validation puis confirmation explicite AVANT remplacement.
 */
import { el, toast, confirmDialog } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { fmtBytes } from '../core/utils.js';
import { DEFAULT_SETTINGS } from '../core/constants.js';
import { getSettingsBulk, setSetting } from '../storage/repo.js';
import { createBackup, downloadBackup, pickBackupFile, validateBackup, restoreBackup } from '../backup/backup.js';

const SETTINGS_KEYS = [
  'countdownSeconds', 'maxCardsPerSession', 'associationPairsDesktop', 'associationPairsMobile',
  'defaultDirection', 'defaultFreeMode',
];

export async function settingsView(viewEl) {
  const settings = await getSettingsBulk(SETTINGS_KEYS, { ...DEFAULT_SETTINGS });
  viewEl.textContent = '';

  // ---------------------------------------------------------- session
  const sessionPanel = el('div.panel', {}, [
    el('h3.panel-title', {}, [icon('timer'), el('span', {}, ['Révisions'])]),

    countdownBlock(settings),
    numericBlock('Plafond de cartes par session', 'maxCardsPerSession', settings, 1, 500),
    twoCol(
      numericBlock('Lot d\u2019association — ordinateur', 'associationPairsDesktop', settings, 2, 20),
      numericBlock('Lot d\u2019association — téléphone', 'associationPairsMobile', settings, 2, 20),
    ),
    defaultDirectionBlock(settings),
    defaultModeBlock(settings),

    el('div.btn-row', { style: 'margin-top:14px' }, [
      el('button.btn.btn-primary', { onclick: saveSession }, [icon('check'), el('span', {}, ['Enregistrer les réglages'])]),
    ]),
  ]);

  // ---------------------------------------------------------- stockage
  const storagePanel = el('div.panel', {}, [
    el('h3.panel-title', {}, [icon('save'), el('span', {}, ['Stockage'])]),
    el('div.dialog-msg.chips-row', { id: 'storage-info' }, [el('span.chip', {}, ['Calcul…'])]),
    el('p.hint', { title: 'Les données restent dans ce navigateur (IndexedDB). Le navigateur peut les effacer sans prévenir : exportez une sauvegarde régulièrement.' }, [
      el('span.chip', { style: 'border-color:rgba(255,184,0,.45)' }, [icon('info'), el('span', {}, ['Données locales — exportez régulièrement'])]),
    ]),
  ]);
  refreshStorage(storagePanel).catch((e) => {
    const box = storagePanel.querySelector('#storage-info');
    box.textContent = '';
    box.appendChild(el('span.chip', {}, [el('span', {}, [`Estimation indisponible : ${e.message}`])]));
  });

  // ---------------------------------------------------------- OCR externe (facultatif)
  const ocrPanel = el('div.panel', {}, [
    el('h3.panel-title', {}, [icon('search'), el('span', {}, ['Import — OCR externe (facultatif)'])]),
    el('p.dialog-msg', { title: 'Reviz n\u2019embarque aucun moteur OCR : les PDF lisent leur couche texte ; pour une image, c\u2019est ici que ça se règle.' },
      ['Aucun moteur OCR local. Pour les images, vous pouvez indiquer VOTRE service :']),
    el('input.text-input', {
      id: 'ocr-url-input', type: 'url', value: settings.ocrUrl || '',
      placeholder: 'https://… (vide = désactivé)', style: 'margin:6px 0',
      title: 'POST de l\u2019image brute → réponse : texte brut ou JSON {text}. Aucune clé fournie par Reviz.',
    }),
    el('p.hint', {}, [
      el('span.chip', {}, [icon('info'), el('span', {}, ['Requête : POST image → texte ou {text}. Aucune clé fournie par Reviz.'])]),
    ]),
    el('div.btn-row', { style: 'margin-top:10px' }, [
      el('button.btn', { onclick: saveOcrUrl }, [icon('check', 'i16'), el('span', {}, ['Enregistrer l\u2019URL'])]),
    ]),
  ]);

  // ---------------------------------------------------------- sauvegarde
  const backupSummary = el('p.dialog-msg', { style: 'min-height:1.2em' }, ['']);
  const backupPanel = el('div.panel', {}, [
    el('h3.panel-title', {}, [icon('share'), el('span', {}, ['Sauvegarde complète'])]),
    el('p.dialog-msg', { title: 'Contenu complet : dossiers, fichiers, decks, cartes, médias, statistiques et réglages.' },
      ['Format ".revizbak" : tout est inclus.']),
    backupSummary,
    el('div.btn-row', {}, [
      el('button.btn.btn-primary', { onclick: doBackup }, [icon('save'), el('span', {}, ['Créer une sauvegarde'])]),
      el('button.btn' , { onclick: doRestore }, [icon('folder'), el('span', {}, ['Restaurer depuis un fichier…'])]),
    ]),
    el('p.hint', { title: 'La restauration remplace ENTIÈREMENT la base actuelle, après une confirmation récapitulant son contenu.' }, [
      el('span.chip', { style: 'border-color:rgba(255,59,92,.45)' }, [icon('info'), el('span', {}, ['Restaurer = remplacer tout'])]),
    ]),
  ]);

  viewEl.append(sessionPanel, storagePanel, ocrPanel, backupPanel);

  // ---------------------------------------------------------- actions
  async function saveOcrUrl() {
    const input = viewEl.querySelector('#ocr-url-input');
    const v = String(input.value || '').trim();
    if (v && !/^https?:\/\//i.test(v)) {
      toast('URL invalide : doit commencer par http:// ou https://.', 'error');
      return;
    }
    await setSetting('ocrUrl', v);
    settings.ocrUrl = v;
    toast(v ? 'URL du service OCR enregistrée.' : 'Service OCR désactivé (URL vidée).', 'success');
  }
  async function saveSession() {
    const raw = readSessionInputs(viewEl);
    const values = coalesce(raw, settings);
    const bad = [];
    if (!(values.maxCardsPerSession >= 1)) bad.push('plafond de cartes (≥ 1)');
    if (!(values.associationPairsDesktop >= 2)) bad.push('lot association ordinateur (≥ 2)');
    if (!(values.associationPairsMobile >= 2)) bad.push('lot association téléphone (≥ 2)');
    if (bad.length) { toast(`Valeur invalide : ${bad.join(', ')}.`, 'error'); return; }
    for (const [key, value] of Object.entries(values)) {
      // eslint-disable-next-line no-await-in-loop
      await setSetting(key, value);
    }
    Object.assign(settings, values);
    toast('Réglages enregistrés.', 'success');
  }

  async function refreshStorage(panel) {
    const box = panel.querySelector('#storage-info');
    let usage = null;
    let quota = null;
    let persisted = null;
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      usage = est.usage != null ? est.usage : null;
      quota = est.quota != null ? est.quota : null;
    }
    if (navigator.storage?.persisted) persisted = await navigator.storage.persisted();
    box.textContent = '';
    const chips = [];
    if (usage != null) chips.push(el('span.chip.c-cyan', {}, [el('span', {}, [`Utilisé : ${fmtBytes(usage)}`])]));
    if (quota != null) chips.push(el('span.chip', {}, [el('span', {}, [`Quota du navigateur : ${fmtBytes(quota)}`])]));
    if (persisted !== null) {
      chips.push(el('span.chip', { class: persisted ? 'chip c-gold' : 'chip' }, [
        el('span', {}, [persisted ? 'Persistance : activée' : 'Persistance : non demandée']),
      ]));
    }
    if (!chips.length) chips.push(el('span.chip', {}, [el('span', {}, ['Votre navigateur ne fournit pas d\u2019estimation de stockage.'])]));
    for (const c of chips) box.appendChild(c);
    if (persisted === false && navigator.storage?.persist) {
      const reqBtn = el('button.btn.btn-sm', { style: 'margin-top:10px' }, [icon('lock', 'i16'), el('span', {}, ['Demander la persistance des données'])]);
      reqBtn.onclick = async () => {
        const granted = await navigator.storage.persist();
        toast(granted ? 'Persistance accordée par le navigateur.' : 'Refusé par le navigateur — appuyez sur « Installer » ou ajoutez le site aux favoris pour augmenter vos chances.', granted ? 'success' : 'info');
        await refreshStorage(panel);
      };
      panel.appendChild(reqBtn);
    }
  }

  async function doBackup() {
    try {
      const { bytes, summary } = await createBackup();
      downloadBackup(bytes);
      backupSummary.textContent = `Sauvegarde créée : ${summary.folders} dossier(s), ${summary.files} fichier(s), ${summary.decks} deck(s), ${summary.cards} carte(s), ${summary.blobs} média(s), ${summary.stats} historique(s).`;
      toast('Sauvegarde téléchargée.', 'success');
    } catch (e) {
      toast(`Échec de la sauvegarde : ${e.message}`, 'error');
    }
  }

  async function doRestore() {
    const file = await pickBackupFile();
    if (!file) return;
    if (!/\.revizbak$/i.test(file.name)) {
      toast('Ce fichier n\u2019a pas l\u2019extension .revizbak d\u2019une sauvegarde Reviz.', 'error');
      return;
    }
    let validated;
    try {
      validated = await validateBackup(new Uint8Array(await file.arrayBuffer()));
    } catch (e) {
      toast(e.message, 'error');
      return;
    }
    const s = validated.summary;
    const orphanNote = s.orphanRefs.length ? `\n\nATTENTION : ${s.orphanRefs.length} média(s) référencé(s) ne sont pas dans la sauvegarde. Les cartes concernées afficheront un média manquant.` : '';
    const ok = await confirmDialog({
      title: 'Restaurer cette sauvegarde ?',
      message: `Tout le contenu actuel sera REMPLACÉ par la sauvegarde du ${new Date(s.backupDate).toLocaleString('fr-FR')} :\n`
        + `${s.folders} dossier(s), ${s.files} fichier(s), ${s.decks} deck(s), ${s.cards} carte(s), ${s.blobs} média(s), ${s.stats} historique(s).`
        + `${orphanNote}`,
      confirmLabel: 'Tout remplacer',
      cancelLabel: 'Annuler',
      danger: true,
    });
    if (!ok) return;
    try {
      await restoreBackup(validated);
      toast('Restauration terminée. Rechargement…', 'success');
      setTimeout(() => location.reload(), 900);
    } catch (e) {
      toast(`Échec de la restauration (base inchangée) : ${e.message}`, 'error');
    }
  }
}

// ---------------------------------------------------------- blocs d'aide

function countdownBlock(settings) {
  const row = el('div.radio-row');
  row.dataset.key = 'countdownSeconds';
  for (const s of [5, 10, 20, 30]) {
    row.appendChild(el('label.radio-pill', {}, [
      el('input', { type: 'radio', name: 'set-cd', value: String(s), checked: settings.countdownSeconds === s }),
      el('span', {}, [`${s} s`]),
    ]));
  }
  return field('Compte à rebours par défaut', row);
}

function defaultDirectionBlock(settings) {
  const row = el('div.radio-row');
  row.dataset.key = 'defaultDirection';
  for (const [v, label] of [['front-to-back', 'Recto → Verso'], ['back-to-front', 'Verso → Recto'], ['mixed', 'Mixte']]) {
    row.appendChild(el('label.radio-pill', {}, [
      el('input', { type: 'radio', name: 'set-dir', value: v, checked: settings.defaultDirection === v }),
      el('span', {}, [label]),
    ]));
  }
  return field('Sens de révision par défaut', row);
}

function defaultModeBlock(settings) {
  const row = el('div.radio-row');
  row.dataset.key = 'defaultFreeMode';
  for (const [v, label] of [['free', 'Réponse libre'], ['match', 'Association'], ['both', 'Alternance']]) {
    row.appendChild(el('label.radio-pill', {}, [
      el('input', { type: 'radio', name: 'set-mode', value: v, checked: settings.defaultFreeMode === v }),
      el('span', {}, [label]),
    ]));
  }
  return field('Mode proposé par défaut', row);
}

function numericBlock(label, key, settings, min, max) {
  const input = el('input.text-input', {
    type: 'number', min: String(min), max: String(max), value: String(settings[key] ?? ''),
    style: 'max-width:110px',
  });
  input.dataset.key = key;
  return field(label, input);
}

function field(label, control) {
  return el('div', { style: 'margin-bottom:18px' }, [
    el('span.field-label', {}, [label]),
    control,
  ]);
}

function twoCol(a, b) {
  return el('div', { style: 'display:flex;gap:18px;flex-wrap:wrap' }, [a, b]);
}

/** Lit les contrôles du panneau de réglages ; un réglage absent de la liste
 *  radio est conservé tel quel (jamais écrasé par null). */
function readSessionInputs(root) {
  const pick = (name) => root.querySelector(`input[name=${name}]:checked`)?.value;
  const num = (key) => {
    const raw = root.querySelector(`input[data-key=${key}]`)?.value;
    const v = Number(raw);
    return raw != null && raw !== '' && Number.isFinite(v) ? v : null;
  };
  const cd = pick('set-cd');
  const dir = pick('set-dir');
  const mode = pick('set-mode');
  return {
    countdownSeconds: cd ? Number(cd) : null,
    maxCardsPerSession: num('maxCardsPerSession'),
    associationPairsDesktop: num('associationPairsDesktop'),
    associationPairsMobile: num('associationPairsMobile'),
    defaultDirection: dir || null,
    defaultFreeMode: mode || null,
  };
}

/** Fusionne en gardant la valeur actuelle quand un contrôle n'est pas coché. */
function coalesce(values, current) {
  const out = { ...current };
  for (const [k, v] of Object.entries(values)) if (v != null) out[k] = v;
  return out;
}
