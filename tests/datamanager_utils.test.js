import { describe, it, expect } from 'vitest';
import { parseGps, generateHWID } from '../history_walk_datamanager/src/utils.js';

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

    // Audit 21/05/2026 — l'algorithme DM divergeait de HW : 36 chars random
    // sans timestamp → IDs non triables et non interchangeables. Aligné sur
    // l'algorithme HW (ULID Crockford base32 + timestamp).
    describe('generateHWID — alignement HW/DM', () => {
        it('génère un ID au format HW-XXXXXXXXXXXXXXXXXXXXXXXXXX (29 chars)', () => {
            const id = generateHWID();
            expect(id.startsWith('HW-')).toBe(true);
            expect(id.length).toBe(29);
        });

        it('utilise l\'alphabet Crockford base32 (pas de I, L, O, U)', () => {
            const id = generateHWID();
            const body = id.substring(3);
            expect(body).toMatch(/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]+$/);
            // Vérification explicite des caractères interdits Crockford
            expect(body).not.toMatch(/[ILOU]/);
        });

        it('génère un préfixe timestamp commun pour des IDs créés en rafale (triables)', () => {
            const ids = Array.from({ length: 5 }, () => generateHWID());
            // Les 10 premiers caractères (timestamp en base32) doivent être
            // identiques ou successifs pour 5 IDs créés en moins de 1 ms.
            const timestamps = ids.map(id => id.substring(3, 13));
            const sorted = [...timestamps].sort();
            expect(sorted).toEqual(timestamps);
        });

        it('est unique sur 50 itérations consécutives', () => {
            const ids = new Set();
            for (let i = 0; i < 50; i++) ids.add(generateHWID());
            expect(ids.size).toBe(50);
        });

        it('respecte la structure HW-ULID figée (29 chars, alphabet Crockford)', () => {
            // Test structurel sans cross-import de src/utils.js — le contrat
            // HW-ULID est codifié ici. Si l'algo HW change un jour, ces deux
            // assertions cassent et signalent qu'il faut re-synchroniser.
            const dm = generateHWID();
            const ALPHA = /^HW-[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;
            expect(dm).toMatch(ALPHA);
            expect(dm.length).toBe(29);
        });
    });
});
