import { state, MAX_CIRCUIT_POINTS, addPoiToCurrentCircuit, resetCurrentCircuit, addMyCircuit, updateMyCircuit, setTestedCircuits, setActiveCircuitId, setTestedCircuit, setOfficialCircuitStatus, setCustomDraftName, setCurrentFeatureId, setCurrentCircuitIndex, setCurrentCircuit, setEditingMode, setCircuitCreationMode } from './state.js';
import { fetchWithTimeout } from './net.js';
import { DOM } from './ui-dom.js';
import { openDetailsPanel, collectPoiPhotoUrls } from './ui-details.js';
import { switchSidebarTab } from './ui-sidebar.js';
import { getPoiId, getPoiName, applyFilters, recomputeVu } from './data.js';
import { getRealDistance, getOrthodromicDistance, getZoneFromCoords, getPoiProp } from './utils.js';
import { getAppState, saveAppState, saveCircuit, batchSavePoiData, getPoiPhotos, getPendingAdminPhotos } from './database.js';
import { isMobileView } from './mobile-state.js';
import * as View from './circuit-view.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { showToast } from './toast.js';
import { showConfirm } from './modal.js';
import { eventBus } from './events.js';
import { pushToGist } from './gist-sync.js';
import { schedulePushTestedToGitHub } from './tested-sync.js';
// Import statique : pose le listener window 'circuit:updated' dès le boot pour
// synchroniser les drapeaux d'accès en mode création/édition (PR 4/5 chantier
// drapeaux v2), ET expose markEditingStart pour l'appeler SYNCHRONIQUEMENT à
// l'entrée en édition. L'ancien import dynamique exécutait markEditingStart en
// microtask, APRÈS notifyCircuitChanged (rendu des drapeaux) → snapshot cadenas
// trop tard, drapeaux des POI préexistants non verrouillés (fix v3.7.308).
import { markEditingStart } from './circuit-flags.js';

export function isCircuitTested(circuitId) {
    return state.testedCircuits[String(circuitId)] === true;
}

// Le statut "testé/vérifié" d'un circuit officiel est désormais dérivé
// automatiquement du "coché fait" par l'admin (cf. setCircuitVisitedState).
// Publication via Control Center → tous les users voient le bouclier vert.

export function isCircuitCompleted(circuit) {
    if (!circuit) return false;
    if (circuit.isOfficial) {
        // Pour les officiels, on regarde dans la carte d'état chargée
        return state.officialCircuitsStatus[circuit.id] === true;
    } else {
        // Pour les locaux, c'est une propriété directe
        return circuit.isCompleted === true;
    }
}

// --- LE CHEF D'ORCHESTRE (Traducteur pour la carte) ---
export function notifyCircuitChanged() {
    const event = new CustomEvent('circuit:updated', {
        detail: {
            points: state.currentCircuit,
            activeId: state.activeCircuitId
        }
    });
    window.dispatchEvent(event);
}

// --- FONCTION CORRIGÉE ---
export async function setCircuitVisitedState(circuitId, isVisited) {
    // Sanitization: Ensure ID is a string to match state structure
    circuitId = String(circuitId);

    // 1. Recherche du circuit (Local ou Officiel)
    let localCircuit = state.myCircuits.find(c => c.id === circuitId);
    let officialCircuit = state.officialCircuits ? state.officialCircuits.find(c => c.id === circuitId) : null;

    if (!localCircuit && !officialCircuit) return;

    // 2. Mise à jour de l'état (Mémoire & Persistance)
    try {
        // CORRECTION : Si un circuit est officiel (même s'il a un Shadow local),
        // on DOIT mettre à jour le statut officiel car c'est lui qui est lu par la liste Explorer.
        if (officialCircuit) {
            setOfficialCircuitStatus(circuitId, isVisited);
            officialCircuit.isCompleted = isVisited; // Maj en mémoire pour UI immédiate
            await saveAppState(`official_circuits_status_${state.currentMapId}`, state.officialCircuitsStatus);

            // Admin : "coché fait" = circuit vérifié.
            // Règle métier : si l'admin l'a fait, il est testé → rassure l'utilisateur lambda.
            // Auto-publish : on push tested_{mapId}.json directement sur GitHub
            // (debounced 2s) afin que les users publics voient le bouclier vert
            // immédiatement, sans attendre un clic "Tout publier" via le CC.
            // Le filet de sécurité du CC reste actif si l'auto-push échoue.
            if (state.isAdmin) {
                setTestedCircuit(circuitId, isVisited);
                await saveAppState(`tested_circuits_${state.currentMapId}`, state.testedCircuits);
                schedulePushTestedToGitHub();
            }
        }

        // Si on a (aussi ou uniquement) une copie locale (Shadow), on la met à jour aussi pour la cohérence
        if (localCircuit) {
            localCircuit.isCompleted = isVisited;
            await saveCircuit(localCircuit);
        }

        const name = (officialCircuit || localCircuit).name;

    } catch (error) {
        console.error("Erreur de sauvegarde statut circuit :", error);
        showToast("Erreur lors de la sauvegarde du statut", "error");
        return;
    }

    // 3. Mise à jour des POIs (contribution du circuit à l'état visité)
    // Modèle : chaque POI garde `visitedByCircuits` (liste des circuits qui le marquent).
    // `vu` est dérivé = vuManual || visitedByCircuits.length > 0.
    // Cocher "Fait"   → ajoute circuitId à visitedByCircuits
    // Décocher "Fait" → retire circuitId ; si plus aucun circuit et pas de vuManual, le POI redevient non-visité.
    const circuit = officialCircuit || localCircuit;
    if (circuit && circuit.poiIds && circuit.poiIds.length > 0) {
        const updates = [];
        circuit.poiIds.forEach(id => {
            const feature = state.loadedFeatures.find(f => getPoiId(f) === id);
            if (feature) {
                if (!feature.properties.userData) feature.properties.userData = {};
                const ud = feature.properties.userData;
                if (!Array.isArray(ud.visitedByCircuits)) ud.visitedByCircuits = [];

                if (isVisited) {
                    if (!ud.visitedByCircuits.includes(circuitId)) {
                        ud.visitedByCircuits.push(circuitId);
                    }
                } else {
                    ud.visitedByCircuits = ud.visitedByCircuits.filter(cid => cid !== circuitId);
                }
                recomputeVu(ud);

                // Mémoire state.userData (source de vérité pour updatePoiData et Gist)
                state.userData[id] = ud;

                updates.push({ poiId: id, data: ud });
            }
        });

        if (updates.length > 0) {
            try {
                await batchSavePoiData(state.currentMapId, updates);
                // Refresh des marqueurs (couleur peut changer dans les 2 sens)
                import('./data.js').then(({ applyFilters }) => applyFilters())
                    .catch(e => console.warn('[circuit] import data.js échoué (déploiement en cours ?) :', e));
                // Push Gist (événement important)
                pushToGist();
            } catch (e) {
                console.error("Erreur mise à jour POIs du circuit:", e);
            }
        }
    }

    // 4. Mise à jour de l'interface
    // Si c'est le circuit actif affiché sur la carte, on doit redessiner la ligne (couleur change)
    if (state.activeCircuitId === circuitId) {
        notifyCircuitChanged();
    }

    // On notifie tout le monde que la liste a changé (pour mettre à jour la coche dans l'explorer)
    eventBus.emit('circuit:list-updated');
}


