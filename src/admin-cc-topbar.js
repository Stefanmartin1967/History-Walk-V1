// admin-cc-topbar.js
// Helper DOM du topbar du Control Center : pose ou efface les sub-tabs.
//
// Extrait de admin-control-ui.js (PR F audit, 21/05/2026) pour casser le cycle
// d'imports `admin-control-ui ↔ admin-maintenance` : les deux modules
// importaient setTopbarSubtabs en sens croisé. Ce module feuille (ne dépend
// que de lucide-icons) est désormais la source unique, importée par les deux —
// plus de cycle. (Le cycle était bénin — usage uniquement dans des fonctions —
// mais l'extraction nettoie le graphe de dépendances.)

import { createIcons, appIcons } from './lucide-icons.js';

/**
 * Définit ou efface les sub-tabs dans le topbar (PR 5 — sub-router intégré).
 * Quand `subtabsHTML` est non vide, le topbar passe en mode `--with-tabs`
 * (column flex) et les tabs s'affichent sur une 2e ligne avec border-bottom.
 *
 * @param {string} subtabsHTML — HTML des `<button.cc-subtab>`. '' pour effacer.
 * @param {Function|null} onClick — callback `(view) => void` quand un sub-tab
 *                                  est cliqué. Le view vient de `data-sub`.
 */
export function setTopbarSubtabs(subtabsHTML, onClick = null) {
    const topbar = document.getElementById('cc-topbar');
    const slot = document.getElementById('cc-topbar-subtabs');
    if (!topbar || !slot) return;

    if (subtabsHTML) {
        slot.innerHTML = subtabsHTML;
        topbar.classList.add('cc-topbar--with-tabs');
        if (onClick) {
            slot.querySelectorAll('.cc-subtab').forEach(btn => {
                btn.addEventListener('click', () => onClick(btn.dataset.sub));
            });
        }
        createIcons({ icons: appIcons, root: slot });
    } else {
        slot.innerHTML = '';
        topbar.classList.remove('cc-topbar--with-tabs');
    }
}
