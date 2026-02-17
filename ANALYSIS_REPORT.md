# Rapport d'Analyse Technique - History Walk

## Introduction
Ce rapport fait suite à la demande d'analyse complète de l'application History Walk. L'objectif est d'identifier les incohérences, les zones de fragilité et les contradictions structurelles qui ont mené aux récents dysfonctionnements ("cassé l'application").

Aucune modification de code n'a été effectuée pour ce rapport. Il s'agit d'un état des lieux basé sur la version actuelle (`3.5.5`).

---

## 1. Conflits et Incohérences Structurelles

### A. La Gestion de la Carte : Deux Logiques Concurrentes
**Le problème immédiat (Capture d'écran) :**
Le conflit Git actuel sur `src/map.js` est le symptôme d'une duplication de logique.
*   Dans la version locale (et `ui-sidebar.js`), on utilise une fonction nommée `resizeMap()`.
*   Dans la version distante (et probablement d'anciennes versions), on utilise `invalidateMapSize()`.
**Risque :** Si deux développeurs (ou deux sessions de travail) renomment la même fonction différemment, Git ne peut pas fusionner. C'est une erreur "humaine" de refactoring non propagé.

### B. Le "Cheval de Troie" Mobile
L'application se veut "PC First" avec un mobile limité ("Pas de carte sur mobile").
Cependant :
*   Le fichier `src/mobile.js` importe des fonctions depuis `src/map.js` (ex: `getRealDistance`, `getIconForFeature`).
*   Bien que `initMap` ne soit pas appelée sur mobile, le fichier `src/map.js` est tout de même chargé par le navigateur.
**Risque Critique :** Si un jour une ligne de code "exécutable immédiatement" (comme `L.divIcon(...)` en dehors d'une fonction) est ajoutée dans `map.js`, la version mobile **crashera instantanément** car la librairie Leaflet (`L`) n'est peut-être pas chargée ou initialisée sur mobile.
**Recommandation :** Il faut isoler les calculs géographiques purs (distance, icônes) dans un fichier neutre (ex: `src/geo-utils.js`) qui ne dépend PAS de `Leaflet` ni du DOM de la carte.

### C. Le Cycle de Vie des Circuits Officiels ("Shadow Copy")
Le système actuel pour permettre à l'utilisateur de modifier un circuit officiel est ingénieux mais **très fragile**.
1.  **Au chargement (`main.js`) :** On charge les officiels (JSON) ET les locaux (DB). On fusionne les deux en mémoire.
2.  **À la sauvegarde (`gpx.js`) :** On sauvegarde la version modifiée dans la base locale (`savedCircuits`).
3.  **Le danger :** Si la fusion au démarrage échoue ou si l'ID change légèrement, l'application peut se retrouver avec **deux versions** du même circuit (l'officiel et le brouillon local) dans la liste, ou pire, écraser les données officielles avec une version obsolète locale.
C'est probablement la cause des régressions "Trace Rouge vs Trace Bleue" mentionnées. Si le lien (ID) est perdu, le circuit redevient un "Brouillon" (Rouge).

---

## 2. Analyse du Workflow GPX & Données

### A. La Dépendance aux Métadonnées (`HW-ID`)
Le système repose sur la présence d'un identifiant `[HW-ID:HW-...]` caché dans les métadonnées du fichier GPX.
*   **Point Fort :** Cela permet de lier un fichier externe (GPX Studio) à un circuit interne de manière unique.
*   **Point Faible :** Si l'utilisateur utilise un autre logiciel que GPX Studio qui "nettoie" les fichiers (supprime les balises inconnues ou les commentaires), ce lien est **détruit**.
*   **Conséquence :** L'import échoue ou crée un doublon au lieu de mettre à jour le circuit. La logique de secours (basée sur la proximité géographique) est complexe et peut échouer si les points ont été déplacés.

### B. Le Mode "Admin" Schizophrène
Il existe deux manières d'activer le mode Admin :
1.  **Desktop :** Taper `G` -> `O` -> `D` au clavier.
2.  **Mobile/Tactile :** Cliquer 7 fois sur le numéro de version.
**Observation :** Ce n'est pas un bug, mais cela complexifie la maintenance. Si on change la logique d'un côté, on oublie souvent l'autre.

### C. Initialisation "Race Condition" (Course de vitesse)
Dans `main.js`, la fonction `loadAndInitializeMap` lance plusieurs processus en parallèle (Chargement config, chargement DB, chargement HTML).
**Risque :** Si la configuration `destinations.json` met trop de temps à charger (réseau lent), l'application risque d'initialiser la carte avec des valeurs par défaut ("Djerba") avant de recevoir la vraie configuration ("Hammamet"), provoquant un "saut" visuel ou un bug d'affichage. La version actuelle semble avoir un `await` correct, mais c'est un point de vigilance constant.

---

## 3. Synthèse et Recommandations

### Pourquoi l'application "casse" souvent ?
L'application a grandi par "couches" (features) sans que les fondations (base de code commune) ne soient toujours consolidées.
1.  **Dépendances croisées :** Mobile dépend de Map, UI dépend de State, Map dépend de UI... C'est un "plat de spaghettis" où tirer sur un fil fait bouger tout le reste.
2.  **Duplication de code :** Plusieurs fonctions font presque la même chose (ex: calcul de distance dans `map.js` et parfois dans `utils.js` ou `circuit.js`).

### Plan d'Action Suggéré (Pour plus tard)
Avant d'ajouter toute nouvelle fonctionnalité, il faudrait :
1.  **Standardiser le vocabulaire :** Choisir entre `resize` et `invalidate` et s'y tenir partout.
2.  **Isoler le Mobile :** Couper le cordon ombilical entre `mobile.js` et `map.js`. Créer un `src/core/geo.js` pour les maths.
3.  **Simplifier la Fusion :** Revoir la logique de chargement pour qu'elle soit plus déterministe (Officiel > Local > Défaut) et moins dépendante de l'ordre d'arrivée des fichiers.

Ce rapport est purement analytique et ne modifie aucun fichier.
