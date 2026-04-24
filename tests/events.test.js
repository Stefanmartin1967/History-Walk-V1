import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventBus } from '../src/events.js';

describe('EventBus', () => {
    let bus;

    beforeEach(() => {
        bus = new EventBus();
    });

    describe('on/emit/off basics', () => {
        it('appelle les listeners enregistrés avec les données émises', () => {
            const cb = vi.fn();
            bus.on('ping', cb);
            bus.emit('ping', { value: 42 });
            expect(cb).toHaveBeenCalledTimes(1);
            expect(cb).toHaveBeenCalledWith({ value: 42 });
        });

        it('ne fait rien si aucun listener', () => {
            expect(() => bus.emit('none', {})).not.toThrow();
        });

        it('off retire le listener ciblé sans toucher aux autres', () => {
            const a = vi.fn();
            const b = vi.fn();
            bus.on('ping', a);
            bus.on('ping', b);
            bus.off('ping', a);
            bus.emit('ping');
            expect(a).not.toHaveBeenCalled();
            expect(b).toHaveBeenCalledTimes(1);
        });
    });

    describe('isolation des exceptions (B.10)', () => {
        let errorSpy;

        beforeEach(() => {
            errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        });

        afterEach(() => {
            errorSpy.mockRestore();
        });

        it('une exception dans un listener NE ROMPT PAS la chaîne — les suivants sont appelés', () => {
            const before = vi.fn();
            const throwing = vi.fn(() => { throw new Error('boom'); });
            const after = vi.fn();

            bus.on('crash', before);
            bus.on('crash', throwing);
            bus.on('crash', after);

            expect(() => bus.emit('crash', 'payload')).not.toThrow();
            expect(before).toHaveBeenCalledWith('payload');
            expect(throwing).toHaveBeenCalledWith('payload');
            expect(after).toHaveBeenCalledWith('payload');
        });

        it('log console.error avec le nom de l\'évènement et l\'erreur', () => {
            const err = new Error('boom');
            bus.on('crash', () => { throw err; });
            bus.emit('crash');
            expect(errorSpy).toHaveBeenCalledTimes(1);
            const [msg, thrown] = errorSpy.mock.calls[0];
            expect(msg).toContain('crash');
            expect(thrown).toBe(err);
        });

        it('deux listeners qui jettent sont tous deux rapportés', () => {
            bus.on('crash', () => { throw new Error('a'); });
            bus.on('crash', () => { throw new Error('b'); });
            bus.emit('crash');
            expect(errorSpy).toHaveBeenCalledTimes(2);
        });
    });
});
