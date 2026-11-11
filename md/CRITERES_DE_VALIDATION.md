# Critères de validation et plan de tests

L'application ne peut être considérée comme terminée que lorsque les scénarios essentiels ci-dessous ont été testés et fonctionnent.

## 1. Dossiers et fichiers

- Créer un dossier et un sous-dossier.
- Renommer un dossier.
- Déplacer un fichier vers un autre dossier.
- Déplacer un dossier avec son contenu.
- Importer plusieurs fichiers de types différents.
- Sélectionner et déplacer plusieurs fichiers.
- Supprimer un fichier après confirmation.
- Supprimer un dossier après confirmation, avec une information claire sur son contenu.
- Fermer puis rouvrir l'application et vérifier que l'arborescence est conservée.

## 2. Création de flashcards

- Créer un deck.
- Ajouter plusieurs cartes.
- Modifier le recto et le verso.
- Réordonner les cartes.
- Ajouter du texte.
- Ajouter une image sur le recto.
- Ajouter un GIF animé sur le verso.
- Ajouter du LaTeX en ligne et en bloc sur les deux faces.
- Mélanger texte, LaTeX et médias sur une même face.
- Prévisualiser le rendu.
- Enregistrer, fermer et rouvrir le deck.
- Vérifier que tous les contenus et leur ordre sont conservés.

## 3. Format `.reviz`

- Exporter un deck.
- Importer ce deck dans une installation ou une base vide.
- Vérifier les cartes, leur ordre, les formules, les images et les GIF.
- Importer un fichier invalide et vérifier que l'erreur est compréhensible.
- Tester une archive corrompue.
- Tester un média absent.
- Tester un chemin malveillant.
- Tester une version inconnue du format.
- Vérifier qu'un conflit de nom ou d'identifiant ne provoque pas d'écrasement silencieux.

## 4. Cours et documents

- Importer et ouvrir un PDF.
- Naviguer entre ses pages.
- Zoomer et dézoomer.
- Importer et afficher une image.
- Afficher correctement un GIF animé.
- Vérifier le comportement sur un écran de téléphone.
- Vérifier le rendu des cours contenant du LaTeX lorsque le contenu est géré par l'application.
- Vérifier que les PDF existants sont affichés sans altérer leur rendu.

## 5. Simulations

- Importer un HTML autonome.
- Ouvrir la simulation dans l'application.
- Modifier ses variables et vérifier que l'animation réagit.
- Vérifier que la simulation n'accède pas aux données de l'application.
- Vérifier qu'un HTML invalide ou une ressource manquante produit un message compréhensible.
- Vérifier que la simulation reste utilisable sur téléphone.

## 6. Révisions

- Lancer une révision depuis un seul deck.
- Lancer une révision depuis un dossier contenant plusieurs decks.
- Lancer une révision depuis un dossier parent contenant plusieurs niveaux de sous-dossiers.
- Vérifier que seuls les decks descendants du dossier sélectionné sont inclus.
- Vérifier le nombre de cartes annoncé avant le lancement.

### Réponse libre chronométrée

- Vérifier le compte à rebours de 10 secondes.
- Révéler la réponse avant la fin du délai.
- Laisser le délai arriver à zéro.
- Cliquer sur « Trouvé ! ».
- Cliquer sur « Pas trouvé ».
- Vérifier l'enregistrement du résultat.
- Vérifier le rendu des images, GIF et formules sur les deux faces.

### Association

- Vérifier le mélange des rectos et des versos.
- Associer correctement plusieurs paires.
- Faire une association incorrecte.
- Modifier une association avant validation.
- Valider et vérifier le score.
- Tester le glisser-déposer à la souris.
- Tester l'interaction tactile sur téléphone.
- Vérifier le rendu des médias et du LaTeX.

## 7. Statistiques et répétition espacée

- Vérifier le nombre de révisions d'une carte.
- Vérifier les compteurs de réponses correctes et incorrectes.
- Vérifier le taux de réussite.
- Vérifier la date de dernière révision.
- Vérifier que les cartes difficiles reviennent plus tôt.
- Vérifier que les cartes maîtrisées reviennent moins souvent.
- Vérifier les statistiques par deck et par dossier.
- Vérifier que déplacer un deck ne fait pas perdre son historique.

## 8. Sauvegarde et restauration

- Créer une sauvegarde complète.
- Vérifier qu'elle contient les dossiers, les fichiers, les decks, les médias et les statistiques.
- Restaurer la sauvegarde dans une base vide.
- Vérifier les données restaurées.
- Tester un fichier de sauvegarde invalide.
- Vérifier que la restauration ne remplace pas des données existantes sans avertissement et confirmation.

## 9. Compatibilité et ergonomie

Tester au minimum :
- un navigateur de bureau récent ;
- un navigateur mobile récent ;
- un écran étroit ;
- une tablette ou une largeur intermédiaire.

Vérifier qu'aucune fonction essentielle ne dépend exclusivement de la souris ou d'un écran large.

## 10. Livraison

La livraison doit contenir :
- le code source complet ;
- les dépendances et leurs versions ;
- les instructions d'installation ;
- les instructions de lancement ;
- les instructions de test ;
- une description de l'architecture ;
- les limitations connues ;
- la liste des critères de validation testés et non testés.

Ne pas déclarer un test réussi s'il n'a pas réellement été exécuté. Distinguer clairement les fonctionnalités terminées, partielles et non implémentées.
