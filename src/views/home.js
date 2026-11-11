/**
 * Vue Accueil.
 * Deux actions principales (spécification fonctionnelle §4) :
 *  - "Créer un deck" ouvre l'éditeur après choix du dossier parent ;
 *  - "Lancer une révision" ouvre l'écran de préparation.
 * Les raccourcis secondaires mènent à l'arborescence et aux stats.
 */
import { el } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { loadFolderTree, createDeck, loadAllCards, getAllStats } from '../storage/repo.js';
import { folderPickerDialog } from '../ui/folder-picker.js';
import { dueNowCount } from '../srs/scheduler.js';

export async function homeView(viewEl) {
  const [tree, cards, stats] = await Promise.all([loadFolderTree(), loadAllCards(), getAllStats()]);
  const statsMap = new Map(stats.map((s) => [s.cardId, s]));
  const dueCount = dueNowCount(cards, statsMap);

  const decksCount = cardsDecks(cards);

  viewEl.textContent = '';

  const hero = el('div.hero', {}, [
    el('h1', {}, ['Reviz']),
    el('p.tagline', {}, ['Flashcards · Cours · Simulations']),
  ]);

  const actions = el('div.big-actions', {}, [
    el('button.btn.btn-primary', { onclick: () => createDeckFlow(tree) }, [icon('edit'), el('span', {}, ['Créer un deck'])]),
    el('button.btn.btn-cyan', { onclick: () => { location.hash = '#/review'; } }, [icon('play'), el('span', {}, ['Réviser'])]),
    el('button.btn', { onclick: () => { location.hash = '#/files'; } }, [icon('folder'), el('span', {}, ['Fichiers'])]),
  ]);

  // succès global réel (somme des cardStats) pour la carte « Progression »
  let reviewsTotal = 0, correctTotal = 0;
  for (const s of stats) { reviewsTotal += s.reviews || 0; correctTotal += s.correct || 0; }
  const success = reviewsTotal > 0 ? Math.round((correctTotal / reviewsTotal) * 100) : null;

  const grid = el('div.home-grid', {}, [
    statCard('folder', 'Arborescence', tree.folders.length, 'Dossiers — organisez decks, cours et médias', false, '#/files'),
    statCard('cards', 'Bibliothèque', decksCount, `${decksCount} deck(s) — créer, importer (.reviz), exporter`, false, '#/files'),
    statCard('play', 'Révisions', dueCount, 'Cartes à réviser maintenant — cliquer pour lancer', dueCount > 0, '#/review'),
    statCard('chart', 'Progression', success == null ? '—' : `${success}%`, `${reviewsTotal} révision(s) enregistrée(s) — détail dans Statistiques`, false, '#/stats'),
  ]);

  const chips = el('div.chips-row', { style: 'justify-content:center;margin-top:26px;' }, [
    el('span.chip.c-cyan', {}, [icon('cards'), el('span', {}, [`${cards.length} cartes`])]),
    el('span.chip.c-gold', {}, [icon('folder'), el('span', {}, [`${tree.folders.length} dossiers`])]),
    el('span.chip.c-pink', {}, [icon('clock'), el('span', {}, [`${dueCount} à réviser`])]),
  ]);

  viewEl.appendChild(hero);
  viewEl.appendChild(el('div.panel', {}, [actions]));
  viewEl.appendChild(grid);
  viewEl.appendChild(chips);

  /** Action « Créer un deck » : choix du dossier parent → deck créé → éditeur de carte. */
  async function createDeckFlow() {
    const fresh = await loadFolderTree();
    const pick = await folderPickerDialog(fresh.byParent, {
      allowRoot: true,
      title: 'Enregistrer le deck dans quel dossier ?',
      actionLabel: 'Créer le deck',
    });
    if (pick.cancelled) return;
    const { deck } = await createDeck('Nouveau deck', pick.folderId);
    location.hash = `#/card/${deck.id}/new`;
  }
}

function cardsDecks(cards) {
  const set = new Set(cards.map((c) => c.deckId));
  return set.size;
}

/** Carte-raccourci visuelle : icône + titre + GROS CHIFFRE (détail en info-bulle). */
function statCard(ic, title, num, tooltip, hot, hash) {
  return el(`div.home-card${hot ? '.hot' : ''}`, { onclick: () => { location.hash = hash; }, title: tooltip }, [
    icon(ic),
    el('h4', {}, [title]),
    el('div.home-num', {}, [String(num)]),
  ]);
}
