import { describe, it, expect } from 'vitest';
import { getPoiId, generateHWID, calculateDistance, isPointInPolygon, escapeXml, escapeHtml, calculateBarycenter, calculateAdjustedTime, getPoiProp, getAccessPoint } from '../src/utils.js';

describe('Utils', () => {
    describe('generateHWID', () => {
        it('should generate a string starting with HW-', () => {
            const id = generateHWID();
            expect(id.startsWith('HW-')).toBe(true);
        });

        it('should generate a 29 character string (HW- + 26 chars)', () => {
            const id = generateHWID();
            expect(id.length).toBe(29);
        });

        it('should be reasonably unique', () => {
            const id1 = generateHWID();
            const id2 = generateHWID();
            expect(id1).not.toBe(id2);
        });

        it('should only contain Crockford Base32 characters in the ULID part', () => {
            const id = generateHWID();
            const ulidPart = id.substring(3);
            expect(ulidPart).toMatch(/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]+$/);
        });
    });

    describe('calculateDistance (Haversine)', () => {
        it('should return 0 for same point', () => {
            expect(calculateDistance(48.8566, 2.3522, 48.8566, 2.3522)).toBe(0);
        });

        it('should calculate rough distance between Paris and London (~344km)', () => {
            const paris = { lat: 48.8566, lon: 2.3522 };
            const london = { lat: 51.5074, lon: -0.1278 };
            const dist = calculateDistance(paris.lat, paris.lon, london.lat, london.lon);
            // Allow some margin for formula precision (meters)
            expect(dist).toBeGreaterThan(340000);
            expect(dist).toBeLessThan(350000);
        });
    });

    describe('isPointInPolygon', () => {
        const square = [[0,0], [10,0], [10,10], [0,10], [0,0]]; // Closed loop

        it('should return true for point inside', () => {
            expect(isPointInPolygon([5, 5], square)).toBe(true);
        });

        it('should return false for point outside', () => {
            expect(isPointInPolygon([15, 5], square)).toBe(false);
        });
    });

    describe('escapeXml & escapeHtml', () => {
        it('should be aliases of the same function', () => {
            expect(escapeHtml).toBe(escapeXml);
        });

        it('should escape all standard HTML entities', () => {
            const input = '<div class="test">Jules & Friends\'s "Adventure"</div>';
            // Expectation based on current implementation:
            // < -> &lt;
            // > -> &gt;
            // & -> &amp;
            // " -> &quot;
            // ' -> &apos;
            const expected = '&lt;div class=&quot;test&quot;&gt;Jules &amp; Friends&apos;s &quot;Adventure&quot;&lt;/div&gt;';
            expect(escapeHtml(input)).toBe(expected);
        });

        it('should handle XSS attack vectors', () => {
            const xss = '<script>alert(1)</script>';
            expect(escapeHtml(xss)).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
        });

        it('should handle null and undefined by returning empty string', () => {
            expect(escapeHtml(null)).toBe('');
            expect(escapeHtml(undefined)).toBe('');
        });

        it('should handle empty strings', () => {
            expect(escapeHtml('')).toBe('');
        });

        it('should safely handle numbers (convert to string)', () => {
            expect(escapeHtml(123)).toBe('123');
            expect(escapeHtml(0)).toBe('0');
            expect(escapeHtml(12.34)).toBe('12.34');
        });

        it('should safely handle booleans (convert to string)', () => {
            expect(escapeHtml(true)).toBe('true');
            expect(escapeHtml(false)).toBe('false');
        });

        it('should not double escape already escaped entities (this is expected behavior for simple escapers)', () => {
            // A simple escaper usually escapes & again. Let's verify current behavior.
            // If input is "&amp;", output should be "&amp;amp;"
            expect(escapeHtml('&amp;')).toBe('&amp;amp;');
        });
    });

    describe('calculateBarycenter', () => {
        it('should calculate average coordinates', () => {
            const points = [
                { lat: 0, lng: 0 },
                { lat: 10, lng: 10 }
            ];
            const center = calculateBarycenter(points);
            expect(center.lat).toBe(5);
            expect(center.lng).toBe(5);
        });
    });

    describe('calculateAdjustedTime', () => {
        it('should add minutes correctly', () => {
            expect(calculateAdjustedTime(10, 30, 15)).toEqual({ h: 10, m: 45 });
        });

        it('should handle hour rollover', () => {
            expect(calculateAdjustedTime(10, 50, 20)).toEqual({ h: 11, m: 10 });
        });

        it('should handle negative time (reduce)', () => {
            expect(calculateAdjustedTime(10, 10, -20)).toEqual({ h: 9, m: 50 });
        });

        it('should clamp to zero', () => {
            expect(calculateAdjustedTime(0, 10, -20)).toEqual({ h: 0, m: 0 });
        });
    });

    describe('getPoiId', () => {
        it('should return null if feature is null or undefined', () => {
            expect(getPoiId(null)).toBe(null);
            expect(getPoiId(undefined)).toBe(null);
        });

        it('should return null if properties are missing', () => {
            expect(getPoiId({})).toBe(null);
            expect(getPoiId({ id: '123' })).toBe(null);
        });

        it('should return HW_ID if present in properties', () => {
            const feature = {
                properties: { HW_ID: 'POI_001' }
            };
            expect(getPoiId(feature)).toBe('POI_001');
        });

        it('should return feature.id if HW_ID is missing but id is present', () => {
            const feature = {
                id: 'GEO_123',
                properties: { name: 'Some Place' }
            };
            expect(getPoiId(feature)).toBe('GEO_123');
        });

        it('should prioritize HW_ID over feature.id', () => {
            const feature = {
                id: 'GEO_123',
                properties: { HW_ID: 'POI_001' }
            };
            expect(getPoiId(feature)).toBe('POI_001');
        });

        it('should return undefined if both HW_ID and id are missing but properties exist', () => {
            const feature = {
                properties: { name: 'Some Place' }
            };
            expect(getPoiId(feature)).toBe(undefined);
        });
    });

    describe('getPoiProp — convention userData overlay', () => {
        it('retourne la valeur de userData si présente (admin overlay prime)', () => {
            const f = { properties: { 'Catégorie': 'Mosquée', userData: { 'Catégorie': 'Marabout' } } };
            expect(getPoiProp(f, 'Catégorie')).toBe('Marabout');
        });

        it('retombe sur properties si userData n\'a pas la clé', () => {
            const f = { properties: { 'Catégorie': 'Mosquée', userData: { vu: true } } };
            expect(getPoiProp(f, 'Catégorie')).toBe('Mosquée');
        });

        it('retombe sur properties si pas de userData du tout', () => {
            const f = { properties: { 'Catégorie': 'Mosquée' } };
            expect(getPoiProp(f, 'Catégorie')).toBe('Mosquée');
        });

        it('respecte les valeurs falsy explicites de userData (false, 0, "")', () => {
            // Cas critique : admin a explicitement effacé via userData.X = false,
            // ne doit PAS retomber sur properties.X via un `||` naïf.
            const f1 = { properties: { vu: true, userData: { vu: false } } };
            expect(getPoiProp(f1, 'vu')).toBe(false);

            const f2 = { properties: { count: 5, userData: { count: 0 } } };
            expect(getPoiProp(f2, 'count')).toBe(0);

            const f3 = { properties: { nom: 'X', userData: { nom: '' } } };
            expect(getPoiProp(f3, 'nom')).toBe('');
        });

        it('retourne undefined si feature ou properties absent', () => {
            expect(getPoiProp(null, 'X')).toBeUndefined();
            expect(getPoiProp({}, 'X')).toBeUndefined();
            expect(getPoiProp({ properties: null }, 'X')).toBeUndefined();
        });

        it('retourne undefined si ni userData ni properties n\'ont la clé', () => {
            const f = { properties: { autre: 1, userData: { encore: 2 } } };
            expect(getPoiProp(f, 'absente')).toBeUndefined();
        });
    });

    describe('getAccessPoint — point d\'accès au tracé', () => {
        const feat = (props) => ({ properties: props });

        it('retourne [lon,lat] si défini et valide dans properties', () => {
            expect(getAccessPoint(feat({ accessPoint: [11.02, 33.79] }))).toEqual([11.02, 33.79]);
        });
        it('lit depuis l\'overlay userData (prime sur properties)', () => {
            const f = feat({ accessPoint: [1, 2], userData: { accessPoint: [11.5, 33.5] } });
            expect(getAccessPoint(f)).toEqual([11.5, 33.5]);
        });
        it('retourne null si absent', () => {
            expect(getAccessPoint(feat({}))).toBeNull();
            expect(getAccessPoint(feat({ userData: {} }))).toBeNull();
        });
        it('retourne null si invalide (null / longueur / non numérique / NaN)', () => {
            expect(getAccessPoint(feat({ accessPoint: null }))).toBeNull();
            expect(getAccessPoint(feat({ accessPoint: [11.0] }))).toBeNull();
            expect(getAccessPoint(feat({ accessPoint: ['a', 'b'] }))).toBeNull();
            expect(getAccessPoint(feat({ accessPoint: [NaN, 33] }))).toBeNull();
        });
        it('null dans userData prime et invalide le patrimoine publié (retrait)', () => {
            const f = feat({ accessPoint: [11.02, 33.79], userData: { accessPoint: null } });
            expect(getAccessPoint(f)).toBeNull();
        });
    });
});
