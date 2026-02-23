# Documentation Technique History Walk

Ce document compile les informations techniques, l'architecture, et les workflows de l'application History Walk.

## 1. Architecture & État du Code

L'application suit une architecture modulaire basée sur les standards ES Modules.

### Structure
*   **Modules** : Code divisé en modules fonctionnels (`src/map.js`, `src/ui.js`, `src/state.js`, etc.).
*   **État Global** : Géré de manière centralisée dans `src/state.js` et exporté, évitant la pollution de l'objet global `window`.
*   **Dépendances** :
    *   `Leaflet` : Moteur de carte (CDN).
    *   `Lucide` : Icônes (ES Module).
    *   `Exif.js` : Lecture des métadonnées photo (CDN).

### Principes Clés
*   **DRY (Don't Repeat Yourself)** : La logique commune (calcul de distance, détection de zone, génération d'icônes) est centralisée dans `src/utils.js` ou des helpers dédiés.
*   **Pas de Globales** : Les variables comme `state` ou `lucide` ne sont plus exposées sur `window` (sauf exceptions pour outils de debug isolés comme `fusion.html`).

---

## 2. Gestion des Circuits (Lifecycle)

### Cycle de Vie Détaillé
Ce workflow décrit le passage d'un circuit du statut de brouillon à celui de circuit officiel.

#### 1. Création "Vol d'Oiseau" (Brouillon)
*   **Action :** L'utilisateur clique sur des POIs en mode "Sélection".
*   **Technique :**
    *   Le circuit est stocké en mémoire dans `state.currentCircuit`.
    *   L'ID du circuit est `null` (statut brouillon).
    *   La distance est calculée via `getOrthodromicDistance` (somme des segments directs POI à POI).
*   **Visuel :**
    *   Une ligne **rouge en pointillés** relie les points.
    *   L'icône "Oiseau" s'affiche à côté de la distance.
    *   Le titre est "Nouveau Circuit" (ou généré auto "Boucle autour de...").

#### 2. Exportation (Officialisation Locale)
*   **Action :** L'utilisateur clique sur "Sauvegarder & Exporter GPX".
*   **Technique :**
    *   Un identifiant unique est généré : ex `HW-174125...`.
    *   Cet ID est inscrit de force dans les métadonnées du fichier GPX (`<link>...[HW-ID:HW-1741...]</link>`).
    *   Le circuit passe de "Brouillon" à "Mon Circuit" dans `state.myCircuits`.
*   **Visuel :**
    *   Le fichier `.gpx` est téléchargé.
    *   Le circuit apparaît dans la liste "Explorer" (onglet gauche).

#### 3. Importation de la Trace Réelle ("Trust Mode")
*   **Action :** L'utilisateur clique sur "Importer GPX" et sélectionne le fichier (issu de Garmin, gpx.studio, etc.).
*   **Technique :**
    *   L'application scanne le fichier et détecte que l'ID interne (`HW-1741...`) **correspond** à l'ID du circuit actif.
    *   Elle met à jour la propriété `realTrack` avec les coordonnées exactes du fichier.
    *   Elle **conserve** les étapes (POI) intactes pour éviter toute suppression accidentelle.
*   **Visuel :**
    *   La ligne rouge en pointillés est remplacée par une ligne **bleue continue** (ou verte si marquée "Fait").
    *   L'icône change pour des "Empreintes de pas".
    *   La distance est recalculée précisément sur le tracé réel (`getRealDistance`).

#### 4. Officialisation (Serveur)
*   **Action (Développeur) :** Le fichier GPX final est placé dans le dossier `public/circuits/[mapId]/`.
*   **Technique :**
    *   Au déploiement, le fichier est indexé dans `[mapId].json` (via GitHub Action ou script).
*   **Résultat :**
    *   Le circuit devient accessible à tous avec le badge "Officiel" (Étoile).
    *   Il ne peut plus être supprimé par les utilisateurs.

