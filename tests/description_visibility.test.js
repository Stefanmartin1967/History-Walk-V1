// Visibilité de la description (11/10/2026, note de test 14) — un utilisateur
// n'a plus la case « Description publiée » (blocs de curation réservés à
// l'admin) : la description qu'il a écrite lui-même doit lui rester visible,
// sans lui montrer pour autant les descriptions officielles non publiées.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/state.js', () => ({ state: { isAdmin: false, customFeatures: [] } }));

import { isDescriptionVisible } from '../src/description-visibility.js';
import { state } from '../src/state.js';

const poi = (props = {}, userData) => ({
    type: 'Feature',
    properties: { HW_ID: 'HW-1', ...props, ...(userData ? { userData } : {}) },
    geometry: { type: 'Point', coordinates: [10.9, 33.8] },
});

beforeEach(() => { state.isAdmin = false; state.customFeatures = []; });

describe('isDescriptionVisible', () => {
    it('sans texte : jamais, même pour l\'admin', () => {
        state.isAdmin = true;
        expect(isDescriptionVisible(poi())).toBe(false);
        expect(isDescriptionVisible(poi({ description: 'Officiel' }, { description: '' }))).toBe(false);
    });

    it('admin : toujours, publiée ou non', () => {
        state.isAdmin = true;
        expect(isDescriptionVisible(poi({ description: 'Brouillon de travail' }))).toBe(true);
    });

    it('visiteur : description publiée oui, non publiée non', () => {
        expect(isDescriptionVisible(poi({ description: 'Texte', descriptionPublic: true }))).toBe(true);
        expect(isDescriptionVisible(poi({ description: 'Texte' }))).toBe(false);
    });

    it('visiteur : la recopie de l\'éditeur (même texte que l\'officiel) ne rend PAS visible', () => {
        const f = poi({ description: 'Texte officiel non publié' }, { description: 'Texte officiel non publié', 'Catégorie': 'Mosquée' });
        expect(isDescriptionVisible(f)).toBe(false);
    });

    it('visiteur : un texte qu\'il a réécrit sur une fiche officielle est visible', () => {
        const f = poi({ description: 'Texte officiel non publié' }, { description: 'Mon propre texte' });
        expect(isDescriptionVisible(f)).toBe(true);
    });

    it('visiteur : la description d\'un lieu qu\'il a créé est visible sans case cochée', () => {
        const f = poi({ description: 'Mon lieu à moi', descriptionPublic: false });
        state.customFeatures = [f];
        expect(isDescriptionVisible(f)).toBe(true);
    });
});
