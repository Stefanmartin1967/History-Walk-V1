// mobile-poi.js
// Vue Onglet Circuit mobile (refonte PR 3 chantier design).
// Structure .cc-* : m-top + hero photo + identité (eyebrow + titre + flag)
// + description + toolbar 5 actions + timeline POIs.
// Le sticky bar bas Partager/GPX a disparu (actions absorbées par .cc-actions).

import { state } from './state.js';
import { getPoiId, getPoiName, updatePoiCoordinates, applyFilters } from './data.js';
import { getStepCategoryDisplay } from './poi-icons.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { escapeHtml, getZoneFromCoords, getOrthodromicDistance, getRealDistance, getPoiProp } from './utils.js';
import { openDetailsPanel } from './ui-details.js';
import { generateCircuitQR } from './ui-circuit-editor.js';
import { clearCircuit, isCircuitCompleted, isCircuitTested, loadCircuitById, openCircuitGallery } from './circuit.js';
import { handleCircuitVisitedToggle, setCircuitHidden } from './circuit-actions.js';
import { startFollow, circuitHasTrace } from './mobile-follow.js';
import { showToast } from './toast.js';
import { animateContainer, getCurrentView, getAllCircuitsOrdered, setMobileHeaderSlot, setMobileViewFooter } from './mobile-state.js';
import { switchMobileView } from './mobile-nav.js';
import { eventBus } from './events.js';
import { getPoiPhotos, getPendingAdminPhotos } from './database.js';

export function initMobilePoiListeners() {
    eventBus.on('mobile:update-poi-position', (poiId) => updatePoiPosition(poiId));
    eventBus.on('mobile:render-poi-list', (features) => renderMobilePoiList(features));
}

// Pastille catégorie d'étape : logique extraite vers poi-icons.js
// (getStepCategoryDisplay, 12/06/2026) pour être partagée avec la timeline
// PC (circuit-view.js).

// ─── Hero photo .cc-hero (mobile) ────────────────────────────────────────────
// Logique miroir d'applyCircuitHero (circuit.js, PC) mais opère sur l'élément
// .cc-hero rendu dynamiquement par mobile-poi. Parcourt les POIs du circuit,
// applique la 1re photo dispo (URL publiée OU blob local admin/user). Sur
// fallback (aucune photo nulle part), reste en .is-empty (motif topo + glyphe).
let activeMobileHeroObjectUrl = null;
function revokeMobileHeroObjectUrl() {
    if (activeMobileHeroObjectUrl) {
        URL.revokeObjectURL(activeMobileHeroObjectUrl);
        activeMobileHeroObjectUrl = null;
    }
}

