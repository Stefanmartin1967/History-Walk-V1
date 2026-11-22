// place-twins-ui.js — fenêtres des lieux au même endroit (PR 8 du chantier
// « synchro users », maquette écrans 47-51 validée par Stefan le 22/11/2026).
// Détection : place-twins.js (sans base de données).
//
//  - askNearbyBeforeCreate (écran 47) : avant de créer un lieu, « Il y a déjà un
//    lieu tout près » — Ouvrir ce lieu / Non, créer un nouveau lieu.
//  - openTwinDialog (écrans 49 et 51) : « Même lieu ? » entre un de vos lieux et
//    le lieu officiel publié au même endroit. « C'est le même lieu » : visite,
//    note, Incontournable, photos et circuits passent sur la fiche officielle,
//    votre lieu est retiré ; si votre description diffère, la fenêtre à cases
//    par phrase (texte officiel au départ, vos phrases à cocher).
//    « Pas le même lieu » : retenu pour la paire.

import { state } from './state.js';
import { eventBus } from './events.js';
import { escapeXml, getPoiProp } from './utils.js';
import { openHwModal, closeHwModal } from './modal.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { showToast } from './toast.js';
import { renderSentences, syncSentenceBoxes, applySentenceBox } from './sentence-picker.js';
import { sameValue } from './field-dates.js';
import { getAppState, saveAppState, savePoiData, getPoiPhotos, savePoiPhotos, deletePoiPhotos } from './database.js';
import { persistCircuit } from './circuit-store.js';
import { removeUnpublishedPoi } from './data.js';
import { recordPlaceDeletion } from './google-sync.js';
import { nearbyPlaces, officialTwinOf, setTwinAnswers, twinKey, formatMeters } from './place-twins.js';

const answersKey = (mapId) => `placeTwinAnswers_${mapId}`;
let bound = false;

const nameOf = (f) => getPoiProp(f, 'Nom du site FR') || f?.properties?.['Nom du site FR'] || 'Lieu';
const categoryOf = (f) => getPoiProp(f, 'Catégorie') || f?.properties?.['Catégorie'] || '';

/** Au démarrage : charge les réponses « pas le même lieu » de la destination. */
export async function initPlaceTwins() {
    setTwinAnswers((await getAppState(answersKey(state.currentMapId))) || {});
    eventBus.emit('choices:changed');
    if (bound) return;
    bound = true;
    eventBus.on('twin:open', ({ id } = {}) => { if (id) openTwinDialog(id); });
}

function openFiche(feature) {
    const index = (state.loadedFeatures || []).indexOf(feature);
    if (index > -1) eventBus.emit('poi:open-details', { featureId: index });
}

// ─── Avant de créer un lieu (écran 47) ─────────────────────────────────────

/**
 * Si un lieu existe à moins de 50 m, pose la question (sans bloquer).
 * @returns {Promise<'create'|'cancel'|'opened'>} 'opened' : la fiche du lieu existant a été ouverte
 */
export async function askNearbyBeforeCreate(lat, lng) {
    const near = nearbyPlaces(lat, lng);
    if (!near.length) return 'create';
    const body = `
        <p class="twin-intro">C'est peut-être celui que vous voulez créer.</p>
        <div class="twin-near-list">${near.map((n, i) => `
            <div class="twin-near-row">
                <i data-lucide="map-pin"></i>
                <span class="twin-near-text"><b>${escapeXml(nameOf(n.feature))}</b><span>${escapeXml(categoryOf(n.feature))}${categoryOf(n.feature) ? ' · ' : ''}à ${formatMeters(n.dist)}</span></span>
                <button class="btn btn-secondary" type="button" data-twin-open="${i}">Ouvrir ce lieu</button>
            </div>`).join('')}</div>`;
    const footer = '<button class="btn btn-primary" type="button" data-twin-create>Non, créer un nouveau lieu</button>';
    const done = openHwModal({ size: 'md', icon: 'map-pin', title: 'Il y a déjà un lieu tout près', body, footer });
    const root = document.querySelector('.hw-modal-overlay:last-of-type') || document;
    createIcons({ icons: appIcons, root });
    root.querySelectorAll('[data-twin-open]').forEach(b => b.addEventListener('click', () => closeHwModal({ open: near[Number(b.dataset.twinOpen)].feature })));
    root.querySelector('[data-twin-create]')?.addEventListener('click', () => closeHwModal('create'));
    const answer = await done;
    if (answer === 'create') return 'create';
    if (answer?.open) { openFiche(answer.open); return 'opened'; }
    return 'cancel';
}

