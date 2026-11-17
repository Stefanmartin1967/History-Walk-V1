import { describe, it, expect } from 'vitest';
import {
    gpxStepsOf, parseGpxSteps, stepsFingerprint, describeStepChanges,
    autoCircuitBaseName, isAutoCircuitName, rememberPublishedSteps, publishedStepsFingerprint,
} from '../src/gpx-steps.js';
import { escapeXml } from '../src/utils.js';

// Étapes (<wpt>) d'un GPX de circuit (17/11/2026) : une fiche renommée, déplacée
// ou complétée laissait les GPX de ses circuits périmés (12 sur 24 à Djerba).

const poi = (id, lon, lat, props = {}, userData) => ({
    properties: { HW_ID: id, 'Nom du site FR': `Lieu ${id}`, ...props, ...(userData ? { userData } : {}) },
    geometry: { coordinates: [lon, lat] },
});

// Écrit les <wpt> comme generateGPXString (gpx.js).
const toWpts = (steps) => steps.map(s => `
    <wpt lat="${s.lat}" lon="${s.lon}">
      <name>${escapeXml(s.name)}</name>
      <desc>${escapeXml(s.desc)}</desc>${s.link ? `
      <link href="${escapeXml(s.link)}">
        <text>Lien vers le site</text>
      </link>` : ''}
    </wpt>`).join('');

describe('gpxStepsOf', () => {
    it('reprend nom, info GPX, lien Source et position, overlay prioritaire', () => {
        const [s] = gpxStepsOf([poi('A', 10.85, 33.87,
            { info_gpx: 'ancien', Source: 'https://a.example' },
            { 'Nom du site FR': 'Mosquée Takwa (Bardaoui)', info_gpx: 'neuf' })]);
        expect(s).toEqual({ name: 'Mosquée Takwa (Bardaoui)', desc: 'neuf', link: 'https://a.example', lat: 33.87, lon: 10.85 });
    });

    it("n'écrit un lien que pour une adresse web", () => {
        expect(gpxStepsOf([poi('A', 1, 2, { Source: 'Livre de Derriks, p. 12' })])[0].link).toBe('');
    });
});

describe('parseGpxSteps + stepsFingerprint', () => {
    const features = [
        poi('A', 10.851234567, 33.871234567, { info_gpx: 'Coupole & minaret « blanc »', Source: 'https://x.example/?a=1&b=2' }),
        poi('B', 10.9, 33.8, { 'Nom du site FR': "Mosquée d'Ouled Hlel" }),
    ];

    it('relit exactement les étapes écrites : même empreinte', () => {
        const steps = gpxStepsOf(features);
        const parsed = parseGpxSteps(`<gpx>${toWpts(steps)}<trk></trk></gpx>`);
        expect(parsed).toHaveLength(2);
        expect(parsed[0].name).toBe('Lieu A');
        expect(parsed[0].desc).toBe('Coupole & minaret « blanc »');
        expect(parsed[0].link).toBe('https://x.example/?a=1&b=2');
        expect(parsed[1].name).toBe("Mosquée d'Ouled Hlel");
        expect(stepsFingerprint(parsed)).toBe(stepsFingerprint(steps));
    });

    it('voit un renommage, un déplacement, un texte ou un lien changé', () => {
        const fp = stepsFingerprint(gpxStepsOf(features));
        const variants = [
            [poi('A', 10.851234567, 33.871234567, { 'Nom du site FR': 'Autre', info_gpx: 'Coupole & minaret « blanc »', Source: 'https://x.example/?a=1&b=2' }), features[1]],
            [poi('A', 10.8513, 33.871234567, { info_gpx: 'Coupole & minaret « blanc »', Source: 'https://x.example/?a=1&b=2' }), features[1]],
            [poi('A', 10.851234567, 33.871234567, { info_gpx: 'Autre texte', Source: 'https://x.example/?a=1&b=2' }), features[1]],
            [poi('A', 10.851234567, 33.871234567, { info_gpx: 'Coupole & minaret « blanc »' }), features[1]],
        ];
        variants.forEach(v => expect(stepsFingerprint(gpxStepsOf(v))).not.toBe(fp));
    });

    it('ignore les espaces de bord et un écart de position sous le micro-degré', () => {
        const a = [{ name: 'X', desc: 'd', link: '', lat: 33.1234561, lon: 10.1 }];
        const b = [{ name: ' X ', desc: 'd\n', link: '', lat: 33.1234564, lon: 10.1 }];
        expect(stepsFingerprint(a)).toBe(stepsFingerprint(b));
    });

    it('aucune étape : pas d’empreinte', () => {
        expect(stepsFingerprint([])).toBeNull();
        expect(parseGpxSteps('<gpx><trk/></gpx>')).toEqual([]);
    });
});

describe('describeStepChanges', () => {
    const s = (name, extra = {}) => ({ name, desc: '', link: '', lat: 1, lon: 2, ...extra });

    it('détaille les renommages et compte le reste', () => {
        const d = describeStepChanges(
            [s('Mosquée Taqwa'), s('B'), s('C'), s('Mosquée Taqwa')],
            [s('Mosquée Takwa (Bardaoui)'), s('B', { lat: 1.5 }), s('C'), s('Mosquée Takwa (Bardaoui)')]);
        expect(d.renamed).toEqual([{ from: 'Mosquée Taqwa', to: 'Mosquée Takwa (Bardaoui)' }]);
        expect(d.others).toBe(1);
        expect(d.countChanged).toBe(false);
    });

    it('signale un nombre d’étapes différent (GPX publié décalé)', () => {
        expect(describeStepChanges([s('A'), s('B'), s('C')], [s('A'), s('B')]).countChanged).toBe(true);
    });
});

describe('nom automatique', () => {
    it('base : extrémités, ou boucle', () => {
        expect(autoCircuitBaseName('A', 'B', false)).toBe('Circuit de A à B');
        expect(autoCircuitBaseName('A', 'A', true)).toBe('Boucle autour de A');
    });

    it('reconnaît le nom automatique, y compris rendu unique', () => {
        expect(isAutoCircuitName('Circuit de Mosquée Kharoubi à Mosquée Turkiya', 'Mosquée Kharoubi', 'Mosquée Turkiya', false)).toBe(true);
        expect(isAutoCircuitName('Boucle autour de Rym Beach via Mosquée X', 'Rym Beach', 'Rym Beach', true)).toBe(true);
        expect(isAutoCircuitName('Boucle autour de Rym Beach (2)', 'Rym Beach', 'Rym Beach', true)).toBe(true);
    });

    it('ne prend jamais un nom tapé à la main pour un nom automatique', () => {
        expect(isAutoCircuitName('Les mosquées du sud', 'A', 'B', false)).toBe(false);
        expect(isAutoCircuitName('Circuit de A à B et retour', 'A', 'B', false)).toBe(false);
        expect(isAutoCircuitName('Circuit de A à C', 'A', 'B', false)).toBe(false);
    });
});

describe('empreintes publiées pendant la session', () => {
    it('retient ce qu’on vient de publier', () => {
        const steps = [{ name: 'X', desc: '', link: '', lat: 1, lon: 2 }];
        rememberPublishedSteps('gs-1', steps);
        expect(publishedStepsFingerprint('gs-1')).toBe(stepsFingerprint(steps));
        expect(publishedStepsFingerprint('gs-inconnu')).toBeNull();
    });
});