async function applyMobileCircuitHero(hero, circuit, zoneName, etapeCount) {
    if (!hero || !circuit || circuit.length === 0) return;

    revokeMobileHeroObjectUrl();

    let heroUrl = null;
    let totalPhotoCount = 0;

    for (const poi of circuit) {
        const published = poi?.properties?.photos;
        if (Array.isArray(published) && published.length > 0) {
            totalPhotoCount += published.length;
            if (!heroUrl) heroUrl = published[0];
        }
    }

    const mapId = state.currentMapId;
    if (!heroUrl && mapId) {
        for (const poi of circuit) {
            const poiId = getPoiId(poi);
            if (!poiId) continue;
            const items = state.isAdmin
                ? await getPendingAdminPhotos(mapId, poiId)
                : await getPoiPhotos(mapId, poiId);
            // Sécurité re-render : si le hero n'est plus dans le DOM courant
            // (panel re-rendu pendant l'await), on abandonne silencieusement.
            if (!document.body.contains(hero)) return;
            if (items && items.length > 0 && items[0]?.blob) {
                activeMobileHeroObjectUrl = URL.createObjectURL(items[0].blob);
                heroUrl = activeMobileHeroObjectUrl;
                totalPhotoCount += items.length;
                break;
            }
        }
    }

    if (!heroUrl) return; // reste en .is-empty (glyphe + motif topo)

    hero.classList.remove('is-empty');
    hero.dataset.bg = 'true';

    // Hero cliquable → galerie agrégée du circuit (miroir PC). Le #mobile-cc-hero
    // est recréé à chaque rendu (container.innerHTML) et n'arrive ici que si une
    // photo existe → pas de branche « off » nécessaire (cas vide = reste is-empty).
    hero.classList.add('is-clickable');
    hero.setAttribute('role', 'button');
    hero.setAttribute('tabindex', '0');
    hero.setAttribute('aria-label', 'Voir les photos du circuit');
    hero.onclick = openCircuitGallery;
    hero.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCircuitGallery(); }
    };

    const safe = String(heroUrl).replace(/['"\\]/g, encodeURIComponent);
    hero.style.setProperty('--cc-hero-bg', `url("${safe}")`);
    // L'inline-style backgroundImage est crucial : sans lui les URL via var()
    // depuis la feuille CSS bundlée résolvent contre la feuille → 404 en prod
    // (cf. PR #554 sur le hero PC).
    hero.style.backgroundImage = `linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.45)), url("${safe}")`;

    hero.innerHTML = '';

    const badge = document.createElement('span');
    badge.className = 'cc-photo-count';
    badge.innerHTML = `<i data-lucide="image"></i>${totalPhotoCount} ${totalPhotoCount > 1 ? 'photos' : 'photo'}`;
    hero.appendChild(badge);

    const tags = document.createElement('div');
    tags.className = 'cc-hero-tags';
    let tagsHtml = '';
    if (zoneName) tagsHtml += `<span class="cc-pill"><i data-lucide="map-pin"></i>${escapeHtml(zoneName)}</span>`;
    tagsHtml += `<span class="cc-pill"><i data-lucide="route"></i>${etapeCount} étape${etapeCount > 1 ? 's' : ''}</span>`;
    tags.innerHTML = tagsHtml;
    hero.appendChild(tags);

    createIcons({ icons: appIcons, root: hero });
}

// ─── Navigation chevrons (prev/next circuit dans la liste ordonnée) ─────────
function navigateCircuit(direction) {
    const ordered = getAllCircuitsOrdered();
    const idx = ordered.findIndex(c => c.id === state.activeCircuitId);
    if (idx < 0) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= ordered.length) return;
    loadCircuitById(ordered[newIdx].id);
}

// ─── Liste des POIs (mode simple : pas de circuit chargé) ───────────────────
// Utilisé quand on arrive sur la liste POIs sans circuit (search results, etc.)
// Garde l'ancienne structure mobile-poi-* allégée.
function renderSimplePoiList(container, listToDisplay) {
    container.innerHTML = '';
    animateContainer(container);

    const viewFooter = document.getElementById('mobile-view-footer');
    if (viewFooter) viewFooter.innerHTML = '';

    const headerHtml = `
        <div class="m-top">
            <div class="m-top-trail"></div>
            <div class="m-top-title">Lieux</div>
            <div class="m-top-trail"></div>
        </div>
    `;
    setMobileHeaderSlot(headerHtml);

    let listHtml = '';
    listToDisplay.forEach(feature => {
        const name = getPoiName(feature);
        const poiId = getPoiId(feature);
        const cat = getStepCategoryDisplay(feature);
        const isVisited = getPoiProp(feature, 'vu');
        listHtml += `
            <a class="cc-step ${isVisited ? 'is-done' : ''}" data-poi-id="${poiId}" href="#">
                <div class="cc-step-num">${isVisited ? '<i data-lucide="check"></i>' : '<i data-lucide="map-pin"></i>'}</div>
                <div class="cc-step-body">
                    <div class="cc-step-name">${escapeHtml(name)}</div>
                    <span class="cc-step-cat ${cat.variant}">${cat.iconHtml}${escapeHtml(cat.label)}</span>
                </div>
                <span class="cc-step-chev"><i data-lucide="chevron-right"></i></span>
            </a>
        `;
    });
    container.innerHTML = `<div class="mobile-list-container cc-timeline-wrap">${listHtml}</div>`;

    createIcons({ icons: appIcons, root: container });
    const headerSlot = document.getElementById('mobile-header-slot');
    if (headerSlot) createIcons({ icons: appIcons, root: headerSlot });

    container.querySelectorAll('.cc-step').forEach(step => {
        step.addEventListener('click', (e) => {
            e.preventDefault();
            const poiId = step.dataset.poiId;
            const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
            const index = state.loadedFeatures.indexOf(feature);
            if (index > -1) openDetailsPanel(index);
        });
    });
}

