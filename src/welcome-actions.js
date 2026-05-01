// welcome-actions.js
// Cable l'événement 'welcome:choice' (émis par welcome.js) sur l'état initial
// de l'app, selon le choix d'usage de l'utilisateur.
//
// La sidebar droite est toujours visible sur desktop (PR 6 a supprimé le
// toggle), donc tous les choix se ramènent à activer le bon onglet.
//
// Choix possibles :
//   - discover : onglet Mes Circuits (état par défaut, l'utilisateur explore)
//   - import   : onglet Mes Circuits (idem ; le filtrage fin reste accessible
//                via Mon Espace dans le menu Outils)
//   - create   : onglet Circuit (brouillon vide, prêt à construire)
//   - photos   : déclenche l'import des photos GPS (mode "revoir" uniquement)

import { eventBus } from './events.js';

function clickIfPresent(selector) {
    const el = document.querySelector(selector);
    if (el) el.click();
}

export function setupWelcomeActions() {
    eventBus.on('welcome:choice', ({ choice }) => {
        switch (choice) {
            case 'discover':
            case 'import':
                clickIfPresent('[data-tab="explorer"]');
                break;

            case 'create':
                clickIfPresent('[data-tab="circuit"]');
                break;

            case 'photos':
                // Mode "revoir" uniquement — déclenche le bouton existant
                clickIfPresent('#btn-import-photos');
                break;

            default:
                // Choix inconnu : on ne fait rien (l'app reste sur l'onglet par défaut)
                break;
        }
    });
}
