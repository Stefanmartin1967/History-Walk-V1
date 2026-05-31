// osm-pass.js — Mode « Passe globale OSM » (admin). PR 3/5 chantier drapeaux v2.
//
// Outil de revue exhaustive des POI off-route (ou jamais évalués) pour fixer
// leur drapeau d'accès en une session :
//   - liste tous les POI qui MÉRITENT une décision (cf. shouldIncludeInPass)
//   - batch Overpass au lancement pour les POI status='undefined' (legacy)
//   - navigation next/prev avec recentrage carte automatique
//   - actions par POI : Conserver / Remplacer par OSM / Effacer / Suivant
//   - drag drapeau in-place (bascule sur status='moved')
//   - modale de confirmation à la sortie si modifs non sauvées
//
// Lancé depuis le CC ("Passe drapeaux OSM" dans Outils), ferme le CC, prend
// possession de l'écran via .osm-pass-overlay (body.osm-pass-active masque la
// sidebar HW V2 le temps de la session). Sortie restaure la sidebar V2.
import L from 'leaflet';
import { map } from './map.js';
import { state } from './state.js';
import { getPoiId, getPoiName, updatePoiData } from './data.js';
import { getAccessPoint, escapeXml } from './utils.js';
import { getAccessPointStatus, prepoSeAccessPoint } from './access-point.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { showToast } from './toast.js';
import { showConfirm } from './modal.js';

// === État de session ===========================================================
let _overlay = null;
let _items = [];           // [{feature, status, distance}] — POI à traiter
let _currentIdx = -1;
let _filter = 'all';       // all | nodrapeau | drapeau | failed
let _search = '';
let _marker = null;        // drapeau Leaflet sur la carte (draggable)
let _line = null;          // ligne pointillée POI → drapeau
let _dirty = false;        // modifs non sauvées sur _currentIdx
let _draggedState = null;  // 'osm' | 'moved' courant (couleur visuelle)
let _isLoading = false;
let _isOpen = false;

// === Helpers purs (testables) ==================================================

/**
 * Décide si un POI doit apparaître dans la passe globale.
 * Inclus : drapeaux pré-posés (osm/moved), échecs (failed) et POI jamais
 * évalués (undefined). Exclus : POI confirmés sur voie (on-track).
 */
export function shouldIncludeInPass(feature) {
    const status = getAccessPointStatus(feature);
    return status === 'osm' || status === 'moved' || status === 'failed' || status === undefined;
}

/**
 * Filtre la liste selon le bouton actif + texte de recherche.
 *  - all       : tous les items
 *  - nodrapeau : items sans accessPoint (status undefined OU failed)
 *  - drapeau   : items avec accessPoint (status osm OU moved)
 *  - failed    : seulement les status='failed'
 */
export function filterItems(items, filter, search) {
    const s = (search || '').trim().toLowerCase();
    return items.filter(it => {
        if (filter === 'nodrapeau' && !(it.status === undefined || it.status === 'failed')) return false;
        if (filter === 'drapeau'   && !(it.status === 'osm' || it.status === 'moved'))      return false;
        if (filter === 'failed'    && it.status !== 'failed')                                return false;
        if (s) {
            const name = (getPoiName(it.feature) || '').toLowerCase();
            if (!name.includes(s)) return false;
        }
        return true;
    });
}

// === Construction de la liste depuis state.loadedFeatures =====================

function buildItems() {
    const features = state.loadedFeatures || [];
    return features
        .filter(shouldIncludeInPass)
        .map(feature => ({
            feature,
            status: getAccessPointStatus(feature),
            distance: null,
        }))
        // tri : failed > undefined > osm/moved (les plus urgents en tête)
        .sort((a, b) => {
            const rank = (s) => s === 'failed' ? 0 : s === undefined ? 1 : 2;
            return rank(a.status) - rank(b.status);
        });
}

// === Batch Overpass initial pour les status=undefined =========================

async function runInitialBatch() {
    const toEvaluate = _items.filter(it => it.status === undefined);
    if (toEvaluate.length === 0) return;

    _isLoading = true;
    updateLoadingBanner(0, toEvaluate.length);

    const CONCURRENCY = 3;
    let done = 0;
    const queue = [...toEvaluate];
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        while (queue.length) {
            const it = queue.shift();
            try {
                const r = await prepoSeAccessPoint(it.feature);
                it.status = r.status;
                it.distance = r.distance;
            } catch (e) {
                it.status = 'failed';
            }
            done++;
            updateLoadingBanner(done, toEvaluate.length);
        }
    });
    await Promise.all(workers);

    // Retire les 'on-track' (nouvellement classés en voie) du tableau de travail
    _items = _items.filter(it => it.status !== 'on-track');
    _isLoading = false;
}

