# Architecture d'Heripia

> Carte du code pour un repreneur — humain ou IA. À jour de juin 2026 (v3.7.x).
> Le détail des livraisons vit dans [CHANGELOG.md](CHANGELOG.md).

## 1. Vue d'ensemble & paradigme

Heripia est une PWA de découverte du patrimoine à pied (Djerba d'abord, multi-destination).
**Il n'y a aucun backend** : l'app est un site statique servi par GitHub Pages. Trois conséquences
structurent tout le reste :

- **Chaque utilisateur est l'administrateur de sa propre copie.** Il importe ses photos
  géolocalisées, enrichit les fiches de lieux, crée ses circuits — exactement comme l'admin.
  La seule différence : l'admin publie ses modifications sur GitHub (elles deviennent le
  patrimoine officiel, visible de tous), l'utilisateur les garde en local.
- **L'écriture passe par l'API GitHub.** L'admin publie via l'API Contents (PAT avec scope
  repo) ; l'utilisateur synchronise ses préférences entre SES appareils via un Gist privé
  (son propre PAT). Aucune donnée d'un utilisateur ne transite par un serveur tiers.
- **La persistance locale est IndexedDB** (données, photos en Blob, copies de secours
  hors-ligne). Tout doit survivre sans réseau : le mode hors-ligne est la promesse cœur
  (marcher sur le terrain sans connexion).

Multi-destination : `public/destinations.json` liste les destinations ; chacune a son GeoJSON
de lieux (`public/<mapId>.geojson`), ses zones (`<mapId>-zones.geojson`) et ses circuits
(`public/circuits/<mapId>.json` + GPX). Les chemins sont centralisés dans `src/config.js`
(`GITHUB_PATHS`), seule source de vérité pour le nom du dépôt.

## 2. Les données : 4 dimensions

Avant d'ajouter un mécanisme de persistance ou de sync, identifier la dimension de la donnée —
elle détermine quasi tout le comportement attendu.

| Dimension | Sémantique | Stockage | Sortie |
|---|---|---|---|
| **1. Patrimoine officiel** | Contenu canonique, identique pour tous | Fichiers du dépôt GitHub, lus au boot (puis cache PWA) | Écrit uniquement par l'admin via CC Admin → publication |
| **2. Admin éphémère** | Modifications préparées localement, en attente de publication | IndexedDB locale de l'admin | Devient Dim 1 lors de « Tout publier » |
| **3. Préférences utilisateur** | État perso vis-à-vis du contenu (vu, notes, circuits cachés, lieu de résidence…) | IndexedDB + sync Gist optionnelle (`schedulePush()`, debounce) | Reste perso, jamais publié |
| **4. Technique / session** | État UI éphémère (carte courante, mode édition, filtres…) | Mémoire vive (`state`) uniquement | Jamais persisté |

Deux subtilités à connaître :

