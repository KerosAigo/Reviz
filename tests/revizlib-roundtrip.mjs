/**
 * Sondes Node pour le format .revizlib (export/import de dossiers complets,
 * sans IndexedDB — instantané simulé). Sert de base aux tests d'intégration.
 */
import {
  buildLibraryArchive, extractAndValidateRevizlib,
} from '../src/format/revizlib.js';
import { strToU8, zipSync } from '../vendor/fflate/fflate.mjs';

const PNG_1PX = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
const PDF_MIN = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

const snapshot = {
  folders: [
    { id: 'f1', parentId: null, name: 'Physique', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    { id: 'f2', parentId: 'f1', name: 'Mécanique', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  ],
  files: [
    { id: 'fi1', folderId: 'f2', kind: 'deck', name: 'Newton', deckId: 'deck-1', blobId: null, mimeType: null, size: null, text: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    { id: 'fi2', folderId: 'f2', kind: 'pdf', name: 'cours.pdf', deckId: null, blobId: 'b2', mimeType: 'application/pdf', size: PDF_MIN.length, text: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    { id: 'fi3', folderId: 'f1', kind: 'fiche', name: 'formules', deckId: null, blobId: null, mimeType: null, size: null, text: 'F=ma', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  ],
  decks: [
    { id: 'deck-1', name: 'Newton', description: ' Lois de Newton', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' },
  ],
  cards: [
    {
      id: 'c1', deckId: 'deck-1', position: 0,
      front: [{ type: 'text', value: 'Deuxième loi de Newton ?' }, { type: 'latex', value: '\\vec{F}=m\\vec{a}' }],
      back: [{ type: 'image', blobId: 'b1', alt: 'schéma' }],
      type: undefined, data: null,
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'c2', deckId: 'deck-1', position: 1,
      front: [{ type: 'text', value: 'Choisir :' }],
      back: [{ type: 'text', value: 'a' }],
      type: 'qcm', data: { options: [{ text: 'a', correct: true }, { text: 'b', correct: false }] },
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    },
  ],
};

const blobs = new Map([
  ['b1', { bytes: PNG_1PX, mimeType: 'image/png', nameHint: 'schema.png' }],
  ['b2', { bytes: PDF_MIN, mimeType: 'application/pdf', nameHint: 'cours.pdf' }],
]);

let bad = 0;
const check = (name, ok) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); };

// --- export → archive
const { bytes, summary } = await buildLibraryArchive(snapshot, async (id) => blobs.get(id) || null);
check('archive ZIP non vide', bytes.length > 200 && new TextDecoder().decode(bytes.slice(0, 4)) === 'PK\u0003\u0004');
check('résumé cohérent', summary.folders === 2 && summary.files === 3 && summary.decks === 1 && summary.cards === 2 && summary.blobs === 2);

// --- import : extraction valide
const v = await extractAndValidateRevizlib(bytes);
check('racine détectée', v.rootFolder?.name === 'Physique' && v.rootFolder?.parentId == null);
check('dossiers conservés', v.folders.length === 2 && v.folders[1].parentId === 'f1');
check('decks conservés', v.decks[0].id === 'deck-1' && v.decks[0].description === ' Lois de Newton');
check('cartes conservées', v.cards.length === 2 && v.cards[0].front[1].value === '\\vec{F}=m\\vec{a}');
check('carte typée v2 conservée', v.cards[1].type === 'qcm' && v.cards[1].data.options.length === 2);
check('médias présents', v.blobBytes.size === 2 && v.blobBytes.get('b1')[0] === 0x89);
check('fichiers non-deck conservés', v.files.some((f) => f.kind === 'fiche' && f.text === 'F=ma'));

// --- blob manquant → export refusé
let threw = null;
try { await buildLibraryArchive(snapshot, async () => null); } catch (e) { threw = e; }
check('média manquant → ValidationError', threw && threw.name === 'RevizError' && threw.message.includes('médias'));

// --- archive corrompue
threw = null;
try { await extractAndValidateRevizlib(new Uint8Array([1, 2, 3, 4])); } catch (e) { threw = e; }
check('archive corrompue → ValidationError', threw && threw.name === 'RevizError');

// --- mauvais format
const wrong = zipSync({
  'manifest.json': strToU8(JSON.stringify({ format: 'reviz', formatVersion: 1, deck: { id: 'd', name: 'x' }, cards: [], media: [] })),
  'data/folders.json': strToU8('[]'), 'data/files.json': strToU8('[]'),
  'data/decks.json': strToU8('[]'), 'data/cards.json': strToU8('[]'),
});
threw = null;
try { await extractAndValidateRevizlib(wrong); } catch (e) { threw = e; }
check('format .reviz refusé', threw && threw.message.includes('revizlib'));

// --- version future refusée
const mkLib = (overrides) => {
  const manifest = {
    format: 'revizlib', formatVersion: 1, createdAt: '2026-01-01T00:00:00Z',
    counts: { folders: 1, files: 1, decks: 1, cards: 1, blobs: 0 }, blobs: [],
    ...overrides,
  };
  return zipSync({
    'manifest.json': strToU8(JSON.stringify(manifest)),
    'data/folders.json': strToU8(JSON.stringify(overrides.folders ?? [{ id: 'f1', parentId: null, name: 'R' }])),
    'data/files.json': strToU8(JSON.stringify(overrides.files ?? [{ id: 'fi1', folderId: 'f1', kind: 'deck', name: 'd', deckId: 'd1' }])),
    'data/decks.json': strToU8(JSON.stringify(overrides.decks ?? [{ id: 'd1', name: 'd' }])),
    'data/cards.json': strToU8(JSON.stringify(overrides.cards ?? [{ id: 'c1', deckId: 'd1', position: 0, front: [], back: [] }])),
  });
};
threw = null;
try { await extractAndValidateRevizlib(mkLib({ formatVersion: 9 })); } catch (e) { threw = e; }
check('version inconnue refusée', threw && threw.message.includes('Version'));

// --- deux racines refusées
threw = null;
try {
  await extractAndValidateRevizlib(mkLib({ folders: [{ id: 'a', parentId: null, name: 'A' }, { id: 'b', parentId: null, name: 'B' }] }));
} catch (e) { threw = e; }
check('deux racines refusées', threw && threw.message.includes('racine'));

// --- cycle refusé (racine présente + boucle a → b → a)
threw = null;
try {
  await extractAndValidateRevizlib(mkLib({
    folders: [{ id: 'r', parentId: null, name: 'R' }, { id: 'a', parentId: 'b', name: 'A' }, { id: 'b', parentId: 'a', name: 'B' }],
    files: [{ id: 'fi1', folderId: 'r', kind: 'deck', name: 'd', deckId: 'd1' }],
  }));
} catch (e) { threw = e; }
check('cycle refusé', threw && threw.message.includes('cyclique'));

// --- deck sans fichier refusé
threw = null;
try {
  await extractAndValidateRevizlib(mkLib({
    files: [{ id: 'fi1', folderId: 'f1', kind: 'fiche', name: 'n' }],
  }));
} catch (e) { threw = e; }
check('deck sans fichier refusé', threw && threw.message.includes("sans fichier"));

// --- média référencé non déclaré refusé
threw = null;
try {
  await extractAndValidateRevizlib(mkLib({
    blobs: [],
    cards: [{ id: 'c1', deckId: 'd1', position: 0, front: [{ type: 'image', blobId: 'zz' }], back: [] }],
  }));
} catch (e) { threw = e; }
check('média non déclaré refusé', threw && threw.message.includes('non déclaré'));

console.log(bad ? `\n${bad} ÉCHEC(S)` : '\nTOUT PASS — round-trip .revizlib');
