/**
 * Composants d'interface réutilisables : fabrique DOM, modales, confirmations,
 * toasts, sélecteur de dossier en arbre.
 * Aucune logique métier ici : ces briques ne connaissent ni IndexedDB ni le format .reviz
 * (sauf le sélecteur de dossier qui consomme un arbre déjà chargé).
 */
import { icon } from './icons.js';

/** Fabrique DOM succincte : el('div.card', {onclick}, [enfants]) */
export function el(spec, attrs = {}, children = []) {
  const [tag, ...cls] = spec.split('.');
  const node = document.createElement(tag || 'div');
  if (cls.length) node.className = cls.join(' ');
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'checked') node.checked = !!v;
    else if (k === 'hidden') node.hidden = !!v;
    else if (k === 'class') {
      // FUSION avec les classes du spec (ne remplace pas) — valeurs vides ignorées
      if (v) String(v).split(/\s+/).filter(Boolean).forEach((c) => node.classList.add(c));
    }
    else if (k in node && k !== 'list' && k !== 'form') {
      try { node[k] = v; } catch (_) { node.setAttribute(k, v); }
    } else node.setAttribute(k, v);
  }
  for (const c of [].concat(children).flat(2)) {
    if (c == null) continue;
    node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function iconEl(name) { return icon(name); }

// ------------------------------------------------------------------ Toasts

let toastBox = null;
export function toast(message, type = 'info', ms = 2600) {
  if (!toastBox) {
    toastBox = el('div.toasts', { 'aria-live': 'polite' });
    document.body.appendChild(toastBox);
  }
  const t = el(`div.toast.toast-${type}`, {}, [
    icon(type === 'error' ? 'x' : type === 'success' ? 'check' : 'info', 'i16'),
    el('span', {}, [message]),
  ]);
  toastBox.appendChild(t);
  setTimeout(() => { t.classList.add('leaving'); setTimeout(() => t.remove(), 350); }, ms);
}

// ------------------------------------------------------------------ Modales

function modalBackdrop(content, { dismissible = true, onclose } = {}) {
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', esc);
    backdrop.remove();
    if (onclose) onclose(result);
  };
  const esc = (e) => { if (e.key === 'Escape' && dismissible) close(null); };
  const backdrop = el('div.modal-backdrop', { onclick: (e) => { if (dismissible && e.target === backdrop) close(null); } }, [
    el('div.modal', { role: 'dialog', 'aria-modal': 'true' }, [content, dismissible ? el('button.modal-x', { onclick: () => close(null), 'aria-label': 'Fermer' }, [icon('x')]) : null]),
  ]);
  document.body.appendChild(backdrop);
  document.addEventListener('keydown', esc);
  return { close };
}

/**
 * Boîte de dialogue générique à n boutons.
 * options : [{id, label, kind:'primary'|'danger'|'ghost'}]
 * Retourne l'id du bouton cliqué, ou null (échap/clic dehors).
 */
export function choiceDialog({ title, message, options, extra = null, dismissible = true }) {
  return new Promise((resolve) => {
    const content = el('div.dialog', {}, [
      el('h3.dialog-title', {}, [title]),
      message ? el('p.dialog-msg', {}, [message]) : null,
      extra,
      el('div.dialog-actions', {}, options.map((o) =>
        el(`button.btn.${o.kind || 'ghost'}`, {
          onclick: () => dlg.close(o.id),
        }, [o.icon ? icon(o.icon) : null, el('span', {}, [o.label])])
      )),
    ]);
    const dlg = modalBackdrop(content, { dismissible, onclose: (v) => resolve(v) });
  });
}

/**
 * Confirmation oui/non (danger par défaut pour les suppressions).
 */
export function confirmDialog({ title, message, confirmLabel = 'Supprimer', cancelLabel = 'Annuler', danger = true }) {
  return choiceDialog({
    title, message,
    options: [
      { id: true, label: confirmLabel, kind: danger ? 'danger' : 'primary' },
      { id: false, label: cancelLabel, kind: 'ghost' },
    ],
  }).then((v) => v === true);
}

/** Saisie texte simple. Retourne la chaîne ou null. */
export function promptDialog({ title, label, value = '', okLabel = 'Valider' }) {
  return new Promise((resolve) => {
    const input = el('input.text-input', { type: 'text', value, maxlength: '120' });
    const commit = () => dlg.close(input.value.trim() || null);
    const content = el('div.dialog', {}, [
      el('h3.dialog-title', {}, [title]),
      label ? el('p.dialog-msg', {}, [label]) : null,
      input,
      el('div.dialog-actions', {}, [
        el('button.btn.primary', { onclick: commit }, ['Valider']),
        el('button.btn.ghost', { onclick: () => dlg.close(null) }, ['Annuler']),
      ]),
    ]);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); });
    const dlg = modalBackdrop(content, { dismissible: true, onclose: (v) => resolve(v == null ? null : String(v)) });
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}
