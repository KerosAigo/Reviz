# Architecture technique attendue

## 1. Principes

Développer une application JavaScript modulaire, testable et évolutive. Choisir une architecture adaptée à une application web locale qui manipule des fichiers et des médias.

L'application doit fonctionner sans serveur pour les fonctions locales, dans la mesure du possible. Expliquer les limites des API du navigateur et les éventuelles différences entre navigateurs.

Ne pas surconcevoir le projet, mais ne pas regrouper toute la logique dans un seul fichier ou composant.

## 2. Séparation des responsabilités

Prévoir des modules distincts pour :

- interface et navigation ;
- arborescence et opérations sur les dossiers ;
- importation et validation des fichiers ;
- création et édition des decks ;
- lecture et écriture du format `.reviz` ;
- rendu LaTeX ;
- consultation des PDF et images ;
- exécution isolée des simulations HTML ;
- moteur de révision ;
- répétition espacée ;
- statistiques ;
- stockage local ;
- sauvegarde et restauration ;
- gestion des erreurs.

Les composants d'interface ne doivent pas contenir directement toute la logique métier ou les accès bas niveau au stockage.

## 3. Stockage local

IndexedDB est une option recommandée pour stocker :
- les métadonnées des dossiers ;
- les métadonnées des fichiers ;
- les données des decks et cartes ;
- les blobs des fichiers importés ;
- les statistiques et historiques ;
- les paramètres de l'utilisateur.

Concevoir des clés et relations permettant de déplacer un fichier ou un dossier sans perdre son identité.

Prévoir des transactions pour les opérations qui modifient plusieurs enregistrements. Une opération interrompue ne doit pas laisser l'arborescence dans un état incohérent.

Ne pas utiliser `localStorage` pour stocker des fichiers volumineux ou l'ensemble des médias.

## 4. Fichiers et importation

Créer un service d'importation commun qui :
1. identifie le type de fichier ;
2. valide son contenu ;
3. lit ou stocke les données ;
4. crée les métadonnées nécessaires ;
5. rattache le fichier au dossier choisi ;
6. signale les erreurs ;
7. affiche une progression pour les opérations longues.

Ne pas se fier uniquement à l'extension du fichier. Vérifier également son contenu et son type lorsque cela est possible.

Prévoir une gestion des noms en conflit et des doublons.

## 5. Bibliothèques possibles

Évaluer et choisir des bibliothèques maintenues, adaptées au besoin :
- KaTeX ou MathJax pour le LaTeX ;
- PDF.js pour la consultation des PDF ;
- une bibliothèque ZIP pour lire et écrire les archives `.reviz` ;
- une solution de glisser-déposer compatible avec les écrans tactiles, ou une implémentation native soigneusement testée.

Éviter les dépendances superflues. Indiquer les bibliothèques retenues, leur rôle et les raisons du choix.

## 6. Rendu LaTeX

Centraliser le rendu LaTeX dans un service ou composant réutilisable. Il doit être utilisé par l'éditeur de flashcards, le mode révision, les prévisualisations et les contenus de cours compatibles.

Conserver la source LaTeX dans les données. Le HTML rendu ne doit pas devenir la seule version sauvegardée.

Gérer les erreurs de rendu localement : une formule incorrecte ne doit pas faire disparaître le reste de la carte ou du cours.

## 7. Simulations HTML

Afficher les simulations importées dans un contexte isolé, par exemple un iframe sandboxé avec une politique de permissions minimale.

Les simulations ne doivent pas avoir accès à IndexedDB de l'application, aux fonctions internes, aux jetons, aux fichiers privés ou à l'interface de contrôle.

Ne pas injecter le contenu HTML importé directement dans le DOM principal. Ne pas autoriser par défaut les accès réseau, les pop-ups, les téléchargements ou les formulaires vers des destinations externes. Si certaines permissions sont indispensables à une simulation, les traiter explicitement et documenter le compromis.

## 8. Révision et statistiques

Le moteur de révision doit être indépendant de l'interface. Il reçoit une sélection de cartes et des paramètres de session, puis renvoie les cartes à présenter et les résultats.

La sélection d'un dossier doit parcourir récursivement ses descendants pour identifier les decks `.reviz`.

Les résultats doivent être enregistrés au fil de la session, pas uniquement à la fermeture de celle-ci. Une fermeture accidentelle ne doit pas effacer toute la progression.

Le calcul de répétition espacée doit être isolé et testé.

## 9. Sauvegarde et restauration

Prévoir une sauvegarde complète contenant :
- les dossiers et leur hiérarchie ;
- les decks et cartes ;
- les ressources importées ;
- les paramètres ;
- les statistiques et historiques.

Le format de sauvegarde globale peut être une archive distincte du `.reviz`, car il contient davantage que des decks individuels.

La restauration doit être validée avant de modifier les données existantes. Prévoir une stratégie de fusion ou de remplacement clairement expliquée.

## 10. Qualité du code

- Utiliser des noms explicites.
- Éviter les fonctions géantes.
- Centraliser les constantes.
- Valider les entrées.
- Gérer les erreurs de manière cohérente.
- Ajouter des tests unitaires aux fonctions métier.
- Ajouter des tests d'intégration aux opérations de stockage et d'importation.
- Documenter les décisions techniques non évidentes.
- Fournir des instructions reproductibles pour installer, lancer et tester l'application.
