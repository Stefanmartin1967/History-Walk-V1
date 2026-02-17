// modal.js
let activeResolve = null;

function getElements() {
    return {
        overlay: document.getElementById('custom-modal-overlay'),
        title: document.getElementById('custom-modal-title'),
        message: document.getElementById('custom-modal-message'),
        actions: document.getElementById('custom-modal-actions')
    };
}

function closeModal() {
    const { overlay } = getElements();
    if (overlay) overlay.classList.remove('active');
    activeResolve = null;
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
        const { overlay, title, message, actions } = getElements();

        if (!overlay) {
            return resolve(window.prompt(messageText, defaultValue));
        }

        activeResolve = resolve;

        title.textContent = titleText;
        // On construit le HTML : Message + Input
        message.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:10px;">
                <span>${messageText}</span>
                <input type="text" id="custom-modal-input" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px; font-size:16px;">
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
 * @returns {Promise<void>}
 */
export function showAlert(titleText, messageText, okLabel = "OK") {
    return new Promise((resolve) => {
        const { overlay, title, message, actions } = getElements();

        if (!overlay) {
            window.alert(messageText);
            return resolve();
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
    });
}
