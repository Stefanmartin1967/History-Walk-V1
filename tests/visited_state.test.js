import { describe, it, expect, vi, beforeEach } from 'vitest';

// Statut « Visité » — correctif du 17/09/2026 (remise en ordre des visites de
// Djerba). Deux défauts : un circuit supprimé laissait ses lieux « visités » à
// jamais, et la synchro Gist faisait toujours gagner « visité ».

const { sharedState } = vi.hoisted(() => ({
    sharedState: { officialCircuits: [], myCircuits: [], userData: {} },
}));
vi.mock('../src/state.js', () => ({ state: sharedState }));

import {
    isVisitCircuitKnown, computeVu, stampVisited, refreshVisitedFromCircuits,
    mergeVisited, mergeCircuitDone,
} from '../src/visited-state.js';

beforeEach(() => {
    sharedState.officialCircuits = [{ id: 'OFF' }];
    sharedState.myCircuits = [{ id: 'PERSO' }, { id: 'CORBEILLE', isDeleted: true }];
    sharedState.userData = {};
});

describe('isVisitCircuitKnown', () => {
    it('circuit officiel ou perso existant → compte', () => {
        expect(isVisitCircuitKnown('OFF')).toBe(true);
        expect(isVisitCircuitKnown('PERSO')).toBe(true);
    });

    it('circuit supprimé (absent) ou à la corbeille → ne compte plus', () => {
        expect(isVisitCircuitKnown('SUPPRIME')).toBe(false);
        expect(isVisitCircuitKnown('CORBEILLE')).toBe(false);
    });

    it('aucun officiel chargé (boot, hors-ligne, index illisible) → rien n’est écarté', () => {
        sharedState.officialCircuits = [];
        expect(isVisitCircuitKnown('SUPPRIME')).toBe(true);
    });

    it('comparaison en chaîne (id numérique toléré)', () => {
        sharedState.officialCircuits = [{ id: 1771324790804 }];
        expect(isVisitCircuitKnown('1771324790804')).toBe(true);
    });
});

describe('computeVu', () => {
    it('coché à la main → visité, quels que soient les circuits', () => {
        expect(computeVu({ vuManual: true, visitedByCircuits: ['SUPPRIME'] })).toBe(true);
    });

    it('seul un circuit supprimé le marquait → plus visité (cas El Abied → Sidi Nasr)', () => {
        expect(computeVu({ vuManual: false, visitedByCircuits: ['SUPPRIME'] })).toBe(false);
    });

    it('un circuit existant parmi d’autres suffit', () => {
        expect(computeVu({ visitedByCircuits: ['SUPPRIME', 'OFF'] })).toBe(true);
    });

    it('userData absent ou vide → non visité', () => {
        expect(computeVu(null)).toBe(false);
        expect(computeVu({})).toBe(false);
    });
});

describe('stampVisited', () => {
    it('pose la date du changement', () => {
        const ud = {};
        stampVisited(ud, 1234);
        expect(ud.vuUpdatedAt).toBe(1234);
    });

    it('userData nul → sans effet', () => {
        expect(() => stampVisited(null)).not.toThrow();
    });
});

describe('refreshVisitedFromCircuits', () => {
    it('corrige les lieux dont le seul circuit a disparu, sans toucher aux autres', () => {
        sharedState.userData = {
            orphelin: { vu: true, vuManual: false, visitedByCircuits: ['SUPPRIME'] },
            manuel: { vu: true, vuManual: true, visitedByCircuits: ['SUPPRIME'] },
            valide: { vu: true, visitedByCircuits: ['OFF'] },
        };
        expect(refreshVisitedFromCircuits()).toBe(true);
        expect(sharedState.userData.orphelin.vu).toBe(false);
        expect(sharedState.userData.orphelin.visitedByCircuits).toEqual(['SUPPRIME']); // rien n'est effacé
        expect(sharedState.userData.manuel.vu).toBe(true);
        expect(sharedState.userData.valide.vu).toBe(true);
    });

    it('un circuit restauré de la corbeille rend de nouveau ses lieux visités', () => {
        sharedState.userData = { p: { vu: false, visitedByCircuits: ['CORBEILLE'] } };
        sharedState.myCircuits[1].isDeleted = false;
        expect(refreshVisitedFromCircuits()).toBe(true);
        expect(sharedState.userData.p.vu).toBe(true);
    });

    it('rien à changer → false (pas de rafraîchissement de carte inutile)', () => {
        sharedState.userData = { a: { vu: true, vuManual: true }, b: { notes: 'x' } };
        expect(refreshVisitedFromCircuits()).toBe(false);
        expect('vu' in sharedState.userData.b).toBe(false);
    });
});

