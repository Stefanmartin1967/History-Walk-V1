// mobile-follow.js
// Chantier « Suivi de circuit sur mobile » — PR1 (immersif) + PR2 (GPS) + PR3 (POI).
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
// PR2 : point bleu temps réel (watchPosition) + « recentrer sur moi » + Screen
//       Wake Lock + états GPS (acquisition / refusé).
// PR3 : marqueurs POI du circuit CLIQUABLES + bottom sheet d'aperçu à mi-hauteur
//       (photo + nom + extrait + toggle « visité » + lien « fiche complète »).
//       Le toggle « visité » écrit userData.vu (vuManual) ; le lieu ne disparaît
//       PAS de la carte (le masquage des visités = Lot 2). PAS de turn-by-turn.
//
// Le tracé est dessiné par le listener `circuit:updated` de map.js (enregistré
// par initMap) : après init, on (ré)émet notifyCircuitChanged pour le tracer.

import L from 'leaflet';
import { map, initMap, createHistoryWalkIcon } from './map.js';
import { state, setActiveCircuitId } from './state.js';
import { eventBus } from './events.js';
import { notifyCircuitChanged } from './circuit.js';
import { updatePoiData, getPatrimonialName } from './data.js';
import { getPoiPhotos } from './database.js';
import { openDetailsPanel } from './ui-details.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { escapeHtml, getZoneFromCoords, getPoiId, getPoiProp } from './utils.js';
import { pushMobileLevel } from './mobile-state.js';
import { showToast } from './toast.js';
import { getActiveCircuit } from './circuit-lookup.js';

let _overlay = null;     // header + contrôles, montés dans le conteneur Leaflet
let _active = false;

// --- État GPS (PR2) ---
let _watchId = null;     // id de navigator.geolocation.watchPosition
let _wakeLock = null;    // sentinelle Screen Wake Lock
let _gpsMarker = null;   // marqueur Leaflet « point bleu »
let _lastLatLng = null;  // [lat, lng] de la dernière position connue
let _hadFix = false;     // a-t-on déjà reçu au moins une position ?
let _gpsErrStreak = 0;   // échecs GPS consécutifs après le 1er fix (audit R4)
let _didInitialRecenter = false; // recentrage auto une seule fois (1er fix)
let _visHandler = null;  // handler visibilitychange (ré-acquisition Wake Lock)
let _followMode = true;  // mode-follow : la carte garde le point bleu en vue (désengagé au pan manuel, ré-engagé par « Recentrer »)
let _dragHandler = null; // handler dragstart (désengage le mode-follow quand l'utilisateur pane à la main)

// --- État POI / bottom sheet (PR3) ---
let _poiLayer = null;        // L.layerGroup des marqueurs POI cliquables
let _poiMarkers = new Map(); // poiId -> { marker, feature, idx }
let _sheetEl = null;         // élément DOM du bottom sheet (null = fermé)
let _sheetPoiId = null;      // poiId affiché dans le sheet
let _sheetObjUrl = null;     // objectURL d'une photo locale (à révoquer)

// « Voir la fiche complète » quitte le suivi pour afficher la fiche détaillée
// (rendue dans #mobile-container, masqué pendant le suivi). On mémorise ici le
// circuit suivi : le Back depuis cette fiche RELANCE la marche là où on l'a
// laissée (une fiche = une parenthèse, pas une sortie). Consommé par
// resumeFollow() ; annulé par toute fermeture NORMALE de la fiche (event
// 'details-panel:closed', cf. abonnement en bas de module).
let _resumeFollowCircuitId = null;
export function getResumeFollowCircuitId() { return _resumeFollowCircuitId; }

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

    const title = (circuit.name || 'Circuit')
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
    // followBack(). Même chemin que le Back Android (sortie unique).
    overlay.querySelector('#follow-close').addEventListener('click', () => history.back());
    overlay.querySelector('#follow-zoom-in').addEventListener('click', () => map.zoomIn());
    overlay.querySelector('#follow-zoom-out').addEventListener('click', () => map.zoomOut());
    overlay.querySelector('#follow-locate').addEventListener('click', recenterOnGps);
    // « Autoriser » : on relance une acquisition (re-prompt si l'utilisateur
    // avait seulement écarté la demande ; ré-échec immédiat si blocage dur).
    overlay.querySelector('#follow-invite-btn').addEventListener('click', () => {
        _hadFix = false;
        _gpsErrStreak = 0;
        startWatch();
    });

    return overlay;
}

