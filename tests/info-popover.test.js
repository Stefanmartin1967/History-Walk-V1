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

    it('le popover a le titre "Légende" (renommé en PR PC-3)', () => {
        showInfoPopover();
        const title = document.querySelector('.info-popover-title');
        expect(title?.textContent).toBe('Légende');
    });

    it('le popover a role="dialog" et aria-label="Légende"', () => {
        showInfoPopover();
        const popover = document.getElementById('info-popover');
        expect(popover.getAttribute('role')).toBe('dialog');
        expect(popover.getAttribute('aria-label')).toBe('Légende');
    });
});

describe('showInfoPopover — contenu légende', () => {
    it('affiche les 3 lignes de polylines (Vol d\'oiseau / Tracé réel / Circuit terminé)', () => {
        showInfoPopover();
        const items = document.querySelectorAll('.info-popover-legend-item');
        // 3 tracés (le sample cluster est désormais dans une grille séparée à 3
        // samples vert/jaune/rouge — voir test "3 cluster samples" plus bas).
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

describe('showInfoPopover — sections ajoutées en PR PC-3', () => {
    it('contient une section "Catégories de lieux" avec une grille des 20 catégories iconMap', () => {
        showInfoPopover();
        const txt = document.getElementById('info-popover').textContent;
        expect(txt).toContain('Catégories de lieux');
        // 20 catégories dans iconMap (cf. src/poi-icons.js) — taxonomie v2 :
        // les ex-catégories englobantes (« Site historique », « Culture et
        // tradition ») sont devenues des groupes, et les sous-types fonctionnels
        // (Fortification, Menzel…) sont promus catégories.
        const items = document.querySelectorAll('.info-popover-cat-item');
        expect(items).toHaveLength(20);
        // Vérification de quelques catégories représentatives
        expect(txt).toContain('Restaurant');
        expect(txt).toContain('Mosquée');
        expect(txt).toContain('Fortification');
    });

    it('contient une section "Regroupements" avec 3 samples cluster (vert/jaune/rouge)', () => {
        showInfoPopover();
        const txt = document.getElementById('info-popover').textContent;
        expect(txt).toContain('Regroupements');
        // Reproduit la sémantique tricolore Leaflet markercluster (small/medium/
        // large) plutôt qu'un seul sample bleu (qui aurait menti — Leaflet rend
        // vert/jaune/rouge selon densité, pas bleu).
        expect(document.querySelectorAll('.info-popover-cluster-sample')).toHaveLength(3);
        expect(document.querySelector('.info-popover-cluster-sample--small')).not.toBeNull();
        expect(document.querySelector('.info-popover-cluster-sample--medium')).not.toBeNull();
        expect(document.querySelector('.info-popover-cluster-sample--large')).not.toBeNull();
        // Labels descriptifs
        const labels = Array.from(document.querySelectorAll('.info-popover-cluster-label'))
            .map(l => l.textContent.trim());
        expect(labels).toEqual(['Quelques lieux', 'Plusieurs', 'Beaucoup']);
    });
});

describe('showInfoPopover — Visite guidée extraite (PR PC-2, 10/05/2026)', () => {
    // La Visite guidée a été promue en bouton dédié dans la topbar
    // (icône `compass`, btn-tour). Elle ne fait plus partie de la popover Info
    // qui est désormais purement une référence cartographique.
    it('NE contient PAS de bouton "Visite guidée" (extrait en topbar)', () => {
        showInfoPopover();
        expect(document.getElementById('info-popover-btn-tour')).toBeNull();
    });

    it('NE contient PAS de section divider (qui séparait légende/visite guidée)', () => {
        showInfoPopover();
        expect(document.querySelector('.info-popover-divider')).toBeNull();
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
