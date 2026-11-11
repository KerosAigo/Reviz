# Spécification fonctionnelle

## 1. Objectif

Développer une application web complète de révision, écrite en JavaScript, utilisable sur ordinateur, tablette et téléphone. Elle rassemble dans un même espace des flashcards, des cours, des fiches et des simulations interactives.

L'application doit être réellement utilisable. Les éléments de l'interface doivent être reliés à des fonctionnalités opérationnelles et à des données persistantes.

L'image de référence fournie séparément doit guider la direction artistique, l'identité visuelle, les couleurs, les formes, les effets et la composition de l'interface. Ne pas remplacer cette référence par une esthétique générique.

## 2. Types de ressources pris en charge

### 2.1 Decks de flashcards

Le format natif de l'application est `.reviz`. Il est défini dans `FORMAT_REVIZ.md`.

L'application doit permettre de :
- créer un deck ;
- lui donner un nom et, si utile, une description ;
- ajouter des cartes ;
- modifier et supprimer des cartes ;
- réordonner les cartes ;
- ajouter du texte, des images et des GIF sur le recto et le verso ;
- intégrer des expressions et formules LaTeX ;
- prévisualiser une carte avant de l'enregistrer ;
- enregistrer automatiquement les modifications ;
- exporter un deck au format `.reviz` ;
- importer un fichier `.reviz` existant.

L'éditeur doit permettre de distinguer clairement le recto du verso. Il doit être possible de passer de l'un à l'autre pendant la création et de voir le rendu final.

Les contenus ne doivent pas être limités à du texte brut. Une carte peut mélanger texte, formule LaTeX, image et GIF, dans un ordre défini par l'utilisateur.

### 2.2 Cours et fiches

Formats à consulter :
- PDF ;
- PNG ;
- formats d'image courants pris en charge par le navigateur, au minimum JPEG, PNG, WebP et GIF.

Les PDF doivent être consultables dans l'application. Les images doivent être affichées sans imposer leur téléchargement.

Le rendu LaTeX doit également être pris en charge dans les cours. Pour les PDF, respecter le rendu déjà présent dans le document : ne pas tenter de réinterpréter ou de modifier les pages. Pour les contenus de cours créés ou affichés par l'application dans un format qui contient du texte mathématique, rendre les expressions LaTeX.

### 2.3 Simulations et animations

Formats :
- fichiers HTML autonomes ;
- animations JavaScript incluses dans ces fichiers ;
- simulations interactives autonomes.

Exemple d'usage : une simulation de physique permettant de modifier plusieurs variables et d'observer immédiatement l'évolution d'une courbe, d'un schéma ou d'une animation.

Les fichiers doivent pouvoir être ouverts et utilisés dans l'application, dans un espace isolé et sécurisé. Le fonctionnement des simulations ne doit pas leur donner accès aux données privées de l'application.

Si une simulation dépend de ressources externes absentes du fichier, afficher une erreur explicite ou signaler les dépendances manquantes.

## 3. Organisation en dossiers

L'utilisateur doit pouvoir créer une arborescence libre de dossiers et de sous-dossiers. Tous les types de ressources peuvent cohabiter dans un même dossier.

Opérations requises :
- créer un dossier ou sous-dossier ;
- renommer un dossier ;
- supprimer un dossier après confirmation ;
- déplacer un dossier ;
- déplacer un ou plusieurs fichiers ;
- sélectionner plusieurs fichiers ;
- supprimer plusieurs fichiers après confirmation ;
- importer plusieurs fichiers en une opération ;
- naviguer dans l'arborescence ;
- afficher le chemin courant et revenir aux dossiers parents.

Exemple :

```text
Mathématiques/
  Analyse/
    Cours.pdf
    Fiche_formules.pdf
    Deck_limites.reviz
    Deck_integrales.reviz
    Simulation_integrales.html
  Algèbre/
    Cours.pdf
    Deck_matrices.reviz

Physique/
  Mécanique/
    Cours.pdf
    Fiche_dynamique.png
    Deck_mecanique.reviz
    Simulation_mouvement.html
```

Un dossier parent peut contenir des ressources directement et d'autres dossiers. Les opérations sur un dossier ne doivent pas entraîner de perte involontaire de ses descendants.

## 4. Actions principales

L'interface principale doit proposer deux actions clairement identifiables.

### 4.1 Créer un deck

Ouvre l'éditeur de decks `.reviz`. L'utilisateur peut créer un nouveau deck, puis ajouter et modifier ses cartes. Il peut enregistrer le deck dans le dossier de son choix.

### 4.2 Lancer une révision

Ouvre un écran de préparation de session. L'utilisateur peut choisir :
- un deck précis ;
- un dossier ;
- un dossier parent contenant plusieurs sous-dossiers.

Lorsqu'un dossier est choisi, inclure tous les decks `.reviz` présents dans ce dossier et dans toute son arborescence descendante. Ne pas inclure les decks situés dans des dossiers frères ou parents.

Afficher avant le lancement :
- le nom du deck ou du dossier sélectionné ;
- le nombre de decks concernés ;
- le nombre total de cartes ;
- les modes de révision disponibles ;
- les paramètres de session pertinents.

La session ne doit pas commencer avant validation explicite de l'utilisateur.

## 5. Modes de révision

L'utilisateur peut choisir un mode précis ou demander une alternance des modes disponibles.

### 5.1 Réponse libre chronométrée

