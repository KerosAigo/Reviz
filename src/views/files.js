/**
 * Vue Fichiers : arborescence complète de dossiers et de ressources.
 *
 * Opérations (spécification fonctionnelle §3) :
 *  - créer / renommer / déplacer / supprimer un dossier (cascade confirmée, contenu détaillé) ;
 *  - importer plusieurs fichiers (.reviz, PDF, images, HTML, fiches) ;
 *  - sélection multiple, déplacement multi-fichiers, suppression confirmée ;
 *  - fil d'Ariane et retour aux dossiers parents ;
 *  - menu contextuel par appui long sur mobile.
 */
import { el, toast, confirmDialog, promptDialog, choiceDialog } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { reroute } from '../ui/reroute.js';
import { folderPickerDialog } from '../ui/folder-picker.js';
import {
  loadFolderTree, listChildFiles, createFolder, renameFolder, moveFolder,
  deleteFolderCascade, moveFiles, deleteFiles, getFolder, loadAllFiles, createFile,
} from '../storage/repo.js';
import { importManyFiles, simulationWarning } from '../importer/import-service.js';
import { buildFolderArchive } from '../format/revizlib.js';
import { FILE_KINDS, DEFAULT_SETTINGS } from '../core/constants.js';
import { getSettingsBulk } from '../storage/repo.js';