### Identifiant HW-ID
L'identifiant `HW-ID` garantit la cohérence entre l'application et les fichiers GPX externes.
*   **Format** : `HW-[Timestamp]` (ex: `HW-1741258963254`).
*   **Stockage GPX** : Intégré dans les métadonnées pour résister aux éditeurs tiers.
    *   Priorité lecture : `<author><name>` > `<keywords>` > `<desc>`.
    *   Format balise : `[HW-ID:HW-...]`.

---

## 3. Logique d'Importation GPX

Le module `src/gpx.js` gère l'importation avec une validation stricte pour protéger les données.

### Algorithme de Validation
1.  **Vérification ID** :
    *   **Match** : Si l'ID du fichier correspond au circuit actif -> **Mise à jour autorisée** (Trace réelle remplace la théorique).
    *   **Mismatch** : Si l'ID diffère -> **Erreur Bloquante** (Protection contre écrasement).
2.  **Absence d'ID (Fichiers externes)** :
    *   **Match Géographique** : Si les points du tracé passent à <60m des POI du circuit -> **Confirmation requise**.
    *   **Aucun Match** : Si aucune corrélation -> **Avertissement Critique**.
3.  **Hors Zone** : Si le tracé est entièrement hors de la bounding box de la carte -> **Import Bloqué**.

---

## 4. Gestion des POI & Zones

### Création
*   **Manuel** : Clic-droit -> "Valider cette position".
*   **Photo** : Import EXIF -> Clustering géographique -> Création ou enrichissement.

### Détection de Zone (`src/utils.js`)
La fonction `getZoneFromCoords` est le point unique de vérité pour l'assignation des zones (Houmt Souk, Midoun, etc.). Elle est utilisée lors de :
*   La création manuelle de POI.
*   L'importation de photos.
*   La fusion de données (évitant ainsi les zones "A définir" par défaut).

---

## 5. Architecture des Fichiers & Décisions Techniques

Cette section explicite les choix architecturaux concernant le stockage et le nommage des fichiers, répondant aux compromis entre contraintes techniques et usage humain.

### 5.1 Nommage des Fichiers GPX (Export vs Stockage)

Il existe une dualité entre le nom de fichier "technique" et le nom "d'usage" :

*   **Le Besoin Utilisateur (Export)** : Lorsqu'un utilisateur télécharge un GPX (pour Wikiloc, Garmin, ou partage), le nom du fichier doit être **lisible et explicite** (ex: `Circuit du phare de Taguermess.gpx`). Un nom technique type `circuit_2024_A_B.gpx` serait obscur pour l'humain qui souhaite retrouver son fichier plus tard.
*   **La Contrainte Technique** : Pour un serveur ou un système de fichiers strict, les espaces et accents sont parfois problématiques.
*   **Notre Solution** :
    *   **À l'export (Client)** : Nous privilégions l'expérience utilisateur. Le navigateur génère le fichier à la volée avec le nom complet lisible.
    *   **Sur le Serveur (Officiel)** : Les fichiers sources (dans `public/circuits/`) gardent aussi des noms lisibles ou semi-lisibles. Bien que nous pourrions utiliser des IDs stricts, conserver un nom parlant facilite la maintenance manuelle par le développeur (on identifie le contenu sans ouvrir le fichier). Le lien technique est assuré par le fichier d'index (voir 5.3) qui mappe un ID logique au nom de fichier réel.

### 5.2 Structure de Stockage (`public/circuits/`)

Tous les circuits officiels sont actuellement stockés dans le répertoire `public/circuits/` et organisés en sous-dossiers par carte.

*   **Structure** :
    *   `public/circuits/djerba/` : Contient les GPX pour Djerba.
    *   `public/circuits/djerba.json` : Index généré automatiquement.
*   **Automatisation (GitHub Actions)** :
    *   Lorsqu'un fichier GPX est ajouté dans un sous-dossier, une Action GitHub (`update-circuits.yml`) se déclenche.
    *   Elle génère/met à jour le fichier JSON correspondant (`djerba.json`).
    *   Si le fichier GPX n'a pas d'`HW-ID` interne, l'action en génère un et **l'inscrit dans le fichier GPX** pour assurer un lien permanent même en cas de renommage.

### 5.3 Convention de Nommage (`djerba.json` vs `djerba.geojson`)

