// official-update-ui.js — « La fiche officielle a été mise à jour depuis votre
// modification » (20/11/2026) : passe du démarrage, fenêtre « Voir » (maquette
// écran 21) et enregistrement. Principe et détection : official-updates.js et
// overlay-base.js. Fenêtre de même forme que « Résoudre la note »
// (note-conflict-ui.js) : une case par phrase (sentence-picker.js), ce qui sera
// affiché modifiable ; un champ simple se choisit entre deux cartes.
// Styles : cc-conflict-* et cc-official-update (admin-cc.css).

import { escapeXml, getDerivedZone } from './utils.js';
import { getPatrimonialName } from './data.js';
import { openHwModal, closeHwModal } from './modal.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { mergeTexts } from './text-merge.js';
import { renderSentences, syncSentenceBoxes, applySentenceBox } from './sentence-picker.js';
import { state } from './state.js';
import { savePoiData, removePoiDataKeys } from './database.js';
import { OFFICIAL_BASE_KEY, findOfficialUpdates, pruneOfficialBases, sameValue } from './overlay-base.js';
import { officialUpdatesOf, listOfficialUpdates, featureOf, applies } from './official-updates.js';
import { showToast } from './toast.js';
import { eventBus } from './events.js';

const LABELS = { description: 'Description', 'Nom du site FR': 'Nom', info_gpx: 'Info GPX', Horaires: 'Horaires', Source: 'Source' };
const labelOf = (key) => LABELS[key] || key;

/** Retire des champs de l'overlay (retour à l'officiel), en mémoire et en base. */
async function dropFields(poiId, keys) {
    if (!keys.length) return;
    const ud = state.userData?.[poiId];
    if (ud) {
        keys.forEach(k => { delete ud[k]; });
        pruneOfficialBases(ud);
    }
    const remaining = await removePoiDataKeys(state.currentMapId, poiId, keys);
    if (remaining === 0 && ud) {
        delete state.userData[poiId];
        const feature = featureOf(poiId);
        if (feature) delete feature.properties.userData;
    }
}

// Fiches déjà annoncées, pour ne le dire qu'une fois par mise à jour :
// { lieu: { champ: valeur officielle annoncée } }.
const seenKey = (mapId) => `hw_official_seen_${mapId}`;
function readSeen(mapId) {
    try { return JSON.parse(localStorage.getItem(seenKey(mapId)) || '{}') || {}; } catch { return {}; }
}
function writeSeen(mapId, seen) {
    try { localStorage.setItem(seenKey(mapId), JSON.stringify(seen)); } catch { /* sans stockage : annoncé à chaque démarrage */ }
}

/** Passe du démarrage : nettoie les modifications devenues inutiles, annonce les nouvelles mises à jour. */
export async function checkOfficialUpdatesAtBoot() {
    if (state.isAdmin) return;
    const mapId = state.currentMapId;
    const seen = readSeen(mapId);
    const nextSeen = {};
    let fresh = 0;
    for (const [poiId, ud] of Object.entries(state.userData || {})) {
        if (!ud?.[OFFICIAL_BASE_KEY] || !applies(poiId)) continue;
        const feature = featureOf(poiId);
        if (!feature) continue;
        const { updates, obsolete } = findOfficialUpdates(ud, feature.properties);
        try { await dropFields(poiId, obsolete); }
        catch (e) { console.warn('[official-updates] retrait ignoré :', poiId, e); }
        if (!updates.length) continue;
        nextSeen[poiId] = {};
        let isNew = false;
        for (const u of updates) {
            nextSeen[poiId][u.key] = u.official;
            if (!sameValue(seen[poiId]?.[u.key], u.official)) isNew = true;
        }
        if (isNew) fresh++;
    }
    writeSeen(mapId, nextSeen);
    bindToolsMenuEntry();
    refreshOfficialIndicators();
    if (fresh > 0) announce(fresh);
}