describe('mergeVisited — la modification la plus récente gagne', () => {
    it('PC décoche (récent), téléphone encore coché (ancien) → le PC garde « non visité »', () => {
        const local = { vuManual: false, visitedByCircuits: [], vuUpdatedAt: 200 };
        const remote = { vuManual: true, visitedByCircuits: ['OFF'], vuUpdatedAt: 100 };
        expect(mergeVisited(local, remote)).toBeNull();
    });

    it('décoché ailleurs plus récemment → le décochage arrive ici, circuits compris', () => {
        const local = { vuManual: true, visitedByCircuits: ['OFF'], vuUpdatedAt: 100 };
        const remote = { vuManual: false, visitedByCircuits: [], vuUpdatedAt: 200 };
        expect(mergeVisited(local, remote)).toEqual({ vuManual: false, visitedByCircuits: [], vuUpdatedAt: 200 });
    });

    it('local sans date (donnée ancienne), distant daté → le distant gagne', () => {
        const local = { vuManual: true };
        const remote = { vuManual: false, vuUpdatedAt: 50 };
        expect(mergeVisited(local, remote)).toEqual({ vuManual: false, visitedByCircuits: [], vuUpdatedAt: 50 });
    });

    it('local daté, distant sans date (appareil pas encore à jour) → le local reste', () => {
        const local = { vuManual: false, vuUpdatedAt: 50 };
        const remote = { vuManual: true, visitedByCircuits: ['OFF'] };
        expect(mergeVisited(local, remote)).toBeNull();
    });

    it('dates égales → le local reste (pas de réécriture en boucle)', () => {
        expect(mergeVisited({ vuManual: true, vuUpdatedAt: 7 }, { vuManual: false, vuUpdatedAt: 7 })).toBeNull();
    });

    it('la liste distante est copiée, pas partagée', () => {
        const remote = { visitedByCircuits: ['OFF'], vuUpdatedAt: 2 };
        const patch = mergeVisited({ vuUpdatedAt: 1 }, remote);
        patch.visitedByCircuits.push('X');
        expect(remote.visitedByCircuits).toEqual(['OFF']);
    });
});

describe('mergeVisited — sans date des deux côtés : règle d’avant', () => {
    it('vuManual : true gagne', () => {
        expect(mergeVisited({ vuManual: false }, { vuManual: true })).toEqual({ vuManual: true });
    });

    it('vuManual distant false → rien', () => {
        expect(mergeVisited({ vuManual: true }, { vuManual: false })).toBeNull();
    });

    it('visitedByCircuits : union', () => {
        expect(mergeVisited({ visitedByCircuits: ['A'] }, { visitedByCircuits: ['B'] }))
            .toEqual({ visitedByCircuits: ['A', 'B'] });
    });

    it('vu distant non migré → lu comme vuManual', () => {
        expect(mergeVisited({}, { vu: true })).toEqual({ vuManual: true });
    });
});

describe('mergeCircuitDone', () => {
    it('« pas fait » posé ailleurs plus récemment → se propage', () => {
        expect(mergeCircuitDone(true, 100, false, 200)).toEqual({ value: false, stamp: 200 });
    });

    it('« pas fait » local plus récent → un « fait » ancien ne revient pas', () => {
        expect(mergeCircuitDone(false, 200, true, 100)).toBeNull();
    });

    it('local sans date, distant daté → le distant gagne', () => {
        expect(mergeCircuitDone(true, undefined, false, 10)).toEqual({ value: false, stamp: 10 });
    });

    it('sans date des deux côtés : true gagne, false n’efface rien', () => {
        expect(mergeCircuitDone(false, undefined, true, undefined)).toEqual({ value: true, stamp: null });
        expect(mergeCircuitDone(true, undefined, false, undefined)).toBeNull();
    });
});