export async function saveCircuitDraft() {
    if (!state.currentMapId) return;
    try {
        // Petit helper local pour lire une valeur sans crasher si l'élément manque
        const getVal = (id) => {
            const el = document.getElementById(id);
            return el ? el.value : '';
        };

        const circuitData = {
            poiIds: state.currentCircuit.map(getPoiId).filter(Boolean),
            customDraftName: state.customDraftName,
            // On vérifie aussi DOM.circuitDescription au cas où
            description: DOM.circuitDescription ? DOM.circuitDescription.value : '',
            transport: {
                allerTemps: getVal('transport-aller-temps'),
                allerCout: getVal('transport-aller-cout'),
                retourTemps: getVal('transport-retour-temps'),
                retourCout: getVal('transport-retour-cout')
            }
        };
        await saveAppState(`circuitDraft_${state.currentMapId}`, circuitData);
    } catch (error) {
        console.error("Erreur lors de la sauvegarde du brouillon:", error);
    }
}

export async function loadCircuitDraft() {
    if (!state.currentMapId || state.loadedFeatures.length === 0) return;
    try {
        const savedData = await getAppState(`circuitDraft_${state.currentMapId}`);
        if (savedData && Array.isArray(savedData.poiIds) && savedData.poiIds.length > 0) {
            setCurrentCircuit(savedData.poiIds.map(id => state.loadedFeatures.find(feature => getPoiId(feature) === id)).filter(Boolean));
            setCustomDraftName(savedData.customDraftName || null);

            if (DOM.circuitTitleText) {
                DOM.circuitTitleText.textContent = state.customDraftName || generateCircuitName();
            }

            if (DOM.circuitDescription) DOM.circuitDescription.value = savedData.description || '';

            const tAllerTemps = document.getElementById('transport-aller-temps');
            if (tAllerTemps && savedData.transport) {
                tAllerTemps.value = savedData.transport.allerTemps || '';
                document.getElementById('transport-aller-cout').value = savedData.transport.allerCout || '';
                document.getElementById('transport-retour-temps').value = savedData.transport.retourTemps || '';
                document.getElementById('transport-retour-cout').value = savedData.transport.retourCout || '';
            }

            if (state.currentCircuit.length > 0) {
                // Reprise d'un brouillon en cours → on s'assure d'être en mode
                // création (usage légitime du drapeau, rename PR2).
                if (!state.isCircuitCreationMode) {
                    eventBus.emit('circuit:toggle-selection-mode', {});
                } else {
                    renderCircuitPanel();
                }
            }
        }
    } catch (e) {
        console.error("Erreur lors du chargement du brouillon sauvegardé:", e);
        await saveAppState(`circuitDraft_${state.currentMapId}`, null);
    }
}

// --- FONCTION POUR AJOUTER UN POINT (La version robuste) ---
// circuit.js

export function addPoiToCircuit(feature) {
    // 1. Sécurité : circuit chargé en lecture seule.
    // Exception : admin en mode édition (state.editingMode === true).
    if (state.activeCircuitId && !state.editingMode) {
        showToast("Mode lecture seule. Cliquez sur 'Modifier' pour changer ce circuit.", "info");
        return false;
    }
    
    // 2. Sécurités habituelles
    if (state.currentCircuit.length > 0 && getPoiId(feature) === getPoiId(state.currentCircuit[state.currentCircuit.length - 1])) return false;
    if (state.currentCircuit.length >= MAX_CIRCUIT_POINTS) {
        showToast(`Maximum de ${MAX_CIRCUIT_POINTS} points atteint.`, 'warning');
        return false;
    }

    // 3. Ajout normal (Mode Brouillon)
    addPoiToCurrentCircuit(feature);
    saveAppState('currentCircuit', state.currentCircuit);
    saveCircuitDraft(); // On met à jour le brouillon complet (avec description vide ou existante)
    renderCircuitPanel(); 
    notifyCircuitChanged();
    return true;
}

