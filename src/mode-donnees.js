// mode-donnees.js — Mode « Données » (admin). Réunif A3a/b/c → coquille v2 (A3d)
// → clic = fiche de consultation (22/09/2026).
//
// Successeur in-app du Data Manager. La TOPBAR Heripia est CONSERVÉE (sélecteur
// de destination + bouton Filtres + thème) — on ne réinvente pas ces contrôles
// (réunif A3d). L'overlay n'ajoute qu'un RAIL gauche : en-tête « Mode Données »
// + Quitter + recherche + liste. La VRAIE carte reste interactive dessous.
// Cliquer un lieu du rail = EXACTEMENT le même résultat qu'un clic carte ou une
// recherche topbar (vol + surlignage + vraie fiche de consultation dans la
// sidebar droite, via openDetailsPanel — aucune réimplémentation). La sidebar,
// masquée par défaut pour laisser le rail + la carte respirer, réapparaît
// seulement le temps qu'une fiche est ouverte (classe body .md-poi-open, cf.
// mode-donnees.css). Éditer reste un clic sur « Modifier » dans cette fiche,
// comme partout ailleurs dans l'app (modale RichEditor standard — plus de
// tiroir dédié, cf. mémoire feedback_two_poi_editors : un seul éditeur, pas de
// 2e surface qui drifte). Gated state.isAdmin.
//
// Filtres UNIFIÉS (A3d) : la liste suit les filtres de la topbar (panneau
// Filtres → eventBus 'data:filtered') ; pas de filtres propres au rail.
import L from 'leaflet';
import { map } from './map.js';
import { state } from './state.js';
import { getPoiId, getPoiName, getFilteredFeatures } from './data.js';
import { escapeXml, getPoiProp } from './utils.js';
import { foldForSearch } from './text-search.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { showToast } from './toast.js';
import { openDetailsPanel } from './ui-details.js';
import { eventBus } from './events.js';
import { getIconForFeature } from './poi-icons.js';

let _overlay = null;
let _items = [];        // POI affichés = features filtrées (topbar) triées par nom
let _search = '';
let _currentId = null;  // POI sélectionné
let _highlight = null;  // cercle de surlignage temporaire sur la carte
let _isOpen = false;
let _onEditorClosed = null; // handler window 'richEditor:closed' → rafraîchit la liste (méta à jour après édition)
let _onDetailsClosed = null; // handler eventBus 'details-panel:closed' → referme la fiche, revient au rail plein écran
let _onDataFiltered = null; // handler eventBus 'data:filtered' → resync sur filtres topbar

function buildItems() {
    // Filtres unifiés : on part du jeu DÉJÀ filtré par la topbar (catégorie /
    // zone / état de la fiche / parcours), trié par nom.
    return (getFilteredFeatures() || []).slice()
        .sort((a, b) => (getPoiName(a) || '').localeCompare(getPoiName(b) || '', 'fr'));
}

function visibleItems() {
    const s = foldForSearch(_search);
    if (!s) return _items;
    return _items.filter(f => foldForSearch(getPoiName(f)).includes(s));
}

