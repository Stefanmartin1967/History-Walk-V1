
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
            <div style="display:flex; flex-direction:column; align-items:center; gap:15px;">
                <img src="${url}" style="width:250px; height:250px; border-radius:10px; border:1px solid var(--line);">
                <div style="text-align:center;">
                    <p style="font-weight:bold; color:var(--ink); margin-bottom:5px;">${visitedIndices.length} lieux visités</p>
                    <p style="color:var(--ink-soft); font-size:14px;">
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
    // Style inline de secours au cas où le CSS n'est pas chargé
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: #000; z-index: 99999; display: flex; flex-direction: column;
    `;

    overlay.innerHTML = `
        <div id="qr-reader" style="width:100%; flex-grow:1;"></div>
        <button id="close-scanner-btn" style="
            position: absolute; top: 20px; right: 20px;
            background: rgba(0,0,0,0.5); color: white; border: none;
            width: 40px; height: 40px; border-radius: 50%;
            font-size: 24px; cursor: pointer; z-index: 100000;
            display: flex; align-items: center; justify-content: center;
        ">×</button>
        <div style="position:absolute; bottom:50px; left:0; width:100%; text-align:center; color:white; pointer-events:none; text-shadow:0 2px 4px rgba(0,0,0,0.8);">
            Pointez la caméra vers un QR Code
        </div>
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
                console.log("QR Scan Result:", decodedText);

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
