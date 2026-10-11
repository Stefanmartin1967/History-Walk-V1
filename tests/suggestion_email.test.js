// E-mail « suggérer ce nouveau lieu » (note de test 15, décisions de Stefan du
// 11/10/2026) : texte lisible au lieu du JSON brut, adresse unique (Gmail
// conservé), ni notes personnelles ni champs de curation.
import { describe, it, expect } from 'vitest';
import { buildNewPlaceSuggestion, MAX_DESCRIPTION_CHARS } from '../src/suggestion-email.js';
import { CONTACT_EMAIL } from '../src/config.js';

const base = {
    fields: { name: 'Mosquée Test', category: 'Mosquée', subtype: 'À minaret', source: 'Vu sur place', description: 'Petite mosquée blanche.' },
    destination: 'Djerba',
    coords: { lat: 33.8076, lng: 10.8451 },
    version: '3.7.425',
};

describe('buildNewPlaceSuggestion', () => {
    it('sujet et adresse : nouveau lieu, destination, nom ; adresse de contact unique', () => {
        const { subject, url } = buildNewPlaceSuggestion(base);
        expect(subject).toBe('Heripia — Nouveau lieu [Djerba] : Mosquée Test');
        expect(CONTACT_EMAIL).toBe('history.walk.007@gmail.com');
        expect(url.startsWith(`mailto:${CONTACT_EMAIL}?subject=`)).toBe(true);
    });

    it('corps lisible : catégorie, position + lien carte, source, description, version — pas de JSON', () => {
        const { body } = buildNewPlaceSuggestion(base);
        expect(body).toContain('Catégorie : Mosquée — À minaret');
        expect(body).toContain('Position : 33.807600, 10.845100');
        expect(body).toContain('https://www.openstreetmap.org/?mlat=33.807600&mlon=10.845100');
        expect(body).toContain('Source : Vu sur place');
        expect(body).toContain('Description :\nPetite mosquée blanche.');
        expect(body).toContain('version 3.7.425');
        expect(body).not.toMatch(/[{}]/);
    });

    it('les champs vides sont omis, pas de ligne « Téléphone : »', () => {
        const { body } = buildNewPlaceSuggestion(base);
        expect(body).not.toContain('Téléphone');
        expect(body).not.toContain('Nom en arabe');
    });

    it('notes personnelles et champs de curation n\'y entrent jamais', () => {
        const { body } = buildNewPlaceSuggestion({ ...base, fields: { ...base.fields, notes: 'Note privée', verified: true, jalelChecked: true } });
        expect(body).not.toContain('Note privée');
        expect(body).not.toMatch(/verified|jalel/i);
    });

    it('description trop longue : coupée (un lien mailto trop long peut ne rien ouvrir)', () => {
        const long = 'x'.repeat(MAX_DESCRIPTION_CHARS + 500);
        const { body } = buildNewPlaceSuggestion({ ...base, fields: { ...base.fields, description: long } });
        expect(body).toContain('x'.repeat(MAX_DESCRIPTION_CHARS) + '… (texte coupé)');
        expect(body).not.toContain('x'.repeat(MAX_DESCRIPTION_CHARS + 1));
    });

    it('sans position ni nom : pas de ligne Position, nom par défaut', () => {
        const { subject, body } = buildNewPlaceSuggestion({ ...base, coords: null, fields: { category: 'Puits' } });
        expect(subject).toBe('Heripia — Nouveau lieu [Djerba] : Lieu sans nom');
        expect(body).not.toContain('Position');
    });
});
