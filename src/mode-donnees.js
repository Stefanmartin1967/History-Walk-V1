// mode-donnees.js — Mode « Données » (admin). Réunif A3a : coquille plein-écran.
//
// Successeur in-app du Data Manager. Calqué sur osm-pass.js : overlay
// pointer-events:none (la VRAIE carte Heripia reste interactive dessous), modebar
// (haut) + rail gauche (recherche + liste des POI). Lancé depuis le Control
// Center, gated state.isAdmin. Sortie via « Quitter le mode ».
//
// A3a = SQUELETTE : liste + carte + recentrage/surlignage au clic. À venir :
// RichEditor en tiroir droit (A3b) ; filtres « ÉTAT DE LA FICHE » + sélecteur de
// destination (A3c). Zéro écriture/push à ce stade.
import L from 'leaflet';
import { map } from './map.js';
import { state } from './state.js';
import { getPoiId, getPoiName, hasPhotos, hasDescription } from './data.js';
import { escapeXml } from './utils.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { showToast } from './toast.js';
import { RichEditor } from './richEditor.js';

let _overlay = null;
let _items = [];        // features de la destination courante (triées par nom)
let _search = '';
let _filters = { verified: 'all', photo: 'all', description: 'all' }; // 'all' | 'hide' | 'only'
let _filtersOpen = true;
let _currentId = null;  // POI sélectionné
let _highlight = null;  // cercle de surlignage temporaire sur la carte
let _isOpen = false;
let _onEditorClosed = null; // handler 'richEditor:closed' → rafraîchit la liste

function destLabel() {
    const id = state.currentMapId || '';
    return id ? id.charAt(0).toUpperCase() + id.slice(1) : 'Carte courante';
}

function buildItems() {
    return (state.loadedFeatures || []).slice()
        .sort((a, b) => (getPoiName(a) || '').localeCompare(getPoiName(b) || '', 'fr'));
}

// Filtres « ÉTAT DE LA FICHE » — mêmes axes / même sémantique que
// passesUserFilters (data.js) : 'all' = pas de filtre, 'hide' = cache ceux qui
// ONT la prop, 'only' = ne garde QUE ceux qui l'ont.
function matchesFilters(f) {
    const p = { ...f.properties, ...(f.properties && f.properties.userData) };
    if (_filters.verified === 'hide' && p.verified) return false;
    if (_filters.verified === 'only' && !p.verified) return false;
    if (_filters.photo === 'hide' && hasPhotos(p)) return false;
    if (_filters.photo === 'only' && !hasPhotos(p)) return false;
    if (_filters.description === 'hide' && hasDescription(p)) return false;
    if (_filters.description === 'only' && !hasDescription(p)) return false;
    return true;
}

function visibleItems() {
    const s = _search.trim().toLowerCase();
    return _items.filter(f => {
        if (s && !(getPoiName(f) || '').toLowerCase().includes(s)) return false;
        return matchesFilters(f);
    });
}

// Section « ÉTAT DE LA FICHE » repliable dans le rail (réunif A3c). Tri-états
// Tous/Masquer/Afficher par axe ; re-rendue à chaque changement (états + badge).
function renderFilters() {
    const box = _overlay && _overlay.querySelector('[data-md-filters]');
    if (!box) return;
    const active = ['verified', 'photo', 'description'].filter(k => _filters[k] !== 'all').length;
    const triRow = (key, icon, label) => {
        const v = _filters[key];
        return `<div class="tri"><span class="nm"><i data-lucide="${icon}"></i>${label}</span>
            <span class="tri-seg" data-md-tri="${key}">
                <button type="button" data-v="all" class="${v === 'all' ? 'is-on' : ''}">Tous</button>
                <button type="button" data-v="hide" class="${v === 'hide' ? 'is-on hide' : ''}">Masquer</button>
                <button type="button" data-v="only" class="${v === 'only' ? 'is-on show' : ''}">Afficher</button>
            </span></div>`;
    };
    box.innerHTML = `
        <button class="md-filters-head" type="button" data-md-filters-toggle>
            <span class="ic"><i data-lucide="filter"></i></span>
            <span class="ti">État de la fiche</span>
            ${active ? `<span class="badge-active">${active}</span>` : ''}
            <span class="ic"><i data-lucide="${_filtersOpen ? 'chevron-up' : 'chevron-down'}"></i></span>
        </button>
        <div class="md-filters-body"${_filtersOpen ? '' : ' hidden'}>
            ${triRow('verified', 'badge-check', 'Vérifiés')}
            ${triRow('photo', 'image', 'Avec photo')}
            ${triRow('description', 'file-text', 'Avec description')}
        </div>`;
    box.querySelector('[data-md-filters-toggle]').addEventListener('click', () => {
        _filtersOpen = !_filtersOpen;
        renderFilters();
    });
    box.querySelectorAll('[data-md-tri]').forEach(seg => {
        const key = seg.dataset.mdTri;
        seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
            _filters[key] = b.dataset.v;
            renderFilters();
            renderList();
        }));
    });
    createIcons({ icons: appIcons, root: box });
}