// circuit.js (extrait)
// ─── Hero photo du panneau Circuit (PC) ─────────────────────────────────────
// Cherche la première photo dispo parmi les POIs du circuit (URL publiée ou
// blob local admin/user) et l'applique en background du .circuit-cover, avec
// badge compteur + pills (zone + nb étapes). Fallback motif topo + icône si
// aucun POI n'a de photo.
let activeCoverObjectUrl = null;

function revokeCoverObjectUrl() {
    if (activeCoverObjectUrl) {
        URL.revokeObjectURL(activeCoverObjectUrl);
        activeCoverObjectUrl = null;
    }
}

// Galerie agrégée du circuit : toutes les photos de tous les POIs, dans l'ordre
// des étapes. Réutilise collectPoiPhotoUrls (même collecte publiées/draft/blobs
// que le viewer d'un POI), concatène, puis ouvre le viewer plein écran. Les
// objectURL des blobs sont révoqués à la fermeture (revoke de chaque POI).
// Exportée : réutilisée par le hero de l'onglet Circuit mobile (mobile-poi.js).
export async function openCircuitGallery() {
    const circuit = state.currentCircuit;
    if (!circuit || circuit.length === 0) return;

    const allUrls = [];
    const revokers = [];
    for (const poi of circuit) {
        const poiId = getPoiId(poi);
        if (!poiId) continue;
        const { urls, revoke } = await collectPoiPhotoUrls(poiId);
        if (urls.length) allUrls.push(...urls);
        revokers.push(revoke);
    }
    const revokeAll = () => revokers.forEach(r => r());
    if (allUrls.length === 0) { revokeAll(); return; }

    const { openPhotoViewer } = await import('./ui-photo-viewer.js');
    openPhotoViewer(allUrls, 0).finally(revokeAll);
}

// Active/désactive l'affordance « cliquer le cover → galerie ». Idempotent
// (onclick/onkeydown sont des propriétés, pas d'empilement de listeners au
// re-render). Désactivé quand le cover est vide (aucune photo).
function setCoverClickable(cover, on) {
    if (on) {
        cover.classList.add('is-clickable');
        cover.setAttribute('role', 'button');
        cover.setAttribute('tabindex', '0');
        cover.setAttribute('aria-label', 'Voir les photos du circuit');
        cover.onclick = openCircuitGallery;
        cover.onkeydown = (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCircuitGallery(); }
        };
    } else {
        cover.classList.remove('is-clickable');
        cover.removeAttribute('role');
        cover.removeAttribute('tabindex');
        cover.removeAttribute('aria-label');
        cover.onclick = null;
        cover.onkeydown = null;
    }
}

