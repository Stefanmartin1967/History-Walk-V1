// restore-ui.js — écrans de la restauration qui fusionne (19/11/2026, PR 2 du
// chantier « synchro users », maquette écrans 17-19 validée par Stefan).
//  - avant : ce que contient le fichier, « Elle va être réunie… » ;
//  - après (au redémarrage) : le résumé, les textes à choisir, « Annuler la
//    restauration » ;
//  - « Choisir » : la fenêtre à cases par phrase (sentence-picker.js), Fichier / Ici.

import { state, getDestinationLabel } from './state.js';
import { openHwModal, closeHwModal } from './modal.js';
import { escapeXml } from './utils.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { mergeTexts } from './text-merge.js';
import { renderSentences, syncSentenceBoxes, applySentenceBox } from './sentence-picker.js';
import { getAllPoiDataForMap } from './database.js';
import { describeBackup, getLastRestore, saveLastRestore, undoLastRestore, writeChosenText } from './restore-apply.js';
import { showToast } from './toast.js';

const FIELD_LABELS = { description: 'Description', notes: 'Note', 'Description courte': 'Description courte', 'Nom du site FR': 'Nom' };
const fieldLabel = (key) => FIELD_LABELS[key] || key;

function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} à ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function plural(n, one, many) { return `${n} ${n > 1 ? many : one}`; }

function placeName(id) {
    const f = (state.loadedFeatures || []).find(x => x?.properties?.HW_ID === id);
    return f?.properties?.['Nom du site FR'] || id;
}

function namesList(ids, max = 3) {
    const names = ids.slice(0, max).map(placeName);
    return names.join(', ') + (ids.length > max ? '…' : '');
}

/** Écran « avant de restaurer » : résout true si le user confirme. */
export function confirmRestore(json, mapId, isPlace) {
    const c = describeBackup(json, isPlace);
    const isPhotos = c.kind === 'photos';
    const content = isPhotos
        ? `${plural(c.photos, 'photo', 'photos')} sur ${plural(c.photoPlaces, 'lieu', 'lieux')}`
        : [
            plural(c.visits, 'visite', 'visites'), plural(c.notes, 'note', 'notes'),
            plural(c.places, 'lieu créé', 'lieux créés'), plural(c.circuits, 'circuit perso', 'circuits perso'),
            plural(c.done, 'circuit fait', 'circuits faits'),
            c.photos ? plural(c.photos, 'photo', 'photos') : '',
        ].filter(Boolean).join(' · ');
    const how = isPhotos
        ? 'Elles s\'ajoutent à celles de cet appareil : aucune n\'est remplacée, et une photo déjà présente n\'est pas copiée deux fois.'
        : 'Elle va être <strong>réunie</strong> avec ce qui est sur cet appareil : ce qui manque ici est ajouté ; pour ce qui existe des deux côtés, la version la plus récente est gardée.';
    const when = formatDate(json.date);
    const body = `
        <div class="rs-stack">
            <section class="rs-file">
                <span class="rs-file-head"><i data-lucide="${isPhotos ? 'image' : 'file'}"></i><b>${isPhotos ? 'Sauvegarde de photos' : 'Sauvegarde'}${when ? ` du ${escapeXml(when)}` : ''} · ${escapeXml(getDestinationLabel(mapId) || mapId)}</b></span>
                <span class="rs-file-content">${escapeXml(content)}</span>
            </section>
            <p class="rs-text">${how}</p>
            <p class="rs-safe"><i data-lucide="shield-check"></i><span>Une copie de cet appareil est prise juste avant : vous pourrez annuler la restauration.</span></p>
        </div>`;
    const footer = `
        <button class="btn btn-secondary" type="button" data-rs-cancel>Annuler</button>
        <button class="btn btn-primary" type="button" data-rs-go>Restaurer</button>`;
    const done = openHwModal({ size: 'md', icon: 'upload', title: 'Restaurer une sauvegarde', body, footer });
    const root = document.querySelector('.hw-modal-overlay:last-of-type') || document;
    createIcons({ icons: appIcons, root });
    root.querySelector('[data-rs-cancel]')?.addEventListener('click', () => closeHwModal(false));
    root.querySelector('[data-rs-go]')?.addEventListener('click', () => closeHwModal(true));
    return done.then(v => v === true);
}

/** Au démarrage : montre le résumé de la restauration qui vient d'avoir lieu. */
export async function showRestoreSummaryIfPending() {
    const mapId = state.currentMapId;
    if (!mapId) return;
    const last = await getLastRestore(mapId);
    if (last?.showSummary) openSummary(mapId, last);
}