// ─── Même lieu ? (écrans 49 et 51) ─────────────────────────────────────────

function attachedList(customId) {
    const ud = state.userData?.[customId] || {};
    const out = [];
    if (ud.vuManual || ud.vu) out.push('Visité');
    if (typeof ud.notes === 'string' && ud.notes.trim()) out.push('Votre note');
    if (ud.incontournable) out.push('Incontournable');
    const inCircuits = (state.myCircuits || []).filter(c => !c.isDeleted && (c.poiIds || []).includes(customId)).length;
    if (inCircuits) out.push(`Dans ${inCircuits} circuit${inCircuits > 1 ? 's' : ''} perso`);
    return out;
}

/** « Même lieu ? » pour un de vos lieux. */
export function openTwinDialog(customId) {
    const twin = officialTwinOf(customId);
    if (!twin) { showToast('Plus rien à choisir pour ce lieu.', 'info'); return; }
    const mine = attachedList(customId);
    const card = (cls, title, name, lines) => `
        <section class="twin-card twin-card--${cls}">
            <h3>${title}</h3>
            <b class="twin-card-name">${escapeXml(name)}</b>
            ${lines.map(l => `<span class="twin-card-line">${l}</span>`).join('')}
        </section>`;
    const body = `
        <p class="twin-intro">Un lieu officiel a été publié à ${formatMeters(twin.dist)} de votre lieu.</p>
        <div class="twin-cards">
            ${card('official', 'Lieu officiel', nameOf(twin.official), [escapeXml(categoryOf(twin.official))])}
            ${card('mine', 'Votre lieu', nameOf(twin.custom), mine.length ? mine.map(l => `<i data-lucide="check"></i>${escapeXml(l)}`) : ['Rien d\'attaché'])}
        </div>
        <p class="twin-explain">Si c'est le même lieu : votre visite, votre note, votre étoile, vos photos et vos circuits passent sur la fiche officielle, et votre lieu est retiré.</p>`;
    const footer = `
        <button class="btn btn-secondary" type="button" data-twin-different>Pas le même lieu</button>
        <button class="btn btn-primary" type="button" data-twin-same>C'est le même lieu</button>`;
    openHwModal({ size: 'md', icon: 'copy', title: 'Même lieu ?', body, footer, closeOnBackdrop: false });
    const root = document.querySelector('.hw-modal-overlay:last-of-type') || document;
    createIcons({ icons: appIcons, root });
    root.querySelector('[data-twin-different]')?.addEventListener('click', async () => {
        closeHwModal();
        await markDifferent(twin);
    });
    root.querySelector('[data-twin-same]')?.addEventListener('click', () => {
        closeHwModal();
        void sameStep(twin);
    });
}

async function markDifferent(twin) {
    const key = answersKey(state.currentMapId);
    const answers = { ...((await getAppState(key)) || {}), [twinKey(twin.customId, twin.officialId)]: 'different' };
    await saveAppState(key, answers);
    setTwinAnswers(answers);
    eventBus.emit('choices:changed');
    eventBus.emit('userdata:synced', { poiIds: [twin.customId] });
}

