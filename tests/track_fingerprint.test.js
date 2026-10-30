// @vitest-environment jsdom
// Empreinte d'un tracé de circuit (src/track-fingerprint.js) : sert au Centre
// de contrôle à voir qu'un tracé a changé alors que l'index publié n'en
// contient aucun (constat de Stefan, 30/10/2026).
import { describe, it, expect } from 'vitest';
import {
    trackFingerprint, fingerprintPointCount, parseGpxTrack,
    rememberPublishedTrack, publishedTrackFingerprint,
} from '../src/track-fingerprint.js';
import { generateGPXString } from '../src/gpx.js';

const TRACK = [[33.8758891, 10.8576931], [33.8759, 10.8585], [33.8749, 10.8601]];

describe('trackFingerprint', () => {
    it('stable pour un même tracé, et porte le nombre de points', () => {
        const fp = trackFingerprint(TRACK);
        expect(fp).toBe(trackFingerprint(TRACK.map(p => [...p])));
        expect(fingerprintPointCount(fp)).toBe(3);
    });

    it('change si un seul point bouge de quelques mètres', () => {
        const moved = TRACK.map(p => [...p]);
        moved[1][0] += 0.00005; // ~5 m
        expect(trackFingerprint(moved)).not.toBe(trackFingerprint(TRACK));
    });

    it('change si l\'ordre des points change', () => {
        expect(trackFingerprint([...TRACK].reverse())).not.toBe(trackFingerprint(TRACK));
    });

    it('null pour un tracé vide ou absent', () => {
        expect(trackFingerprint([])).toBeNull();
        expect(trackFingerprint(null)).toBeNull();
    });
});

describe('parseGpxTrack', () => {
    it('relit exactement le tracé écrit par generateGPXString (même empreinte)', () => {
        const gpx = generateGPXString([], 'c1', 'Circuit', '', TRACK);
        const back = parseGpxTrack(gpx);
        expect(back).toEqual(TRACK);
        expect(trackFingerprint(back)).toBe(trackFingerprint(TRACK));
    });

    it('accepte lon avant lat et ignore les <wpt>', () => {
        const gpx = '<gpx><wpt lat="1" lon="2"></wpt><trk><trkseg><trkpt lon="10.5" lat="33.1"/></trkseg></trk></gpx>';
        expect(parseGpxTrack(gpx)).toEqual([[33.1, 10.5]]);
    });
});

describe('rememberPublishedTrack', () => {
    it('retient l\'empreinte du tracé publié par id (string ou nombre)', () => {
        rememberPublishedTrack(42, TRACK);
        expect(publishedTrackFingerprint('42')).toBe(trackFingerprint(TRACK));
        expect(publishedTrackFingerprint('inconnu')).toBeNull();
    });
});
