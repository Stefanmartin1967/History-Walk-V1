
import { state } from './state.js';
import { getPoiId, applyFilters } from './data.js';
import { batchSavePoiData } from './database.js';
import { showToast } from './toast.js';
import { showConfirm, showAlert } from './modal.js';
import { Html5Qrcode } from 'html5-qrcode';
import QRCode from 'qrcode';
import { loadCircuitFromIds } from './circuit.js';

// --- GENERATION (PARTAGER) ---

export async function generateSyncQR() {
    if (!state.currentMapId) {
        showToast("Aucune carte chargée.", "error");
        return;
    }

    // 1. Récupération des indices des POIs visités
    const visitedIndices = [];
    state.loadedFeatures.forEach((feature, index) => {
        if (feature.properties.userData && feature.properties.userData.vu) {
            visitedIndices.push(index);
        }
    });

    if (visitedIndices.length === 0) {
        showToast("Aucun lieu visité à partager.", "warning");
        return;
    }

    // 2. Construction du Payload Compact
    const payload = {
        t: 's', // Type: Sync
        m: state.currentMapId,
        v: visitedIndices
    };

    const jsonString = JSON.stringify(payload);

    // 3. Génération du QR Code
    try {
        const url = await QRCode.toDataURL(jsonString, { width: 300, margin: 2, errorCorrectionLevel: 'L' });

        // 4. Affichage Modale
        const html = `
            <div class="sync-qr-container">
                <img src="${url}" class="sync-qr-img">
                <div class="sync-qr-info">
                    <p class="sync-visited-count">${visitedIndices.length} lieux visités</p>
                    <p class="sync-instructions">
                        Sur l'autre appareil, allez dans <b>Menu > Outils > Scanner</b><br>
                        pour récupérer cette progression.
                    </p>
                </div>
            </div>
        `;

        await showAlert("Synchroniser la progression", html, "Fermer");

    } catch (err) {
        console.error("Erreur QR:", err);
        showToast("Erreur lors de la génération du QR Code", "error");
    }
}

// --- SCANNER GENÉRIQUE ---

export async function startGenericScanner(onSuccessCallback) {
    // 1. Création de l'interface (Overlay)
    // On vérifie si l'overlay existe déjà pour éviter les doublons
    if (document.getElementById('qr-scanner-overlay')) {
        return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'qr-scanner-overlay';

    overlay.innerHTML = `
        <div id="qr-reader"></div>
        <button id="close-scanner-btn" class="qr-scanner-close-btn">×</button>
        <div class="qr-scanner-hint">Pointez la caméra vers un QR Code</div>
    `;
    document.body.appendChild(overlay);

    const html5QrCode = new Html5Qrcode("qr-reader");

    // Fonction de nettoyage
    const closeScanner = async () => {
        try {
            if(html5QrCode.isScanning) {
                await html5QrCode.stop();
            }
        } catch (e) { console.warn("Erreur stop scanner:", e); }

        if(document.body.contains(overlay)) {
            document.body.removeChild(overlay);
        }
    };

    document.getElementById('close-scanner-btn').addEventListener('click', closeScanner);

    // Démarrage
    try {
        await html5QrCode.start(
            { facingMode: "environment" }, // Caméra arrière de préférence
            { fps: 10, qrbox: { width: 250, height: 250 } },
            async (decodedText, decodedResult) => {
                // Succès !

                // On arrête le scanneur
                await closeScanner();

                // On passe la main au callback
                if (onSuccessCallback) {
                    onSuccessCallback(decodedText);
                } else {
                    // Par défaut, on tente de gérer intelligemment
                    handleScanResultDefault(decodedText);
                }
            },
            (errorMessage) => {
                // Erreur de parsing frame (très fréquent, on ignore)
            }
        );
    } catch (err) {
        console.error("Erreur start scanner:", err);
        showToast("Impossible d'accéder à la caméra.", "error");
        closeScanner();
    }
}

// --- LOGIQUE DE ROUTAGE (Le Cerveau du Scanner) ---

export async function handleScanResultDefault(decodedText) {
    try {
        // Cas 1 : JSON (Sync Payload)
        if (decodedText.trim().startsWith('{')) {
            const payload = JSON.parse(decodedText);
            if (payload.t === 's') {
                await handleSyncPayload(payload);
                return;
            }
        }

        // Cas 2 : Circuit (Legacy 'hw:' ou URL 'import=')
        if (decodedText.startsWith('hw:') || decodedText.includes('import=')) {
            await loadCircuitFromIds(decodedText);
            return;
        }

        showToast("Format QR Code non reconnu.", "warning");

    } catch (e) {
        console.error("Erreur traitement scan:", e);
        showToast("Données QR invalides.", "error");
    }
}

// --- TRAITEMENT DU SYNC ---

async function handleSyncPayload(payload) {
    // 1. Vérification Carte
    if (payload.m !== state.currentMapId) {
        showToast(`Ce code est pour la carte "${payload.m}", mais vous êtes sur "${state.currentMapId}".`, "error");
        return;
    }

    if (!Array.isArray(payload.v)) {
        showToast("Format de données corrompu.", "error");
        return;
    }

    // 2. Application des changements
    const updates = [];
    let appliedCount = 0;

    payload.v.forEach(index => {
        if (index >= 0 && index < state.loadedFeatures.length) {
            const feature = state.loadedFeatures[index];
            const poiId = getPoiId(feature);

            // On ne met à jour que si ce n'est pas déjà fait (Optimisation)
            if (!feature.properties.userData || !feature.properties.userData.vu) {
                if (!feature.properties.userData) feature.properties.userData = {};

                feature.properties.userData.vu = true; // Mise à jour Mémoire

                updates.push({
                    poiId: poiId,
                    data: feature.properties.userData
                });
                appliedCount++;
            }
        }
    });

    // 3. Sauvegarde DB
    if (updates.length > 0) {
        try {
            await batchSavePoiData(state.currentMapId, updates);
            showToast(`${appliedCount} lieux marqués comme "Visité" !`, "success");

            // 4. Rafraîchissement UI
            applyFilters();
            // Si on est sur mobile, on refresh la liste (via event ou reload simple)
             import('./events.js').then(({ eventBus }) => {
                 eventBus.emit('data:filtered', state.loadedFeatures); // Force refresh
                 eventBus.emit('circuit:list-updated');
             });

        } catch (e) {
            console.error("Erreur sauvegarde sync:", e);
            showToast("Erreur lors de la sauvegarde.", "error");
        }
    } else {
        showToast("Tout est déjà synchronisé !", "info");
    }
}