function renderShell() {
    _overlay = document.createElement('div');
    _overlay.className = 'mode-donnees-overlay';
    _overlay.innerHTML = `
        <div class="md-modebar">
            <span class="brand"><i data-lucide="database"></i>Heripia</span>
            <span class="pill"><i data-lucide="sliders-horizontal"></i>Mode Données</span>
            <span class="pill md-pill-admin"><i data-lucide="shield-alert"></i>Admin</span>
            <span class="spacer"></span>
            <button class="quit" type="button" data-md-quit><i data-lucide="x"></i>Quitter le mode</button>
        </div>
        <aside class="md-rail">
            <div class="md-rail-head">
                <button class="dest-sel" type="button" disabled title="Changer de destination — à venir (A3d)">
                    <span class="ic"><i data-lucide="map"></i></span>
                    <span><span class="nm">${escapeXml(destLabel())}</span><span class="ct" data-md-count></span></span>
                    <span class="chev"><i data-lucide="chevron-down"></i></span>
                </button>
                <div class="md-tools">
                    <label class="md-search"><i data-lucide="search"></i><input type="search" placeholder="Rechercher un lieu…" data-md-search></label>
                </div>
            </div>
            <div class="md-filters" data-md-filters></div>
            <div class="md-list" data-md-list></div>
            <div class="md-rail-foot"><span data-md-foot></span></div>
        </aside>
    `;
    document.body.appendChild(_overlay);
    document.body.classList.add('mode-donnees-active');
    // La carte passe en plein écran derrière l'overlay → resynchroniser Leaflet.
    setTimeout(() => { try { map.invalidateSize(); } catch (e) {} }, 60);

    _overlay.querySelector('[data-md-quit]').addEventListener('click', stopModeDonnees);
    _overlay.querySelector('[data-md-search]').addEventListener('input', (e) => {
        _search = e.target.value;
        renderList();
    });
    // A3b : à la fermeture du tiroir d'édition, rafraîchir la liste (méta à jour).
    _onEditorClosed = () => renderList();
    window.addEventListener('richEditor:closed', _onEditorClosed);
    renderFilters();
    createIcons({ icons: appIcons, root: _overlay });
}

function renderList() {
    const list = _overlay?.querySelector('[data-md-list]');
    if (!list) return;
    const items = visibleItems();
    if (!items.length) {
        list.innerHTML = `<div class="md-empty">Aucun lieu ne correspond.</div>`;
    } else {
        list.innerHTML = items.map(f => {
            const id = getPoiId(f);
            const props = f.properties || {};
            const name = escapeXml(getPoiName(f) || 'Lieu sans nom');
            const cat = escapeXml(props['Catégorie'] || '—');
            const verif = props.verified || props.userData?.verified;
            const meta = `${verif ? '<span class="verif"><i data-lucide="badge-check"></i>Vérifié</span> · ' : ''}${cat}`;
            return `<div class="md-poi${id === _currentId ? ' is-current' : ''}" data-id="${escapeXml(id)}">
                <span class="md-poi-ic"><i data-lucide="map-pin"></i></span>
                <span class="md-poi-tx"><span class="nm">${name}</span><span class="mt">${meta}</span></span>
            </div>`;
        }).join('');
        list.querySelectorAll('.md-poi').forEach(el =>
            el.addEventListener('click', () => selectPoi(el.dataset.id)));
    }
    createIcons({ icons: appIcons, root: list });
    updateCounts(items.length);
}

function updateCounts(shown) {
    const total = _items.length;
    const foot = _overlay?.querySelector('[data-md-foot]');
    const ct = _overlay?.querySelector('[data-md-count]');
    if (foot) foot.innerHTML = `<b>${shown}</b> affiché${shown > 1 ? 's' : ''} · ${total} au total`;
    if (ct) ct.textContent = `${total} lieu${total > 1 ? 'x' : ''}`;
}

async function selectPoi(id) {
    const f = _items.find(x => getPoiId(x) === id);
    if (!f || !f.geometry) return;
    // A3b : édition EN PLACE dans le tiroir droit. openForEdit confirme si des
    // modifs non enregistrées existent sur un autre lieu → false si annulé : on
    // ne bascule alors ni la sélection ni la carte.
    const ok = await RichEditor.openForEdit(id, { host: 'drawer' });
    if (ok === false) return;
    _currentId = id;
    const [lon, lat] = f.geometry.coordinates;
    if (_highlight) { _highlight.remove(); _highlight = null; }
    _highlight = L.circleMarker([lat, lon], {
        radius: 18, color: '#1f6feb', weight: 3,
        fillColor: '#1f6feb', fillOpacity: 0.12, interactive: false,
    }).addTo(map);
    map.flyTo([lat, lon], Math.max(map.getZoom(), 16), { duration: 0.5 });
    renderList(); // re-marque .is-current
}

function stopModeDonnees() {
    if (!_isOpen) return;
    RichEditor.discardDrawer(); // ferme un éventuel tiroir d'édition ouvert
    if (_onEditorClosed) { window.removeEventListener('richEditor:closed', _onEditorClosed); _onEditorClosed = null; }
    if (_highlight) { _highlight.remove(); _highlight = null; }
    if (_overlay && _overlay.parentNode) _overlay.parentNode.removeChild(_overlay);
    _overlay = null;
    document.body.classList.remove('mode-donnees-active');
    setTimeout(() => { try { map.invalidateSize(); } catch (e) {} }, 60);
    _items = []; _search = ''; _currentId = null; _isOpen = false;
    _filters = { verified: 'all', photo: 'all', description: 'all' }; _filtersOpen = true;
}

// Point d'entrée publique — appelé par le bouton « Mode Données » du Control Center.
export function startModeDonnees() {
    if (_isOpen) return;
    if (!state.isAdmin) { showToast("Outil réservé à l'admin.", 'warning', 3000); return; }
    if (!state.currentMapId) { showToast('Aucune destination active.', 'warning', 3000); return; }
    _isOpen = true;
    _items = buildItems();
    renderShell();
    renderList();
}
