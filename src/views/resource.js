/**
 * Consultation d'une ressource (#/view/&lt;fileId&gt;).
 * PDF → PDF.js · Image/GIF → visionneuse · Simulation → iframe sandboxée ·
 * Fiche → rendu markdown+LaTeX · Deck → éditeur.
 */
import { el, toast } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { getFile, getBlob } from '../storage/repo.js';
import { getBlobUrl } from '../render/bloburls.js';
import { openPdf } from '../viewers/pdf-viewer.js';
import { openImageViewer } from '../viewers/image-viewer.js';
import { openSimViewer } from '../viewers/sim-viewer.js';
import { renderFiche } from '../viewers/fiche-viewer.js';

function bytesToText(bytes) {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

export async function resourceView(viewEl, hash) {
  const fileId = (hash.match(/^#\/view\/([\w-]+)/) || [])[1];
  if (!fileId) { location.hash = '#/files'; return; }

  const file = await getFile(fileId);
  viewEl.textContent = '';
  if (!file) {
    viewEl.appendChild(el('div.panel', {}, [
      el('h3.panel-title', {}, ['Fichier introuvable']),
      el('button.btn.primary', { onclick: () => { location.hash = '#/files'; } }, ['Retour aux fichiers']),
    ]));
    return;
  }

  const caption = el('p.viewer-sub', { style: 'color:var(--c-text-dim);font-size:.8rem;margin:0 0 10px;display:flex;align-items:center;gap:8px' }, [
    icon(file.kind === 'pdf' ? 'pdf' : file.kind === 'image' ? 'image' : file.kind === 'sim' ? 'code' : 'note', 'i16'),
    el('span', {}, [file.name]),
    (file.kind === 'pdf' || file.kind === 'image') ? el('button.btn.btn-sm', {
      title: 'Créer des flashcards / QCM / trous… à partir de ce document (lecture seule)',
      onclick: () => { location.hash = `#/import/${file.id}`; },
    }, [icon('sparkle', 'i16'), el('span', {}, ['Générer des révisions'])]) : null,
    el('button.btn.btn-sm.ghost', { style: 'margin-left:auto', onclick: () => { location.hash = file.folderId ? `#/files/${file.folderId}` : '#/files'; } }, ['Retour']),
  ]);
  const body = el('div');
  viewEl.appendChild(caption);
  viewEl.appendChild(body);

  switch (file.kind) {
    case 'pdf': {
      const blobRec = await getBlob(file.blobId);
      if (!blobRec) { errorPane(body, 'Les données du PDF sont absentes de la base locale.'); return; }
      const bytes = blobRec.bytes instanceof Blob ? new Uint8Array(await blobRec.bytes.arrayBuffer()) : new Uint8Array(blobRec.bytes);
      let handle = null;
      try {
        handle = await openPdf(body, bytes, file.name);
      } catch (e) {
        errorPane(body, `Impossible d'ouvrir ce PDF : ${e.message || e}`);
      }
      return () => handle?.destroy();
    }
    case 'image': {
      const url = await getBlobUrl(file.blobId);
      if (!url) { errorPane(body, 'Image introuvable dans la base locale.'); return; }
      openImageViewer(body, url);
      return;
    }
    case 'sim': {
      const blobRec = await getBlob(file.blobId);
      if (!blobRec) { errorPane(body, 'Le fichier de simulation est absent de la base locale.'); return; }
      const html = bytesToText(blobRec.bytes instanceof Blob ? await blobRec.bytes.arrayBuffer() : blobRec.bytes);
      openSimViewer(body, html, file.name);
      return;
    }
    case 'fiche': {
      const txt = file.text || '';
      renderFiche(body, txt);
      return;
    }
    case 'deck': {
      // Un deck s'ouvre par l'éditeur au clic (les cartes y sont modifiables)
      if (file.deckId) location.hash = `#/deck/${file.deckId}`;
      return;
    }
    default:
      errorPane(body, `Type de ressource non pris en charge : ${file.kind}`);
  }
}

function errorPane(body, msg) {
  body.appendChild(el('div.viewer-warn', {}, [
    icon('info', 'i18'),
    el('div', {}, [msg]),
  ]));
  toast(msg, 'error', 4200);
}
