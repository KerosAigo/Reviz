/**
 * Sauvegarde complète `.revizbak` — création, validation, restauration.
 *
 * Conteneur : archive ZIP (fflate), distincte du `.reviz` (elle contient
 * davantage : arborescence complète, réglages, statistiques, TOUS les médias) :
 *   manifest.json          format 'revizbak', version, date, compteurs, liste blobs
 *   data/folders.json      arborescence de dossiers
 *   data/files.json        entrées d'arborescence (tous types de ressources)
 *   data/decks.json        métadonnées des decks
 *   data/cards.json        cartes (block refs par blobId)
 *   data/stats.json        historiques de répétition espacée (clé cardId)
 *   data/settings.json     réglages
 *   data/log.json          journal des réponses (OPTIONNEL — sauvegardes v1 sans)
 *   data/exams.json        historique des examens (OPTIONNEL — sauvegardes sans exams)
 *   data/blobs-blobId.bin  contenu binaire de chaque blob
 *
 * Sécurité : mêmes protections que l'import `.reviz` (filtrage zip-bomb AVANT
 * décompression, limites, chemins). La restauration est TOUJOURS un
 * remplacement complet après confirmation explicite (aucune fusion implicite).
 */
import { unzipSync, zipSync, strToU8, strFromU8 } from '../../vendor/fflate/fflate.mjs';
import {
  BAK_FORMAT, BAK_FORMAT_VERSION, LIMITS,
} from '../core/constants.js';
import { ValidationError } from '../core/errors.js';
import { safePath } from '../format/reviz.js';
import {
  loadFolderTree, loadAllFiles, loadAllDecks, loadAllCards, getAllStats,
  loadAllSettings, restoreDatabaseSnapshot, getAllReviewLog, getAllExams,
} from '../storage/repo.js';

const DATA_FILES = ['folders', 'files', 'decks', 'cards', 'stats', 'settings'];
const OPTIONAL_DATA_FILES = ['log'];

function assertSize(bytes) {
  if (bytes.length > LIMITS.maxFileBytes) {
    throw new ValidationError(`Archive trop volumineuse (${(bytes.length / 1048576).toFixed(1)} Mo, limite ${(LIMITS.maxFileBytes / 1048576).toFixed(0)} Mo).`);
  }
}

/** Lit une archive non fiable avec les protections partagées. */
function openArchive(bytes, label) {
  try {
    let uncompressedTotal = 0;
    let entries = 0;
    return unzipSync(bytes, {
      filter: (file) => {
        entries += 1;
        if (entries > LIMITS.maxArchiveEntries) throw new ValidationError('Archive suspecte : trop d\u2019entrées.');
        if (!file.originalSize) return true;
        uncompressedTotal += file.originalSize;
        if (uncompressedTotal > LIMITS.maxArchiveUncompressed) throw new ValidationError('Archive suspecte : contenu décompressé trop volumineux (possible archive-piège).');
        if (file.originalSize > LIMITS.maxFileBytes) throw new ValidationError(`Fichier trop volumineux dans l'archive : ${file.name}`);
        if (!safePath(file.name)) throw new ValidationError(`Chemin non autorisé dans l'archive : ${file.name}`);
        return true;
      },
    });
  } catch (e) {
    throw new ValidationError(e instanceof ValidationError ? e.message : `Archive illisible ou corrompue (pas un fichier ${label} valide ?).`, e);
  }
}

function readJson(archive, name) {
  const rec = archive[name];
  if (!rec) return null;
  try {
    return JSON.parse(strFromU8(rec));
  } catch (e) {
    throw new ValidationError(`${name} n'est pas du JSON valide.`, e);
  }
}

// ------------------------------------------------------------------ Création

/**
 * Lit TOUTE la base et construit l'archive `.revizbak`.
 * @returns {Promise<{bytes:Uint8Array, summary:{folders,files,decks,cards,blobs,stats,settings}}>}
 */
export async function createBackup() {
  const [tree, files, decks, cards, stats, settings, reviewLog, exams] = await Promise.all([
    loadFolderTree(), loadAllFiles(), loadAllDecks(), loadAllCards(), getAllStats(), loadAllSettings(), getAllReviewLog(), getAllExams(),
  ]);
  const folders = tree.folders;

  // Blobs référencés (cartes + fichiers'entrées d'arborescence).
  const blobIds = new Set();
  for (const c of cards) {
    for (const face of [c.front, c.back]) for (const b of face || []) if (b.blobId) blobIds.add(b.blobId);
  }
  for (const f of files) if (f.blobId) blobIds.add(f.blobId);

  const blobRecords = [];
  const blobsOut = [];
  for (const id of blobIds) {
    const { getBlob } = await import('../storage/repo.js');
    const rec = await getBlob(id);
    if (!rec) continue; // blob manquant signalé au restaurateur (récupéré sinon)
    const u8 = rec.bytes instanceof Uint8Array ? rec.bytes : new Uint8Array(rec.bytes?.buffer ?? rec.bytes);
    blobRecords.push({
      id: rec.id, mimeType: rec.mimeType, size: u8.length,
      nameHint: rec.nameHint || '', createdAt: rec.createdAt,
    });
    blobsOut.push(rec);
  }

  const manifest = {
    format: BAK_FORMAT,
    formatVersion: BAK_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    counts: {
      folders: folders.length, files: files.length, decks: decks.length,
      cards: cards.length, blobs: blobRecords.length, stats: stats.length, settings: settings.length,
      log: reviewLog.length, exams: exams.length,
    },
    blobs: blobRecords,
  };

  const entries = { 'manifest.json': strToU8(JSON.stringify(manifest, null, 2)) };
  for (const name of DATA_FILES) {
    const payload = { folders, files, decks, cards, stats, settings }[name];
    entries[`data/${name}.json`] = strToU8(JSON.stringify(payload));
  }
  entries['data/log.json'] = strToU8(JSON.stringify(reviewLog));
  entries['data/exams.json'] = strToU8(JSON.stringify(exams));
  for (const rec of blobsOut) {
    const u8 = rec.bytes instanceof Uint8Array ? rec.bytes : new Uint8Array(rec.bytes?.buffer ?? rec.bytes);
    entries[`data/blobs/${rec.id}`] = u8;
  }

  const bytes = zipSync(entries, { mtime: new Date(), level: 6 });
  return { bytes, summary: manifest.counts };
}