async function applyCircuitHero() {
    const cover = document.getElementById('circuit-cover');
    if (!cover) return;

    revokeCoverObjectUrl();
    cover.innerHTML = '';
    cover.style.removeProperty('--circuit-hero-bg');
    cover.style.backgroundImage = '';
    delete cover.dataset.bg;
    cover.classList.add('is-empty');
    setCoverClickable(cover, false);

    const circuit = state.currentCircuit;

    // Cover sans photo : plaque de papier gravé (façon hero de fiche POI) +
    // libellé. La métadonnée (zone · étapes · km) vit dans le cartel sous la
    // photo (eyebrow), pas en doublon ici — décision Option A (redondance).
    const renderEmptyCover = (label) => {
        cover.innerHTML =
            `<div class="empty-plate"><div class="empty-icon"><i data-lucide="route"></i></div>`
            + `<div class="empty-label">${label}</div></div>`;
        createIcons({ icons: appIcons, root: cover });
    };

    if (!circuit || circuit.length === 0) {
        renderEmptyCover('Aucune étape');
        return;
    }

    let heroUrl = null;
    let totalPhotoCount = 0;

    // Passe 1 : photos (getPoiProp = overlay userData prioritaire). Compte aussi le
    // total. Lire properties.photos brut ratait les photos curées via l'overlay
    // (ajout par URL au CC) tant que le geojson n'était pas republié+rechargé.
    for (const poi of circuit) {
        const published = getPoiProp(poi, 'photos');
        if (Array.isArray(published) && published.length > 0) {
            totalPhotoCount += published.length;
            if (!heroUrl) heroUrl = published[0];
        }
    }

    // Passe 2 : fallback blob local (seulement si aucune URL publiée trouvée).
    const mapId = state.currentMapId;
    if (!heroUrl && mapId) {
        for (const poi of circuit) {
            const poiId = getPoiId(poi);
            if (!poiId) continue;
            const items = state.isAdmin
                ? await getPendingAdminPhotos(mapId, poiId)
                : await getPoiPhotos(mapId, poiId);
            if (items && items.length > 0 && items[0]?.blob) {
                // Le panel a pu être re-rendu pendant l'await : si le cover
                // n'est plus dans le DOM courant ou si state.currentCircuit
                // a changé, on abandonne silencieusement.
                if (document.getElementById('circuit-cover') !== cover) return;
                if (state.currentCircuit !== circuit) return;
                activeCoverObjectUrl = URL.createObjectURL(items[0].blob);
                heroUrl = activeCoverObjectUrl;
                totalPhotoCount += items.length;
                break;
            }
        }
    }

    if (!heroUrl) {
        renderEmptyCover('Ajouter une photo');
        return;
    }

    // Photo trouvée : applique le background + badge compteur (« N photos »).
    // La zone/le nombre d'étapes ne sont PAS répétés ici (cartel/eyebrow dessous).
    // On set à la fois la CSS var (lisibilité/debug) ET le backgroundImage en
    // inline-style. Le backgroundImage inline est ce qui est utilisé par le
    // rendu : les URL en inline-style sont résolues contre le document, alors
    // qu'en passant par var() depuis une feuille CSS bundlée (assets/main-HASH.css)
    // le navigateur résout l'URL contre la feuille → `assets/photos/…` 404.
    // Même pattern que applyHeroBackground() de ui-details.js pour le POI hero.
    cover.classList.remove('is-empty');
    cover.dataset.bg = 'true';
    setCoverClickable(cover, true);
    const safe = String(heroUrl).replace(/['"\\]/g, encodeURIComponent);
    cover.style.setProperty('--circuit-hero-bg', `url("${safe}")`);
    cover.style.backgroundImage = `linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.35)), url("${safe}")`;

    const badge = document.createElement('span');
    badge.className = 'cartel-hero-count';
    badge.innerHTML = `<span class="cartel-chip cartel-chip--muted"><i data-lucide="image"></i>${totalPhotoCount} ${totalPhotoCount > 1 ? 'photos' : 'photo'}</span>`;
    cover.appendChild(badge);

    createIcons({ icons: appIcons, root: cover });
}

// circuit.js
export function renderCircuitPanel() {
    const points = state.currentCircuit;

    // Détermine si le circuit est officiel (pour masquer les actions d'édition)
    const isOfficial = state.officialCircuits && state.activeCircuitId
        ? state.officialCircuits.some(c => c.id === state.activeCircuitId)
        : false;

    View.renderCircuitList(points, {
        onAction: (action, index) => handleCircuitAction(action, index),
        onDetails: (feature, index) => {
            const featureId = state.loadedFeatures.indexOf(feature);
            openDetailsPanel(featureId, index);
        },
        // Drag-reorder Sortable.js (circuit-view.js:initTimelineDrag) appelle
        // ce callback à la fin du drop, après que state.currentCircuit a été
        // réordonné. Évite à circuit-view de réimporter dynamiquement circuit.js
        // (source du cycle madge fermé).
        onReorder: async () => {
            await saveCircuitDraft();
            renderCircuitPanel();
        },
    }, isOfficial);

    // On met à jour les boutons
    View.updateControlButtons({
        cannotLoop: points.length === 0 || points.length >= MAX_CIRCUIT_POINTS,
        isEmpty: points.length === 0,
        isActive: !!state.activeCircuitId // On passe l'info si un circuit est chargé
    });

    updateCircuitMetadata();
    notifyCircuitChanged(); // Cette fonction va maintenant choisir la bonne ligne !

    // Hero photo du circuit (PR 1 chantier mobile design — feature transverse
    // PC + mobile). Fire-and-forget : la fonction await en interne, le DOM est
    // mis à jour quand la photo (publiée ou blob) est trouvée.
    applyCircuitHero();
}

export function updateCircuitMetadata(updateTitle = true) {
    // 1. LOGIQUE DE CALCUL (On récupère ce qui était dans ton ancienne fonction)
    let totalDistance = 0;
    let isRealTrack = false;

    const activeCircuitData = state.myCircuits.find(c => c.id === state.activeCircuitId);

    if (activeCircuitData && activeCircuitData.realTrack) {
        totalDistance = getRealDistance(activeCircuitData);
        isRealTrack = true;
    } else {
        totalDistance = getOrthodromicDistance(state.currentCircuit);
    }

    // Priorité : Titre sauvegardé > Titre personnalisé brouillon > Génération auto.
    // En mode édition admin (state.editingMode), on regénère le titre dynamiquement
    // à partir des POIs courants — Q2 décision Stefan 03/05/2026 : "On reset au nom auto".
    let title = state.customDraftName || generateCircuitName();
    if (activeCircuitData && activeCircuitData.name && !activeCircuitData.name.startsWith("Nouveau Circuit") && !state.editingMode) {
        title = activeCircuitData.name;
    }

    // Détermine si le circuit actif est officiel et testé (pour le badge desktop)
    const isOfficialActive = state.officialCircuits && state.activeCircuitId
        ? state.officialCircuits.some(c => c.id === state.activeCircuitId)
        : false;
    const isTestedActive = isOfficialActive ? isCircuitTested(state.activeCircuitId) : false;

    // V2 : zone calculée depuis le 1er POI (pour le breadcrumb)
    let zoneName = '';
    if (state.currentCircuit.length > 0) {
        const firstPoi = state.currentCircuit[0];
        const coords = firstPoi?.geometry?.coordinates;
        if (coords && coords.length >= 2) {
            const [lng, lat] = coords;
            zoneName = getZoneFromCoords(lat, lng) || '';
        }
    }

    // V2 : description du circuit actif (consultation) ou du brouillon (création)
    let description = '';
    if (activeCircuitData && activeCircuitData.description) {
        description = activeCircuitData.description;
    } else if (DOM.circuitDescription && DOM.circuitDescription.value) {
        description = DOM.circuitDescription.value;
    }

    // D+ (dénivelé positif) BRouter du circuit actif, si stocké (tracé in-app).
    // Cherché dans myCircuits ET officialCircuits (un officiel tracé par l'admin
    // le porte aussi). null ou 0 → non affiché.
    const activeAny = activeCircuitData
        || (state.officialCircuits || []).find(c => c.id === state.activeCircuitId);
    const ascend = (activeAny && Number.isFinite(activeAny.ascend) && activeAny.ascend > 0)
        ? activeAny.ascend : null;

    // 2. ENVOI À LA VUE (On ne touche plus au DOM ici)
    View.updateCircuitHeader({
        countText: `${state.currentCircuit.length}/${MAX_CIRCUIT_POINTS}`,
        distanceText: (totalDistance / 1000).toFixed(1) + ' km',
        title: title,
        iconType: isRealTrack ? 'footprints' : 'bird',
        iconTitle: isRealTrack ? 'Distance du tracé réel' : "Distance à vol d'oiseau",
        isOfficial: isOfficialActive,
        isTested: isTestedActive,
        circuitId: state.activeCircuitId,
        // V2
        zoneName,
        description,
        isRealTrack,
        ascend,
    });
}

function handleCircuitAction(action, index) {
    if (action === 'up' && index > 0) {
        [state.currentCircuit[index], state.currentCircuit[index - 1]] = [state.currentCircuit[index - 1], state.currentCircuit[index]];
    } else if (action === 'down' && index < state.currentCircuit.length - 1) {
        [state.currentCircuit[index], state.currentCircuit[index + 1]] = [state.currentCircuit[index + 1], state.currentCircuit[index]];
    } else if (action === 'remove') {
        const removedFeature = state.currentCircuit[index];
        state.currentCircuit.splice(index, 1);

        if (state.currentFeatureId !== null && getPoiId(state.loadedFeatures[state.currentFeatureId]) === getPoiId(removedFeature)) {
            setCurrentFeatureId(null);
            setCurrentCircuitIndex(null);

            if (document.querySelector('#details-panel.active')) {
                if (state.currentCircuit.length > 0) {
                    const firstFeatureId = state.loadedFeatures.indexOf(state.currentCircuit[0]);
                    openDetailsPanel(firstFeatureId, 0);
                } else {
                    switchSidebarTab('circuit');
                }
            }
        }
    }
    saveCircuitDraft();
    renderCircuitPanel();
}

export function generateCircuitName() {
    if (state.currentCircuit.length === 0) return "Nouveau Circuit";
    if (state.currentCircuit.length === 1) return `Départ de ${getPoiName(state.currentCircuit[0])}`;

    // Nom auto = extrémités LITTÉRALES du parcours (1ʳᵉ → dernière étape), quel
    // que soit leur type. Deux simplifications successives :
    //  - 03/06/2026 : retrait du « via [milieu] » (milieu purement positionnel,
    //    déjà listé dans la fiche, sans valeur dans le nom).
    //  - 07/06/2026 : retrait de l'exclusion des restaurants. Le nom doit décrire
    //    où va RÉELLEMENT la balade : finir à un resto est une extrémité légitime
    //    et informative. L'exclure nommait le circuit d'après une étape du milieu
    //    (ex. « à El Haddada » alors qu'on finit à Chez Adel) → trompeur.
    const circuit = state.currentCircuit;
    const startPoi = getPoiName(circuit[0]);
    const endPoi = getPoiName(circuit[circuit.length - 1]);

    if (getPoiId(circuit[0]) === getPoiId(circuit[circuit.length - 1])) {
        return `Boucle autour de ${startPoi}`;
    }
    return `Circuit de ${startPoi} à ${endPoi}`;
}

// --- FONCTION POUR VIDER LE BROUILLON (Version Majordome + UI) ---
export async function clearCircuit(withConfirmation = true) {
    // CAS 1 : On consulte un circuit enregistré (Mode Consultation)
    if (state.activeCircuitId) {
        // Pas d'alerte, on "ferme" juste la vue
        eventBus.emit('circuit:toggle-selection-mode', { force: false }); // Cette fonction ferme déjà le panneau et nettoie la carte
        resetCurrentCircuit();
        setActiveCircuitId(null);
    }
    else {
        // CAS 2 : On est en mode Brouillon (Modification en cours)
        const hasPoints = state.currentCircuit.length > 0;
        if (withConfirmation && hasPoints) {
            if (!await showConfirm("Réinitialiser", "Voulez-vous vraiment réinitialiser ce brouillon ?", "Réinitialiser", "Annuler", true)) return;
        }
        resetCurrentCircuit();
        setActiveCircuitId(null);
        // Fix PR1 (15/05/2026) : on sort explicitement du mode création quand
        // on vide un brouillon. Sans ça, state.isSelectionModeActive restait à
        // true et le bouton (+) de la sidebar « Mes Circuits » devenait inerte
        // (cf. guard desktopMode.js). Cohérent avec la sémantique « gomme =
        // abandon de la création ». Le polymorphisme du drapeau sera nettoyé
        // dans une PR refactor dédiée.
        eventBus.emit('circuit:toggle-selection-mode', { force: false });
    }

    // NETTOYAGE COMMUN (IMPORTANT pour éviter les fantômes)
    if(DOM.circuitDescription) DOM.circuitDescription.value = '';
    if(DOM.circuitTitleText) DOM.circuitTitleText.textContent = 'Nouveau Circuit';
    
    setCustomDraftName(null);

    // On vide le brouillon persistant
    await saveAppState(`circuitDraft_${state.currentMapId}`, null);
    await saveAppState('currentCircuit', []);

    renderCircuitPanel();
    notifyCircuitChanged();
}

export function navigatePoiDetails(direction) {
    if (state.currentCircuitIndex === null) return;

    const newIndex = state.currentCircuitIndex + direction;

    if (newIndex >= 0 && newIndex < state.currentCircuit.length) {
        const newFeature = state.currentCircuit[newIndex];
        const newFeatureId = state.loadedFeatures.indexOf(newFeature);
        openDetailsPanel(newFeatureId, newIndex);
    }
}

export function initCircuitListeners() {
    eventBus.on('poi:navigate', (direction) => navigatePoiDetails(direction));
    // initCircuitPageEvents() est appelé directement depuis main.js avec un
    // import statique — pas de cycle car ui-circuit-page-events.js → circuit.js
    // est désormais le seul sens (circuit.js → ui-circuit-page-events.js retiré).
}

// circuit.js

/**
 * Clé ordonnée des poiIds du circuit courant. Sert à détecter qu'un tracé est
 * PÉRIMÉ : si la séquence change depuis qu'il a été posé, on garde le tracé mais
 * on affiche le badge « à re-tracer » (cf. updateTraceBlock).
 */
export function currentPoiKey() {
    return (state.currentCircuit || []).map(getPoiId).join('|');
}

/**
 * Bascule un circuit chargé en mode édition.
 *
 * Deux comportements selon le contexte :
 *  - User lambda (preserveId=false) : oublie l'ID, ajoute " (modifié)" au titre
 *    → la sauvegarde créera un nouveau circuit (safety, l'original n'est pas touché)
 *  - Admin (preserveId=true) : préserve l'ID et CONSERVE la trace réelle, retire
 *    le statut "Vérifié" si présent → la sauvegarde met à jour le circuit existant.
 *
 * Décisions Stefan :
 *  - 03/05/2026 (Q3) : statut "Vérifié" retiré automatiquement à l'édition.
 *  - 05/06/2026 : le tracé réel est CONSERVÉ en édition (avant : realTrack=null,
 *    réflexe hérité de l'ère GPX Studio). Routing in-app oblige : éditer ne jette
 *    plus le tracé ; il devient « à re-tracer » seulement si la séquence change.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.preserveId=false] - Si true ET state.isAdmin, garde l'ID actif.
 */
export function convertToDraft({ preserveId = false } = {}) {
    if (!state.activeCircuitId) return;

    const adminMode = preserveId && state.isAdmin;

    if (adminMode) {
        // Mode admin : on garde l'ID pour mettre à jour le circuit existant
        const id = state.activeCircuitId;
        // Q3 : retirer le statut "Vérifié" (un POI ajouté n'est pas visité par l'admin)
        if (state.testedCircuits && state.testedCircuits[id]) {
            setTestedCircuit(id, false);
        }
        // Routing in-app : on CONSERVE le tracé réel à l'édition (avant on le
        // forçait à null → vol d'oiseau, réflexe GPX Studio). On mémorise la
        // séquence de POIs actuelle comme « base » : si elle change ensuite,
        // updateTraceBlock affiche le badge « à re-tracer » (le tracé reste mais
        // devient périmé). Si le circuit n'a pas de tracé, pas de base.
        const hasTrack = [(state.officialCircuits || []), (state.myCircuits || [])]
            .some(list => { const c = list.find(x => x.id === id); return !!(c && Array.isArray(c.realTrack) && c.realTrack.length >= 2); });
        state.routeBasisKey = hasTrack ? currentPoiKey() : null;
        // Active le flag : applyCircuitMode forcera 'create' tant qu'il est true
        // (et sera reset automatiquement au prochain setActiveCircuitId).
        // PR 4/5 chantier drapeaux v2 : snapshot des POI préexistants AVANT
        // d'entrer en édition (règle cadenas — leurs drapeaux seront rouges
        // non-draggables, à modifier depuis la fiche POI).
        markEditingStart(state.currentCircuit || []);
        setEditingMode(true);
        // Fix bug pré-existant (signalé par Stefan post #715) : en édition admin,
        // cliquer un POI ouvrait la fiche au lieu de l'ajouter au circuit. Cause :
        // map.js handleMarkerClick teste `state.isCircuitCreationMode && inEditMode`
        // mais convertToDraft ne posait QUE editingMode=true (commentaire map.js:294
        // « pas encore »). On active explicitement le flag de création pour que le
        // clic POI ajoute au circuit comme en création vierge.
        setCircuitCreationMode(true);
    } else {
        // Mode user lambda : oublie ID + ajoute "(modifié)" au nom.
        // /!\ Capturer le nom AVANT setActiveCircuitId — et passer par
        // setCustomDraftName plutôt que de muter textContent directement :
        // renderCircuitPanel() ré-écrit le titre depuis state.customDraftName
        // || generateCircuitName() (cf. ligne 414), donc l'ancien append à
        // textContent était immédiatement écrasé (= le "(modifié)" disparaissait).
        // Bug 2 chantier aide fiche lieu, fixé le 07/06/2026.
        const originalName = DOM.circuitTitleText?.textContent || generateCircuitName();
        setActiveCircuitId(null);
        setCustomDraftName(originalName + " (modifié)");
    }

    showToast("Mode édition activé. Vous pouvez maintenant modifier ce circuit.", "info");

    renderCircuitPanel();
    notifyCircuitChanged(); // Redessine le tracé (conservé) + rafraîchit le bloc tracé
}

// Garde anti-course (bug 03/06/2026) : loadCircuitById fait un fetch GPX lent
// pour les circuits officiels (lazy-load de la trace). Si l'utilisateur lance
// une création (bouton +) — ou un autre chargement — PENDANT ce fetch, la fin
// de loadCircuitById se ré-exécutait APRÈS le reset et réimposait l'état du
// circuit consulté (nom + POIs + activeCircuitId qui revenaient). Chaque
// chargement prend un jeton ; on abandonne sa fin si un autre l'a supplanté.
let pendingCircuitLoadSeq = 0;
export function cancelPendingCircuitLoad() { pendingCircuitLoadSeq++; }

export async function loadCircuitById(id) {
    const loadToken = ++pendingCircuitLoadSeq;
    // Sanitization: Ensure ID is a string for strict equality checks
    id = String(id);

    let circuitToLoad = state.myCircuits.find(c => c.id === id);
    if (!circuitToLoad && state.officialCircuits) {
        circuitToLoad = state.officialCircuits.find(c => c.id === id);
        // Protection contre la mutation de la liste officielle
        if (circuitToLoad) {
            circuitToLoad = { ...circuitToLoad };
        }
    }

    if (!circuitToLoad) return;

    // --- LAZY LOADING DE LA TRACE (OFFICIAL CIRCUITS) ---
    if (circuitToLoad.file && (!circuitToLoad.realTrack || circuitToLoad.realTrack.length === 0)) {
        try {
            // Correction URL : encodage pour gérer les espaces et apostrophes
            const safeUrl = `./circuits/${circuitToLoad.file.split('/').map(encodeURIComponent).join('/')}`;
            const response = await fetchWithTimeout(safeUrl);
            if (response.ok) {
                const text = await response.text();
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(text, "text/xml");
                const trkpts = xmlDoc.getElementsByTagName("trkpt");
                const coordinates = [];
                for (let i = 0; i < trkpts.length; i++) {
                    const lat = parseFloat(trkpts[i].getAttribute("lat"));
                    const lon = parseFloat(trkpts[i].getAttribute("lon"));
                    coordinates.push([lat, lon]);
                }

                if (coordinates.length > 0) {
                    circuitToLoad.realTrack = coordinates;

                    // FIX: On met à jour la source de vérité en mémoire (state.officialCircuits)
                    // Sinon, la carte (qui relit le state) ne verra pas la trace tout de suite
                    const originalOfficial = state.officialCircuits.find(c => c.id === id);
                    if (originalOfficial) {
                        originalOfficial.realTrack = coordinates;
                    }

                    // On sauvegarde pour persistance (IndexedDB)
                    await saveCircuit(circuitToLoad);

                    // FIX: On ajoute le circuit aux "Locaux" (Shadow) pour qu'il soit inclus dans les backups (saveUserData)
                    // Cela permet de restaurer la trace bleue même si le fichier GPX serveur est inaccessible (Offline/Clear DB)
                    const shadowIndex = state.myCircuits.findIndex(c => c.id === id);
                    if (shadowIndex === -1) {
                        // On s'assure que le flag isOfficial est présent pour que l'UI le masque (évite les doublons visuels)
                        if (!circuitToLoad.isOfficial) circuitToLoad.isOfficial = true;
                        addMyCircuit(circuitToLoad);
                    } else {
                        // Mise à jour du shadow existant
                        const updatedShadow = { ...state.myCircuits[shadowIndex] };
                        updatedShadow.realTrack = coordinates;
                        updateMyCircuit(updatedShadow);
                    }

                }
            } else {
                console.warn(`[Circuit] Fichier GPX introuvable : ${circuitToLoad.file}`);
                showToast("Tracé GPX indisponible — circuit affiché sans trace.", "warning");
            }
        } catch (e) {
            console.error(`[Circuit] Erreur chargement trace :`, e);
            showToast("Erreur de chargement du tracé GPX (hors-ligne ?).", "error");
        }
    }

    // Garde anti-course : si une création (ou un autre chargement) est survenue
    // pendant le fetch GPX ci-dessus, on abandonne — sinon on écraserait l'état
    // fraîchement réinitialisé avec le circuit consulté.
    if (loadToken !== pendingCircuitLoadSeq) return;

    // 1. Nettoyage de l'ancien état (sans confirmation)
    await clearCircuit(false);

    // 2. Mise à jour de l'état
    setActiveCircuitId(id);
    setCurrentCircuit(
        circuitToLoad.poiIds
            .map(poiId => state.loadedFeatures.find(f => getPoiId(f) === poiId))
            .filter(Boolean)
    );

    // 3. Délégation à la VUE (On sort le HTML d'ici !)
    View.updateCircuitForm(circuitToLoad);

    // 4. Gestion de l'affichage selon le mode (Mobile ou PC)
    if (isMobileView()) {
        eventBus.emit('mobile:render-poi-list', state.currentCircuit);
    } else {
        // Refactor PR2 (15/05/2026) : on est en CONSULTATION d'un circuit (pas
        // en création). Auparavant, on activait abusivement isSelectionModeActive
        // pour bénéficier des effets de bord (switchSidebarTab + renderCircuitPanel)
        // — drapeau polymorphe qui causait le bug du bouton (+) inerte.
        // On appelle désormais directement ces fonctions sans toucher au mode.
        switchSidebarTab('circuit');
        renderCircuitPanel();
        applyFilters();

        // 5. Centrage Intelligent de la carte
        if (state.currentCircuit.length > 0 || circuitToLoad.realTrack) {
            const pointsToFit = (circuitToLoad.realTrack && circuitToLoad.realTrack.length > 0)
                ? circuitToLoad.realTrack
                : state.currentCircuit.map(f => [f.geometry.coordinates[1], f.geometry.coordinates[0]]);
            eventBus.emit('map:fit-bounds-to-points', {
                points: pointsToFit,
                options: { padding: [50, 50], maxZoom: 16 }
            });
        }
    }

    // On force un dernier rafraîchissement des lignes pour être sûr
    notifyCircuitChanged();

    // Fix A7 (15/05/2026) : refresh des boutons d'action de la fiche circuit
    // (Marqué fait, Cacher/Réafficher) quand l'user bascule entre 2 circuits.
    // Sans cet emit, updateMarkDoneState / updateMaskListingState ne sont jamais
    // appelés au switch — les boutons gardaient l'état du circuit précédent.
    // Bug pré-existant découvert pendant le chantier Mon Espace V2 (audit
    // Niveau 2 sur circuit:list-updated, 15/05/2026).
    eventBus.emit('circuit:list-updated');
}

export async function loadCircuitFromIds(inputString, importedName = null) {
    if (!inputString) return;

    let idsStr = '';

    // 1. Parsing intelligent (URL vs Legacy hw:)
    if (inputString.includes('import=')) {
        // Format URL : http://.../?import=ID1,ID2
        try {
            // Astuce : on utilise une base fictive si l'URL est relative ou partielle, juste pour parser les params
            const urlObj = new URL(inputString.startsWith('http') ? inputString : 'https://dummy/' + inputString);
            idsStr = urlObj.searchParams.get('import');

            // Si le nom n'a pas été passé explicitement, on tente de le récupérer dans l'URL
            if (!importedName && urlObj.searchParams.has('name')) {
                importedName = urlObj.searchParams.get('name');
            }
        } catch (e) {
            // Fallback manuel si l'URL est malformée
            const match = inputString.match(/import=([^&]*)/);
            if (match) idsStr = match[1];
        }
    } else if (inputString.startsWith('hw:')) {
        // Format Legacy : hw:ID1,ID2
        idsStr = inputString.replace('hw:', '');
    } else {
        // Format Brut (Fallback)
        idsStr = inputString;
    }

    if (!idsStr) {
        showToast("Format de circuit invalide", "error");
        return;
    }

    const ids = idsStr.split(',').filter(Boolean);
    if (ids.length === 0) {
        showToast("Données de circuit vides", "warning");
        return;
    }

    // 2. Reconstruction et Résolution des POIs
    let foundCount = 0;
    const resolvedFeatures = ids.map(id => {
        const feature = state.loadedFeatures.find(f => getPoiId(f) === id);
        if (feature) foundCount++;
        return feature;
    }).filter(Boolean);

    if (resolvedFeatures.length === 0) {
        showToast("Aucune étape correspondante trouvée dans la base", "warning");
        return;
    }

    // 3. SAUVEGARDE EN BASE (Persistence)
    // On crée un vrai objet Circuit pour qu'il apparaisse dans la liste
    const newCircuitId = `circuit-${Date.now()}`;
    const newCircuit = {
        id: newCircuitId,
        mapId: state.currentMapId || 'djerba',
        name: importedName ? decodeURIComponent(importedName) : `Circuit Importé (${new Date().toLocaleDateString()})`,
        description: "Circuit importé via QR Code",
        poiIds: resolvedFeatures.map(getPoiId),
        realTrack: null,
        transport: { allerTemps: '', allerCout: '', retourTemps: '', retourCout: '' }
    };

    try {
        await saveCircuit(newCircuit);
        addMyCircuit(newCircuit); // Mise à jour mémoire
        eventBus.emit('circuit:list-updated'); // Mise à jour UI
    } catch (err) {
        console.error("Erreur sauvegarde circuit importé:", err);
        showToast("Erreur lors de la sauvegarde du circuit", "error");
        return;
    }

    // 4. CHARGEMENT (Activer le circuit nouvellement créé)
    await clearCircuit(false);

    setActiveCircuitId(newCircuitId);
    setCurrentCircuit(resolvedFeatures);

    // 5. Mise à jour de l'affichage
    if (isMobileView()) {
        eventBus.emit('mobile:render-poi-list', state.currentCircuit);
        eventBus.emit('mobile:switch-view', 'circuits');
    } else {
        // Refactor PR2 (15/05/2026) : loadCircuitFromIds (import QR) charge un
        // circuit en CONSULTATION. On appelle directement les helpers UI au
        // lieu d'activer abusivement isSelectionModeActive — cf. note PR2 dans
        // loadCircuitById.
        renderCircuitPanel();
        switchSidebarTab('circuit');
        applyFilters();

        if (state.currentCircuit.length > 0) {
            const points = state.currentCircuit.map(f => [f.geometry.coordinates[1], f.geometry.coordinates[0]]);
            eventBus.emit('map:fit-bounds-to-points', {
                points,
                options: { padding: [50, 50] }
            });
        }
    }

    notifyCircuitChanged();
    showToast(`Circuit importé et sauvegardé : ${foundCount} étapes`, "success");
}

