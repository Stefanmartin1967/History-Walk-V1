# Workflow de Création et Gestion des Circuits

Ce document décrit le processus technique et opérationnel pour créer, modifier et officialiser un circuit dans l'application **History Walk**.

Ce workflow est conçu pour garantir la qualité des tracés (via GPX Studio) tout en assurant la cohérence des données dans l'application (Lieux/POIs).

---

## 🔄 Vue d'ensemble du Workflow

1.  **Création (App) :** Ébauche du circuit en mode "Vol d'oiseau" (sélection des lieux).
2.  **Export (App -> PC) :** Génération d'un fichier GPX contenant les lieux (Waypoints) et l'ID unique.
3.  **Retouche (GPX Studio) :** Création du tracé réel (sentiers, routes) entre les points.
4.  **Officialisation (PC -> Serveur) :** Envoi du fichier final via le "God Mode".
5.  **Validation (Serveur) :** Le serveur recalcule automatiquement les correspondances et met à jour l'application.

---

## 📝 Guide Détaillé étape par étape

### Étape 1 : Création de l'ébauche (Dans l'Application)
*   **Action :** Utilisez le mode "Création" pour sélectionner les lieux (pins bleus) dans l'ordre de visite souhaité.
*   **Résultat :** Vous obtenez un tracé rectiligne (lignes droites) reliant les points.
*   **Sauvegarde :** Cliquez sur "Exporter GPX".
*   **Ce que contient le fichier :**
    *   Une trace "fictive" (lignes droites).
    *   **Les Waypoints (`<wpt>`) :** La liste exacte des lieux sélectionnés.
    *   **L'ID Unique (`HW-ID`) :** Un identifiant inséré dans les métadonnées pour que le système reconnaisse ce circuit plus tard.

### Étape 2 : Le Tracé Réel (Sur GPX Studio ou équivalent)
*   **Outil :** [GPX Studio](https://gpx.studio/) (ou tout éditeur GPX).
*   **Action :** Ouvrez le fichier exporté à l'étape 1.
*   **Travail :** Utilisez les outils de routage pour dessiner le vrai chemin (sentiers, routes) que le marcheur devra emprunter.
*   **Règle d'Or :** Ne supprimez pas les Waypoints (drapeaux/marqueurs) des lieux. Ils sont essentiels pour la validation (voir point technique ci-dessous).
*   **Export :** Sauvegardez le fichier modifié sur votre ordinateur.

### Étape 3 : Vérification Locale (Optionnel mais recommandé)
*   **Dans l'App :** Utilisez le bouton **"Importer une trace réelle"** (icône dossier/GPX).
*   **Action :** Sélectionnez votre fichier modifié.
*   **Résultat :** La trace bleue "Vol d'oiseau" est remplacée par votre tracé réel rouge/bleu précis.
*   **Utilité :** Permet de vérifier visuellement que le tracé passe bien par les endroits prévus avant de l'envoyer à tout le monde.
*   *Note : Cette étape est purement locale et n'envoie rien au serveur.*

### Étape 4 : Officialisation (Upload Serveur)
*   **Dans l'App (God Mode) :** Ouvrez le menu Admin et cliquez sur **"Upload Fichier"** (icône nuage).
*   **Action :** Sélectionnez le fichier GPX final (celui modifié à l'étape 2).
*   **Validation :** Confirmez l'envoi avec votre Token GitHub.
*   **Effet :** Le fichier est envoyé dans le dossier `public/circuits/` du serveur.

---

## ⚙️ Mécanisme de Validation Automatique (Côté Serveur)

Une fois le fichier reçu, un script automatique (`scripts/generate-circuit-index.js`) analyse votre tracé pour "cocher" les lieux visités.

### Comment le système sait-il quels lieux font partie du circuit ?

Le système utilise deux règles pour relier les lieux (POIs) au tracé :

1.  **La Règle de Proximité (50m) :**
    *   Si le tracé passe à moins de **50 mètres** d'un lieu connu, ce lieu est automatiquement ajouté au circuit.

2.  **La Règle de Priorité (Exception "Hors Sentier") :**
    *   *Problème :* Parfois, un lieu (ex: une mosquée, une ruine) est inaccessible par le sentier tracé (clôture, terrain difficile). Le chemin passe alors à côté, potentiellement à plus de 50m.
    *   *Solution :* Le système lit les **Waypoints (`<wpt>`)** présents dans votre fichier GPX.
    *   Si un lieu est listé comme Waypoint dans le fichier, la tolérance est augmentée à **500 mètres**.
    *   Cela garantit que même si le sentier contourne le lieu, celui-ci restera bien associé au circuit final.

### Indépendance des Actions
*   L'étape d'**Import Local** (Étape 3) et l'étape d'**Upload** (Étape 4) sont techniquement indépendantes.
*   L'Upload envoie le fichier physique sélectionné, sans tenir compte de ce qui est affiché à l'écran.
*   Vous pouvez donc réaliser ces actions dans l'ordre de votre choix, ou sauter l'étape 3 si vous êtes confiant.

---

## 📱 Note sur l'Usage Mobile
L'application mobile History Walk sert de **support de découverte** (affichage des lieux, photos, infos historiques). Pour le **suivi GPS actif** de la randonnée (guidage tournant par tournant), il est recommandé d'utiliser une application dédiée comme **Wikiloc**, dans laquelle vous importerez le même fichier GPX final.
