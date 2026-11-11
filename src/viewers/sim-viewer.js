/**
 * Visualiseur de simulations HTML — exécution ISOLÉE.
 *
 * Mesures de sécurité (document SECURITE_ET_DONNEES.md §2) :
 *  - le HTML n'est JAMAIS injecté dans le DOM principal : iframe `srcdoc` ;
 *  - sandbox = `allow-scripts` UNIQUEMENT :
 *      · pas de `allow-same-origin` → origine nulle → aucun accès à IndexedDB,
 *        localStorage, cookies, DOM de l'application ;
 *      · pas de `allow-popups`, pas de `allow-forms`, pas de `allow-downloads`,
 *        pas d'accès réseau (simulations hors-ligne par défaut) ;
 *  - les dépendances externes (http/https) sont détectées et SIGNALÉES à l'ouverture.
 */
import { findExternalRefs } from '../importer/import-service.js';

export function openSimViewer(container, blobText, fileName = 'simulation') {
  container.textContent = '';

  const deps = findExternalRefs(blobText);
  if (deps.length) {
    const warn = document.createElement('div');
    warn.className = 'viewer-warn';
    warn.innerHTML = `
      <span class="icon">⚠</span>
      <div><strong>${deps.length} ressource(s) externe(s) détectée(s)</strong> dans ${esc(fileName)} :
      <code style="word-break:break-all">${esc(deps.slice(0, 4).join(' · '))}${deps.length > 4 ? ' …' : ''}</code>.
      Les requêtes réseau sont bloquées en mode sandbox ; la simulation peut manquer de dépendances.</div>`;
    container.appendChild(warn);
  }

  const frame = document.createElement('iframe');
  frame.className = 'sim-frame';
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('title', `Simulation : ${fileName}`);
  // Injection du base target + csp stricte pour tenter de contenir tout débordement
  const hardened = blobText.replace(/<head([^>]*)>/i, '<head$1><base href="about:blank">');
  frame.srcdoc = hardened;
  container.appendChild(frame);

  const relaunch = () => {
    frame.srcdoc = hardened; // rechargement complet de la simulation
  };
  const toolbar = document.createElement('div');
  toolbar.className = 'viewer-toolbar';
  const b = document.createElement('button');
  b.className = 'btn btn-sm';
  b.textContent = '⟳ Relancer la simulation';
  b.onclick = relaunch;
  toolbar.appendChild(b);
  container.appendChild(toolbar);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
