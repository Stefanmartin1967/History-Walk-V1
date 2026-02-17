import { resizeImage } from './utils.js';

let activeResolve = null;

const PAGE_SIZE = 9; // 3x3 Grid

function getModalElements() {
    return {
        overlay: document.getElementById('custom-modal-overlay'),
        title: document.getElementById('custom-modal-title'),
        message: document.getElementById('custom-modal-message'),
        actions: document.getElementById('custom-modal-actions')
    };
}

function closeModal() {
    const { overlay } = getModalElements();
    if (overlay) overlay.classList.remove('active');
    activeResolve = null;
}

/**
 * Affiche une modale de sélection de photos avec Pagination.
 * @param {string} titleText - Titre.
 * @param {string} introText - Texte explicatif.
 * @param {Array} items - Liste d'objets { file, coords } à afficher.
 * @param {string} confirmLabel - Label du bouton de confirmation (défaut: "Importer").
 * @param {Object} extraAction - (Optionnel) { label: string, value: string } pour une action secondaire.
 * @returns {Promise<Array|null>} - Retourne un Array (augmenté d'une prop .action si secondaire) ou null.
 */
export function showPhotoSelectionModal(titleText, introText, items, confirmLabel = "Importer", extraAction = null) {
    return new Promise((resolve) => {
        const { overlay, title, message, actions } = getModalElements();

        if (!overlay) {
            console.error("Modal overlay not found!");
            return resolve(null);
        }

        activeResolve = resolve;

        // 1. Setup Title
        title.textContent = titleText;

        // 2. Setup Message Container
        message.innerHTML = '';

        const introP = document.createElement('div');
        introP.className = 'photo-selection-intro';
        introP.innerHTML = introText.replace(/\n/g, '<br>');
        message.appendChild(introP);

        // Container Grid
        const grid = document.createElement('div');
        grid.id = 'photo-selection-grid';
        message.appendChild(grid);

        // Pagination Controls Container
        const paginationContainer = document.createElement('div');
        paginationContainer.className = 'pagination-controls';
        // Insérer AVANT le grid ou APRÈS ? Après c'est mieux.
        // Mais dans le DOM actuel, le message contient le grid.
        message.appendChild(paginationContainer);

        // State tracking
        const selectionState = new Map(); // Global Index -> Boolean
        let currentPage = 0;
        const totalPages = Math.ceil(items.length / PAGE_SIZE);

        // Init Selection (Select All by default)
        items.forEach((_, i) => selectionState.set(i, true));

        // --- RENDER FUNCTION ---
        function renderPage(pageIndex) {
            grid.innerHTML = ''; // Clear current
            paginationContainer.innerHTML = ''; // Clear controls

            // Validation Page Index
            if (pageIndex < 0) pageIndex = 0;
            if (pageIndex >= totalPages) pageIndex = totalPages - 1;
            currentPage = pageIndex;

            const start = pageIndex * PAGE_SIZE;
            const end = Math.min(start + PAGE_SIZE, items.length);
            const pageItems = items.slice(start, end);

            // 1. Grid Items
            pageItems.forEach((item, i) => {
                const globalIndex = start + i;

                const card = document.createElement('div');
                card.className = 'photo-selection-item';
                if (selectionState.get(globalIndex)) card.classList.add('selected');
                card.dataset.index = globalIndex;

                const img = document.createElement('img');
                img.src = '';
                img.alt = `Photo ${globalIndex + 1}`;

                const check = document.createElement('div');
                check.className = 'photo-selection-check';
                check.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

                card.appendChild(img);
                card.appendChild(check);
                grid.appendChild(card);

                // Interaction
                card.addEventListener('click', () => {
                    const isSelected = !selectionState.get(globalIndex);
                    selectionState.set(globalIndex, isSelected);
                    card.classList.toggle('selected', isSelected);
                    updateButtonState();
                });

                // Thumbnail
                resizeImage(item.file, 200).then(base64 => {
                    img.src = base64;
                }).catch(err => {
                    console.error("Thumbnail error:", err);
                    img.alt = "Erreur";
                });
            });

            // 2. Pagination Controls (Only if needed)
            if (totalPages > 1) {
                const prevBtn = document.createElement('button');
                prevBtn.className = 'pagination-btn';
                prevBtn.textContent = '◀ Précédent';
                prevBtn.disabled = currentPage === 0;
                prevBtn.onclick = () => renderPage(currentPage - 1);

                const pageInfo = document.createElement('span');
                pageInfo.textContent = `Page ${currentPage + 1} / ${totalPages}`;

                const nextBtn = document.createElement('button');
                nextBtn.className = 'pagination-btn';
                nextBtn.textContent = 'Suivant ▶';
                nextBtn.disabled = currentPage === totalPages - 1;
                nextBtn.onclick = () => renderPage(currentPage + 1);

                paginationContainer.appendChild(prevBtn);
                paginationContainer.appendChild(pageInfo);
                paginationContainer.appendChild(nextBtn);
            }
        }

        // --- ACTIONS SETUP ---
        actions.innerHTML = '';

        // Bouton Principal (Import / Créer)
        const btnImport = document.createElement('button');
        btnImport.className = 'custom-modal-btn primary';
        // Le texte sera mis à jour par updateButtonState
        btnImport.onclick = () => {
            const selectedItems = items.filter((_, i) => selectionState.get(i));
            closeModal();
            resolve(selectedItems);
        };
        actions.appendChild(btnImport);

        // Bouton Extra (Force Add) - Optionnel
        let btnExtra = null;
        if (extraAction) {
            btnExtra = document.createElement('button');
            btnExtra.className = 'custom-modal-btn success'; // Use a distinct style if possible, or secondary
            btnExtra.style.backgroundColor = '#10B981'; // Force green/success color
            btnExtra.style.color = 'white';
            btnExtra.textContent = extraAction.label;
            btnExtra.onclick = () => {
                const selectedItems = items.filter((_, i) => selectionState.get(i));
                // Return array with special property
                selectedItems.action = extraAction.value;
                closeModal();
                resolve(selectedItems);
            };
            actions.appendChild(btnExtra);
        }

        // Bouton Ignorer
        const btnSkip = document.createElement('button');
        btnSkip.className = 'custom-modal-btn secondary';
        btnSkip.textContent = "Ignorer";
        btnSkip.onclick = () => {
            closeModal();
            resolve(null);
        };
        actions.appendChild(btnSkip);

        // Helper update UI
        function updateButtonState() {
            const count = Array.from(selectionState.values()).filter(v => v).length;
            const label = confirmLabel;

            btnImport.textContent = count > 0 ? `${label} (${count})` : `${label}`;
            btnImport.disabled = count === 0;
            btnImport.style.opacity = count === 0 ? '0.5' : '1';
            btnImport.style.cursor = count === 0 ? 'not-allowed' : 'pointer';

            if (btnExtra) {
                btnExtra.disabled = count === 0;
                btnExtra.style.opacity = count === 0 ? '0.5' : '1';
                btnExtra.style.cursor = count === 0 ? 'not-allowed' : 'pointer';
                btnExtra.textContent = count > 0 ? `${extraAction.label} (${count})` : extraAction.label;
            }
        }

        // Initial Render
        renderPage(0);
        updateButtonState();

        overlay.classList.add('active');
    });
}
