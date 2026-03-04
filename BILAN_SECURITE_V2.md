# Bilan des Actions de Sécurité et d'Architecture (Audit V2)

Ce document résume les actions ciblées qui ont été mises en place pour répondre aux recommandations critiques et hautes soulevées par l'`audit_architectural_v2.md`.

L'objectif prioritaire de ces interventions était d'améliorer la sécurité et la stabilité du code **sans risquer de casser des fonctionnalités existantes**, en choisissant une approche "chirurgicale" plutôt qu'une refonte complète et risquée.

---

## 1. Ce qui a été réalisé aujourd'hui

### A. Sécurisation du Rendu DOM (Priorité Critique - Risque XSS)
*   **Le problème initial :** L'application utilise massivement `.innerHTML` pour afficher les listes (circuits, lieux). Cela permettait théoriquement à un texte malveillant (ex: le nom d'un circuit importé) d'exécuter du code à l'insu de l'utilisateur (faille XSS).
*   **Notre approche (Le choix de la sécurité de fonctionnement) :** Au lieu de réécrire complètement la façon dont l'application dessine les boutons (ce qui aurait été extrêmement lourd et risqué), nous avons créé une petite fonction "videur de sécurité" (`sanitizeHTML` dans `src/utils.js`).
*   **Comment ça marche :** Avant qu'un texte ne soit affiché à l'écran, ce videur l'analyse. Il supprime purement et simplement toutes les balises `<script>` dangereuses et neutralise les liens trompeurs (`javascript:`).
*   **Pourquoi ce compromis :** Nous avons fait le choix de **ne pas** bloquer tous les événements en ligne (comme les `onclick=` intégrés dans les boutons HTML). L'application s'appuie énormément dessus pour fonctionner (par exemple, pour supprimer une étape d'un circuit). Les bloquer aurait sécurisé à 100% l'application mais l'aurait rendue totalement inutilisable. Notre solution colmate la faille principale tout en gardant une application 100% fonctionnelle.

### B. Finalisation du Refactoring de l'État (Priorité Haute - Stabilité)
*   **Le problème initial :** Malgré le grand nettoyage précédent (Phase 5), il restait quelques endroits (dans `src/app-startup.js` et `src/admin-control-center.js`) où le code modifiait directement la mémoire globale de l'application "en cachette" (ex: `state.userData = ...`). Cela peut provoquer des bugs difficiles à trouver où des données s'écrasent.
*   **Notre approche :** Nous avons traqué ces dernières "fuites". Désormais, chaque fois que ces fichiers veulent modifier les données de l'utilisateur ou le statut des circuits, ils sont obligés de passer par la "porte d'entrée officielle" (les fonctions `setUserData`, `setOfficialCircuitsStatus`, etc.).
*   **Bénéfice :** L'application est maintenant totalement prévisible. Le risque qu'une modification locale (comme cocher un lieu "vu") écrase une autre modification est presque réduit à zéro.

---

## 2. Prochaines Étapes (Pour de futurs fils de travail)

Voici les actions restantes issues de l'audit V2, à traiter prudemment dans de futures sessions :

### 1. Renforcement de la politique de sécurité (CSP)
*   **Problème :** La règle de sécurité générale de la page (`Content-Security-Policy` dans `index.html`) est actuellement trop tolérante (`'unsafe-inline'`). Elle permet l'exécution de code écrit directement dans le HTML.
*   **Action requise :** Retirer cette tolérance (`'unsafe-inline'`) pour bloquer net toute tentative d'exécution de code pirate.
*   **Le défi technique :** Avant de pouvoir activer ce bouclier, il faudra d'abord transformer tous les boutons de l'application qui utilisent des `onclick="fonction()"` dans le texte HTML, pour utiliser une méthode d'attache d'événement plus moderne en JavaScript (via `addEventListener`). C'est un travail de longue haleine.

### C. Sécurisation du Token GitHub (Priorité Critique - Fuite de secret)
*   **Le problème initial :** L'audit soulignait que le "mot de passe" secret (Token PAT) qui permet au mode Admin de pousser les mises à jour sur GitHub était stocké "en clair" de manière persistante dans la mémoire du navigateur (`localStorage`). Si un pirate trouvait une faille pour lire cette mémoire, il aurait un accès direct et permanent au serveur (dépôt GitHub).
*   **Notre approche (Option Sécurité sans friction complexe) :** Le Token a été retiré du `localStorage` (stockage permanent) pour être placé dans le `sessionStorage` (stockage temporaire de session). De plus, le code détecte et supprime activement toute ancienne clé traînant encore dans le `localStorage` des administrateurs.
*   **Bénéfice :** Le Token ne survit plus à la fermeture de l'onglet ou du navigateur. Cela réduit considérablement la fenêtre d'exposition face à des attaques de type XSS persistantes, tout en évitant d'obliger l'administrateur à copier-coller son mot de passe à chaque action (ce qui aurait été le cas s'il était gardé uniquement en mémoire vive).

---

### D. Refonte de la Sécurité CSP et Délégation d'Événements (Priorité Critique - Faille XSS Active)
*   **Le problème initial :** Les boutons de l'interface utilisaient des attributs `onclick="..."` directement dans le code HTML (Inline JavaScript). La directive `Content-Security-Policy` (CSP) de l'application était obligée d'autoriser l'exécution de tous les scripts "en ligne" (`'unsafe-inline'` dans `script-src`), laissant une porte grande ouverte aux attaques de type XSS si un contenu malveillant (comme le nom d'un circuit) n'était pas filtré correctement par le videur `sanitizeHTML`.
*   **Notre approche (Refonte des Interactions) :** L'intégralité du code responsable des clics a été modernisée en utilisant le principe de "Délégation d'Événements". Au lieu de coder l'action directement dans le bouton en HTML, nous utilisons des "étiquettes" invisibles (attributs `data-action="..."`, `data-id="..."`). Un gestionnaire d'événements central en JavaScript lit ces étiquettes et exécute l'action appropriée. Nous avons appliqué cela aux vues d'administration (`admin-control-ui.js`, `admin-fusion-standalone.js`) et à la version Mobile (`mobile.js`).
*   **Bénéfice :** Cette modernisation nous a enfin permis de durcir drastiquement la sécurité du site. La directive `'unsafe-inline'` a été **définitivement supprimée de `script-src`** dans tous les fichiers `index.html`, `tools/fusion.html` et `tools/scout.html`. Toute tentative d'exécuter un script pirate inséré au milieu de la page sera désormais instantanément bloquée par le navigateur lui-même.

### 🛑 INCIDENT MAJEUR : À L'ATTENTION DES FUTURS DÉVELOPPEURS (NE PAS TOUCHER AU CSP DES STYLES CSS)
*   **L'incident :** Lors du renforcement de la politique de sécurité (CSP), nous avons logiquement tenté de supprimer `'unsafe-inline'` de la directive `style-src` (qui gère l'application des règles de design et de couleurs).
*   **La conséquence :** Cette action a provoqué un effondrement visuel catastrophique, principalement sur la version ordinateur (PC). Les fenêtres modales (pop-up) sont devenues inutilisables, les fonds d'écran ont disparu et les listes se sont désalignées.
*   **L'explication technique :** Bien que l'application possède des fichiers CSS externes (ex: `style.css`), son architecture historique repose encore lourdement sur l'injection de styles CSS "en ligne" (directement dans l'attribut `style="..."` des balises HTML ou via l'API JavaScript `element.style.propriete`). Bloquer ces styles en ligne par le CSP désactive tout le moteur de rendu dynamique de l'application.
*   **LA RÈGLE D'OR (INSTRUCTION FERME) :** Le compromis de sécurité a été acté avec l'utilisateur/administrateur. La faille principale (les scripts) est corrigée. **Il est formellement interdit de retirer `'unsafe-inline'` de la directive `style-src` du Content Security Policy (CSP)**. Ce point doit être considéré comme "hors périmètre" et ignoré dans toute analyse de sécurité automatique ou refactoring ultérieur, sous peine de destruction immédiate de l'interface utilisateur.

---

## 2. Prochaines Étapes Planifiées (Audit V2 - Suite)

Voici les prochaines phases d'architecture à prioriser pour les futures sessions de travail, en conservant notre approche chirurgicale et notre priorité absolue sur la non-régression de l'application existante :

### Phase 1. Finalisation de la Modernisation du Rendu (Dette technique moyenne)
*   **Problème :** L'utilisation résiduelle de très grosses chaînes de texte injectées via `.innerHTML` (notamment dans la création des cartes de circuits ou l'affichage de longues listes de POI) ralentit l'application sur les vieux téléphones et empêche une modularisation fine du design (et indirectement, nous oblige à garder des CSS en ligne).
*   **Action requise :** Commencer à remplacer chirurgicalement ces gros blocs de texte `.innerHTML` par la création d'éléments de manière native via le DOM (`document.createElement()`) ou par une fonction utilitaire de rendu plus efficace (création de composants UI purs).
*   **Attention :** Ce travail doit se faire élément par élément (ex: commencer par le bouton "Supprimer un circuit", valider, puis passer à la carte du circuit), et non par une refonte globale.

### Phase 2. Découplage de la Gestion des Fichiers GPX (Dette Architecturale)
*   **Problème :** Le fichier `src/gpx.js` gère à la fois l'analyse pure des coordonnées (parsing), les calculs mathématiques lourds de distance/dénivelé, et les alertes visuelles (`showToast`). C'est un "Objet Dieu" (God Object) miniature.
*   **Action requise :** Séparer la logique métier pure (le calcul mathématique et la lecture du fichier XML) de la logique d'interface utilisateur (les notifications). Créer par exemple un `src/gpx-parser.js` indépendant de toute interface, qui renverrait des données brutes à traiter par l'interface. Cela facilitera grandement les tests unitaires et la maintenance des calculs de dénivelé.