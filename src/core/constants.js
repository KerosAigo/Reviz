/**
 * Constantes centrales de l'application.
 * Tous les chiffres "limites" sont regroupés ici pour être configurables en un seul endroit.
 */

/** Version du schéma de la base IndexedDB locale. */
export const DB_NAME = 'reviz';
export const DB_VERSION = 3;

/** Format natif .reviz */
export const REVIZ_FORMAT = 'reviz';
/** v2 : cartes typées (type + data). v1 lue sans perte (cartes classiques). */
export const REVIZ_FORMAT_VERSION = 2;

/** Format de sauvegarde globale .revizbak */
export const BAK_FORMAT = 'revizbak';
export const BAK_FORMAT_VERSION = 1;

/** Limites de sécurité (importations et archives). */
export const LIMITS = {
  /** Taille max d'un fichier importé (octets). */
  maxFileBytes: 50 * 1024 * 1024,
  /** Volume max total après décompression d'une archive (octets). */
  maxArchiveUncompressed: 200 * 1024 * 1024,
  /** Nombre max d'entrées dans une archive. */
  maxArchiveEntries: 3000,
  /** Nombre max de cartes par deck importé. */
  maxImportedCards: 5000,
  /** Nombre max de dossiers évités récursivement... non borné (usage personnel). */
};

/** Types MIME d'images acceptés pour les cartes et les médias. */
export const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/** Apparences de fichiers acceptées (magic bytes) → type. */
export const FILE_MAGIC = [
  { type: 'zip', bytes: [0x50, 0x4b, 0x03, 0x04] },
  { type: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { type: 'png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { type: 'jpeg', bytes: [0xff, 0xd8, 0xff] },
  { type: 'gif', bytes: [0x47, 0x49, 0x46, 0x38] }, // GIF8
];

/** Types de ressources manipulables dans l'arborescence. */
export const FILE_KINDS = {
  deck: { label: 'Deck de flashcards', icon: 'cards' },
  pdf: { label: 'Document PDF', icon: 'pdf' },
  image: { label: 'Image', icon: 'image' },
  sim: { label: 'Simulation HTML', icon: 'code' },
  fiche: { label: 'Fiche', icon: 'note' },
};

/** Type MIME explicite pour les fichiers .reviz ( cartel commun au navigateur). */
export const REVIZ_MIME = 'application/reviz';

/** Valeurs par défaut de la session de révision (modifiables dans Réglages). */
export const DEFAULT_SETTINGS = {
  countdownSeconds: 10,
  maxCardsPerSession: 30,
  associationPairsDesktop: 6,
  associationPairsMobile: 4,
  defaultDirection: 'front-to-back',
  defaultFreeMode: 'both', // 'free' | 'match' | 'both'
  // URL d'un service OCR EXTERNE fourni par l'utilisateur (vide = désactivé).
  // Reviz n'embarque aucun moteur OCR et ne fournit AUCUNE clé : la requête
  // est un simple POST de l'image brute vers cette URL.
  ocrUrl: '',
};