// ─── Vue Circuit (cible PC-02) ─────────────────────────────────────────────
function renderCircuitView(container, listToDisplay) {
    const circuit = state.myCircuits.find(c => c.id === state.activeCircuitId)
        || state.officialCircuits?.find(c => c.id === state.activeCircuitId);
    if (!circuit) {
        renderSimplePoiList(container, listToDisplay);
        return;
    }

    const title = (circuit.name || '').replace(/^(Circuit de |Boucle de )/i, '');
    const fullName = circuit.name || 'Circuit';
    const description = circuit.description || 'Circuit généré par Heripia — heripia.com';
    const isCompleted = isCircuitCompleted(circuit);
    const isTested = circuit.isOfficial && isCircuitTested(circuit.id);
    const flag = circuit.isOfficial
        ? (isTested ? 'verified' : 'official')
        : 'none';
    const flagText = flag === 'verified' ? 'OFFICIEL · VÉRIFIÉ'
                  : flag === 'official' ? 'OFFICIEL'
                  : '';

    // Métadonnées eyebrow (zone, POIs, km)
    let zoneName = '';
    const firstPoi = listToDisplay[0] || state.currentCircuit[0];
    if (firstPoi?.geometry?.coordinates) {
        const [lng, lat] = firstPoi.geometry.coordinates;
        zoneName = getZoneFromCoords(lat, lng) || '';
    }
    const poiCount = listToDisplay.length || state.currentCircuit.length;
    let totalDistance;
    if (circuit.realTrack) totalDistance = getRealDistance(circuit);
    else totalDistance = getOrthodromicDistance(state.currentCircuit);
    const kmDisplay = (totalDistance / 1000).toFixed(1);

    // D+ (dénivelé positif) BRouter si stocké pour ce circuit (tracé in-app).
    // null ou 0 → non affiché (miroir PC).
    const ascendM = (Number.isFinite(circuit.ascend) && circuit.ascend > 0) ? circuit.ascend : null;
    const denivHtml = ascendM ? `<span class="sep">·</span><span>D+ ${ascendM} M</span>` : '';

    // Position dans la liste ordonnée (pour chevrons « < n/total > »)
    const ordered = getAllCircuitsOrdered();
    const idx = ordered.findIndex(c => c.id === state.activeCircuitId);
    const hasPager = idx >= 0 && ordered.length > 1;
    const pagerHtml = hasPager ? `
        <span class="sep">·</span>
        <span class="cc-pager in-eyebrow">
            <button class="cc-pager-btn" id="cc-pager-prev" aria-label="Circuit précédent"${idx <= 0 ? ' disabled' : ''}>
                <i data-lucide="chevron-left"></i>
            </button>
            <span class="cc-pager-pos">${idx + 1}/${ordered.length}</span>
            <button class="cc-pager-btn" id="cc-pager-next" aria-label="Circuit suivant"${idx >= ordered.length - 1 ? ' disabled' : ''}>
                <i data-lucide="chevron-right"></i>
            </button>
        </span>
    ` : '';

    // Header : croix « Fermer » à droite (convention overlay : close haut-droite),
    // trail à gauche, titre centré. Le bouton fait clearCircuit + retour à
    // Mes Circuits (équivalent du « back » mais avec un X — alignement design PC).
    const headerHtml = `
        <div class="m-top">
            <div class="m-top-trail"></div>
            <div class="m-top-title">${escapeHtml(title)}</div>
            <button class="m-top-back" id="mobile-cc-close" aria-label="Fermer"><i data-lucide="x"></i></button>
        </div>
    `;
    setMobileHeaderSlot(headerHtml);

    // GPX : seulement pour les officiels (qui ont un fichier .gpx).
    const gpxFile = state.officialCircuits?.find(c => c.id === circuit.id)?.file;
    const gpxBtnHtml = gpxFile
        ? `<a class="cc-act" id="cc-act-gpx" href="./circuits/${gpxFile}" download aria-label="Télécharger GPX" title="Télécharger GPX"><i data-lucide="download"></i></a>`
        : `<button class="cc-act" disabled aria-label="GPX non disponible" title="GPX non disponible pour les circuits perso"><i data-lucide="download"></i></button>`;

    const isHidden = (state.hiddenCircuitIds || []).includes(String(circuit.id));

    // Steps timeline
    let stepsHtml = '';
    listToDisplay.forEach((feature, i) => {
        const name = getPoiName(feature);
        const poiId = getPoiId(feature);
        const cat = getStepCategoryDisplay(feature);
        const isVisited = getPoiProp(feature, 'vu');
        stepsHtml += `
            <a class="cc-step ${isVisited ? 'is-done' : ''}" data-poi-id="${poiId}" href="#">
                <div class="cc-step-num">${isVisited ? '<i data-lucide="check"></i>' : (i + 1)}</div>
                <div class="cc-step-body">
                    <div class="cc-step-name">${escapeHtml(name)}</div>
                    <span class="cc-step-cat ${cat.variant}">${cat.iconHtml}${escapeHtml(cat.label)}</span>
                </div>
                <span class="cc-step-chev"><i data-lucide="chevron-right"></i></span>
            </a>
        `;
    });

    // Body : hero + ident + desc + actions + timeline
    container.innerHTML = `
        <div class="cc-hero is-empty" id="mobile-cc-hero">
            <div class="cc-hero-glyph"><i data-lucide="route"></i></div>
        </div>
        <div class="cc-ident">
            <div class="cc-eyebrow">
                ${zoneName ? `<span>${escapeHtml(zoneName.toUpperCase())}</span><span class="sep">·</span>` : ''}
                <span>${poiCount} POIS</span><span class="sep">·</span>
                <span>${kmDisplay} KM</span>
                ${denivHtml}
                ${pagerHtml}
            </div>
            <h1 class="cc-title">${escapeHtml(fullName)}</h1>
            ${flagText ? `<span class="cc-flag" data-flag="${flag}"><span class="dot"></span>${flagText}</span>` : ''}
        </div>
        <div class="cc-desc">
            <p class="cc-desc-text">${escapeHtml(description)}</p>
        </div>
        ${circuitHasTrace(circuit) ? `
        <div class="suivre-wrap">
            <button class="btn-suivre" id="btn-suivre-circuit" type="button">
                <i data-lucide="navigation"></i> Suivre ce circuit
            </button>
        </div>
        ` : `
        <div class="no-trace">
            <i data-lucide="info"></i>
            <span>Pas de trace GPS pour ce circuit — le suivi en marchant n'est pas disponible.</span>
        </div>
        `}
        <div class="cc-actions">
            <button class="cc-act" id="cc-act-share" aria-label="Partager le circuit" title="Partager le circuit">
                <i data-lucide="qr-code"></i>
            </button>
            ${gpxBtnHtml}
            <button class="cc-act ${isCompleted ? 'is-done' : ''}" id="cc-act-done" aria-label="Marquer comme fait" title="${isCompleted ? 'Décocher fait' : 'Marquer comme fait'}">
                <i data-lucide="${isCompleted ? 'check-circle' : 'circle'}"></i>
            </button>
            <button class="cc-act ${isHidden ? 'is-hidden-circuit' : ''}" id="cc-act-hide" aria-label="${isHidden ? 'Réafficher ce circuit' : 'Cacher ce circuit'}" title="${isHidden ? 'Réafficher ce circuit' : 'Cacher ce circuit'}">
                <i data-lucide="${isHidden ? 'eye' : 'eye-off'}"></i>
            </button>
        </div>
        <div class="cc-timeline-wrap">
            <div class="cc-timeline-cap">
                <span>ÉTAPES</span>
                <span>${poiCount} POIS</span>
            </div>
            ${stepsHtml}
        </div>
    `;

    // View-footer vidé : le dock reste visible (pas de sticky bar dans cette refonte).
    const viewFooter = document.getElementById('mobile-view-footer');
    if (viewFooter) viewFooter.innerHTML = '';

    // Hero photo (async, fire-and-forget)
    const hero = document.getElementById('mobile-cc-hero');
    applyMobileCircuitHero(hero, state.currentCircuit, zoneName, poiCount);

    // Icons
    createIcons({ icons: appIcons, root: container });
    const headerSlot = document.getElementById('mobile-header-slot');
    if (headerSlot) createIcons({ icons: appIcons, root: headerSlot });

    // ─── Event listeners ─────────────────────────────────────────────────
    document.getElementById('mobile-cc-close')?.addEventListener('click', () => {
        try {
            clearCircuit(false);
            switchMobileView('circuits');
        } catch (e) {
            console.error('Erreur bouton Fermer onglet Circuit:', e);
        }
    });

    document.getElementById('cc-pager-prev')?.addEventListener('click', () => navigateCircuit(-1));
    document.getElementById('cc-pager-next')?.addEventListener('click', () => navigateCircuit(1));

    document.getElementById('btn-suivre-circuit')?.addEventListener('click', () => {
        startFollow();
    });

    document.getElementById('cc-act-share')?.addEventListener('click', async () => {
        await generateCircuitQR();
    });

    document.getElementById('cc-act-done')?.addEventListener('click', async () => {
        const result = await handleCircuitVisitedToggle(circuit.id, isCompleted);
        if (result?.success !== false) renderMobilePoiList(listToDisplay);
    });

    document.getElementById('cc-act-hide')?.addEventListener('click', async () => {
        const wasHidden = (state.hiddenCircuitIds || []).includes(String(circuit.id));
        await setCircuitHidden(circuit.id, !wasHidden);
        if (wasHidden) {
            showToast('Circuit réaffiché dans la liste.', 'success', 2500);
        } else {
            showToast(`« ${fullName} » caché de la liste.`, 'success', 5000, {
                label: 'Annuler',
                onClick: () => setCircuitHidden(circuit.id, false)
            });
        }
        renderMobilePoiList(listToDisplay);
    });

    container.querySelectorAll('.cc-step').forEach(step => {
        step.addEventListener('click', (e) => {
            e.preventDefault();
            const poiId = step.dataset.poiId;
            const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
            const index = state.loadedFeatures.indexOf(feature);
            if (index > -1) openDetailsPanel(index);
        });
    });
}

