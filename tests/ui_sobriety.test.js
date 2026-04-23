// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleExportWithContribution, recordSupportClick } from '../src/fileManager.js';
import { state } from '../src/state.js';
import * as modalModule from '../src/modal.js';

// Mock dependencies
vi.mock('../src/modal.js', () => ({
    showCustomModal: vi.fn(),
    closeModal: vi.fn()
}));

vi.mock('../src/mobile-state.js', () => ({
    isMobileView: vi.fn().mockReturnValue(false)
}));

vi.mock('../src/mobile-nav.js', () => ({
    switchMobileView: vi.fn()
}));

vi.mock('../src/utils.js', () => ({
    downloadFile: vi.fn()
}));

describe('Contribution Modal Logic (Sobriety & Flow)', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        state.isAdmin = false;

        // Mock localStorage
        const localStorageMock = (function() {
            let store = {};
            return {
                getItem: function(key) {
                    return store[key] || null;
                },
                setItem: function(key, value) {
                    store[key] = value.toString();
                },
                clear: function() {
                    store = {};
                }
            };
        })();
        global.localStorage = localStorageMock;

        // Mock document methods used in handleExportWithContribution
        global.document = {
            getElementById: vi.fn().mockReturnValue({ onclick: null }),
            querySelector: vi.fn(),
            createElement: vi.fn(),
            body: { appendChild: vi.fn(), removeChild: vi.fn() }
        };
        global.window = {
            open: vi.fn()
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should show modal if user never clicked support', () => {
        const proceedCallback = vi.fn();
        handleExportWithContribution('gpx', proceedCallback);

        expect(modalModule.showCustomModal).toHaveBeenCalled();
        expect(proceedCallback).not.toHaveBeenCalled();
    });

    it('should bypass modal if user clicked support recently (< 30 days)', () => {
        const proceedCallback = vi.fn();

        // Simulate click 1 day ago
        const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
        localStorage.setItem('hw_last_support_click', oneDayAgo.toString());

        handleExportWithContribution('gpx', proceedCallback);

        expect(modalModule.showCustomModal).not.toHaveBeenCalled();
        expect(proceedCallback).toHaveBeenCalled();
    });

    it('should show modal again if user clicked long ago (> 30 days)', () => {
        const proceedCallback = vi.fn();

        // Simulate click 31 days ago
        const thirtyOneDaysAgo = Date.now() - (31 * 24 * 60 * 60 * 1000);
        localStorage.setItem('hw_last_support_click', thirtyOneDaysAgo.toString());

        handleExportWithContribution('gpx', proceedCallback);

        expect(modalModule.showCustomModal).toHaveBeenCalled();
        expect(proceedCallback).not.toHaveBeenCalled();
    });

    it('should record timestamp when recordSupportClick is called', () => {
        recordSupportClick();
        const stored = localStorage.getItem('hw_last_support_click');
        expect(stored).toBeTruthy();
        // Check if stored timestamp is close to now
        expect(parseInt(stored)).toBeGreaterThan(Date.now() - 1000);
    });

    it('should bypass modal for admin users regardless of history', () => {
        state.isAdmin = true;
        const proceedCallback = vi.fn();

        handleExportWithContribution('gpx', proceedCallback);

        expect(modalModule.showCustomModal).not.toHaveBeenCalled();
        expect(proceedCallback).toHaveBeenCalled();
    });

});
