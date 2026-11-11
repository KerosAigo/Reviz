/**
 * Point d'entrée : routeur + coquille de l'application.
 *
 * Routes (hash) :
 *   #/                       accueil
 *   #/files[/folderId]       arborescence
 *   #/deck/deckId            éditeur de deck
 *   #/card/deckId[/cardId]   éditeur de carte (cardId absent = nouvelle carte)
 *   #/review                 préparation de session
 *   #/stats                  statistiques
 *   #/settings               réglages
 *   #/view/fileId            consultation d'une ressource (PDF, image, sim, fiche, deck)
 *   #/import[/fileId]        assistant « générer des révisions » (PDF/image/texte)
 */
import { icon } from './ui/icons.js';
import { el } from './ui/components.js';
import { homeView } from './views/home.js';
import { filesView } from './views/files.js';
import { deckEditorView } from './views/deck-editor.js';
import { cardEditorView } from './views/card-editor.js';
import { reviewPrepView, reviewSessionView } from './views/review.js';
import { examPrepView, examRunView, examResultView, examHistoryView } from './views/exam.js';
import { statsView } from './views/stats.js';
import { settingsView } from './views/settings.js';
import { resourceView } from './views/resource.js';
import { importWizardView } from './views/import-wizard.js';

const routes = [
  { id: 'home', title: 'Accueil', pattern: /^#\/?$/, render: homeView, icon: 'home' },
  { id: 'files', title: 'Fichiers', pattern: /^#\/files(?:\/([\w-]+))?/, render: filesView, icon: 'folder' },
  { id: 'review', title: 'Réviser', pattern: /^#\/review/, render: reviewPrepView, icon: 'play' },
  { id: 'exam', title: 'Examen', pattern: /^#\/exam/, render: examPrepView, icon: 'target' },
  { id: 'stats', title: 'Stats', pattern: /^#\/stats/, render: statsView, icon: 'chart' },
  { id: 'settings', title: 'Réglages', pattern: /^#\/settings/, render: settingsView, icon: 'gear' },
];

let cleanup = null;      // nettoyage de la vue courante
let currentViewEl = null;

function route() {
  const hash = location.hash || '#/';
  const viewEl = document.getElementById('view');

  // Route spéciales (pas dans la nav principale)
  if (/^#\/deck\/[\w-]+/.test(hash)) return mount(deckEditorView, viewEl, hash);
  if (/^#\/card\//.test(hash)) return mount(cardEditorView, viewEl, hash);
  if (/^#\/review\/run/.test(hash)) return mount(reviewSessionView, viewEl, hash);
  if (/^#\/exam\/run/.test(hash)) return mount(examRunView, viewEl, hash);
  if (/^#\/exam\/history/.test(hash)) return mount(examHistoryView, viewEl, hash);
  if (/^#\/exam\/result\/[\w-]+/.test(hash)) return mount(examResultView, viewEl, hash);
  if (/^#\/view\//.test(hash)) return mount(resourceView, viewEl, hash);
  if (/^#\/import/.test(hash)) return mount(importWizardView, viewEl, hash);

  const r = routes.find((x) => x.pattern.test(hash)) || routes[0];

  // état actif de la nav
  document.querySelectorAll('.nav-pill').forEach((n) =>
    n.classList.toggle('active', n.dataset.routeId === r.id)
  );

  mount(r.render, viewEl, hash);
}

function mount(renderFn, viewEl, hash) {
  if (cleanup) { try { cleanup(); } catch (_) { /* vue déjà partiellement détruite */ } }
  cleanup = null;
  // Conteneur DÉDIÉ à ce montage : si la vue précédente se termine en retard
  // (chargements async), ses écritures tombent dans un nœud déjà détaché au
  // lieu d'écraser la vue courante.
  const host = el('div.view-host');
  viewEl.textContent = '';
  viewEl.appendChild(host);
  Promise.resolve(renderFn(host, hash))
    .then((result) => {
      cleanup = typeof result === 'function' ? result : null;
      window.scrollTo(0, 0);
    })
    .catch((e) => {
      console.error(e);
      viewEl.textContent = '';
      viewEl.appendChild(el('div.panel', {}, [
        el('h3.panel-title', {}, ['Une erreur est survenue']),
        el('p.dialog-msg', {}, [String(e.message || e)]),
        el('button.btn.primary', { onclick: () => route() }, ['Réessayer']),
      ]));
    });
}

function buildNav() {
  const nav = document.getElementById('nav');
  nav.textContent = '';
  document.getElementById('brand-icon').innerHTML = icon('sparkle').innerHTML;
  for (const r of routes.filter((x) => x.inNav !== false)) {
    const b = el('button.nav-pill', {
      type: 'button',
      dataset: { routeId: r.id },
      onclick: () => { location.hash = r.id === 'home' ? '#/' : `#/${r.id}`; },
    }, [icon(r.icon, 'i18'), el('span', {}, [r.title])]);
    b.title = r.title;
    nav.appendChild(b);
  }
}

function start() {
  buildNav();
  window.addEventListener('hashchange', route);
  window.addEventListener('reviz:reroute', route);
  route();
}

start();
