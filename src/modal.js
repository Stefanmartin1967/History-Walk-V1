// modal.js
import { createIcons, appIcons } from './lucide-icons.js';

let activeResolve = null;

/* ============================================================
   HW MODAL SYSTEM V2 (brief Claude Design #5)
   API moderne pour modales md/lg avec contenu riche.
   Coexiste avec showAlert/showConfirm/showPrompt (legacy sm).
   ============================================================ */

let activeHwOverlay = null;
let activeHwResolve = null;
let activeHwEscapeHandler = null;

/**
 * Ouvre une modale du système V2 (hw-modal).
 * @param {Object} opts
 * @param {'sm'|'md'|'lg'} [opts.size='md'] - Taille de la modale.
 * @param {'default'|'danger'|'success'} [opts.variant='default'] - Variante visuelle.
 * @param {string} [opts.icon] - Nom d'icône lucide (optionnel) à afficher dans le header.
 * @param {string} opts.title - Titre de la modale.
 * @param {string|HTMLElement} opts.body - Contenu HTML du body.
 * @param {string|HTMLElement|null} [opts.footer] - Contenu HTML du footer (boutons custom).
 *        Si null, génère un seul bouton "Fermer" qui résout la promise.
 * @param {boolean} [opts.closeOnBackdrop=true] - Si true, clic sur l'overlay ferme.
 * @param {boolean} [opts.closeOnEscape=true] - Si true, touche Escape ferme.
 * @returns {Promise<void>} - Résout à la fermeture.
 */
export function openHwModal(opts) {
    const {
        size = 'md',
        variant = 'default',
        icon = null,
        title = '',
        body = '',
        footer = null,
        closeOnBackdrop = true,
        closeOnEscape = true,
    } = opts || {};

    return new Promise((resolve) => {
        // Nettoie une éventuelle modale V2 ouverte (stacking interdit)
        if (activeHwOverlay) closeHwModal();

        activeHwResolve = resolve;

        const overlay = document.createElement('div');
        overlay.className = 'hw-modal-overlay';

        const sizeCls = `is-${size}`;
        const variantCls = variant === 'default' ? '' : ` is-${variant}`;
        const iconHtml = icon ? `<div class="hw-modal-icon"><i data-lucide="${icon}"></i></div>` : '';

        // Footer par défaut : 1 bouton "Fermer"
        let footerHtml;
        if (footer === null) {
            footerHtml = '<button class="hw-btn hw-btn-primary" data-hw-modal-action="close">Fermer</button>';
        } else if (typeof footer === 'string') {
            footerHtml = footer;
        } else {
            footerHtml = ''; // sera ajouté en HTMLElement après
        }

        overlay.innerHTML = `
            <div class="hw-modal ${sizeCls}${variantCls}">
                <header class="hw-modal-header">
                    ${iconHtml}
                    <h2 class="hw-modal-title">${escapeText(title)}</h2>
                    <button class="hw-modal-close" type="button" aria-label="Fermer" data-hw-modal-action="close">
                        <i data-lucide="x"></i>
                    </button>
                </header>
                <div class="hw-modal-body"></div>
                <footer class="hw-modal-footer">${footerHtml}</footer>
            </div>
        `;

        // Inject body
        const bodyEl = overlay.querySelector('.hw-modal-body');
        if (typeof body === 'string') {
            bodyEl.innerHTML = body;
        } else if (body instanceof HTMLElement) {
            bodyEl.appendChild(body);
        }

        // Inject footer si HTMLElement
        if (footer instanceof HTMLElement) {
            overlay.querySelector('.hw-modal-footer').appendChild(footer);
        }

        // Listeners de fermeture
        overlay.querySelectorAll('[data-hw-modal-action="close"]').forEach(el => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                closeHwModal();
            });
        });

        if (closeOnBackdrop) {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) closeHwModal();
            });
        }

        if (closeOnEscape) {
            activeHwEscapeHandler = (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    closeHwModal();
                }
            };
            document.addEventListener('keydown', activeHwEscapeHandler);
        }

        document.body.appendChild(overlay);
        activeHwOverlay = overlay;

        // Lucide icons + transition active
        createIcons({ icons: appIcons });
        // Force reflow puis active la classe pour la transition
        // eslint-disable-next-line no-unused-expressions
        overlay.offsetHeight;
        overlay.classList.add('is-active');
    });
}

