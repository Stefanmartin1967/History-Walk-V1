import { describe, it, expect } from 'vitest';
const { extractWaypoints } = require('../scripts/generate-circuit-index.js');

describe('GPX Parsing - extractWaypoints', () => {
    it('should extract standard waypoints (lat then lon)', () => {
        const gpx = `
            <wpt lat="48.8566" lon="2.3522">
                <name>Paris</name>
            </wpt>
        `;
        const result = extractWaypoints(gpx);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({ lat: 48.8566, lon: 2.3522, name: 'Paris' });
    });

    it('should extract reversed attributes (lon then lat)', () => {
        const gpx = `
            <wpt lon="2.3522" lat="48.8566">
                <name>Paris Reversed</name>
            </wpt>
        `;
        const result = extractWaypoints(gpx);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({ lat: 48.8566, lon: 2.3522, name: 'Paris Reversed' });
    });

    it('should handle attributes with extra spaces and other attributes', () => {
        const gpx = `
            <wpt  ele="35" lat="48.8566"  foo="bar" lon="2.3522" >
                <name>Paris messy</name>
            </wpt>
        `;
        const result = extractWaypoints(gpx);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({ lat: 48.8566, lon: 2.3522, name: 'Paris messy' });
    });

    it('should NOT match lat/lon inside content when attribute exists', () => {
        const gpx = `
            <wpt lat="10.0" lon="20.0">
                <name>fake lat="99.9"</name>
                <desc>some description with lon="88.8"</desc>
            </wpt>
        `;
        const result = extractWaypoints(gpx);
        expect(result).toHaveLength(1);
        expect(result[0].lat).toBe(10.0);
        expect(result[0].lon).toBe(20.0);
    });

    it('should NOT match lat/lon inside content when attribute is MISSING', () => {
        // This simulates a broken GPX where lat is missing, but we shouldn't pick up the fake one.
        // Ideally this should return nothing or a waypoint with missing lat (which probably gets filtered or fails).
        // Current implementation will likely pick up 99.9.
        const gpx = `
            <wpt lon="20.0">
                <name>fake lat="99.9"</name>
            </wpt>
        `;
        const result = extractWaypoints(gpx);
        // We expect it NOT to pick 99.9.
        if (result.length > 0) {
            expect(result[0].lat).not.toBe(99.9);
        } else {
            expect(result).toHaveLength(0);
        }
    });

    it('should handle CDATA in names', () => {
        const gpx = `
            <wpt lat="48.8566" lon="2.3522">
                <name><![CDATA[Paris CDATA]]></name>
            </wpt>
        `;
        const result = extractWaypoints(gpx);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('Paris CDATA');
    });
});
