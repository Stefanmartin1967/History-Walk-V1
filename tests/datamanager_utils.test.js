import { describe, it, expect } from 'vitest';
import { parseGps } from '../history_walk_datamanager/src/utils.js';

describe('DataManager Utils', () => {
    describe('parseGps', () => {
        it('should return null for null or undefined input', () => {
            expect(parseGps(null)).toBe(null);
            expect(parseGps(undefined)).toBe(null);
        });

        it('should return null for empty string', () => {
            expect(parseGps('')).toBe(null);
            expect(parseGps('   ')).toBe(null);
        });

        it('should parse comma-separated coordinates', () => {
            expect(parseGps('48.8566, 2.3522')).toEqual({ lat: 48.8566, lon: 2.3522 });
        });

        it('should parse space-separated coordinates', () => {
            expect(parseGps('48.8566 2.3522')).toEqual({ lat: 48.8566, lon: 2.3522 });
        });

        it('should parse semicolon-separated coordinates', () => {
            expect(parseGps('48.8566; 2.3522')).toEqual({ lat: 48.8566, lon: 2.3522 });
        });

        it('should handle extra spaces', () => {
            expect(parseGps('  48.8566    2.3522  ')).toEqual({ lat: 48.8566, lon: 2.3522 });
        });

        it('should handle negative coordinates', () => {
            expect(parseGps('-12.3, -45.6')).toEqual({ lat: -12.3, lon: -45.6 });
        });

        it('should return null for invalid input (single value)', () => {
            expect(parseGps('48.8566')).toBe(null);
        });

        it('should return null for non-numeric values', () => {
            expect(parseGps('abc, def')).toBe(null);
        });

        it('should return null if one part is non-numeric', () => {
            expect(parseGps('48.8566, def')).toBe(null);
        });

        // New tests
        it('should handle newlines and tabs', () => {
            expect(parseGps('48.8566\n2.3522')).toEqual({ lat: 48.8566, lon: 2.3522 });
            expect(parseGps('48.8566\t2.3522')).toEqual({ lat: 48.8566, lon: 2.3522 });
        });

        it('should handle scientific notation', () => {
            expect(parseGps('1.2e-4, 5.6E2')).toEqual({ lat: 0.00012, lon: 560 });
        });

        it('should handle multiple separators', () => {
             expect(parseGps('48.8566,, 2.3522')).toEqual({ lat: 48.8566, lon: 2.3522 });
             expect(parseGps('48.8566;; 2.3522')).toEqual({ lat: 48.8566, lon: 2.3522 });
        });

        it('should handle integers', () => {
             expect(parseGps('48, 2')).toEqual({ lat: 48, lon: 2 });
        });

        it('should handle trailing text/numbers gracefully (parsing first two numbers)', () => {
             expect(parseGps('48.8566, 2.3522, 100')).toEqual({ lat: 48.8566, lon: 2.3522 });
             expect(parseGps('48.8566 2.3522 extra text')).toEqual({ lat: 48.8566, lon: 2.3522 });
        });

        it('should return null if valid numbers are mixed with invalid text in first two positions', () => {
             expect(parseGps('text 48.8566 2.3522')).toBe(null);
             expect(parseGps('48.8566 text 2.3522')).toBe(null);
        });
    });
});