// ─── MARQUEURS POI CLIQUABLES (PR3) ───────────────────────────────────────────

function buildPoiMarkers() {
    _poiLayer = L.layerGroup().addTo(map);
    _poiMarkers.clear();

    (state.currentCircuit || []).forEach((feature, idx) => {
        const coords = feature?.geometry?.coordinates;
        if (!coords) return;
        const poiId = getPoiId(feature);
        const marker = L.marker([coords[1], coords[0]], {
            icon: createHistoryWalkIcon(feature),
            title: getPatrimonialName(feature),
        });
        marker.on('click', () => openPoiSheet(poiId));
        marker.addTo(_poiLayer);
        _poiMarkers.set(poiId, { marker, feature, idx });
        applyMarkerVisited(poiId);
    });
}

// Reflète l'état « visité » sur le marqueur (atténué + pastille verte). Le
// marqueur ne DISPARAÎT pas (le masquage des visités = Lot 2).
function applyMarkerVisited(poiId) {
    const entry = _poiMarkers.get(poiId);
    if (!entry) return;
    const el = entry.marker.getElement();
    if (!el) return; // pas encore rendu → re-tenté au prochain openPoiSheet
    const done = !!getPoiProp(entry.feature, 'vu');
    el.classList.toggle('hw-mk-done', done);
}

function removePoiMarkers() {
    if (_poiLayer) { _poiLayer.remove(); _poiLayer = null; }
    _poiMarkers.clear();
}

// ─── BOTTOM SHEET D'APERÇU POI (PR3, variante A : compact, photo à gauche) ────

function revokeSheetObjUrl() {
    if (_sheetObjUrl) { URL.revokeObjectURL(_sheetObjUrl); _sheetObjUrl = null; }
}

function sheetMarkup(feature, idx) {
    const total = (state.currentCircuit || []).length;
    const cat = (getPoiProp(feature, 'Catégorie') || 'Lieu').toString();
    const excerpt = (getPoiProp(feature, 'info_gpx')
        || getPoiProp(feature, 'description') || '').toString().trim();
    const isVu = !!getPoiProp(feature, 'vu');
    // getPoiProp (overlay-aware) comme cat/excerpt/vu ci-dessus : une photo curée via
    // l'overlay userData s'affichait en placeholder avec la lecture brute.
    const published = getPoiProp(feature, 'photos');
    const photoUrl = Array.isArray(published) && published.length > 0 ? published[0] : null;

    return `
        <button type="button" class="pv-handle-row" id="pv-close" aria-label="Fermer l'aperçu">
            <span class="pv-handle"></span>
        </button>
        <div class="pv-row">
            <div class="pv-photo" id="pv-photo">
                ${photoUrl
                    ? `<img src="${escapeHtml(photoUrl)}" alt="" loading="lazy">`
                    : `<div class="pv-photo-ph"><i data-lucide="image"></i></div>`}
            </div>
            <div class="pv-body">
                <span class="pv-eyebrow">ÉTAPE ${idx + 1}${total ? ` / ${total}` : ''} · ${escapeHtml(cat.toUpperCase())}</span>
                <div class="pv-name" dir="auto">${escapeHtml(getPatrimonialName(feature))}</div>
                ${excerpt ? `<p class="pv-excerpt">${escapeHtml(excerpt)}</p>` : ''}
            </div>
        </div>
        <div class="pv-actions">
            <button type="button" class="pv-visited ${isVu ? 'is-done' : ''}" id="pv-visited">
                <i data-lucide="${isVu ? 'check-circle' : 'circle'}"></i>
                <span>${isVu ? 'Visité' : 'Marquer visité'}</span>
            </button>
            <button type="button" class="pv-fiche" id="pv-fiche">
                Fiche <i data-lucide="arrow-right"></i>
            </button>
        </div>
    `;
}

