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

// Modale temporairement mise en pause (cf. suspendHwModal/resumeHwModal).
// Permet de cacher une modale V2 le temps d'ouvrir une autre modale V2 (ex:
// showConfirm depuis un handler interne — sinon V2 ferme la 1ère via le
// "stacking interdit" de openHwModal).
let suspendedHwOverlay = null;
let suspendedHwResolve = null;
let suspendedHwEscapeHandler = null;

/**
 * Ouvre une modale du système V2 (hw-modal).
 * @param {Object} opts
 * @param {'sm'|'md'|'lg'|'xl'} [opts.size='md'] - Taille de la modale.
 * @param {'default'|'danger'|'success'} [opts.variant='default'] - Variante visuelle.
 * @param {string} [opts.icon] - Nom d'icône lucide (optionnel) à afficher dans le header.
 * @param {string} opts.title - Titre de la modale.
 * @param {string|HTMLElement|null} [opts.subheader] - Contenu HTML d'une zone
 *        fixe sous le header (typiquement des tabs). Reste visible quand
 *        le body scroll. Null = pas de subheader (défaut).
 * @param {string|HTMLElement} opts.body - Contenu HTML du body.
 * @param {string|HTMLElement|null|false} [opts.footer] - Contenu HTML du footer.
 *        - `null` (défaut) : footer avec un bouton "Fermer" générique.
 *        - `false` : aucun footer rendu (modale info-only, la croix du header
 *          est le seul moyen de fermer — évite la redondance croix + bouton).
 *        - `string` ou `HTMLElement` : footer custom.
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
        subheader = null,
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

        // Footer : null → bouton "Fermer" par défaut, false → pas de footer,
        // string/HTMLElement → custom.
        const noFooter = footer === false;
        let footerHtml = '';
        if (!noFooter) {
            if (footer === null) {
                footerHtml = '<button class="hw-btn hw-btn-primary" data-hw-modal-action="close">Fermer</button>';
            } else if (typeof footer === 'string') {
                footerHtml = footer;
            }
            // sinon HTMLElement → ajouté après
        }

        const subheaderHtml = (typeof subheader === 'string' && subheader)
            ? `<div class="hw-modal-subheader"></div>`
            : '';

        overlay.innerHTML = `
            <div class="hw-modal ${sizeCls}${variantCls}">
                <header class="hw-modal-header">
                    ${iconHtml}
                    <h2 class="hw-modal-title">${escapeText(title)}</h2>
                    <button class="hw-modal-close" type="button" aria-label="Fermer" data-hw-modal-action="close">
                        <i data-lucide="x"></i>
                    </button>
                </header>
                ${subheaderHtml}
                <div class="hw-modal-body"></div>
                ${noFooter ? '' : `<footer class="hw-modal-footer">${footerHtml}</footer>`}
            </div>
        `;

        // Inject subheader si présent
        const subheaderEl = overlay.querySelector('.hw-modal-subheader');
        if (subheaderEl) {
            if (typeof subheader === 'string') {
                subheaderEl.innerHTML = subheader;
            } else if (subheader instanceof HTMLElement) {
                subheaderEl.appendChild(subheader);
            }
        }

        // Inject body
        const bodyEl = overlay.querySelector('.hw-modal-body');
        if (typeof body === 'string') {
            bodyEl.innerHTML = body;
        } else if (body instanceof HTMLElement) {
            bodyEl.appendChild(body);
        }

        // Inject footer si HTMLElement (et seulement si on a un footer rendu)
        if (!noFooter && footer instanceof HTMLElement) {
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
 * Ferme la modale HW active et résout la promise avec une valeur optionnelle.
 * @param {*} [value] - Valeur passée au resolve de la promise (ex: true/false
 *   pour confirm, string pour prompt). Undefined pour les modales sans valeur.
 */
export function closeHwModal(value) {
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
        resolve(value);
    }
}

/**
 * Met la modale V2 active en pause (cachée mais préservée dans le DOM).
 * Permet d'ouvrir une autre modale V2 par-dessus (ex: showConfirm depuis un
 * handler) sans détruire la 1ère. À réactiver impérativement par
 * `resumeHwModal()` après usage. No-op si aucune modale active ou si une
 * autre est déjà suspendue.
 */
export function suspendHwModal() {
    if (!activeHwOverlay || suspendedHwOverlay) return;
    activeHwOverlay.style.display = 'none';
    if (activeHwEscapeHandler) {
        document.removeEventListener('keydown', activeHwEscapeHandler);
    }
    suspendedHwOverlay = activeHwOverlay;
    suspendedHwResolve = activeHwResolve;
    suspendedHwEscapeHandler = activeHwEscapeHandler;
    // Détache du système V2 → la prochaine openHwModal ne fermera pas la modale
    activeHwOverlay = null;
    activeHwResolve = null;
    activeHwEscapeHandler = null;
}

