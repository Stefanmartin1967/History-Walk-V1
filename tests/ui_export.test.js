// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleExportWithContribution } from '../src/fileManager.js';
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

describe('Export with Contribution Flow', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        state.isAdmin = false;
        // Mock global document for showCustomModal internals (though we mocked the function, the implementation might use document)
        // Since we mocked showCustomModal, we just need to test handleExportWithContribution logic
        global.document = {
            getElementById: vi.fn(),
            querySelector: vi.fn(),
            createElement: vi.fn(),
            body: { appendChild: vi.fn(), removeChild: vi.fn() }
        };
        global.window = {
            open: vi.fn()
        };
    });

    it('should show contribution modal for non-admin users', () => {
        const proceedCallback = vi.fn();
        handleExportWithContribution('gpx', proceedCallback);

        expect(modalModule.showCustomModal).toHaveBeenCalled();
        // The callback should NOT be called immediately
        expect(proceedCallback).not.toHaveBeenCalled();

        // Check if modal content contains key phrases
        const modalCall = modalModule.showCustomModal.mock.calls[0];
        expect(modalCall[0]).toBe("Soutenir le projet");
        expect(modalCall[1]).toContain("Contribuer à la maintenance");
    });

    it('should bypass modal for admin users', () => {
        state.isAdmin = true;
        const proceedCallback = vi.fn();
        handleExportWithContribution('gpx', proceedCallback);

        expect(modalModule.showCustomModal).not.toHaveBeenCalled();
        expect(proceedCallback).toHaveBeenCalled();
    });

    it('should configure correct labels based on action type', () => {
        handleExportWithContribution('gpx', vi.fn());
        expect(modalModule.showCustomModal.mock.calls[0][1]).toContain("Exporter le GPX");

        handleExportWithContribution('circuits', vi.fn());
        expect(modalModule.showCustomModal.mock.calls[1][1]).toContain("Exporter les Circuits");

        handleExportWithContribution('backup', vi.fn());
        expect(modalModule.showCustomModal.mock.calls[2][1]).toContain("Continuer la Sauvegarde");
    });

});
