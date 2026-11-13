# Grille des critères de validation — état réel

Correspondance avec `md/CRITERES_DE_VALIDATION.md`. ■ = testé réellement
(voir `docs/TESTS.md` pour la méthode et les sorties), ◐ = partiellement
(la bribe non couverte est dite), □ = non testé.
Aucun critère n'est marqué « validé » sans test réel correspondant.

## 1. Installation / lancement
- ■ `start.bat` + `node server.mjs` démarrent le serveur (port 8377).
- ■ Application chargée et utilisable à http://localhost:8377.

## 2. Decks .reviz
- ■ Création d'un deck depuis l'accueil, ajout/suppression de cartes,
  réordonnancement, suppression avec confirmation.
- ■ Export `.reviz` (bouton deck), **round-trip 10/10** (sonde Node).
- ■ Import `.reviz` : refus manifeste invalide, remplacement demandé
  (jamais silencieux), médias validés par magic bytes.
- ◐ **Export/import d'un dossier complet `.revizlib`** : bouton « Exporter »
  (dossier courant + menu contextuel), **round-trip 17/17** (sonde Node) ;
  import = arborescence recréée sous le dossier cible, conflits de decks
  résolus explicitement (remplacer / comme nouveaux / annuler), archive
  refusée si manifeste incomplet, version inconnue, cycle ou média manquant.
  ◐ : le format est couvert par la sonde Node ; le parcours UI (boutons,
  dialogue de conflit) reste à vérifier au navigateur.

## 3. Dossiers et fichiers
- ■ Création/renommage/suppression de dossiers (confirmés) + déplacement.
- ■ Import des 4 types (PDF, image, simulation, fiche) avec détection
  par magic bytes et messages d'erreur compréhensibles (PDF/fichiers invalides).
- ■ Multi-sélection + suppression groupée dans FICHIERS.

## 4. PDF / images / simulations / fiches
- ■ PDF valide (rendu page 1 via PDF.js), PDF invalide → message clair.
- ■ Image PNG (+/JPEG/GIF/WebP par magic bytes), visionneuse avec zoom.
- ■ Simulation HTML chargée dans iframe `sandbox="allow-scripts"` ;
  HTML invalide → message ; aucune écriture dans le DOM parent possible
  (par construction : tout le contenu de simulation vit uniquement dans un
  iframe isolé).
- ■ Fiche texte + LaTeX (KaTeX), édition multi-bloc.

## 5–6. Révisions
- ■ Lancer depuis la bibliothèque, depuis **un deck**, depuis un dossier ;
  périmètre descendant exclusif (frères/parents exclus) vérifié en réel.
- ■ Comptes annoncés avant le lancement (now: KPI visuels « decks / cartes /
  à réviser / plafond » mis à jour à chaque sélection).
- ■ **Sélecteur visuel de source (redesign)** : arbre dossiers→decks avec
  icônes distinctes, twisties déplier/replier, compteurs réels (cartes totales
  + à réviser, descendance des dossiers incluse), états sélectionné/déplié/
  replié, groupe « Decks hors dossier » (non sélectionnable, masqué si vide).
- ■ Compte à rebours (5–30 s ⇒ anneau + chiffres) ; révéler avant la fin ;
  expiration à 0 (auto-révélation, réponse consultable) ; « Trouvé ! » /
  « Pas trouvé » ; écriture immédiate du résultat dans la base.
- ■ Association : mélange réel (colonnes jamais coïncidentes), association
  correcte/incorrecte, **modification avant validation** (tap-tap + drag souris),
  validation + score exact (0 % puis 100 %), stats mises à jour.
- ◐ Interaction **tactile sur téléphone** : Pointer Events (touch) — exposé
  et testé via événements synthétiques, pas par une main réelle sur un appareil.

## 7. Statistiques et répétition espacée
- ■ Compteur de révisions / correctes / incorrectes d'une carte.
- ■ Taux de réussite affiché (0 % / 67 % / 100 % réels).
- ■ Dernière révision conservée ; cartes ratées reviennent plus tôt
  (10 min), cartes réussies s'éloignent (1 j → 2,6 j → 3 j).
