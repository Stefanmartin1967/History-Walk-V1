# Audit Architectural & Technique : History Walk (Application Web PWA)

Ce rapport dresse un bilan critique et approfondi de l'état actuel de l'application History Walk. Il se concentre sur la qualité structurelle, les performances, l'accessibilité, la sécurité et l'évolutivité.

---

## 1. Vue d'Ensemble & Tableau des Points Critiques

| Domaine | Problème Identifié | Impact | Priorité |
| :--- | :--- | :--- | :--- |
| **Sécurité (XSS)** | Injection massive de code HTML via `innerHTML` (plus de 250 occurrences) sans assainissement préalable. | Élevé (Risque d'exécution de scripts malveillants si les données sont altérées). | **Critique** |
| **Sécurité (Secret)** | Stockage en clair du Token GitHub (PAT) dans le `localStorage` (`github_pat`). | Élevé (Vol de compte/accès repo en cas de XSS). | **Critique** |
| **Sécurité (CSP)** | La Content-Security-Policy (CSP) dans `index.html` autorise `'unsafe-inline'` pour les scripts et les styles. | Élevé (Annule la protection CSP contre les failles XSS). | **Critique** |
| **Architecture (État)**| Mutations directes de l'état global (`state.userData = ...`) malgré la présence de "Setters" (Gardiens) dans `state.js`. | Moyen (Couplage fort, imprévisibilité des mises à jour UI, dette technique). | Haute |
| **Performance (DOM)** | Reconstruction complète de fragments complexes du DOM au lieu de mises à jour granulaires (ex: listes de circuits mobiles reconstituées via chaînes de caractères). | Moyen (Reflows fréquents, ralentissement sur appareils mobiles anciens). | Haute |
| **Architecture (Events)**| Mixité entre l'utilisation d'un `EventBus` moderne et d'attaches statiques `document.getElementById('...').addEventListener` (plus de 300 occurrences). | Faible (Difficulté à suivre le flux de données, "Spaghetti code"). | Moyenne |
| **Sémantique/A11y** | Abus de balises non-sémantiques (`<div>`, `<span>`) cliquables au lieu de `<button>`, sans attributs ARIA adéquats ni gestion du focus. | Faible (Expérience dégradée pour les lecteurs d'écran et la navigation clavier). | Moyenne |

---

## 2. Analyse Détaillée

### A. Qualité du Code (DRY, SOLID & Lisibilité)
Le projet montre une volonté de modularité grâce à l'utilisation des ES Modules (`import`/`export`) gérés par Vite. L'introduction récente d'un `EventBus` (`src/events.js`) et de "Gardiens" (`src/state.js`) marque un passage vers une architecture de type Flux/Redux simplifiée.

Cependant :
*   **Encapsulation (SOLID - Single Responsibility)** : La règle n'est pas strictement appliquée. Des fichiers comme `app-startup.js` ou `admin-control-center.js` mutent directement l'objet `state` au lieu de passer systématiquement par les Setters (ex: `setUserData`). Cela rend le flux d'informations imprévisible.
*   **Couplage UI/Logique** : Beaucoup de fichiers mélangent la logique métier (calculs de données) et la génération de balises HTML (ex: `admin-control-ui.js`, `mobile.js`).
*   **Inconsistance** : Le projet est défini en `"type": "commonjs"` dans le `package.json`, mais utilise la syntaxe `import/export` (Modules ES). Bien que Vite gère cette transpilation silencieusement en développement, cela crée une dette technique de configuration.

### B. Performance (DOM & IndexedDB)
*   **IndexedDB** : La gestion de la base de données locale (`src/database.js`) est robuste. L'utilisation du batching (`batchSavePoiData`) avec une approche "read-before-write" privilégie intelligemment la sécurité des données sur la vitesse brute (évitant l'écrasement silencieux). C'est un excellent point.
*   **Manipulation du DOM** : C'est le principal goulot d'étranglement. L'utilisation intensive de templates littéraux injectés via `.innerHTML` oblige le navigateur à détruire et recréer complètement l'arbre DOM interne à chaque modification. Cela casse les écouteurs d'événements, forçant une ré-attache fastidieuse et obligeant le code à invoquer explicitement `createIcons({ icons })` à chaque rendu pour réafficher les SVG Lucide. Sur des listes longues (Circuits, Photos), cela nuit à la fluidité (FPS drop sur mobile).

### C. Sécurité
L'application côté client souffre de trois vulnérabilités majeures interconnectées :
1.  **XSS & `.innerHTML`** : Toute donnée utilisateur malicieuse injectée (par exemple via le nom d'un circuit ou d'un POI importé) sera exécutée par le navigateur en raison de l'utilisation non sécurisée de `.innerHTML`.
2.  **CSP Faible** : La directive `script-src 'self' 'unsafe-inline'` dans le header du `index.html` permet l'exécution de ces scripts injectés.
3.  **Fuite de Credentials** : Le Token d'Accès Personnel GitHub (PAT), nécessaire aux fonctionnalités d'administration, est stocké en clair dans `localStorage.getItem('github_pat')`. En cas d'exploitation XSS (point 1 et 2), ce token (qui donne un accès direct au dépôt GitHub) peut être volé par un script malveillant. L'authentification par hash SHA-256 côté client protège l'accès à l'interface, mais n'empêche pas l'extraction de ce token si la machine est compromise.

### D. Accessibilité (A11y) & Sémantique HTML
*   L'interface repose beaucoup sur des éléments de style (`div.btn`, etc.) auxquels on attache des événements de clic.
*   Il manque des balises ARIA (ex: `aria-expanded` pour les menus déroulants, `aria-label` pour les boutons composés uniquement d'icônes) et la gestion du focus clavier (tabindex) n'est pas gérée lors de l'ouverture des fenêtres modales (ex: `custom-modal-overlay`).

### E. Évolutivité
L'ajout de nouvelles fonctionnalités devient complexe à cause du pattern de génération UI. Pour ajouter un simple bouton dans la liste mobile, il faut modifier de longues chaînes de texte (templates littéraux HTML) dans `mobile.js`, recréer les événements associés, et s'assurer que Lucide Icons est rappelé. Ce modèle limite l'évolutivité par rapport à une approche basée sur des composants (`document.createElement` ou un framework léger).

---

## 3. Recommandations Concrètes

1.  **Refactoring de l'État (Urgence : Haute)**
    *   **Action** : Parcourir l'ensemble du code pour supprimer les mutations directes (`state.property = value`) et les remplacer par les appels aux fonctions de `src/state.js` (`setProperty(value)`).
    *   *Bénéfice* : Prévisibilité totale du comportement de l'application et facilité de débogage.

2.  **Sécurisation du Rendu DOM (Urgence : Critique)**
    *   **Action** : Remplacer systématiquement les appels à `.innerHTML` par la création d'éléments via `document.createElement()` (ou l'utilisation de méthodes sûres comme `.textContent` pour insérer du texte). Si l'utilisation de templates est nécessaire pour la lisibilité, implémenter une fonction utilitaire d'assainissement (Sanitizer) ou utiliser `DOMParser` pour nettoyer la chaîne avant insertion.
    *   *Bénéfice* : Élimination des failles XSS et amélioration des performances (mise à jour granulaire du DOM).

3.  **Renforcement de la CSP (Urgence : Critique)**
    *   **Action** : Retirer `'unsafe-inline'` de la politique Content-Security-Policy dans `index.html`. Déplacer tout script "inline" (s'il y en a) vers des fichiers externes.
    *   *Bénéfice* : Bloque net l'exécution de scripts XSS.

4.  **Découplage UI / Événements (Urgence : Moyenne)**
    *   **Action** : Au lieu d'attacher des événements après chaque injection HTML, utiliser la **délégation d'événements** (attacher un seul `EventListener` sur un conteneur parent qui écoute les "bulles" d'événements venant de ses enfants dynamiques).
    *   *Bénéfice* : Moins de consommation mémoire, suppression des bugs d'événements "morts" après une mise à jour visuelle.

5.  **Amélioration A11y (Urgence : Faible)**
    *   **Action** : Remplacer les `<div class="btn">` cliquables par de véritables `<button type="button">`. Ajouter `aria-hidden="true"` sur les icônes purement décoratives.
    *   *Bénéfice* : Accessibilité conforme aux standards modernes.