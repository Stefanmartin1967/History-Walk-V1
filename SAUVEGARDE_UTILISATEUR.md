# Documentation du Système de Sauvegarde Utilisateur (Smart Restore)

## 1. Vue d'Ensemble

Le système de sauvegarde utilisateur de History Walk est conçu pour garantir deux choses essentielles :
1.  **La Sécurité des Données :** L'utilisateur ne doit jamais perdre sa progression (lieux visités, notes, photos) ni ses créations (nouveaux lieux, circuits).
2.  **L'Évolutivité (Smart Restore) :** Lorsqu'un utilisateur restaure une sauvegarde, il ne doit pas écraser les mises à jour de la carte officielle effectuées par l'administrateur. Ses données personnelles doivent venir se "calquer" par-dessus la carte la plus récente.

---

## 2. Structure du Fichier de Sauvegarde (`.json`)

Le fichier généré par la fonction `saveUserData` contient un objet JSON avec les clés suivantes :

### Métadonnées
*   `backupVersion`: Version du format de sauvegarde (ex: "3.0").
*   `date`: Date de création de la sauvegarde (ISO 8601).
*   `mapId`: Identifiant de la carte concernée (ex: "djerba").

### Données Utilisateur (`userData`)
C'est le cœur de la personnalisation. C'est un objet où chaque clé est l'ID d'un POI (`HW-ID`).
*   **Visites :** `vu` (booléen), `verified` (booléen).
*   **Contenu Perso :** `notes` (texte), `photos` (tableau de base64 ou URLs).
*   **Overrides (Surcharges) :** Si l'utilisateur a modifié un POI officiel :
    *   `lat`, `lng` : Nouvelles coordonnées (si déplacé).
    *   `price`, `timeH`, `timeM` : Infos pratiques corrigées.
    *   `description`, `Description_courte` : Textes modifiés.

### Carte de Base (`baseGeoJSON`)
*   Contient une copie de la carte telle qu'elle était au moment de la sauvegarde.
*   **Usage :**
    *   Pour les POI Officiels : Sert de référence, mais est généralement ignoré lors d'un "Smart Restore" au profit du fichier officiel à jour sur le serveur.
    *   Pour les POI Personnalisés (Custom) : Sert de source unique pour restaurer les lieux créés par l'utilisateur (identifiés par des IDs commençant par `HW-PC-` ou `auto_`).

### Circuits (`myCircuits`)
*   Tableau des circuits créés par l'utilisateur ou importés.
*   Contient la liste des IDs des POI étapes (`poiIds`), le nom, la description, etc.

### Corbeille (`hiddenPoiIds`)
*   Tableau d'IDs des POI que l'utilisateur a choisi de masquer (Soft Delete).
*   Ces POI ne sont pas effacés, juste filtrés de l'affichage.

---

## 3. Processus de Restauration "Intelligente" (Smart Restore)

Contrairement à une restauration classique qui écraserait tout, le Smart Restore procède en plusieurs étapes pour fusionner les données :

1.  **Extraction des Données :**
    *   Les `userData` (notes, visites, déplacements) sont extraits et sauvegardés dans la base locale (`IndexedDB`).
    *   Les **POI Personnalisés** sont détectés dans le `baseGeoJSON` de la sauvegarde (via leurs IDs spécifiques) et stockés à part dans une liste `customPois`.
    *   La liste noire (`hiddenPoiIds`) est mise à jour.
    *   Les circuits sont restaurés.

2.  **Rechargement (Reload) :**
    *   L'application force un rechargement de la page (`window.location.reload()`).

3.  **Fusion au Démarrage :**
    *   L'application charge le fichier officiel **à jour** depuis le serveur (ex: `djerba.geojson`).
    *   Elle applique immédiatement par-dessus les `userData` restaurés (ce qui réapplique les déplacements et notes sur la nouvelle carte).
    *   Elle injecte les `customPois` restaurés dans la liste des lieux affichés.
    *   Elle masque les lieux présents dans la `hiddenPoiIds`.

**Résultat :** L'utilisateur retrouve sa progression ET bénéficie des corrections géographiques ou ajouts faits par l'admin entre-temps.

---

## 4. La Corbeille (Trash Can)

*   **Principe :** Un utilisateur standard ne supprime jamais définitivement un lieu.
*   **Action :** Le bouton "Supprimer" ajoute l'ID du lieu à la liste `hiddenPoiIds`.
*   **Interface :** Un menu "Corbeille" permet de voir la liste des lieux masqués et de les **Restaurer** (retirer l'ID de la liste).

---

## 5. Persistence des Déplacements

Lorsqu'un utilisateur déplace un marqueur (via le mode "Déplacer" ou le mode Création Desktop) :
1.  Les nouvelles coordonnées sont stockées dans `userData[id].lat` et `userData[id].lng`.
2.  Le fichier GeoJSON officiel n'est pas modifié.
3.  Au chargement, le système de rendu (`data.js`) détecte ces clés et surcharge la géométrie du POI à la volée.

Ceci permet à un utilisateur de corriger la position d'un lieu officiel pour son usage personnel, sans attendre une mise à jour serveur, et sans perdre cette correction lors de la prochaine mise à jour officielle.
