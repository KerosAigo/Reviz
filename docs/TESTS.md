# Résultats de tests réels

Tous les tests ci-dessous ont été **réellement exécutés** pendant le
développement, soit par sondes Node, soit via un navigateur réel
(Chromium, contrôle automatisé) sur l'application servie par `server.mjs`.
Aucun résultat n'est simulé. Les sections de fin listent honnêtement ce qui
n'a pas pu être automatisé.

## Sondes Node (exécutées, sorties réelles)

| Sonde | Résultat |
|---|---|
| `node tests/matching-probe.mjs` | **10/10 PASS** (découpe en lots, permutations complètes et bien mélangées, score 100 %/75 %, échange immuable, hors bornes) |
| `node tests/reviz-roundtrip.mjs` | **10/10 PASS** (export → extraction manifest valide, médias par SHA-256, blocs latéraux, refus d'un manifeste invalide) |
| `node tests/revizlib-roundtrip.mjs` | **17/17 PASS** (export `.revizlib` d'un dossier → racine/dossiers/decks/cartes typées/médias/fiches conservés ; refus : média manquant, archive corrompue, format `.reviz`, version inconnue, deux racines, cycle, deck sans fichier, média non déclaré) |
| `node tests/safe-path-probe.mjs` | PASS (chemins `../`, absolus, `\\`, `C:` refusés) |
| `node tests/regex-probe.mjs` | PASS (découpe `$…$` / `$$…$$`) |

## Tests navigateur réels (contrôle automatisé, Chromium)

### Reprise de données, thème, navigation
- Chargement initial, navigation ACCUEIL/FICHIERS/RÉVISER/STATS/RÉGLAGES.
- Persistance après fermeture/rechargement (IndexedDB `reviz`).

### Import et lecture des ressources
- PDF valide lu via PDF.js (rendu page 1) ; **PDF invalide** (stub) →
  message « le fichier est illisible en tant que document PDF » — pas de crash.
- Image PNG affichée ; HTML de simulation exécuté dans iframe avec
  `sandbox="allow-scripts"`, le contenu ne touche pas le DOM parent.
- Fiche texte avec formules `$…$` rendues par KaTeX.
- Erreurs de **magic bytes** sur un faux PNG/PDF → messages compréhensibles.

### Dossiers / fichiers
- Création, renommage, déplacement (drag) de dossiers via l'arbre.
- Suppression de dossier avec confirmation → cascade complète en une
  transaction : dossier + fiche + deck + cartes + stats + médias disparus
  (vérifié par lecture DB après opération).

### Éditeur de deck / cartes (réseau de tests réel)
- Création de carte via « Nouvelle carte », saisie de
  `Limite en 0 : $\lim_{x\to0}\frac{\sin x}{x} = 1$` → aperçu KaTeX **immédiat**
  (vérifié `.katex` présent) ; statut d'enregistrement « Modifications en
  cours… » → « Enregistré ».
- Onglet Verso : bloc LaTeX pur `$\displaystyle e=\lim_{n\to\infty}(1+1/n)^n$`
  prévisualisé ; retour au deck → la carte **est enregistrée** (3 cartes ;
  rechargement → toujours 3).
- Réordonnancement ↑ (l'ordre change réellement dans la liste), suppression
  avec confirmation (toast « Carte supprimée. » + 2 cartes).

### Révisions (vraies sessions)
- Préparation : compte affiché AVANT lancement (ex. « 2 deck(s), 3 carte(s), 1 à
  réviser »), source racine vs dossier (« Mathématiques » → 1 deck/2 cartes ;
  la racine → 2 decks/3 cartes ; deck Dérivées déplacé hors dossiers → exclu
  du périmètre). La session ne démarre qu'après clic explicite.
- Réponse libre : compte à rebours de 5 s décrémente (num 5 → … → 0), l'anneau
  tourne ; révélation avant la fin possible ; à 0 l'auto-révélation se déclenche
  et la réponse reste consultable (« Pas trouvé » après expiration fonctionne).
- « Trouvé ! » / « Pas trouvé » → écrit immédiat dans `cardStats` : échec →
  `dueAt` à +10 min (vérifié `dueInMin: 10`), succès → +1 jour puis intervalle
  2,6 j → 3 j selon ease. Récapitulatif « 1 / 2 (50 %) » correct.
- Association : série de 2 avec **garantie de colonnes non coïncidentes** ;
  échange par tap-tap (PointerEvent tactile) ET par glisser-déposer souris
  (fantôme, cible surlignée, nettoyage) ; association incorrecte validée →
  marquage rouge + « 0 / 2 (0 %) » + stats -1 chaque ; association correcte →
  vert + « 2 / 2 (100 %) » + intervalle élargi.
- Alternance : file libre → série d'association → libre… jusqu'à épuisement
  (vérifié sur une source de 2+ cartes).

### Statistiques et répétition espacée
- Vue d'ensemble : nombres réels (3 cartes, 2 decks, 3 révisions, réussite
  67 % (2/3)), « à réviser maintenant / +24 h / +7 j » exacts.
- Tableaux par deck (cliquables → éditeur), par dossier (chemin « Racine »,
  « Mathématiques »), par carte (retard d'abord : échéances 10/11, 13/11, …).
- Le taux de réussite reflète les réponses réelles (0 % sur la carte échouée,
  100 % sur la carte réussie deux fois).
- Déplacement du deck « Dérivées » depuis un sous-dossier vers la racine :
  historique conservé (2 révisions / 2 correctes, clé cardId) et le chemin
  affiché suit la nouvelle localisation (« Mathématiques / Analyse » → « Racine »).
- Cas base vide : message « Aucune carte… » (pas de plantage, pas de zéro fictif).
- (Depuis la refonte : cette vue est remplacée par le tableau de bord
  graphique — voir section « Refonte visuelle » ci-dessous.)

### Sauvegarde `.revizbak` / restauration
- « Créer une sauvegarde » : téléchargement déclenché (ancres `.download`) ;
  le ZIP contient manifest + data/*.json + blobs ; les 6 payloads JSON sont
  **identiques octet-pour-octet** aux données de la base.
- Restauration dans une base vidée : toutes les entités sont revenues à
  l'identique (la comparaison JSON des cartes/decks/fichiers/dossiers a rendu
  exactement le même contenu, formules LaTeX incluses).
- Fichiers invalides → 4 messages explicites testés : octets aléatoires
  (« Archive illisible ou corrompue »), zip non-Reviz (« Ce n'est pas une
  sauvegarde Reviz (format « reviz »…) »), manifeste sans data/*.json
  (« Sauvegarde incomplète »), média déclaré absent (« Média manquant »).
- Confirmation obligatoire : la vue de réglages exige « Tout remplacer » et
  prévient du remplacement total AVANT l'opération (dialogue de confirmation,
  testé par le flux du code de restauration et le contenu du dialogue).

### Réglages
- Modifications persistées réellement en DB (relecture via getSettingsBulk) :
  20 s / plafond 15 / lots 5-4 / verso→recto / mode libre → préparation de
  révision HÉRITE de ces valeurs (chips « plafond : 15 », radios cochées).
- Valeur invalide (plafond 0) → rejetée, message « Valeur invalide … », la
  précédente valeur conservée en base.
- Stockage : valeurs réelles du navigateur (Utilisé 80 ko, Quota 6,09 Go),
  demande de persistance affichée selon l'état réel retourné par l'API.

## Refonte visuelle (novembre 2026) — tests réels

### Migration DB v1 → v2 + journal `reviewLog`
- Rechargement de l'onglet réel (base existante) → `onupgradeneeded` v2 :
  `reviewLog` créé, **3 lignes cardStats → 3 événements `kind:'repli'`**
  (vérifié par lecture DB : `logLen 3, repli 3`).
- Session réelle sur la base réelle : « Trouvé ! » → nouvelle ligne `seq 4,
  ok 1` SANS `kind` (événement réel), stats mises à jour dans la même
  transaction (reviews 3, intervalle 2,6 → 6,89 j, dueAt = maintenant + 6,89 j).
- Aucune perte : `cardStats` inchangé (3 lignes), historique intact.

### Tableau de bord statistique (#/stats) — base réelle (3 cartes)
- 9 panneaux montés, 14 SVG, 0 erreur console : anneau (80 % réel),
  courbe (points des seuls jours révisés), barres jour (7 barres réelles
  en fenêtre 7 j), maîtrise, calendrier 112 cases + lettres, upcoming
  (0/1/0/2/0/0 = total cartes), decks (Limites 67 % warn, Dérivées 100 % ok),
  dossiers, cartes difficiles.
- Interactions : pilule « 7 j » → 7 barres ; filtre dossier
  « Mathématiques » → 2 cartes / 1 deck ; retour « Tout » + 30 j → état
  initial. Cohérence après une révision : 6 révisions, 83 %, 2 points de courbe.

### Sélecteur visuel de source (#/review) — base réelle + grande base
- Arbre : « Toute la bibliothèque 3/0 » (sélectionné par défaut),
  « Mathématiques 2/0 » déplié (niveau 0 ouvert par défaut) → « Limites 2/0 »,
  groupe « Decks hors dossier 1/0 » replié.
- Sélection deck « Limites » → KPI 1/2/0/30 ; « Dérivées » → 1/1/0/30.
- Twisties : replier/déplier Mathématiques (les enfants disparaissent/réapparaissent),
  déplier le groupe racine → decks racine visibles.
- Groupe « Decks hors dossier » : non sélectionnable (en-tête), compte SEULEMENT
  les decks racine (corrigé : l'agrégat global 3/0 trompeur a été remplacé),
  masqué si vide.
- Session lancée depuis l'arbre (deck Dérivées) : montage, réponse enregistrée,
  fin de session « Session terminée — 1 / 1 (100 %) ».
- Course de vues (#/home → #/review rapprochés) : avant correctif, une vue en
  retard écrasait l'autre (`refreshCounts: replaceWith de null`) ; après
  correctif (conteneur `view-host` par montage) → montage propre, 0 erreur.

### Grande base (240 cartes, origine de test séparée : port 8378)
- Semis réel via l'API de l'app (2 dossiers, 3 decks, 240 cartes, 385
  événements de journal, résultats variés étalés sur 12 jours).
- Dashboard : 240 cartes / 216 puis 360 révisions / 89 % puis 80 % ;
  maîtrise 24 maîtrisées + 72 en cours + 24 difficiles + 120 nouvelles
  (= 240 ✔) ; 10 puces « cartes difficiles » ; calendrier coloré sur 12 jours ;
  courbe 14 points réels ; aucun dépassement de délai.
- Arbre : Test Large 240/192 → Sous-dossier 80/60 (descendance exacte),
  sélection Sous-dossier → KPI 1 deck / 80 cartes / 60 dues.
- Session sur 240 cartes : montage < 1 s, réponse enregistrée
  (`lastSeq 230`), latence réponse ≈ 26 ms hors délais d'attente du test.
- Groupe vide « Decks hors dossier » masqué après correctif.

### Base vide (origine séparée 8378, aucune donnée)
- Dashboard : KPI 0/0/0/« — », anneau vide « — », message de courbe
  « Pas encore assez de jours révisés », « Aucun deck / Aucun dossier /
  Aucune carte difficile », calendrier tout gris, 0 erreur console.
- Préparation : arbre réduit à « Toute la bibliothèque 0/0 » ; clic
  « Démarrer » → toast « Cette source ne contient aucun deck. » (aucune
  session lancée).

### Sauvegarde avec journal (base de test)
- `createBackup` → `validateBackup` → `restoreBackup` : manifest counts
  `log: 385`, restauration → 385 événements relus à l'identique
  (240 cartes, 3 decks, 2 dossiers). Compat ascendante : `data/log.json`
  est optionnel à la validation (sauvegardes v1 sans log acceptées).

### Ajustements d'ergonomie (retour utilisateur)
- **Stats** : grille en `dense` + panneaux étirés (`flex`) — colonnes et
  hauteurs réalignées (mesuré : mastery/upcoming même ligne même hauteur
  224 px, folders/difficulté 119 px, anneau sur 2 lignes).
- **Réviser / Réglages** : espacement accru entre paramètres
  (`.field-label` 20 px au-dessus, groupes Réglages 18 px, colonnes de
  préparation espacées de 22 px).
- **Boutons de dépliage** : les twisties étaient des `<button>` imbriqués
  dans le `<button>` de ligne (HTML invalide, styles navigateur par défaut
  visibles) → remplacés par des `<span role="button">` (transparents,
  clavier Enter/Espace géré) ; replier/déplier re-testé.
- **Création de carte** : les classes `active` des onglets Recto/Verso
  étaient **inversées** (le Verso devenait rose quand Recto était actif) —
  corrigé et vérifié dans les deux sens (rose = sélectionné, pilule
  normale = non sélectionné).

## Ce qui n'a PAS pu être testé automatiquement (honnêteté)

1. **Rendus sur un vrai téléphone** : les écrans sont responsive (media
   queries ≤760/560 px, lots d'association réduits, cibles tactiles), le
   glisser/tap tactile a été validé par Pointer Events synthétiques dans un
   navigateur de bureau, mais pas par une main sur un appareil réel.
2. **Restauration via le sélecteur de fichiers natif** : le navigateur de test
   ne peut pas piloter la boîte de dialogue OS. Toutes les briques aval du
   flux (validation, récapitulatif, confirmation, remplacement) sont testées ;
   seule l'étape « choisir le fichier » reste manuelle.
3. **Firefox/Safari** : les tests automatisés tournent sur Chromium. Les API
   utilisées (IndexedDB, Pointer Events, KaTeX, PDF.js, fflate) sont courantes,
   mais l'équivalence complète n'est pas mesurée sur ces moteurs.
4. **Grandes bibliothèques** : profilé réellement jusqu'à 240 cartes
   (dashboard + arbre + session fluides, latence réponse ≈ 26 ms). Au-delà
   (milliers de cartes / très gros PDF), les limites d'import sont codées
   (50 Mo/fichier, 3000 entrées, 200 Mo décompressés) mais non profilées.
5. **La concurrence multi-onglets** : une écriture depuis deux onglets en même
   temps n'est pas testée (IndexedDB gère l'isolement, mais l'UI d'un second
   onglet ne se re-rafraîchit pas instantanément — rechargez).

## Mode examen (novembre 2026) — tests réels

Contexte : base réelle (3 cartes, 3 decks, 2 dossiers, port 8377) + base vide
de test (origine séparée : port 8378, détruite après les tests).

### Migration DB v2 → v3 + store `exams`
- Premier rechargement : upgrade BLOQUÉE par le second onglet ouvert →
  message d'erreur explicite affiché (comportement voulu : « Un autre onglet
  bloque la mise à jour »), données intactes.
- Second onglet fermé, rechargement : `reviz` passe à **version 3**, store
  `exams` créé, TOUTES les données conservées (3 cartes, 3 decks, 5 fichiers,
  2 dossiers, 4 événements de journal, 3 stats, 1 blob). Zéro erreur console.

### Préparation (#/exam)
- Arbre multi-sélection réel : « Toute la bibliothèque » sélectionne 5 nœuds
  (dossiers + decks), compteurs annoncés 3/3/3/20 min, pill « Flashcard (3) ».
- **Bug trouvé et corrigé** : le premier recalcul (aucune sélection) effaçait
  le type par défaut (tous compteurs à 0) → « Aucune question ne correspond »
  au démarrage. Correctif : ne pas élaguer les types quand le vivier est vide.
- Démarrage réel : 3 questions disponibles → examen créé (3 questions,
  5 min, mélange activé), `reviz.examRun` persisté.

### Déroulé (#/exam/run) — examen complet joué
- Chronomètre 05:00, « 3 restante(s) », progression « Question 1 / 3 »,
  barre 0 %, question affichée (instantané réel : « Dérivée de x2 »).
- Q1 : réponse saisie (« 2x ») → persistée ; Q2 : PASSER (non traitée) ;
  Q3 : réponse (« ln(2) ») ; retour en arrière via la grille sur Q2 →
  réponse saisie ; retour sur Q3 : **réponse précédente conservée**, modifiée
  en « ln(3) » ; « Terminer l'examen » → confirmation.
- Phase de correction : 3 items autoévalués (Trouvé / Pas trouvé / Trouvé)
  avec réponse attendue affichée.
- Résultats : **13.33 / 20, 67 %**, chips 2 ✓ / 1 ✗ / 0 ○, 13 s,
  notions à retravailler « Dérivées (1) », 3 items de correction détaillée
  cliquables depuis les puces de questions.
- Enregistrement : 1 examen dans `exams` (score 2/3, status « completed »,
  instantanés complets), **cardStats et reviewLog INCHANGÉS** (3 / 4).

### Reprise après rechargement (crash recovery)
- Réponse tapée puis rechargement de l'onglet → #/exam/run : reprise
  exacte (question 1/3, réponse conservée, horloge recalculée 04:58).

### Clôture automatique à expiration
- `startedAt` reculé de 5 min, navigation → chronomètre 00:00, phase de
  réponse clôturée automatiquement, bannière « Temps écoulé », correction
  de la seule réponse donnée, résultat : status « **expired** », durée
  plafonnée à 300 000 ms, 2 non traitées comptées à part.

### Abandon
- « Quitter » → confirmation « Abandonner / Annuler » → abandon confirmé :
  retour #/exam, `reviz.examRun` supprimé, AUCUN examen enregistré
  (compteur `exams` inchangé).

### Historique, relance, statistiques
- #/exam/history : 2 examens listés avec note/20, %, ✓✗○, durée, date,
  badge « temps écoulé » pour l'expiré ; clic → fiche résultat.
- « Relancer un examen similaire » : réglages de l'examen précédent
  préremplis (deckIds, 3 questions, 5 min, toutes difficultés, flashcards,
  mélange) + bannière de relance.
- #/stats : panneau **« Examens »** séparé — 2 examens passés, moyenne
  34 %, meilleur 67 %, lien historique ; stats de révision inchangées.

### Sauvegarde `.revizbak` avec examens (base vide port 8378)
- Backup créé sur la base réelle : compteur `exams: 2` dans le manifeste,
  `data/exams.json` présent (1 029 375 octets).
- **Restauration complète sur base vide** : 2 examens (completed + expired),
  3 cartes, journal 4 événements restaurés ; historique UI : 2 lignes ;
  zéro erreur console.
- **Ancienne sauvegarde sans `data/exams.json`** (archive reconstruite sans
  cette entrée, manifeste sans compteur) : validation OK (`exams: 0` par
  défaut), restauration complète sans erreur — compatibilité ascendante.
- Base de test 8378 : IndexedDB détruite après les tests.

### Expressions de calcul & graders (service, exécution réelle)
- `2+3*4=14`, `(2+3)*4=20`, `2^10=1024`, `sqrt(144)=12`, `-3+5=2`,
  `3,5*2=7` (virgule décimale), `10%3=1` — évaluateur SANS eval/Function.
- Entrées dangereuses refusées : `alert(1)`, `constructor` →
  « Symbole non autorisé ».
- `normalizeText` : casse/accents/espaces ignorés (« Ete » ≡ « été »).
- Difficulté réelle : 2 cartes « facile », 1 « moyen » ; filtre « facile »
  → 2 questions sélectionnées.

### Régression classique (contrôle)
- Session de révision complète rejouée après les modifications du routeur :
  réponse libre (Pas trouvé) + série d'association (0/2) → récapitulatif
  « Session terminée — 0 / 3 » ; reviewLog 4 → 7 (réponses réelles), exams
  inchangé (2) — séparation maintenue.

## Nouveaux types de questions (novembre 2026) — tests réels

Contexte : base réelle (port 8377) avec deck de test « Types — tests »
contenant 5 cartes (une de chaque type, créées VIA L'ÉDITEUR UI) + un
examen 5 types ; base vide de test (port 8378) détruite après validation.

### Éditeurs par type (UI réelle)
- Deck créé, 5 cartes créées une à une via #/card/:deck/new (pilule de
  type + formulaire dédié + « Enregistré » à chaque fois) ; relecture DB :
  `type` + `data` exacts pour les 5 (options QCM avec `correct`, `holes`
  avec réponses, `answer` + `tolerance`, `pairs`, `answer` libre).
- Changement de type avec contenu : dialogue de confirmation affiché ;
  Annuler → la pilule reste sur le type d'origine ; Confirmer → type
  changé, formulaire réinitialisé.
- **Bug trouvé et corrigé** : taper `{{0}}`/`{{1}}` à la main dans la
  phrase à trous ne créait pas les entrées correspondantes (seul le
  bouton « Ajouter un trou » le faisait) → `syncHoles` auto-crée les
  entrées manquantes et retire les trous orphelins ; re-testé (2 champs
  de réponses générés, saisie, enregistré).

### Révision — correction immédiate (session réelle 5 types)
- Préparation : deck « Types — tests » → KPI 1/5/5/30 ; démarrage →
  segments typés dans l'ordre du deck (cloze, qcm, free, calc, match).
- QCM : option cliquée → classe `on`, validation → `on ok` sur la bonne,
  chip « Correct ! ».
- Texte à trous : réponses exactes → champs `ok` (2/2) ; réponses
  incomplètes/fausses → `ko` + « Attendu : … » surligné (tout le segment
  est noté par carte — tous les trous corrects requis, choix assumé).
- Calcul : « 0.5 » → `ko` + placeholder « Attendu : 1 » ; « 1 » (tolérance
  ± 0.01) → `ok`.
- Réponse libre : compte à rebours + révélation → réponse de référence
  affichée sous le verso ; autoévaluation « Trouvé » enregistrée.
- Association : plateau réutilisé (3 paires, « 3 paires — glissez ou
  tapez deux cellules de droite ») ; tap-tap revalidé avec de vrais
  PointerEvents (`pointerdown`/`pointerup` + coordonnées, première
  cellule `drop-target`, seconde = échange effectif) ; validation
  « Score de la série : 3 / 3 (100 %) ».
- Fin de session : « Session terminée — 3 / 5 (60 %) » (une carte cloze
  échouée volontairement avant correction des données de test).
- Journal : entrées récentes avec `t` exact (`cloze ok:1`, `match ok:1`,
  `calc ok:1`, `qcm ok:1`, `free ok:1` + un `cloze ok:0`) et cardStats
  mises à jour.
- Tableau de bord : panneau « Par type de question » réel —
  « Flashcards 7 · 57 % / Textes à trous 2 · 50 % / QCM 1 · 100 % /
  Réponses libres 1 · 100 % / Calculs 1 · 0 % / Associations 1 · 0 % ».
- **Bug trouvé et corrigé** : `el()` fusionnait mal les classes —
  `attrs.class` ÉCRASAIT celles du sélecteur ; les options QCM perdaient
  `ex-option` (aucun style/clic exploitable). Correctif : `classList.add`
  des classes de `class` en plus de celles du sélecteur ; toutes les
  occurrences du code passaient déjà la classe de base → aucun appel
  cassé ; session rejouée après correctif (QCM re-vérifié `on ok`).

### Examen 5 types (parcours UI complet)
- Préparation : deck sélectionné → pills réelles « QCM (1) / Texte à
  trous (1) / Réponse libre (1) / Calcul (1) / Association (1) », 5
  questions / 10 min, 5 types cochés, démarrage → config persistée
  (deckIds/count/durationMin/types/shuffle).
- Réponses réelles : cloze `["ln(x)","e^x"]`, qcm `[0]`, calcul
  « 0.5 » (FAUX volontaire), match `["2x","1/x","e^x"]`, libre rédigée.
- Correction différée : 4 items corrigés automatiquement (cloze/qcm/
  match vrais, calc faux), réponse libre autoévaluée (« Trouvé ») avec
  question + réponse donnée + référence affichées.
- Résultat : **16 / 20, 80 % de réussite** ; DB : score 4/5, pct 80,
  counts {total:5, answered:5, correct:4, incorrect:1, skipped:0},
  status « completed », `items[].points` conformes.

### Format `.reviz` v2 (round-trip réel)
- Export du deck 5 types → ZIP 1 046 octets, `formatVersion: 2`,
  `cardTypes: [calc, cloze, free, match, qcm]`, `data` complets dans le
  manifeste (options/pairs/holes vérifiés).
- Import comme nouveau deck (« Types — tests (2) ») : 5/5 cartes avec
  `type` + `data` identiques (options, trous, paires, tolérance relus).
- **Type inconnu rejeté** : carte injectée avec `type:'inconnu'` →
  « Fichier .reviz invalide : Carte 6 : type de question inconnu ».
- **data manquante rejetée** : carte typée sans `data` → erreur claire.
- **Bug trouvé et corrigé** : `validateManifest` refusait recto/verso
  vides — or les cartes typées (trous, association) portent leur contenu
  dans `data`, pas dans les blocs → 5 erreurs parasites. Correctif : la
  règle « faces vides interdites » est levée pour les cartes typées (v1
  inchangée) ; validation + rejets re-testés après correctif.
- Manifeste v1 (legacy, `formatVersion: 1`, types retirés, faces
  re-remplies) importé → 5 cartes flashcards (`type` absent), aucun blocage.
- Chemin « remplacer » : **bug v1 trouvé et corrigé** — le bloc
  `runDeckReplace` était dupliqué et les cartes écrites SANS `deckId`
  (donc invisibles depuis le deck : « replacedTypes: [] » avant
  correctif). Correctif : bloc dupliqué supprimé + `deckId` écrit.
  Re-test réel : replace → 5 cartes typées restaurées EN PLACE
  (options/trous/paires identiques).

### `.revizbak` avec cartes typées (base vide, origine séparée 8378)
- Backup réel : summary {decks:4, cards:8, blobs:0, stats:3, log:15,
  exams:3} ; restauration complète sur base vide : 4 decks, 8 cartes
  dont 5 typées avec `data`, 3 examens, journal 15 événements.
- Compat : sauvegarde sans `data/exams.json` toujours acceptée (déjà
  vérifié en Phase 3, inchangé).
- Base de test 8378 détruite (IndexedDB supprimée) après validation.

### Incidents réels pendant les tests — honnêteté
- **Blob image perdu puis récupéré** : une évaluation navigateur de
  nettoyage (timeout 60 s NON annulé — l'opération restait zombie dans
  la page pendant que d'autres s'exécutaient) a déclenché
  `cleanupOrphanBlobs` pendant un état partiellement supprimé → le blob
  PNG de l'utilisateur a été supprimé à tort. Récupération : lecture du
  fichier `.revizbak` temporaire antérieur (Phase 3), réinsertion du
  blob EXACT (1 262 007 octets, même id), nettoyage des enregistrements
  de fichiers obsolètes ; visionneuse re-vérifiée (#/view, 1024×1536,
  naturalWidth ok). Aucune carte/deck/examen perdu.
- **Bug préexistant découvert à cette occasion** : `deleteDeckData`
  bouclait un curseur avec `cur.delete()` SANS `cur.continue()` →
  hang infini dès qu'un deck contient ≥ 1 carte (touchait
  `deleteDeckFully` ET `deleteFolderCascade`). Instrumentation réelle
  (transaction manuelle) pour localiser l'attente, correctif
  `cur.continue()`, puis : suppression deck 3 cartes = 3 ms, cascade
  dossier (deck + 2 cartes + stats) = 2 ms, zéro orphelin, zéro fichier
  obsolète.
- Mes évaluations zombies ont aussi pollué la base (cartes orphelines
  `deckId:null`) : nettoyées via `deleteCard` (5) ; le code applicatif
  n'était pas en cause.

### Régressions post-refactorisation (`interactions.js` partagé)
- Révision classique flashcards (deck « Limites », 2 cartes) : Révéler →
  Trouvé → avance automatique (650 ms) → récapitulatif « 2 / 2 (100 %) » ;
  reviewLog +2 `t:basic` ok:1 ; cardStats reviews 4 / correct 2.
  (Premier passage « en échec » : ma boucle de test cherchait un bouton
  « Question suivante » qui n'existe pas pour les cartes basic — elles
  avancent seules. App vérifiée saine.)
- Examen flashcards-only (Limites + Dérivées, 3 questions, shuffle) :
  réponses écrites (« Votre réponse… »), `answered` synchronisé au clic
  Suivant, « Terminer l'examen » → correction différée (question +
  réponse donnée + verso, autoévaluation) → **20/20**, DB conforme
  (3/3, t:basic).

## Import intelligent (novembre 2026) — tests réels

Contexte : base réelle (port 8377) ; faux service OCR local (port 8379,
supprimé après les tests) pour jouer le chemin « service externe » en
réel ; PDF de test construit en octets (909 octets, 5 lignes de texte)
et enregistré comme ressource via l'API de l'app.

### Générateur (service, exécution réelle)
- Texte français à 9 phrases : 7 flashcards + 7 QCM + 9 trous + 2
  libres + 1 association (6 paires) + 1 synthèse ; `calc: 0` (aucune
  égalité numérique — comportement honnête attendu).
- **Déterminisme vérifié** : deux appels successifs → JSON identique
  (PRNG semé sur le texte). Ré-exécuté sur 3 textes différents : OK.
- Calculs : « 18 + 1.6 = 19.6 », « 15 + 27 = 42 », « 2 × 3 = 6 » → 3
  cartes calcul (× et virgule convertis, `why` = égalité source).
- Texte sans motif → 0 proposition (l'UI affiche un message explicite,
  aucune carte inventée).
- Découpe : améliorée en cours de test — les sauts de ligne restent des
  séparateurs (le titre du PDF ne se colle plus à la phrase suivante) ;
  verbes anglais courants ajoutés (designates/means/denotes/refers
  to/is defined as/we call) — texte EN : 4 flash + 4 QCM + 1 association.
- Motifs affichés avec leur TRACE (phrase source) dans l'UI (`wiz-why`).

### Assistant — PDF existant (flux UI réel)
- #/import → « Ressource existante » → ligne du PDF de test → étape
  Extraction : chips « Couche texte du PDF (local) », « 1 page(s) »,
  « 299 caractères », texte complet dans le textarea éditable.
- **Bug trouvé et corrigé** : premier essai → repli silencieux en
  « Collage manuel » ; cause réelle : `doc.destroy is not a function`
  (API PDF.js vendue : `destroy()` est sur la tâche de chargement).
  Correctif + re-test : extraction OK, 0 erreur console.
- « Générer les propositions » → 5 items (flashcards/trous/calculs),
  trace source visible, édition du recto en direct, décocher un item →
  compteur « 4 retenue(s) » mis à jour.
- Destination « Nouveau deck » : nom saisi, dossier « Mathématiques »
  choisi via le sélecteur (label du bouton mis à jour), enregistrement →
  deck créé dans le bon dossier (vérifié par le record `files`),
  5 cartes en base (2 flash, 2 trous, 1 calcul avec type/data).
- **Bug trouvé et corrigé** : `el('span#wiz-folder-label')` — le helper
  `el()` ne gère pas `#id` (élément au nom de balise invalide) ;
  correctif : `id` via attrs ; label vérifié après correction.
- Destination « Deck existant » (2e passage) : deck « Limites » +2
  cartes (1 cloze typée, 1 flash), navigation automatique vers
  #/deck/<id>.

### Assistant — image + OCR (chemin service externe en réel)
- **Sans URL configurée** (défaut) : avertissement honnête affiché
  (« Aucune OCR n'est exécutée sur cet appareil… » + repli collage
  manuel), chip « Collage manuel », aucun faux texte.
- **Avec URL** (Réglages → « Import — OCR externe », enregistrée puis
  relue en base) : POST réel de l'image brute vers le service de test
  (vérifié CÔTÉ SERVICE : 1 262 007 octets reçus), réponse JSON {text}
  intégrée au textarea, chip « Service OCR externe (votre URL) » ;
  génération + enregistrement depuis ce texte OK.
- Premier essai sans CORS sur le service de test → erreur claire
  (« Le service OCR a répondu…/n'a pas répondu ») + repli manuel —
  comportement voulu pour un service mal configuré.
- **Lecture seule vérifiée** : taille du blob image identique
  avant/après le flux complet (1 262 007 octets).
- Réglages : URL invalide (sans http) rejetée avec message ; vidage →
  « Service OCR désactivé ».

### Cartes générées jouables
- La carte à trous issue de l'assistant est gradée par le moteur réel :
  `['ocr service test']` → true (casse ignorée), `['nimporte quoi']` →
  false. Le type/data produits par le générateur sont conformes aux
  interactions partagées (aucune carte « décorative »).

### Nettoyage après tests (état final)
- Deck « Import assistant (test) » supprimé, 2 cartes de test retirées
  de « Limites », ressource `test-extract.pdf` supprimée, URL OCR vidée,
  faux serveur arrêté et son fichier supprimé.
- Base finale : 4 decks, 8 cartes, 0 orphelin, 0 erreur console sur
  chargement frais.
