// searchManager.js
import L from 'leaflet';
import { DOM } from './ui-dom.js';
import { openDetailsPanel } from './ui-details.js';
import { state, setGhostMarker, setCurrentFeatureId } from './state.js';
import { eventBus } from './events.js';
import { getPoiName, getPoiId } from './data.js'; // On réutilise les outils robustes de data.js
import { map, clearMarkerHighlights } from './map.js';
import { getSearchResults } from './search.js';

export function setupSearch() {
    const query = DOM.searchInput.value;

    // Note : le filtrage de Mes Circuits par POI est déjà géré nativement —
    // sélectionner un POI (depuis les résultats topbar OU clic carte) met à
    // jour state.currentFeatureId, et ui-circuit-list:renderExplorerList
    // active automatiquement le chip "Filtré par : [POI]" sur la liste.
    // Pas besoin de synchroniser le texte tapé entre les 2 barres.

    // Nettoyage de l'interface si vide
    DOM.searchResults.innerHTML = '';
    DOM.searchResults.classList.add('is-hidden');

    if (!query || query.trim().length === 0) return;
    
    // 1. Filtrage des résultats (Logique centralisée)
    const results = getSearchResults(query);
    
    // 2. Affichage des résultats
    if (results.length > 0) {
        // On utilise un DocumentFragment pour limiter les reflows (Optimisation Performance)
        const fragment = document.createDocumentFragment();

        // On limite à 50 résultats pour ne pas surcharger
        results.slice(0, 50).forEach(feature => {
            const resultBtn = document.createElement('button');
            resultBtn.textContent = getPoiName(feature); // Utilise le nom intelligent (custom > officiel)

            resultBtn.addEventListener('click', () => {
                // Reset de la barre de recherche
                DOM.searchInput.value = '';
                DOM.searchResults.classList.add('is-hidden');

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

                    // UX : si on est sur l'onglet Mes Circuits, on RESTE dessus
                    // et on filtre la liste par ce POI (chip "Filtré par : [POI]"
                    // déjà géré par renderExplorerList via state.currentFeatureId).
                    // Sur les autres onglets (ou onglet inconnu), on ouvre la fiche Lieu.
                    const activeTab = document.querySelector('.sidebar-panel.active')?.dataset.panel;
                    if (activeTab === 'explorer') {
                        setCurrentFeatureId(globalIndex);
                        eventBus.emit('circuit:list-updated');
                    } else {
                        openDetailsPanel(globalIndex, circuitIndex !== -1 ? circuitIndex : null);
                    }
                }
            });
            fragment.appendChild(resultBtn);
        });

        DOM.searchResults.appendChild(fragment);
        DOM.searchResults.classList.remove('is-hidden');
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
                    DOM.searchResults.classList.add('is-hidden');
                    DOM.searchInput.value = '';
                    DOM.searchInput.blur(); // Masque le clavier sur mobile

                    // --- GESTION MARQUEUR FANTÔME ---
                    // 1. Suppression de l'ancien marqueur s'il existe
                    if (state.ghostMarker) {
                        state.ghostMarker.remove();
                        setGhostMarker(null);
                    }

                    // 2. Création du nouveau marqueur
                    const marker = L.marker([lat, lng], {
                        draggable: true, // RENDU DÉPLAÇABLE
                        title: "Déplacez-moi pour ajuster"
                    }).addTo(map);
                    setGhostMarker(marker);

                    // 3. Contenu de la popup (Style harmonisé avec le clic droit)
                    const popupContent = document.createElement('div');
                    popupContent.className = 'ghost-popup';

                    popupContent.innerHTML = `
                        <div class="ghost-popup-title">Nouveau Lieu ?</div>
                        <div id="ghost-marker-coords" class="ghost-popup-coords">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
                        <div class="ghost-popup-hint">Glissez pour ajuster</div>
                        <button id="btn-create-poi-ghost" class="action-btn ghost-popup-btn">
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
                                    setGhostMarker(null);
                                }
                            });
                        }
                    });

                    // 6. Suppression uniquement si la popup est fermée explicitement (pas par un drag)
                    // On ne supprime plus automatiquement sur popupclose pour éviter les conflits avec le drag
                    // La suppression se fera :
                    // - Au clic sur "Valider" (géré plus haut)
                    // - Au lancement d'une nouvelle recherche (géré au début de setupSmartSearch)
                    // - On ajoute un listener global au clic map pour nettoyer si besoin, ou on laisse l'utilisateur gérer via la croix

                    // Pour garder le comportement "propre", on supprime si on ferme la popup SANS drag
                    // Mais on utilise une approche plus robuste : on détecte le click sur le bouton fermer
                    marker.getPopup().on('remove', () => {
                        if (!isDragging && state.ghostMarker) {
                            // Petite sécurité : on vérifie si le marqueur est encore sur la carte
                            // S'il est en cours de drag, il ne doit pas être supprimé
                            // Mais 'remove' de la popup est appelé par closePopup() qui est appelé par dragstart...
                            // Donc on est revenu au point de départ si on utilise l'event de la popup.

                            // SOLUTION : On ne supprime PAS le marqueur automatiquement à la fermeture de la popup.
                            // On laisse le marqueur sur la carte. L'utilisateur peut le fermer via la croix (ferme popup, garde marqueur)
                            // Pour le supprimer vraiment, il faudra cliquer ailleurs ou refaire une recherche.
                        }
                    });

                    // Ajout d'un événement unique pour nettoyer le marqueur au clic ailleurs sur la carte
                    const cleanUp = (e) => {
                        if (state.ghostMarker && isDragging) return;

                        // Vérifie si le clic a eu lieu sur le marker ou la popup
                        // Leaflet 'click' sur la map ne se déclenche PAS si on clique sur un marker/popup (sauf propagation)
                        // Donc un clic reçu ici est forcément sur la carte "vide".

                        if (state.ghostMarker) {
                            state.ghostMarker.remove();
                            setGhostMarker(null);
                            map.off('click', cleanUp);
                        }
                    };

                    // On utilise un petit délai pour ne pas capter le clic initial qui pourrait (théoriquement) propager
                    setTimeout(() => {
                        map.on('click', cleanUp);
                    }, 100);

                    // Nettoyage de l'écouteur si le marqueur est supprimé autrement
                    marker.on('remove', () => {
                        map.off('click', cleanUp);
                    });
                }
            }
        }
    });
}