function updateLoadingBanner(done, total) {
    const banner = _overlay?.querySelector('.osm-pass-loading');
    if (banner) {
        banner.querySelector('.txt').textContent = `Évaluation OSM en cours… ${done}/${total}`;
    }
}

// === Rendu du panneau ==========================================================

function renderShell() {
    _overlay = document.createElement('div');
    _overlay.className = 'osm-pass-overlay';
    _overlay.innerHTML = `
        <aside class="osm-pass-side">
            <div class="osm-pass-head">
                <h3><i data-lucide="flag"></i> Passe drapeaux OSM</h3>
                <p class="sub">${escapeXml(stateLabel())} · Revue des POI off-route</p>
            </div>
            <div class="osm-pass-progress">
                <div class="osm-pass-progress-bar"><i style="width:0%"></i></div>
                <div class="osm-pass-progress-txt">
                    <span><b data-pass-done>0</b> revus</span>
                    <span><b data-pass-total>0</b> POI</span>
                </div>
            </div>
            <div class="osm-pass-filters" role="tablist">
                <button class="osm-pass-filter is-active" data-filter="all">Tout</button>
                <button class="osm-pass-filter" data-filter="nodrapeau">Sans drapeau</button>
                <button class="osm-pass-filter" data-filter="drapeau">Avec drapeau</button>
                <button class="osm-pass-filter" data-filter="failed">Échecs</button>
            </div>
            <input class="osm-pass-search" type="search" placeholder="Rechercher un POI…" data-pass-search>
            <ul class="osm-pass-list" data-pass-list></ul>
        </aside>
        <button class="osm-pass-quit" data-pass-quit>
            <i data-lucide="x"></i> Quitter la passe
        </button>
        <div class="osm-pass-loading">
            <span class="spin"></span>
            <span class="txt">Évaluation OSM en cours…</span>
        </div>
    `;
    document.body.appendChild(_overlay);
    document.body.classList.add('osm-pass-active');

    // Bindings
    _overlay.querySelector('[data-pass-quit]').addEventListener('click', requestQuit);
    _overlay.querySelectorAll('.osm-pass-filter').forEach(btn => {
        btn.addEventListener('click', () => {
            _overlay.querySelectorAll('.osm-pass-filter').forEach(b => b.classList.remove('is-active'));
            btn.classList.add('is-active');
            _filter = btn.dataset.filter;
            renderList();
        });
    });
    _overlay.querySelector('[data-pass-search]').addEventListener('input', (e) => {
        _search = e.target.value;
        renderList();
    });
    createIcons({ icons: appIcons, attrs: { 'stroke-width': 2 }, nameAttr: 'data-lucide' });
}

function removeLoadingBanner() {
    const banner = _overlay?.querySelector('.osm-pass-loading');
    if (banner) banner.remove();
}

function renderList() {
    const ul = _overlay?.querySelector('[data-pass-list]');
    if (!ul) return;
    const filtered = filterItems(_items, _filter, _search);
    const currentFeature = _items[_currentIdx]?.feature;
    if (filtered.length === 0) {
        ul.innerHTML = `<li class="osm-pass-empty">Aucun POI ne correspond.</li>`;
        return;
    }
    ul.innerHTML = filtered.map(it => {
        const isCurrent = it.feature === currentFeature;
        const stClass = it.status === 'osm' ? 'is-osm'
                      : it.status === 'moved' ? 'is-moved'
                      : it.status === 'failed' ? 'is-failed'
                      : 'is-pending';
        const name = escapeXml(getPoiName(it.feature) || 'POI sans nom');
        return `
            <li class="osm-pass-item${isCurrent ? ' is-current' : ''}" data-poi-id="${escapeXml(getPoiId(it.feature))}">
                <span class="osm-pass-item-nm">${name}</span>
                <span class="osm-pass-item-st ${stClass}"></span>
            </li>
        `;
    }).join('');
    ul.querySelectorAll('.osm-pass-item').forEach(li => {
        li.addEventListener('click', () => {
            const poiId = li.dataset.poiId;
            const idx = _items.findIndex(it => getPoiId(it.feature) === poiId);
            if (idx >= 0) jumpTo(idx);
        });
    });
}