Nous maintenons une symétrie sémantique stricte entre les données de la carte et les circuits associés pour permettre la gestion multi-destinations.

*   **`djerba.geojson` (La Carte)** : Contient les **Lieux** (Points of Interest - POI). C'est la donnée géographique brute du territoire.
*   **`djerba.json` (L'Index des Circuits)** : Contient la liste des **Itinéraires** officiels associés à ce territoire spécifique.
*   **Logique de Scalabilité** : Si demain nous ajoutons une nouvelle destination (ex: `hammamet.geojson`), l'application cherchera automatiquement `hammamet.json` dans le dossier circuits pour charger les itinéraires correspondants. Cela permet d'ajouter des destinations à l'infini sans modifier le code source (`src/`), uniquement en ajoutant des données (`public/`).

---

## 6. Stratégie de Données & Sauvegardes

L'architecture repose sur une distinction stricte entre les données statiques (officielles) et les données dynamiques (utilisateur), suivant une philosophie "Clean Slate".

### 6.1 Types de Données
*   **Données Officielles (Static)** : Carte de base (`[mapId].geojson`) et Circuits Officiels (`[mapId].json`). Chargées depuis le serveur, jamais incluses dans les sauvegardes pour éviter la redondance.
*   **Données Utilisateur (Dynamic)** : Statut de visite, notes, lieux personnalisés, circuits créés, et photos. Stockées dans le navigateur (IndexedDB).

### 6.2 Formats de Sauvegarde
*   **Sauvegarde Mobile (`.txt`)** : Format léger (JSON minifié). Inclut préférences, visites, et circuits perso. **Exclut** les photos. Idéal pour le transfert rapide.
*   **Sauvegarde PC (`.json`)** : Format complet. Inclut tout le contenu mobile + les photos encodées en Base64. Utilisé pour l'archivage long terme.

### 6.3 Stockage des Photos (IndexedDB)
*   **Local Only** : Les photos sont stockées dans le store `poiUserData` de la base IndexedDB du navigateur.
*   **Optimisation** : Avant stockage, les images sont automatiquement compressées (JPEG 70%, max 1024px) pour économiser l'espace disque.

---

## 7. Outils & Maintenance

### 7.1 Mode Administrateur ("God Mode")
Un mode caché destiné au développeur pour débloquer des fonctions avancées (export GeoJSON maître, nettoyage).
*   **Activation (Desktop)** : Séquence clavier **`G` -> `O` -> `D`** sur la fenêtre principale.

### 7.2 Console de Fusion (`tools/fusion.html`)
Outil dédié à la maintenance du fichier GeoJSON maître.
*   **Usage** : Permet de fusionner les données collectées sur le terrain (via une sauvegarde Mobile) avec le fichier source du projet.
*   **Fonction** : Analyse les différences, détecte les nouveaux lieux, et met à jour les coordonnées GPS ou les notes.

### 7.3 Module Scout (`tools/scout.html`)
Outil de repérage pour l'initialisation de nouvelles destinations.
*   **Usage** : Interroge l'API Overpass (OpenStreetMap) pour générer un squelette GeoJSON de POIs (Mosquées, Forts, Musées, etc.) autour d'un point donné.

---

## 8. Contraintes Architecturales & Risques Connus

Cette section, issue de l'audit V2 (v3.5.5), recense les fragilités structurelles à connaître avant toute intervention.

### 8.1 Dépendance Mobile / Carte (Le "Cheval de Troie")
*   **Risque :** Le code mobile (`src/mobile.js`) importe des fonctions utilitaires depuis `src/map.js`.
*   **Danger :** `src/map.js` dépend de `Leaflet` (L). Si Leaflet n'est pas chargé sur mobile (pour optimiser), l'import provoque un crash immédiat.
*   **Règle d'Or :** Ne jamais ajouter de code "exécutable immédiatement" (top-level) dans `map.js`. Tout doit être encapsulé dans des fonctions. Idéalement, déplacer les calculs purs dans `src/utils.js`.

### 8.2 Circuits : La "Shadow Copy"
*   **Mécanisme :** Pour modifier un circuit officiel (lecture seule), l'app crée une copie locale (shadow) dans `state.myCircuits`.
*   **Risque :** Conflit d'ID ou désynchronisation. Si l'utilisateur a une copie locale d'un circuit officiel qui a été mis à jour sur le serveur, il risque de voir des doublons ou des états incohérents (Trace Rouge vs Bleue).

### 8.3 Race Conditions au Démarrage
*   **Observation :** L'initialisation UI (`main.js`) démarre parfois avant le chargement complet de la config (`destinations.json`).
*   **Symptôme :** Affichage temporaire de textes par défaut ("Djerba") avant le switch vers la bonne destination.

### 8.4 Fragilité du Workflow GPX
*   **Point Critique :** La reconnaissance des circuits repose sur le tag `[HW-ID]` dans les métadonnées GPX.
*   **Vulnérabilité :** Si un éditeur tiers "nettoie" ce tag, le lien est rompu. L'import échoue ou crée un doublon.

---

## 9. Gamification & Progression System

Ce chapitre récapitule la logique actuelle (implémentée dans `src/statistics.js`) pour le calcul des rangs, des stades et de la pondération.

### 9.1 Pondération Globale (XP)

L'expérience (XP) est calculée sur une base de **20 000 points maximum**, répartis équitablement entre la distance parcourue et le nombre de circuits terminés.

**Formule :**
`XP = (DistanceParcourue / DistanceTotaleOfficielle * 10 000) + (CircuitsTermines / CircuitsTotauxOfficiels * 10 000)`

- **Distance :** 50% de la note (10 000 XP max)
- **Circuits :** 50% de la note (10 000 XP max)

#### Rangs Globaux (Basés sur l'XP Total)

| XP Minimum | Titre |
| :--- | :--- |
| 20 000 | **Lueur d'Éternité** (100%) |
| 17 000 | Souffle Céleste |
| 13 500 | Sagesse des Sables |
| 10 000 | Regard d'Horizon |
| 7 000 | Sillage d'Argent |
| 4 500 | Âme Vagabonde |
| 2 500 | Cœur Vaillant |
| 1 200 | Esprit Curieux |
| 500 | Petite Étincelle |
| 0 | Premier Souffle |

### 9.2 Rangs Animaux (Basés sur la Distance)

Ces rangs sont déterminés par le **pourcentage de la distance totale officielle** parcourue.
*Note : Dans l'interface d'administration actuelle, ces valeurs peuvent apparaître avec l'unité "km", mais le code utilise bien des pourcentages (0-100%).*

| Pourcentage Min | Titre | Icône | Description |
| :--- | :--- | :--- | :--- |
| 90% | **Phénix** | flame | Légendaire |
| 80% | Aigle Royal | bird | Vue d'ensemble sur l'île |
| 70% | Ours Polaire | snowflake | Un marcheur confirmé |
| 60% | Grand Cerf | crown | Majestueux |
| 50% | Loup | paw-print | L'endurance s'installe |
| 40% | Chamois | mountain | On grimpe en compétence |
| 30% | Lynx | eye | L'agilité augmente |
| 20% | Renard | dog | On sort des sentiers battus |
| 10% | Hérisson | sprout | On commence à explorer |
| 0% | Colibri | feather | Les premiers pas |

### 9.3 Rangs Matières (Basés sur les Circuits)

Ces rangs sont déterminés par le **pourcentage du nombre total de circuits officiels** terminés.

| Pourcentage Min | Titre | Couleur |
| :--- | :--- | :--- |
| 90% | **Diamant** | #b9f2ff |
| 80% | Saphir | #0F52BA |
| 70% | Cristal | #e6e6fa |
| 60% | Or | #FFD700 |
| 50% | Argent | #C0C0C0 |
| 40% | Acier | #434B4D |
| 30% | Bronze | #CD7F32 |
| 20% | Cuivre | #B87333 |
| 10% | Pierre | #888888 |
| 0% | Bois | #8B4513 |

### 9.4 Résumé Technique

- **Fichier source :** `src/statistics.js`
- **Variables exportées :** `GLOBAL_RANKS`, `ANIMAL_RANKS`, `MATERIAL_RANKS`
- **Calcul :** Fonction `calculateStats()`
