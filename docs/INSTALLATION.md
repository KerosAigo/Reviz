# Installation et lancement

## Prérequis

- Node.js ≥ 18 (testé avec Node qui exécute `node http` natif). Vérifier :
  `node --version`.
- Un navigateur récent : Chrome/Edge/Chromium (Chrome ≥ 120), Firefox ESR
  récent. Aucun paquet npm, aucun build : les bibliothèques sont embarquées
  dans `vendor/` (KaTeX 0.19.1, PDF.js 6.5.438, fflate 0.8.2).

## Lancer

Deux façons équivalentes :

- **Windows** : double-cliquer `start.bat` (il exécute `node server.mjs` dans le
  dossier de l'app).
- **Toutes plateformes** : `node server.mjs` à la racine du projet.

Le serveur n'effectue aucun filtrage de contenu : il sert uniquement le dossier
de l'application. Il écoute sur http://localhost:8377 (port modifiable avec la
variable d'environnement `PORT`) et refuse les chemins sortant du dossier
(pas d'accès extérieur au répertoire).

> Ouvrir `index.html` en `file://` ne fonctionnera pas : les modules ES et le
> worker de PDF.js exigent un contexte HTTP.

## Accéder depuis un téléphone ou une tablette

1. Lancer le serveur (il écoute toutes les interfaces).
2. Trouver l'adresse IP de l'ordinateur sur le même réseau Wi-Fi (Windows :
   `ipconfig` → IPv4).
3. Ouvrir `http://<adresse-IP>:8377` sur l'appareil.

Le pare-feu Windows peut demander l'autorisation : autoriser pour les réseaux
privés. Le stockage IndexedDB est local à chaque appareil.

## Sauvegarde et restauration

- Onglet **Réglages → Sauvegarde complète** : « Créer une sauvegarde »
  télécharge un fichier `reviz-AAAA-MM-JJ-HHMM.revizbak`.
- « Restaurer depuis un fichier… » : choisir un `.revizbak`, lire le récapitulatif,
  puis confirmer (« Tout remplacer »). La base est remplacée en une unique
  transaction (tout ou rien).

## Mise à jour / réinstallation de navigateur

Les données restent dans le profil du navigateur. Pensez à garder une
sauvegarde `.revizbak` hors du navigateur (elle est autonome : archives + JSON).