/**
 * Restaure la modale V2 mise en pause par `suspendHwModal()`. No-op si
 * aucune modale suspendue. Si une autre modale V2 est entretemps devenue
 * active, la suspendue est détruite proprement (évite le fantôme DOM).
 */
export function resumeHwModal() {
    if (!suspendedHwOverlay) return;
    // Si une autre modale V2 a été ouverte entretemps, on détruit la suspendue
    // (l'utilisateur a navigué ailleurs, on ne peut pas restaurer sans casser
    // le contexte courant).
    if (activeHwOverlay) {
        suspendedHwOverlay.remove();
        if (suspendedHwResolve) suspendedHwResolve();
        suspendedHwOverlay = null;
        suspendedHwResolve = null;
        suspendedHwEscapeHandler = null;
        return;
    }
    // Restauration : réinjecte dans le système V2
    activeHwOverlay = suspendedHwOverlay;
    activeHwResolve = suspendedHwResolve;
    activeHwEscapeHandler = suspendedHwEscapeHandler;
    suspendedHwOverlay = null;
    suspendedHwResolve = null;
    suspendedHwEscapeHandler = null;
    activeHwOverlay.style.display = '';
    if (activeHwEscapeHandler) {
        document.addEventListener('keydown', activeHwEscapeHandler);
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
   API préservée pour rétro-compatibilité du code appelant. Le backend
   utilise désormais openHwModal (système V2) au lieu du
   .custom-modal-box historique → tous les usages bénéficient du
   nouveau visuel sans changer le code.
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
    // Ferme à la fois les modales legacy (.custom-modal-box) ET V2 (.hw-modal).
    // Migration V2 : la plupart des modales sont désormais V2, mais quelques
    // fichiers (admin, fileManager, mobile-circuits) appellent encore closeModal()
    // explicitement pour fermer leur modale custom — on couvre les 2 cas.
    const { overlay } = getElements();
    if (overlay && overlay.classList.contains('active')) {
        overlay.classList.remove('active');
    }
    activeResolve = null;
    // Ferme aussi une éventuelle modale V2 ouverte
    if (activeHwOverlay) closeHwModal();
}

/**
 * Affiche une modale générique avec contenu personnalisé.
 * @param {string} titleText - Le titre de la modale.
 * @param {string|HTMLElement} content - Contenu HTML ou élément DOM.
 * @param {string|HTMLElement|null} actionsContent - Contenu des actions (boutons) ou null.
 */
export function showCustomModal(titleText, content, actionsContent = null, customClass = null) {
    // Migration V2 : utilise openHwModal en interne. Le paramètre customClass
    // est conservé pour rétro-compat mais ignoré (le styling se fait via
    // size/variant du nouveau système).
    let body = '';
    if (typeof content === 'string') body = content;
    else if (content instanceof HTMLElement) body = content.outerHTML;

    let footer = null;
    if (actionsContent) {
        if (typeof actionsContent === 'string') footer = actionsContent;
        else if (actionsContent instanceof HTMLElement) footer = actionsContent.outerHTML;
    }

    return openHwModal({
        size: 'md',
        title: titleText,
        body,
        footer,
    });
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
    // Migration V2 : openHwModal sm avec footer custom (Annuler à gauche,
    // Confirmer à droite). Variante 'danger' si isDanger.
    const confirmBtnCls = isDanger ? 'hw-btn-danger' : 'hw-btn-primary';
    const footer = `
        <button class="hw-btn hw-btn-ghost" data-confirm-action="cancel">${escapeText(cancelLabel)}</button>
        <button class="hw-btn ${confirmBtnCls}" data-confirm-action="confirm">${escapeText(confirmLabel)}</button>
    `;

    return openHwModal({
        size: 'sm',
        variant: isDanger ? 'danger' : 'default',
        icon: isDanger ? 'alert-triangle' : null,
        title: titleText,
        body: `<p>${messageText}</p>`,
        footer,
        // Backdrop fermeture = équivalent "annuler" → pas de fermeture spontanée
        // pour les confirms danger (force un choix explicite).
        closeOnBackdrop: !isDanger,
    }).then((result) => {
        // Si la modale est fermée via la croix/Escape/backdrop, result est undefined
        // → on traite comme "annuler" (false). Si l'utilisateur a cliqué un bouton
        // explicite, le handler ci-dessous a déjà résolu avec true/false.
        return result === true;
    }).finally(() => {
        // (no-op, juste pour la lisibilité)
    });
}

// Listener global pour les boutons des confirm (délégation depuis le body)
document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-confirm-action]');
    if (!btn) return;
    const action = btn.dataset.confirmAction;
    closeHwModal(action === 'confirm');
});

