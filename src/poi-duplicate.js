// poi-duplicate.js — « Doublon d'un lieu existant » : geste de curation qui fusionne
// un candidat Scout dans le POI qu'il double, au lieu de faire choisir entre les deux.
//
// LE PROBLÈME (10/08/2026) : le dédup du scan ne rapproche que ce qui est à moins de
// 50 m. Un site ÉTENDU déjà publié (« Henchir Bourgou », ~700 m de rayon, avec photo
// et description) est donc re-proposé en candidat à chaque passe. Supprimer le
// candidat perd son identité OSM ; supprimer l'ancien perd son contenu.
//
// LE GESTE : on garde le POI existant, on lui REPORTE l'osm_ref du candidat, puis on
// retire le candidat. Le POI gardé devient dès lors invisible aux re-scans (règle
// d'identité de scout-dedup.js) — chaque doublon traité immunise un lieu de plus,
// sans campagne de backfill séparée.
//
// PAS DE TOMBSTONE à la suppression du candidat (deletePoi { tombstone: false }) :
// l'objet OSM n'est pas rejeté, il est désormais REPRÉSENTÉ par le POI gardé. Le
// tombstoner le ferait apparaître dans la corbeille des rejets comme un objet écarté
// — faux, et il ressortirait en candidat si on vidait cette corbeille.
//
// L'UI est une SURCOUCHE dans l'hôte du RichEditor (modale ou tiroir Mode Données),
// pas une openHwModal : celle-ci interdit le stacking et fermerait l'éditeur ouvert
// sur le candidat. Même parti pris que le confirm « Tout vider » de la corbeille des
// rejets (rejected-trash-ui.js), et mêmes classes me-*.
import { state } from './state.js';
import { deletePoi } from './data.js';
import { persistPoiEdit } from './poi-persistence.js';
import { getPoiId, getPoiProp, normalizeOsmRef, calculateDistance, isCandidate, escapeHtml } from './utils.js';
import { getIconForFeature } from './poi-icons.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { showToast } from './toast.js';
import { logModification } from './logger.js';
import { schedulePush } from './gist-sync.js';
import { eventBus } from './events.js';

const MAX_SHOWN = 12;   // liste courte : au-delà, la recherche est le bon outil