function renderShell() {
    _overlay = document.createElement('div');
    _overlay.className = 'mode-donnees-overlay';
    _overlay.innerHTML = `
        <aside class="md-rail">
            <div class="md-rail-head">
                <span class="md-mode-badge"><i data-lucide="database"></i>Mode Données</span>
                <button class="md-quit" type="button" data-md-quit><i data-lucide="x"></i>Quitter</button>
            </div>
            <div class="md-rail-search">
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
    // Après une édition (modale RichEditor standard, cf. bouton « Modifier » de
    // la fiche), rafraîchir la liste (méta à jour : catégorie, badge Vérifié…).
    _onEditorClosed = () => renderList();
    window.addEventListener('richEditor:closed', _onEditorClosed);
    // La fiche a été refermée (bouton fermer de la sidebar) → revient au rail
    // plein écran, comme avant toute sélection.
    _onDetailsClosed = () => {
        document.body.classList.remove('md-poi-open');
        if (_highlight) { _highlight.remove(); _highlight = null; }
        _currentId = null;
        renderList();
        setTimeout(() => { try { map.invalidateSize(); } catch (e) {} }, 60);
    };
    eventBus.on('details-panel:closed', _onDetailsClosed);
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
            const name = escapeXml(getPoiName(f) || 'Lieu sans nom');
            // getPoiProp (overlay userData prioritaire) et non properties brut : une
            // catégorie recatégorisée / un POI dé-vérifié via l'overlay doit se refléter
            // ici. Le `||` de l'ancien `props.verified || userData?.verified` empêchait
            // un override `false` (base true) de retirer le badge → getPoiProp le gère.
            const cat = escapeXml(getPoiProp(f, 'Catégorie') || '—');
            const verif = getPoiProp(f, 'verified');
            const meta = `${verif ? '<span class="verif"><i data-lucide="badge-check"></i>Vérifié</span> · ' : ''}${cat}`;
            return `<div class="md-poi${id === _currentId ? ' is-current' : ''}" data-id="${escapeXml(id)}">
                <span class="md-poi-ic">${getIconForFeature(f)}</span>
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

// A3f : icône du surlignage = épingle (teardrop) aux couleurs de l'app. divIcon
// ancré (0,0) sur le point GPS ; le CSS (.md-pin) la remonte AU-DESSUS de l'icône
// du POI (ancrée bas-centre) → pas de décalage, et anime la chute + le rebond.
function buildHighlightIcon() {
    return L.divIcon({
        className: 'md-pin-highlight',
        iconSize: [0, 0],
        iconAnchor: [0, 0],
        html: `<div class="md-pin"><div class="md-pin-i">
            <svg width="34" height="46" viewBox="0 0 24 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M12 0C5.4 0 0 5.4 0 12c0 8.4 12 20 12 20s12-11.6 12-20C24 5.4 18.6 0 12 0z" fill="var(--brand)" stroke="#fff" stroke-width="2"/>
                <circle cx="12" cy="12" r="4.4" fill="#fff"/>
            </svg>
        </div></div>`,
    });
}

function selectPoi(id) {
    const f = _items.find(x => getPoiId(x) === id);
    if (!f || !f.geometry) return;
    const globalIndex = state.loadedFeatures.findIndex(x => getPoiId(x) === id);
    if (globalIndex === -1) return;
    _currentId = id;
    const [lon, lat] = f.geometry.coordinates;
    if (_highlight) { _highlight.remove(); _highlight = null; }
    // A3f : surlignage = épingle « qui tombe » (recréée à chaque sélection pour
    // rejouer l'animation). zIndexOffset → passe au-dessus des marqueurs voisins.
    _highlight = L.marker([lat, lon], {
        icon: buildHighlightIcon(), interactive: false, keyboard: false, zIndexOffset: 1000,
    }).addTo(map);
    // Même résultat qu'un clic carte (map.js handleMarkerClick) : la vraie
    // fiche de consultation, dans la vraie sidebar. .md-poi-open (CSS) la
    // laisse réapparaître le temps de la consultation — cf. tête de fichier.
    document.body.classList.add('md-poi-open');
    openDetailsPanel(globalIndex, null);
    // La sidebar vient d'apparaître (transition CSS #map) → resynchroniser
    // Leaflet AVANT le vol, sinon flyTo vise l'ancien centre (carte pleine largeur).
    setTimeout(() => {
        try { map.invalidateSize(); } catch (e) {}
        map.flyTo([lat, lon], Math.max(map.getZoom(), 16), { duration: 0.5 });
    }, 60);
    renderList(); // re-marque .is-current
}

function stopModeDonnees() {
    if (!_isOpen) return;
    if (_onEditorClosed) { window.removeEventListener('richEditor:closed', _onEditorClosed); _onEditorClosed = null; }
    if (_onDetailsClosed) { eventBus.off('details-panel:closed', _onDetailsClosed); _onDetailsClosed = null; }
    if (_onDataFiltered) { eventBus.off('data:filtered', _onDataFiltered); _onDataFiltered = null; }
    if (_highlight) { _highlight.remove(); _highlight = null; }
    if (_overlay && _overlay.parentNode) _overlay.parentNode.removeChild(_overlay);
    _overlay = null;
    // La fiche éventuellement ouverte reste affichée normalement dans la
    // sidebar après la sortie (comportement identique à une consultation en
    // navigation courante) : on ne la ferme pas, on retire juste le marqueur
    // .md-poi-open devenu inutile (mode-donnees-active seul suffit à ne plus
    // masquer la sidebar une fois la classe ci-dessous retirée).
    document.body.classList.remove('md-poi-open', 'mode-donnees-active');
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
