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
import { nearbyPlaces, officialTwinOf, setTwinAnswers, twinKey, pairKey, formatMeters, setArrivedPlaces, listPersoTwins } from './place-twins.js';
import { FIELD_DATES_KEY, FIELD_FROM_KEY, POSITION, isDatedKey } from './field-dates.js';

const answersKey = (mapId) => `placeTwinAnswers_${mapId}`;
const arrivedKey = (mapId) => `placesArrived_${mapId}`;
let bound = false;

const nameOf = (f) => getPoiProp(f, 'Nom du site FR') || f?.properties?.['Nom du site FR'] || 'Lieu';
const categoryOf = (f) => getPoiProp(f, 'Catégorie') || f?.properties?.['Catégorie'] || '';

/** Au démarrage : charge les réponses « pas le même lieu » de la destination. */
export async function initPlaceTwins() {
    setTwinAnswers((await getAppState(answersKey(state.currentMapId))) || {});
    setArrivedPlaces(await liveArrived(state.currentMapId));
    eventBus.emit('choices:changed');
    if (bound) return;
    bound = true;
    eventBus.on('twin:open', ({ id } = {}) => { if (id) openTwinDialog(id); });
    eventBus.on('twin:open-pair', ({ a, b } = {}) => { if (a && b) openPersoTwinDialog(a, b); });
}

/** Lieux arrivés encore présents (les autres sont oubliés). */
async function liveArrived(mapId) {
    const ids = (await getAppState(arrivedKey(mapId))) || [];
    const present = new Set((state.customFeatures || []).map(f => f?.properties?.HW_ID));
    const live = ids.filter(id => present.has(id));
    if (live.length !== ids.length) await saveAppState(arrivedKey(mapId), live);
    return live;
}