// Toast ordinaire (à sa place habituelle), avec un bouton : une seule fiche →
// « Ouvrir » la fiche ; plusieurs → « Voir » la liste. Un toast se rate : le
// point sur la roue dentée et l'entrée du menu restent tant qu'une fiche n'est
// pas réglée (maquette écran 23, Stefan 20/11/2026).
function announce(fresh) {
    const all = listOfficialUpdates();
    if (all.length === 1) {
        const f = featureOf(all[0].poiId);
        const name = f ? getPatrimonialName(f) : '';
        showToast(`La fiche « ${name} » a été mise à jour depuis votre modification.`, 'info', 10000,
            { label: 'Ouvrir', onClick: () => openFiche(all[0].poiId) });
        return;
    }
    showToast(fresh === 1
        ? 'Une fiche officielle a été mise à jour depuis vos modifications.'
        : `${fresh} fiches officielles ont été mises à jour depuis vos modifications.`, 'info', 10000,
        { label: 'Voir', onClick: () => openOfficialUpdatesList() });
}

function openFiche(poiId) {
    const index = (state.loadedFeatures || []).findIndex(f => f === featureOf(poiId));
    if (index > -1) eventBus.emit('poi:open-details', { featureId: index });
}

const plural = (n) => `${n} fiche${n > 1 ? 's' : ''} à revoir`;

/**
 * Point bleu sur la roue dentée (PC : « Outils » ; téléphone : « Menu » du dock)
 * et entrée « Fiches mises à jour » du menu Outils PC, tant qu'il reste une
 * fiche à revoir. Le menu du téléphone se construit à chaque ouverture
 * (mobile-menu.js lit listOfficialUpdates).
 */
export function refreshOfficialIndicators() {
    const n = listOfficialUpdates().length;
    document.getElementById('btn-tools-menu')?.classList.toggle('has-attention', n > 0);
    document.querySelector('.mobile-nav-btn[data-view="actions"]')?.classList.toggle('has-attention', n > 0);
    const entry = document.getElementById('btn-official-updates');
    if (entry) {
        entry.classList.toggle('is-hidden', n === 0);
        const badge = entry.querySelector('.tools-menu-badge');
        if (badge) badge.textContent = String(n);
        entry.setAttribute('aria-label', `Fiches mises à jour : ${plural(n)}`);
    }
}

let _entryBound = false;
function bindToolsMenuEntry() {
    if (_entryBound) return;
    const entry = document.getElementById('btn-official-updates');
    if (!entry) return;
    _entryBound = true;
    entry.addEventListener('click', () => {
        document.getElementById('tools-menu-content')?.classList.remove('active');
        openOfficialUpdatesList();
    });
}

/** Fenêtre « Fiches mises à jour » (écrans 24 et 26) : un nom → la fiche. */
export function openOfficialUpdatesList() {
    const all = listOfficialUpdates();
    if (!all.length) { showToast('Aucune fiche à revoir.', 'info'); return; }
    const rows = all.map(({ poiId, keys }) => {
        const f = featureOf(poiId);
        const meta = [getDerivedZone(f), f?.properties?.['Catégorie'], keys.map(labelOf).join(', ')].filter(Boolean).join(' · ');
        return `<button type="button" class="official-list-row" data-poi="${escapeXml(poiId)}">
                <span class="official-list-text"><span class="official-list-name">${escapeXml(f ? getPatrimonialName(f) : poiId)}</span><span class="official-list-meta">${escapeXml(meta)}</span></span>
                <i data-lucide="chevron-right"></i>
            </button>`;
    }).join('');
    const body = `
        <div class="official-list">
            <p class="cc-conflict-intro">La fiche officielle a changé depuis votre modification. Ouvrez une fiche pour choisir ce que vous gardez.</p>
            ${rows}
        </div>`;
    const footer = `<button class="btn btn-secondary official-list-close" type="button" data-official-list-close>Fermer</button>`;
    openHwModal({ size: 'md', icon: 'refresh-cw', title: 'Fiches mises à jour', body, footer });

    const overlay = document.querySelector('.hw-modal-overlay:last-of-type') || document;
    const root = overlay.querySelector('.official-list');
    if (!root) return;
    createIcons({ icons: appIcons, root });
    root.querySelectorAll('.official-list-row').forEach(btn => btn.addEventListener('click', () => {
        closeHwModal();
        openFiche(btn.dataset.poi);
    }));
    overlay.querySelector('[data-official-list-close]')?.addEventListener('click', () => closeHwModal());
}

