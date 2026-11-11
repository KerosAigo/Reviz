/**
 * Extraction de texte pour l'import intelligent (étape 1 du générateur).
 *
 * DEUX moteurs, annoncés honnêtement dans l'UI :
 *  - « pdfjs-textlayer »  : couche texte du PDF via PDF.js vendored (local, sans réseau).
 *  - « service-externe »  : UNIQUEMENT si l'utilisateur a configuré une URL de
 *    service OCR dans les réglages (désactivé par défaut — aucune clé n'est
 *    jamais fournie par Reviz). Le corps POSTé est l'image brute ; la réponse
 *    attendue est du texte (text/plain) ou un JSON { text: "..." }.
 *
 * Il n'existe AUCUN moteur OCR local embarqué : pour une image sans service
 * configuré, le message est explicite et le repli est le collage manuel.
 *
 * Le fichier source n'est JAMAIS modifié (lecture seule des octets).
 */

/** Nettoyage DÉTERMINISTE du texte extrait (aucune réécriture de contenu) :
 *  - fin de ligne unifiées ;
 *  - mots coupés par une césure en fin de ligne recollés (« analys-\nse ») ;
 *  - espaces multiples réduits ;
 *  - puces de début de ligne neutralisées (•, -, –, *) sans toucher au reste. */
export function sanitizeExtracted(raw) {
  let t = String(raw ?? '').replace(/\r\n?/g, '\n');
  // césure : « mot- \n suite » → « mot-suite » (les vraies césures typographiques)
  t = t.replace(/([A-Za-zÀ-ÿ])-\n([a-zÀ-ÿ])/g, '$1$2\n');
  // puces décoratives en début de ligne
  t = t.replace(/^[ \t]*[•–—*][ \t]+/gm, '');
  // espaces multiples (hors débuts de ligne conservés pour la structure)
  t = t.replace(/[ \t]{2,}/g, ' ');
  // plus de 2 sauts de ligne consécutifs → 2 (séparateur de paragraphe)
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

/**
 * Extrait le texte d'un PDF via la couche texte PDF.js.
 * @param {Uint8Array} bytes
 * @param {{onProgress?: (done:number,total:number)=>void}} [opts]
 * @returns {Promise<{engine:'pdfjs-textlayer', text:string, pages:number, empty:boolean}>}
 *   `empty` = le PDF n'a aucune couche texte (scan papier) — message explicite attendu.
 */
export async function extractPdfText(bytes, { onProgress } = {}) {
  const pdfjsLib = await import('../../vendor/pdfjs/pdf.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.mjs';
  const task = pdfjsLib.getDocument({
    data: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
    cMapUrl: '/vendor/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/vendor/pdfjs/standard_fonts/',
    wasmUrl: '/vendor/pdfjs/wasm/',
  });
  const doc = await task.promise;

  const pageTexts = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let line = '';
    let lastY = null;
    const out = [];
    for (const item of content.items) {
      if (typeof item.str !== 'string') continue;
      const y = item.transform ? item.transform[5] : null;
      // un écart vertical net = nouvelle ligne (sinon on colle)
      if (lastY != null && y != null && Math.abs(y - lastY) > 2 && line) {
        out.push(line); line = '';
      }
      if (item.str) {
        // espace inséré si le fragment n'est pas collé au précédent
        if (line && !/\s$/.test(line) && !/^\s/.test(item.str)) line += ' ';
        line += item.str;
      }
      if (item.hasEOL && line) { out.push(line); line = ''; }
      lastY = y;
    }
    if (line) out.push(line);
    pageTexts.push(out.join('\n'));
    if (page.cleanup) { try { page.cleanup(); } catch (_) { /* page déjà libérée */ } }
    onProgress && onProgress(p, doc.numPages);
    if (pageTexts.length >= 500) break; // garde-fou : PDFs très volumineux
  }
  if (task.destroy) { try { await task.destroy(); } catch (_) { /* déjà libéré */ } }
  else if (doc.cleanup) { try { doc.cleanup(); } catch (_) { /* noop */ } }
  const joined = pageTexts.join('\n\n');
  return { engine: 'pdfjs-textlayer', text: joined, pages: pageTexts.length, empty: joined.trim() === '' };
}

/**
 * Envoie l'image à un service OCR externe configuré PAR L'UTILISATEUR.
 * Aucune URL par défaut, aucune clé fournie par Reviz, aucun identifiant.
 * @param {Uint8Array} bytes   image brute
 * @param {string} mimeType    'image/png' etc.
 * @param {string} url         URL du service (réglages)
 * @returns {Promise<{engine:'service-externe', text:string}>}
 *   Rejette avec un message explicite si le service ne répond pas du texte.
 */
export async function ocrViaService(bytes, mimeType, url) {
  const target = String(url || '').trim();
  if (!/^https?:\/\//i.test(target)) {
    throw new Error('URL de service OCR invalide (doit commencer par http:// ou https://).');
  }
  let resp;
  try {
    resp = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': mimeType || 'application/octet-stream' },
      body: bytes instanceof Blob ? bytes : new Blob([bytes], { type: mimeType || 'application/octet-stream' }),
    });
  } catch (e) {
    throw new Error(`Le service OCR n'a pas répondu (${e.message || e}). Vérifiez l'URL et que le service accepte POST.`);
  }
  if (!resp.ok) throw new Error(`Le service OCR a répondu ${resp.status} ${resp.statusText || ''}.`);
  const raw = await resp.text();
  let text = raw;
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const j = JSON.parse(trimmed);
      text = typeof j.text === 'string' ? j.text
        : typeof j.content === 'string' ? j.content
          : typeof j.result === 'string' ? j.result : raw;
    } catch (_) { /* réponse non-JSON : texte brut conservé */ }
  }
  if (!text.trim()) throw new Error('Le service OCR a renvoyé une réponse vide.');
  return { engine: 'service-externe', text };
}

/** Description honnête des moteurs (affichée dans l'assistant). */
export const ENGINE_LABELS = {
  'pdfjs-textlayer': 'Couche texte du PDF (local)',
  'service-externe': 'Service OCR externe (votre URL)',
  'collage-manuel': 'Collage manuel',
};
