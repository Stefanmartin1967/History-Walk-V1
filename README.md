# History Walk

PWA (Progressive Web App) de guide touristique interactif pour Djerba, extensible à d'autres destinations. Permet de consulter des points d'intérêt sur une carte, de créer et suivre des circuits personnalisés, avec fonctionnement hors-ligne complet.

Version en production : https://stefanoworld.github.io/History-Walk-V1/

## Fonctionnalités

- **Cartographie interactive** (Leaflet) — POIs chargés depuis un GeoJSON par destination.
- **Circuits**
  - Circuits officiels fournis avec l'application (dossier `circuits/`).
  - Circuits personnels créés par l'utilisateur.
  - « Mon Espace » : sélection des circuits officiels à conserver dans sa vue.
  - Calcul de distance (vol d'oiseau ou tracé réel), export/import GPX.
- **Mode hors-ligne** via Vite PWA / Workbox (NetworkFirst sur GeoJSON et données d'app).
- **Interfaces Desktop & Mobile** adaptées au contexte d'usage.
- **Sauvegarde & sync**
  - Export/import de fichiers de backup.
  - Synchronisation optionnelle via GitHub Gist (PAT utilisateur).
- **CC Admin (God Mode)** — console d'administration intégrée pour la maintenance des données.
- **Photos géolocalisées** — extraction EXIF (exifr) et association automatique aux POIs.
- **Partage de circuit** via QR Code (URL `?import=ID1,ID2`).

## Stack

- Vanilla JavaScript (ES Modules), Vite 7, Workbox
- Leaflet 1.9, Lucide (icônes)
- IndexedDB (persistance locale), GeoJSON (source de données POIs)
- Vitest (unit) + Playwright (visual regression)

## Installation

```bash
git clone https://github.com/StefanoWorld/History-Walk-V1.git
cd History-Walk-V1
npm install
npm run dev
```

L'application s'ouvre sur `http://localhost:5173/History-Walk-V1/`.

## Scripts

| Commande | Rôle |
|---|---|
| `npm run dev` | Serveur de développement Vite |
| `npm run build` | Build production (`dist/`) |
| `npm run preview` | Serveur de prévisualisation du build |
| `npm run test` | Lancement des tests Vitest |
| `npm run update-circuits` | Régénère l'index des circuits officiels |

Le déploiement sur GitHub Pages est automatisé via GitHub Actions (pas de `npm run deploy`).

## Structure

```
src/                Code applicatif (60 modules)
  main.js           Point d'entrée
  state.js          État global + setters ("majordomes")
  app-events.js     Câblage DOM ↔ logique
  map.js            Couche Leaflet
  circuit.js        Logique des circuits
  database.js       Wrapper IndexedDB
  templates.js      Rendu HTML
  ...
circuits/           Circuits officiels par destination (JSON)
public/             Assets statiques, manifest PWA
tools/scout.html    Outil de scouting de POIs
scripts/            Scripts Node (génération d'index, etc.)
tests/              Tests Vitest + Playwright
history_walk_datamanager/   Sous-projet séparé (gestionnaire de données)
```

## Destinations

L'application supporte plusieurs destinations via `public/destinations.json`. Chaque destination définit son GeoJSON, sa vue initiale et sa devise.

## Documentation

Analyse architecturale et notes internes : voir `.claude/` (non distribué).

## License

Copyright © 2026 Stefan Martin. All rights reserved.
See [LICENSE](LICENSE) file for details.

Map data © OpenStreetMap contributors, available under the
[Open Database License (ODbL)](https://www.openstreetmap.org/copyright).
