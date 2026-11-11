# Documentation du projet — application de révision

Ce dossier contient les documents de référence à fournir à Claude avec l'image servant de référence visuelle.

## Ordre de lecture demandé

1. `SPECIFICATION_FONCTIONNELLE.md` — ce que l'application doit permettre de faire.
2. `FORMAT_REVIZ.md` — définition du format natif des decks `.reviz`.
3. `ARCHITECTURE_TECHNIQUE.md` — architecture et choix techniques attendus.
4. `SECURITE_ET_DONNEES.md` — sécurité, stockage, sauvegardes et confidentialité.
5. `CRITERES_DE_VALIDATION.md` — tests et conditions permettant de considérer le travail terminé.

## Consigne générale à Claude

Lis tous les documents avant de commencer à coder. Examine également l'image de référence fournie séparément. L'image est la référence principale pour la direction artistique : ne déduis pas une direction graphique différente à partir de ces documents.

Ne remplace pas une fonctionnalité demandée par une maquette, un bouton inactif ou une simulation. Si une fonctionnalité est impossible ou limitée, explique précisément pourquoi, propose une solution réaliste et signale clairement ce qui reste incomplet.

Commence par présenter brièvement l'architecture proposée et les éventuels points techniques à arbitrer. Puis développe l'application par étapes vérifiables. Maintiens ces documents à jour si une décision technique modifie le comportement décrit.

## Périmètre essentiel

- Application web JavaScript utilisable sur ordinateur, tablette et téléphone.
- Création, modification, importation et exportation de decks `.reviz`.
- Import et consultation de PDF et d'images.
- Import et exécution isolée de simulations HTML/JavaScript.
- Organisation libre en dossiers et sous-dossiers.
- Révisions en réponse libre chronométrée et en association.
- Suivi des performances et répétition espacée.
- Rendu LaTeX dans les flashcards et les cours.
- Stockage local persistant et sauvegarde/restauration des données.
