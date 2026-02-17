# Rapport d'Analyse Approfondi - History Walk (V2)

## 1. Introduction
Ce rapport répond à la demande d'analyse critique de l'application pour comprendre pourquoi elle "casse" régulièrement et identifier les contradictions structurelles.
**Constat global :** L'application souffre d'un couplage excessif entre ses composants. Une modification sur la version PC (Carte) entraîne souvent des effets de bord invisibles sur la version Mobile, et inversement.

---

## 2. Contradictions Majeures & "Choses Bizarres"

### A. Le "Cheval de Troie" Mobile (Dépendance Fantôme)
*   **Le Principe :** "Pas de carte sur mobile".
*   **La Réalité (Code) :** Le fichier `src/mobile.js` importe des fonctions depuis `src/map.js` (ex: `getRealDistance`, `getIconForFeature`).
*   **Le Danger :** Pour fonctionner, `map.js` a besoin de la librairie Leaflet (`L`). Si le script Leaflet n'est pas chargé sur mobile (pour optimiser), l'import de `map.js` fera **crasher l'application mobile** instantanément au démarrage, écran blanc.
*   **Pourquoi ça casse :** Si un développeur ajoute une ligne de code exécutée immédiatement dans `map.js` (ex: `const myIcon = L.divIcon(...)`), cela brise le mobile qui ne connaît pas `L`.

### B. La Schizophrénie des Données ("Shadow Copies")
*   **Le Principe :** Les circuits officiels sont en lecture seule (JSON serveur), les circuits perso sont modifiables (IndexedDB).
*   **La Pratique (Code) :** Pour permettre la modification d'un tracé officiel (ex: ajout d'une trace réelle), le système crée une **copie cachée** (Shadow) dans la base de données locale (`state.myCircuits`), tout en gardant l'original en mémoire (`state.officialCircuits`).
*   **Le Problème :**
    1.  L'application doit constamment jongler pour savoir lequel afficher.
    2.  Si l'ID change ou si la fusion échoue au démarrage (`main.js`), l'utilisateur voit des doublons ou perd ses modifications.
    3.  C'est la source probable des bugs "Trace Rouge (Brouillon) vs Trace Bleue (Officielle)".

### C. La Fragilité du Workflow GPX (Le "HW-ID")
*   **Le Système :** L'application injecte un ID secret `[HW-ID:HW-...]` dans les métadonnées du fichier GPX pour le reconnaître au retour.
*   **La Faille :** Si l'utilisateur passe le fichier dans un logiciel tiers (autre que GPX Studio) qui "nettoie" les métadonnées inutiles, **le lien est rompu**.
*   **Conséquence :** L'import échoue ou crée un nouveau circuit "Brouillon" au lieu de mettre à jour l'existant. La logique de secours (basée sur la géométrie) est complexe et risque de mal identifier le circuit si les points ont bougé.

---

## 3. Zones de Fragilité Technique

### A. Spaghetti Code & Duplication
*   **Calcul de Distance :** La fonction de calcul de distance existe en plusieurs endroits ou est importée de manière croisée (`map.js`, `circuit.js`). Si on change la formule d'un côté, l'autre reste faux.
*   **Main.js "Dieu" :** Le fichier `src/main.js` est devenu un "God Object" qui importe et gère TOUT (UI, Map, Data, Mobile, Events). C'est trop lourd. Une erreur dans l'initialisation de la carte PC peut bloquer le démarrage du Mobile.

### B. Le Mode Admin "Caché"
*   **Incohérence :**
    *   Sur PC : `G` -> `O` -> `D` (Clavier).
    *   Sur Mobile : 7 clics sur le numéro de version.
    *   Dans l'URL : `?mode=admin`.
*   **Risque :** Trois portes d'entrée différentes pour la même fonctionnalité. Si on sécurise l'une, on oublie souvent les deux autres.

### C. Initialisation "Course de Vitesse" (Race Conditions)
*   Dans `main.js`, l'application lance l'initialisation de l'interface (`initializeDomReferences`) et des écouteurs **avant** même d'avoir chargé la configuration (`loadDestinationsConfig`).
*   Si le réseau est lent, l'interface peut s'afficher avec des textes par défaut ("Djerba") avant de basculer brutalement sur la bonne configuration ("Hammamet"), ou pire, enregistrer des données avec le mauvais ID de carte.

---

## 4. Recommandations (Pour ne plus casser)

Pour stabiliser l'application, il ne faut pas "ajouter des fonctionnalités", mais **nettoyer les fondations** :

1.  **Couper le Cordon Mobile/Map :** Créer un fichier `src/geo-utils.js` (pur calcul mathématique, sans Leaflet) pour que le Mobile puisse calculer des distances sans toucher à la Carte.
2.  **Standardiser l'Import GPX :** Rendre l'import plus robuste en se basant sur le *nom* du fichier ou une correspondance floue plus simple si l'ID est perdu, et avertir clairement l'utilisateur.
3.  **Simplifier `main.js` :** Découper l'initialisation en phases strictes :
    1.  Chargement Config.
    2.  Détection Mode (Mobile/PC).
    3.  Lancement du module concerné UNIQUEMENT (ne pas charger la Map si on est sur Mobile).

Ce rapport est un constat. La balle est dans votre camp pour décider de la priorité des corrections.
