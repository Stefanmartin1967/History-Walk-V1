// circuit-flags.js — Multi-drapeaux pendant la création/édition de circuit.
// PR 4/5 chantier drapeaux d'accès v2.
//
// Affiche en permanence sur la carte tous les drapeaux d'accès des POI du
// circuit en cours (state.currentCircuit), pendant que l'admin (ou l'user)
// est en mode création ou édition (state.isCircuitCreationMode = true).
//
// Comportement
//  - Le drapeau apparaît si le POI a un `accessPoint` connu (status osm/moved).
//    Sinon (status undefined / on-track / failed sans suggestion), pas de
//    drapeau : pour poser un drapeau initial, passer par la passe globale OSM
//    (PR3) ou la fiche POI unitaire (PR1).
//  - Couleur : --osm (orange) pour status='osm', --moved (vert) pour 'moved'.
//  - DRAG : bascule visuelle en vert (--moved) + marque le drapeau « dirty ».
//    L'écriture data ne se fait qu'au save circuit (commitDirtyFlags()).
//  - ÉDITION d'un circuit existant (state.editingMode === true) : règle CADENAS.
//    Les drapeaux des POI DÉJÀ présents au début de l'édition sont rouges,
//    non-draggables, avec tooltip « modifie depuis la fiche POI ». Les
//    drapeaux des POI nouvellement ajoutés dans cette session sont libres.
//  - CANCEL / sortie de mode création : teardown visuel, pas d'écriture data
//    (les dirty n'ont jamais été persistés).
//
// Hooks externes
//  - Le rendu s'auto-déclenche sur l'event 'circuit:updated' (window) que
//    notifyCircuitChanged() émet à chaque modif de state.currentCircuit.
//  - commitDirtyFlags() doit être appelée par saveAndExportCircuit() avant
//    le notifyCircuitChanged final, pour persister les déplacements manuels.
//  - markEditingStart(circuit) doit être appelée à l'entrée du mode édition
//    pour figer le snapshot des POI préexistants (règle cadenas).
import L from 'leaflet';
import { map } from './map.js';
import { state } from './state.js';
import { getPoiId, getPoiName, updatePoiData } from './data.js';
import { getAccessPoint } from './utils.js';
import { getAccessPointStatus } from './access-point.js';
import { showToast } from './toast.js';

// === État du module ============================================================
// _flags : Map<poiId, { marker, line, status, isLocked, isDirty, newCoords }>
//   marker     : L.Marker (drapeau draggable)
//   line       : L.Polyline (pointillée POI → drapeau)
//   status     : 'osm' | 'moved' (couleur initiale + base pour décision save)
//   isLocked   : true si POI préexistant en édition (rouge non-draggable)
//   isDirty    : true si l'admin a glissé le drapeau (à commit au save)
//   newCoords  : [lon, lat] de la position courante (si isDirty, écrasera l'accessPoint au save)
const _flags = new Map();
// Snapshot des POI IDs au moment où on entre en édition d'un circuit existant.
// Utilisé pour distinguer préexistant (cadenas) vs nouvellement ajouté.
let _initialPoiIds = new Set();

// === API publique ==============================================================

/**
 * Doit être appelée AVANT que l'admin commence à modifier un circuit existant.
 * Fige la liste des POI présents à ce moment-là — règle cadenas s'applique
 * sur ces IDs uniquement. Les POI ajoutés/retirés ensuite sont « libres ».
 *
 * @param {Array<object>} initialFeatures - features POI au début de l'édition
 */
export function markEditingStart(initialFeatures) {
    _initialPoiIds = new Set(
        (initialFeatures || []).map(f => getPoiId(f)).filter(Boolean)
    );
}

/**
 * Appelée par saveAndExportCircuit() AVANT le notify final. Persiste tous les
 * drapeaux dirty (déplacés par l'admin) via updatePoiData : accessPoint =
 * nouvelles coords + accessPointStatus = 'moved'. Async, await recommandé.
 */
