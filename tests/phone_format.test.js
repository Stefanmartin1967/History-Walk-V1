import { describe, it, expect } from 'vitest';
import { formatPhone, telHref } from '../src/utils.js';

// ============================================================================
// Téléphone — forme canonique du pays de la destination, quelle que soit la
// saisie (demande de Stefan, 16/08/2026 : « tous formatés de la même façon,
// indépendamment de la façon dont il est introduit »). Indicatif visible,
// confirmé : c'est la forme déjà en base et celle qui rend le lien `tel:`
// composable depuis un téléphone étranger.
//
// Règle de sûreté : contrairement à normalizeOsmRef, une saisie non reconnue
// n'est JAMAIS jetée — on la rend telle quelle.
// ============================================================================

const CANON = '+216 27 677 120';

describe('formatPhone — Tunisie', () => {
    it('accepte le numéro local, avec ou sans séparateurs', () => {
        expect(formatPhone('27677120', 'tn')).toBe(CANON);
        expect(formatPhone('27 677 120', 'tn')).toBe(CANON);
        expect(formatPhone('27-677-120', 'tn')).toBe(CANON);
        expect(formatPhone('27.677.120', 'tn')).toBe(CANON);
        expect(formatPhone('  27  677   120  ', 'tn')).toBe(CANON);
    });

    it('accepte la forme internationale sous ses variantes', () => {
        expect(formatPhone('+21627677120', 'tn')).toBe(CANON);
        expect(formatPhone('+216 27 677 120', 'tn')).toBe(CANON);
        expect(formatPhone('00216 27677120', 'tn')).toBe(CANON);
        expect(formatPhone('216 27 677 120', 'tn')).toBe(CANON);
        expect(formatPhone('(+216) 27/677/120', 'tn')).toBe(CANON);
    });

    it('est idempotente — reformater une valeur canonique ne la change pas', () => {
        expect(formatPhone(CANON, 'tn')).toBe(CANON);
        expect(formatPhone(formatPhone('27677120', 'tn'), 'tn')).toBe(CANON);
    });

    it('respecte la casse du pays (destinations.json écrit « tn »)', () => {
        expect(formatPhone('27677120', 'TN')).toBe(CANON);
    });

    it('conserve les numéros déjà en base à l\'identique', () => {
        // Les 4 seuls numéros saisis à ce jour (djerba.geojson) : rien à migrer.
        for (const n of ['+216 27 677 120', '+216 26 485 053',
                         '+216 21 330 265', '+216 55 512 556']) {
            expect(formatPhone(n, 'tn')).toBe(n);
        }
    });
});

describe('formatPhone — Belgique', () => {
    it('fixe à zone de deux chiffres (Charleroi 071) : 2-2-2-2', () => {
        const c = '+32 71 12 34 56';
        expect(formatPhone('071 12 34 56', 'be')).toBe(c);
        expect(formatPhone('071/12.34.56', 'be')).toBe(c);
        expect(formatPhone('071123456', 'be')).toBe(c);
        expect(formatPhone('+32 71 12 34 56', 'be')).toBe(c);
        expect(formatPhone('+32 (0)71 12 34 56', 'be')).toBe(c);
        expect(formatPhone('0032 71 12 34 56', 'be')).toBe(c);
        expect(formatPhone('3271123456', 'be')).toBe(c);
    });

    it("fixe à zone d'un chiffre (02 Bruxelles, 04 Liège) : 1-3-2-2", () => {
        expect(formatPhone('02 555 12 12', 'be')).toBe('+32 2 555 12 12');
        expect(formatPhone('04 123 45 67', 'be')).toBe('+32 4 123 45 67');
        expect(formatPhone('+3225551212', 'be')).toBe('+32 2 555 12 12');
    });

    it('portable 04xx (9 chiffres) : 3-2-2-2, distingué de Liège par la longueur', () => {
        expect(formatPhone('0474 12 34 56', 'be')).toBe('+32 474 12 34 56');
        expect(formatPhone('+32474123456', 'be')).toBe('+32 474 12 34 56');
        expect(formatPhone('0032 474/12.34.56', 'be')).toBe('+32 474 12 34 56');
    });

    it('conserve le numéro belge déjà en base et reste idempotente', () => {
        expect(formatPhone('+32 85 84 96 95', 'be')).toBe('+32 85 84 96 95');
        expect(formatPhone(formatPhone('0474123456', 'be'), 'be')).toBe('+32 474 12 34 56');
    });

    it('garde tels quels les numéros spéciaux et les longueurs inconnues', () => {
        expect(formatPhone('0800 12 345', 'be')).toBe('0800 12 345');
        expect(formatPhone('070 22 33 44', 'be')).toBe('070 22 33 44');
        expect(formatPhone('078 15 16 17', 'be')).toBe('078 15 16 17');
        expect(formatPhone('0900 12 345', 'be')).toBe('0900 12 345');
        expect(formatPhone('071 12 34 5', 'be')).toBe('071 12 34 5');
        // Sans le 0 national, un numéro local belge n'est pas reconnu (on ne devine pas)
        expect(formatPhone('71 12 34 56', 'be')).toBe('71 12 34 56');
        // Numéro tunisien saisi dans une fiche belge
        expect(formatPhone('+216 27 677 120', 'be')).toBe('+216 27 677 120');
    });
});

describe('formatPhone — ce qu\'on ne reformate PAS (et qu\'on ne perd pas)', () => {
    it('rend telle quelle une saisie qu\'aucun plan ne décrit', () => {
        // Deux numéros dans le champ
        expect(formatPhone('27 677 120 / 75 123 456', 'tn')).toBe('27 677 120 / 75 123 456');
        // Poste / mention libre
        expect(formatPhone('27677120 poste 3', 'tn')).toBe('27677120 poste 3');
        // Numéro étranger : reconnu par aucun plan tunisien
        expect(formatPhone('+33 1 42 68 53 00', 'tn')).toBe('+33 1 42 68 53 00');
        // Trop court / trop long
        expect(formatPhone('2767712', 'tn')).toBe('2767712');
        expect(formatPhone('276771201', 'tn')).toBe('276771201');
        // Texte libre
        expect(formatPhone('voir la page Facebook', 'tn')).toBe('voir la page Facebook');
    });

    it('ne prend pas un indicatif étranger pour un numéro local', () => {
        // 00 27 677120 = Afrique du Sud, pas « 00 » + indicatif tunisien
        expect(formatPhone('0027677120', 'tn')).toBe('0027677120');
    });

    it('normalise seulement les espaces quand le pays est inconnu', () => {
        // Aucune destination marocaine n'existe encore : pas de plan inventé.
        expect(formatPhone('0661 23 45 67', 'ma')).toBe('0661 23 45 67');
        expect(formatPhone('  27   677 120 ', '')).toBe('27 677 120');
        expect(formatPhone('27677120', undefined)).toBe('27677120');
    });

    it('tolère le vide et les entrées non textuelles', () => {
        expect(formatPhone('', 'tn')).toBe('');
        expect(formatPhone('   ', 'tn')).toBe('');
        expect(formatPhone(null, 'tn')).toBe('');
        expect(formatPhone(undefined, 'tn')).toBe('');
        expect(formatPhone(27677120, 'tn')).toBe('');
    });
});

describe('telHref', () => {
    it('compacte le numéro pour l\'attribut tel:', () => {
        expect(telHref(CANON)).toBe('+21627677120');
    });

    it('reste sans effet de bord sur une valeur vide', () => {
        expect(telHref('')).toBe('');
        expect(telHref(null)).toBe('');
    });
});
