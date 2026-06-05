// circuit-reference-layer.js — Calque de référence (routing in-app PR3).
//
// Importe une trace GPX (Wikiloc, Garmin…) et l'affiche en FOND comme guide
// visuel pour comparer / affiner le tracé du circuit. Le calque N'ENTRE PAS dans
// le tracé (purement décoratif, en session) : seul `circuit.realTrack` est le
// vrai tracé. Pointillé gris (.route-reference-layer), non interactif, sous les
// marqueurs. Le dessin Leaflet est délégué à map.js (qui possède le renderer SVG).
import { state } from './state.js';
import { drawReferenceLayer, clearReferenceLayer, fitReferenceLayer } from './map.js';
import { showToast } from './toast.js';

// Parse une trace GPX (texte) → [[lat, lon], …]. Gère <trkpt> (traces) et, à
// défaut, <rtept> (routes). Tolérant : ignore les points sans coordonnées.
function parseGpxTrack(text) {
    const xml = new DOMParser().parseFromString(text, 'text/xml');
    let pts = Array.from(xml.getElementsByTagName('trkpt'));
    if (pts.length === 0) pts = Array.from(xml.getElementsByTagName('rtept'));
    return pts
        .map(p => [parseFloat(p.getAttribute('lat')), parseFloat(p.getAttribute('lon'))])
        .filter(([la, lo]) => Number.isFinite(la) && Number.isFinite(lo));
}

export function hasReferenceLayer() { return !!state.referenceLayer; }
export function isReferenceVisible() { return !!(state.referenceLayer && state.referenceLayer.visible); }
export function referenceLayerName() { return state.referenceLayer ? state.referenceLayer.name : ''; }

// (Re)dessine ou retire le calque selon l'état + sa visibilité.
function refreshMap() {
    if (state.referenceLayer && state.referenceLayer.visible) drawReferenceLayer(state.referenceLayer.latlngs);
    else clearReferenceLayer();
}

// Ouvre un sélecteur de fichier GPX, parse, affiche le calque et cadre dessus.
// `onDone` rafraîchit l'UI appelante (chip / barre focus) en cas de succès.
export function importReferenceGpx(onDone) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.gpx,.xml,application/gpx+xml';

    input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const latlngs = parseGpxTrack(String(e.target.result || ''));
                if (latlngs.length < 2) {
                    showToast('Aucune trace trouvée dans ce fichier GPX.', 'warning');
                    return;
                }
                state.referenceLayer = { name: file.name, latlngs, visible: true };
                refreshMap();
                fitReferenceLayer();
                showToast('Calque de référence chargé', 'success');
                if (onDone) onDone();
            } catch (err) {
                console.error('[reference-layer] parse GPX échoué:', err);
                showToast('Fichier GPX illisible.', 'error');
            }
        };
        reader.onerror = () => showToast('Lecture du fichier impossible.', 'error');
        reader.readAsText(file);
    });

    input.click();
}

export function removeReferenceLayer(onDone) {
    state.referenceLayer = null;
    clearReferenceLayer();
    if (onDone) onDone();
}

// Affiche / masque le calque sans le décharger (toggle « Calque » du focus).
// Si aucun calque n'est chargé, déclenche l'import.
export function toggleReferenceLayer(onDone) {
    if (!state.referenceLayer) { importReferenceGpx(onDone); return; }
    state.referenceLayer.visible = !state.referenceLayer.visible;
    refreshMap();
    if (onDone) onDone();
}