- ■ **Tableau de bord graphique (redesign)** : anneau de réussite, courbe
  d'évolution (jours révisés seulement — aucun point fictif), barres
  révisions/jour, barre empilée de maîtrise (maîtrisées / en cours /
  difficiles / nouvelles), calendrier d'activité 16 semaines, prochaines
  révisions (6 tranches réelles depuis dueAt), comparaison par deck
  (barres colorées par niveau + cliquables), par dossier, cartes difficiles.
  Interactif : fenêtre 7/30/90 j et filtre par dossier (descendance incluse).
- ■ Journal `reviewLog` (DB v2) : un événement réel par réponse, écrit dans
  la MÊME transaction que les stats ; migration v1→v2 avec repli honnête
  (`kind:'repli'`) — vérifié en réel (3 stats → 3 replis).
- ■ Déplacer un deck ne perd pas l'historique (vérifié en réel).

## 8. Sauvegarde / restauration
- ■ Sauvegarde complète `.revizbak` (téléchargement réel).
- ■ Contenu exact : dossiers, fichiers, decks, cartes, médias, stats,
  réglages **+ journal des réponses (`data/log.json`, optionnel à la
  lecture pour les sauvegardes antérieures)** — round-trip 385 événements
  préservés à l'identique (base de test 240 cartes).
- ■ Restauration dans une base vidée → données restaurées intégrales.
- ■ Fichiers de sauvegarde invalides → 4 messages clairs testés.
- ■ Restauration SANS avertissement impossible : confirmation explicite
  récapitulant le contenu ; annulation ne touche à rien.
- ◐ Sélecteur de fichier natif non pilotable en automatisation (briques
  aval toutes testées).

## 9. Compatibilité et ergonomie
- ◐ Navigateur de bureau réel (Chromium) : ✔.
- □ Navigateur mobile réel (voir `docs/TESTS.md` fin).
- ◐ Écran étroit : media queries ≤900/760/560 px vérifiées dans le CSS
  (dashboard une colonne, KPI 2×2, cibles tactiles, arbre défilant,
  lots réduits) + matchMedia du moteur ; rendu en 1000 px automatisé,
  390 px non capturé pendant cette session (fenêtre non visible).
- ■ Aucune fonction clé dépendante de la souris seule : association
  couverte par Pointer Events (tactile) + tap-tap.
- ■ **Course de montage de vues corrigée** : chaque route reçoit son propre
  conteneur (`div.view-host`) — une vue lente ne peut plus écraser la vue
  suivante (reproductible avant correctif : #/home → #/review rapprochés).

## 10. Livraison
- ■ Code source complet (dossier `src/`).
- ■ Dépendances et versions (vendored : KaTeX, PDF.js, fflate ; Node ≥ 18).
- ■ Instructions d'installation (`README.md`, `docs/INSTALLATION.md`).
- ■ Instructions de lancement (partout : `node server.mjs`).
- ■ Instructions de test (`docs/TESTS.md`, sondes Node).
- ■ Description de l'architecture (`docs/ARCHITECTURE.md`).

---
Résidus connus transcrits mot pour mot de `docs/TESTS.md` § « Ce qui n'a PAS
pu être testé automatiquement » : téléphone réel, sélecteur de fichier natif,
Firefox/Safari, très grandes bases (au-delà de 240 cartes), concurrence
multi-onglets.

## 11. Refonte visuelle (novembre 2026)
- ■ **Réduction de texte** : accueil = cartes chiffrées (icône + titre +
  gros chiffre, détail en info-bulle), héros réduit à une tagline,
  préparation sans paragraphe explicatif, réglages/fichiers : longs textes
  remplacés par des puces courtes + info-bulles natives (`title`).
- ■ **Identité graphique conservée** : palette existante (azur/indigo/rose/
  or/vert/rouge), panneaux bleu nuit, icônes trait fin cohérentes
  (5 icônes ajoutées : filter, target, layers, calendar + twistie réutilisé).
- ■ Aucune donnée fictive : jours sans révision = 0 réel, métriques vides =
  « — », calendrier futur grisé ; vérifié base vide (port 8378, origine
  distincte) ET base 240 cartes.
- ◐ Captures d'écran du redesign non produites (fenêtre du navigateur non
  visible pendant la session) ; la vérification a porté sur le DOM et les
  données réelles, pas sur l'aspect pixel.