/**
 * Affiche une modale de saisie de texte (Input).
 * @param {string} titleText
 * @param {string} messageText
 * @param {string} defaultValue
 * @returns {Promise<string|null>} - La valeur saisie ou null si annulé.
 */
export function showPrompt(titleText, messageText, defaultValue = "") {
    // Migration V2 : openHwModal sm avec body texte + input + footer
    // (Annuler à gauche, Valider à droite). Resolve avec la valeur de
    // l'input ou null si annulé.
    const body = `
        <p>${messageText}</p>
        <input type="text" class="hw-input hw-mt-3" id="hw-prompt-input" value="${escapeText(defaultValue)}">
    `;
    const footer = `
        <button class="hw-btn hw-btn-ghost" data-prompt-action="cancel">Annuler</button>
        <button class="hw-btn hw-btn-primary" data-prompt-action="confirm">Valider</button>
    `;

    return openHwModal({
        size: 'sm',
        title: titleText,
        body,
        footer,
    }).then((result) => {
        // Si fermé par bouton confirm/cancel, result est string|null. Sinon undefined.
        return result === undefined ? null : result;
    });
}

// Listener global pour les boutons de prompt
document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-prompt-action]');
    if (!btn) return;
    const action = btn.dataset.promptAction;
    if (action === 'confirm') {
        const input = document.getElementById('hw-prompt-input');
        closeHwModal(input ? input.value : '');
    } else {
        closeHwModal(null);
    }
});

// Focus auto sur l'input prompt à l'ouverture
const promptObserver = new MutationObserver(() => {
    const input = document.getElementById('hw-prompt-input');
    if (input && document.activeElement !== input) {
        // Petit délai pour laisser la transition d'apparition
        setTimeout(() => {
            input.focus();
            input.select();
        }, 80);
    }
});
if (typeof document !== 'undefined' && document.body) {
    promptObserver.observe(document.body, { childList: true, subtree: true });
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
    // Migration V2 : openHwModal sm avec un seul bouton qui résout la promise.
    // Le paramètre customClass est conservé pour rétro-compat mais ignoré
    // (le styling se fait via size/variant). onReady est appelé après ouverture.
    const footer = `<button class="hw-btn hw-btn-primary" data-alert-action="ok">${escapeText(okLabel)}</button>`;

    const promise = openHwModal({
        size: 'sm',
        title: titleText,
        body: messageText,
        footer,
    });

    // Callback "onReady" pour les usages historiques qui attachent des listeners
    // au contenu après rendu (cf. ranking modal, explorer card iframe…)
    if (typeof onReady === 'function') {
        // Délai pour laisser le DOM se mettre en place (createElement + append).
        setTimeout(() => {
            const overlay = document.querySelector('.hw-modal-overlay.is-active');
            const messageContainer = overlay?.querySelector('.hw-modal-body');
            if (messageContainer) {
                onReady({ messageContainer, overlay });
            }
        }, 30);
    }

    return promise;
}

// Listener global pour le bouton OK des alerts
document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-alert-action="ok"]');
    if (btn) closeHwModal();
});

/* ============================================================
   HELPERS IDIOMATIQUES — hwConfirm / hwAlert / hwPrompt (PR 3e-1)
   Wrappers Promise-friendly autour d'openHwModal, conçus pour remplacer
   les `confirm()` / `alert()` / `prompt()` natifs du navigateur dans DM
   (PR 3e-2) et Scout (PR 3e-3). Importables depuis n'importe quel
   sous-projet du repo (DM, Scout) en relatif.

   Conventions :
   - hwConfirm({ title, body, danger? }) → Promise<boolean>
       Retourne `true` si l'utilisateur clique Confirmer, `false` sinon
       (bouton Annuler, Escape, croix, ou clic sur le backdrop).
   - hwAlert({ title, body }) → Promise<void>
       Une seule action (OK). Résout à la fermeture, valeur ignorée.
   - hwPrompt({ title, body, defaultValue?, placeholder?, inputType? }) → Promise<string|null>
       Retourne la valeur saisie si l'utilisateur clique Valider, `null`
       sinon (Annuler, Escape, croix, backdrop).
   ============================================================ */