function renderActionBar() {
    let bar = _overlay?.querySelector('.osm-pass-actionbar');
    if (!bar) {
        bar = document.createElement('div');
        bar.className = 'osm-pass-actionbar';
        _overlay.appendChild(bar);
    }
    const item = _items[_currentIdx];
    if (!item) {
        bar.innerHTML = `<span class="meta">Aucun POI sélectionné</span>`;
        return;
    }
    const name = escapeXml(getPoiName(item.feature) || 'POI');
    const total = _items.length;
    const distLabel = item.distance != null ? ` · ${Math.round(item.distance)} m` : '';
    bar.innerHTML = `
        <span class="meta">POI <b>${_currentIdx + 1}/${total}</b> · ${name}${distLabel}</span>
        <span class="sep"></span>
        <button class="osm-pass-btn" data-act="keep">Conserver</button>
        <button class="osm-pass-btn" data-act="replace"><i data-lucide="sparkles"></i> Remplacer par OSM</button>
        <button class="osm-pass-btn" data-act="erase">Effacer</button>
        <button class="osm-pass-btn osm-pass-btn--primary" data-act="next">
            Suivant <i data-lucide="chevron-right"></i>
        </button>
    `;
    L.DomEvent.disableClickPropagation(bar);
    bar.querySelector('[data-act="keep"]').addEventListener('click', onKeep);
    bar.querySelector('[data-act="replace"]').addEventListener('click', onReplace);
    bar.querySelector('[data-act="erase"]').addEventListener('click', onErase);
    bar.querySelector('[data-act="next"]').addEventListener('click', onNext);
    createIcons({ icons: appIcons, attrs: { 'stroke-width': 2 }, nameAttr: 'data-lucide' });
}

function updateProgress() {
    if (!_overlay) return;
    const total = _items.length;
    const done = Math.max(0, _currentIdx); // POI déjà parcourus
    _overlay.querySelector('[data-pass-done]').textContent = done;
    _overlay.querySelector('[data-pass-total]').textContent = total;
    _overlay.querySelector('.osm-pass-progress-bar > i').style.width =
        total > 0 ? `${(done / total) * 100}%` : '0%';
}

// === Navigation ================================================================

function jumpTo(idx) {
    if (_dirty) {
        // Modifs en cours sur le POI courant — pour ne pas perdre, on prompt.
        // Garde simple : on annule la nav (l'admin doit cliquer Conserver/Effacer
        // ou Remplacer pour matérialiser, sinon repartir).
        showToast('Action en attente : Conserver / Remplacer / Effacer.', 'info', 3000);
        return;
    }
    _currentIdx = idx;
    setupCurrentPoi();
    renderList();
    renderActionBar();
    updateProgress();
}

function setupCurrentPoi() {
    teardownMarker();
    const item = _items[_currentIdx];
    if (!item || !item.feature) return;

    const [lon, lat] = item.feature.geometry.coordinates;
    map.flyTo([lat, lon], 18, { duration: 0.6 });

    // Drapeau visible si on a un accessPoint connu OU une suggestion OSM cachée
    // (status='osm'/'moved') ; sinon pas de drapeau (POI failed sans suggestion).
    const ap = getAccessPoint(item.feature);
    _draggedState = item.status === 'moved' ? 'moved' : 'osm';
    if (ap) {
        const [apLon, apLat] = ap;
        _marker = L.marker([apLat, apLon], {
            draggable: true,
            icon: flagIcon(_draggedState),
            zIndexOffset: 1200,
        }).addTo(map);
        _line = L.polyline([[lat, lon], [apLat, apLon]], {
            color: '#c0392b', weight: 2, dashArray: '5,8', opacity: 0.9, interactive: false,
        }).addTo(map);
        _marker.on('drag', () => {
            _dirty = true;
            _draggedState = 'moved';
            _marker.setIcon(flagIcon('moved'));
            const ll = _marker.getLatLng();
            _line.setLatLngs([[lat, lon], [ll.lat, ll.lng]]);
        });
    }
}

function flagIcon(state) {
    const modifier = state === 'osm' ? 'hw-flag--osm' : 'hw-flag--moved';
    return L.divIcon({
        className: 'hw-flag ' + modifier,
        html: '<span class="hw-flag-mast"></span><span class="hw-flag-banner"></span>',
        iconSize: [22, 30],
        iconAnchor: [3, 30],
    });
}

function teardownMarker() {
    if (_marker) { _marker.remove(); _marker = null; }
    if (_line) { _line.remove(); _line = null; }
    _dirty = false;
    _draggedState = null;
}

// === Actions par POI ===========================================================

