// mobile-new-place.js
// Création d'un lieu sur mobile à partir de la position GPS : fenêtre
// « Nouveau lieu » + création du POI en attente. Partagé par le (+) du dock
// (mobile-nav.js) et le bouton « Nouveau lieu » de la carte du suivi
// (mobile-follow.js, 06/11/2026) — module à part pour éviter un import
// circulaire entre ces deux-là.

import { state } from './state.js';
import { addPendingPoiFeature } from './data.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { getZoneFromCoords } from './utils.js';
import { showToast } from './toast.js';
import { openHwModal, closeModal } from './modal.js';

// ─── Ajout d'un POI par GPS (refonte PR 6 chantier design) ──────────────────
// Modale « Nouveau lieu » avec preview GPS visible (pulse animé + coords en
// temps réel) avant de confirmer. L'acquisition GPS démarre dès l'ouverture
// de la modale, l'utilisateur voit où il est avant de cliquer « Capturer ».
//
// Workflow :
//   1. Tap « + » (dock ou suivi) → showNewPlaceModal() ouvre la modale
//   2. Géoloc lancée en parallèle, coords apparaissent dans la card pulse
//   3. Utilisateur tap « Capturer » → POI créé avec coords pré-acquises
//      OU tap « Annuler » / Esc / clic backdrop / X → resolve(null)

export function showNewPlaceModal() {
    return new Promise((resolve) => {
        let resolved = false;
        let currentPosition = null;
        const finish = (value) => {
            if (resolved) return;
            resolved = true;
            closeModal();
            resolve(value);
        };

        // Build content : description + preview GPS card (label + coords)
        const content = document.createElement('div');
        content.innerHTML = `
            <p style="margin: 0 0 14px; font-size: 14px; line-height: 1.5; color: var(--ink-soft);">
                Capturer votre <b style="color: var(--ink);">position GPS actuelle</b> pour créer un nouveau lieu sur la carte ?
            </p>
            <div class="modal-gps">
                <div class="modal-gps-pulse"><i data-lucide="map-pin"></i></div>
                <div class="modal-gps-body">
                    <div class="modal-gps-label" id="modal-gps-label">Localisation en cours…</div>
                    <div class="modal-gps-coords" id="modal-gps-coords">— · —</div>
                </div>
            </div>
        `;

        // Build footer : Annuler + Capturer (Capturer disabled tant que GPS pas prêt)
        const footer = document.createElement('div');
        footer.style.display = 'flex';
        footer.style.gap = '8px';
        footer.style.width = '100%';
        const btnCancel = document.createElement('button');
        btnCancel.type = 'button';
        btnCancel.className = 'hw-btn';
        btnCancel.textContent = 'Annuler';
        btnCancel.addEventListener('click', () => finish(null));
        const btnCapture = document.createElement('button');
        btnCapture.type = 'button';
        btnCapture.className = 'hw-btn primary';
        btnCapture.id = 'btn-capture-position';
        btnCapture.innerHTML = '<i data-lucide="map-pin"></i>Capturer';
        btnCapture.disabled = true;
        btnCapture.addEventListener('click', () => {
            if (currentPosition) finish(currentPosition);
        });
        footer.appendChild(btnCancel);
        footer.appendChild(btnCapture);

        // Ouverture : icône map-pin à gauche du titre via hw-modal-icon.
        // La Promise renvoyée par openHwModal résout sur close (X / Esc /
        // backdrop). On capture ce cas pour resolve(null) si l'user ferme
        // sans utiliser les boutons custom.
        openHwModal({
            icon: 'map-pin',
            size: 'sm',
            title: 'Nouveau lieu',
            body: content,
            footer: footer,
        }).then(() => finish(null));

        // Hydrate les icônes Lucide après que le DOM est en place.
        requestAnimationFrame(() => {
            createIcons({ icons: appIcons, root: content });
            createIcons({ icons: appIcons, root: footer });
        });

        // Acquisition GPS en parallèle de l'affichage.
        if (!navigator.geolocation) {
            const label = document.getElementById('modal-gps-label');
            const coords = document.getElementById('modal-gps-coords');
            if (label) label.textContent = 'GPS non supporté';
            if (coords) coords.textContent = 'Annulez et réessayez sur un autre appareil';
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                if (resolved) return;
                currentPosition = pos.coords;
                const { latitude, longitude } = pos.coords;
                const label = document.getElementById('modal-gps-label');
                const coords = document.getElementById('modal-gps-coords');
                if (label) label.textContent = 'Position détectée';
                if (coords) {
                    const ns = latitude >= 0 ? 'N' : 'S';
                    const ew = longitude >= 0 ? 'E' : 'O';
                    coords.textContent = `${Math.abs(latitude).toFixed(4)}° ${ns} · ${Math.abs(longitude).toFixed(4)}° ${ew}`;
                }
                const btn = document.getElementById('btn-capture-position');
                if (btn) btn.disabled = false;
            },
            (err) => {
                if (resolved) return;
                const label = document.getElementById('modal-gps-label');
                const coords = document.getElementById('modal-gps-coords');
                if (label) label.textContent = 'Erreur GPS';
                if (coords) coords.textContent = err.message || 'Position non disponible';
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    });
}

// Crée le lieu (en attente : il n'est enregistré qu'à la 1re modification de
// sa fiche, sinon closeDetailsPanel le jette) et renvoie son index dans
// state.loadedFeatures, à passer à openDetailsPanel.
export function createPlaceAt(position) {
    const { latitude, longitude } = position;
    const newPoiId = `HW-MOB-${Date.now()}`;

    // Dégel de Zone : on ne FIGE plus le quartier dans le POI — il se dérive de la
    // position partout (getDerivedZone). On le calcule juste pour le toast informatif,
    // via getZoneFromCoords (qui gère Polygon ET MultiPolygon, contrairement à l'ancien
    // point-dans-polygone inline qui ne voyait que les Polygon → faux « Hors Zone »).
    const detectedZone = getZoneFromCoords(latitude, longitude);

    const newFeature = {
        type: "Feature",
        geometry: { type: "Point", coordinates: [longitude, latitude] },
        properties: {
            "Nom du site FR": "Nouveau Lieu",
            "Catégorie": "A définir",
            "HW_ID": newPoiId,
            "created_at": new Date().toISOString()
        }
    };

    // Persistance différée : on ajoute le POI en mémoire seulement.
    // La sauvegarde disque (customPois + lastGeoJSON) aura lieu uniquement
    // lorsque l'utilisateur aura édité au moins un champ. Si la fiche est
    // fermée sans modification, `closeDetailsPanel` jette le POI fantôme.
    addPendingPoiFeature(newFeature);

    showToast(`Lieu créé (Zone : ${detectedZone})`, "success");

    return state.loadedFeatures.length - 1;
}
