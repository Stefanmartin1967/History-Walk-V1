// circuit-reference-layer.js — Calques de référence (routing in-app PR3).
//
// Importe des traces GPX (Wikiloc, Garmin…) et les affiche en FOND comme guides
// visuels pour comparer / affiner le tracé du circuit. Un calque N'ENTRE PAS
// dans le tracé (purement décoratif, en session) : seul `circuit.realTrack` est
// le vrai tracé. Tireté coloré, non interactif, sous les marqueurs. Le dessin
// Leaflet est délégué à map.js (qui possède le renderer SVG).
//
// PLUSIEURS calques depuis le 17/11/2026 (demande de Stefan, après Saint-Benoît :
// comparer sa marche, deux traces Wikiloc et le tracé précédent). Jusque-là il
// n'y en avait qu'un : le « Tracé précédent » posé tout seul après un re-tracé
// occupait la place, et « Calque » ne faisait plus que l'afficher ou le masquer
// — pour charger un GPX, il fallait d'abord le retirer.
//
// Chaque calque : { id, name, latlngs, visible, color (1..MAX), autoPrevious? }.
// « Calque » en ajoute toujours un ; la puce de chacun l'affiche / le masque
// (œil) ou le retire (×).
import { state } from './state.js';
import { drawReferenceLayers, fitReferenceLayer } from './map.js';
import { showToast } from './toast.js';

/** Nombre de calques à la fois (une couleur chacun, cf. --ref-layer-N). */
export const MAX_REFERENCE_LAYERS = 4;

let _nextId = 1;

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

/** Les calques chargés, dans l'ordre d'ajout. */
export function referenceLayers() {
    return Array.isArray(state.referenceLayers) ? state.referenceLayers : [];
}
export function hasReferenceLayer() { return referenceLayers().length > 0; }
export function isReferenceVisible() { return referenceLayers().some(l => l.visible); }

// Première couleur libre (1..MAX).
function freeColor(layers) {
    for (let c = 1; c <= MAX_REFERENCE_LAYERS; c++) if (!layers.some(l => l.color === c)) return c;
    return null;
}

function setLayers(layers) {
    state.referenceLayers = layers;
    drawReferenceLayers(layers.filter(l => l.visible));
}

// Ajoute un calque ; null s'il n'y a plus de place.
function addLayer(layer) {
    const layers = referenceLayers();
    const color = freeColor(layers);
    if (!color) return null;
    const entry = { id: `ref_${_nextId++}`, visible: true, ...layer, color };
    setLayers([...layers, entry]);
    return entry;
}

// Ouvre un sélecteur de fichier GPX, parse, ajoute le calque et cadre dessus.
// `onDone` rafraîchit l'UI appelante (puces, panneau Itinéraire) en cas de succès.
export function importReferenceGpx(onDone) {
    if (referenceLayers().length >= MAX_REFERENCE_LAYERS) {
        showToast(`${MAX_REFERENCE_LAYERS} calques au plus : retirez-en un pour en charger un autre.`, 'warning');
        return;
    }
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
                const entry = addLayer({ name: file.name.replace(/\.(gpx|xml)$/i, ''), latlngs });
                if (!entry) {
                    showToast(`${MAX_REFERENCE_LAYERS} calques au plus : retirez-en un pour en charger un autre.`, 'warning');
                    return;
                }
                fitReferenceLayer(entry.id);
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

// Affiche un tracé [[lat,lon],…] comme calque de référence — ex. l'ANCIEN tracé
// d'un circuit juste avant un re-tracé, pour comparer « avant → après » sans le
// geste manuel export GPX → import (point 5). Un seul « Tracé précédent » à la
// fois : il remplace le précédent (re-tracés successifs → toujours l'avant-
// dernier) et ne touche jamais aux calques importés. Renvoie true si posé.
export function showTraceAsReference(latlngs, name) {
    if (!Array.isArray(latlngs) || latlngs.length < 2) return false;
    const others = referenceLayers().filter(l => !l.autoPrevious);
    state.referenceLayers = others;
    if (others.length >= MAX_REFERENCE_LAYERS) { setLayers(others); return false; }
    return !!addLayer({ name: name || 'Tracé précédent', latlngs: latlngs.slice(), autoPrevious: true });
}

/** Retire le « Tracé précédent » posé automatiquement, s'il y en a un. */
export function removePreviousTraceLayer() {
    const layers = referenceLayers();
    if (layers.some(l => l.autoPrevious)) setLayers(layers.filter(l => !l.autoPrevious));
}

/** Retire un calque. */
export function removeReferenceLayer(id, onDone) {
    setLayers(referenceLayers().filter(l => l.id !== id));
    if (onDone) onDone();
}

/** Affiche / masque un calque sans le décharger. */
export function toggleReferenceLayerVisible(id, onDone) {
    setLayers(referenceLayers().map(l => (l.id === id ? { ...l, visible: !l.visible } : l)));
    if (onDone) onDone();
}
