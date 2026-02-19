// searchManager.js
import L from 'leaflet';
import { DOM, openDetailsPanel } from './ui.js';
import { state } from './state.js';
import { getPoiName, getPoiId } from './data.js'; // On réutilise les outils robustes de data.js
import { map, clearMarkerHighlights } from './map.js';
import { getSearchResults } from './search.js';

export function setupSearch() {
    const query = DOM.searchInput.value;
    
    // Nettoyage de l'interface si vide
    DOM.searchResults.innerHTML = '';
    DOM.searchResults.style.display = 'none';
    
    if (!query || query.trim().length === 0) return;
    
    // 1. Filtrage des résultats (Logique centralisée)
    const results = getSearchResults(query);
    
    // 2. Affichage des résultats
    if (results.length > 0) {
        // On limite à 50 résultats pour ne pas surcharger
        results.slice(0, 50).forEach(feature => {
            const resultBtn = document.createElement('button');
            resultBtn.textContent = getPoiName(feature); // Utilise le nom intelligent (custom > officiel)
            
            resultBtn.addEventListener('click', () => {
                // Reset de la barre de recherche
                DOM.searchInput.value = '';
                DOM.searchResults.style.display = 'none';

                const targetId = getPoiId(feature);

                // A. Zoom sur la carte (CORRECTIF ROBUSTE)
                // On cherche le layer par son ID et non par référence d'objet
                clearMarkerHighlights();
                state.geojsonLayer.eachLayer(layer => {
                    if (layer.feature && getPoiId(layer.feature) === targetId) {
                        map.flyTo(layer.getLatLng(), 16);
                        
                        // Ajout de la mise en valeur visuelle
                        if (layer.getElement()) {
                            layer.getElement().classList.add('marker-highlight');
                        }
                    }
                });

                // B. Ouverture du panneau latéral
                // On retrouve l'index global de manière sûre
                const globalIndex = state.loadedFeatures.findIndex(f => getPoiId(f) === targetId);
                
                if (globalIndex > -1) {
                    // Vérifie si le lieu est dans le circuit actuel
                    let circuitIndex = -1;
                    if (state.currentCircuit) {
                        circuitIndex = state.currentCircuit.findIndex(f => getPoiId(f) === targetId);
                    }
                    
                    openDetailsPanel(globalIndex, circuitIndex !== -1 ? circuitIndex : null);
                }
            });
            DOM.searchResults.appendChild(resultBtn);
        });
        DOM.searchResults.style.display = 'block';
    }
}

export function setupSmartSearch() {
    // Écouteur pour la recherche GPS intelligente (Touche Entrée)
    // Permet de coller des coordonnées comme "33.8787, 10.8413"
    DOM.searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const query = DOM.searchInput.value.trim();
            
            // Regex pour détecter les formats GPS courants
            const coordsRegex = /^(-?\d+(\.\d+)?)[,\s]+(-?\d+(\.\d+)?)$/;
            const match = query.match(coordsRegex);

            if (match) {
                const lat = parseFloat(match[1]);
                const lng = parseFloat(match[3]);

                if (map) {
                    map.flyTo([lat, lng], 18, { duration: 1.5 });
                    DOM.searchResults.style.display = 'none';
                    DOM.searchInput.value = ''; 
                    DOM.searchInput.blur(); // Masque le clavier sur mobile

                    // --- GESTION MARQUEUR FANTÔME ---
                    // 1. Suppression de l'ancien marqueur s'il existe
                    if (state.ghostMarker) {
                        state.ghostMarker.remove();
                        state.ghostMarker = null;
                    }

                    // 2. Création du nouveau marqueur
                    const ghostIcon = L.divIcon({
                        html: `<div style="background-color:var(--brand); width:20px; height:20px; border-radius:50%; border:2px solid white; box-shadow:0 0 4px rgba(0,0,0,0.5); margin:10px;"></div>`,
                        className: 'ghost-marker-icon',
                        iconSize: [40, 40],
                        iconAnchor: [20, 20]
                    });

                    const marker = L.marker([lat, lng], {
                        icon: ghostIcon,
                        draggable: true, // RENDU DÉPLAÇABLE
                        title: "Déplacez-moi pour ajuster"
                    }).addTo(map);
                    state.ghostMarker = marker;

                    // 3. Contenu de la popup (Style harmonisé avec le clic droit)
                    const popupContent = document.createElement('div');
                    popupContent.style.textAlign = 'center';
                    popupContent.style.display = 'flex';
                    popupContent.style.flexDirection = 'column';
                    popupContent.style.alignItems = 'center';
                    popupContent.style.justifyContent = 'center';

                    popupContent.innerHTML = `
                        <div style="font-weight:bold; margin-bottom:5px;">Nouveau Lieu ?</div>
                        <div id="ghost-marker-coords" style="font-size:11px; color:#888; margin-bottom:5px;">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
                        <div style="font-size:12px; color:var(--ink-soft); margin-bottom:8px;">Glissez pour ajuster</div>
                        <button id="btn-create-poi-ghost" class="action-btn" style="background:var(--brand); color:white; padding:4px 8px; font-size:12px; cursor:pointer; margin: 0 auto;">
                            Valider cette position
                        </button>
                    `;

                    // 4. Binding Popup
                    marker.bindPopup(popupContent, { minWidth: 200, closeOnClick: false }).openPopup();

                    let isDragging = false;

                    // Gestion du Drag
                    marker.on('dragstart', () => {
                        isDragging = true;
                        marker.closePopup();
                    });

                    marker.on('dragend', () => {
                        isDragging = false;

                        // Update coords display
                        const { lat, lng } = marker.getLatLng();
                        const coordsEl = popupContent.querySelector('#ghost-marker-coords');
                        if (coordsEl) coordsEl.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

                        setTimeout(() => {
                            if (state.ghostMarker) state.ghostMarker.openPopup();
                        }, 100);
                    });

                    // 5. Listener sur le bouton (via l'événement popupopen)
                    marker.on('popupopen', () => {
                        const btn = document.getElementById('btn-create-poi-ghost');
                        if (btn) {
                            btn.addEventListener('click', async () => {
                                // Import dynamique de RichEditor
                                const { RichEditor } = await import('./richEditor.js');
                                // Récupération dynamique de la position (post-drag)
                                const currentPos = marker.getLatLng();
                                RichEditor.openForCreate(currentPos.lat, currentPos.lng);

                                // On supprime le marqueur fantôme une fois l'éditeur ouvert
                                if (state.ghostMarker) {
                                    state.ghostMarker.remove();
                                    state.ghostMarker = null;
                                }
                            });
                        }
                    });

                    // 6. Suppression à la fermeture
                    marker.on('popupclose', () => {
                        if (!isDragging && state.ghostMarker) {
                            state.ghostMarker.remove();
                            state.ghostMarker = null;
                        }
                    });
                }
            }
        }
    });
}