function openSummary(mapId, last) {
    const s = last.summary || {};
    const added = [
        s.visits ? plural(s.visits, 'visite', 'visites') : '',
        s.notes ? plural(s.notes, 'note', 'notes') : '',
        s.places?.length ? `${plural(s.places.length, 'lieu créé', 'lieux créés')} (${escapeXml(s.places.slice(0, 3).join(', '))}${s.places.length > 3 ? '…' : ''})` : '',
        s.circuits?.length ? plural(s.circuits.length, 'circuit perso', 'circuits perso') : '',
        s.photos ? plural(s.photos, 'photo', 'photos') : '',
    ].filter(Boolean);
    const updated = s.updated || [];
    const kept = s.kept || [];
    const row = (cls, icon, title, text) => `
        <section class="rs-row rs-row--${cls}">
            <span class="rs-ico"><i data-lucide="${icon}"></i></span>
            <span class="rs-row-text"><b>${title}</b><span>${text}</span></span>
        </section>`;
    const conflicts = last.conflicts || [];
    const body = `
        <div class="rs-stack">
            ${added.length ? row('added', 'plus', 'Ajouté depuis le fichier', added.join(' · ')) : ''}
            ${updated.length || s.updatedCircuits ? row('updated', 'refresh-cw', 'Mis à jour : plus récent dans le fichier',
                [updated.length ? `${plural(updated.length, 'fiche', 'fiches')} · ${escapeXml(namesList(updated))}` : '', s.updatedCircuits ? plural(s.updatedCircuits, 'circuit perso', 'circuits perso') : ''].filter(Boolean).join(' · ')) : ''}
            ${kept.length || s.keptCircuits ? row('kept', 'lock', 'Gardé tel quel : plus récent ici',
                [kept.length ? plural(kept.length, 'fiche', 'fiches') : '', s.keptCircuits ? plural(s.keptCircuits, 'circuit perso', 'circuits perso') : ''].filter(Boolean).join(' · ')) : ''}
            ${!added.length && !updated.length && !kept.length && !s.updatedCircuits && !s.keptCircuits && !conflicts.length
                ? '<p class="rs-text">Rien de nouveau : cet appareil avait déjà tout ce que contient le fichier.</p>' : ''}
            ${conflicts.length ? `
            <section class="rs-conflicts">
                <span class="rs-conflicts-head"><i data-lucide="alert-triangle"></i><span><b>${plural(conflicts.length, 'texte modifié', 'textes modifiés')} des deux côtés</b><span>En attendant votre choix, la version de cet appareil est gardée.</span></span></span>
                ${conflicts.map((c, i) => `
                <div class="rs-conflict">
                    <span><b>${escapeXml(placeName(c.id))}</b> · ${escapeXml(fieldLabel(c.key))}</span>
                    <button class="btn btn-primary" type="button" data-rs-choose="${i}">Choisir</button>
                </div>`).join('')}
            </section>` : ''}
        </div>`;
    const footer = `
        <span class="rs-undo">
            <button class="rs-undo-btn" type="button" data-rs-undo>Annuler la restauration</button>
            <span>Remet cet appareil comme avant · possible jusqu'à la prochaine restauration</span>
        </span>
        <button class="btn btn-secondary" type="button" data-rs-done>Terminer</button>`;
    const when = formatDate(last.fileDate);
    openHwModal({
        size: 'md', icon: 'check-circle', title: 'Restauration terminée',
        subheader: when ? `<p class="rs-sub">Sauvegarde du ${escapeXml(when)} · ${escapeXml(getDestinationLabel(mapId) || mapId)}</p>` : null,
        body, footer, closeOnBackdrop: false,
    });
    const root = document.querySelector('.hw-modal-overlay:last-of-type') || document;
    createIcons({ icons: appIcons, root });
    root.querySelector('[data-rs-done]')?.addEventListener('click', async () => {
        // « Terminer » : les textes non choisis gardent la version de l'appareil.
        await saveLastRestore(mapId, { ...last, showSummary: false, conflicts: [] });
        closeHwModal();
    });
    root.querySelector('[data-rs-undo]')?.addEventListener('click', async () => {
        closeHwModal();
        await runUndo(mapId);
    });
    root.querySelectorAll('[data-rs-choose]').forEach(btn => btn.addEventListener('click', () => {
        const conflict = conflicts[Number(btn.dataset.rsChoose)];
        openChoose(mapId, last, conflict);
    }));
}

/** « Annuler la restauration » (aussi proposé dans l'écran Sauvegarder). */
export async function runUndo(mapId = state.currentMapId) {
    const ok = await undoLastRestore(mapId);
    if (!ok) { showToast('Rien à annuler.', 'info'); return; }
    showToast('Restauration annulée. Redémarrage…', 'success');
    setTimeout(() => window.location.reload(), 1200);
}

