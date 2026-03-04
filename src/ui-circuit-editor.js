import { state, updateMyCircuit } from './state.js';
import { DOM } from './ui.js';
import { updateSelectionModeButton } from './ui-selection.js';
import { switchSidebarTab } from './ui-sidebar.js';
import { applyFilters } from './data.js';
import { saveAndExportCircuit } from './circuit-actions.js';
import { saveCircuit } from './database.js';
import { isMobileView } from './mobile.js';
import { showToast } from './toast.js';
import { showConfirm, showAlert, showPrompt } from './modal.js';
import { performCircuitDeletion } from './circuit-actions.js';
import { eventBus } from './events.js';
import { escapeHtml } from './utils.js';
import QRCode from 'qrcode';

import {
    setSelectionMode,
    MAX_CIRCUIT_POINTS
} from './state.js';

import {
    saveCircuitDraft,
    addPoiToCircuit,
    clearCircuit,
    convertToDraft,
    generateCircuitName,
    updateCircuitMetadata,
    renderCircuitPanel
} from './circuit.js';

import { getPoiId } from './data.js';

// --- LE BOUTON QUI APPELLE LE MAJORDOME ET GÈRE L'AFFICHAGE ---
export function toggleSelectionMode(forceValue) {
    // 1. Le Majordome gère la donnée (L'État)
    if (typeof forceValue === 'boolean') {
        setSelectionMode(forceValue);
    } else {
        setSelectionMode(!state.isSelectionModeActive);
    }

    // 2. Mise à jour du bouton
    if (DOM.btnModeSelection) {
        DOM.btnModeSelection.classList.toggle('active', state.isSelectionModeActive);
        updateSelectionModeButton(state.isSelectionModeActive);
    }

    // 3. Gestion de l'Interface (Panneaux et Lignes)
    if (state.isSelectionModeActive) {
        if (DOM.rightSidebar) {
            DOM.rightSidebar.style.display = 'flex';
            document.body.classList.add('sidebar-open');
        }
        switchSidebarTab('circuit');
        renderCircuitPanel();
    } else {
        if (DOM.rightSidebar) {
            DOM.rightSidebar.style.display = 'none';
            document.body.classList.remove('sidebar-open');
        }
        if (state.orthodromicPolyline) state.orthodromicPolyline.remove();
        if (state.realTrackPolyline) state.realTrackPolyline.remove();
    }

    applyFilters();
}

// --- GÉNÉRATION QR CODE ET PARTAGE (UI) ---
export async function generateCircuitQR() {
    if (state.currentCircuit.length === 0) return;

    let activeCircuit = state.myCircuits.find(c => c.id === state.activeCircuitId);
    let isOfficial = false;
    let gpxFile = null;

    // Recherche Prioritaire dans les Officiels (Source de Vérité)
    const officialCandidate = state.officialCircuits ? state.officialCircuits.find(c => c.id === state.activeCircuitId) : null;

    if (officialCandidate) {
        // C'est un officiel certifié
        activeCircuit = officialCandidate;
        isOfficial = true;
        gpxFile = officialCandidate.file;
    } else if (!activeCircuit) {
        // Circuit introuvable (ni local ni officiel)
        return;
    } else {
        // C'est un circuit local : On vérifie s'il prétend être officiel
        if (activeCircuit.isOfficial) {
             isOfficial = true;
             gpxFile = activeCircuit.file;
        }
    }

    const circuitName = activeCircuit ? activeCircuit.name : generateCircuitName();
    const displayTitle = circuitName.split(' via ')[0]; // TRONCATURE

    // --- MODE PC: RATIONALISATION DU PARTAGE ---
    // Si c'est un officiel avec fichier GPX, on affiche le lien de téléchargement direct.
    // Sinon, on affiche un message d'information.

    if (isMobileView()) {
        // --- MOBILE: Affichage standard (QR App) ---
        // Génération du lien "Ouvrir dans l'App" (Commun)
        const ids = state.currentCircuit.map(getPoiId).filter(Boolean);
        const baseUrl = window.location.origin + window.location.pathname;
        const appDataString = `${baseUrl}?import=${ids.join(',')}&name=${encodeURIComponent(circuitName)}`;

        let qrApp;
        try {
            qrApp = await QRCode.toDataURL(appDataString, { width: 300, margin: 2 });
        } catch (e) {
            console.error("Erreur QR App", e);
            showToast("Erreur génération QR", "error");
            return;
        }

        const htmlContent = `
            <div style="display:flex; flex-direction:column; align-items:center; gap:8px; width:100%; text-align:center;">
                <img src="${qrApp}" style="width:200px; height:200px; border-radius:10px; border:1px solid var(--line);">
                <p style="text-align:center; color:var(--ink-soft); font-size:14px; margin:0; padding:0; width:100%;">
                    Partager ce circuit avec un autre appareil.
                </p>
                <div style="font-size:14px; font-weight:bold; color:var(--text-main); word-break:break-word; text-align:center; width:100%; margin:0; padding:0;">
                    ${escapeHtml(circuitName)}
                </div>
            </div>
        `;
        await showAlert("Partager le circuit", htmlContent, "Fermer");

    } else {
        // --- PC: Affichage Compact (GPX Uniquement) ---

        if (isOfficial && gpxFile) {
            // Construction de l'URL absolue vers le fichier public
            const baseUrl = window.location.origin + window.location.pathname;
            const cleanPath = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
            const gpxUrl = `${cleanPath}circuits/${gpxFile}`;

            let qrGpx;
            try {
                qrGpx = await QRCode.toDataURL(gpxUrl, { width: 250, margin: 1 });
            } catch (e) {
                console.error("Erreur QR GPX", e);
                return;
            }

            const htmlContent = `
                <div style="display:flex; flex-direction:column; align-items:center; gap:10px; font-family:sans-serif;">

                    <!-- QR Code GPX -->
                    <img src="${qrGpx}" style="width:200px; height:200px; border-radius:8px; border:1px solid var(--line, #eee);">

                    <!-- Bouton Téléchargement -->
                    <a href="${gpxUrl}" download class="action-button primary" style="
                        text-decoration:none; display:inline-flex; align-items:center; gap:8px; white-space:nowrap;
                        padding:10px 20px; border-radius:20px; font-weight:600; font-size:14px;">
                        <i data-lucide="download"></i> Télécharger le circuit
                    </a>

                </div>
            `;

            await showAlert(escapeHtml(displayTitle), htmlContent, "Fermer");

        } else {
            // Pas de GPX disponible
             await showAlert(
                 escapeHtml(displayTitle),
                 `<div style="text-align:center; padding:20px; color:var(--ink-soft);">
                    Ce circuit ne dispose pas de fichier GPX téléchargeable.
                 </div>`,
                 "Fermer"
             );
        }
    }
}

