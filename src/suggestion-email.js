// suggestion-email.js — e-mail « suggérer ce nouveau lieu à l'administrateur »,
// proposé à un non-admin qui crée un lieu (note de test 15, décisions de Stefan
// du 11/10/2026 : seulement à la création, adresse Gmail conservée).
//
// Texte LISIBLE, plus le JSON brut de la fiche : l'admin lit l'e-mail, il ne
// l'importe pas. Ni notes personnelles (privées), ni champs de curation. La
// description est tronquée : un lien mailto trop long peut ne rien ouvrir selon
// le logiciel de messagerie. Module pur (config seule) → testable.
import { CONTACT_EMAIL } from './config.js';

export const MAX_DESCRIPTION_CHARS = 1000;

/**
 * @param {object} p
 * @param {object} p.fields   valeurs du formulaire (chaînes, vides acceptées) :
 *   name, nameAr, category, subtype, etat, acces, source, mapsUrl, osmUrl,
 *   phone, hours, facebook, description
 * @param {string} p.destination  nom de la destination (« Djerba »)
 * @param {{lat:number, lng:number}|null} p.coords  position choisie sur la carte
 * @param {string} p.version  APP_VERSION
 * @returns {{subject: string, body: string, url: string}}
 */
export function buildNewPlaceSuggestion({ fields, destination, coords, version }) {
    const f = Object.fromEntries(Object.entries(fields || {}).map(([k, v]) => [k, String(v ?? '').trim()]));
    const name = f.name || 'Lieu sans nom';
    const subject = `Heripia — Nouveau lieu [${destination}] : ${name}`;

    const lines = [`Nom : ${name}`];
    const add = (label, value) => { if (value) lines.push(`${label} : ${value}`); };
    add('Nom en arabe', f.nameAr);
    add('Catégorie', [f.category, f.subtype].filter(Boolean).join(' — '));
    add('État', f.etat);
    add('Accès', f.acces);
    if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng)) {
        const lat = coords.lat.toFixed(6);
        const lng = coords.lng.toFixed(6);
        lines.push(`Position : ${lat}, ${lng}`);
        lines.push(`Voir sur la carte : https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=19/${lat}/${lng}`);
    }
    add('Source', f.source);
    add('Lien Google Maps', f.mapsUrl);
    add('Objet OSM', f.osmUrl);
    add('Téléphone', f.phone);
    add('Horaires', f.hours);
    add('Facebook', f.facebook);

    let description = f.description || '';
    if (description.length > MAX_DESCRIPTION_CHARS) {
        description = description.slice(0, MAX_DESCRIPTION_CHARS).trimEnd() + '… (texte coupé)';
    }

    const body = [
        'Bonjour,',
        '',
        `Je vous propose un nouveau lieu pour ${destination} :`,
        '',
        ...lines,
        ...(description ? ['', 'Description :', description] : []),
        '',
        '—',
        `Envoyé depuis Heripia, version ${version}`,
    ].join('\n');

    const url = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    return { subject, body, url };
}
