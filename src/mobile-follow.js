// mobile-follow.js
// Chantier « Suivi de circuit sur mobile » — PR1 (mode immersif) + PR2 (GPS).
//
// Sur mobile, #map est masqué par CSS (base.css : display:none) au profit des
// vues-listes (#mobile-container), ET la carte Leaflet n'est même PAS
// initialisée au boot (app-startup saute initMap dans la branche mobile, par
// économie : le mobile vivait jusqu'ici en listes pures). Ce module RÉVÈLE donc
// #map en plein écran, initialise Leaflet À LA DEMANDE (1re fois seulement),
// pose un header overlay minimal (titre + croix) + des contrôles, et cadre la
// vue sur le tracé réel du circuit actif.
//
// PR1 : « voir le tracé en plein écran ».
// PR2 : point bleu temps réel (watchPosition) + bouton « recentrer sur moi » +
//       Screen Wake Lock (écran maintenu allumé) + états GPS (acquisition /
//       refusé). PAS de turn-by-turn ni routing — on montre juste où on est sur
//       le tracé donné. Écran éteint / arrière-plan = hors scope (limite PWA :
//       watchPosition est gelé, le Wake Lock relâché ; on ré-acquiert au retour).
// PR3 ajoutera le bottom sheet d'aperçu POI + les marqueurs cliquables.
//
// Le tracé est dessiné par le listener `circuit:updated` de map.js (enregistré
// par initMap) : après init, on (ré)émet notifyCircuitChanged pour le tracer.

import L from 'leaflet';
import { map, initMap } from './map.js';
import { state } from './state.js';
import { eventBus } from './events.js';
import { notifyCircuitChanged } from './circuit.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { escapeHtml, getZoneFromCoords } from './utils.js';
import { pushMobileLevel } from './mobile-state.js';
import { showToast } from './toast.js';

let _overlay = null;     // header + contrôles, montés dans le conteneur Leaflet
let _active = false;

// --- État GPS (PR2) ---
let _watchId = null;     // id de navigator.geolocation.watchPosition
let _wakeLock = null;    // sentinelle Screen Wake Lock
let _gpsMarker = null;   // marqueur Leaflet « point bleu »
let _lastLatLng = null;  // [lat, lng] de la dernière position connue
let _hadFix = false;     // a-t-on déjà reçu au moins une position ?
let _didInitialRecenter = false; // recentrage auto une seule fois (1er fix)
let _visHandler = null;  // handler visibilitychange (ré-acquisition Wake Lock)

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
                <div class="wake-chip" id="follow-wake" hidden>
                    <i data-lucide="sun"></i> Écran maintenu allumé
                </div>
            </div>
            <button type="button" class="follow-close" id="follow-close" aria-label="Quitter le suivi">
                <i data-lucide="x"></i>
            </button>
        </div>

        <div class="acq-toast" id="follow-acq" hidden>
            <span class="acq-spin"></span> Recherche du signal GPS…
        </div>

        <div class="gps-invite" id="follow-invite" hidden>
            <div class="gps-invite-ico"><i data-lucide="map-pin-off"></i></div>
            <div class="gps-invite-body">
                <div class="gps-invite-t">Localisation désactivée</div>
                <div class="gps-invite-s">Le tracé reste affiché. Autorise la position pour te voir avancer.</div>
            </div>
            <button type="button" class="gps-invite-btn" id="follow-invite-btn">Autoriser</button>
        </div>

        <div class="follow-ctl follow-ctl-zoom">
            <button type="button" id="follow-zoom-in" aria-label="Zoomer"><i data-lucide="plus"></i></button>
            <button type="button" id="follow-zoom-out" aria-label="Dézoomer"><i data-lucide="minus"></i></button>
        </div>
        <div class="follow-ctl follow-ctl-locate">
            <button type="button" id="follow-locate" class="is-locate" aria-label="Recentrer sur ma position">
                <i data-lucide="locate"></i>
            </button>
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
    overlay.querySelector('#follow-locate').addEventListener('click', recenterOnGps);
    // « Autoriser » : on relance une acquisition (re-prompt si l'utilisateur
    // avait seulement écarté la demande ; ré-échec immédiat si blocage dur).
    overlay.querySelector('#follow-invite-btn').addEventListener('click', () => {
        _hadFix = false;
        startWatch();
    });

    return overlay;
}

// ─── POINT BLEU GPS ───────────────────────────────────────────────────────────

function gpsPuckIcon() {
    // divIcon centré (iconAnchor = centre de la boîte 84×84 = le halo). Le point
    // cobalt + anneau blanc se détache du tracé bleu --brand (anti bleu-sur-bleu).
    return L.divIcon({
        className: 'gps-marker',
        html: '<div class="gps-puck"><div class="gps-halo"></div><div class="gps-pulse"></div><div class="gps-dot"></div></div>',
        iconSize: [84, 84],
        iconAnchor: [42, 42],
    });
}