function openPoiSheet(poiId) {
    const entry = _poiMarkers.get(poiId);
    if (!entry || !_overlay) return;
    const { feature, idx } = entry;
    _sheetPoiId = poiId;
    revokeSheetObjUrl();

    const firstOpen = !_sheetEl;
    if (!_sheetEl) {
        _sheetEl = document.createElement('div');
        _sheetEl.className = 'pv-sheet';
        _overlay.appendChild(_sheetEl);
        _overlay.classList.add('has-sheet'); // masque les rafts de contrôles
    }
    _sheetEl.innerHTML = sheetMarkup(feature, idx);
    createIcons({ icons: appIcons, root: _sheetEl });

    _sheetEl.querySelector('#pv-close').addEventListener('click', () => history.back());
    _sheetEl.querySelector('#pv-visited').addEventListener('click', () => toggleVisited(poiId));
    _sheetEl.querySelector('#pv-fiche').addEventListener('click', () => exitToFiche(poiId));

    // Photo locale (perso/admin) si aucune photo publiée — hydratation async.
    // getPoiProp (overlay-aware), cohérent avec la vignette ci-dessus : on n'hydrate
    // depuis l'IDB que s'il n'y a vraiment aucune photo (ni publiée ni curée overlay).
    if (!getPoiProp(feature, 'photos')?.length) hydrateLocalPhoto(poiId);

    // Le marqueur tapé se place dans la moitié haute (visible au-dessus du sheet).
    const c = feature.geometry.coordinates;
    map.panTo([c[1], c[0]], { animate: true, duration: 0.4 });

    // Une seule entrée d'historique pour le sheet (réouverture = swap de contenu).
    if (firstOpen) pushMobileLevel('sheet');
}

async function hydrateLocalPhoto(poiId) {
    const mapId = state.currentMapId;
    if (!mapId) return;
    let items = [];
    try { items = await getPoiPhotos(mapId, poiId); } catch (_) { return; }
    // Le sheet a pu être fermé ou avoir changé de POI pendant l'await.
    if (!_sheetEl || _sheetPoiId !== poiId) return;
    if (!items || !items.length || !items[0]?.blob) return;
    revokeSheetObjUrl();
    _sheetObjUrl = URL.createObjectURL(items[0].blob);
    const ph = _sheetEl.querySelector('#pv-photo');
    if (ph) ph.innerHTML = `<img src="${_sheetObjUrl}" alt="">`;
}

async function toggleVisited(poiId) {
    const entry = _poiMarkers.get(poiId);
    if (!entry) return;
    const next = !getPoiProp(entry.feature, 'vu');
    await updatePoiData(poiId, 'vu', next); // écrit vuManual + recompute vu
    // Feedback immédiat in-place (pas d'auto-fermeture ni d'auto-avance ;
    // le lieu reste sur la carte — masquage = Lot 2).
    if (_sheetEl && _sheetPoiId === poiId) {
        const btn = _sheetEl.querySelector('#pv-visited');
        if (btn) {
            btn.classList.toggle('is-done', next);
            btn.innerHTML = `<i data-lucide="${next ? 'check-circle' : 'circle'}"></i><span>${next ? 'Visité' : 'Marquer visité'}</span>`;
            createIcons({ icons: appIcons, root: btn });
        }
    }
    applyMarkerVisited(poiId);
}

// « Voir la fiche complète » : on QUITTE le suivi (la fiche détaillée se rend
// dans #mobile-container, masqué pendant le suivi) puis on l'ouvre. Le Back
// depuis la fiche RELANCE le suivi (cf. _resumeFollowCircuitId + onHwBack) au
// lieu de retomber sur la liste des circuits.
function exitToFiche(poiId) {
    const globalIndex = state.loadedFeatures.findIndex(f => getPoiId(f) === poiId);
    if (globalIndex < 0) { showToast('Fiche introuvable.', 'error'); return; }
    const circuitId = state.activeCircuitId;
    closeSheetInternal();
    stopFollow();
    // Mémorise APRÈS stopFollow (qui ne touche pas au flag) : le Back relancera
    // la marche. La fiche REMPLACE l'entrée #sheet (replaceLevel) au lieu d'en
    // empiler une → la pile reste [.., #follow, #p], un seul Back repop #follow
    // et reprend le suivi (sinon les entrées #follow/#sheet orphelines faisaient
    // vider le circuit au retour).
    _resumeFollowCircuitId = circuitId;
    openDetailsPanel(globalIndex, null, false, { replaceLevel: location.hash === '#sheet' });
}

