// welcome-actions.js
// Cable l'événement 'welcome:choice' (émis par welcome.js) sur l'état initial
// de l'app, selon le choix d'usage de l'utilisateur.
//
// La sidebar droite est toujours visible sur desktop (PR 6 a supprimé le
// toggle), donc tous les choix se ramènent à activer le bon onglet.
//
// Onboarding des aides (chantier doc) : pour « create » et « photos », on ouvre
// le guide « ? » correspondant APRÈS le fondu de l'écran d'accueil. Pour les
// photos, le sélecteur de fichiers se lance à la FERMETURE du guide (sinon il
// s'ouvrirait par-dessus le guide et le masquerait).
//
// Choix possibles :
//   - discover : onglet Mes Circuits (état par défaut, l'utilisateur explore)
//   - import   : onglet Mes Circuits (idem ; filtrage fin via le panneau Filtres)
//   - create   : onglet Circuit + guide « Créer un circuit »
//   - photos   : « Préparer ses photos », puis « Importer des photos », puis import
//
// Pourquoi « Préparer ses photos » EN AMONT du guide d'import (et seulement ici) :
// ce parcours est l'entrée DÉCOUVERTE (la carte de l'écran d'accueil). Celui qui
// la choisit n'a pas forcément de photos géolocalisées — or sans position, tout
// l'import est vain : Heripia regroupe par lieu. Le guide d'import lui-même
// renvoie à « Préparer ses photos » dans sa section 0, mais ce renvoi ne menait
// nulle part tant que le thème n'était pas ouvrable. L'entrée EXPERT (menu Outils
// → Importer) reste inchangée : elle ne montre aucun guide, par choix.

import { eventBus } from './events.js';
import { openHelpPanel, configureHelp } from './help-popover.js';
import { GUIDE_CIRCUIT, GUIDE_IMPORT, HELP_PREPARER } from './help-content.js';
import { createIcons, appIcons } from './lucide-icons.js';

// Le patron d'aide rend ses icônes via createIcons. Idempotent (déjà configuré
// par ui-circuit-list / ui-photo-batch) → ré-appelé ici par robustesse.
configureHelp({ renderIcons: (root) => createIcons({ icons: appIcons, root }) });

// Délai d'ouverture du guide : un peu plus que le fondu de l'écran d'accueil
// (welcome.js retire l'overlay à 350 ms) → le drawer ne s'affiche pas par-dessus.
const WELCOME_FADEOUT_MS = 380;

function clickIfPresent(selector) {
    const el = document.querySelector(selector);
    if (el) el.click();
}

// Ouvre un guide après le fondu de l'accueil. `onClose` (optionnel) = action
// lancée à la fermeture du guide (ex. ouvrir le sélecteur de photos).
function openGuideAfterWelcome(guide, onClose) {
    setTimeout(() => {
        openHelpPanel(onClose ? { ...guide, onClose } : guide, null);
    }, WELCOME_FADEOUT_MS);
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
                openGuideAfterWelcome(GUIDE_CIRCUIT);
                break;

            case 'photos':
                // Chaîne « préparer → importer → sélectionner ». Chaque maillon se
                // déclenche à la FERMETURE du précédent : deux panneaux ne peuvent
                // pas se superposer, et l'utilisateur qui ferme tout de suite n'est
                // pas bloqué — il atterrit sur le sélecteur, comme avant.
                openGuideAfterWelcome(HELP_PREPARER, () => {
                    openHelpPanel(
                        { ...GUIDE_IMPORT, onClose: () => clickIfPresent('#btn-import-photos') },
                        null
                    );
                });
                break;

            default:
                // Choix inconnu : on ne fait rien (l'app reste sur l'onglet par défaut)
                break;
        }
    });
}
