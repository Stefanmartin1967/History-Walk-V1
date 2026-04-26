// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/toast.js', () => ({
    showToast: vi.fn()
}));

import { showToast } from '../src/toast.js';
import { speakText } from '../src/tts.js';

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('speakText', () => {
    it('speechSynthesis non supporté → toast warning', () => {
        vi.stubGlobal('speechSynthesis', undefined);
        speakText('hello', null);
        expect(showToast).toHaveBeenCalledWith(
            expect.stringContaining('Synthèse vocale non supportée'),
            'warning'
        );
    });

    it('text vide → toast info "champ est vide"', () => {
        const synthMock = {
            speaking: false,
            speak: vi.fn(),
            cancel: vi.fn()
        };
        vi.stubGlobal('speechSynthesis', synthMock);
        vi.stubGlobal('SpeechSynthesisUtterance', class {});

        speakText('', null);
        expect(showToast).toHaveBeenCalledWith(
            expect.stringContaining('champ est vide'),
            'info'
        );
        expect(synthMock.speak).not.toHaveBeenCalled();
    });

    it('text whitespace seulement → toast info', () => {
        const synthMock = { speaking: false, speak: vi.fn(), cancel: vi.fn() };
        vi.stubGlobal('speechSynthesis', synthMock);
        vi.stubGlobal('SpeechSynthesisUtterance', class {});

        speakText('   \n  ', null);
        expect(showToast).toHaveBeenCalledWith(
            expect.stringContaining('champ est vide'),
            'info'
        );
        expect(synthMock.speak).not.toHaveBeenCalled();
    });

    it('text valide → speechSynthesis.speak(utterance) appelé', () => {
        const synthMock = { speaking: false, speak: vi.fn(), cancel: vi.fn() };
        const utteranceInstances = [];
        class FakeUtterance {
            constructor(text) {
                this.text = text;
                this.lang = '';
                utteranceInstances.push(this);
            }
        }
        vi.stubGlobal('speechSynthesis', synthMock);
        vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);

        speakText('Bonjour', null);

        expect(synthMock.speak).toHaveBeenCalledTimes(1);
        const utterance = synthMock.speak.mock.calls[0][0];
        expect(utterance.text).toBe('Bonjour');
        expect(utterance.lang).toBe('fr-FR');
    });

    it('déjà speaking → speechSynthesis.cancel() + reset icon (pas de speak)', () => {
        const synthMock = { speaking: true, speak: vi.fn(), cancel: vi.fn() };
        vi.stubGlobal('speechSynthesis', synthMock);
        vi.stubGlobal('SpeechSynthesisUtterance', class {});

        const button = document.createElement('button');
        button.innerHTML = '<svg class="stop-icon"></svg>';

        speakText('texte ignoré', button);

        expect(synthMock.cancel).toHaveBeenCalled();
        expect(synthMock.speak).not.toHaveBeenCalled();
        // L'icône "play" (triangle <polygon>) est restaurée
        expect(button.innerHTML).toContain('polygon');
    });
});
