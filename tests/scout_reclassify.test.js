// Reclassement à la moisson des candidats restés « A définir ».
// Cas fondateur (06/11/2026) : 275 potales de Wallonie (historic=wayside_shrine)
// capturées en « A définir » avant que le Scout sache les classer ; déjà
// enregistrées, elles n'étaient plus jamais re-capturées (doublons par osm_ref).
import { describe, it, expect } from 'vitest';
import { findReclassifiableCandidates, SUPERSEDED } from '../src/scout-reclassify.js';
import { getCategoryLabels } from '../src/taxonomy.js';

const poi = (id, props = {}) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [5.0129, 50.5006] },
    properties: { HW_ID: id, 'Nom du site FR': '', ...props },
});
const scanned = new Map([['node/8150135169', 'Potale'], ['way/1', 'Chapelle']]);

describe('findReclassifiableCandidates', () => {
    it('classe un candidat « A définir » dont l\'objet OSM est maintenant reconnu', () => {
        const f = poi('HW-A', { 'Catégorie': 'A définir', osm_ref: 'node/8150135169', candidate: true });
        expect(findReclassifiableCandidates([f], scanned)).toEqual([{ id: 'HW-A', cat: 'Potale', from: 'A définir' }]);
    });

    it('classe aussi un candidat sans catégorie, et lit un osm_ref collé en URL', () => {
        const f = poi('HW-B', { osm_ref: 'https://www.openstreetmap.org/way/1', candidate: true });
        expect(findReclassifiableCandidates([f], scanned)).toEqual([{ id: 'HW-B', cat: 'Chapelle', from: 'A définir' }]);
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

    // Règles dépassées (07/11/2026) : 309 châteaux en Fortification, 24 chapelles en
    // Église, 44 moulins en Curiosité, capturés avant les règles actuelles.
    const scanned2 = new Map([
        ['way/241682034', 'Château'], ['way/2', 'Chapelle'], ['node/3', 'Vestige industriel'],
        ['way/4', 'Fortification'], ['way/5', 'Monument'],
    ]);

    it("remplace une ancienne catégorie automatique par celle qui l'a remplacée", () => {
        const chateau = poi('HW-I', { 'Catégorie': 'Fortification', osm_ref: 'way/241682034', candidate: true });
        const chapelle = poi('HW-J', { 'Catégorie': 'Église', osm_ref: 'way/2', candidate: true });
        const moulin = poi('HW-K', { 'Catégorie': 'Curiosité', osm_ref: 'node/3', candidate: true });
        expect(findReclassifiableCandidates([chateau, chapelle, moulin], scanned2)).toEqual([
            { id: 'HW-I', cat: 'Château', from: 'Fortification' },
            { id: 'HW-J', cat: 'Chapelle', from: 'Église' },
            { id: 'HW-K', cat: 'Vestige industriel', from: 'Curiosité' },
        ]);
    });

    it('ne fait que les transitions listées : un fort reste Fortification, une Église ne devient pas Monument', () => {
        const fort = poi('HW-L', { 'Catégorie': 'Fortification', osm_ref: 'way/4', candidate: true });
        const eglise = poi('HW-M', { 'Catégorie': 'Église', osm_ref: 'way/5', candidate: true });
        const chapelleDevenueChateau = poi('HW-N', { 'Catégorie': 'Chapelle', osm_ref: 'way/241682034', candidate: true });
        expect(findReclassifiableCandidates([fort, eglise, chapelleDevenueChateau], scanned2)).toEqual([]);
    });

    it('jamais sur une fiche validée, même restée en ancienne catégorie', () => {
        const fiche = poi('HW-O', { 'Catégorie': 'Fortification', osm_ref: 'way/241682034' });
        expect(findReclassifiableCandidates([fiche], scanned2)).toEqual([]);
    });

    it('toutes les catégories de SUPERSEDED existent dans la taxonomie', () => {
        const labels = new Set(getCategoryLabels());
        for (const [from, tos] of Object.entries(SUPERSEDED)) {
            expect(labels.has(from)).toBe(true);
            for (const to of tos) expect(labels.has(to)).toBe(true);
        }
    });
});
