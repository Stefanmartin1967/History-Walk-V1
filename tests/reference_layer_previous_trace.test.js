// @vitest-environment jsdom
// Calques de référence (src/circuit-reference-layer.js).
//  - showTraceAsReference (point 5) : au re-tracé, l'ANCIEN tracé s'affiche tout
//    seul en calque (avant/après), sans le geste manuel export GPX → import.
//  - Plusieurs calques depuis le 17/11/2026 : le « Tracé précédent » ne prend
//    plus la place d'un GPX importé (et inversement), chacun a sa couleur,
//    s'affiche / se masque et se retire seul.
// map.js est mocké (pas de Leaflet en test).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/map.js', () => ({
    drawReferenceLayers: vi.fn(),
    fitReferenceLayer: vi.fn(),
}));
vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));

import { state } from '../src/state.js';
import { drawReferenceLayers } from '../src/map.js';
import {
    showTraceAsReference, hasReferenceLayer, referenceLayers, removeReferenceLayer,
    removePreviousTraceLayer, toggleReferenceLayerVisible, isReferenceVisible, MAX_REFERENCE_LAYERS,
} from '../src/circuit-reference-layer.js';

const TRACK = [[33.8, 10.1], [33.85, 10.15], [33.9, 10.2]];
const imported = (name, color) => ({ id: `imp-${name}`, name, latlngs: [[0, 0], [1, 1]], visible: true, color });

describe('circuit-reference-layer — showTraceAsReference (point 5)', () => {
    beforeEach(() => { state.referenceLayers = []; vi.clearAllMocks(); });

    it('affiche le tracé en calque quand aucun calque n’est chargé', () => {
        expect(showTraceAsReference(TRACK, 'Tracé précédent')).toBe(true);
        expect(hasReferenceLayer()).toBe(true);
        const [l] = referenceLayers();
        expect(l.name).toBe('Tracé précédent');
        expect(l.autoPrevious).toBe(true);
        expect(l.visible).toBe(true);
        expect(l.latlngs).toHaveLength(3);
        expect(l.color).toBe(1);
    });

    it('s’ajoute à côté d’un calque importé, sans y toucher', () => {
        state.referenceLayers = [imported('wikiloc', 1)];
        expect(showTraceAsReference(TRACK, 'Tracé précédent')).toBe(true);
        expect(referenceLayers().map(l => l.name)).toEqual(['wikiloc', 'Tracé précédent']);
        expect(referenceLayers()[1].color).toBe(2); // première couleur libre
    });

    it('remplace un précédent « Tracé précédent » auto (re-tracés successifs)', () => {
        showTraceAsReference([[1, 1], [2, 2]], 'Tracé précédent'); // v1
        expect(showTraceAsReference(TRACK, 'Tracé précédent')).toBe(true); // v2 remplace
        expect(referenceLayers()).toHaveLength(1);
        expect(referenceLayers()[0].latlngs).toHaveLength(3);
    });

    it('copie le tracé (pas de référence partagée avec le realTrack source)', () => {
        const src = [[1, 1], [2, 2]];
        showTraceAsReference(src, 'Tracé précédent');
        src.push([3, 3]); // muter la source ne doit pas toucher le calque
        expect(referenceLayers()[0].latlngs).toHaveLength(2);
    });

    it('ignore un tracé invalide (< 2 points)', () => {
        expect(showTraceAsReference([[1, 1]], 'x')).toBe(false);
        expect(hasReferenceLayer()).toBe(false);
    });

    it('plus de place (calques importés au maximum) : pas de « Tracé précédent »', () => {
        state.referenceLayers = Array.from({ length: MAX_REFERENCE_LAYERS }, (_, i) => imported(`g${i}`, i + 1));
        expect(showTraceAsReference(TRACK, 'Tracé précédent')).toBe(false);
        expect(referenceLayers()).toHaveLength(MAX_REFERENCE_LAYERS);
    });
});

describe('circuit-reference-layer — plusieurs calques', () => {
    beforeEach(() => { state.referenceLayers = [imported('a', 1), imported('b', 2)]; vi.clearAllMocks(); });

    it('masque puis réaffiche un seul calque ; seuls les visibles sont dessinés', () => {
        toggleReferenceLayerVisible('imp-a');
        expect(referenceLayers().map(l => l.visible)).toEqual([false, true]);
        expect(drawReferenceLayers).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'imp-b' })]);
        expect(isReferenceVisible()).toBe(true);
        toggleReferenceLayerVisible('imp-a');
        expect(referenceLayers()[0].visible).toBe(true);
    });

    it('retire un calque ; sa couleur redevient libre', () => {
        removeReferenceLayer('imp-a');
        expect(referenceLayers().map(l => l.id)).toEqual(['imp-b']);
        showTraceAsReference(TRACK, 'Tracé précédent');
        expect(referenceLayers().find(l => l.autoPrevious).color).toBe(1);
    });

    it('« Revenir au tracé précédent » retire seulement le calque automatique', () => {
        showTraceAsReference(TRACK, 'Tracé précédent');
        removePreviousTraceLayer();
        expect(referenceLayers().map(l => l.id)).toEqual(['imp-a', 'imp-b']);
    });
});
