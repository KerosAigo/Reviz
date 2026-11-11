/**
 * Cache d'Object URLs pour les médias (images/GIF/PDF/SIM) stockés dans IndexedDB.
 * Les URLs sont créées à la demande, mises en cache (LRU) et révoquées
 * automatiquement pour éviter les fuites mémoire.
 */
import { getBlob } from '../storage/repo.js';

const MAX_CACHE = 120;
const cache = new Map(); // blobId -> { url, promise }

async function buildUrl(blobId) {
  const rec = await getBlob(blobId);
  if (!rec) return null;
  return URL.createObjectURL(rec.bytes instanceof Blob ? rec.bytes : new Blob([rec.bytes], { type: rec.mimeType }));
}

export async function getBlobUrl(blobId) {
  if (!blobId) return null;
  const hit = cache.get(blobId);
  if (hit) {
    hit.hits = (hit.hits || 0) + 1;
    return hit.ready ? hit.url : pin(blobId, hit);
  }
  return pin(blobId, { ready: false, promise: buildUrl(blobId), hits: 1 });
}

function pin(blobId, entry) {
  if (entry.promise) {
    entry.ready = entry.ready || ((async () => {
      const url = await entry.promise;
      entry.url = url;
      return url;
    })());
  }
  cache.set(blobId, entry);
  if (cache.size > MAX_CACHE) evictOld();
  return entry.ready;
}

function evictOld() {
  const victims = [...cache.entries()].sort((a, b) => (a[1].hits || 0) - (b[1].hits || 0));
  for (const [id, e] of victims.slice(0, Math.max(1, cache.size - MAX_CACHE))) {
    if (e.url) URL.revokeObjectURL(e.url);
    cache.delete(id);
  }
}

/** Préchauffe une liste d'IDs (utile avant le rendu d'une session). */
export async function prefetchBlobUrls(ids) {
  await Promise.all([...new Set(ids)].map((id) => getBlobUrl(id)));
}
