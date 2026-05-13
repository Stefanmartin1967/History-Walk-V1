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

/** Animation de transition d'entrée sur un conteneur.
 *
 * Retire la classe `view-enter` après la fin de l'animation pour éviter
 * qu'un transform identity persistant (effet de `animation-fill-mode: both`
 * combiné à `to { transform: none }`, que le browser calcule comme
 * `matrix(1, 0, 0, 1, 0, 0)` non-none) crée un containing block qui casse
 * `position: fixed` des descendants — bug observé sur la mini-barre POI mobile
 * qui scrollait avec le contenu au lieu de rester collée en bas.
 */
export function animateContainer(container) {
    container.classList.remove('view-enter');
    void container.offsetWidth; // reflow pour relancer l'animation CSS
    container.classList.add('view-enter');
    container.addEventListener('animationend', () => {
        container.classList.remove('view-enter');
    }, { once: true });
}

// ─── Helpers slots mobile (refonte structurelle, étape 2) ───────────────────
// Pattern : #mobile-container flex column avec 3 slots (header/content/footer).
// Le footer-slot contient #mobile-view-footer (caché si vide) + #mobile-dock.
// Quand une vue veut un footer custom (boutons Partager/GPX, mini-barre POI),
// elle appelle setMobileViewFooter() qui remplit le view-footer ET masque
// automatiquement le dock via CSS (sélecteur `:not(:empty) ~ #mobile-dock`).

/** Remplit le slot header mobile avec le HTML d'une vue. Vide = slot caché. */
export function setMobileHeaderSlot(html) {
    const slot = document.getElementById('mobile-header-slot');
    if (slot) slot.innerHTML = html || '';
}

/** Vide le slot header mobile (équivalent setMobileHeaderSlot('')). */
export function clearMobileHeaderSlot() {
    setMobileHeaderSlot('');
}

/** Remplit le view-footer mobile (footer custom de la vue). Le dock est
 *  automatiquement masqué tant que le view-footer n'est pas vide.
 *  Passer null/'' restaure le dock. */
export function setMobileViewFooter(html) {
    const slot = document.getElementById('mobile-view-footer');
    if (slot) slot.innerHTML = html || '';
}

/** Vide le view-footer mobile → restaure automatiquement le dock. */
export function clearMobileViewFooter() {
    setMobileViewFooter('');
}

/** Reset des 2 slots dynamiques (header + view-footer). À appeler avant de
 *  switcher de vue pour partir d'un état propre. */
export function resetMobileSlots() {
    clearMobileHeaderSlot();
    clearMobileViewFooter();
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
