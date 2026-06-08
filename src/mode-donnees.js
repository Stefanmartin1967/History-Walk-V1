// mode-donnees.js — Mode « Données » (admin). Réunif A3a/b/c → coquille v2 (A3d).
//
// Successeur in-app du Data Manager. La TOPBAR Heripia est CONSERVÉE (sélecteur
// de destination + bouton Filtres + thème) — on ne réinvente pas ces contrôles
// (réunif A3d). L'overlay n'ajoute qu'un RAIL gauche : en-tête « Mode Données »
// + Quitter + recherche + liste. La VRAIE carte reste interactive dessous ; le
// RichEditor s'ouvre en tiroir droit (A3b). Gated state.isAdmin.
//
// Filtres UNIFIÉS (A3d) : la liste suit les filtres de la topbar (panneau
// Filtres → eventBus 'data:filtered') ; pas de filtres propres au rail.
import L from 'leaflet';
import { map } from './map.js';
import { state } from './state.js';
import { getPoiId, getPoiName, getFilteredFeatures } from './data.js';
import { escapeXml } from './utils.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { showToast } from './toast.js';
import { RichEditor } from './richEditor.js';
import { eventBus } from './events.js';

let _overlay = null;
let _items = [];        // POI affichés = features filtrées (topbar) triées par nom
let _search = '';
let _currentId = null;  // POI sélectionné
let _highlight = null;  // cercle de surlignage temporaire sur la carte
let _isOpen = false;
let _onEditorClosed = null; // handler window 'richEditor:closed' → rafraîchit la liste
let _onDataFiltered = null; // handler eventBus 'data:filtered' → resync sur filtres topbar

function buildItems() {
    // Filtres unifiés : on part du jeu DÉJÀ filtré par la topbar (catégorie /
    // zone / état de la fiche / parcours), trié par nom.
    return (getFilteredFeatures() || []).slice()
        .sort((a, b) => (getPoiName(a) || '').localeCompare(getPoiName(b) || '', 'fr'));
}

function visibleItems() {
    const s = _search.trim().toLowerCase();
    if (!s) return _items;
    return _items.filter(f => (getPoiName(f) || '').toLowerCase().includes(s));
}

function renderShell() {
    _overlay = document.createElement('div');
    _overlay.className = 'mode-donnees-overlay';
    _overlay.innerHTML = `
        <aside class="md-rail">
            <div class="md-rail-head">
                <div class="md-rail-title">
                    <span class="md-mode-badge"><i data-lucide="sliders-horizontal"></i>Mode Données</span>
                    <button class="md-quit" type="button" data-md-quit><i data-lucide="x"></i>Quitter</button>
                </div>
                <label class="md-search"><i data-lucide="search"></i><input type="search" placeholder="Rechercher un lieu…" data-md-search></label>
            </div>
            <div class="md-list" data-md-list></div>
            <div class="md-rail-foot"><span data-md-foot></span></div>
        </aside>
    `;
    document.body.appendChild(_overlay);
    document.body.classList.add('mode-donnees-active');
    // La carte s'étend (sidebar masquée) → resynchroniser Leaflet.
    setTimeout(() => { try { map.invalidateSize(); } catch (e) {} }, 60);

    _overlay.querySelector('[data-md-quit]').addEventListener('click', stopModeDonnees);
    _overlay.querySelector('[data-md-search]').addEventListener('input', (e) => {
        _search = e.target.value;
        renderList();
    });
    // A3b : à la fermeture du tiroir d'édition, rafraîchir la liste (méta à jour).
    _onEditorClosed = () => renderList();
    window.addEventListener('richEditor:closed', _onEditorClosed);
    // A3d : filtres unifiés — la liste suit les filtres de la topbar.
    _onDataFiltered = () => { _items = buildItems(); renderList(); };
    eventBus.on('data:filtered', _onDataFiltered);
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
    if (foot) foot.innerHTML = `<b>${shown}</b> affiché${shown > 1 ? 's' : ''} · ${total} au total`;
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
    if (_onDataFiltered) { eventBus.off('data:filtered', _onDataFiltered); _onDataFiltered = null; }
    if (_highlight) { _highlight.remove(); _highlight = null; }
    if (_overlay && _overlay.parentNode) _overlay.parentNode.removeChild(_overlay);
    _overlay = null;
    document.body.classList.remove('mode-donnees-active');
    setTimeout(() => { try { map.invalidateSize(); } catch (e) {} }, 60);
    _items = []; _search = ''; _currentId = null; _isOpen = false;
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