export async function filesView(viewEl, hash) {
  const folderId = (hash.match(/^#\/files\/([\w-]+)/) || [])[1] || null;

  const [tree, files, allFiles, currentFolder] = await Promise.all([
    loadFolderTree(),
    listChildFiles(folderId),
    loadAllFiles(),
    folderId ? getFolder(folderId) : Promise.resolve(null),
  ]);

  viewEl.textContent = '';

  const selected = new Set();
  let selectionBar = null;
  let gridPanel = null;
  let grid = null;

  // ------------------------------------------------------------- fil d'Ariane
  const map = new Map(tree.folders.map((f) => [f.id, f]));
  const crumbs = el('div.crumbs');
  const rootBtn = document.createElement('button');
  rootBtn.textContent = 'Racine';
  rootBtn.className = !folderId ? 'current' : '';
  rootBtn.onclick = () => { location.hash = '#/files'; };
  crumbs.appendChild(rootBtn);
  if (currentFolder) {
    const chain = [];
    let cur = currentFolder;
    while (cur && guard(chain)) { chain.unshift(cur); cur = cur.parentId ? map.get(cur.parentId) : null; }
    function guard(c) { return c.length < 100; }
    for (const f of chain) {
      crumbs.appendChild(el('span.sep', {}, ['›']));
      const b = document.createElement('button');
      b.textContent = f.name;
      b.className = f.id === folderId ? 'current' : '';
      b.onclick = () => { location.hash = `#/files/${f.id}`; };
      crumbs.appendChild(b);
    }
  }

  // ------------------------------------------------------------- barre d'actions
  const actionsBar = el('div.btn-row', { style: 'margin-bottom:12px' }, [
    el('button.btn.btn-sm', { onclick: newFolder }, [icon('folderPlus', 'i16'), el('span', {}, ['Nouveau dossier'])]),
    currentFolder ? el('button.btn.btn-sm', { onclick: renameCurrent }, [icon('edit', 'i16'), el('span', {}, ['Renommer'])]) : null,
    currentFolder ? el('button.btn.btn-sm', { onclick: moveCurrent }, [icon('swap', 'i16'), el('span', {}, ['Déplacer'])]) : null,
    currentFolder ? el('button.btn.btn-sm.btn-danger', { onclick: deleteCurrent }, [icon('trash', 'i16'), el('span', {}, ['Supprimer'])]) : null,
    currentFolder ? el('button.btn.btn-sm', { onclick: () => exportFolder(currentFolder) }, [icon('download', 'i16'), el('span', {}, ['Exporter (.revizlib)'])]) : null,
    el('button.btn.btn-sm.btn-primary', { onclick: pickImportFiles }, [icon('upload', 'i16'), el('span', {}, ['Importer'])]),
    el('button.btn.btn-sm', { onclick: () => { location.hash = '#/import'; } }, [icon('sparkle', 'i16'), el('span', {}, ['Générer des révisions'])]),
    el('button.btn.btn-sm', { onclick: newFiche }, [icon('note', 'i16'), el('span', {}, ['Fiche'])]),
  ]);

  // ------------------------------------------------------------- sélection
  function toggleSelectArtifact(file, tile) {
    if (selected.has(file.id)) {
      selected.delete(file.id);
      tile.classList.remove('selected');
    } else {
      selected.add(file.id);
      tile.classList.add('selected');
    }
    updateSelectionBar();
  }

  function updateSelectionBar() {
    if (selectionBar) { selectionBar.remove(); selectionBar = null; }
    if (!selected.size) return;
    selectionBar = el('div.selection-bar', {}, [
      el('span', { style: 'font-weight:800;font-size:.85rem' }, [`${selected.size} sélectionné(s)`]),
      el('button.btn.btn-sm', { onclick: selMove }, [icon('swap', 'i16'), el('span', {}, ['Déplacer'])]),
      el('button.btn.btn-sm.btn-danger', { onclick: selDelete }, [icon('trash', 'i16'), el('span', {}, ['Supprimer'])]),
      el('button.btn.btn-sm.ghost', { onclick: () => { selected.clear(); rebuildNow(); } }, ['Annuler']),
    ]);
    gridPanel.insertBefore(selectionBar, actionsBar);
  }

  async function selMove() {
    const fresh = await loadFolderTree();
    const pick = await folderPickerDialog(fresh.byParent, {
      allowRoot: true, currentId: folderId,
      title: `Déplacer ${selected.size} élément(s) vers…`, actionLabel: 'Déplacer',
    });
    if (pick.cancelled) return;
    try {
      await moveFiles([...selected], pick.folderId);
      selected.clear();
      toast('Fichiers déplacés.', 'success');
      rebuildNow(true);
    } catch (e) { toast(e.message, 'error'); }
  }

  async function selDelete() {
    const okd = await confirmDialog({
      title: `Supprimer ${selected.size} fichier(s) ?`,
      message: 'Définitif : les decks supprimés emportent leurs cartes et leurs historiques de révision.',
      confirmLabel: 'Supprimer',
    });
    if (!okd) return;
    await deleteFiles([...selected]);
    selected.clear();
    toast('Fichiers supprimés.', 'success');
    rebuildNow(true);
  }

  // ------------------------------------------------------------- contenu
  const foldersNow = tree.byParent.get(folderId) || [];

  grid = el('div.file-grid');

  for (const folder of foldersNow) {
    grid.appendChild(folderTile(folder));
  }
  for (const file of files) {
    grid.appendChild(fileTile(file));
  }

  gridPanel = el('div.panel', {}, [
    actionsBar,
    crumbs,
    foldersNow.length || files.length
      ? grid
      : el('div.empty-state', {}, [
          icon('folder'),
          el('p', { title: 'Importez des fichiers (.reviz, PDF, images, HTML) ou créez un sous-dossier.' }, ['Dossier vide']),
        ]),
  ]);
  viewEl.appendChild(gridPanel);

  function folderTile(folder) {
    const tile = el('button.file-tile.folder', {}, [
      icon('folder'),
      el('span.name', {}, [folder.name]),
      el('span.meta', {}, ['dossier']),
    ]);
    tile.onclick = () => {
      if (selected.size) { toast('Mode par défaut : pour déplacer un dossier, utilisez « Déplacer ». Désélectionnez d\u2019abord.', 'info'); return; }
      location.hash = `#/files/${folder.id}`;
    };
    attachLongPress(tile, () => folderMenu(folder));
    return tile;
  }

  function folderMenu(folder) {
    choiceDialog({
      title: folder.name,
      options: [
        { id: 'open', label: 'Ouvrir', kind: 'ghost' },
        { id: 'export', label: 'Exporter (.revizlib)' },
        { id: 'rename', label: 'Renommer' },
        { id: 'move', label: 'Déplacer' },
        { id: 'delete', label: 'Supprimer', kind: 'danger' },
      ],
    }).then(async (v) => {
      if (v === 'open') { location.hash = `#/files/${folder.id}`; return; }
      if (v === 'export') { await exportFolder(folder); return; }
      if (v === 'rename') {
        const name = await promptDialog({ title: 'Renommer le dossier', value: folder.name });
        if (name) { await renameFolder(folder.id, name); toast('Dossier renommé.', 'success'); rebuildNow(true); }
        return;
      }
      if (v === 'move') {
        const fresh = await loadFolderTree();
        const pick = await folderPickerDialog(fresh.byParent, {
          allowRoot: true, currentId: folder.parentId,
          title: `Déplacer « ${folder.name} » vers…`, actionLabel: 'Déplacer ici',
        });
        if (!pick.cancelled) {
          try { await moveFolder(folder.id, pick.folderId); toast('Dossier déplacé.', 'success'); rebuildNow(true); }
          catch (e) { toast(e.message, 'error'); }
        }
        return;
      }
      if (v === 'delete') {
        const sub = countSubtree(allFiles, tree, folder.id);
        const okd = await confirmDialog({
          title: `Supprimer « ${folder.name} » ?`,
          message: `Ce dossier contient : ${sub.folders} sous-dossier(s), ${sub.files} fichier(s) (dont decks, cartes, historiques). TOUT sera supprimé. Action définitive.`,
          confirmLabel: 'Tout supprimer',
        });
        if (okd) {
          await deleteFolderCascade(folder.id);
          toast('Dossier supprimé.', 'success');
          rebuildNow(true);
        }
      }
    });
  }

  function fileTile(file) {
    const info = FILE_KINDS[file.kind] || { label: file.kind, icon: 'image' };
    const tile = el('button.file-tile', {}, [
      icon(info.icon),
      el('span.name', {}, [file.name]),
      el('span.meta', {}, [info.label]),
      el('span.kind-tag', {}, [file.kind === 'deck' ? 'REVIZ' : file.kind.toUpperCase()]),
    ]);
    tile.onclick = () => {
      if (selected.size || tile.classList.contains('selected')) toggleSelectArtifact(file, tile);
      else openResource(file);
    };
    tile.oncontextmenu = (e) => { e.preventDefault(); fileMenu(file, tile); };
    attachLongPress(tile, () => fileMenu(file, tile));
    return tile;
  }

  function fileMenu(file, tile) {
    choiceDialog({
      title: file.name,
      options: [
        { id: 'open', label: 'Ouvrir', kind: 'ghost' },
        { id: 'select', label: 'Sélectionner' },
        { id: 'rename', label: 'Renommer' },
        { id: 'delete', label: 'Supprimer', kind: 'danger' },
      ],
    }).then(async (v) => {
      if (v === 'open') { openResource(file); return; }
      if (v === 'select') { toggleSelectArtifact(file, tile); return; }
      if (v === 'rename') {
        const dot = file.name.lastIndexOf('.');
        const base = dot > 0 ? file.name.slice(0, dot) : file.name;
        const newBase = await promptDialog({ title: 'Renommer le fichier', value: base });
        if (!newBase) return;
        const ext = dot > 0 ? file.name.slice(dot) : '';
        await rename(recordOf(file), newBase + ext).catch((e) => toast(e.message, 'error'));
        rebuildNow(true);
        return;
      }
      if (v === 'delete') {
        const okd = await confirmDialog({
          title: `Supprimer « ${file.name} » ?`,
          message: file.kind === 'deck'
            ? 'Le deck, ses cartes et leur historique de révision seront supprimés. Action définitive.'
            : 'Action définitive.',
        });
        if (!okd) return;
        await deleteFiles([file.id]);
        toast('Fichier supprimé.', 'success');
        rebuildNow(true);
      }
    });
  }

  function recordOf(file) { return file; }

  // Renommer = champ name (+ deck meta si deck)
  async function rename(file, newName) {
    const { updateFileFields, updateDeck } = await import('../storage/repo.js');
    await updateFileFields(file.id, { name: newName });
    if (file.kind === 'deck' && file.deckId) await updateDeck(file.deckId, { name: newName });
    toast('Renommé.', 'success');
  }

  function openResource(file) {
    if (file.kind === 'deck' && file.deckId) { location.hash = `#/deck/${file.deckId}`; return; }
    location.hash = `#/view/${file.id}`;
  }

  // ------------------------------------------------------------- dossier courant
  function sanitizeFileName(s) {
    return String(s || 'dossier').replace(/[\\/:*?"<>|]/g, '_').trim() || 'dossier';
  }

  /** Export d'un dossier complet (contenu récursif) au format .revizlib. */
  async function exportFolder(folder) {
    try {
      const p = toast(`Export de « ${folder.name} »…`, 'info', 2000);
      void p;
      const { bytes, summary } = await buildFolderArchive(folder.id);
      const blob = new Blob([bytes], { type: 'application/reviz' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = sanitizeFileName(folder.name) + '.revizlib';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2500);
      toast(`Dossier exporté : ${summary.decks} deck(s), ${summary.cards} carte(s), ${summary.files} fichier(s).`, 'success', 4200);
    } catch (e) {
      toast(e.message || e, 'error', 4200);
    }
  }

  async function newFolder() {
    const name = await promptDialog({ title: 'Nouveau dossier', label: 'Nom du dossier' });
    if (!name) return;
    await createFolder(name, folderId);
    toast('Dossier créé.', 'success');
    rebuildNow(true);
  }

  async function renameCurrent() {
    const name = await promptDialog({ title: 'Renommer le dossier', value: currentFolder.name });
    if (!name) return;
    await renameFolder(folderId, name);
    toast('Dossier renommé.', 'success');
    rebuildNow(true);
  }

  async function moveCurrent() {
    const fresh = await loadFolderTree();
    const pick = await folderPickerDialog(fresh.byParent, {
      allowRoot: true, currentId: currentFolder.parentId,
      title: `Déplacer « ${currentFolder.name} » vers…`, actionLabel: 'Déplacer ici',
    });
    if (pick.cancelled) return;
    try {
      await moveFolder(folderId, pick.folderId);
      toast('Dossier déplacé (contenu inclus).', 'success');
      rebuildNow(true);
    } catch (e) { toast(e.message, 'error'); }
  }

  async function deleteCurrent() {
    const sub = countSubtree(allFiles, tree, folderId);
    const okd = await confirmDialog({
      title: `Supprimer « ${currentFolder.name} » ?`,
      message: `Ce dossier contient ${sub.folders} sous-dossier(s) et ${sub.files} fichier(s). TOUT sera supprimé (decks, cartes, historiques inclus). Action définitive.`,
      confirmLabel: 'Tout supprimer',
    });
    if (!okd) return;
    await deleteFolderCascade(folderId);
    toast('Dossier supprimé.', 'success');
    const parentId = currentFolder.parentId;
    location.hash = parentId ? `#/files/${parentId}` : '#/files';
  }

  // ------------------------------------------------------------- importation
  function pickImportFiles() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.reviz,.revizlib,.pdf,.png,.jpeg,.jpg,.webp,.gif,.html,.htm,.txt,.md';
    input.onchange = async () => {
      const list = [...input.files];
      if (!list.length) return;
      const p = toast(`Import de ${list.length} fichier(s)…`, 'info', 1200);
      void p;
      const res = await importManyFiles(list, folderId, { onDeckConflict, onLibraryConflict });
      showImportSummary(res);
      rebuildNow(true);
    };
    input.click();
  }

  async function onDeckConflict(deckInfo) {
    const v = await choiceDialog({
      title: 'Deck déjà présent',
      message: `Un deck « ${deckInfo?.name} » existe déjà avec le même identifiant.\n\n· Importer comme nouveau : il devient un deck indépendant.\n· Remplacer : le deck local est écrasé (statistiques de révision conservées pour les cartes identiques).\n· Annuler : ce fichier est ignoré.`,
      options: [
        { id: 'new', label: 'Importer comme nouveau', kind: 'primary' },
        { id: 'replace', label: 'Remplacer', kind: 'danger' },
        { id: 'cancel', label: 'Annuler' },
      ],
      dismissible: false,
    });
    return v === 'replace' ? 'replace' : v === 'new' ? 'new' : 'cancel';
  }

  async function onLibraryConflict(info) {
    const v = await choiceDialog({
      title: 'Decks déjà présents dans ce dossier',
      message: `${info.conflicts} deck(s) de « ${info.name} » existent déjà avec le même identifiant (sur ${info.decks} au total).\n\n· Remplacer : les decks locaux concernés sont écrasés (statistiques de révision conservées pour les cartes identiques).\n· Importer comme nouveaux : les decks en conflit deviennent des decks indépendants.\n· Annuler : ce dossier est ignoré.`,
      options: [
        { id: 'replace', label: 'Remplacer les decks concernés', kind: 'danger' },
        { id: 'new', label: 'Importer comme nouveaux', kind: 'primary' },
        { id: 'cancel', label: 'Annuler' },
      ],
      dismissible: false,
    });
    return v === 'replace' ? 'replace' : v === 'new' ? 'new' : 'cancel';
  }

  function showImportSummary(res) {
    const lines = res.results.map((r) => `${r.ok ? '✔' : '✘'} ${r.name}${r.error ? ` — ${r.error}` : ''}`);
    const warn = [];
    for (const r of res.results) {
      if (r.ok && r.kind === 'sim' && r.externalDeps?.length) {
        warn.push(simulationWarning(r.externalDeps, r.name));
      }
      if (r.ok && r.replaced) warn.push(`${r.name} : deck existant REMPLACÉ (historique conservé pour les cartes identiques).`);
      if (r.ok && r.kind === 'lib') {
        warn.push(`${r.name} : dossier importé — ${r.folders} dossier(s), ${r.decks} deck(s), ${r.cards} carte(s), ${r.files} fichier(s).`);
        if (r.replaced) warn.push(`${r.name} : ${r.replaced} deck(s) existant(s) REMPLACÉ(S) (historique conservé pour les cartes identiques).`);
      }
      if (r.ok && r.kind === 'deck' && !r.replaced && !r.cancelled) void 0;
    }
    choiceDialog({
      title: `Import terminé : ${res.succeeded} réussi(s), ${res.failed} échoué(s)`,
      message: null,
      options: [{ id: '__ok', label: 'Fermer', kind: 'primary' }],
      extra: (() => {
        const box = el('div');
        box.appendChild(el('div.report', { style: 'font-size:.82rem;max-height:240px;overflow:auto;background:rgba(6,9,34,.55);border-radius:10px;padding:10px 12px;line-height:1.65' }, lines.map((l) => el('div', {}, [l]))));
        if (warn.length) {
          box.appendChild(el('div.viewer-warn', {}, [icon('info', 'i18'), el('div', {}, warn.map((w) => el('div', {}, [w])))]));
        }
        return box;
      })(),
    });
  }

  async function newFiche() {
    const name = await promptDialog({ title: 'Nouvelle fiche', label: 'Nom de la fiche' });
    if (!name) return;
    await createFile({ kind: 'fiche', name, folderId, text: '' });
    toast('Fiche créée.', 'success');
    rebuildNow(true);
  }

  // ------------------------------------------------------------- helpers
  function rebuildNow(silent = false) {
    if (silent) reroute();
  }

  function countSubtree(allFilesLocal, treeLocal, rootId) {
    let folders = 0;
    const doomed = new Set([rootId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const f of treeLocal.folders) {
        if (doomed.has(f.id)) continue;
        if (doomed.has(f.parentId)) { doomed.add(f.id); changed = true; }
      }
    }
    folders = doomed.size - 1;
    const filesInSubtree = allFilesLocal.filter((f) => doomed.has(f.folderId)).length;
    void map;
    return { folders, files: filesInSubtree };
  }
}

/** Appui long (≈550 ms) sur tactile → menu contextuel. */
function attachLongPress(tile, fn) {
  let timer = null;
  let moved = false;
  tile.addEventListener('touchstart', () => {
    moved = false;
    timer = setTimeout(() => { if (!moved) fn(); }, 550);
  }, { passive: true });
  tile.addEventListener('touchmove', () => { moved = true; clearTimeout(timer); }, { passive: true });
  tile.addEventListener('touchend', () => clearTimeout(timer), { passive: true });
  tile.addEventListener('touchcancel', () => clearTimeout(timer), { passive: true });
}

void DEFAULT_SETTINGS;
