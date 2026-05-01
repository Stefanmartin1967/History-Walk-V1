// welcome-actions.js
// Cable l'événement 'welcome:choice' (émis par welcome.js) sur l'état initial
// de l'app, selon le choix d'usage de l'utilisateur.
//
// Choix possibles :
//   - discover : sidebar repliée, l'utilisateur explore librement
//   - import   : sidebar dépliée sur l'onglet Mes Circuits (la liste des
//                circuits déjà importés par défaut)
//   - create   : sidebar dépliée, prêt à construire un circuit
//   - photos   : déclenche l'import des photos GPS (mode "revoir" uniquement)

import { eventBus } from './events.js';
import { ensureSidebarOpen, ensureSidebarCollapsed } from './sidebar-utils.js';

function clickIfPresent(selector) {
    const el = document.querySelector(selector);
    if (el) el.click();
}

export function setupWelcomeActions() {
    eventBus.on('welcome:choice', ({ choice }) => {
        switch (choice) {
            case 'discover':
                ensureSidebarCollapsed();
                break;

            case 'import':
                // Sidebar dépliée sur Mes Circuits : l'utilisateur consulte
                // la liste des circuits déjà importés par défaut.
                // (Le filtrage fin reste accessible via Mon Espace.)
                ensureSidebarOpen();
                clickIfPresent('[data-tab="explorer"]');
                break;

            case 'create':
                // Sidebar dépliée sur l'onglet Circuit : brouillon vide,
                // prêt à recevoir les premiers POIs.
                ensureSidebarOpen();
                clickIfPresent('[data-tab="circuit"]');
                break;

            case 'photos':
                // Mode "revoir" uniquement — déclenche le bouton existant
                clickIfPresent('#btn-import-photos');
                break;

            default:
                // Choix inconnu : on ne fait rien (équivaut à "discover" par défaut)
                break;
        }
    });
}
