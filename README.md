# Reviz — application de révision personnelle

Application web **sans build** (JavaScript vanilla, modules ES) pour réviser :
flashcards `.reviz`, PDF, images, fiches et simulations, avec répétition espacée,
statistiques, rendu LaTeX (KaTeX) et sauvegarde/restauration complète.
Conformément aux documents de référence dans `md/` (spécification fonctionnelle,
format `.reviz`, architecture, sécurité, critères de validation).

## Installation

Prérequis : **Node.js ≥ 18** (aucun paquet npm à installer ; les bibliothèques
tierces sont déjà dans `vendor/`).

1. Copier le dossier de l'application où vous voulez.
2. Double-cliquer **`start.bat`** (ou en console : `node server.mjs`).
3. Ouvrir **http://localhost:8377** dans un navigateur récent (Chrome, Edge, Firefox).

> Un serveur local est nécessaire pour les modules ES et le worker de PDF.js :
> ouvrir `index.html` en `file://` ne fonctionne pas.

## Fonctionnalités

- **Bibliothèque** : dossiers/sous-dossiers, import par glisser-déposer de
  `.reviz`, PDF, images (PNG/JPEG/GIF/WebP), simulations HTML (exécutées dans un
  iframe **sandboxé**), fiches texte avec LaTeX multi-ligne.
- **Decks de flashcards** : création manuelle (recto/verso, blocs texte +
  `$…$`/`$$…$$` LaTeX, images, GIF), édition, réordonnancement, export/import
  `.reviz` (manifest + médias, validés avant restauration).
- **Révisions** : réponse libre chronométrée (compte à rebours réglable, révéler
  avant la fin ou à zéro, « Trouvé ! »/« Pas trouvé ») et association par lots
  (glisser-déposer + tap-tap, modification avant validation, score affiché) ;
  alternance des deux modes. Source : toute la bibliothèque, un dossier (avec
  **toute sa descendance, et elle seule**), ou un deck.
- **Répétition espacée** : SM-2 simplifié à deux niveaux (trouvé / pas trouvé) ;
  la carte retrouvée voit son intervalle croître, l'échec la re-programme à
  10 minutes. Les résultats sont écrits **immédiatement** (aucune perte si le
  navigateur est fermé en séance).
- **Statistiques** : total de révisions, taux de réussite, à réviser
  maintenant/24 h/7 jours, par deck (cliquable), par dossier, par carte.
- **Réglages** : compte à rebours, plafond de cartes/session, tailles de lot
  d'association ordinateur/téléphone, mode et sens par défaut, estimation de
  stockage (`navigator.storage.estimate()`, persistance).
- **Sauvegarde complète** : `.revizbak` (ZIP contenant dossiers, fichiers, decks,
  cartes, médias, statistiques, réglages) téléchargeable et restaurée
  **après confirmation explicite** et validation du fichier.

## Confidentialité et données

Tout reste dans le navigateur (IndexedDB) : rien n'est envoyé sur le réseau.
Simulations HTML exécutées avec `sandbox="allow-scripts"` (accès aux données de
l'application et navigation locale bloqués). Les imports de zip sont protégés
contre les archives-pièges (filtrage avant décompression, tailles et chemins
vérifiés). Voir `md/SECURITE_ET_DONNEES.md` et `docs/ARCHITECTURE.md`.

## Tester

- Sondes Node (aucune dépendance) :
  `node tests/matching-probe.mjs` (logique d'association),
  `node tests/reviz-roundtrip.mjs` (format `.reviz` aller-retour),
  `node tests/safe-path-probe.mjs` (chemins dangereux).
- Manuel : parcours de vérification détaillé et **résultats réels** dans
  `docs/TESTS.md` ; la correspondance critère-par-critère est dans
  `docs/CRITERES.md`.
- Pour tester sur téléphone : lancer le serveur, puis ouvrir
  `http://<adresse de votre ordinateur sur le réseau local>:8377`.

## Documentation

- `docs/ARCHITECTURE.md` — architecture, décisions techniques.
- `docs/INSTALLATION.md` — installation, lancement, updates de navigateur.
- `docs/TESTS.md` — résultats de tests réels (ce qui a été exécuté et vérifié).
- `docs/CRITERES.md` — grille des critères de validation, testés / non testés.
- `md/` — documents de référence du projet (inchangés).