// Relance le suivi mémorisé par exitToFiche, SANS re-pousser d'entrée
// d'historique (on vient de repop l'entrée #follow existante). Appelé par
// onHwBack au Back depuis la fiche.
export function resumeFollow(explicitId) {
    // id explicite quand l'appelant (onHwBack) a déjà fermé la fiche via
    // closeDetailsPanel → 'details-panel:closed' a effacé le flag interne.
    const id = explicitId || _resumeFollowCircuitId;
    _resumeFollowCircuitId = null;
    if (!id) return;
    if (state.activeCircuitId !== id) setActiveCircuitId(id);
    startFollow({ skipHistory: true });
}

function closeSheetInternal() {
    revokeSheetObjUrl();
    if (_sheetEl && _sheetEl.parentNode) _sheetEl.parentNode.removeChild(_sheetEl);
    _sheetEl = null;
    _sheetPoiId = null;
    if (_overlay) _overlay.classList.remove('has-sheet');
}

// ─── POINT BLEU GPS (PR2) ─────────────────────────────────────────────────────

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
            interactive: false,   // ne capte pas les clics (laisse les POI cliquables)
            keyboard: false,
            zIndexOffset: 1000,   // au-dessus du tracé et des marqueurs POI
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
    // Ré-engage le mode-follow (un pan manuel l'avait désengagé) + recentre.
    _followMode = true;
    map.flyTo(_lastLatLng, Math.max(map.getZoom(), 16), { animate: true, duration: 0.5 });
}

// ─── ÉTATS GPS (acquisition / live / refusé) ──────────────────────────────────

function setGpsState(stateName) {
    if (!_overlay) return;
    const acq = _overlay.querySelector('#follow-acq');
    const invite = _overlay.querySelector('#follow-invite');
    if (acq) acq.hidden = stateName !== 'acquiring';
    if (invite) invite.hidden = stateName !== 'denied';
    // L'invite GPS (refusé) occupe le coin bas → masque les rafts de contrôles
    // pour éviter qu'ils chevauchent le bouton « Autoriser ». De toute façon,
    // sans position il n'y a pas de point bleu à recentrer ni d'intérêt au zoom
    // dans ce cas transitoire. (Même logique que `.has-sheet`.)
    _overlay.classList.toggle('has-invite', stateName === 'denied');
    // Le point bleu n'a de sens qu'en 'live' (on a une position).
    if (stateName !== 'live') removePuck();
}

function onPosition(pos) {
    _hadFix = true;
    _gpsErrStreak = 0;
    const ll = [pos.coords.latitude, pos.coords.longitude];
    _lastLatLng = ll;
    setGpsState('live');
    updatePuck(ll);

    // Recentrage automatique au 1er fix : « voilà où tu es » (zoom-in + flyTo).
    if (!_didInitialRecenter) {
        _didInitialRecenter = true;
        map.flyTo(ll, Math.max(map.getZoom(), 16), { animate: true, duration: 0.6 });
        return;
    }

    // Mode-follow : la carte garde le point bleu en vue pendant la marche. Pour
    // NE PAS avoir une « carte qui sautille » (raison du design initial), on ne
    // recentre QUE lorsque le point quitte la zone centrale (~50 % du milieu de
    // l'écran), par un panTo doux. Le pan manuel désengage `_followMode` (handler
    // dragstart, posé dans startFollow) ; le bouton « Recentrer » le ré-engage.
    // Suspendu tant qu'un sheet POI est ouvert (`!_sheetEl`) : sinon un fix GPS
    // bougerait la carte sous le panneau (annulerait son recadrage en moitié haute).
    if (_followMode && !_sheetEl && map.getBounds && !map.getBounds().pad(-0.25).contains(ll)) {
        map.panTo(ll, { animate: true, duration: 0.5 });
    }
}

// Seuil de pertes consécutives avant de réafficher « Recherche du signal GPS… ».
// watchPosition a un timeout de 15 s → 3 échecs ≈ 45 s sans position : au-delà,
// laisser le point bleu figé ferait croire au marcheur qu'il est encore « là ».
const GPS_LOSS_STREAK = 3;

