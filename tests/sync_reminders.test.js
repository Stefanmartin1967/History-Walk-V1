// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Rappels « seulement sur cet appareil » (PR 9 « synchro users », écrans 52-54
// validés par Stefan le 23/11/2026).

const h = vi.hoisted(() => ({ linked: null, toasts: [], opened: [] }));
vi.mock('../src/google-account.js', () => ({ getLinkedAccount: () => h.linked, preloadGoogle: vi.fn() }));
vi.mock('../src/toast.js', () => ({ showToast: (...a) => h.toasts.push(a) }));
vi.mock('../src/modal.js', () => ({ openHwModal: vi.fn((o) => { h.opened.push(o); return new Promise(() => {}); }), closeHwModal: vi.fn() }));
vi.mock('../src/lucide-icons.js', () => ({ createIcons: vi.fn(), appIcons: {} }));

import { state } from '../src/state.js';
import {
    getSyncChoice, setSyncChoice, firstReminderSentence, maybeFirstReminder, reminderDue, maybeReminder, backupMenuHint,
} from '../src/sync-reminders.js';

const DAY = 24 * 3600 * 1000;

beforeEach(() => {
    localStorage.clear();
    h.linked = null; h.toasts = []; h.opened = [];
    state.isAdmin = false;
});

describe('le choix du user', () => {
    it('pas choisi, fichier, relié', () => {
        expect(getSyncChoice()).toBeNull();
        setSyncChoice('file');
        expect(getSyncChoice()).toBe('file');
        h.linked = { email: 'x' };
        expect(getSyncChoice()).toBe('google');
    });
});

describe('premier rappel (écran 52)', () => {
    it('dit quoi, avec le bon accord', () => {
        expect(firstReminderSentence({ kind: 'visit', name: 'Mosquée Fadhloun' })).toBe('Votre visite de <b>Mosquée Fadhloun</b> est enregistrée ici, sur cet appareil seulement.');
        expect(firstReminderSentence({ kind: 'place', name: 'Potale' })).toContain('est enregistré ici');
        expect(firstReminderSentence({ kind: 'circuit', name: 'Boucle' })).toContain('Votre circuit <b>Boucle</b> est enregistré');
        expect(firstReminderSentence({})).toBe('Votre modification est enregistrée ici, sur cet appareil seulement.');
    });
    it('une seule fois, jamais si relié, choisi ou admin', () => {
        expect(maybeFirstReminder({ kind: 'visit' })).toBe(true);
        expect(maybeFirstReminder({ kind: 'visit' })).toBe(false);
        localStorage.clear();
        setSyncChoice('file');
        expect(maybeFirstReminder()).toBe(false);
        localStorage.clear();
        state.isAdmin = true;
        expect(maybeFirstReminder()).toBe(false);
    });
});

describe('rappels suivants (écran 53)', () => {
    beforeEach(() => { localStorage.setItem('hw_sync_first_reminder', '1'); });

    it('toutes les 10 modifications depuis la dernière sauvegarde', () => {
        expect(reminderDue({ count: 9, lastTimestamp: 0 })).toBe(false);
        expect(maybeReminder({ count: 10, lastTimestamp: 0 })).toBe(true);
        expect(maybeReminder({ count: 15, lastTimestamp: 0 })).toBe(false);
        expect(maybeReminder({ count: 20, lastTimestamp: 0 })).toBe(true);
    });
    it('3 jours après la dernière sauvegarde, s’il y a au moins une modification', () => {
        const now = Date.now();
        expect(reminderDue({ count: 2, lastTimestamp: now - 4 * DAY }, now)).toBe(true);
        expect(reminderDue({ count: 0, lastTimestamp: now - 4 * DAY }, now)).toBe(false);
    });
    it('le toast redit pourquoi, et propose « Relier à mon compte Google »', () => {
        maybeReminder({ count: 12, lastTimestamp: Date.now() - DAY });
        const [msg, , , action] = h.toasts[0];
        expect(msg).toBe('12 modifications depuis votre dernière sauvegarde ne sont que sur cet appareil. Reliez Heripia à votre compte Google pour les garder.');
        expect(action.label).toBe('Relier à mon compte Google');
    });
    it('jamais sans le premier rappel, ni une fois relié', () => {
        localStorage.removeItem('hw_sync_first_reminder');
        expect(maybeReminder({ count: 10, lastTimestamp: 0 })).toBe(false);
        localStorage.setItem('hw_sync_first_reminder', '1');
        h.linked = { email: 'x' };
        expect(maybeReminder({ count: 10, lastTimestamp: 0 })).toBe(false);
    });
});

describe('indication du menu « Sauvegarder »', () => {
    it('combien de modifications, et depuis quand', () => {
        expect(backupMenuHint({ count: 12, lastTimestamp: 1 })).toBe('12 modifications depuis votre dernière sauvegarde');
        expect(backupMenuHint({ count: 1, lastTimestamp: 0 })).toBe('1 modification sur cet appareil seulement');
        expect(backupMenuHint({ count: 0, lastTimestamp: 1 })).toBeNull();
        h.linked = { email: 'x' };
        expect(backupMenuHint({ count: 12, lastTimestamp: 1 })).toBeNull();
    });
});