export function setupCircuitEventListeners() {
    console.log("⚡ Démarrage des écouteurs du Circuit (UI Éditeur)...");

    // 0. Bouton PARTAGER
    const btnShare = document.getElementById('btn-share-circuit');
    if (btnShare) {
        btnShare.addEventListener('click', generateCircuitQR);
    }

    // 1. Bouton EXPORTER GPX
    eventBus.on('request-export-gpx', () => {
        console.log("Reçu demande export GPX via EventBus");
        saveAndExportCircuit();
    });

    // 2. Bouton IMPORTER GPX
    if (DOM.btnImportGpx) {
        DOM.btnImportGpx.addEventListener('click', () => {
            console.log("Clic sur Import. ID Actif :", state.activeCircuitId);

            if (state.activeCircuitId) {
                // CAS 1 : On est en mode actif -> On veut importer une trace réelle pour CE circuit
                eventBus.emit('circuit:request-import', state.activeCircuitId);
            } else {
                // CAS 2 : On est en mode création -> On ouvre l'import GPX pour créer un nouveau circuit
                if (DOM.gpxImporter) {
                    DOM.gpxImporter.click();
                } else {
                    console.error("Élément DOM gpxImporter introuvable");
                }
            }
        });
    }

    // BOUTON VIDER / FERMER
    if (DOM.btnClearCircuit) {
        DOM.btnClearCircuit.addEventListener('click', () => {
            clearCircuit(true);
        });
    }
    // 3. Bouton BOUCLER
    if (DOM.btnLoopCircuit) {
        DOM.btnLoopCircuit.addEventListener('click', () => {
            console.log("Clic sur Boucler");
            if (state.currentCircuit.length > 0 && state.currentCircuit.length < MAX_CIRCUIT_POINTS) {
                // Ajoute le 1er point à la fin pour fermer la boucle
                addPoiToCircuit(state.currentCircuit[0]);
            } else {
                showToast("Impossible de boucler (Circuit vide ou plein)", "warning");
            }
        });
    }

    // 4. Description (Input texte)
    if (DOM.circuitDescription) {
        DOM.circuitDescription.addEventListener('input', saveCircuitDraft);
    }

    // 5. Bouton SUPPRIMER (Poubelle active)
    const btnDelete = document.getElementById('btn-delete-active-circuit');
    if (btnDelete) {
        btnDelete.addEventListener('click', async () => {
             if (await showConfirm("Suppression", "Voulez-vous vraiment supprimer ce circuit ?", "Supprimer", "Annuler", true)) {
                 if (state.activeCircuitId) {
                     const result = await performCircuitDeletion(state.activeCircuitId);
                     if (result.success) {
                         await clearCircuit(false);
                         eventBus.emit('circuit:list-updated');
                     } else {
                         showToast(result.message, 'error');
                     }
                 }
             }
        });
    }

    // 6. Édition du Titre
    const btnModify = document.getElementById('btn-modify-circuit');
    if (btnModify) {
        btnModify.addEventListener('click', () => {
            convertToDraft();
        });
    }

    const btnEditTitle = document.getElementById('edit-circuit-title-button');
    if (btnEditTitle) {
        btnEditTitle.addEventListener('click', async () => {
             const currentTitle = DOM.circuitTitleText ? DOM.circuitTitleText.textContent : "";
             const newTitle = await showPrompt("Renommer le circuit", "Nouveau titre :", currentTitle);

             if (newTitle !== null && newTitle.trim() !== "") {
                 const trimmed = newTitle.trim();

                 if (state.activeCircuitId) {
                     const idx = state.myCircuits.findIndex(c => c.id === state.activeCircuitId);
                     if (idx > -1) {
                         const updatedCircuit = { ...state.myCircuits[idx] };
                         updatedCircuit.name = trimmed;
                         updateMyCircuit(updatedCircuit);
                         // SAUVEGARDE PERMANENTE
                         await saveCircuit(updatedCircuit);
                         eventBus.emit('circuit:list-updated');
                     }
                 } else {
                     state.customDraftName = trimmed;
                 }

                 updateCircuitMetadata();
                 saveCircuitDraft();
             }
        });
    }
}
