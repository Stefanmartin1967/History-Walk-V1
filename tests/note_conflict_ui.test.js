// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Fenêtre « Résoudre la note » (18/11/2026, maquette « notes privées », écran 8).

vi.mock('../src/state.js', () => ({ state: { userData: {} } }));
vi.mock('../src/lucide-icons.js', () => ({ createIcons: vi.fn(), appIcons: {} }));
vi.mock('../src/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../src/note-sync.js', () => ({ resolveNoteConflict: vi.fn(async () => 'push') }));

import { state } from '../src/state.js';
import { resolveNoteConflict } from '../src/note-sync.js';
import { openNoteConflict } from '../src/note-conflict-ui.js';

const q = (sel) => document.querySelector(sel);

// L'observateur de modal.js réagit au DOM : on le laisse finir avant la fin du test.
afterEach(async () => { document.body.innerHTML = ''; await new Promise(r => setTimeout(r, 0)); });

beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    state.userData = { G: {
        notes: "Position enregistrée sur le sentier d'où grimper vers la grotte. Entrée 25 m plus au sud-est.",
        noteSync: { sha: 's8', base: "Position enregistrée sur le sentier d'où grimper vers la grotte.", dirty: true,
            remote: "Position enregistrée sur le sentier d'où grimper vers la grotte. Panneau « Fond des Haies » n° 5.", remoteSha: 's9' },
    } };
});

describe('openNoteConflict', () => {
    it('deux ajouts différents : réunis d’avance, cases cochées', () => {
        openNoteConflict('G', 'Grotte des Sarrasins');
        expect(q('.hw-modal-title').textContent).toContain('Grotte des Sarrasins');
        expect(q('.cc-conflict-merged')).not.toBeNull();
        const ta = q('#note-conflict-final');
        expect(ta.value).toContain('Entrée 25 m plus au sud-est.');
        expect(ta.value).toContain('Panneau « Fond des Haies » n° 5.');
        const boxes = [...document.querySelectorAll('input.cc-conflict-sentence')];
        expect(boxes).toHaveLength(2);
        expect(boxes.every(b => b.checked)).toBe(true);
    });

    it('décocher une phrase la retire ; « Garder » envoie la version finale', async () => {
        openNoteConflict('G', 'Grotte des Sarrasins');
        const box = [...document.querySelectorAll('input.cc-conflict-sentence')].find(b => b.dataset.sentence.startsWith('Panneau'));
        box.checked = false;
        box.dispatchEvent(new Event('change', { bubbles: true }));
        expect(q('#note-conflict-final').value).not.toContain('Panneau');
        q('[data-note-keep]').click();
        await Promise.resolve();
        expect(resolveNoteConflict).toHaveBeenCalledWith('G', "Position enregistrée sur le sentier d'où grimper vers la grotte. Entrée 25 m plus au sud-est.");
    });

    it('« Plus tard » : rien envoyé', () => {
        openNoteConflict('G', 'Grotte des Sarrasins');
        q('[data-note-later]').click();
        expect(resolveNoteConflict).not.toHaveBeenCalled();
    });
});
