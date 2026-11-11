# Spécification du format natif `.reviz`

## 1. Objectif

`.reviz` est le format natif des decks de flashcards de l'application. Il est conçu spécifiquement pour ce projet.

Un fichier `.reviz` doit être autonome, portable et indépendant de la base de données du navigateur. Il doit pouvoir être exporté, copié sur un autre appareil, puis importé sans perdre les cartes, leurs médias, leur mise en forme ou leurs formules.

Ne pas définir le format comme une simple référence à des données stockées dans IndexedDB.

## 2. Conteneur recommandé

Utiliser une archive ZIP avec l'extension `.reviz`.

L'archive contient un manifeste JSON et les ressources médias référencées par les cartes.

Structure recommandée :

```text
mon-deck.reviz
  manifest.json
  media/
    image-001.png
    schema-002.webp
    animation-003.gif
```

Le fichier doit être valide comme archive ZIP. Le nom de l'extension ne doit pas être utilisé comme seule validation : vérifier le contenu réel du conteneur.

## 3. Manifeste JSON

Le manifeste décrit le deck, ses cartes, leurs contenus et les références vers les médias.

Exemple indicatif :

```json
{
  "format": "reviz",
  "formatVersion": 1,
  "deck": {
    "id": "uuid-du-deck",
    "name": "Mécanique",
    "description": "Révisions de mécanique",
    "createdAt": "2026-01-01T10:00:00.000Z",
    "updatedAt": "2026-01-02T10:00:00.000Z"
  },
  "cards": [
    {
      "id": "uuid-de-la-carte",
      "position": 0,
      "front": [
        {
          "type": "text",
          "value": "Quelle est la deuxième loi de Newton ?"
        },
        {
          "type": "latex",
          "value": " \\sum \\vec{F} = m\\vec{a} "
        },
        {
          "type": "image",
          "src": "media/image-001.png",
          "alt": "Schéma des forces"
        }
      ],
      "back": [
        {
          "type": "text",
          "value": "La somme des forces extérieures est égale au produit de la masse par l'accélération."
        },
        {
          "type": "latex",
          "value": "\\sum \\vec{F} = m\\vec{a}"
        },
        {
          "type": "image",
          "src": "media/schema-002.webp",
          "alt": "Schéma explicatif"
        }
      ],
      "createdAt": "2026-01-01T10:00:00.000Z",
      "updatedAt": "2026-01-02T10:00:00.000Z"
    }
  ],
  "media": [
    {
      "path": "media/image-001.png",
      "mimeType": "image/png",
      "size": 12345
    },
    {
      "path": "media/schema-002.webp",
      "mimeType": "image/webp",
      "size": 23456
    }
  ]
}
```

Cet exemple fixe une structure de départ. Claude peut l'améliorer, mais doit conserver les principes de portabilité, de versionnement et de compatibilité.

## 4. Types de blocs de contenu

Le recto et le verso sont des séquences ordonnées de blocs. Une carte peut contenir plusieurs blocs et mélanger les types suivants :

- `text` : texte courant ;
- `latex` : expression ou formule LaTeX ;
- `image` : image référencée dans le dossier `media/` ;
- `gif` : GIF référencé dans `media/`.

Il doit être possible de mélanger ces blocs dans une même face et de conserver leur ordre.

Le modèle pourra être étendu ultérieurement à d'autres types de blocs, à condition de maintenir la compatibilité des anciennes versions.

## 5. Règles de validation

À l'importation, vérifier au minimum :
- que l'archive peut être lue ;
- que `manifest.json` existe et contient un JSON valide ;
- que le champ `format` vaut `reviz` ;
- que `formatVersion` est pris en charge ;
- que les identifiants nécessaires sont présents et uniques ;
- que chaque carte possède un recto et un verso valides ;
- que chaque référence média pointe vers un fichier présent dans l'archive ;
- que les tailles et types des fichiers sont acceptables.

Refuser les chemins de fichiers dangereux, notamment les chemins absolus et les chemins contenant des remontées de répertoire (`../`). Ne jamais extraire aveuglément une archive.

Afficher une erreur explicite si le fichier est invalide, incomplet ou utilise une version non prise en charge.

## 6. Versionnement et évolution

Le champ `formatVersion` est obligatoire.

Toute évolution incompatible du schéma doit augmenter la version majeure du format. Prévoir une fonction de migration entre versions lorsque cela est possible.

Ne pas écraser silencieusement un deck existant lors d'un import. En cas de conflit, proposer une stratégie explicite : importer comme nouveau deck, remplacer après confirmation ou annuler.

## 7. Identité et statistiques

Les identifiants de deck et de carte doivent rester stables lorsqu'un deck est exporté puis réimporté.

Les statistiques de révision ne sont pas obligatoirement incluses dans le fichier `.reviz` : elles peuvent rester propres à l'utilisateur et à son installation. En revanche, le format doit permettre d'ajouter ultérieurement une section de métadonnées optionnelle si une exportation des statistiques devient nécessaire.

Le déplacement d'un deck dans l'arborescence ne doit pas modifier ses identifiants ni effacer son historique.

## 8. Médias et intégrité

Les médias sont stockés dans l'archive, pas sous forme de chemins locaux absolus ni de références vers IndexedDB.

Le manifeste doit préciser le type MIME et, si possible, la taille de chaque média. Une somme de contrôle (hash) peut être ajoutée pour détecter les fichiers altérés.

Préserver les GIF animés. Ne pas les convertir automatiquement en images fixes.

## 9. Tests du format

Prévoir des tests couvrant :
- export puis réimport d'un deck ;
- conservation du nombre et de l'ordre des cartes ;
- conservation du texte et du LaTeX ;
- conservation des images ;
- conservation de l'animation des GIF ;
- fichiers invalides et archives corrompues ;
- médias manquants ;
- chemins dangereux ;
- version de format inconnue ;
- identifiants en doublon ;
- deck vide ;
- carte avec plusieurs types de blocs sur une même face.
