# Heripia

PWA (Progressive Web App) de découverte du patrimoine à pied — Djerba d'abord, extensible à d'autres destinations. Carte interactive de lieux patrimoniaux, circuits à créer et à suivre sur le terrain, fonctionnement hors-ligne complet.

Version en production : https://heripia.com/

> Le dépôt s'appelle `History-Walk-V1` pour des raisons historiques : l'application a été rebaptisée **Heripia** en mai 2026.

## Fonctionnalités

- **Cartographie interactive** (Leaflet + clustering) — lieux chargés depuis un GeoJSON par destination.
- **Circuits**
  - Circuits officiels fournis avec l'application (`public/circuits/`).
  - Circuits personnels créés par l'utilisateur, avec calcul d'itinéraire piéton in-app (BRouter).
  - Suivi de circuit sur le terrain (position GPS en temps réel sur le tracé).
  - Calcul de distance (vol d'oiseau ou tracé réel), export/import GPX, partage par QR code.
- **Photos géolocalisées** — import par lots (EXIF via exifr, HEIC accepté), association automatique aux lieux par distance GPS, rognage, outils de tri.
- **Mode hors-ligne** via vite-plugin-pwa / Workbox.
- **Interfaces Desktop & Mobile** adaptées au contexte d'usage.
- **Sauvegarde & sync**
  - Export/import de fichiers de backup.
  - Synchronisation optionnelle entre appareils via GitHub Gist (PAT utilisateur).
- **Outils d'administration intégrés**
  - **CC Admin** — console de publication : diff local ↔ GitHub, publication du patrimoine.
  - **Mode Données** — édition de masse des lieux (fiches, photos, zones OSM).
  - **Scout** — prospection de nouvelles destinations via Overpass (OpenStreetMap).

## Stack

- Vanilla JavaScript (ES Modules), Vite 7, Workbox
- Leaflet 1.9 (+ markercluster), Lucide (icônes)
- IndexedDB (persistance locale), GeoJSON (source des lieux)
- Vitest (unit) + Playwright (régression visuelle) + knip (code mort), en CI sur chaque PR

## Installation

```bash
git clone https://github.com/Stefanmartin1967/History-Walk-V1.git
cd History-Walk-V1
npm install
npm run dev
```

L'application s'ouvre sur `http://localhost:5173/`.

## Scripts

| Commande | Rôle |
|---|---|
| `npm run dev` | Serveur de développement Vite |
| `npm run build` | Build production (`dist/`) |
| `npm run preview` | Serveur de prévisualisation du build |
| `npm run test` | Tests Vitest |
| `npm run knip` | Détection de code mort |
| `npm run update-circuits` | Régénère l'index des circuits officiels depuis les GPX (réparation manuelle — en usage normal, c'est l'app qui écrit l'index) |
| `npm run screenshots` | Régénère les screenshots du manifest PWA (serveur dev requis) |

Le déploiement sur GitHub Pages est automatisé via GitHub Actions (pas de `npm run deploy`).

## Structure

```
src/                Code applicatif (~100 modules ES)
  main.js           Point d'entrée
  state.js          État global + setters (« majordomes »)
  map.js            Couche Leaflet
  circuit*.js       Logique des circuits
  database.js       Wrapper IndexedDB
  ...
style/              CSS — tokens de thème + partiels par domaine
public/             Assets statiques : GeoJSON, circuits, photos, manifest PWA
docs/               Textes d'aide affichés dans l'application
scripts/            Scripts Node (génération d'index, etc.)
tests/              Tests Vitest + Playwright
```

La carte détaillée des modules, le flux des données et les conventions du projet : voir [ARCHITECTURE.md](ARCHITECTURE.md). L'historique des livraisons : [CHANGELOG.md](CHANGELOG.md).

## Destinations

L'application supporte plusieurs destinations via `public/destinations.json`. Chaque destination définit son GeoJSON, sa vue initiale et sa devise. Le cycle de vie complet d'une destination (brouillon local → publication GitHub → officialisation) est décrit dans ARCHITECTURE.md.

## License

Copyright © 2026 Stefan Martin. All rights reserved.
See [LICENSE](LICENSE) file for details.

Map data © OpenStreetMap contributors, available under the
[Open Database License (ODbL)](https://www.openstreetmap.org/copyright).