/** Nom de fichier de sauvegarde lisible et triable. */
export function backupFileName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `reviz-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.revizbak`;
}

// ------------------------------------------------------------------ Validation

/**
 * Valide une archive `.revizbak` et retourne son contenu prêt pour la
 * restauration + un résumé pour la confirmation utilisateur.
 * La restauration proprement dite reste un acte séparé et explicite.
 */
export async function validateBackup(bytes) {
  assertSize(bytes);
  const archive = openArchive(bytes, '.revizbak');
  const manifest = readJson(archive, 'manifest.json');
  if (!manifest || typeof manifest !== 'object') throw new ValidationError('Sauvegarde incomplète : manifest.json absent.');
  if (manifest.format !== BAK_FORMAT) {
    throw new ValidationError(`Ce n'est pas une sauvegarde Reviz (format « ${manifest.format ?? '?'} » au lieu de « ${BAK_FORMAT} »).`);
  }
  if (typeof manifest.formatVersion !== 'number' || manifest.formatVersion > BAK_FORMAT_VERSION) {
    throw new ValidationError(`Version de sauvegarde non prise en charge (${manifest.formatVersion ?? '?'}).`);
  }

  const data = {};
  for (const name of DATA_FILES) {
    const parsed = readJson(archive, `data/${name}.json`);
    if (!Array.isArray(parsed)) throw new ValidationError(`Sauvegarde incomplète : data/${name}.json absent ou illisible.`);
    data[name] = parsed;
  }
  // journal des réponses : optionnel (sauvegardes antérieures sans log)
  data.log = readJson(archive, 'data/log.json');
  if (!Array.isArray(data.log)) data.log = [];
  // historique des examens : optionnel (sauvegardes antérieures sans exams)
  data.exams = readJson(archive, 'data/exams.json');
  if (!Array.isArray(data.exams)) data.exams = [];

  // Blobs déclarés : chaque binaire doit être présent.
  const blobBytes = new Map();
  for (const b of manifest.blobs || []) {
    const rec = archive[`data/blobs/${b.id}`];
    if (!rec) throw new ValidationError(`Média manquant dans la sauvegarde : ${b.id.slice(0, 8)}…`);
    blobBytes.set(b.id, rec);
  }

  // Cohérence : chaque blobId référencé par cartes ou fichiers doit être déclaré.
  const declared = new Set([...blobBytes.keys()]);
  const orphanRefs = [];
  for (const c of data.cards) {
    for (const face of [c.front, c.back]) for (const b of face || []) if (b.blobId && !declared.has(b.blobId)) orphanRefs.push(`${c.id.slice(0, 8)}:${b.blobId.slice(0, 8)}`);
  }
  for (const f of data.files) if (f.blobId && !declared.has(f.blobId)) orphanRefs.push(`${f.id.slice(0, 8)}:${f.blobId.slice(0, 8)}`);

  return {
    manifest, data, blobBytes,
    summary: { ...manifest.counts, backupDate: manifest.createdAt, orphanRefs },
  };
}

// ------------------------------------------------------------------ Restauration

/**
 * Restaure (REMPLACE toute la base) depuis un backup validé.
 * @param {object} validated résultat de validateBackup()
 * @returns {Promise<{restored:{...counts}}>}
 */
export async function restoreBackup(validated) {
  const { data, blobBytes } = validated;
  const blobRecords = (validated.manifest.blobs || []).map((b) => ({
    id: b.id, bytes: blobBytes.get(b.id), mimeType: b.mimeType,
    size: b.size, nameHint: b.nameHint || '', createdAt: b.createdAt,
  }));
  await restoreDatabaseSnapshot({
    folders: data.folders, files: data.files, decks: data.decks,
    cards: data.cards, blobs: blobRecords, stats: data.stats, settings: data.settings,
    reviewLog: data.log, exams: data.exams,
  });
  return { restored: validated.manifest.counts };
}

/** Déclenche le téléchargement navigateur d'un sauvegarde générée. */
export function downloadBackup(bytes) {
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = backupFileName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

/**
 * Configure un <input type=file> pour choisir un .revizbak.
 * @returns {Promise<File|null>}
 */
export function pickBackupFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.revizbak,application/octet-stream';
    input.onchange = () => resolve(input.files[0] || null);
    // annulé par l'utilisateur : heuristique focus post-fermeture
    document.body.appendChild(input);
    input.style.display = 'none';
    window.addEventListener('focus', () => setTimeout(() => {
      if (input.isConnected) { input.remove(); resolve(null); }
    }, 400), { once: true });
    input.click();
  });
}
