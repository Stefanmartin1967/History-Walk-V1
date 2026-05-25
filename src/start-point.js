// start-point.js
// Point de départ de l'utilisateur, utilisé par le tri « Proximité » de la
// liste des circuits. Relocalisé ici : #640 avait retiré le réglage de Mon
// Espace sans le remettre ailleurs, laissant le tri inaccessible.
//
// Deux voies de saisie : la position GPS, ou le choix d'un lieu déjà présent
// dans l'app (officiel ou perso — un point absent s'ajoute via clic droit sur
// la carte, puis se sélectionne ici). Pas de géocodage externe.
//
// Persisté en IndexedDB sous la clé 'homeLocation' (rechargé au boot, main.js).

import { state, setHomeLocation } from './state.js';
import { saveAppState } from './database.js';
import { openHwModal, closeHwModal } from './modal.js';
import { getPoiName } from './data.js';
import { getSearchResults } from './search.js';
import { showToast } from './toast.js';

const HOME_KEY = 'homeLocation';
const MAX_RESULTS = 30;

async function persistHome(home) {
    setHomeLocation(home);
    try {
        await saveAppState(HOME_KEY, home);
    } catch (e) {
        console.warn('[StartPoint] Persistance échouée:', e.message);
    }
}

// Libellé du point de départ courant (pour l'affichage sous le tri), ou null.
export function getStartPointLabel() {
    return state.homeLocation?.label || null;
}

// Construit l'objet point de départ depuis un POI. Les coordonnées GeoJSON sont
// [lng, lat] : on les remet dans l'ordre {lat, lng} attendu par le tri.
// Renvoie null si la géométrie est inexploitable.
export function buildHomeFromFeature(feature) {
    const coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return null;
    const [lng, lat] = coords;
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;
    return { lat, lng, label: getPoiName(feature), savedAt: Date.now() };
}

function renderResults(container, query) {
    container.innerHTML = '';
    const results = getSearchResults(query);
    if (results.length === 0) {
        if (query.trim().length > 0) {
            const empty = document.createElement('p');
            empty.className = 'sp-empty';
            empty.textContent = 'Aucun lieu ne correspond.';
            container.appendChild(empty);
        }
        return;
    }
    const frag = document.createDocumentFragment();
    results.slice(0, MAX_RESULTS).forEach(f => {
        const home = buildHomeFromFeature(f);
        if (!home) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sp-result';
        btn.textContent = home.label;
        btn.addEventListener('click', () => closeHwModal({ home }));
        frag.appendChild(btn);
    });
    container.appendChild(frag);
}

function captureGps(btn) {
    if (!navigator.geolocation) {
        showToast('GPS non supporté sur cet appareil.', 'error', 4000);
        return;
    }
    const textEl = btn.querySelector('.sp-gps-text');
    const prevText = textEl ? textEl.textContent : '';
    btn.disabled = true;
    if (textEl) textEl.textContent = 'Localisation…';

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const { latitude, longitude } = pos.coords;
            closeHwModal({ home: { lat: latitude, lng: longitude, label: 'Ma position', savedAt: Date.now() } });
        },
        (err) => {
            btn.disabled = false;
            if (textEl) textEl.textContent = prevText;
            const msg = err.code === err.PERMISSION_DENIED
                ? 'Autorise la localisation pour utiliser ta position.'
                : 'Position indisponible, réessaie ou choisis un lieu.';
            showToast(msg, 'error', 4500);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

function buildBody() {
    const container = document.createElement('div');
    container.className = 'sp-modal';
    container.innerHTML = `
        <div class="sp-current" hidden>
            <span class="sp-current-label"></span>
            <button type="button" class="sp-clear" aria-label="Effacer le point de départ">
                <i data-lucide="trash-2"></i>Effacer
            </button>
        </div>
        <button type="button" class="sp-gps btn btn-primary">
            <i data-lucide="locate-fixed"></i><span class="sp-gps-text">Utiliser ma position</span>
        </button>
        <div class="sp-or"><span>ou choisis un lieu</span></div>
        <label class="sp-search">
            <i data-lucide="search"></i>
            <input type="search" class="sp-search-input" placeholder="Rechercher un lieu…" autocomplete="off">
        </label>
        <div class="sp-results"></div>
    `;

    // Bloc « point actuel » (si déjà défini) → permet de l'effacer.
    if (state.homeLocation) {
        const current = container.querySelector('.sp-current');
        current.hidden = false;
        const label = state.homeLocation.label || 'Lieu défini';
        container.querySelector('.sp-current-label').textContent = `Départ actuel : ${label}`;
        container.querySelector('.sp-clear').addEventListener('click', () => {
            closeHwModal({ clear: true });
        });
    }

    container.querySelector('.sp-gps').addEventListener('click', (e) => {
        captureGps(e.currentTarget);
    });

    const input = container.querySelector('.sp-search-input');
    const results = container.querySelector('.sp-results');
    input.addEventListener('input', () => renderResults(results, input.value));

    return container;
}

/**
 * Ouvre la modale « Point de départ ». Persiste le choix (GPS / lieu) ou
 * l'effacement, puis résout avec l'état courant de state.homeLocation
 * (objet si défini, null si effacé ou non défini).
 * @returns {Promise<Object|null>}
 */
export async function openStartPointModal() {
    const result = await openHwModal({
        size: 'sm',
        icon: 'map-pin',
        title: 'Point de départ',
        body: buildBody(),
        footer: false,
    });

    if (result && result.home) {
        await persistHome(result.home);
    } else if (result && result.clear) {
        await persistHome(null);
    }
    return state.homeLocation;
}
