// sentence-picker.js — « une case par phrase » (18/11/2026, maquette validée),
// partagé par l'écran « Résoudre » du Centre de contrôle (descriptions…) et la
// fenêtre « Résoudre la note » de la fiche (notes privées).
//
// Chaque phrase changée depuis le départ porte une case, cochée si la phrase
// est dans la version finale. Cocher l'ajoute à la fin, décocher la retire ;
// les cases suivent toujours la version finale (saisie, « Tout reprendre »).

import { escapeXml } from './utils.js';
import { markChanges, hasSentence, addSentence, removeSentence } from './text-merge.js';

/** Phrases d'une version : case sur celles qui ont changé depuis le départ. */
export function renderSentences(base, text, finalText) {
    return markChanges(base ?? '', text ?? '').map(s => {
        const body = s.text.replace(/\s+$/, '');
        const tail = s.text.slice(body.length);
        if (!s.changed || !body) return escapeXml(s.text);
        const checked = hasSentence(finalText, body);
        return `<label class="cc-conflict-sent"><input type="checkbox" class="cc-conflict-sentence" data-sentence="${escapeXml(body)}"${checked ? ' checked' : ''}><mark>${escapeXml(body)}</mark></label>${escapeXml(tail)}`;
    }).join('');
}

/** Cases d'un bloc alignées sur le contenu de la version finale. */
export function syncSentenceBoxes(root, textarea) {
    if (!root || !textarea) return;
    root.querySelectorAll('input.cc-conflict-sentence').forEach(box => {
        box.checked = hasSentence(textarea.value, box.dataset.sentence || '');
    });
}

/** Case cochée / décochée : ajoute ou retire sa phrase dans la version finale. */
export function applySentenceBox(box, textarea) {
    if (!box || !textarea) return;
    const sentence = box.dataset.sentence || '';
    textarea.value = box.checked ? addSentence(textarea.value, sentence) : removeSentence(textarea.value, sentence);
}
