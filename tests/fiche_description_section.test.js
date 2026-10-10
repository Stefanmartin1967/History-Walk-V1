// Section « Description » de la fiche (note de test 18, 03/10/2026).
//
// Décision de Stefan : sans description à montrer, on n'affiche RIEN — ni la
// phrase « Aucune description disponible », ni le titre de section, qui
// resterait seul au-dessus du vide. L'admin voit toujours sa description non
// publiée (étiquetée « Brouillon »), le visiteur seulement celles publiées.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/data.js', () => ({ getPatrimonialName: vi.fn(() => 'Mosquée Test') }));
vi.mock('../src/patrimonial-names.js', () => ({ getCurrentPatrimonialLang: vi.fn(() => 'fr') }));
vi.mock('../src/state.js', () => ({
    state: { isAdmin: false, currentMapId: 'djerba', destinations: { maps: {} }, currentCircuit: [] },
    getActiveDestinationCountry: vi.fn(() => 'tn'),
}));
vi.mock('../src/mobile-state.js', () => ({ isMobileView: vi.fn(() => false) }));
vi.mock('../src/access-point.js', () => ({ getAccessPointStatus: vi.fn(() => null) }));

import { buildDetailsPanelHtml } from '../src/templates.js';
import { state } from '../src/state.js';

const fiche = (props = {}) => buildDetailsPanelHtml({
    type: 'Feature',
    properties: { HW_ID: 'HW-TEST', 'Nom du site FR': 'Mosquée Test', 'Catégorie': 'Mosquée', ...props },
    geometry: { type: 'Point', coordinates: [10.9, 33.8] },
}, null);

beforeEach(() => { state.isAdmin = false; });

describe('fiche — section Description', () => {
    it('sans description : ni section, ni titre, ni phrase « Aucune description »', () => {
        const html = fiche();
        expect(html).not.toContain('description-section');
        expect(html).not.toContain('Aucune description');
    });

    it('visiteur, description non publiée : aucune section', () => {
        const html = fiche({ description: 'Texte de travail', descriptionPublic: false });
        expect(html).not.toContain('description-section');
        expect(html).not.toContain('Texte de travail');
    });

    it('visiteur, description publiée : section, texte et lecture à voix haute', () => {
        const html = fiche({ description: 'Texte publié', descriptionPublic: true });
        expect(html).toContain('description-section');
        expect(html).toContain('Texte publié');
        expect(html).toContain('speak-btn');
    });

    it('admin, description non publiée : visible, étiquetée « Brouillon »', () => {
        state.isAdmin = true;
        const html = fiche({ description: 'Texte de travail', descriptionPublic: false });
        expect(html).toContain('Texte de travail');
        expect(html).toContain('Brouillon — non publié');
    });

    it('admin, sans description : aucune section non plus', () => {
        state.isAdmin = true;
        expect(fiche()).not.toContain('description-section');
    });
});
