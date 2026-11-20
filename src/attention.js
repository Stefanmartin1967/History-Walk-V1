// attention.js — le point sur la roue dentée (« Outils » sur PC, « Menu » du
// dock sur téléphone) : quelque chose attend le user. Plusieurs sources le
// partagent (20/11/2026) : fiches officielles mises à jour (bleu) et textes
// modifiés sur deux appareils (ambre, synchro Google). Un seul point ; ambre
// dès qu'un texte attend un choix.

const sources = new Map(); // nom → ton ('info' | 'choose')

/**
 * @param {string} source  qui demande l'attention
 * @param {boolean} on
 * @param {'info'|'choose'} [tone]
 */
export function setAttention(source, on, tone = 'info') {
    if (on) sources.set(source, tone); else sources.delete(source);
    const any = sources.size > 0;
    const choose = [...sources.values()].includes('choose');
    for (const el of [
        document.getElementById('btn-tools-menu'),
        document.querySelector('.mobile-nav-btn[data-view="actions"]'),
    ]) {
        if (!el) continue;
        el.classList.toggle('has-attention', any);
        el.classList.toggle('has-attention--choose', any && choose);
    }
}
