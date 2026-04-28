/**
 * sidebar-toggle.js
 * Toggle collapsible de la sidebar droite (point #6 audit Stefan).
 *
 * - Bouton flèche entre la map et la sidebar
 * - Click toggle l'état (ouvert/replié)
 * - Persistance via localStorage 'sidebar-collapsed'
 * - Raccourci clavier Ctrl+B (Cmd+B sur macOS)
 * - Desktop uniquement (sur mobile la sidebar a sa propre nav)
 *
 * Le redimensionnement de la map est géré automatiquement par le
 * ResizeObserver attaché au container Leaflet (cf. map.js).
 */

const STORAGE_KEY = 'sidebar-collapsed';

export function setupSidebarToggle() {
    const toggle = document.getElementById('sidebar-toggle');
    if (!toggle) return;

    // Restauration de l'état au boot
    const initiallyCollapsed = localStorage.getItem(STORAGE_KEY) === '1';
    if (initiallyCollapsed) {
        document.body.classList.add('sidebar-collapsed');
        updateToggleAria(true);
    }

    toggle.addEventListener('click', () => {
        const willCollapse = !document.body.classList.contains('sidebar-collapsed');
        document.body.classList.toggle('sidebar-collapsed', willCollapse);
        localStorage.setItem(STORAGE_KEY, willCollapse ? '1' : '0');
        updateToggleAria(willCollapse);
    });

    // Raccourci Ctrl+B / Cmd+B (pattern VS Code)
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b') {
            // Ne pas intercepter si l'utilisateur est dans un champ d'édition
            const tag = document.activeElement?.tagName;
            const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable;
            if (isEditable) return;

            e.preventDefault();
            toggle.click();
        }
    });
}

function updateToggleAria(collapsed) {
    const toggle = document.getElementById('sidebar-toggle');
    if (!toggle) return;
    if (collapsed) {
        toggle.setAttribute('aria-label', 'Ouvrir la barre latérale');
        toggle.setAttribute('title', 'Ouvrir la barre latérale (Ctrl+B)');
    } else {
        toggle.setAttribute('aria-label', 'Replier la barre latérale');
        toggle.setAttribute('title', 'Replier la barre latérale (Ctrl+B)');
    }
}