// ─── Entry point ─────────────────────────────────────────────────────────────
export function renderMobilePoiList(features) {
    if (getCurrentView() === 'circuits') return;

    const listToDisplay = features || [];
    const container = document.getElementById('mobile-main-container');
    if (!container) return;

    const isCircuit = state.activeCircuitId !== null;

    if (isCircuit) {
        renderCircuitView(container, listToDisplay);
    } else {
        renderSimplePoiList(container, listToDisplay);
    }
}

// ─── Mise à jour position GPS d'un POI ───────────────────────────────────────
export function updatePoiPosition(poiId) {
    if (!navigator.geolocation) return showToast("GPS non supporté", "error");

    const feature = state.loadedFeatures.find(f => getPoiId(f) === poiId);
    if (!feature) return showToast("POI introuvable", "error");
    const [prevLng, prevLat] = feature.geometry.coordinates;

    navigator.geolocation.getCurrentPosition(
        async (pos) => {
            const { latitude, longitude } = pos.coords;
            await updatePoiCoordinates(poiId, latitude, longitude);
            applyFilters();
            showToast(
                `Position mise à jour : ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
                'success',
                8000,
                {
                    label: 'Annuler',
                    onClick: async () => {
                        await updatePoiCoordinates(poiId, prevLat, prevLng);
                        applyFilters();
                        showToast('Position restaurée.', 'info');
                    }
                }
            );
        },
        (err) => showToast("Erreur GPS : " + err.message, "error"),
        { enableHighAccuracy: true, timeout: 10000 }
    );
}
