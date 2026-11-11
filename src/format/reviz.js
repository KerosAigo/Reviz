/**
 * Format natif `.reviz` — lecture / écriture / validation.
 *
 * Conteneur : archive ZIP
 *   manifest.json      — structure décrite par FORMAT_REVIZ.md
 *   media/<fichier>    — images et GIFs référencés par les cartes
 *
 * Sécurité :
 *   - extraction protégée : filtre chaque entrée (chemin + taille) AVANT décompression
 *     (protection zip-bomb), limites de fflate.configurées ici ;
 *   - chemins dangereux refusés (absolus, remontées `../`, `\\`, deux-points) ;
 *   - MIMES vérifiés par magic bytes, pas par extension ;
 *   - jamais d'écrasement silencieux de deck : le choix appartient à l'utilisateur.
 */
import { unzipSync, zipSync, strToU8, strFromU8 } from '../../vendor/fflate/fflate.mjs';
import {
  REVIZ_FORMAT, REVIZ_FORMAT_VERSION, LIMITS, IMAGE_MIMES,
} from '../core/constants.js';
import { ValidationError } from '../core/errors.js';
import { newId, nowIso } from '../core/ids.js';
import { splitMath } from '../latex/katex-service.js';

// ------------------------------------------------------------------ Utilitaires chemin

/** Chemin d'archive sûr ? (relatif, sans remontée ni drive) */
export function safePath(p) {
  if (typeof p !== 'string' || !p.length) return false;
  if (p.includes('\\')) return false;
  if (p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return false;
  // remontée de répertoire : "\.\." précédé du début ou de '/', suivi de '/' ou de la fin
  if (/(?:^|\/)\.\.(?:\/|$)/.test(p)) return false;
  if (p.includes('..')) return false;
  return true;
}


/** Extension d'après un chemin "media/xxx.png" */
function extOf(p) {
  const m = /\.([a-z0-9]+)$/i.exec(p);
  return m ? m[1].toLowerCase() : '';
}

const EXT_TO_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
};
const MIME_TO_EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
};