function updatePuck(latlng) {
    if (!map) return;
    if (!_gpsMarker) {
        _gpsMarker = L.marker(latlng, {
            icon: gpsPuckIcon(),
            interactive: false,   // ne capte pas les clics (POI cliquables = PR3)
            keyboard: false,
            zIndexOffset: 1000,   // au-dessus du tracé et des futurs marqueurs POI
        }).addTo(map);
    } else {
        _gpsMarker.setLatLng(latlng);
    }
}

function removePuck() {
    if (_gpsMarker) { _gpsMarker.remove(); _gpsMarker = null; }
}

function recenterOnGps() {
    if (!map) return;
    if (!_lastLatLng) {
        showToast('Position pas encore disponible…', 'info', 2000);
        return;
    }
    map.flyTo(_lastLatLng, Math.max(map.getZoom(), 16), { animate: true, duration: 0.5 });
}

// ─── ÉTATS GPS (acquisition / live / refusé) ──────────────────────────────────

function setGpsState(stateName) {
    if (!_overlay) return;
    const acq = _overlay.querySelector('#follow-acq');
    const invite = _overlay.querySelector('#follow-invite');
    if (acq) acq.hidden = stateName !== 'acquiring';
    if (invite) invite.hidden = stateName !== 'denied';
    // Le point bleu n'a de sens qu'en 'live' (on a une position).
    if (stateName !== 'live') removePuck();
}

function onPosition(pos) {
    _hadFix = true;
    const ll = [pos.coords.latitude, pos.coords.longitude];
    _lastLatLng = ll;
    setGpsState('live');
    updatePuck(ll);

    // Recentrage automatique UNE SEULE FOIS, au 1er fix : « voilà où tu es ».
    // Ensuite, le point bouge mais la carte ne se déplace plus toute seule (la
    // recentre reste à la demande, via le bouton) — pas de carte qui sautille.
    if (!_didInitialRecenter) {
        _didInitialRecenter = true;
        map.flyTo(ll, Math.max(map.getZoom(), 16), { animate: true, duration: 0.6 });
    }
}

function onGpsError(err) {
    // Erreur transitoire après un 1er fix (perte momentanée) : on garde le
    // dernier point affiché, on ne bascule pas en « refusé ».
    if (_hadFix) return;
    console.warn('[follow] GPS indisponible :', err?.code, err?.message);
    setGpsState('denied');
}

function startWatch() {
    if (!navigator.geolocation) { setGpsState('denied'); return; }
    setGpsState('acquiring');
    // On nettoie un éventuel watch précédent (cas « Autoriser » re-cliqué).
    if (_watchId !== null) { navigator.geolocation.clearWatch(_watchId); _watchId = null; }
    _watchId = navigator.geolocation.watchPosition(
        onPosition,
        onGpsError,
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
    );
}

function stopWatch() {
    if (_watchId !== null) { navigator.geolocation.clearWatch(_watchId); _watchId = null; }
}

// ─── SCREEN WAKE LOCK (écran maintenu allumé pendant la marche) ───────────────
// Sans ça, l'écran se verrouille en ~30 s et watchPosition gèle. Le lock est
// automatiquement relâché quand l'onglet passe en arrière-plan → on le
// ré-acquiert au retour au premier plan (visibilitychange).

async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return; // non supporté (iOS < 16.4…) : on n'affiche pas la puce
    try {
        _wakeLock = await navigator.wakeLock.request('screen');
        _wakeLock.addEventListener('release', () => { setWakeChip(false); });
        setWakeChip(true);
    } catch (e) {
        // Refus (batterie faible…) : non bloquant, on continue sans la puce.
        _wakeLock = null;
        setWakeChip(false);
    }
}

function releaseWakeLock() {
    if (_wakeLock) { _wakeLock.release().catch(() => {}); _wakeLock = null; }
    setWakeChip(false);
}

function setWakeChip(on) {
    const chip = _overlay && _overlay.querySelector('#follow-wake');
    if (chip) chip.hidden = !on;
}

// ─── CYCLE DE VIE DU SUIVI ────────────────────────────────────────────────────

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

    // GPS + Wake Lock (PR2)
    _hadFix = false;
    _didInitialRecenter = false;
    startWatch();
    requestWakeLock();
    _visHandler = () => {
        if (document.visibilityState === 'visible' && _active) requestWakeLock();
    };
    document.addEventListener('visibilitychange', _visHandler);
}

export function stopFollow() {
    if (!_active) return;
    _active = false;

    // GPS + Wake Lock teardown (PR2)
    stopWatch();
    releaseWakeLock();
    removePuck();
    if (_visHandler) { document.removeEventListener('visibilitychange', _visHandler); _visHandler = null; }
    _lastLatLng = null;
    _hadFix = false;
    _didInitialRecenter = false;

    document.body.classList.remove('follow-active');
    if (_overlay && _overlay.parentNode) _overlay.parentNode.removeChild(_overlay);
    _overlay = null;

    // La carte redevient display:none ; resync pour éviter un état de taille
    // figé au prochain affichage.
    requestAnimationFrame(() => { if (map) map.invalidateSize(); });
}
