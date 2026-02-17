import { describe, it, expect } from 'vitest';
import { calculateDistance, isPointInPolygon, escapeXml, calculateBarycenter, calculateAdjustedTime } from '../src/utils.js';

describe('Utils', () => {
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

    describe('escapeXml', () => {
        it('should escape special characters', () => {
            expect(escapeXml('<script>')).toBe('&lt;script&gt;');
            expect(escapeXml('A & B')).toBe('A &amp; B');
            expect(escapeXml('"Quote"')).toBe('&quot;Quote&quot;');
        });

        it('should handle null/undefined', () => {
            expect(escapeXml(null)).toBe('');
            expect(escapeXml(undefined)).toBe('');
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
});