function openChoose(mapId, last, conflict) {
    const here = String(conflict.here ?? '');
    const file = String(conflict.file ?? '');
    const merged = mergeTexts('', here, file);
    const when = formatDate(last.fileDate);
    const body = `
        <section class="cc-conflict-field cc-note-conflict" data-kind="text">
            <p class="cc-conflict-intro">Ce texte a été modifié dans le fichier <strong>et</strong> sur cet appareil. Coche les phrases à garder.</p>
            <div class="cc-conflict-texts">
                <div class="cc-conflict-text">
                    <div class="cc-conflict-text-head"><span class="cc-conflict-swatch cc-conflict-swatch--online"></span>Fichier${when ? ` · sauvegarde du ${escapeXml(when)}` : ''}</div>
                    <p class="cc-conflict-text-body cc-conflict-text-body--online">${renderSentences('', file, merged.text)}</p>
                    <button class="cc-diff-btn" type="button" data-rs-take="file">Tout reprendre de celle-ci</button>
                </div>
                <div class="cc-conflict-text">
                    <div class="cc-conflict-text-head"><span class="cc-conflict-swatch cc-conflict-swatch--local"></span>Ici · cet appareil</div>
                    <p class="cc-conflict-text-body cc-conflict-text-body--local">${renderSentences('', here, merged.text)}</p>
                    <button class="cc-diff-btn" type="button" data-rs-take="here">Tout reprendre de celle-ci</button>
                </div>
            </div>
            <div class="cc-conflict-final">
                <label class="cc-conflict-final-label" for="rs-final">Version finale</label>
                <p class="cc-conflict-hint">Au départ : la version d'« Ici ». Une phrase cochée s'ajoute à la fin ; décochée, elle est retirée.</p>
                <textarea id="rs-final" class="cc-conflict-textarea" rows="5">${escapeXml(merged.text)}</textarea>
            </div>
        </section>`;
    const footer = `
        <button class="btn btn-secondary" type="button" data-rs-later>Plus tard</button>
        <button class="btn btn-primary" type="button" data-rs-keep>Garder la version finale</button>`;
    openHwModal({ size: 'lg', icon: 'file-text', title: `${placeName(conflict.id)} · ${fieldLabel(conflict.key)}`, body, footer, closeOnBackdrop: false });
    const root = document.querySelector('.hw-modal-overlay:last-of-type') || document;
    const field = root.querySelector('.cc-note-conflict');
    const ta = root.querySelector('#rs-final');
    if (!field || !ta) return;
    createIcons({ icons: appIcons, root: field });
    field.addEventListener('change', (e) => {
        if (!e.target.matches('input.cc-conflict-sentence')) return;
        applySentenceBox(e.target, ta);
        syncSentenceBoxes(field, ta);
    });
    ta.addEventListener('input', () => syncSentenceBoxes(field, ta));
    field.querySelectorAll('[data-rs-take]').forEach(b => b.addEventListener('click', () => {
        ta.value = b.dataset.rsTake === 'file' ? file : here;
        syncSentenceBoxes(field, ta);
    }));
    root.querySelector('[data-rs-later]')?.addEventListener('click', () => openSummary(mapId, last));
    root.querySelector('[data-rs-keep]')?.addEventListener('click', async () => {
        const withUndo = await keepFinal(mapId, conflict, ta.value, last);
        const next = { ...withUndo, conflicts: (last.conflicts || []).filter(c => c !== conflict) };
        await saveLastRestore(mapId, next);
        openSummary(mapId, next);
    });
}

/**
 * Écrit la version finale (writeChosenText, restore-apply.js). Le choix fait
 * partie de la restauration : la copie de sécurité reçoit l'état d'avant de ce
 * qu'il touche, pour qu'« Annuler la restauration » le défasse aussi.
 * @returns {Promise<object>} `last` avec sa copie de sécurité complétée
 */
export async function keepFinal(mapId, conflict, finalText, last = {}) {
    const undo = { ...(last.undo || {}), userData: { ...(last.undo?.userData || {}) } };
    if (conflict.kind === 'place') {
        if (!(state.customFeatures || []).some(f => f?.properties?.HW_ID === conflict.id)) return last;
        if (!undo.places) undo.places = JSON.parse(JSON.stringify(state.customFeatures || []));
    } else if (!(conflict.id in undo.userData)) {
        undo.userData[conflict.id] = (await getAllPoiDataForMap(mapId))[conflict.id] ?? null;
    }
    await writeChosenText(mapId, conflict, finalText);
    return { ...last, undo };
}
