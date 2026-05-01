// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { showInfoPopover } from '../src/info-popover.js';

beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    // L'icône anchor doit exister pour que le popover puisse se positionner
    const anchor = document.createElement('button');
    anchor.id = 'btn-legend';
    document.body.appendChild(anchor);
});

describe('showInfoPopover — création', () => {
    it('crée le popover s\'il n\'existe pas', () => {
        showInfoPopover();
        expect(document.getElementById('info-popover')).not.toBeNull();
    });

    it('le popover a le titre "Informations"', () => {
        showInfoPopover();
        const title = document.querySelector('.info-popover-title');
        expect(title?.textContent).toBe('Informations');
    });

    it('le popover a role="dialog" et aria-label="Informations"', () => {
        showInfoPopover();
        const popover = document.getElementById('info-popover');
        expect(popover.getAttribute('role')).toBe('dialog');
        expect(popover.getAttribute('aria-label')).toBe('Informations');
    });
});

describe('showInfoPopover — contenu légende', () => {
    it('affiche les 3 lignes de polylines (Vol d\'oiseau / Tracé réel / Circuit terminé)', () => {
        showInfoPopover();
        const items = document.querySelectorAll('.info-popover-legend-item');
        expect(items).toHaveLength(3);
        const labels = Array.from(document.querySelectorAll('.info-popover-legend-label'))
            .map(l => l.textContent.trim());
        expect(labels).toEqual(['Vol d\'oiseau', 'Tracé réel', 'Circuit terminé']);
    });

    it('chaque ligne a un label en gras et une description en dessous (pas de parenthèses)', () => {
        showInfoPopover();
        const item = document.querySelector('.info-popover-legend-item');
        expect(item.querySelector('.info-popover-legend-label')).not.toBeNull();
        expect(item.querySelector('.info-popover-legend-desc')).not.toBeNull();
        expect(item.textContent).not.toContain('(');
    });

    it('utilise les bonnes classes pour les couleurs des lignes', () => {
        showInfoPopover();
        expect(document.querySelector('.legend-line-sample--straight')).not.toBeNull();
        expect(document.querySelector('.legend-line-sample--gps')).not.toBeNull();
        expect(document.querySelector('.legend-line-sample--done')).not.toBeNull();
    });

    it('PAS de section "Marqueurs" (Visité/Planifié/Incontournable retirés du visuel carte)', () => {
        showInfoPopover();
        const txt = document.getElementById('info-popover').textContent;
        expect(txt).not.toContain('Marqueurs');
        expect(txt).not.toContain('Visité');
        expect(txt).not.toContain('Planifié');
        expect(txt).not.toContain('Incontournable');
    });
});

describe('showInfoPopover — bouton Visite guidée', () => {
    it('contient un bouton "Visite guidée"', () => {
        showInfoPopover();
        const btn = document.getElementById('info-popover-btn-tour');
        expect(btn).not.toBeNull();
        expect(btn.textContent.trim()).toContain('Visite guidée');
    });

    it('clic sur "Visite guidée" ferme le popover et déclenche la modal de bienvenue (4 cartes)', () => {
        showInfoPopover();
        document.getElementById('info-popover-btn-tour').click();
        // Popover fermé
        expect(document.getElementById('info-popover')).toBeNull();
        // Modal de bienvenue ouverte avec 4 cartes (mode "revoir")
        const cards = document.querySelectorAll('.welcome-card');
        expect(cards).toHaveLength(4);
    });
});

describe('showInfoPopover — toggle et fermeture', () => {
    it('appel répété ferme le popover (toggle)', () => {
        showInfoPopover();
        expect(document.getElementById('info-popover')).not.toBeNull();
        showInfoPopover();
        expect(document.getElementById('info-popover')).toBeNull();
    });

    it('clic sur la croix ferme le popover', () => {
        showInfoPopover();
        document.querySelector('.info-popover-close').click();
        expect(document.getElementById('info-popover')).toBeNull();
    });

    it('touche Échap ferme le popover', () => {
        showInfoPopover();
        return new Promise(resolve => {
            setTimeout(() => {
                const evt = new KeyboardEvent('keydown', { key: 'Escape' });
                document.dispatchEvent(evt);
                expect(document.getElementById('info-popover')).toBeNull();
                resolve();
            }, 5);
        });
    });

    it('clic à l\'extérieur ferme le popover', () => {
        showInfoPopover();
        // setTimeout différé pour le binding du listener
        return new Promise(resolve => {
            setTimeout(() => {
                const outside = document.createElement('div');
                document.body.appendChild(outside);
                outside.click();
                expect(document.getElementById('info-popover')).toBeNull();
                resolve();
            }, 5);
        });
    });

    it('clic à l\'intérieur du popover NE ferme pas', () => {
        showInfoPopover();
        return new Promise(resolve => {
            setTimeout(() => {
                document.querySelector('.info-popover-title').click();
                expect(document.getElementById('info-popover')).not.toBeNull();
                resolve();
            }, 5);
        });
    });
});

describe('showInfoPopover — robustesse', () => {
    it('ne plante pas si l\'anchor #btn-legend est absent', () => {
        document.body.innerHTML = ''; // anchor retiré
        expect(() => showInfoPopover()).not.toThrow();
    });
});
