// @vitest-environment jsdom
//
// Avertissements des aides (handoff « retouches testeurs », sujet 4, 11/10/2026).
// Le ton « avertissement » était porté par l'ambre : un fond crème fixe qui ne
// suivait pas le thème, d'où un texte clair sur fond clair en Nuit (note de test
// 3). Il est désormais porté par une icône alert-triangle, ajoutée AU RENDU :
// le contenu des aides (textes validés) ne change pas.
import { describe, it, expect, afterEach } from 'vitest';
import { openHelpPanel, closeHelp } from '../src/help-popover.js';
import { GUIDE_IMPORT } from '../src/help-content.js';

afterEach(() => { closeHelp(); document.body.innerHTML = ''; });

const drawer = () => document.querySelector('.help-drawer');

describe('aides — avertissements portés par une icône', () => {
    it('chaque encadré commence par l\'icône, son texte est regroupé à côté, inchangé', () => {
        openHelpPanel(GUIDE_IMPORT);
        const callouts = drawer().querySelectorAll('.help-callout');
        expect(callouts.length).toBeGreaterThan(0);
        callouts.forEach(c => {
            expect(c.firstElementChild.getAttribute('data-lucide')).toBe('alert-triangle');
            expect(c.children).toHaveLength(2);
            expect(c.lastElementChild.className).toBe('help-callout-body');
        });
        // Texte validé, intact : une phrase réelle du guide (étape 6).
        expect(drawer().textContent).toContain("Deux actions indépendantes : enregistrer ne crée pas de ZIP");
    });

    it('le titre d\'une section « avertissement » porte l\'icône, pas les autres', () => {
        openHelpPanel(GUIDE_IMPORT);
        const warn = drawer().querySelectorAll('.help-section[data-tone="warn"] > .help-section-title');
        expect(warn.length).toBeGreaterThan(0);
        warn.forEach(t => expect(t.firstElementChild.getAttribute('data-lucide')).toBe('alert-triangle'));
        const other = drawer().querySelector('.help-section:not([data-tone]) > .help-section-title');
        expect(other.querySelector('[data-lucide="alert-triangle"]')).toBeNull();
    });

    it('une seule icône par encadré, même si l\'aide est rouverte', () => {
        openHelpPanel(GUIDE_IMPORT);
        closeHelp();
        openHelpPanel(GUIDE_IMPORT);
        drawer().querySelectorAll('.help-callout').forEach(c => {
            expect(c.querySelectorAll('[data-lucide="alert-triangle"]')).toHaveLength(1);
        });
    });
});