/** « Revenir à la version officielle » : les champs quittent l'overlay. */
export async function revertToOfficial(poiId, keys) {
    try {
        await dropFields(poiId, keys);
        eventBus.emit('userdata:synced', { poiIds: [poiId] });
        refreshOfficialIndicators();
    } catch (e) {
        console.error('[official-updates] retour à l\'officiel :', e);
        showToast('Erreur : la version officielle n\'a pas pu être reprise.', 'error');
    }
}

/**
 * « Garder ce texte » : la version finale devient la modification du user,
 * partie de l'officiel actuel (plus de bandeau jusqu'à la prochaine mise à
 * jour). Identique à l'officiel : le champ quitte l'overlay.
 */
export async function keepOfficialChoice(poiId, finals) {
    const feature = featureOf(poiId);
    if (!feature) return;
    try {
        const toDrop = [];
        const toWrite = {};
        for (const [key, value] of Object.entries(finals)) {
            if (sameValue(value, feature.properties[key])) toDrop.push(key);
            else toWrite[key] = value;
        }
        await dropFields(poiId, toDrop);
        if (Object.keys(toWrite).length) {
            if (!state.userData[poiId]) state.userData[poiId] = {};
            const ud = state.userData[poiId];
            const bases = { ...(ud[OFFICIAL_BASE_KEY] || {}) };
            for (const key of Object.keys(toWrite)) {
                bases[key] = feature.properties[key] === undefined ? null : feature.properties[key];
            }
            Object.assign(ud, toWrite, { [OFFICIAL_BASE_KEY]: bases });
            feature.properties.userData = ud;
            await savePoiData(state.currentMapId, poiId, ud);
        }
        eventBus.emit('userdata:synced', { poiIds: [poiId] });
        refreshOfficialIndicators();
    } catch (e) {
        console.error('[official-updates] enregistrement :', e);
        showToast('Erreur lors de l\'enregistrement.', 'error');
    }
}

function textField(u, i) {
    const merged = mergeTexts(String(u.base), String(u.local), String(u.official));
    return `
        <section class="cc-conflict-field" data-key="${escapeXml(u.key)}" data-kind="text">
            <div class="cc-conflict-texts">
                <div class="cc-conflict-text">
                    <div class="cc-conflict-text-head"><span class="cc-conflict-swatch cc-conflict-swatch--online"></span>Version officielle (nouvelle)</div>
                    <p class="cc-conflict-text-body cc-conflict-text-body--online">${renderSentences(u.base, u.official, merged.text)}</p>
                </div>
                <div class="cc-conflict-text">
                    <div class="cc-conflict-text-head"><span class="cc-conflict-swatch cc-conflict-swatch--local"></span>Votre version</div>
                    <p class="cc-conflict-text-body cc-conflict-text-body--local">${renderSentences(u.base, u.local, merged.text)}</p>
                </div>
            </div>
            <div class="cc-conflict-final">
                <label class="cc-conflict-final-label" for="official-final-${i}">Ce qui sera affiché</label>
                <textarea id="official-final-${i}" class="cc-conflict-textarea" rows="5">${escapeXml(merged.text)}</textarea>
            </div>
        </section>`;
}

