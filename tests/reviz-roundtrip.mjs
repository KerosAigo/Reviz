/**
 * Sondes Node pour le format .reviz (sans IndexedDB — ctx simulé).
 * Sert de base aux tests d'intégration documentés.
 */
import {
  buildRevizArchive, extractAndValidateReviz, safePath, validateManifest,
} from '../src/format/reviz.js';
import { strFromU8 } from '../vendor/fflate/fflate.mjs';

const PNG_1PX = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);

const deck = { id: 'deck-1', name: 'Méca', description: 'desc', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' };
const cards = [
  {
    id: 'c1', position: 0,
    front: [{ type: 'text', value: 'Deuxième loi de Newton ?' }, { type: 'latex', value: '\\vec{F}=m\\vec{a}' }],
    back: [{ type: 'text', value: '∑ F = m a' }],
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
  },
  {
    id: 'c2', position: 1,
    front: [{ type: 'image', blobId: 11, alt: 'schéma' }],
    back: [{ type: 'gif', blobId: 12, alt: 'anim' }],
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
  },
];
const blobs = new Map([
  [11, { bytes: PNG_1PX, mimeType: 'image/png' }],
  [12, { bytes: [71, 73, 70, 56, 57, 97, 1, 2, 3], mimeType: 'image/gif' }],
]);

let bad = 0;
const check = (name, ok) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); };

// --- export → archive
const archive = await buildRevizArchive(deck, cards, blobs);
const zipBytes = archive;
check('archive non vide', zipBytes.length > 100 && new TextDecoder().decode(zipBytes.slice(0, 4)) === 'PK\u0003\u0004');

// --- import : archive valide (nouveau deck)
let outcome = await extractAndValidateReviz(zipBytes, {
  getDeckById: async () => null,
  chooseAction: async () => 'new',
});
check('extraction ok', outcome?.manifest?.cards?.length === 2);
check('médias mappés', outcome?.mediaMap?.size === 2);
const man = outcome?.manifest;
check('blocs texte/latex conservés', man.cards[0].front[1].value === '\\vec{F}=m\\vec{a}');
check('ordre des cartes', man.cards[0].position === 0 && man.cards[1].position === 1);
check('src médias présents', man.cards[1].front[0].src?.startsWith('media/') && man.cards[1].back[0].type === 'gif');
check('identités stables', man.deck.id === 'deck-1' && man.cards[0].id === 'c1');

// --- manifeste invalide
let threw = null;
try { await extractAndValidateReviz(new TextEncoder().encode('pas une archive').valueOf ? new Uint8Array([1, 2, 3]) : null, { getDeckById: async () => null, chooseAction: async () => 'new' }); } catch (e) { threw = e; }
check('archive corrompue → ValidationError', threw && threw.name === 'RevizError');

// --- chemin malveillant : construire un zip avec entrée dangereuse
const { zipSync, strToU8 } = await import('../vendor/fflate/fflate.mjs');
const evil = zipSync({
  'manifest.json': strToU8(JSON.stringify({
    format: 'reviz', formatVersion: 1,
    deck: { id: 'd', name: 'x' },
    cards: [{ id: 'c', position: 0, front: [{ type: 'text', value: 'a' }], back: [{ type: 'text', value: 'b' }] }],
    media: [{ path: 'media/../../evil.png', mimeType: 'image/png' }],
  })),
});
threw = null;
try { await extractAndValidateReviz(evil, { getDeckById: async () => null, chooseAction: async () => 'new' }); } catch (e) { threw = e; }
check('chemin malveillant refusé', threw && threw.message.includes('invalide'));

// --- version future refusée
const future = zipSync({
  'manifest.json': strToU8(JSON.stringify({
    format: 'reviz', formatVersion: 9,
    deck: { id: 'd', name: 'x' },
    cards: [], media: [],
  })),
});
threw = null;
try { await extractAndValidateReviz(future, { getDeckById: async () => null, chooseAction: async () => 'new' }); } catch (e) { threw = e; }
check('version inconnue refusée', threw && threw.message.includes('Version'));

console.log(bad ? `\n${bad} ÉCHEC(S)` : '\nTOUT PASS — round-trip .reviz');
