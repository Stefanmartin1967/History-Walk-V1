// patrimonial-names.js
// Préférence GLOBALE de langue des NOMS PATRIMONIAUX de POI (FR ⇄ AR), défaut FR.
// Calquée sur theme.js (le moment) MAIS avec une différence clé : changer de
// MOMENT = CSS pur, repeint gratuit ; changer de LANGUE = re-rendre des noms déjà
// affichés (fiche, listes, marqueurs). On ÉMET donc un event 'patrimony:lang-changed'
// (que theme.js n'a pas) pour déclencher les re-renders ciblés.
//
// Périmètre = noms patrimoniaux des POI uniquement, JAMAIS les libellés d'UI.
// La résolution du nom vit dans data.js (getPatrimonialName) ; ce module ne gère
// que la préférence (lecture, écriture persistée, broadcast).

import { saveAppState } from './database.js';
import { eventBus } from './events.js';

export const PATRIMONIAL_LANGS = ['fr', 'ar'];

// Source de vérité runtime, initialisée depuis localStorage (sync → dispo dès le
// 1er rendu, avant que main.js ne restaure la copie durable de saveAppState).
let _lang = 'fr';
try {
    const saved = localStorage.getItem('hw_patrimony_lang');
    if (PATRIMONIAL_LANGS.includes(saved)) _lang = saved;
} catch (_) { /* localStorage indispo (mode privé strict) → défaut FR */ }
document.documentElement.setAttribute('data-names-lang', _lang);

export function getCurrentPatrimonialLang() {
    return _lang;
}

/**
 * Applique la langue des noms : runtime + attribut <html> + persistance
 * (IndexedDB durable + miroir localStorage) + broadcast pour re-render.
 * No-op si la langue est déjà active (pas d'event parasite).
 */
export function setPatrimonialLang(lang) {
    if (!PATRIMONIAL_LANGS.includes(lang)) return;
    if (lang === _lang) return;
    _lang = lang;
    document.documentElement.setAttribute('data-names-lang', lang);
    saveAppState('currentPatrimonialLang', lang);
    try { localStorage.setItem('hw_patrimony_lang', lang); } catch (_) {}
    eventBus.emit('patrimony:lang-changed', lang);
}