/** « 480 m » / « 2,3 km » — distance lisible entre le candidat et une cible. */
function formatDistance(m) {
    if (!Number.isFinite(m)) return '';
    if (m < 1000) return `${Math.round(m)} m`;
    return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

function poiName(f) {
    return getPoiProp(f, 'Nom du site FR') || getPoiProp(f, 'Nom du site') || 'Lieu sans nom';
}

/**
 * Cibles possibles = POI chargés, hors candidats (on ne fusionne pas deux candidats :
 * l'un des deux serait tout aussi neuf) et hors POI supprimés localement.
 * Triées par distance croissante au candidat — le doublon est presque toujours le
 * premier de la liste.
 */
function buildTargets(candidate) {
    const candId = getPoiId(candidate);
    const [cLng, cLat] = candidate.geometry?.coordinates || [];
    const hidden = state.hiddenPoiIds || [];

    return (state.loadedFeatures || [])
        .filter((f) => {
            if (!f?.geometry?.coordinates) return false;
            const id = getPoiId(f);
            return id !== candId && !hidden.includes(id) && !isCandidate(f);
        })
        .map((f) => {
            const [lng, lat] = f.geometry.coordinates;
            return {
                id: getPoiId(f),
                name: poiName(f),
                category: getPoiProp(f, 'Catégorie') || '—',
                osmRef: normalizeOsmRef(getPoiProp(f, 'osm_ref') || ''),
                distanceM: Number.isFinite(cLat) ? calculateDistance(cLat, cLng, lat, lng) : NaN,
                icon: getIconForFeature(f),
            };
        })
        .sort((a, b) => (a.distanceM || 0) - (b.distanceM || 0));
}

/**
 * Ouvre le sélecteur de doublon.
 * @param {Object} candidate  feature du candidat Scout en cours de curation
 * @param {HTMLElement} host  conteneur du RichEditor (.hw-modal ou .md-drawer)
 * @returns {Promise<boolean>} true si la fusion a été faite (l'appelant ferme l'éditeur)
 */
export function openDuplicatePicker(candidate, host) {
    if (!candidate || !host) return Promise.resolve(false);
    if (host.querySelector('.pd-overlay')) return Promise.resolve(false); // déjà ouvert

    const candRef = normalizeOsmRef(getPoiProp(candidate, 'osm_ref') || '');
    const candName = poiName(candidate);
    const targets = buildTargets(candidate);
    let selectedId = null;
    let search = '';

    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'me-confirm-overlay pd-overlay is-active';
        overlay.setAttribute('aria-hidden', 'false');
        overlay.innerHTML = `
            <div class="me-confirm me-confirm--picker" role="dialog" aria-modal="true"
                 aria-labelledby="pd-title" aria-describedby="pd-sub">
                <div class="me-confirm-head">
                    <div class="me-confirm-ico pd-ico"><i data-lucide="copy"></i></div>
                    <div class="me-confirm-title" id="pd-title">Doublon d'un lieu existant</div>
                </div>
                <p class="me-confirm-body" id="pd-sub">
                    Choisis le lieu à <strong>garder</strong>. ${candRef
                        ? `Son objet OSM (<code>${escapeHtml(candRef)}</code>) lui sera reporté, puis le candidat
                           « ${escapeHtml(candName)} » sera supprimé.`
                        : `Le candidat « ${escapeHtml(candName)} » sera simplement supprimé — il ne porte pas
                           d'objet OSM à reporter.`}
                </p>
                <label class="md-search pd-search">
                    <i data-lucide="search"></i>
                    <input type="search" placeholder="Rechercher un lieu…" data-pd-search>
                </label>
                <div class="pd-list" data-pd-list></div>
                <div class="me-confirm-actions">
                    <button class="me-btn ghost" data-pd="cancel" type="button">Annuler</button>
                    <button class="me-btn danger-solid" data-pd="ok" type="button" disabled>
                        <i data-lucide="git-merge"></i>
                        <span data-pd-oklabel>${candRef ? "Reporter l'objet OSM et supprimer le candidat" : 'Supprimer le candidat'}</span>
                    </button>
                </div>
            </div>`;
        host.appendChild(overlay);

        const listEl = overlay.querySelector('[data-pd-list]');
        const okBtn = overlay.querySelector('[data-pd="ok"]');

        const close = (result) => { overlay.remove(); resolve(result); };

        const renderList = () => {
            const q = search.trim().toLowerCase();
            const shown = (q ? targets.filter(t => t.name.toLowerCase().includes(q)) : targets).slice(0, MAX_SHOWN);
            if (!shown.length) {
                listEl.innerHTML = `<p class="pd-empty">Aucun lieu ne correspond.</p>`;
                return;
            }
            listEl.innerHTML = shown.map((t) => {
                // Cible qui porte DÉJÀ un autre objet OSM : on ne l'écrase pas en
                // silence (deux objets OSM distincts = probablement deux vrais lieux,
                // ou une saisie à vérifier). Ligne inerte, raison affichée.
                const clash = !!(candRef && t.osmRef && t.osmRef !== candRef);
                const meta = clash
                    ? `Objet OSM déjà renseigné (${escapeHtml(t.osmRef)})`
                    : `${escapeHtml(t.category)} · ${formatDistance(t.distanceM)}`;
                return `
                <button class="me-trash-item pd-item${clash ? ' is-clash' : ''}${t.id === selectedId ? ' is-picked' : ''}"
                        type="button" data-pd-pick="${escapeHtml(t.id)}" ${clash ? 'disabled' : ''}
                        aria-pressed="${t.id === selectedId ? 'true' : 'false'}">
                    <span class="me-trash-ico">${t.icon}</span>
                    <span class="me-trash-text">
                        <span class="me-trash-title">${escapeHtml(t.name)}</span>
                        <span class="me-trash-meta">${meta}</span>
                    </span>
                    <span class="pd-check"><i data-lucide="check"></i></span>
                </button>`;
            }).join('');
            createIcons({ icons: appIcons, root: listEl });
            listEl.querySelectorAll('[data-pd-pick]').forEach((el) => {
                el.addEventListener('click', () => {
                    selectedId = el.dataset.pdPick;
                    okBtn.disabled = false;
                    renderList();
                });
            });
        };

        overlay.querySelector('[data-pd-search]').addEventListener('input', (e) => {
            search = e.target.value;
            renderList();
        });
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
        overlay.querySelector('[data-pd="cancel"]').addEventListener('click', () => close(false));
        okBtn.addEventListener('click', async () => {
            if (!selectedId) return;
            okBtn.disabled = true;
            const done = await mergeCandidateInto(candidate, selectedId);
            close(done);
        });

        createIcons({ icons: appIcons, root: overlay });
        renderList();
        overlay.querySelector('[data-pd-search]')?.focus();
    });
}

/**
 * Exécute la fusion : report de l'osm_ref sur la cible, puis retrait du candidat.
 * Ordre voulu — si le report échoue, le candidat reste (rien n'est perdu) ; l'inverse
 * perdrait l'identité OSM sans l'avoir posée nulle part.
 * @returns {Promise<boolean>}
 */
async function mergeCandidateInto(candidate, targetId) {
    const candId = getPoiId(candidate);
    const target = (state.loadedFeatures || []).find(f => getPoiId(f) === targetId);
    if (!target) { showToast('Lieu cible introuvable.', 'error', 3500); return false; }

    const candRef = normalizeOsmRef(getPoiProp(candidate, 'osm_ref') || '');
    const targetRef = normalizeOsmRef(getPoiProp(target, 'osm_ref') || '');
    const targetName = poiName(target);

    try {
        if (candRef && candRef !== targetRef) {
            await persistPoiEdit(targetId, { osm_ref: candRef });
            schedulePush(); // persistPoiEdit ne fait QUE la persistance (cf. son en-tête)
            await logModification(targetId, 'Edition (Admin)', 'osm_ref', targetRef || '', candRef);
            // Le Centre de Contrôle doit voir la cible comme modifiée : sans ça, l'osm_ref
            // reporté ne partirait qu'au prochain reconcileLocalChanges.
            eventBus.emit('admin:poi-edited', { id: targetId, type: 'update' });
        }
    } catch (e) {
        console.error('[poi-duplicate] report de l\'osm_ref échoué :', e);
        showToast("Report de l'objet OSM échoué — le candidat est conservé.", 'error', 5000);
        return false;
    }

    await deletePoi(candId, { tombstone: false });

    showToast(candRef && candRef !== targetRef
        ? `Doublon fusionné — objet OSM reporté sur « ${targetName} ».`
        : `Candidat supprimé — « ${targetName} » est conservé.`, 'success', 4000);
    return true;
}
