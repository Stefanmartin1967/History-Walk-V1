// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { showGitHubUploadModal } from '../src/admin.js';

// Mocks
vi.mock('../src/github-sync.js', () => ({
    getStoredToken: vi.fn(() => 'fake-token'),
    saveToken: vi.fn(),
    uploadFileToGitHub: vi.fn()
}));

// Mock modal functions
vi.mock('../src/modal.js', () => ({
    showAlert: vi.fn(),
    showConfirm: vi.fn() // We will mock implementation in tests
}));

describe('Admin Upload Security (Custom Modal)', () => {
    let overlay, title, message, actions;

    beforeEach(() => {
        // Setup DOM
        document.body.innerHTML = `
            <div id="custom-modal-overlay"></div>
            <div id="custom-modal-title"></div>
            <div id="custom-modal-message"></div>
            <div id="custom-modal-actions"></div>
        `;
        overlay = document.getElementById('custom-modal-overlay');
        title = document.getElementById('custom-modal-title');
        message = document.getElementById('custom-modal-message');
        actions = document.getElementById('custom-modal-actions');
    });

    afterEach(() => {
        document.body.innerHTML = '';
        vi.clearAllMocks();
    });

    it('should allow .gpx files without any confirmation modal', async () => {
        showGitHubUploadModal();
        const sendBtn = actions.querySelector('.hw-btn.hw-btn-primary');
        const fileInput = message.querySelector('#gh-file-input');

        const file = new File(['<gpx></gpx>'], 'test.gpx', { type: 'application/gpx+xml' });
        Object.defineProperty(fileInput, 'files', { value: [file] });

        const { uploadFileToGitHub } = await import('../src/github-sync.js');
        const { showConfirm } = await import('../src/modal.js');

        await sendBtn.click();

        expect(showConfirm).not.toHaveBeenCalled();
        expect(uploadFileToGitHub).toHaveBeenCalled();
    });

    it('should ask for confirmation (showConfirm) for .html files', async () => {
        showGitHubUploadModal();
        const sendBtn = actions.querySelector('.hw-btn.hw-btn-primary');
        const fileInput = message.querySelector('#gh-file-input');

        const file = new File(['<html></html>'], 'malicious.html', { type: 'text/html' });
        Object.defineProperty(fileInput, 'files', { value: [file] });

        const { uploadFileToGitHub } = await import('../src/github-sync.js');
        const { showConfirm } = await import('../src/modal.js');

        // Mock showConfirm to resolve TRUE (user accepts)
        showConfirm.mockResolvedValue(true);

        await sendBtn.click();

        expect(showConfirm).toHaveBeenCalled();
        expect(uploadFileToGitHub).toHaveBeenCalled();
    });

    it('should abort upload if showConfirm returns false', async () => {
        showGitHubUploadModal();
        const sendBtn = actions.querySelector('.hw-btn.hw-btn-primary');
        const fileInput = message.querySelector('#gh-file-input');

        const file = new File(['<html></html>'], 'malicious.html', { type: 'text/html' });
        Object.defineProperty(fileInput, 'files', { value: [file] });

        const { uploadFileToGitHub } = await import('../src/github-sync.js');
        const { showConfirm } = await import('../src/modal.js');

        // Mock showConfirm to resolve FALSE (user cancels)
        showConfirm.mockResolvedValue(false);

        await sendBtn.click();

        expect(showConfirm).toHaveBeenCalled();
        expect(uploadFileToGitHub).not.toHaveBeenCalled();
    });
});