- **`state.userData[poiId]` est dual.** Les clés listées dans `PERSONAL_KEYS`
  (`src/config.js`) sont Dim 3 : synchronisées par Gist et **purgées à la publication**
  (anti-fuite de données perso vers le GeoJSON public). Toute *autre* clé écrite dans
  `userData` (catégorie, description… via l'éditeur de lieu) est une modification de
  contenu : le moteur de diff la repère génériquement et elle part au GeoJSON publié.
  Conséquence pratique : ajouter un champ patrimoine à l'éditeur ne demande aucune
  modification du moteur de diff.
- **Flux de publication d'une destination** : brouillon local (Scout / Mode Données) →
  publication GitHub (`publish-destination.js`) → « Officialiser » (entrée dans
  `destinations.json`). Piège « push-puis-reload » : le boot lit GitHub **Pages** (build
  ~1-2 min après chaque push) alors que le diff admin lit l'API Contents (fraîche) — ne
  jamais supprimer une source locale juste avant un rechargement qui en dépend.

## 3. Carte des modules (`src/`, ~100 modules ES)

| Domaine | Modules clés |
|---|---|
| **Boot & état** | `main.js` (entrée), `app-startup.js` (chargement data + replis hors-ligne), `state.js` (état global + setters), `config.js`, `logger.js` |
| **Événements** | `events-bus.js` (bus), `events.js`, `events-global.js`, `events-desktop.js` (câblage DOM) |
| **Carte** | `map.js` (Leaflet + clustering), `poi-icons.js` (pack d'icônes POI + légende), `lucide-icons.js` (pack Lucide `appIcons`), `zones.js`, `osm-zones.js` |
| **Données & persistance** | `data.js` (lecture/écriture userData), `database.js` (wrapper IndexedDB), `taxonomy.js` (référentiel catégories), `local-destinations.js`, `zip-store.js` |
| **Circuits** | `circuit.js`, `circuit-actions.js`, `circuit-view.js` (fiche), `ui-circuit-list.js`, `ui-circuit-editor.js`, `circuit-list-service.js`, `circuit-flags.js` (drapeaux hors-tracé), `circuit-focus.js`, `circuit-reference-layer.js`, `circuit-trash-ui.js`, `gpx.js`, `start-point.js`, `access-point*.js` |
| **Routing** | `circuit-routing.js` (BRouter, profil piéton, repli vol d'oiseau), `ui-circuit-routing.js` |
| **Fiche lieu & édition** | `ui-details.js`, `richEditor.js` (éditeur de lieu), `templates.js` (rendu HTML des fiches), `search.js`, `searchManager.js` |
| **Photos** | `photo-service.js`, `photo-import-ui.js` (import par lots), `photo-clustering.js` (association GPS), `ui-photo-batch.js` (tri/Comparer), `ui-photo-grid.js`, `ui-photo-viewer.js`, `heic.js` (HEIC→JPEG via wasm) |
| **Admin (CC)** | `admin.js`, `admin-control-center.js`, `admin-control-ui.js`, `admin-cc-topbar.js`, `admin-diff-engine.js` (diff local↔GitHub), `admin-geojson.js`, `admin-maintenance.js`, `github-sync.js` (API Contents), `tested-sync.js`, `publish-destination.js` |
| **Mode Données & Scout** | `mode-donnees.js` (édition de masse in-app), `scout.js` (prospection de destinations), `osm-overpass.js`, `osm-pass.js` |
| **Sauvegarde & sync user** | `gist-sync.js` (préférences via Gist), `fileManager.js` (export/import backup), `backup-auto-local.js`, `sync.js` (⚠️ = partage de circuit par QR code, pas la sync Gist) |
| **Mobile** | `mobile-nav.js` (dock), `mobile-state.js`, `mobile-menu.js`, `mobile-poi.js`, `mobile-circuits.js`, `mobile-follow.js` (suivi GPS de circuit) |
| **UI partagée** | `modal.js` (`openHwModal` + helpers), `toast.js`, `ui-sidebar.js`, `ui-filters.js`, `filter-panel.js`, `topbar-v2.js`, `theme.js` (4 thèmes), `help-popover.js` + `help-content.js`, `welcome.js`, `statistics.js` (Mon Espace), `tts.js`, `net.js`, `utils.js`… |

Côté CSS : `style.css` (statique, hors HMR Vite) importe des partiels par domaine dans
`style/` ; `style/tokens.css` porte les variables des 4 thèmes (maritime, desert, oasis, night).

## 4. Conventions

- **État** : ne jamais muter `state` directement — passer par les setters de `state.js`,
  qui notifient les abonnés.
- **Modales** : tout passe par `openHwModal` (`modal.js`) et ses helpers `hwConfirm` /
  `hwAlert` / `hwPrompt`. L'empilement est interdit : une sous-modale suspend la modale
  parente (`suspendHwModal` / `resumeHwModal`). Le piège de focus, l'ARIA et la restitution
  du focus sont fournis par `openHwModal` — ne pas les réimplémenter.
- **CSS** : classes uniquement, jamais de `style="…"` inline (bloqué par la CSP en
  production — voir pièges). Les écritures CSSOM (`el.style.x = …`) restent permises.
- **Icônes** : Lucide est consommé via le pack `appIcons` (`src/lucide-icons.js`) ; les
  icônes de catégories de lieux via `poi-icons.js` (27 icônes dédiées).
- **Livraison** : chaque PR bump `APP_VERSION` (`src/state.js`) et ajoute son entrée en
  tête de `CHANGELOG.md`. CI sur chaque PR : Vitest (~950 tests) + knip (code mort, à
  garder à zéro). Merge en squash.
- **Mobile** : les écrans plein-page suivent le patron 3 slots (header / scrollable /
  footer) ; un footer d'écran masque le dock via CSS.

## 5. Les pièges connus

Distillés de l'historique du projet — chacun a déjà coûté une session de debug.

1. **La CSP de production diffère du dev.** `style-src 'self'` bloque les styles inline en
   prod ; le serveur Vite les autorise. Un bug de rendu invisible en preview peut donc
   apparaître uniquement sur heripia.com. Nouvelle UI = classes CSS only.
2. **Il y a DEUX éditeurs de lieu.** La donnée d'un lieu s'édite via « Éditer le lieu »
   (`richEditor.js`) ET via le Mode Données. Un nouveau champ doit être câblé aux deux,
   plus à l'affichage (`templates.js`).
3. **Une icône Lucide hors du pack est invisible.** Avant d'utiliser une nouvelle icône,
   vérifier qu'elle est enregistrée dans `appIcons` (`src/lucide-icons.js`) — sinon rien
   ne s'affiche, avec un warning console en boucle.
4. **La taxonomie a deux sources.** Les *données* (catégories autoritaires) viennent de
   `public/poi-categories.json` chargé dans `taxonomy.js` ; les *icônes et la légende*
   de `poi-icons.js`. Une liste qui semble « obsolète » est souvent un cache PWA, pas
   une vraie divergence.
5. **GitHub Pages est en retard sur l'API.** Après un push, Pages sert l'ancienne version
   pendant ~1-2 min alors que l'API Contents est déjà à jour. Tout flux « pousser puis
   recharger » doit en tenir compte (garder la source locale jusqu'à confirmation).
6. **`style.css` n'a pas de HMR.** C'est un `<link>` statique avec cache-buster
   (`style.css?v=N`) : bumper `?v=` à chaque livraison qui touche au CSS, et penser au
   cache-buster pour vérifier un rendu en preview.
7. **Le viewer photo est gelé.** `.is-photo-viewer` ne doit pas être retouché ; il partage
   `style/modals.css` avec toutes les modales — vigilance sur les classes de base.