function onGpsError(err) {
    if (!_hadFix) {
        console.warn('[follow] GPS indisponible :', err?.code, err?.message);
        setGpsState('denied');
        return;
    }
    // Permission révoquée EN COURS de suivi : plus aucun fix ne reviendra →
    // l'invite « Autoriser » est le seul état honnête (et son bouton relance).
    if (err?.code === 1) {
        setGpsState('denied');
        return;
    }
    // Erreur transitoire après un 1er fix (perte momentanée) : on garde le
    // dernier point affiché. Mais une perte LONGUE (ruelle couverte, GPS coupé)
    // figerait le point bleu en silence (audit R4) → au-delà du seuil, on
    // réaffiche « Recherche… » et on retire le point obsolète ; le prochain
    // fix (onPosition) rebascule en live et remet le point.
    _gpsErrStreak++;
    if (_gpsErrStreak >= GPS_LOSS_STREAK) setGpsState('acquiring');
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

export function startFollow(opts = {}) {
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
    buildPoiMarkers(); // marqueurs POI cliquables (PR3)

    // Entrée d'historique : le Back Android (et la croix) quittent le suivi
    // au lieu de revenir à la liste des circuits. À la REPRISE depuis une fiche
    // (resumeFollow), on vient de repop l'entrée #follow existante → ne pas en
    // empiler une nouvelle (skipHistory).
    if (!opts.skipHistory) pushMobileLevel('follow');

    // Resync de la taille interne Leaflet (le conteneur vient de passer de
    // display:none à plein écran) puis cadrage sur le tracé, au frame suivant
    // (DOM stabilisé).
    requestAnimationFrame(() => {
        if (!_active || !map) return;
        map.invalidateSize();
        // Les marqueurs sont rendus : on peut appliquer l'état « visité ».
        _poiMarkers.forEach((_v, poiId) => applyMarkerVisited(poiId));
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
    _gpsErrStreak = 0;
    _didInitialRecenter = false;
    // Mode-follow ON par défaut ; un pan manuel le désengage (regarder autour
    // sans que la carte ne resaute sur le point), le bouton « Recentrer » le
    // ré-engage. Les panTo/flyTo programmatiques NE déclenchent PAS 'dragstart'
    // (Leaflet : dragstart = geste utilisateur) → pas d'auto-désengagement.
    _followMode = true;
    _dragHandler = () => { _followMode = false; };
    map.on('dragstart', _dragHandler);
    startWatch();
    requestWakeLock();
    _visHandler = () => {
        if (document.visibilityState === 'visible' && _active) requestWakeLock();
    };
    document.addEventListener('visibilitychange', _visHandler);
}

// Point d'entrée unique du Back/croix pendant le suivi : si un sheet POI est
// ouvert, on le ferme d'abord ; sinon on quitte le suivi. (Appelé par
// mobile-nav.onHwBack, déclenché par le pop de l'entrée d'historique.)
export function followBack() {
    if (_sheetEl) { closeSheetInternal(); return; }
    stopFollow();
}

export function stopFollow() {
    if (!_active) return;
    _active = false;

    // Sheet + marqueurs POI (PR3)
    closeSheetInternal();
    removePoiMarkers();

    // GPS + Wake Lock teardown (PR2)
    stopWatch();
    releaseWakeLock();
    removePuck();
    if (_visHandler) { document.removeEventListener('visibilitychange', _visHandler); _visHandler = null; }
    if (_dragHandler && map) { map.off('dragstart', _dragHandler); }
    _dragHandler = null;
    _followMode = true;
    _lastLatLng = null;
    _hadFix = false;
    _gpsErrStreak = 0;
    _didInitialRecenter = false;

    document.body.classList.remove('follow-active');
    if (_overlay && _overlay.parentNode) _overlay.parentNode.removeChild(_overlay);
    _overlay = null;

    // La carte redevient display:none ; resync pour éviter un état de taille
    // figé au prochain affichage.
    requestAnimationFrame(() => { if (map) map.invalidateSize(); });
}

// Anti-fuite : toute fermeture NORMALE de la fiche (bouton X, ou Back non-repris)
// passe par closeDetailsPanel → 'details-panel:closed' → annule une reprise de
// suivi en attente. La reprise (resumeFollow) ne passe PAS par closeDetailsPanel
// (elle remet currentFeatureId à null directement) → n'émet pas cet event, son
// flag survit jusqu'à sa consommation. Empêche un flag résiduel de relancer un
// suivi lors d'un Back depuis une fiche ouverte plus tard par un autre chemin.
eventBus.on('details-panel:closed', () => { _resumeFollowCircuitId = null; });
