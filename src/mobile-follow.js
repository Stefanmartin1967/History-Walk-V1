// mobile-follow.js
// Chantier « Suivi de circuit sur mobile » — PR1 (mode immersif plein écran).
//
// Sur mobile, #map est masqué par CSS (base.css : display:none) au profit des
// vues-listes (#mobile-container), ET la carte Leaflet n'est même PAS
// initialisée au boot (app-startup saute initMap dans la branche mobile, par
// économie : le mobile vivait jusqu'ici en listes pures). Ce module RÉVÈLE donc
// #map en plein écran, initialise Leaflet À LA DEMANDE (1re fois seulement),
// pose un header overlay minimal (titre + croix) + des contrôles de zoom, et
// cadre la vue sur le tracé réel du circuit actif.
//
// Périmètre PR1 volontairement réduit : « voir le tracé en plein écran ».
//   - PR2 ajoutera le point bleu GPS (watchPosition) + recentrer + Wake Lock.
//   - PR3 ajoutera le bottom sheet d'aperçu POI + les marqueurs cliquables.
// Le tracé est dessiné par le listener `circuit:updated` de map.js (enregistré
// par initMap) : après init, on (ré)émet notifyCircuitChanged pour le tracer.

import { map, initMap } from './map.js';
import { state } from './state.js';
import { eventBus } from './events.js';
import { notifyCircuitChanged } from './circuit.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { escapeHtml, getZoneFromCoords } from './utils.js';
import { pushMobileLevel } from './mobile-state.js';
import { showToast } from './toast.js';

let _overlay = null; // header + contrôles, montés dans le conteneur Leaflet
let _active = false;

export function isFollowActive() {
    return _active;
}

// Un circuit est « suivable » s'il a une VRAIE trace : soit un fichier GPX
// (officiels — chargé à la volée par loadCircuitById), soit un realTrack déjà
// peuplé (perso ayant importé un GPX). Le « vol d'oiseau » (lignes droites
// POI→POI, échafaudage temporaire avant routage) n'est jamais suivi.
export function circuitHasTrace(circuit) {
    return !!(circuit && (circuit.file ||
        (Array.isArray(circuit.realTrack) && circuit.realTrack.length > 0)));
}

function getActiveCircuit() {
    const id = state.activeCircuitId;
    if (!id) return null;
    return state.myCircuits.find(c => c.id === id)
        || state.officialCircuits?.find(c => c.id === id)
        || null;
}

// Points de cadrage : le tracé réel s'il existe, sinon les POIs du circuit
// (fallback défensif — en pratique « Suivre » exige une trace).
function getFitPoints(circuit) {
    const track = circuit.realTrack;
    if (Array.isArray(track) && track.length > 0) return track;
    return (state.currentCircuit || [])
        .filter(f => f?.geometry?.coordinates)
        .map(f => [f.geometry.coordinates[1], f.geometry.coordinates[0]]);
}

function buildOverlay(circuit) {
    const container = map.getContainer();

    const title = (circuit.name || 'Circuit').split(' via ')[0]
        .replace(/^(Circuit de |Boucle de |Boucle autour du )/i, '');

    // Zone du point de départ du tracé (eyebrow « SUIVI · HOUMT SOUK »).
    let zoneName = '';
    const pts = getFitPoints(circuit);
    if (pts.length > 0) zoneName = getZoneFromCoords(pts[0][0], pts[0][1]) || '';

    const overlay = document.createElement('div');
    overlay.className = 'follow-ui';
    overlay.innerHTML = `
        <div class="follow-top">
            <div class="follow-title-card">
                <div class="follow-eyebrow">
                    <i data-lucide="route"></i>${zoneName ? `SUIVI · ${escapeHtml(zoneName.toUpperCase())}` : 'SUIVI'}
                </div>
                <div class="follow-title">${escapeHtml(title)}</div>
            </div>
            <button type="button" class="follow-close" id="follow-close" aria-label="Quitter le suivi">
                <i data-lucide="x"></i>
            </button>
        </div>
        <div class="follow-ctl follow-ctl-zoom">
            <button type="button" id="follow-zoom-in" aria-label="Zoomer"><i data-lucide="plus"></i></button>
            <button type="button" id="follow-zoom-out" aria-label="Dézoomer"><i data-lucide="minus"></i></button>
        </div>
    `;
    container.appendChild(overlay);
    createIcons({ icons: appIcons, root: overlay });

    // La croix pop l'entrée d'historique #follow → popstate → onHwBack →
    // stopFollow. Même chemin que le Back Android (sortie unique, pas de
    // double teardown).
    overlay.querySelector('#follow-close').addEventListener('click', () => history.back());
    overlay.querySelector('#follow-zoom-in').addEventListener('click', () => map.zoomIn());
    overlay.querySelector('#follow-zoom-out').addEventListener('click', () => map.zoomOut());

    return overlay;
}

export function startFollow() {
    if (_active) return;
    const circuit = getActiveCircuit();
    if (!circuitHasTrace(circuit)) return; // garde-fou : pas de plein écran vide

    _active = true;
    // On révèle #map AVANT d'initialiser Leaflet : le conteneur a ainsi ses
    // vraies dimensions au moment du L.map() (sinon init à taille 0).
    document.body.classList.add('follow-active');

    // Init paresseuse : sur mobile la carte n'existe pas encore au 1er suivi.
    // `map` est un live binding ESM → il reflète la réassignation d'initMap.
    if (!map) {
        initMap();
        // Le listener `circuit:updated` (→ drawLineOnMap) vient d'être
        // enregistré par initMap : on (re)dessine le tracé du circuit actif.
        notifyCircuitChanged();
    }
    if (!map) { // init impossible (cas extrême) → on annule proprement
        _active = false;
        document.body.classList.remove('follow-active');
        showToast('Carte indisponible.', 'error');
        return;
    }

    _overlay = buildOverlay(circuit);

    // Entrée d'historique : le Back Android (et la croix) quittent le suivi
    // au lieu de revenir à la liste des circuits.
    pushMobileLevel('follow');

    // Resync de la taille interne Leaflet (le conteneur vient de passer de
    // display:none à plein écran) puis cadrage sur le tracé, au frame suivant
    // (DOM stabilisé).
    requestAnimationFrame(() => {
        if (!_active || !map) return;
        map.invalidateSize();
        const points = getFitPoints(circuit);
        if (points.length > 0) {
            eventBus.emit('map:fit-bounds-to-points', {
                points,
                options: { padding: [40, 40], maxZoom: 17 }
            });
        }
    });
}

export function stopFollow() {
    if (!_active) return;
    _active = false;
    document.body.classList.remove('follow-active');
    if (_overlay && _overlay.parentNode) _overlay.parentNode.removeChild(_overlay);
    _overlay = null;

    // La carte redevient display:none ; resync pour éviter un état de taille
    // figé au prochain affichage.
    requestAnimationFrame(() => { if (map) map.invalidateSize(); });
}