function choiceField(u, i) {
    const card = (value, label, body, checked) => `<label class="cc-conflict-choice${checked ? ' is-checked' : ''}">
            <input type="radio" name="official-choice-${i}" value="${value}"${checked ? ' checked' : ''}>
            <span class="cc-conflict-choice-text"><span class="cc-conflict-choice-label">${label}</span>${escapeXml(String(body ?? '')) || '<em>(vide)</em>'}</span>
        </label>`;
    return `
        <section class="cc-conflict-field" data-key="${escapeXml(u.key)}" data-kind="simple">
            <div class="cc-conflict-choices">
                ${card('official', '<span class="cc-conflict-swatch cc-conflict-swatch--online"></span>Version officielle (nouvelle)', u.official, true)}
                ${card('local', '<span class="cc-conflict-swatch cc-conflict-swatch--local"></span>Votre version', u.local, false)}
            </div>
        </section>`;
}

/** Fenêtre « Voir » (écran 21). */
export function openOfficialUpdate(poiId, poiName) {
    const updates = officialUpdatesOf(poiId);
    if (!updates.length) return;
    const several = updates.length > 1;
    const body = `
        <div class="cc-official-update">
            <p class="cc-conflict-intro">La fiche officielle a changé depuis votre modification. ${updates.some(u => u.kind === 'text') ? 'Cochez les phrases à garder.' : 'Choisissez la version à garder.'}</p>
            ${updates.map((u, i) => `${several ? `<h4 class="cc-conflict-key">${escapeXml(labelOf(u.key))}</h4>` : ''}${u.kind === 'text' ? textField(u, i) : choiceField(u, i)}`).join('')}
        </div>`;
    const footer = `
        <button class="btn btn-secondary cc-official-revert" type="button" data-official-revert>Revenir à la version officielle</button>
        <button class="btn btn-secondary" type="button" data-official-later>Plus tard</button>
        <button class="btn btn-primary" type="button" data-official-keep>${updates.some(u => u.kind === 'text') ? 'Garder ce texte' : 'Garder ce choix'}</button>`;
    const title = several ? (poiName || '') : `${poiName || ''} · ${labelOf(updates[0].key)}`;
    openHwModal({ size: 'lg', icon: 'refresh-cw', title, body, footer });

    const overlay = document.querySelector('.hw-modal-overlay:last-of-type') || document;
    const root = overlay.querySelector('.cc-official-update');
    if (!root) return;
    createIcons({ icons: appIcons, root });

    root.addEventListener('change', (e) => {
        const field = e.target.closest('.cc-conflict-field');
        if (e.target.matches('input.cc-conflict-sentence')) {
            const ta = field?.querySelector('textarea');
            if (ta) { applySentenceBox(e.target, ta); syncSentenceBoxes(field, ta); }
        } else if (e.target.matches('.cc-conflict-choice input[type="radio"]')) {
            field?.querySelectorAll('.cc-conflict-choice').forEach(l => l.classList.toggle('is-checked', !!l.querySelector('input:checked')));
        }
    });
    root.querySelectorAll('.cc-conflict-field[data-kind="text"]').forEach(field => {
        const ta = field.querySelector('textarea');
        ta?.addEventListener('input', () => syncSentenceBoxes(field, ta));
    });

    overlay.querySelector('[data-official-later]')?.addEventListener('click', () => closeHwModal());
    overlay.querySelector('[data-official-revert]')?.addEventListener('click', async () => {
        closeHwModal();
        await revertToOfficial(poiId, updates.map(u => u.key));
    });
    overlay.querySelector('[data-official-keep]')?.addEventListener('click', async () => {
        const finals = {};
        updates.forEach((u, i) => {
            const field = root.querySelectorAll('.cc-conflict-field')[i];
            if (u.kind === 'text') finals[u.key] = field.querySelector('textarea').value;
            else finals[u.key] = field.querySelector('input:checked')?.value === 'local' ? u.local : u.official;
        });
        closeHwModal();
        await keepOfficialChoice(poiId, finals);
    });
}