export async function commitDirtyFlags() {
    const dirty = Array.from(_flags.entries()).filter(([, f]) => f.isDirty && !f.isLocked);
    if (dirty.length === 0) return 0;
    for (const [poiId, f] of dirty) {
        try {
            await updatePoiData(poiId, 'accessPoint', f.newCoords);
            await updatePoiData(poiId, 'accessPointStatus', 'moved');
            f.isDirty = false;
            f.status = 'moved';
            // Update visuel : passe en vert si pas déjà
            updateFlagVisual(poiId);
        } catch (e) {
            console.error('[circuit-flags] commitDirtyFlags failed for', poiId, e);
        }
    }
    showToast(`${dirty.length} drapeau${dirty.length > 1 ? 'x' : ''} d'accès enregistré${dirty.length > 1 ? 's' : ''}.`, 'success', 2500);
    return dirty.length;
}

/**
 * Retire tous les markers du module. Appelée automatiquement quand le mode
 * création se désactive (state.currentCircuit vide ou isCircuitCreationMode=false).
 */
export function teardownAllFlags() {
    for (const [, f] of _flags) {
        if (f.marker) f.marker.remove();
        if (f.line) f.line.remove();
    }
    _flags.clear();
    _initialPoiIds = new Set();
}

/**
 * Retourne le nombre de drapeaux dirty (non encore persistés). Utilisable par
 * le caller pour décider d'une modale de confirmation à l'annulation.
 */
export function getDirtyCount() {
    let n = 0;
    for (const [, f] of _flags) if (f.isDirty && !f.isLocked) n++;
    return n;
}

// === Logique de rendu ==========================================================

/**
 * Synchronise les drapeaux affichés avec state.currentCircuit. Crée les
 * nouveaux drapeaux (POI ajoutés), retire ceux qui ne sont plus pertinents
 * (POI retirés du circuit), conserve les autres tels quels (préserve dirty).
 */
function syncFlags() {
    // Le module s'active SOIT en création vierge (isCircuitCreationMode), SOIT
    // en édition d'un circuit existant (editingMode). convertToDraft met
    // editingMode=true mais NE met PAS isCircuitCreationMode=true (cf. note
    // historique map.js:294), donc tester les deux est nécessaire — sinon les
    // drapeaux restent invisibles en édition (bug attrapé par Stefan post #714).
    const active = state.isCircuitCreationMode || state.editingMode;
    if (!active || !state.currentCircuit || state.currentCircuit.length === 0) {
        teardownAllFlags();
        return;
    }

    // POI IDs encore présents dans le circuit courant.
    const currentIds = new Set();
    for (const feature of state.currentCircuit) {
        const poiId = getPoiId(feature);
        if (!poiId) continue;
        currentIds.add(poiId);
        ensureFlag(feature);
    }

    // Retire les drapeaux dont le POI n'est plus dans le circuit.
    for (const [poiId, f] of _flags) {
        if (!currentIds.has(poiId)) {
            if (f.marker) f.marker.remove();
            if (f.line) f.line.remove();
            _flags.delete(poiId);
        }
    }
}

/**
 * Crée ou met à jour le drapeau pour un POI donné. Si déjà existant : ne
 * touche pas à dirty/newCoords (préserve les modifs en cours).
 */
