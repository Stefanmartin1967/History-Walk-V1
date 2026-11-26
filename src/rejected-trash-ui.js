// rejected-trash-ui.js — Lieux rejetés au tri (corbeille des rejets de curation Scout).
// Liste les objets OSM REJETÉS (tombstones, rejected.js) de la destination active,
// avec RESTAURATION par item (re-crée le candidat depuis l'instantané, sans
// re-scanner) + « Tout vider » (bulk).
//
// Depuis le 24/11/2026 (maquette écran 64 validée par Stefan) : 3e sous-onglet
// « Lieux rejetés » de Nettoyage dans le Centre de Contrôle (admin-maintenance.js),
// à côté de la corbeille des circuits. Avant : une modale ouverte depuis Outils.
//
// Cycle : un candidat supprimé (data.js deletePoi) est tombstoné (osm_ref) → ici on
// le restaure (removeRejected + addPoiFeature candidate:true) ou on vide tout.
import { state } from './state.js';
import { rejectedData, clearRejected, removeRejected, rejectedCount } from './rejected.js';
import { savePendingRejected, pushRejected } from './rejected-store.js';
import { addPoiFeature } from './data.js';
import { showToast } from './toast.js';
import { showConfirm } from './modal.js';
import { getStoredToken } from './github-sync.js';
import { escapeHtml } from './utils.js';

export { rejectedCount };

function formatDate(ts) {
    if (!ts) return '';
    const d = new Date(Number(ts));
    if (Number.isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** HTML de la sous-vue « Lieux rejetés » (classes cc-* du Centre de Contrôle). */
export function renderRejectedView() {
    const refs = Object.keys(rejectedData);
    if (refs.length === 0) {
        return `
            <div class="cc-empty">
                <div class="cc-empty-mark"><i data-lucide="package-check"></i></div>
                <h3 class="cc-empty-title">Aucun lieu rejeté.</h3>
                <p class="cc-empty-sub">Quand vous supprimez une capture du Scout, elle arrive ici et n'est plus proposée. Vous pourrez la restaurer à tout moment.</p>
            </div>
        `;
    }

    const itemsHtml = refs.map(ref => {
        const r = rejectedData[ref] || {};
        const name = escapeHtml(r.name || 'Sans nom');
        const date = formatDate(r.rejectedAt);
        const meta = escapeHtml(r.category || 'Catégorie ?') + (date ? ` · rejeté le ${date}` : '');
        return `
            <div class="cc-card cc-card--row">
                <div class="cc-card-ico"><i data-lucide="map-pin-off"></i></div>
                <div class="cc-card-text">
                    <div class="cc-card-title">${name}</div>
                    <div class="cc-card-sub">${meta}</div>
                </div>
                <div class="cc-card-meta">
                    <button class="cc-diff-btn" data-action="restore-rejected" data-ref="${escapeHtml(ref)}" type="button" title="Restaurer ce lieu" aria-label="Restaurer ${name}">
                        <i data-lucide="rotate-ccw"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    return `
        <div class="cc-section-title--row">
            <h4 class="cc-section-title">Lieux rejetés au tri · ${refs.length}</h4>
            <button class="cc-diff-btn cc-diff-btn--danger cc-rejected-clear" data-action="clear-rejected" type="button">
                <i data-lucide="trash-2"></i> Tout vider
            </button>
        </div>
        <p class="cc-rejected-hint">Restaurer remet le lieu dans les lieux à valider. Vider : ils seront proposés de nouveau au prochain passage du Scout.</p>
        ${itemsHtml}
    `;
}

/** Branche les boutons de la sous-vue. `refresh` redessine l'onglet (compteurs compris). */
export function bindRejectedView(container, refresh) {
    container.querySelectorAll('[data-action="restore-rejected"]').forEach(btn => {
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            await restoreRejected(btn.dataset.ref);
            refresh();
        });
    });
    container.querySelector('[data-action="clear-rejected"]')?.addEventListener('click', async () => {
        const n = rejectedCount();
        const ok = await showConfirm(
            'Tout vider',
            `Les ${n} lieu${n > 1 ? 'x' : ''} rejeté${n > 1 ? 's' : ''} ${n > 1 ? 'seront proposés' : 'sera proposé'} de nouveau au prochain passage du Scout.`,
            'Tout vider', 'Annuler', true
        );
        if (!ok) return;
        clearRejected();
        await saveAndPushRejected();
        refresh();
    });
}

// Enregistre l'état sur l'appareil puis pousse le fichier rejets entier tout de suite
// (best-effort) : les rejets en attente partent avec (rejected-store.js). Sans token
// → seulement enregistré ; les rejets en attente partiront à « Tout publier ».
async function saveAndPushRejected() {
    const mapId = state.currentMapId;
    try { await savePendingRejected(mapId); } catch (e) { console.warn('[rejets] enregistrement local échoué :', e); }
    if (!getStoredToken()) return;
    pushRejected(mapId).catch(e => console.warn('[rejets] push échoué (gardé en attente) :', e));
}

// Restaure UN rejet : re-crée le candidat depuis l'instantané (pas de re-scan) puis
// retire le tombstone et pousse. Si la re-création échoue, on NE retire PAS le rejet.
// Pas de toast de succès : le lieu quitte la liste et le compteur baisse.
async function restoreRejected(osmRef) {
    const rec = rejectedData[osmRef];
    if (!rec) return;
    try {
        await addPoiFeature({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [Number(rec.lng), Number(rec.lat)] },
            properties: {
                'Nom du site FR': rec.name || '',
                ...(rec.nameAr ? { 'Nom du site arabe': rec.nameAr } : {}),
                'Catégorie': rec.category || 'A définir',
                ...(rec.osm_ref ? { osm_ref: rec.osm_ref } : {}),
                candidate: true,
            },
        }, { draft: false });
    } catch (e) {
        console.warn('[rejets] re-création du candidat échouée :', e);
        showToast('Restauration échouée.', 'error', 3500);
        return;
    }
    removeRejected(osmRef);
    await saveAndPushRejected();
}
