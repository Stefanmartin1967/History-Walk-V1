// sidebar-utils.js
// Helpers pour ouvrir/fermer la sidebar droite de manière cohérente.
//
// Contexte historique : deux classes CSS coexistaient dans le code,
//   - sidebar-collapsed : état utilisateur (toggle Ctrl+B), source de vérité
//   - sidebar-open      : classe legacy, effet CSS isolé sur le map
// Plusieurs endroits ajoutaient sidebar-open sans toucher à sidebar-collapsed,
// ce qui rendait l'ouverture invisible si l'user avait replié la sidebar.
//
// Ce module centralise les deux gestes pour que tous les callers ouvrent
// la sidebar de la même manière.

const SIDEBAR_KEY = 'sidebar-collapsed';

/**
 * Ouvre la sidebar (déplie + marque comme ouverte + persiste l'état user).
 * À utiliser à chaque fois qu'on affiche un contenu qui doit être visible
 * dans la sidebar (clic POI, ouverture éditeur circuit, etc.).
 */
export function ensureSidebarOpen() {
    document.body.classList.remove('sidebar-collapsed');
    document.body.classList.add('sidebar-open');
    localStorage.setItem(SIDEBAR_KEY, '0');
}

/**
 * Replie la sidebar (cache via CSS + persiste l'état user).
 * À utiliser quand l'utilisateur veut explicitement masquer la sidebar
 * (toggle Ctrl+B, choix d'onboarding "Découvrir").
 */
export function ensureSidebarCollapsed() {
    document.body.classList.add('sidebar-collapsed');
    localStorage.setItem(SIDEBAR_KEY, '1');
}

/**
 * Indique si la sidebar est actuellement visible côté utilisateur.
 * (= pas repliée par le toggle)
 */
export function isSidebarVisible() {
    return !document.body.classList.contains('sidebar-collapsed');
}
