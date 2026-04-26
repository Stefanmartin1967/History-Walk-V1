// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/toast.js', () => ({
    showToast: vi.fn()
}));

vi.mock('../src/lucide-icons.js', () => ({
    createIcons: vi.fn(),
    appIcons: {}
}));

import { showToast } from '../src/toast.js';
import { applyPunctuation, isDictationActive, speakText } from '../src/voice.js';

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('applyPunctuation — substitutions de base', () => {
    it('"point" → "."', () => {
        expect(applyPunctuation('hello point')).toBe('Hello.');
    });

    it('"virgule" → ","', () => {
        expect(applyPunctuation('a virgule b')).toBe('A, b');
    });

    it('"deux points" → ":"', () => {
        expect(applyPunctuation('liste deux points a')).toBe('Liste: a');
    });

    it('"point virgule" → ";"', () => {
        expect(applyPunctuation('a point virgule b')).toBe('A; b');
    });

    it('"point d\'exclamation" → "!"', () => {
        expect(applyPunctuation('super point d\'exclamation')).toBe('Super!');
    });

    it('"point d\'interrogation" → "?"', () => {
        expect(applyPunctuation('vraiment point d\'interrogation')).toBe('Vraiment?');
    });

    it('"ouvrir la parenthèse" / "fermer la parenthèse" → "(" / ")"', () => {
        const result = applyPunctuation('mot ouvrir la parenthèse note fermer la parenthèse');
        expect(result).toContain('(');
        expect(result).toContain(')');
    });

    it('"à la ligne" → "\\n" (frontières Unicode via \\p{L})', () => {
        const result = applyPunctuation('ligne1 à la ligne ligne2');
        expect(result).toContain('\n');
        expect(result).not.toContain('à la ligne');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('applyPunctuation — robustesse', () => {
    it('word boundary : "pointer" n\'est PAS transformé en ".er"', () => {
        const result = applyPunctuation('je vais pointer le doigt');
        expect(result).not.toContain('.er');
        expect(result).toContain('pointer');
    });

    it('case insensitive : "POINT" est aussi remplacé par "."', () => {
        expect(applyPunctuation('hello POINT')).toBe('Hello.');
    });

    it('espace avant ponctuation retiré : "mot ." → "mot."', () => {
        // "hello point" → "hello ." → cleanup → "hello." → cap → "Hello."
        // Le test "point" couvre déjà ça, mais on vérifie un cas multi-ponctuation
        const result = applyPunctuation('un point deux point');
        expect(result).not.toMatch(/\s\./);
    });

    it('espace ajouté après ponctuation suivie d\'une lettre + capitalisation', () => {
        // "abc point def" → "abc. def" (espace après .) → "Abc. Def" (cap début + après ". ")
        const result = applyPunctuation('abc point def');
        expect(result).toBe('Abc. Def');
    });

    it('capitalisation : début de chaîne mis en majuscule', () => {
        expect(applyPunctuation('hello')).toBe('Hello');
    });

    it('capitalisation : après ". " la lettre suivante en majuscule', () => {
        const result = applyPunctuation('un point deux');
        // "un point deux" → "un. deux" → cap → "Un. Deux"
        expect(result).toBe('Un. Deux');
    });

    it('phrase vide : retourne chaîne vide', () => {
        expect(applyPunctuation('')).toBe('');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('isDictationActive', () => {
    it('retourne false initialement (state.isActive = false par défaut)', () => {
        expect(isDictationActive()).toBe(false);
    });
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