function ensureFlag(feature) {
    const poiId = getPoiId(feature);
    if (!poiId) return;
    if (_flags.has(poiId)) return; // déjà rendu, on ne touche pas

    // Pas de drapeau si pas d'accessPoint connu (POI on-track ou jamais évalué).
    const ap = getAccessPoint(feature);
    if (!ap) return;

    const status = getAccessPointStatus(feature) || 'moved';
    // Règle cadenas : préexistant en édition → rouge non-draggable.
    const isLocked = state.editingMode === true && _initialPoiIds.has(poiId);
    const effectiveStatus = isLocked ? 'locked' : status;

    const [apLon, apLat] = ap;
    const [poiLon, poiLat] = feature.geometry.coordinates;

    const marker = L.marker([apLat, apLon], {
        draggable: !isLocked,
        icon: flagIcon(effectiveStatus, isLocked),
        zIndexOffset: 1100, // au-dessus des POI mais sous les modales
    }).addTo(map);

    if (isLocked) {
        // Tooltip explicatif au hover. Réutilise le mécanisme natif title=""
        // via setAttribute sur l'élément DOM du marker (Leaflet ne propose
        // pas d'API directe). Lazy-poké après le prochain tick.
        setTimeout(() => {
            const el = marker.getElement();
            if (el) el.setAttribute('title', 'Verrouillé — modifie depuis la fiche POI');
        }, 0);
    }

    const line = L.polyline([[poiLat, poiLon], [apLat, apLon]], {
        color: '#c0392b',
        weight: 2,
        dashArray: '5,8',
        opacity: 0.85,
        interactive: false,
    }).addTo(map);

    const entry = {
        marker,
        line,
        status, // état initial (osm/moved) — base pour décider couleur si pas locked
        isLocked,
        isDirty: false,
        newCoords: [apLon, apLat],
        poiAnchor: [poiLat, poiLon], // pour redessiner la ligne au drag
    };
    _flags.set(poiId, entry);

    if (!isLocked) {
        // Pendant le drag : on update SEULEMENT la ligne et les coords.
        // Surtout PAS setIcon() ici : changer le divIcon recrée l'élément DOM
        // sous-jacent → Leaflet perd la référence draggable → le drag s'arrête
        // au premier pixel (bug attrapé par Stefan post #715 : « il devient vert
        // dès que je clique dessus, impossible de le déplacer »). La bascule
        // visuelle vers --moved se fait au dragend, une fois.
        marker.on('drag', () => {
            const ll = marker.getLatLng();
            entry.newCoords = [ll.lng, ll.lat];
            line.setLatLngs([entry.poiAnchor, [ll.lat, ll.lng]]);
        });
        marker.on('dragend', () => {
            entry.isDirty = true;
            entry.status = 'moved';
            marker.setIcon(flagIcon('moved', false));
        });
    }
}

/**
 * Met à jour le rendu visuel (icône) d'un drapeau existant après changement
 * d'état (ex : après commit, on bascule en --moved définitif).
 */
function updateFlagVisual(poiId) {
    const entry = _flags.get(poiId);
    if (!entry || !entry.marker) return;
    entry.marker.setIcon(flagIcon(entry.status, entry.isLocked));
}

function flagIcon(status, isLocked) {
    // Réutilise les classes CSS de PR1 (.hw-flag--osm/-moved/-locked).
    const modifier = isLocked ? 'hw-flag--locked is-badge'
                   : status === 'osm' ? 'hw-flag--osm'
                   : 'hw-flag--moved';
    const lockOverlay = isLocked
        ? '<span class="hw-flag-lock"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>'
        : '';
    return L.divIcon({
        className: 'hw-flag ' + modifier,
        html: '<span class="hw-flag-mast"></span><span class="hw-flag-banner"></span>' + lockOverlay,
        iconSize: [22, 30],
        iconAnchor: [3, 30],
    });
}

// === Hook au boot : écoute circuit:updated =====================================
// Module importé statiquement par circuit-actions ou map ; le listener se pose
// dès le boot. syncFlags() vérifie state.isCircuitCreationMode → no-op sinon.

if (typeof window !== 'undefined') {
    window.addEventListener('circuit:updated', () => {
        try {
            syncFlags();
        } catch (e) {
            console.error('[circuit-flags] sync failed:', e);
        }
    });
}

// Exports tests-friendly
export const _internals = { _flags, syncFlags, ensureFlag, flagIcon };
