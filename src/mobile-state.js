// mobile-state.js
// État partagé entre tous les modules mobile — getters/setters + utilitaires purs
// Ce module n'importe RIEN des autres modules mobile (couche de base, zéro dépendance circulaire).

// ─── État partagé ─────────────────────────────────────────────────────────────

let currentView = 'circuits';
let mobileSort = 'date_desc'; // date_desc | date_asc | dist_asc | dist_desc
let mobileCurrentPage = 1;
let _allCircuitsOrdered = []; // Liste ordonnée pour le swipe entre circuits

// ─── Getters / Setters ────────────────────────────────────────────────────────

export function getCurrentView() { return currentView; }
export function setCurrentView(v) { currentView = v; }

export function getMobileSort() { return mobileSort; }
export function setMobileSort(s) { mobileSort = s; }

export function getMobileCurrentPage() { return mobileCurrentPage; }
export function setMobileCurrentPage(p) { mobileCurrentPage = p; }

export function getAllCircuitsOrdered() { return _allCircuitsOrdered; }
export function setAllCircuitsOrdered(arr) { _allCircuitsOrdered = arr; }

// ─── Utilitaires purs (aucune dépendance externe) ────────────────────────────

/** Détecte si on est en vue mobile (largeur ≤ 768 px). */
export function isMobileView() {
    return window.innerWidth <= 768;
}

/** Animation de transition d'entrée sur un conteneur. */
export function animateContainer(container) {
    container.classList.remove('view-enter');
    void container.offsetWidth; // reflow pour relancer l'animation CSS
    container.classList.add('view-enter');
}
