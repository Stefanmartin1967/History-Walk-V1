// @vitest-environment jsdom
// showTraceAsReference (src/circuit-reference-layer.js) — point 5 : au re-tracé,
// l'ANCIEN tracé s'affiche tout seul en calque (avant/après), sans le geste
// manuel export GPX → import. On couvre surtout le GARDE-FOU : ne pas écraser un
// calque importé manuellement (Wikiloc), mais remplacer un précédent auto.
// map.js est mocké (pas de Leaflet en test).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/map.js', () => ({
    drawReferenceLayer: vi.fn(),
    clearReferenceLayer: vi.fn(),
    fitReferenceLayer: vi.fn(),
}));

import { state } from '../src/state.js';
import { showTraceAsReference, hasReferenceLayer } from '../src/circuit-reference-layer.js';

const TRACK = [[33.8, 10.1], [33.85, 10.15], [33.9, 10.2]];

describe('circuit-reference-layer — showTraceAsReference (point 5)', () => {
    beforeEach(() => { state.referenceLayer = null; });

    it('affiche le tracé en calque quand aucun calque n’est chargé', () => {
        expect(showTraceAsReference(TRACK, 'Tracé précédent')).toBe(true);
        expect(hasReferenceLayer()).toBe(true);
        expect(state.referenceLayer.name).toBe('Tracé précédent');
        expect(state.referenceLayer.autoPrevious).toBe(true);
        expect(state.referenceLayer.visible).toBe(true);
        expect(state.referenceLayer.latlngs).toHaveLength(3);
    });

    it('garde-fou : n’écrase PAS un calque importé manuellement', () => {
        state.referenceLayer = { name: 'wikiloc.gpx', latlngs: [[0, 0], [1, 1]], visible: true }; // pas autoPrevious
        expect(showTraceAsReference(TRACK, 'Tracé précédent')).toBe(false);
        expect(state.referenceLayer.name).toBe('wikiloc.gpx'); // intact
    });

    it('remplace un précédent « Tracé précédent » auto (re-tracés successifs)', () => {
        showTraceAsReference([[1, 1], [2, 2]], 'Tracé précédent'); // v1
        expect(showTraceAsReference(TRACK, 'Tracé précédent')).toBe(true); // v2 remplace
        expect(state.referenceLayer.latlngs).toHaveLength(3);
    });

    it('copie le tracé (pas de référence partagée avec le realTrack source)', () => {
        const src = [[1, 1], [2, 2]];
        showTraceAsReference(src, 'Tracé précédent');
        src.push([3, 3]); // muter la source ne doit pas toucher le calque
        expect(state.referenceLayer.latlngs).toHaveLength(2);
    });

    it('ignore un tracé invalide (< 2 points)', () => {
        expect(showTraceAsReference([[1, 1]], 'x')).toBe(false);
        expect(hasReferenceLayer()).toBe(false);
    });
});