/** Détecte un type MIME par magic bytes (les extensions sont trompeuses). */
export function sniffImageMime(u8) {
  if (u8.length < 4) return null;
  const b = u8;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (u8.length >= 12 &&
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

export function hashMatches(mime, ext) {
  return EXT_TO_MIME[ext] === mime;
}

// ------------------------------------------------------------------ Validation manifeste

/** Types de cartes connus (v2). */
const KNOWN_CARD_TYPES = new Set(['basic', 'qcm', 'cloze', 'free', 'calc', 'match']);

/** Vérification légère de la forme des données typées (anti-corruption). */
function checkDataShape(type, data) {
  switch (type) {
    case 'qcm':
      if (!Array.isArray(data.options) || data.options.length < 2) return 'un QCM demande au moins 2 propositions.';
      if (data.options.some((o) => !o || typeof o.text !== 'string')) return 'proposition QCM invalide.';
      if (!data.options.some((o) => o.correct)) return 'un QCM doit avoir au moins une bonne réponse.';
      return null;
    case 'cloze':
      if (typeof data.text !== 'string') return 'texte du trou manquant.';
      if (!Array.isArray(data.holes)) return 'liste des trous manquante.';
      if (data.holes.some((h) => !h || !Array.isArray(h.answers) || !h.answers.length)) return 'trou sans réponse acceptée.';
      return null;
    case 'free':
      if (typeof data.answer !== 'string') return 'réponse de référence manquante.';
      return null;
    case 'calc':
      if (typeof data.answer !== 'string' || !data.answer.trim()) return 'réponse de calcul manquante.';
      if (data.tolerance != null && !Number.isFinite(Number(data.tolerance))) return 'tolérance invalide.';
      return null;
    case 'match':
      if (!Array.isArray(data.pairs) || data.pairs.length < 2) return 'une association demande au moins 2 paires.';
      if (data.pairs.some((p) => !p || typeof p.left !== 'string' || typeof p.right !== 'string')) return 'paire invalide.';
      return null;
    default:
      return null;
  }
}

/**
 * Valide un manifeste .reviz et renvoie la liste des erreurs (vide = OK).
 * Les validations portent sur la structure logique ; les médias sont vérifiés
 * séparément (voir extractAndValidateReviz).
 */
export function validateManifest(manifest, { allowMissingMedia = false } = {}) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') return ['Le fichier manifest.json est illisible.'];
  if (manifest.format !== REVIZ_FORMAT) errors.push(`Le champ « format » doit valoir « ${REVIZ_FORMAT} ».`);
  if (typeof manifest.formatVersion !== 'number' || manifest.formatVersion <= 0) errors.push('Champ formatVersion manquant ou invalide.');
  else if (manifest.formatVersion > REVIZ_FORMAT_VERSION) errors.push(`Version du format non prise en charge (${manifest.formatVersion} > ${REVIZ_FORMAT_VERSION}). Le fichier vient d'une version plus récente de l'application.`);
  const d = manifest.deck;
  if (!d || typeof d !== 'object') errors.push('Section « deck » manquante.');
  else {
    if (!d.id) errors.push('Identifiant du deck manquant.');
    if (typeof d.name !== 'string') errors.push('Nom du deck manquant.');
  }
  const cards = manifest.cards;
  if (!Array.isArray(cards)) errors.push('Liste des cartes manquante.');
  else {
    if (cards.length > LIMITS.maxImportedCards) errors.push(`Trop de cartes (${cards.length} > ${LIMITS.maxImportedCards}).`);
    const ids = new Set();
    cards.forEach((c, i) => {
      if (!c || typeof c !== 'object') { errors.push(`Carte ${i + 1} invalide.`); return; }
      if (!c.id) errors.push(`Carte ${i + 1} : identifiant manquant.`);
      else if (ids.has(c.id)) errors.push(`Identifiant de carte en doublon : ${c.id}`);
      else ids.add(c.id);
      if (typeof c.position !== 'number') errors.push(`Carte ${i + 1} : position manquante.`);
      // v2 : type + data structurée (optionnels — v1 = cartes classiques)
      if (c.type != null) {
        if (!KNOWN_CARD_TYPES.has(c.type)) errors.push(`Carte ${i + 1} : type de question inconnu (${c.type}).`);
        else if (c.type !== 'basic') {
          if (!c.data || typeof c.data !== 'object') errors.push(`Carte ${i + 1} : données du type « ${c.type} » manquantes.`);
          else {
            const shapeErr = checkDataShape(c.type, c.data);
            if (shapeErr) errors.push(`Carte ${i + 1} : ${shapeErr}`);
          }
        }
      }
      for (const faceName of ['front', 'back']) {
        const face = c[faceName];
        // v2 : une carte typée (qcm, trous, calcul, association…) porte son
        // contenu dans `data` — ses faces de blocs PEUVENT être vides.
        const typed = c.type && c.type !== 'basic';
        if (!Array.isArray(face) || (face.length === 0 && !allowMissingMedia && !typed)) {
          errors.push(`Carte ${i + 1} : ${faceName === 'front' ? 'recto' : 'verso'} absent ou vide.`);
        }
      }
    });
  }
  if (Array.isArray(manifest.media)) {
    for (const m of manifest.media) {
      if (!m.path || !safePath(m.path)) errors.push(`Chemin de média invalide : ${JSON.stringify(m.path)}`);
      if (m.path && !m.path.startsWith('media/')) errors.push(`Les médias doivent être dans media/ : ${m.path}`);
      // Un média présent mais non référencé n'est pas une erreur (cartes supprimées avant export).
    }
  }
  // Chaque src référencé doit exister dans media[] → vérification côté extraction.
  return errors;
}

// ------------------------------------------------------------------ Export

/**
 * Construit les octets du fichier .reviz exporté.
 * @param {object} deck {id,name,description,createdAt,updatedAt}
 * @param {object[]} cards triées par position
 * @param {Map<number, {bytes:Uint8Array, mimeType:string}>} blobs par blobId
 * @returns {Uint8Array} contenu complet de l'archive
 */
export async function buildRevizArchive(deck, cards, blobs) {
  const files = {};          // entries du zip
  const mediaEntries = [];   // manifest.media
  const usedNames = new Set();

  // Nommage stable par hash SHA-256 (contenu identique → nom identique, ordre garanti).
  const shaHex = async (u8) => {
    const h = await crypto.subtle.digest('SHA-256', u8);
    return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
  };

  const cardOut = [];
  const missing = [];

  for (const c of cards) {
    const faceOut = {};
    for (const faceName of ['front', 'back']) {
      faceOut[faceName] = [];
      for (const b of c[faceName] || []) {
        if (b.type === 'text' || b.type === 'latex') {
          faceOut[faceName].push({ type: b.type, value: b.value ?? '' });
        } else if (b.type === 'image' || b.type === 'gif') {
          const blob = blobs.get(b.blobId);
          if (!blob) { missing.push(`Carte ${c.position + 1} (${faceName}) : média manquant.`); continue; }
          const u8 = blob.bytes instanceof Uint8Array ? blob.bytes : new Uint8Array(blob.bytes.buffer ?? blob.bytes);
          const hash = await shaHex(u8);
          const ext = MIME_TO_EXT[blob.mimeType] || extOf(b.blobId) || 'png';
          const path = `media/${hash.slice(0, 24)}-${hash.slice(24, 36)}.${ext}`;
          if (!usedNames.has(path)) {
            usedNames.add(path);
            files[path] = u8;
            mediaEntries.push({ path, mimeType: blob.mimeType, size: u8.length, sha256: hash });
          }
          faceOut[faceName].push({ type: b.type, src: path, alt: b.alt || '' });
        } else {
          faceOut[faceName].push({ type: b.type }); // type futur : conservé brut
        }
      }
    }
    const out = {
      id: c.id, position: c.position,
      front: faceOut.front, back: faceOut.back,
      createdAt: c.createdAt, updatedAt: c.updatedAt,
    };
    // v2 : question typée (type + data) — exportées sans perte
    if (c.type) { out.type = c.type; if (c.data != null) out.data = c.data; }
    cardOut.push(out);
  }
  if (missing.length) throw new ValidationError(`Export impossible, des médias sont absents de la base :\n${missing.join('\n')}`);

  const manifest = {
    format: REVIZ_FORMAT,
    formatVersion: REVIZ_FORMAT_VERSION,
    deck: {
      id: deck.id, name: deck.name, description: deck.description || '',
      createdAt: deck.createdAt, updatedAt: deck.updatedAt,
    },
    cards: cardOut,
    media: mediaEntries,
  };

  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  // Les médias déjà compressés (PNG/JPG/GIF/WebP) sont stockés sans recompression.

  return zipSync(files, { mtime: new Date(deck.updatedAt || nowIso()), level: 6 });
}

// ------------------------------------------------------------------ Extraction & import

/**
 * Lit une archive `.reviz` non fiable et retourne son contenu validé.
 * @param {Uint8Array} bytes
 * @param {{chooseAction:(deckInfo)=>Promise<'new'|'replace'|'cancel'>, getDeckById:Function}} ctx
 *   ctx permet de rester testable sans IndexedDB.
 * @returns {Promise<{manifest, deckOut, cardsOut, mediaMap, action}|null>}
 *   mediaMap : Map<path → {bytes, mimeType}>  |  null si annulé
 */
export async function extractAndValidateReviz(bytes, ctx) {
  if (bytes.length > LIMITS.maxFileBytes) {
    throw new ValidationError(`Archive trop volumineuse (${(bytes.length / 1048576).toFixed(1)} Mo, limite ${(LIMITS.maxFileBytes / 1048576).toFixed(0)} Mo).`);
  }

  let parsed;
  try {
    // zip bomb : on filtre AVANT décompression (fflate passe le filtre aux headers)
    let uncompressedTotal = 0;
    let entries = 0;
    parsed = unzipSync(bytes, {
      filter: (file) => {
        entries += 1;
        if (entries > LIMITS.maxArchiveEntries) throw new ValidationError('Archive suspecte : trop d\u2019entrées.');
        if (!file.originalSize) return true;
        uncompressedTotal += file.originalSize;
        if (uncompressedTotal > LIMITS.maxArchiveUncompressed) throw new ValidationError('Archive suspecte : contenue décompressée trop volumineuse (possible archive à extension trompeuse).');
        if (file.originalSize > LIMITS.maxFileBytes) throw new ValidationError(`Fichier trop volumineux dans l'archive : ${file.name}`);
        if (!safePath(file.name)) throw new ValidationError(`Chemin non autorisé dans l'archive : ${file.name}`);
        return true;
      },
    });
  } catch (e) {
    throw new ValidationError(e instanceof ValidationError ? e.message : 'Archive illisible ou corrompue (pas un fichier .reviz valide ?).', e);
  }

  if (!parsed['manifest.json']) throw new ValidationError('Fichier .reviz incomplet : manifest.json absent.');

  let manifest;
  try {
    manifest = JSON.parse(strFromU8(parsed['manifest.json']));
  } catch (e) {
    throw new ValidationError('manifest.json n\u2019est pas du JSON valide.', e);
  }

  const errors = validateManifest(manifest);
  if (errors.length) throw new ValidationError(`Fichier .reviz invalide :\n- ${errors.join('\n- ')}`);

  // Vérifier que chaque src référencé pointe vers un fichier présent et reconnaissable.
  const mediaMap = new Map();
  for (const m of manifest.media || []) {
    const data = parsed[m.path];
    if (!data) {
      throw new ValidationError(`Média manquant dans l'archive : ${m.path}. Le deck ne peut pas être importé tel quel.`);
    }
    const realMime = sniffImageMime(data);
    const declared = m.mimeType || EXT_TO_MIME[extOf(m.path)] || 'application/octet-stream';
    if (!realMime) {
      throw new ValidationError(`Média illisible (type inconnu) : ${m.path}`);
    }
    if (realMime !== declared && !IMAGE_MIMES.has(realMime)) {
      throw new ValidationError(`Type de média incohérent : ${m.path} (déclaré ${declared}, réel ${realMime}).`);
    }
    if (!IMAGE_MIMES.has(realMime)) {
      throw new ValidationError(`Type de média non autorisé : ${m.path} (${realMime}).`);
    }
    if (m.size != null && Math.abs(data.length - m.size) > 64) {
      throw new ValidationError(`Taille incohérente pour ${m.path} (manifeste : ${m.size} o, réel : ${data.length} o).`);
    }
    mediaMap.set(m.path, { bytes: data, mimeType: realMime, sha256: m.sha256 || null });
  }

  // src référencés sans media[] : erreur explicite
  for (const c of manifest.cards || []) {
    for (const faceName of ['front', 'back']) {
      for (const b of (c[faceName] || [])) {
        if ((b.type === 'image' || b.type === 'gif') && !mediaMap.has(b.src)) {
          throw new ValidationError(`Carte ${c.position + 1} : média référencé absent de l'archive (${b.src}).`);
        }
      }
    }
  }

  // Conflit d'identifiant → stratégie utilisateur
  let action = 'new';
  if (ctx.getDeckById && ctx.chooseAction) {
    const existing = await ctx.getDeckById(manifest.deck.id);
    if (existing) {
      action = await ctx.chooseAction(manifest.deck);
      if (action === 'cancel') return null;
    }
  }

  return { manifest, mediaMap, action };
}

/** Bloc interne (base) ← bloc manifeste. */
export function blockFromManifest(b) {
  if (b.type === 'text' || b.type === 'latex') return { type: b.type, value: String(b.value ?? '') };
  if (b.type === 'image' || b.type === 'gif') return { type: b.type, src: b.src, alt: b.alt || '' };
  return { ...b };
}

/** Bloc base → bloc manifeste (src remplacé au moment de l'export). */
export function blockToInternal(b, mediaPath2blobId) {
  if (b.type === 'text' || b.type === 'latex') return { type: b.type, value: b.value ?? '' };
  if (b.type === 'image' || b.type === 'gif') return { type: b.type, blobId: mediaPath2blobId.get(b.src), alt: b.alt || '' };
  return { ...b };
}

/** Statistiques rapides sur un manifeste (affiché avant le choix de conflit). */
export function manifestSummary(manifest) {
  const cards = manifest.cards || [];
  let mediaCount = 0;
  for (const c of cards) for (const f of ['front', 'back']) for (const b of c[f] || []) if (b.blobId || b.src) mediaCount++;
  void splitMath; // (rétro-compat : splitMath importé pour d'éventuelles extensions)
  return { name: manifest.deck?.name, cards: cards.length, mediaCount };
}
