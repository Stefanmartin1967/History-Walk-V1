// note-conflict-ui.js — fenêtre « Résoudre la note » (18/11/2026, maquette
// « notes privées », écran 8). Ouverte depuis le bandeau de la fiche quand la
// note a changé sur un autre appareil ET ici (note-sync.js). Depuis le
// 19/11/2026 aussi sur le téléphone (écran 10) : zones empilées, une ligne à
// cocher par phrase (admin-cc.css, max-width 767px).
//
// Même principe qu'une description au Centre de contrôle : « Autre appareil »
// et « Ici » côte à côte, une case par phrase changée (sentence-picker.js),
// version finale modifiable, pré-remplie avec les deux changements réunis quand
// ils ne touchent pas la même phrase. Styles : cc-conflict-* (admin-cc.css).

import { state } from './state.js';
import { openHwModal, closeHwModal } from './modal.js';
import { escapeXml } from './utils.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { mergeTexts } from './text-merge.js';
import { renderSentences, syncSentenceBoxes, applySentenceBox } from './sentence-picker.js';
import { resolveNoteConflict } from './note-sync.js';
import { showToast } from './toast.js';

export function openNoteConflict(poiId, poiName) {
    const ud = state.userData?.[poiId] || {};
    const sync = ud.noteSync;
    if (!sync || sync.remote === undefined) return;
    const local = String(ud.notes ?? '');
    const remote = String(sync.remote ?? '');
    const base = String(sync.base ?? '');
    const merged = mergeTexts(base, local, remote);

    const body = `
        <section class="cc-conflict-field cc-note-conflict" data-key="notes" data-kind="text">
            <p class="cc-conflict-intro">La note a été modifiée sur un autre appareil <strong>et</strong> ici. Coche les phrases à garder ; la version finale remplacera la note partout.</p>
            <div class="cc-conflict-texts">
                <div class="cc-conflict-text">
                    <div class="cc-conflict-text-head"><span class="cc-conflict-swatch cc-conflict-swatch--online"></span>Autre appareil · version du dépôt privé</div>
                    <p class="cc-conflict-text-body cc-conflict-text-body--online">${renderSentences(base, remote, merged.text)}</p>
                    <button class="cc-diff-btn" type="button" data-note-take="remote">Tout reprendre de celle-ci</button>
                </div>
                <div class="cc-conflict-text">
                    <div class="cc-conflict-text-head"><span class="cc-conflict-swatch cc-conflict-swatch--local"></span>Ici · cet appareil</div>
                    <p class="cc-conflict-text-body cc-conflict-text-body--local">${renderSentences(base, local, merged.text)}</p>
                    <button class="cc-diff-btn" type="button" data-note-take="local">Tout reprendre de celle-ci</button>
                </div>
            </div>
            <div class="cc-conflict-final">
                <label class="cc-conflict-final-label" for="note-conflict-final">Version finale · remplacera la note partout</label>
                ${merged.clean
                    ? `<div class="cc-conflict-merged" role="status"><i data-lucide="check"></i> Les deux changements ne touchaient pas la même phrase : ils ont été réunis. Relis avant de valider.</div>`
                    : `<p class="cc-conflict-hint">Au départ : la note d'« Ici ». Une phrase cochée s'ajoute à la fin ; décochée, elle est retirée. Tes retouches ne bougent pas.</p>`}
                <textarea id="note-conflict-final" class="cc-conflict-textarea" rows="5">${escapeXml(merged.text)}</textarea>
            </div>
        </section>`;
    const footer = `
        <span class="cc-conflict-actions-note">« Plus tard » : ta version reste ici, rien n'est envoyé.</span>
        <button class="btn btn-secondary" type="button" data-note-later>Plus tard</button>
        <button class="btn btn-primary" type="button" data-note-keep>Garder la version finale</button>`;

    openHwModal({ size: 'lg', icon: 'bookmark', title: `Note privée · ${poiName || ''}`, body, footer });

    const overlay = document.querySelector('.hw-modal-overlay:last-of-type') || document;
    const field = overlay.querySelector('.cc-note-conflict');
    const ta = overlay.querySelector('#note-conflict-final');
    if (!field || !ta) return;
    createIcons({ icons: appIcons, root: field });

    field.addEventListener('change', (e) => {
        if (!e.target.matches('input.cc-conflict-sentence')) return;
        applySentenceBox(e.target, ta);
        syncSentenceBoxes(field, ta);
    });
    ta.addEventListener('input', () => syncSentenceBoxes(field, ta));
    field.querySelectorAll('[data-note-take]').forEach(btn => btn.addEventListener('click', () => {
        ta.value = btn.dataset.noteTake === 'remote' ? remote : local;
        syncSentenceBoxes(field, ta);
    }));
    overlay.querySelector('[data-note-later]')?.addEventListener('click', () => closeHwModal());
    overlay.querySelector('[data-note-keep]')?.addEventListener('click', async () => {
        const finalText = ta.value;
        closeHwModal();
        const result = await resolveNoteConflict(poiId, finalText);
        if (result === 'error' || result === 'pending') {
            showToast('Note gardée sur cet appareil — envoi vers heripia-travail au retour du réseau.', 'warning', 4500);
        }
    });
}