Déroulement :
1. Afficher une face de la carte, recto ou verso selon le sens choisi.
2. Démarrer un compte à rebours de 10 secondes.
3. Permettre à l'utilisateur de révéler la réponse avant la fin du délai.
4. Lorsque la réponse est révélée ou que le délai expire, afficher l'autre face.
5. Afficher les boutons « Trouvé ! » et « Pas trouvé ».
6. Enregistrer le résultat et passer à la carte suivante.

Le chronomètre doit être lisible et son arrivée à zéro doit être perceptible. Le dépassement du délai ne doit pas empêcher l'utilisateur de consulter la réponse et de déclarer son résultat.

Prévoir les deux sens de révision : recto vers verso et verso vers recto. Le choix du sens peut être défini avant la session.

Les images, GIF et formules LaTeX doivent être rendus correctement sur les deux faces.

### 5.2 Association de cartes

Afficher une série de cartes sous forme de deux colonnes : les rectos d'un côté et les versos de l'autre. L'utilisateur associe les éléments correspondants en les plaçant sur la même ligne.

Interactions requises :
- glisser-déposer à la souris ;
- interaction tactile adaptée au téléphone ;
- possibilité de changer une association avant validation ;
- mélange aléatoire de l'ordre des éléments ;
- validation de la série ;
- indication des associations correctes et incorrectes ;
- calcul du score.

Ne pas afficher des séries trop grandes. Prévoir un nombre de paires adapté à la taille de l'écran et permettre de passer à la série suivante.

Le rendu des cartes doit prendre en charge texte, images, GIF et LaTeX.

## 6. Suivi et répétition espacée

Conserver, pour chaque carte :
- le nombre de révisions ;
- le nombre de réponses reconnues comme correctes ;
- le nombre de réponses reconnues comme incorrectes ;
- la date de dernière révision ;
- le taux de réussite ;
- les informations nécessaires au calcul de la prochaine révision.

Mettre en place une répétition espacée. Les cartes difficiles ou échouées doivent être proposées plus rapidement. Les cartes maîtrisées doivent revenir moins souvent.

Le système doit être cohérent et documenté. Il peut s'appuyer sur un algorithme reconnu ou sur un algorithme simple défini explicitement. Ne pas prétendre utiliser un algorithme avancé si ce n'est pas le cas.

Les statistiques doivent être consultables :
- globalement ;
- par dossier ;
- par deck ;
- par carte, si cela apporte une information utile.

Les statistiques doivent rester cohérentes lorsqu'un deck est déplacé. Si une carte est modifiée, conserver son historique lorsque son identité reste la même. Si une carte est supprimée, gérer son historique sans créer de statistiques orphelines.

## 7. Rendu LaTeX

Le rendu LaTeX est obligatoire dans les flashcards et dans les contenus de cours pris en charge par l'application.

Utiliser une bibliothèque adaptée, par exemple KaTeX ou MathJax. Choisir une solution, justifier brièvement ce choix et l'intégrer de façon cohérente.

Exigences :
- prise en charge des expressions en ligne et des formules en bloc ;
- affichage des fractions, racines, sommes, intégrales, matrices, vecteurs, indices, exposants et symboles usuels ;
- rendu correct sur écran étroit ;
- possibilité de mélanger texte courant et expressions mathématiques ;
- prévisualisation immédiate dans l'éditeur de flashcards ;
- conservation du code source LaTeX dans le fichier `.reviz` ;
- gestion des erreurs de syntaxe sans faire planter l'application.

Définir une syntaxe d'édition claire, par exemple `$...$` pour les expressions en ligne et `$$...$$` pour les formules en bloc. Cette convention doit être expliquée dans l'éditeur.

Ne pas exécuter du code arbitraire à partir du contenu LaTeX. Le rendu doit être effectué par la bibliothèque choisie avec les options de sécurité appropriées.

Pour les PDF, afficher le document tel quel : les formules déjà intégrées dans le PDF ne nécessitent pas de conversion LaTeX.

## 8. Interface et ergonomie

L'interface doit être adaptative :
- ordinateur : exploiter l'espace disponible ;
- tablette : adapter les colonnes et les panneaux ;
- téléphone : privilégier les interactions tactiles et éviter les éléments trop petits.

La navigation, les dialogues, les listes, les éditeurs, les cartes et les simulations doivent rester utilisables sur les trois catégories d'appareils.

La direction artistique doit être tirée de l'image de référence fournie avec le projet. Ne pas ignorer ses choix visuels.

## 9. Persistance et sauvegarde

Les fichiers, dossiers, cartes, paramètres et historiques doivent rester présents après fermeture puis réouverture du navigateur.

Prévoir un stockage local persistant, avec IndexedDB si approprié. L'application doit gérer les erreurs de quota et les échecs d'écriture.

Prévoir :
- une sauvegarde complète des données ;
- une restauration depuis une sauvegarde ;
- une exportation et une importation indépendantes de chaque deck `.reviz` ;
- une confirmation avant les opérations destructrices ;
- une gestion des doublons à l'importation.

## 10. Exigences de qualité

- Aucun bouton purement décoratif.
- Aucun résultat ou statistique fictif.
- Aucun fichier supprimé sans confirmation.
- Aucun échec d'importation silencieux.
- Aucun contenu utilisateur perdu lors d'une modification normale.
- Les erreurs doivent être compréhensibles.
- Les opérations longues doivent afficher une progression ou un état de chargement.
- Les fonctionnalités doivent être testées sur ordinateur et téléphone.
