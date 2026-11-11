/**
 * Sélecteur de dossier en arbre (utilisé par : création de deck, déplacement,
 * révision sur un dossier, importation).
 * Consume l'arbre {byParent: Map|null -> [folder]} déjà chargé par storage/repo.loadFolderTree.
 */
import { el, choiceDialog } from './components.js';
import { icon } from './icons.js';

/**
 * Ouvre une modale de sélection de dossier.
 * @param {Map} byParent arbre des dossiers ({byParent} issu de storage/repo.loadFolderTree)
 * @param {{allowRoot:boolean, currentId:string|null, title:string, actionLabel:string}} opts
 * @returns {Promise<{cancelled:boolean, folderId:string|null}} folderId null = racine
 */
export function folderPickerDialog(byParent, { allowRoot = true, currentId = null, title = 'Choisir un dossier', actionLabel = 'Choisir' } = {}) {
  let selected = currentId; // null = racine
  const listEl = el('div.fpicker-tree');

  function row(folder, depth) {
    const kids = byParent.get(folder.id) || [];
    const r = el('div.fpicker-row', {
      onclick: () => { selected = folder.id; mark(); },
    }, [
      el('span.fpicker-depth', { style: `padding-left:${depth * 18}px` }),
      icon('folder', 'i16'),
      el('span', {}, [folder.name]),
      kids.length ? el('span.fpicker-sub', {}, [`(${kids.length})`]) : null,
    ]);
    if (folder.id === selected) r.classList.add('selected');
    r.dataset.fid = folder.id;
    return r;
  }

  function build() {
    listEl.textContent = '';
    if (allowRoot) {
      const root = el('div.fpicker-row', { dataset: { fid: '' }, onclick: () => { selected = null; mark(); } }, [
        el('span.fpicker-depth', { style: 'padding-left:0' }),
        icon('home', 'i16'),
        el('span', {}, ['Racine']),
      ]);
      if (selected === null) root.classList.add('selected');
      listEl.appendChild(root);
    }
    const walk = (parent, depth) => {
      for (const f of byParent.get(parent) || []) {
        listEl.appendChild(row(f, depth));
        walk(f.id, depth + 1);
      }
    };
    walk(null, allowRoot ? 1 : 0);
  }

  function mark() {
    for (const node of listEl.querySelectorAll('.fpicker-row')) {
      node.classList.toggle('selected', node.dataset.fid === (selected || ''));
    }
  }

  return choiceDialog({
    title,
    message: null,
    dismissible: true,
    options: [
      { id: '__go', label: actionLabel, kind: 'primary', icon: 'check' },
      { id: null, label: 'Annuler', kind: 'ghost' },
    ],
    extra: (() => { const box = el('div.fpicker'); box.appendChild(listEl); build(); return box; })(),
  }).then((v) => ({ cancelled: v !== '__go', folderId: v === '__go' ? selected : null }));
}

