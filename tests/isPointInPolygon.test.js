import { describe, it, expect } from 'vitest';
import { isPointInPolygon } from '../history_walk_datamanager/src/utils.js';

describe('isPointInPolygon', () => {
    // Simple Square
    const square = [[0, 0], [10, 0], [10, 10], [0, 10]];

    it('should return true for a point strictly inside a square', () => {
        expect(isPointInPolygon([5, 5], square)).toBe(true);
    });

    it('should return false for a point strictly outside a square', () => {
        expect(isPointInPolygon([15, 5], square)).toBe(false);
        expect(isPointInPolygon([5, 15], square)).toBe(false);
        expect(isPointInPolygon([-5, 5], square)).toBe(false);
    });

    // Concave Polygon (L-shape)
    // (0,0) -> (10,0) -> (10,2) -> (2,2) -> (2,10) -> (0,10)
    const lShape = [[0, 0], [10, 0], [10, 2], [2, 2], [2, 10], [0, 10]];

    it('should return true for a point strictly inside an L-shaped polygon', () => {
        expect(isPointInPolygon([1, 1], lShape)).toBe(true);
        expect(isPointInPolygon([5, 1], lShape)).toBe(true); // horizontal leg
        expect(isPointInPolygon([1, 5], lShape)).toBe(true); // vertical leg
    });

    it('should return false for a point in the empty space of the L-shape', () => {
        expect(isPointInPolygon([5, 5], lShape)).toBe(false);
    });

    // Edge Cases
    it('should return false for an empty polygon', () => {
        expect(isPointInPolygon([0, 0], [])).toBe(false);
    });

    it('should return false for a single point polygon', () => {
        expect(isPointInPolygon([0, 0], [[1, 1]])).toBe(false);
    });

    it('should return false for a line segment polygon (degenerate)', () => {
        expect(isPointInPolygon([5, 5], [[0, 0], [10, 10]])).toBe(false);
    });
});
