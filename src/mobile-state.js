// mobile-state.js
// État partagé entre tous les modules mobile — getters/setters + utilitaires purs
// Ce module n'importe RIEN des autres modules mobile (couche de base, zéro dépendance circulaire).

// ─── État partagé ─────────────────────────────────────────────────────────────

let currentView = 'circuits';
let mobileSort = 'proximity_asc'; // proximity_asc | dist_asc | dist_desc (legacy: date_desc | date_asc)
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

// ─── Navigation historique mobile (pattern proactif C7) ──────────────────────
// Chaque navigation descendante pousse une entrée d'historique avec un hash
// distinct. Le Back Android pop alors cette entrée et popstate fire dans
// mobile-nav.js — le handler lit l'état de l'app et rend le niveau ad hoc
// sans rien re-pousser (évite le lock Chrome Android mid-popstate).
//
// Niveaux :
//   racine (circuits)          : pas de hash
//   circuit-details (POIs)     : #c
//   poi (fiche)                : #p
//   search/actions/add-poi     : #<view>
export function pushMobileLevel(levelHash) {
    if (!isMobileView()) return;
    const current = location.hash || '';
    const target = levelHash ? `#${levelHash}` : '';
    if (current === target) return;
    try {
        history.pushState(
            { hwLevel: levelHash || 'root' },
            '',
            target || (location.pathname + location.search)
        );
    } catch (err) {
        // En cas d'erreur (quota, mode sandboxé…), on laisse tomber sans casser.
        console.warn('[mobile-state] pushMobileLevel failed', err);
    }
}
