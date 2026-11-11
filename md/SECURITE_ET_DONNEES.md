# Sécurité, données et confidentialité

## 1. Principe général

L'application manipule des fichiers locaux potentiellement non fiables. Un fichier importé ne doit jamais être considéré comme sûr simplement parce qu'il a une extension connue.

Les simulations HTML/JavaScript sont particulièrement sensibles et doivent être isolées du reste de l'application.

## 2. HTML et JavaScript importés

Ne jamais insérer directement le code HTML importé dans le DOM principal.

Utiliser un iframe sandboxé ou un mécanisme équivalent avec les permissions minimales nécessaires. Ne pas activer automatiquement des permissions puissantes telles que l'accès au même contexte d'origine, les pop-ups ou les téléchargements.

Ne pas permettre aux simulations d'accéder :
- aux données IndexedDB de l'application ;
- aux informations des decks ;
- aux statistiques ;
- aux paramètres privés ;
- aux mécanismes de sauvegarde ;
- aux fonctions internes de l'application.

Limiter les accès réseau par défaut. Signaler les dépendances externes manquantes au lieu de les charger silencieusement.

## 3. Archives `.reviz`

Traiter les archives comme des entrées non fiables.

Se protéger contre :
- les chemins de fichiers malveillants ;
- les archives anormalement volumineuses ;
- les fichiers avec une extension trompeuse ;
- les manifestes JSON invalides ;
- les références vers des médias inexistants ;
- les archives corrompues ;
- les fichiers ayant un type MIME incohérent.

Définir des limites raisonnables et configurables de taille de fichier, de nombre de cartes et de volume total de médias. Afficher un message explicite lorsqu'une limite est atteinte.

## 4. LaTeX

Utiliser un moteur de rendu adapté et ses options de sécurité. Ne pas activer les fonctionnalités qui permettent l'exécution de code arbitraire ou l'insertion non contrôlée de HTML.

Le texte saisi doit être traité comme du contenu, pas comme du code exécutable.

## 5. Suppressions et modifications

Demander une confirmation avant toute suppression de fichier, dossier, deck ou carte.

Lorsqu'un dossier est supprimé, préciser si son contenu sera également supprimé. Éviter toute suppression implicite d'un grand nombre de ressources.

Pour les opérations de remplacement ou de restauration, expliquer les conséquences et demander une confirmation.

## 6. Persistance et pertes de données

Gérer les erreurs d'écriture et les quotas de stockage. Ne pas annoncer qu'une sauvegarde ou un enregistrement a réussi avant d'avoir reçu la confirmation du stockage.

Enregistrer les résultats de révision régulièrement. Prévoir un mécanisme de récupération en cas de fermeture inattendue.

L'utilisateur doit pouvoir exporter ses données pour ne pas dépendre d'un navigateur ou d'un appareil.

## 7. Confidentialité

Par défaut, les fichiers et les statistiques restent sur l'appareil. Toute fonctionnalité nécessitant un service externe doit être clairement identifiée et ne doit pas transmettre des fichiers sans action ou information explicite de l'utilisateur.
