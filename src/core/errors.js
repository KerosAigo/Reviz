/**
 * Erreurs applicatives avec messages orientés utilisateur.
 * `RevizError.cause` permet de conserver l'erreur technique d'origine.
 */
export class RevizError extends Error {
  constructor(message, { code = 'generic', cause = null } = {}) {
    super(message);
    this.name = 'RevizError';
    this.code = code;
    this.cause = cause;
  }
}

export class ValidationError extends RevizError {
  constructor(message, cause = null) { super(message, { code: 'validation', cause }); }
}

export class QuotaError extends RevizError {
  constructor(message = "Stockage du navigateur plein : impossible d'enregistrer. Exportez une sauvegarde puis supprimez des fichiers.", cause = null) {
    super(message, { code: 'quota', cause });
  }
}

/** Transforme une erreur IndexedDB quelconque en erreur compréhensible. */
export function mapStorageError(err) {
  if (!err) return new QuotaError();
  if (err.name === 'QuotaExceededError') return new QuotaError(undefined, err);
  if (err.name === 'InvalidStateError') return new QuotaError("La base de données n'est pas accessible (navigation privée ?).", err);
  return new RevizError(`Erreur de stockage : ${err.message || err}`, { code: 'storage', cause: err });
}
