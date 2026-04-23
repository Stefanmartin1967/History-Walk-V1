// ui-dom.js
// Bag de références DOM partagé — module feuille (aucune dépendance).
// Extrait d'ui.js pour rompre les cycles `ui.js ↔ consommateurs-de-DOM`.
// initializeDomReferences() dans ui.js mute cet objet au démarrage.

export const DOM = {};
