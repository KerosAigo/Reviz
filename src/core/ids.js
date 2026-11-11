/** Identifiants stables (UUID v4 via WebCrypto). */
export function newId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  // Garde-fou pour les navigateurs anciens : UUID v4 manuel.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (window.crypto.getRandomValues(new Uint8Array(1))[0] & 15) >>> 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function nowIso() { return new Date().toISOString(); }