function makeFooterButtons(buttons) {
    // Construit un wrapper transparent (display: contents) qui injecte
    // les boutons directement dans .hw-modal-footer sans niveau supplémentaire.
    const wrapper = document.createElement('span');
    wrapper.style.display = 'contents';
    for (const btnSpec of buttons) {
        const btn = document.createElement('button');
        btn.className = btnSpec.className;
        btn.type = 'button';
        btn.textContent = btnSpec.label;
        btn.addEventListener('click', btnSpec.onClick);
        wrapper.appendChild(btn);
    }
    return wrapper;
}

/**
 * Boîte de dialogue de confirmation (oui/non).
 * @param {Object} opts
 * @param {string} opts.title - Titre de la modale.
 * @param {string} [opts.body=''] - Message HTML (échappé par openHwModal côté title, body brut côté body).
 * @param {string} [opts.confirmLabel='Confirmer'] - Texte du bouton de confirmation.
 * @param {string} [opts.cancelLabel='Annuler'] - Texte du bouton d'annulation.
 * @param {boolean} [opts.danger=false] - Si true, le bouton de confirmation est rouge (action destructive).
 * @returns {Promise<boolean>}
 */
export function hwConfirm({
    title,
    body = '',
    confirmLabel = 'Confirmer',
    cancelLabel = 'Annuler',
    danger = false,
} = {}) {
    const footer = makeFooterButtons([
        {
            className: 'hw-btn hw-btn-ghost',
            label: cancelLabel,
            onClick: () => closeHwModal(false),
        },
        {
            className: danger ? 'hw-btn hw-btn-danger' : 'hw-btn hw-btn-primary',
            label: confirmLabel,
            onClick: () => closeHwModal(true),
        },
    ]);
    return openHwModal({
        size: 'sm',
        variant: danger ? 'danger' : 'default',
        title,
        body,
        footer,
    }).then((v) => v === true);
}

/**
 * Boîte de dialogue informative (un seul bouton OK).
 * @param {Object} opts
 * @param {string} opts.title
 * @param {string} [opts.body='']
 * @param {string} [opts.label='OK']
 * @returns {Promise<void>}
 */
export function hwAlert({ title, body = '', label = 'OK' } = {}) {
    const footer = makeFooterButtons([
        {
            className: 'hw-btn hw-btn-primary',
            label,
            onClick: () => closeHwModal(),
        },
    ]);
    return openHwModal({
        size: 'sm',
        title,
        body,
        footer,
    }).then(() => undefined);
}

/**
 * Boîte de dialogue de saisie texte.
 * @param {Object} opts
 * @param {string} opts.title
 * @param {string} [opts.body='']
 * @param {string} [opts.defaultValue='']
 * @param {string} [opts.placeholder='']
 * @param {string} [opts.inputType='text'] - Type HTML de l'input ('text', 'password', etc.).
 * @param {string} [opts.confirmLabel='Valider']
 * @param {string} [opts.cancelLabel='Annuler']
 * @returns {Promise<string|null>}
 */
export function hwPrompt({
    title,
    body = '',
    defaultValue = '',
    placeholder = '',
    inputType = 'text',
    confirmLabel = 'Valider',
    cancelLabel = 'Annuler',
} = {}) {
    // Body : message + input. Wrapper en HTMLElement pour conserver la
    // référence à l'input et lire sa valeur au submit.
    const bodyEl = document.createElement('div');
    if (body) {
        const msg = document.createElement('p');
        msg.style.marginTop = '0';
        msg.innerHTML = body;
        bodyEl.appendChild(msg);
    }
    const input = document.createElement('input');
    input.type = inputType;
    input.className = 'hw-modal-input';
    input.value = defaultValue;
    if (placeholder) input.placeholder = placeholder;
    input.style.cssText = 'width:100%; padding:9px 12px; border:1px solid var(--line); border-radius:8px; font:inherit; box-sizing:border-box;';
    bodyEl.appendChild(input);

    const submit = () => closeHwModal(input.value);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            submit();
        }
    });

    const footer = makeFooterButtons([
        {
            className: 'hw-btn hw-btn-ghost',
            label: cancelLabel,
            onClick: () => closeHwModal(null),
        },
        {
            className: 'hw-btn hw-btn-primary',
            label: confirmLabel,
            onClick: submit,
        },
    ]);

    const promise = openHwModal({
        size: 'sm',
        title,
        body: bodyEl,
        footer,
    }).then((v) => (typeof v === 'string' ? v : null));

    // Autofocus de l'input après ouverture (le DOM est en place après openHwModal).
    setTimeout(() => input.focus(), 50);

    return promise;
}
