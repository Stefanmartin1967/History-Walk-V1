// Reclassement à la moisson des candidats restés « A définir ».
// Cas fondateur (06/11/2026) : 275 potales de Wallonie (historic=wayside_shrine)
// capturées en « A définir » avant que le Scout sache les classer ; déjà
// enregistrées, elles n'étaient plus jamais re-capturées (doublons par osm_ref).
import { describe, it, expect } from 'vitest';
import { findReclassifiableCandidates } from '../src/scout-reclassify.js';

const poi = (id, props = {}) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [5.0129, 50.5006] },
    properties: { HW_ID: id, 'Nom du site FR': '', ...props },
});
const scanned = new Map([['node/8150135169', 'Potale'], ['way/1', 'Chapelle']]);

describe('findReclassifiableCandidates', () => {
    it('classe un candidat « A définir » dont l\'objet OSM est maintenant reconnu', () => {
        const f = poi('HW-A', { 'Catégorie': 'A définir', osm_ref: 'node/8150135169', candidate: true });
        expect(findReclassifiableCandidates([f], scanned)).toEqual([{ id: 'HW-A', cat: 'Potale' }]);
    });

    it('classe aussi un candidat sans catégorie, et lit un osm_ref collé en URL', () => {
        const f = poi('HW-B', { osm_ref: 'https://www.openstreetmap.org/way/1', candidate: true });
        expect(findReclassifiableCandidates([f], scanned)).toEqual([{ id: 'HW-B', cat: 'Chapelle' }]);
    });

    it('ne remplace jamais une catégorie choisie à la curation (fichier ou overlay)', () => {
        const inFile = poi('HW-C', { 'Catégorie': 'Chapelle', osm_ref: 'node/8150135169', candidate: true });
        const inOverlay = poi('HW-D', {
            'Catégorie': 'A définir', osm_ref: 'node/8150135169', candidate: true,
            userData: { 'Catégorie': 'Monument' },
        });
        expect(findReclassifiableCandidates([inFile, inOverlay], scanned)).toEqual([]);
    });

    it('ne touche pas une fiche validée, même restée « A définir »', () => {
        const fiche = poi('HW-E', { 'Catégorie': 'A définir', osm_ref: 'node/8150135169' });
        const validated = poi('HW-F', {
            'Catégorie': 'A définir', osm_ref: 'node/8150135169', candidate: true,
            userData: { candidate: false },
        });
        expect(findReclassifiableCandidates([fiche, validated], scanned)).toEqual([]);
    });

    it('rien sans osm_ref, ni pour un objet que la moisson ne sait pas classer', () => {
        const noRef = poi('HW-G', { 'Catégorie': 'A définir', candidate: true });
        const unknown = poi('HW-H', { 'Catégorie': 'A définir', osm_ref: 'node/999', candidate: true });
        expect(findReclassifiableCandidates([noRef, unknown], scanned)).toEqual([]);
        expect(findReclassifiableCandidates([noRef], new Map())).toEqual([]);
        expect(findReclassifiableCandidates([noRef], undefined)).toEqual([]);
    });
});