/**
 * Ferme la modale HW active.
 */
export function closeHwModal() {
    if (!activeHwOverlay) return;
    if (activeHwEscapeHandler) {
        document.removeEventListener('keydown', activeHwEscapeHandler);
        activeHwEscapeHandler = null;
    }
    activeHwOverlay.classList.remove('is-active');
    const overlay = activeHwOverlay;
    activeHwOverlay = null;
    // Délai pour laisser la transition s'achever avant de retirer du DOM
    setTimeout(() => {
        overlay.remove();
    }, 300);
    if (activeHwResolve) {
        const resolve = activeHwResolve;
        activeHwResolve = null;
        resolve();
    }
}

function escapeText(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/* ============================================================
   LEGACY API — showAlert/showConfirm/showPrompt (sm)
   À conserver pour rétro-compatibilité avec le code existant.
   ============================================================ */


function getElements() {
    return {
        overlay: document.getElementById('custom-modal-overlay'),
        box: document.querySelector('#custom-modal-overlay .custom-modal-box'),
        title: document.getElementById('custom-modal-title'),
        message: document.getElementById('custom-modal-message'),
        actions: document.getElementById('custom-modal-actions')
    };
}

function resetModal() {
    const { box, title, actions } = getElements();
    if (box) {
        // Reset classes to base only to clean up any custom classes from previous calls
        box.className = 'custom-modal-box';
    }
    // Reset inline styles that might have been set by specific modals (like Admin CC)
    if (title) title.style.display = '';
    if (actions) actions.style.display = '';
}

export function closeModal() {
    const { overlay } = getElements();
    if (overlay) overlay.classList.remove('active');
    activeResolve = null;
}

/**
 * Affiche une modale générique avec contenu personnalisé.
 * @param {string} titleText - Le titre de la modale.
 * @param {string|HTMLElement} content - Contenu HTML ou élément DOM.
 * @param {string|HTMLElement|null} actionsContent - Contenu des actions (boutons) ou null.
 */
export function showCustomModal(titleText, content, actionsContent = null, customClass = null) {
    resetModal();
    const { overlay, box, title, message, actions } = getElements();

    if (!overlay) return;

    if (customClass && box) {
        box.classList.add(customClass);
    }

    // Titre
    title.textContent = titleText;

    // Contenu (Message)
    message.innerHTML = '';
    if (typeof content === 'string') {
        message.innerHTML = content;
    } else if (content instanceof HTMLElement) {
        message.appendChild(content);
    }

    // Actions (Footer)
    actions.innerHTML = '';
    if (actionsContent) {
        if (typeof actionsContent === 'string') {
            actions.innerHTML = actionsContent;
        } else if (actionsContent instanceof HTMLElement) {
            actions.appendChild(actionsContent);
        }
    }

    // Affichage
    overlay.classList.add('active');
}

/**
 * Affiche une modale de confirmation.
 * @param {string} titleText - Le titre de la modale.
 * @param {string} messageText - Le message du corps.
 * @param {string} confirmLabel - Texte du bouton d'action (ex: "Supprimer").
 * @param {string} cancelLabel - Texte du bouton d'annulation (ex: "Annuler").
 * @param {boolean} isDanger - Si true, le bouton d'action sera rouge.
 * @returns {Promise<boolean>} - Résout true si confirmé, false sinon.
 */
export function showConfirm(titleText, messageText, confirmLabel = "Oui", cancelLabel = "Annuler", isDanger = false) {
    return new Promise((resolve) => {
        resetModal();
        const { overlay, title, message, actions } = getElements();

        // Sécurité si le DOM n'est pas prêt (ne devrait pas arriver)
        if (!overlay) {
            console.error("Modal overlay not found in DOM");
            return resolve(window.confirm(messageText)); // Fallback natif
        }

        activeResolve = resolve;

        // Contenu
        title.textContent = titleText;
        message.innerHTML = messageText;

        // Nettoyage boutons
        actions.innerHTML = '';

        // 1. Bouton Action (Primaire/Danger) - Placé à GAUCHE selon la demande Architecte [SUPPRIMER] [Garder]
        const btnConfirm = document.createElement('button');
        btnConfirm.className = isDanger ? 'custom-modal-btn danger' : 'custom-modal-btn primary';
        btnConfirm.textContent = confirmLabel;
        btnConfirm.onclick = () => {
            closeModal();
            resolve(true);
        };

        // 2. Bouton Annuler (Secondaire) - Placé à DROITE
        const btnCancel = document.createElement('button');
        btnCancel.className = 'custom-modal-btn secondary';
        btnCancel.textContent = cancelLabel;
        btnCancel.onclick = () => {
            closeModal();
            resolve(false);
        };

        actions.appendChild(btnConfirm);
        actions.appendChild(btnCancel);

        // Affichage
        overlay.classList.add('active');
    });
}

/**
 * Affiche une modale de saisie de texte (Input).
 * @param {string} titleText
 * @param {string} messageText
 * @param {string} defaultValue
 * @returns {Promise<string|null>} - La valeur saisie ou null si annulé.
 */
export function showPrompt(titleText, messageText, defaultValue = "") {
    return new Promise((resolve) => {
        resetModal();
        const { overlay, title, message, actions } = getElements();

        if (!overlay) {
            return resolve(window.prompt(messageText, defaultValue));
        }

        activeResolve = resolve;

        title.textContent = titleText;
        // On construit le HTML : Message + Input
        message.innerHTML = `
            <div class="modal-prompt-body">
                <span>${messageText}</span>
                <input type="text" id="custom-modal-input" class="modal-prompt-input">
            </div>
        `;

        // Sécurité : Assignation via propriété (et non attribut HTML) pour éviter XSS et problèmes de quotes
        const inputField = document.getElementById('custom-modal-input');
        if (inputField) inputField.value = defaultValue;
        actions.innerHTML = '';

        const input = document.getElementById('custom-modal-input'); // Sera dispo après l'ajout au DOM via innerHTML ? Non, il faut append.
        // innerHTML est synchrone, donc le DOM est mis à jour immédiatement mais getElementById doit chercher dans le document.
        // Comme 'message' est dans le document, ça devrait marcher.

        const btnConfirm = document.createElement('button');
        btnConfirm.className = 'custom-modal-btn primary';
        btnConfirm.textContent = "Valider";
        btnConfirm.onclick = () => {
            const val = document.getElementById('custom-modal-input').value;
            closeModal();
            resolve(val);
        };

        const btnCancel = document.createElement('button');
        btnCancel.className = 'custom-modal-btn secondary';
        btnCancel.textContent = "Annuler";
        btnCancel.onclick = () => {
            closeModal();
            resolve(null);
        };

        actions.appendChild(btnConfirm);
        actions.appendChild(btnCancel);

        overlay.classList.add('active');

        // Focus l'input
        setTimeout(() => {
            const inp = document.getElementById('custom-modal-input');
            if(inp) {
                inp.focus();
                inp.select();
            }
        }, 50);
    });
}

/**
 * Affiche une modale d'alerte simple.
 * @param {string} titleText
 * @param {string} messageText
 * @param {string} okLabel
 * @param {string|null} customClass - Classe CSS optionnelle pour la boîte modale.
 * @param {Function|null} onReady - Fonction appelée lorsque la modale est prête (DOM affiché).
 * @returns {Promise<void>}
 */
export function showAlert(titleText, messageText, okLabel = "OK", customClass = null, onReady = null) {
    return new Promise((resolve) => {
        resetModal();
        const { overlay, box, title, message, actions } = getElements();

        if (!overlay) {
            window.alert(messageText);
            return resolve();
        }

        if (customClass && box) {
            box.classList.add(customClass);
        }

        activeResolve = resolve;

        title.textContent = titleText;
        message.innerHTML = messageText;
        actions.innerHTML = '';

        const btnOk = document.createElement('button');
        btnOk.className = 'custom-modal-btn primary';
        btnOk.textContent = okLabel;
        btnOk.onclick = () => {
            closeModal();
            resolve();
        };

        actions.appendChild(btnOk);
        overlay.classList.add('active');

        // Callback "onReady" pour attacher des listeners ou manipuler le DOM
        if (typeof onReady === 'function') {
            // Un petit délai pour s'assurer que le DOM est bien rendu si nécessaire,
            // mais comme on manipule le DOM synchrone juste au-dessus, appel direct OK.
            // On passe les éléments utiles au callback
            onReady({ messageContainer: message, overlay });
        }
    });
}
