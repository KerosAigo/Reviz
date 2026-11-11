# Architecture technique — Reviz

Une application **statique sans build** : le navigateur charge des modules ES
directement, IndexedDB persiste tout localement. Aucun compte, aucun réseau.

## Flux

```
navigateur
 ├── app.js                routeur (#/home #/files/... #/deck/... #/card/...
 │                         #/review[/run] #/stats #/settings + viewers/...)
 ├── views/                vues DOM pures (shell + panneaux)
 ├── review/               moteur de session + logique d'association pure
 ├── srs/scheduler.js      SM-2 simplifié (fonctions pures, testables)
 ├── stats/stats-service.js  agrégation (global / deck / dossier / carte)
 ├── storage/              db.js (IndexedDB bas niveau) + repo.js (transactions)
 ├── format/               .reviz : manifest JSON + média, ZIP fflate
 ├── importer/             détection par magic bytes + import des 4 types
 ├── backup/               .revizbak : sauvegarde/restauration complète
 ├── latex/                KaTeX : split $…$ / $$…$$ + rendu sûr (throwOnError)
 ├── render/               blocs → DOM (carts, aperçus éditeur), URLs blob
 ├── ui/                   fabrique el(), toasts, modales, sélecteur dossier
 └── viewers/              pdf.js / image / iframe sandbox / fiche
serveur (server.mjs)       fichiers statiques uniquement, port 8377
```

## Décisions techniques (et pourquoi)

1. **Pas de build.** Le code ES modules se charge tel quel ; `server.mjs` (Node
   natif, ~100 lignes) évite tout conflit CORS/worker. Avantage : audit direct
   du code servi, zéro chaîne d'outils.
2. **IndexedDB, un store par entité**, clés = UUID v4 (WebCrypto via
   `core/ids.js`, garde-fou manuel sur navigateurs anciens). Les stats vivent
   dans `cardStats` **clé = cardId** :
   déplacer un deck ou une carte ne casse jamais l'historique ; supprimer une
   carte supprime sa statistique (aucun orphelin).
3. **Transactions atomiques** : toute opération multi-enregistrements (cascade
   de suppression, restauration complète, réordonnancement) est UNE transaction
   `readwrite` — tout ou rien (voir `storage/repo.js`, `runTx`).
4. **`.reviz` = ZIP manifesté.** `manifest.json` (format, deck, cartes, médias)
   + `media/*` nommés par SHA-256 (déduplication). Lecture : filtre
   zip-bomb AVANT décompression (nombre d'entrées, volume décompressé,
   chemins hostiles), MIMES vérifiés par magic bytes ; conflits résolus par un
   dialogue explicite (nouveau deck / remplacement / annulation).
5. **LaTeX : KaTeX** (plus léger que MathJax, rendu synchrone, option
   `throwOnError` + sortie HTML sûre ; le code source LaTeX est conservé dans
   le `.reviz`). Convention `$…$` inline / `$$…$$` documentée dans
   l'éditeur. Une syntaxe invalide reste affichable (en rouge) sans planter l'app.
6. **Simulations** exécutées dans `<iframe sandbox="allow-scripts">` uniquement :
   pas de DOM parent, pas de localStorage, pas de navigation. Le HTML importé
   n'est JAMAIS injecté dans le DOM principal.
7. **Sessions de révision** : le moteur (`review/engine.js`) décrit
   une file de segments (carte libre / lot d'association) ; l'UI ne stocke
   QUE l'affichage. Chaque résultat est écrit immédiatement dans `cardStats`
   ET dans le journal `reviewLog` en UNE transaction (fermer l'onglet en
   séance ne perd rien). La configuration de session passe par
   `sessionStorage` (elle est transitoire et reprise après rechargement).
8. **Association pure** (`review/matching.js`) : mélanges indépendants des deux
   colonnes, avec garantie que les deux ordres ne coïncident jamais
   (série jamais pré-résolue). Testée hors navigateur par une sonde Node.
9. **Batches adaptatifs** : 6 paires ordinateur / 4 téléphone (réglages),
   Pointer Events unifiés (souris + tactile) pour glisser-déposer ; tap-tap
   comme méthode tactile alternative.
10. **Répétition espacée** : SM-2 à 2 niveaux. `dueAt` est recalculé à chaque
    réponse ; l'ordre de session trie dues d'abord (cartes en retard →
    nouvelles → grands intervalles).

## Schéma de données (IndexedDB `reviz`, v2)

| Store       | Clé       | Contenu |
|-------------|-----------|---------|
| `folders`   | id        | dossier { parentId, name } |
| `files`     | id        | entrées d'arborescence (tous types de ressources) |
| `decks`     | id        | { name, description, … } |
| `cards`     | id        | { deckId, position, front[], back[] (blocs) } |
| `blobs`     | id        | { bytes, mimeType, size, nameHint } |
| `cardStats` | cardId    | { reviews, correct, incorrect, ease, interval, dueAt, lastReviewedAt } |
| `settings`  | key       | { value } |
| `reviewLog` | seq (auto)| { cardId, ok (1/0), at (ms), kind? } — un événement RÉEL par réponse |

**Migration v1 → v2** (à l'ouverture) : création de `reviewLog` puis, dans la
même transaction, repli honnête — un seul événement dérivé par carte déjà
révisée (`kind:'repli'`, jour de `lastReviewedAt`, agrégat correct vs
incorrect). Rien n'est inventé : les jours sans activité restent vides et le
champ `kind` distingue ces agrégats des réponses réelles post-migration.
Les graphiques (`stats/charts.js` + `stats-service.collectDashboard`) ne
consomment QUE ces données réelles ; un jour sans révision reste à 0 et une
métrique sans donnée est affichée comme vide (« — »), jamais simulée.

Un bloc de face est de type `text | latex | image | gif` : les deux premiers
portent `value`, les deux autres `blobId` (résolu en URL blob au rendu).

## Limites assumées (documentées, pas masquées)

- **SM-2 à 2 niveaux** : pas de FSRS ni de difficultés intermédiaires — la
  spécification ne propose que « Trouvé !/Pas trouvé ».
- `.reviz` ne contient que des decks (cartes + médias) : les fiches, PDF,
  images et simulations ne voyagent pas dans ce format ; pour dupliquer TOUTE
  la bibliothèque (fiches comprises), utiliser la sauvegarde `.revizbak`.
- Le partage entre navigateurs/appareils passe par les fichiers `.reviz` /
  `.revizbak` (pas de sync en temps réel — application locale).