async function onKeep() {
    const item = _items[_currentIdx];
    if (!item) return;
    if (_marker && _dirty) {
        // L'admin a glissé puis cliqué « Conserver » → on prend la nouvelle position.
        const ll = _marker.getLatLng();
        await updatePoiData(getPoiId(item.feature), 'accessPoint', [ll.lng, ll.lat]);
        await updatePoiData(getPoiId(item.feature), 'accessPointStatus', 'moved');
        item.status = 'moved';
    }
    _dirty = false;
    onNext();
}

async function onReplace() {
    const item = _items[_currentIdx];
    if (!item) return;
    if (item.status === 'moved' && !_dirty) {
        // Confirmation avant d'écraser un drapeau déplacé manuellement.
        const ok = await showConfirm(
            'Remplacer le drapeau',
            'Ce drapeau a été ajusté manuellement. Le remplacer par la suggestion OSM ?',
            'Remplacer', 'Annuler', false
        );
        if (!ok) return;
    }
    try {
        const r = await prepoSeAccessPoint(item.feature, { force: true });
        item.status = r.status;
        item.distance = r.distance;
        if (r.status === 'failed') {
            showToast('Aucune voie OSM trouvée — à reprendre.', 'warning', 3000);
        }
    } catch (e) {
        showToast('Échec OSM. À reprendre plus tard.', 'warning', 3000);
    }
    _dirty = false;
    setupCurrentPoi();
    renderList();
    renderActionBar();
}

async function onErase() {
    const item = _items[_currentIdx];
    if (!item) return;
    await updatePoiData(getPoiId(item.feature), 'accessPoint', null);
    await updatePoiData(getPoiId(item.feature), 'accessPointStatus', 'on-track');
    item.status = 'on-track';
    _dirty = false;
    showToast('Drapeau retiré · POI considéré sur voie.', 'info', 2500);
    // L'item passe en 'on-track' → on le retire de la liste de travail.
    _items.splice(_currentIdx, 1);
    if (_currentIdx >= _items.length) _currentIdx = _items.length - 1;
    if (_currentIdx < 0) { finishPass(); return; }
    setupCurrentPoi();
    renderList();
    renderActionBar();
    updateProgress();
}

function onNext() {
    if (_currentIdx + 1 >= _items.length) {
        finishPass();
        return;
    }
    jumpTo(_currentIdx + 1);
}

function finishPass() {
    showToast('Passe terminée.', 'success', 2500);
    stopOsmPass();
}

// === Sortie ====================================================================

async function requestQuit() {
    if (_dirty) {
        const ok = await showConfirm(
            'Quitter la passe',
            'Modifications non enregistrées sur ce POI. Quitter quand même ?',
            'Quitter', 'Annuler', true
        );
        if (!ok) return;
    }
    stopOsmPass();
}

function stopOsmPass() {
    if (!_isOpen) return;
    teardownMarker();
    if (_overlay && _overlay.parentNode) _overlay.parentNode.removeChild(_overlay);
    _overlay = null;
    document.body.classList.remove('osm-pass-active');
    _items = [];
    _currentIdx = -1;
    _filter = 'all';
    _search = '';
    _isOpen = false;
    _isLoading = false;
}

function stateLabel() {
    const id = state.currentMapId || '';
    return id ? id.charAt(0).toUpperCase() + id.slice(1) : 'Carte courante';
}

// === Point d'entrée publique ===================================================

export async function startOsmPass() {
    if (_isOpen) return;
    if (!state.isAdmin) {
        showToast('Outil réservé à l’admin.', 'warning', 3000);
        return;
    }
    if (!state.currentMapId) {
        showToast('Aucune destination active.', 'warning', 3000);
        return;
    }
    _isOpen = true;
    _items = buildItems();
    if (_items.length === 0) {
        _isOpen = false;
        showToast('Tous les POI sont déjà sur voie ou évalués.', 'success', 3500);
        return;
    }
    renderShell();
    updateProgress();
    renderList();

    // Batch Overpass pour les undefined puis sélection du 1er POI.
    await runInitialBatch();
    removeLoadingBanner();
    // Rebuild items au cas où le batch a déclassé des POI en on-track.
    _items = _items.filter(shouldIncludeInPass).map(it => ({
        feature: it.feature,
        status: getAccessPointStatus(it.feature),
        distance: it.distance,
    }));
    if (_items.length === 0) {
        stopOsmPass();
        showToast('Tous les POI sont sur voie après évaluation.', 'success', 3500);
        return;
    }
    jumpTo(0);
}

// Export pour usage par admin-control-ui (bouton CC) — pas d'auto-start.
