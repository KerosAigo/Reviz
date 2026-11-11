/**
 * Éditeur de deck (#/deck/<deckId>) — liste des cartes avec prévisualisations,
 * réordonnancement, export .reviz, suppression (confirmée).
 * Les modifications de METADONNÉES (nom/description) sont enregistrées automatiquement.
 */
import { el, toast, confirmDialog, promptDialog } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { reroute } from '../ui/reroute.js';
import {
  getDeck, listCards, loadAllFiles, loadAllDecks, listChildFiles,
  putCard, deleteFiles, getFileByDeckId, updateDeck,
} from '../storage/repo.js';
import { renderBlocksMiniPreview } from '../render/blocks-preview.js';
import { buildRevizArchive } from '../format/reviz.js';
import { getBlob } from '../storage/repo.js';
import { fmtDate } from '../core/utils.js';

export async function deckEditorView(viewEl, hash) {
  const deckId = (hash.match(/^#\/deck\/([\w-]+)/) || [])[1];
  const deck = await getDeck(deckId);
  viewEl.textContent = '';
  if (!deck) {
    viewEl.appendChild(el('div.panel', {}, [el('h3.panel-title', {}, ['Deck introuvable']), backBtn()]));
    return;
  }

  const cards = await listCards(deck.id);
  const fileRec = await getFileByDeckId(deck.id);
  const statsLine = chips(cards);

  // ------------------------------------------------------------- en-tête
  const nameInput = el('input.text-input.deck-name', { value: deck.name, maxlength: '120' });
  nameInput.addEventListener('input', () => debounceSave());
  nameInput.addEventListener('change', () => debounceSave(true));

  const descInput = el('input.text-input.deck-desc', {
    value: deck.description || '', placeholder: 'Description (optionnelle)', maxlength: '300',
  });
  descInput.addEventListener('input', () => debounceSave());

  const save = async (flush = false) => {
    const name = nameInput.value.trim() || deck.name;
    try {
      await updateDeck(deck.id, { name, description: descInput.value.trim() });
      if (fileRec && fileRec.name !== name) {
        await updateDeckFile(fileRec.id, name);
      }
      if (flush) toast('Enregistré.', 'success', 1400);
    } catch (e) {
      toast(e.message || 'Échec de l\u2019enregistrement — réessayez.', 'error');
    }
  };
  const debounceSave = (() => { let t = null; return (flush = false) => { clearTimeout(t); t = setTimeout(() => save(true), 700); }; })();

  // ------------------------------------------------------------- liste
  const list = el('div.card-list');
  if (!cards.length) {
    list.appendChild(el('div.empty-state', {}, [
      icon('cards'),
      el('p', {}, ['Deck vide. Ajoutez une première carte (recto et verso).']),
    ]));
  }
  cards.forEach((c, i) => list.appendChild(cardRow(c, i, cards.length - 1)));

  // ------------------------------------------------------------- montage
  const panel = el('div.panel', {}, [
    el('div.deck-header', {}, [
      el('div', { style: 'flex:1;min-width:260px' }, [nameInput, el('span.field-label', {}, ['Description']), descInput]),
    ]),
    statsLine,
    el('div.btn-row', { style: 'margin:12px 0' }, [
      el('button.btn.btn-primary', { onclick: () => { location.hash = `#/card/${deck.id}/new`; } },
        [icon('plus', 'i16'), el('span', {}, ['Nouvelle carte'])]),
      el('button.btn', { onclick: exportDeck }, [icon('upload', 'i16'), el('span', {}, ['Exporter (.reviz)'])]),
      el('button.btn.btn-danger', { onclick: deleteDeck }, [icon('trash', 'i16'), el('span', {}, ['Supprimer le deck'])]),
      backBtnOverride(),
    ]),
    list,
  ]);
  viewEl.appendChild(panel);

  // ------------------------------------------------------------- helpers
  function backBtn() {
    return el('button.btn.btn-sm.ghost', { onclick: () => { location.hash = fileRec?.folderId ? `#/files/${fileRec.folderId}` : '#/files'; } }, ['Retour aux fichiers']);
  }
  function backBtnOverride() { return backBtn(); }

  function chips(cards) {
    const media = cards.reduce((n, c) => n + [...c.front, ...c.back].filter((b) => b.blobId).length, 0);
    const latex = cards.reduce((n, c) => n + [...c.front, ...c.back].filter((b) => b.type === 'latex').length, 0);
    return el('div.chips-row', {}, [
      el('span.chip.c-cyan', {}, [icon('cards'), el('span', {}, [`${cards.length} carte(s)`])]),
      el('span.chip.c-gold', {}, [icon('image'), el('span', {}, [`${media} média(s)`])]),
      el('span.chip.c-pink', {}, [icon('edit'), el('span', {}, [`${latex} formule(s)`])]),
      el('span.chip', {}, [el('span', {}, ['MAJ : ' + fmtDate(deck.updatedAt)])]),
    ]);
  }

  function cardRow(card, i, maxIdx) {
    const row = el('div.deck-card-row', {}, [
      el('span.idx', {}, [String(i + 1)]),
      facePreviewEl(card.front, 'RECTO'),
      facePreviewEl(card.back, 'VERSO'),
      el('div.tools', {}, [
        i > 0 ? orderBtn('chevronUp', 'Monter', card, -1) : el('span.btn.icon-btn.order-btn.disabled', {}),
        i < maxIdx ? orderBtn('chevronDown', 'Descendre', card, +1) : el('span.btn.icon-btn.order-btn.disabled', {}),
        el('button.btn.icon-btn', {
          title: 'Modifier la carte',
          onclick: () => { location.hash = `#/card/${deck.id}/${card.id}`; },
        }, [icon('edit', 'i16')]),
        el('button.btn.icon-btn.btn-danger', {
          title: 'Supprimer la carte',
          onclick: async () => {
            const okd = await confirmDialog({ title: `Supprimer la carte ${i + 1} ?`, message: 'Son historique de révision est également effacé.', confirmLabel: 'Supprimer' });
            if (!okd) return;
            const { deleteCard } = await import('../storage/repo.js');
            await deleteCard(card);
            toast('Carte supprimée.', 'success');
            rebuild();
          },
        }, [icon('trash', 'i16')]),
      ]),
    ]);
    return row;
  }

  function facePreviewEl(blocks, label) {
    const preview = el('div.face-preview');
    preview.dataset.label = label;
    preview.title = label;
    const tag = el('div', { style: 'font-size:.58rem;font-weight:800;letter-spacing:.12em;color:var(--c-text-dim);margin-bottom:4px' }, [label]);
    preview.appendChild(tag);
    const host = el('div');
    renderBlocksMiniPreview(host, blocks);
    preview.appendChild(host);
    return preview;
  }

  function orderBtn(ic, title, card, dir) {
    return el('button.btn.icon-btn.order-btn', {
      title, onclick: async () => {
        const { swapCardPositions } = await import('../storage/repo.js');
        await swapCardPositions(card, dir);
        rebuild();
      },
    }, [icon(ic, 'i16')]);
  }

  async function exportDeck() {
    const btns = [...document.querySelectorAll('.btn')];
    void btns;
    try {
      const cards2 = await listCards(deck.id);
      const blobs = new Map();
      const errMissing = [];
      for (const c of cards2) {
        for (const face of [c.front, c.back]) {
          for (const b of face || []) {
            if (b.blobId && !blobs.has(b.blobId)) {
              const rec = await getBlob(b.blobId);
              if (rec) {
                const bytes = rec.bytes instanceof Blob ? new Uint8Array(await rec.bytes.arrayBuffer()) : new Uint8Array(rec.bytes);
                blobs.set(b.blobId, { bytes, mimeType: rec.mimeType });
              } else errMissing.push('média manquant dans une carte');
            }
          }
        }
      }
      if (errMissing.length) {
        toast('Export impossible : ' + errMissing[0] + '. Réimportez le média puis réessayez.', 'error', 4000);
        return;
      }
      const bytes = await buildRevizArchive(deck, cards2, blobs);
      const blob = new Blob([bytes], { type: 'application/reviz' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = sanitizeFileName(deck.name) + '.reviz';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2500);
      toast('Deck exporté (' + cards2.length + ' cartes).', 'success');
    } catch (e) {
      toast(e.message || e, 'error', 4200);
    }
  }

  async function updateDeckFile(fileId, newName) {
    const { updateFileFields } = await import('../storage/repo.js');
    await updateFileFields(fileId, { name: newName });
  }

  async function deleteDeck() {
    const okd = await confirmDialog({
      title: `Supprimer « ${deck.name} » ?`,
      message: `${cards.length} carte(s) et leur historique seront supprimés. Action définitive.`,
      confirmLabel: 'Supprimer le deck',
    });
    if (!okd) return;
    const f = await getFileByDeckId(deck.id);
    if (f) await deleteFiles([f.id]);
    toast('Deck supprimé.', 'success');
    location.hash = f?.folderId ? `#/files/${f.folderId}` : '#/files';
  }

  function rebuild() {
    reroute();
  }

  function sanitizeFileName(s) {
    return String(s).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || 'deck';
  }
}

void loadAllFiles;
void loadAllDecks;
void listChildFiles;
void putCard;