/** Votre description diffère du texte officiel : on choisit les phrases d'abord. */
async function sameStep(twin) {
    const mineText = String(twin.custom.properties?.description || '').trim();
    const officialText = String(getPoiProp(twin.official, 'description') || '').trim();
    if (!mineText || sameValue(mineText, officialText)) { await mergeIntoOfficial(twin); return; }
    const body = `
        <section class="cc-conflict-field cc-note-conflict" data-kind="text">
            <p class="cc-conflict-intro">Votre lieu avait sa propre description. Cochez vos phrases à garder sur la fiche officielle.</p>
            <div class="cc-conflict-texts">
                <div class="cc-conflict-text">
                    <div class="cc-conflict-text-head"><span class="cc-conflict-swatch cc-conflict-swatch--online"></span>Lieu officiel</div>
                    <p class="cc-conflict-text-body cc-conflict-text-body--online">${renderSentences('', officialText, officialText)}</p>
                </div>
                <div class="cc-conflict-text">
                    <div class="cc-conflict-text-head"><span class="cc-conflict-swatch cc-conflict-swatch--local"></span>Votre lieu</div>
                    <p class="cc-conflict-text-body cc-conflict-text-body--local">${renderSentences('', mineText, officialText)}</p>
                </div>
            </div>
            <div class="cc-conflict-final">
                <label class="cc-conflict-final-label" for="twin-final">Ce qui sera affiché</label>
                <textarea id="twin-final" class="cc-conflict-textarea" rows="5">${escapeXml(officialText)}</textarea>
            </div>
        </section>`;
    const footer = `
        <button class="btn btn-secondary" type="button" data-twin-cancel>Annuler</button>
        <button class="btn btn-primary" type="button" data-twin-keep>Réunir les deux lieux</button>`;
    openHwModal({ size: 'lg', icon: 'copy', title: `${nameOf(twin.official)} · Description`, body, footer, closeOnBackdrop: false });
    const root = document.querySelector('.hw-modal-overlay:last-of-type') || document;
    const field = root.querySelector('.cc-note-conflict');
    const ta = root.querySelector('#twin-final');
    if (!field || !ta) return;
    field.addEventListener('change', (e) => {
        if (!e.target.matches('input.cc-conflict-sentence')) return;
        applySentenceBox(e.target, ta);
        syncSentenceBoxes(field, ta);
    });
    ta.addEventListener('input', () => syncSentenceBoxes(field, ta));
    root.querySelector('[data-twin-cancel]')?.addEventListener('click', () => closeHwModal());
    root.querySelector('[data-twin-keep]')?.addEventListener('click', async () => {
        const finalText = ta.value;
        closeHwModal();
        await mergeIntoOfficial(twin, sameValue(finalText, officialText) ? undefined : finalText);
    });
}

/**
 * « C'est le même lieu » : tout ce qui est à vous passe sur la fiche officielle,
 * puis votre lieu est retiré (et retiré partout par la synchro).
 * @param {string} [description] texte à afficher sur la fiche officielle, s'il diffère de l'officiel
 */
export async function mergeIntoOfficial(twin, description) {
    const mapId = state.currentMapId;
    const { customId, officialId } = twin;
    const mine = state.userData?.[customId] || {};
    const target = state.userData?.[officialId] || {};
    const now = Date.now();
    const patch = {};
    if ((mine.vuManual || mine.vu) && !(target.vuManual || target.vu)) Object.assign(patch, { vuManual: true, vu: true, vuUpdatedAt: now });
    if (typeof mine.notes === 'string' && mine.notes.trim()) {
        patch.notes = typeof target.notes === 'string' && target.notes.trim() ? `${target.notes.trim()}\n\n${mine.notes.trim()}` : mine.notes;
    }
    if (mine.incontournable && !target.incontournable) Object.assign(patch, { incontournable: true, incontournableUpdatedAt: now });
    if (description !== undefined) patch.description = description;
    if (Object.keys(patch).length) {
        state.userData[officialId] = { ...target, ...patch };
        twin.official.properties.userData = state.userData[officialId];
        await savePoiData(mapId, officialId, patch);
    }
    // Photos : ajoutées à celles de la fiche officielle.
    const moved = await getPoiPhotos(mapId, customId);
    if (moved?.length) {
        const existing = await getPoiPhotos(mapId, officialId);
        const ids = new Set(existing.map(p => p.id));
        await savePoiPhotos(mapId, officialId, [...existing, ...moved.filter(p => !ids.has(p.id))]);
        await deletePoiPhotos(mapId, customId);
    }
    // Circuits perso : passent par la fiche officielle (sans doublon côte à côte).
    for (const c of state.myCircuits || []) {
        if (!(c.poiIds || []).includes(customId)) continue;
        const poiIds = c.poiIds.map(id => (id === customId ? officialId : id)).filter((id, i, a) => i === 0 || id !== a[i - 1]);
        await persistCircuit({ ...c, poiIds });
    }
    await removeUnpublishedPoi(customId);
    await recordPlaceDeletion(mapId, customId);
    eventBus.emit('sync:local-change');
    eventBus.emit('choices:changed');
    eventBus.emit('circuit:list-updated');
    eventBus.emit('userdata:synced', { poiIds: [officialId] });
    showToast(`Votre lieu a rejoint la fiche « ${nameOf(twin.official)} ».`, 'success');
    openFiche(twin.official);
}

