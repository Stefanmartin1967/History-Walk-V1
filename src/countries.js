// countries.js
// Table des pays connus, indexée par le code ISO à 2 lettres posé dans
// destinations.json (`country`). Source UNIQUE pour tout ce qui s'affiche à
// partir du pays d'une destination : nom du pays, drapeau, devise par défaut.
//
// Une destination créée par le Scout n'a pas de devise (`currency: ''`) : la
// devise vient alors d'ici. Un `currency` renseigné dans destinations.json
// reste prioritaire. Pour ouvrir un nouveau pays : une ligne de plus ici.
import { state } from './state.js';

const COUNTRIES = {
    tn: { name: 'Tunisie',  currency: 'TND' },
    ma: { name: 'Maroc',    currency: 'MAD' },
    dz: { name: 'Algérie',  currency: 'DZD' },
    be: { name: 'Belgique', currency: 'EUR' },
    fr: { name: 'France',   currency: 'EUR' },
};

function normalize(code) {
    return String(code || '').trim().toLowerCase();
}

/** Nom du pays en français ; à défaut, le code en majuscules ('' si aucun code). */
export function countryName(code) {
    const c = normalize(code);
    return COUNTRIES[c]?.name || c.toUpperCase();
}

/**
 * Drapeau émoji calculé depuis le code (🇧🇪 pour 'be') ; '' si le code n'est
 * pas deux lettres. Valable pour tout pays, connu de la table ou non.
 */
export function countryFlag(code) {
    const c = normalize(code);
    if (!/^[a-z]{2}$/.test(c)) return '';
    return String.fromCodePoint(...[...c].map(ch => 0x1F1E6 + ch.charCodeAt(0) - 97));
}

/** Devise d'une destination : la sienne, sinon celle de son pays, sinon ''. */
export function destinationCurrency(dest) {
    return dest?.currency || COUNTRIES[normalize(dest?.country)]?.currency || '';
}

/** Devise de la destination active (même règle que destinationCurrency). */
export function getActiveDestinationCurrency() {
    const id = state.currentMapId || state.destinations?.activeMapId;
    return destinationCurrency(state.destinations?.maps?.[id]);
}