/** Après une synchro : retient les lieux créés arrivés d'un autre appareil. */
export async function addArrivedPlaces(mapId, ids) {
    if (!ids?.length) return;
    const list = [...new Set([...((await getAppState(arrivedKey(mapId))) || []), ...ids])];
    await saveAppState(arrivedKey(mapId), list);
    if (mapId === state.currentMapId) setArrivedPlaces(await liveArrived(mapId));
    eventBus.emit('choices:changed');
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

/** Photos ajoutées au lieu gardé ; circuits perso passés par lui (sans doublon côte à côte). */
async function movePhotosAndCircuits(mapId, fromId, toId) {
    const moved = await getPoiPhotos(mapId, fromId);
    if (moved?.length) {
        const existing = await getPoiPhotos(mapId, toId);
        const ids = new Set(existing.map(p => p.id));
        await savePoiPhotos(mapId, toId, [...existing, ...moved.filter(p => !ids.has(p.id))]);
        await deletePoiPhotos(mapId, fromId);
    }
    for (const c of state.myCircuits || []) {
        if (!(c.poiIds || []).includes(fromId)) continue;
        const poiIds = c.poiIds.map(id => (id === fromId ? toId : id)).filter((id, i, a) => i === 0 || id !== a[i - 1]);
        await persistCircuit({ ...c, poiIds });
    }
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
    await movePhotosAndCircuits(mapId, customId, officialId);
    await removeUnpublishedPoi(customId);
    await recordPlaceDeletion(mapId, customId);
    eventBus.emit('sync:local-change');
    eventBus.emit('choices:changed');
    eventBus.emit('circuit:list-updated');
    eventBus.emit('userdata:synced', { poiIds: [officialId] });
    showToast(`Votre lieu a rejoint la fiche « ${nameOf(twin.official)} ».`, 'success');
    openFiche(twin.official);
}


// ─── Deux de vos lieux au même endroit (écran 50) ──────────────────────────

// Date de création d'un lieu : `created_at` s'il l'a, sinon sa plus ancienne
// date de champ (un champ modifié tôt ne doit pas le faire passer pour plus ancien).
const createdAt = (f) => {
    const iso = Date.parse(f?.properties?.created_at || '');
    if (Number.isFinite(iso)) return iso;
    const dates = Object.values(f?.properties?.[FIELD_DATES_KEY] || {}).filter(n => typeof n === 'number');
    return dates.length ? Math.min(...dates) : Infinity;
};
const whenLabel = (ms) => {
    if (!Number.isFinite(ms)) return '';
    const d = new Date(ms); const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)} à ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** « Même lieu ? » pour deux de vos lieux (a : sur cet appareil, b : arrivé d'un autre). */
export function openPersoTwinDialog(localId, arrivedId) {
    const pair = listPersoTwins().find(p => p.localId === localId && p.arrivedId === arrivedId);
    if (!pair) { showToast('Plus rien à choisir pour ces lieux.', 'info'); return; }
    const card = (cls, title, f, id) => {
        const lines = [`${escapeXml(categoryOf(f))}${categoryOf(f) ? ' · ' : ''}${whenLabel(createdAt(f))}`,
            ...attachedList(id).map(l => `<i data-lucide="check"></i>${escapeXml(l)}`)];
        return `
        <section class="twin-card twin-card--${cls}">
            <h3>${title}</h3>
            <b class="twin-card-name">${escapeXml(nameOf(f))}</b>
            ${lines.map(l => `<span class="twin-card-line">${l}</span>`).join('')}
        </section>`;
    };
    const body = `
        <p class="twin-intro">Deux de vos lieux sont presque au même endroit.</p>
        <div class="twin-cards">
            ${card('mine', 'Créé sur cet appareil', pair.local, pair.localId)}
            ${card('official', 'Créé sur un autre appareil', pair.arrived, pair.arrivedId)}
        </div>
        <p class="twin-explain">À ${formatMeters(pair.dist)} l'un de l'autre. Si c'est le même lieu, ils sont réunis : pour chaque champ, la version la plus récente ; les notes mises bout à bout ; visites, photos et circuits rattachés au lieu gardé.</p>`;
    const footer = `
        <button class="btn btn-secondary" type="button" data-pair-both>Garder les deux</button>
        <button class="btn btn-primary" type="button" data-pair-merge>Les réunir</button>`;
    openHwModal({ size: 'md', icon: 'copy', title: 'Même lieu ?', body, footer, closeOnBackdrop: false });
    const root = document.querySelector('.hw-modal-overlay:last-of-type') || document;
    createIcons({ icons: appIcons, root });
    root.querySelector('[data-pair-both]')?.addEventListener('click', async () => {
        closeHwModal();
        const key = answersKey(state.currentMapId);
        const answers = { ...((await getAppState(key)) || {}), [pairKey(localId, arrivedId)]: 'different' };
        await saveAppState(key, answers);
        setTwinAnswers(answers);
        eventBus.emit('choices:changed');
    });
    root.querySelector('[data-pair-merge]')?.addEventListener('click', async () => {
        closeHwModal();
        await mergePersoPlaces(pair.local, pair.arrived);
    });
}

/**
 * Réunit deux de vos lieux : le plus ancien est gardé (son identifiant) ; pour
 * chaque champ, la version la plus récente ; notes bout à bout ; visites,
 * Incontournable, photos et circuits rattachés au lieu gardé ; l'autre est
 * retiré partout.
 */
export async function mergePersoPlaces(a, b) {
    const mapId = state.currentMapId;
    const [kept, gone] = createdAt(a) <= createdAt(b) ? [a, b] : [b, a];
    const keptId = kept.properties.HW_ID, goneId = gone.properties.HW_ID;
    // Champs du lieu : le plus récent, avec sa date.
    const kd = kept.properties[FIELD_DATES_KEY] || {}, gd = gone.properties[FIELD_DATES_KEY] || {};
    const kf = kept.properties[FIELD_FROM_KEY] || {}, gf = gone.properties[FIELD_FROM_KEY] || {};
    const dates = { ...kd }, from = { ...kf };
    for (const key of Object.keys(gone.properties)) {
        if (!isDatedKey(key) || key === 'HW_ID' || key === 'created_at') continue;
        if ((gd[key] ?? 0) > (kd[key] ?? 0) || kept.properties[key] === undefined) {
            kept.properties[key] = gone.properties[key];
            if (gd[key] !== undefined) dates[key] = gd[key];
            if (gf[key] !== undefined) from[key] = gf[key];
        }
    }
    if ((gd[POSITION] ?? 0) > (kd[POSITION] ?? 0)) {
        kept.geometry = JSON.parse(JSON.stringify(gone.geometry));
        dates[POSITION] = gd[POSITION];
    }
    kept.properties[FIELD_DATES_KEY] = dates;
    kept.properties[FIELD_FROM_KEY] = from;
    await saveAppState(`customPois_${mapId}`, state.customFeatures);

    // Votre suivi : visite, note, Incontournable.
    const mine = state.userData?.[goneId] || {};
    const target = state.userData?.[keptId] || {};
    const now = Date.now();
    const patch = {};
    if ((mine.vuManual || mine.vu) && !(target.vuManual || target.vu)) Object.assign(patch, { vuManual: true, vu: true, vuUpdatedAt: now });
    if (typeof mine.notes === 'string' && mine.notes.trim() && !sameValue(mine.notes, target.notes)) {
        patch.notes = typeof target.notes === 'string' && target.notes.trim() ? `${target.notes.trim()}\n\n${mine.notes.trim()}` : mine.notes;
    }
    if (mine.incontournable && !target.incontournable) Object.assign(patch, { incontournable: true, incontournableUpdatedAt: now });
    if (Object.keys(patch).length) {
        state.userData[keptId] = { ...target, ...patch };
        kept.properties.userData = state.userData[keptId];
        await savePoiData(mapId, keptId, patch);
    }
    await movePhotosAndCircuits(mapId, goneId, keptId);
    await removeUnpublishedPoi(goneId);
    await recordPlaceDeletion(mapId, goneId);
    eventBus.emit('sync:local-change');
    eventBus.emit('choices:changed');
    eventBus.emit('circuit:list-updated');
    eventBus.emit('userdata:synced', { poiIds: [keptId] });
    showToast(`Les deux lieux sont réunis : « ${nameOf(kept)} ».`, 'success');
    openFiche(kept);
}