## 12. Mode examen (novembre 2026)
- ■ **Préparation** (#/exam) : sélection MULTIPLE de decks via l'arbre visuel
  (« Toute la bibliothèque » = tous, dossier = toute sa descendance, deck
  seul), comptes annoncés RÉELS (decks sélectionnés / cartes disponibles /
  questions / durée), nombre de questions, durée (5–60 min), difficulté
  (toutes / facile / moyen / difficile — dérivée des stats SRS réelles),
  types autorisés (pills avec compte réel, type absent = masqué), mélange
  aléatoire. Relance d'un examen similaire : réglages préremplis + bannière.
- ■ **Déroulé** (#/exam/run) : une question à la fois, chronomètre global
  (chip, urgence < 60 s), barre de progression, grille de questions
  cliquable (retour en arrière + modification avant validation vérifiés),
  passer une question (non traitée, conservée), terminer avant la fin
  (confirmation), état persisté en sessionStorage — reprise après
  rechargement de l'onglet vérifiée (réponse conservée, horloge recalculée).
- ■ **Clôture à expiration** : à 00:00 la phase de réponse s'arrête
  automatiquement (bannière « Temps écoulé »), durée plafonnée à la limite,
  non traitées comptées à part.
- ■ **Correction différée** : flashcards/réponses libres autoévaluées par
  l'utilisateur (Réponse attendue affichée — AUCUNE prétention d'IA),
  QCM/trous/calcul/association corrigés automatiquement.
- ■ **Résultats** (#/exam/result/:id) : note /20, % de réussite, ✓/✗/non
  traitées, temps utilisé, questions réussies/échouées (puces cliquables →
  correction), notions à retravailler regroupées par deck, correction
  détaillée (réponse donnée vs attendue).
- ■ **Historique persistant** (#/exam/history) : un examen = un
  enregistrement autonome du store `exams` (DB v3, instantanés des
  questions — l'historique survit à la suppression d'un deck).
- ■ **Séparation stricte** : aucun examen n'écrit dans cardStats/reviewLog
  (vérifié en réel : stats de révision inchangées avant/après 2 examens) ;
  panneau « Examens » séparé dans le tableau de bord.
- ■ **`.revizbak`** : `data/exams.json` (optionnel à la lecture) ;
  restauration complète sur base vide (2 examens restaurés, UI conforme) ;
  ancienne sauvegarde SANS exams.json acceptée et restaurée sans erreur.
- ◐ Rendu visuel non capturé (fenêtre non visible) ; vérification DOM +
  données réelles. Toucher réel non testé (grille responsive via CSS).
- ■ Types QCM/trous/calcul/association en examen : parcours UI complet
  joué en réel (voir §13) — grading automatique exact, réponse libre
  autoévaluée, examen 5 types = 16/20 enregistré dans `exams`.

## 13. Nouveaux types de questions (novembre 2026)
- ■ **Éditeurs par type** (éditeur de carte) : pilules de type (Flashcards /
  QCM / Texte à trous / Réponse libre / Calcul / Association), formulaire
  dédié par type, aperçu. Cartes créées réellement via l'UI pour les 5
  types et relues depuis la base (`type` + `data` intacts).
- ■ **Changement de type confirmé** : contenu existant → dialogue
  (« Les données du type actuel … seront perdues ») ; Annuler = type
  conservé, Confirmer = type changé + données réinitialisées.
- ■ **Révision — correction immédiate** : QCM (sélection → surlignage
  `on` → validation → vert/rouge par option), texte à trous (ok/ko par
  trou, réponse attendue surlignée), calcul (tolérance réelle : « 0.5 »
  refusé, « 1 » accepté avec ± 0.01), réponse libre (référence affichée
  après révélation, autoévaluation), association (plateau réutilisé,
  tap-tap et Pointer Events revalidés, score 3/3).
- ■ **Journal et stats** : chaque réponse typée écrit `reviewLog` avec
  `t` (qcm/cloze/calc/match/free ; absent = basic) ; panneau « Par type
  de question » du tableau de bord alimenté par les données réelles
  (7 · 57 % flashcards, 2 · 50 % trous, QCM/ libres 100 %, calculs 0 %…).
- ■ **Examen 5 types** : une question à la fois, formats de réponse
  exacts (`given` : indices QCM, chaînes par trou, texte calcul,
  chaînes par paire, texte libre), correction différée — auto pour
  qcm/trous/calcul/association, autoévaluation pour la réponse libre.
  Résultat réel : **16/20 (80 %)**, 4 ✓ / 1 ✗ (calcul faux voulu),
  enregistrement `exams` conforme.
- ■ **`.reviz` v2 sans perte** : export d'un deck 5 types →
  `formatVersion: 2` + `type`/`data` dans le manifeste ; import comme
  nouveau deck → 5/5 types et données identiques ; **type inconnu
  rejeté** avec message clair ; manifeste v1 (legacy) accepté → cartes
  en flashcards ; chemin « remplacer » réparé et re-vérifié (5 cartes
  typées restaurées en place).
- ■ **`.revizbak` avec cartes typées** : backup 8 cartes (5 typées) +
  3 examens restauré sur base vide (origine séparée), données `data`
  intactes, historique examens présent.
- ■ **Compatibilité ascendante** : cartes sans `type` = flashcards
  (comportement inchangé) ; révision classique re-testée de bout en
  bout après la refactorisation (2/2, récapitulatif, stats à jour) ;
  examen flashcards-only re-testé (20/20, DB conforme).
- **Bugs réels trouvés pendant les tests — corrigés** :
  1. `el()` : `attrs.class` écrasait les classes du sélecteur (les
     options QCM perdaient `.ex-option`) → fusion des classes.
  2. `stats-service` : variable `perDay` absorbée dans un commentaire
     (ReferenceError sur #/stats) → restaurée.
  3. `syncHoles` : un marqueur `{{n}}` tapé à la main ne créait pas
     l'entrée du trou → auto-création + retrait des trous orphelins.
  4. `validateManifest` : recto/verso vide refusé alors que les cartes
     typées portent leur contenu dans `data` → règle assouplie pour
     les types (v1 inchangée pour les flashcards).
  5. Import `.reviz` chemin « remplacer » : bloc dupliqué + cartes
     écrites SANS `deckId` (invisibles du deck — bug v1) → corrigé,
     deck repeuplé et re-vérifié.
  6. `deleteDeckData` : curseur sans `cur.continue()` après
     `cur.delete()` → **plantage infini** pour tout deck contenant
     ≥ 1 carte (touchait aussi la suppression en cascade de dossier,
     re-testée : 2 ms, zéro orphelin).
- **Incident réel et récupération (honnêteté)** : pendant les tests,
  une évaluation navigateur zombie (timeout non annulé) a détruit le
  blob image de la base réelle ; récupéré **octet-pour-octet**
  (1 262 007 octets PNG) depuis une sauvegarde temporaire antérieure,
  visionneuse re-vérifiée (1024×1536) ; enregistrements de fichiers
  orphelins nettoyés. Aucune autre donnée perdue.
- ◐ Tap-tap tactile validé par Pointer Events synthétiques
  (`pointerdown`/`pointerup` avec coordonnées) — pas par une main réelle.
- ◐ Le grading des trous est global par carte (tous les trous corrects =
  carte correcte) — choix assumé, non par trou.
- ◐ Les lignes `reviewLog` créées pendant les tests conservent les
  résultats réels de ces sessions de test.

## 14. Import intelligent (novembre 2026)
- ■ **Assistant 4 étapes** (#/import) : Source (nouveaux fichiers,
  ressource existante de la bibliothèque, collage manuel) → Extraction
  (texte relu/éditable, moteur ANNONCÉ par chip) → Propositions
  (éditables, désactivables une par une, avec trace de leur phrase
  source) → Destination (nouveau deck + dossier, ou deck existant).
- ■ **PDF — couche texte locale** : extraction via PDF.js vendored
  (moteur « Couche texte du PDF (local) », compteur de pages), texte
  nettoyé de façon déterministe (césures recollées, puces neutralisées,
  espaces réduits) — PDF scan sans couche texte → message explicite.
- ■ **OCR honnêteté totale** : AUCUN moteur OCR embarqué ; image sans
  service configuré → avertissement explicite + repli collage manuel.
  Service externe FACULTATIF (Réglages → URL, vide = désactivé, aucune
  clé fournie par Reviz) : POST de l'image brute → texte ou {text} —
  joué en réel contre un service de test local (1 262 007 octets POSTés
  vérifiés côté service), échec réseau → message clair + repli.
- ■ **Génération déterministe par règles locales** (ni IA, ni résumé
  automatique — chip « Généré par règles locales — à relire » +
  « Déterministe ») : flashcards (« Terme : déf », « X est/désigne/
  signifie », FR + verbes EN courants), QCM (distracteurs issus des
  AUTRES définitions du texte, ≥ 4 définitions requises), textes à
  trous (terme/formule `$…$`/valeur chiffrée, 1 trou par phrase),
  réponses libres (référence = définition détectée), calculs (égalités
  arithmétiques explicites `a+b=c`, × et virgule convertis),
  associations (≥ 3 paires terme/définition), synthèse (première phrase
  de chaque paragraphe — aucune reformulation). Même texte → mêmes
  propositions (vérifié en réel) ; aucun motif → aucune proposition
  (message explicite).
- ■ **Relire avant d'enregistrer** : texte extrait éditable
  (textarea), chaque proposition éditable (recto/verso, options QCM
  avec bonne réponse cochable, trous avec réponses par séparateur « ; »,
  paires ajoutables/retirables), compteur « retenue(s) » réel,
  régénération confirmée (corrections perdues annoncées).
- ■ **Enregistrement réel** : nouveau deck (nom + dossier via
  sélecteur) ET deck existant testés — cartes créées avec type/data
  (carte à trous de l'assistant gradée : vraie réponse ✓, fausse ✗) ;
  navigation vers l'éditeur de deck après sauvegarde.
- ■ **Source jamais modifiée** : lecture seule — taille du blob image
  comparée avant/après le flux (1 262 007 → 1 262 007 octets).
- ■ **Points d'entrée** : bouton « Générer des révisions » dans
  FICHIERS et dans la visionneuse PDF/image.
- ◐ Motifs francophones en priorité (verbes anglais courants ajoutés) ;
  une proposition mal découpée reste ÉDITABLE et sa trace est affichée
  (aucun résultat caché).
- ◐ Le service OCR réel de l'utilisateur n'est pas testé (aucun service
  externe disponible pendant la session) — seul le chemin client
  (POST/réponse/erreurs) l'est, contre un service de test local.
- ◐ Rendu visuel non capturé (fenêtre non visible) ; vérification DOM
  + données réelles.
- **Bugs réels trouvés — corrigés** :
  7. `extract.js` : `doc.destroy()` n'existe pas sur la version vendue
     de PDF.js (plantage de l'extraction, repli silencieux en manuel)
     → destruction via la tâche de chargement, `page.cleanup` gardé.
  8. `el('span#…')` : le helper `el()` ne gère pas `#id` dans le
     sélecteur (créait un élément au nom de balise invalide) → attribut
     `id` passé via attrs ; motif absent du reste du code.
