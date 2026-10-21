// Tests du contrôle du Gabarit des descriptions (scripts/check-gabarit.mjs).
// Chaque règle : un cas fautif tiré d'une vraie dérive, et un cas conforme
// tiré d'une fiche publiée. La lecture du geojson (CLI) n'est pas testée ici.
import { describe, it, expect } from 'vitest';
import { REGLES, controlerFiche, fichesAControler, horsGuillemets } from '../scripts/check-gabarit.mjs';

const JALEL = 'Répertoire J. Fathallah, n° 318 | http://palaisbenayed.com/wp-content/uploads/2021/03/r%C3%A9pertoire-des-mosqu%C3%A9es-de-Djerba.pdf';

/** Identifiants des règles déclenchées par une fiche. */
const regles = (props) => [...new Set(controlerFiche(props).map(e => e.regle))];

// Ténafsa, modèle du Gabarit (§4) : doit passer toutes les règles.
const TENAFSA = {
    'Nom du site FR': 'Mosquée Ténafsa',
    description: 'Mosquée du quartier Ténafsa, à Midoun.\n'
        + 'Le répertoire des mosquées de Djerba de Jalel Fathallah l\'inscrit au n° 318 : mosquée malékite à origine nokkarite, de datation « ancienne ».\n'
        + 'Sur place, le nom « جامع التنافسة » est peint sur le mur de la mosquée ; deux mosquées sont accolées, l\'une plus ancienne, l\'autre plus récente.\n'
        + 'Appelée Ben Tanfouss sur OSM et Maps.',
    Source: `${JALEL}\nInscription peinte sur le mur de la mosquée et observation sur place, le 3 novembre 2025`,
};

describe('check-gabarit — le modèle du Gabarit est conforme', () => {
    it('Ténafsa ne déclenche aucune règle', () => {
        expect(controlerFiche(TENAFSA)).toEqual([]);
    });

    it('chaque règle a un identifiant unique, un paragraphe du Gabarit et un titre', () => {
        const ids = REGLES.map(r => r.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const r of REGLES) {
            expect(r.gabarit).toMatch(/^§/);
            expect(r.titre.length).toBeGreaterThan(10);
        }
    });
});

describe('check-gabarit — titre', () => {
    it('signale une qualité en tête ou un numéro', () => {
        expect(regles({ 'Nom du site FR': 'Ancienne Mosquée Sidi Nasr' })).toEqual(['titre']);
        expect(regles({ 'Nom du site FR': 'Mosquée Albert 2' })).toEqual(['titre']);
    });
    it('accepte la qualité entre parenthèses (§3 bis)', () => {
        expect(regles({ 'Nom du site FR': 'Mosquée Sidi Nasser (Ancienne)' })).toEqual([]);
    });
});

describe('check-gabarit — description', () => {
    it('date de visite dans la phrase (dérive du 16-18/10/2026)', () => {
        expect(regles({ description: 'Sur place, le 7 novembre 2025, la mosquée est désaffectée.' })).toEqual(['date-dans-la-phrase']);
        expect(regles({ description: 'Sur place, la mosquée est désaffectée.' })).toEqual([]);
    });

    it('visites multiples où le lieu a changé : « En novembre 2025, … » est admis (§3 quater)', () => {
        expect(regles({ description: 'En novembre 2025, la mosquée était en chantier ; en mars 2026, la restauration est achevée.' })).toEqual([]);
    });

    it('date en chiffres, dans la description comme dans la Source', () => {
        expect(regles({ Source: 'Plaque de la mosquée, relevée sur place le 11/03/2026' })).toEqual(['date-en-chiffres']);
        expect(regles({ Source: 'Plaque de la mosquée, relevée sur place le 11 mars 2026' })).toEqual([]);
        // Une URL qui contient des chiffres et des barres n'est pas une date.
        expect(regles({ Source: 'La Presse, « Article » | https://lapresse.tn/2025/08/26/article/' })).toEqual([]);
    });

    it('datation de Jalel sans guillemets', () => {
        const fautif = 'Le répertoire des mosquées de Djerba de Jalel Fathallah l\'inscrit au n° 231 : mosquée malékite, très récente.';
        expect(regles({ description: fautif })).toEqual(['datation-jalel']);
        expect(regles({ description: 'Le répertoire … l\'inscrit au n° 231 : mosquée malékite, de datation « très récente ».' })).toEqual([]);
    });

    it('datation : seule la phrase du répertoire compte, pas celle qui cite Wikipédia', () => {
        const d = 'Le répertoire des mosquées de Djerba de Jalel Fathallah l\'inscrit au n° 4 : mosquée wahbite abandonnée, de datation « très ancienne ». '
            + 'La liste Wikipédia des mosquées de Djerba la donne également abandonnée et très ancienne.';
        expect(regles({ description: d })).toEqual([]);
    });

    it('« ancienne » au sens de « disparue » dans la phrase du répertoire n\'est pas une datation', () => {
        const d = 'Le répertoire des mosquées de Djerba de Jalel Fathallah l\'inscrit au n° 120 sous le nom de Tagoumine : mosquée malékite construite sur le site de l\'ancienne mosquée ibadite, disparue ; datée de 2018.';
        expect(regles({ description: d })).toEqual([]);
    });

    it('« Ancienne mosquée » en tête', () => {
        expect(regles({ description: 'Ancienne mosquée de la campagne de Temlel.' })).toEqual(['ancienne-mosquee-en-tete']);
        expect(regles({ description: 'Mosquée de la campagne de Temlel.' })).toEqual([]);
    });

    it('siècles en chiffres romains ou sans exposant', () => {
        expect(regles({ description: 'Elle daterait du XVIIIe siècle.' })).toEqual(['siecle']);
        expect(regles({ description: 'Elle daterait du 18ème siècle.' })).toEqual(['siecle']);
        expect(regles({ description: 'Elle daterait du 18ᵉ siècle.' })).toEqual([]);
    });

    it('date de l\'hégire sans conversion', () => {
        expect(regles({ description: 'Datée de 1210 de l\'hégire.' })).toEqual(['hegire-sans-conversion']);
        expect(regles({ description: 'Datée de 1210 de l\'hégire, soit 1795.' })).toEqual([]);
        expect(regles({ description: 'Sa construction daterait du 4ᵉ siècle de l\'hégire (10ᵉ siècle de notre ère).' })).toEqual([]);
        expect(regles({ description: 'Une plaque porte les dates 1405 de l\'hégire et 1984.' })).toEqual([]);
    });

    it('lien dans la description', () => {
        expect(regles({ description: 'Voir https://fr.wikipedia.org/wiki/Djerba.' })).toEqual(['lien-dans-description']);
    });

    it('Facebook et l\'inventaire de Ramzi Raïs, mais pas le compte Commons de Mounir', () => {
        expect(regles({ Source: 'Ramzi Raïs, inventaire des mosquées, 2021' })).toEqual(['facebook']);
        expect(regles({ Source: 'Publication Facebook de la mosquée | https://www.facebook.com/x' })).toEqual(['facebook']);
        expect(regles({ Source: 'Wikimedia Commons, « Category:Gharib Mosque » (photos de Rais67, 23 août 2026) | https://commons.wikimedia.org/wiki/Category:Gharib_Mosque' })).toEqual([]);
    });

    it('guillemets non fermés, droits ou sans espace', () => {
        expect(regles({ description: 'Jalel l\'appelle « Hadada.' })).toEqual(['guillemets']);
        expect(regles({ description: 'Appelée "Ben Tanfouss" sur OSM.' })).toEqual(['guillemets']);
        expect(regles({ description: 'Appelée «Ben Tanfouss» sur OSM.' })).toEqual(['guillemets']);
    });

    it('première personne, hors citation et hors « notre ère »', () => {
        expect(regles({ description: 'Lors de notre passage, la porte était fermée.' })).toEqual(['premiere-personne']);
        expect(regles({ description: 'J\'ai pu descendre dans la partie souterraine.' })).toEqual(['premiere-personne']);
        expect(regles({ description: 'Elle daterait du 10ᵉ siècle de notre ère.' })).toEqual([]);
        expect(regles({ description: 'La plaque indique « Nous rendons hommage ».' })).toEqual([]);
    });

    it('intensifs, sauf la datation de Jalel citée', () => {
        expect(regles({ description: 'Une mosquée magnifique.' })).toEqual(['intensif']);
        expect(regles({ description: 'Mosquée malékite, de datation « très récente ».' })).toEqual([]);
    });

    it('remplissage et invitation', () => {
        expect(regles({ description: 'Un lieu à ne pas manquer.' })).toEqual(['remplissage']);
        expect(regles({ description: 'Atelier de poterie, recommandé par Heripia.' })).toEqual([]);
    });

    it('entrée de Jalel recopiée', () => {
        expect(regles({ description: 'Jalel n° 312 — « Mosquée Hadada. Hadada. Midoun. Mosquée malékite. Ancienne. »' })).toContain('transcription-jalel');
    });

    it('lecture de satellite', () => {
        expect(regles({ description: 'La vue satellite montre une parcelle plantée.' })).toEqual(['lecture-satellite']);
    });

    it('ligne vide entre deux paragraphes', () => {
        expect(regles({ description: 'Mosquée de Midoun.\n\nSur place, deux mosquées sont accolées.' })).toEqual(['ligne-vide']);
    });

    it('crédit OSM : forme et dernière ligne', () => {
        expect(regles({ description: 'Monument pyramidal.\nPetr Jenč - OpenStreetMap, 2024' })).toEqual([]);
        expect(regles({ description: 'Petr Jenč - OpenStreetMap, 2024\nMonument pyramidal.' })).toEqual(['credit-osm']);
        expect(regles({ description: 'Monument pyramidal.\nPetr Jenč – OpenStreetMap, 2024' })).toEqual(['credit-osm']);
    });
});

describe('check-gabarit — caractères collés (21/10/2026)', () => {
    const COURBE = String.fromCharCode(0x2019);   // apostrophe typographique (courbe)
    const RLM = String.fromCharCode(0x200F);      // marque droite-à-gauche, invisible
    const INSECABLE = String.fromCharCode(0x00A0); // espace insécable : typographie normale

    it('apostrophe courbe dans le titre, la description, la Source et la Description GPX', () => {
        expect(regles({ 'Nom du site FR': `Mosquée d${COURBE}Elyounsiine` })).toEqual(['apostrophe-courbe']);
        expect(regles({ description: `Du 9ᵉ siècle de l${COURBE}hégire, soit le 15ᵉ siècle.` })).toEqual(['apostrophe-courbe']);
        expect(regles({ Source: `Panneau de l${COURBE}entrée, relevé sur place le 4 novembre 2025` })).toEqual(['apostrophe-courbe']);
        expect(regles({ info_gpx: `Vue sur l${COURBE}île` })).toEqual(['apostrophe-courbe']);
    });

    it('l\'apostrophe droite passe', () => {
        expect(regles({ 'Nom du site FR': 'Mosquée d\'Elyounsiine', Source: 'Panneau de l\'entrée, relevé sur place le 4 novembre 2025' })).toEqual([]);
    });

    it('caractère invisible, montré par son code dans l\'extrait', () => {
        const ecarts = controlerFiche({ 'Nom du site FR': `Mosquée d'${RLM}Elyounsiine` });
        expect(ecarts.map(e => e.regle)).toEqual(['caractere-invisible']);
        expect(ecarts[0].extrait).toContain('U+200F');
    });

    it('caractère invisible dans le nom arabe aussi', () => {
        expect(regles({ 'Nom du site arabe': `جامع${RLM} النور` })).toEqual(['caractere-invisible']);
    });

    it('l\'espace insécable n\'est pas un caractère invisible visé', () => {
        expect(regles({ description: `Appelée «${INSECABLE}Ben Tanfouss${INSECABLE}» sur OSM.` })).toEqual([]);
    });
});

describe('check-gabarit — Source', () => {
    it('URL nue', () => {
        expect(regles({ Source: 'https://fr.wikipedia.org/wiki/Djerba' })).toEqual(['url-nue']);
    });

    it('libellé et URL sur deux lignes (piège du retour à la ligne)', () => {
        expect(regles({ Source: 'Wikipédia, « Djerba »\nhttps://fr.wikipedia.org/wiki/Djerba' }).sort()).toEqual(['source-sur-deux-lignes', 'url-nue']);
    });

    it('phrase de description collée dans la Source (Ténafsa le 15/10, Balhajjam)', () => {
        expect(regles({ Source: 'Sur place, le nom « جامع التنافسة » est peint sur le mur de la mosquée.' })).toEqual(['phrase-en-source']);
        expect(regles({ Source: 'Sa nature reste à confirmer sur place.' })).toEqual(['phrase-en-source']);
    });

    it('relevé sur place sans date, et visites multiples (§3 quater)', () => {
        expect(regles({ Source: 'Observation sur place' })).toEqual(['sur-place-sans-date']);
        expect(regles({ Source: 'Observation sur place, lors de trois visites : mars 2025, novembre 2025, mars 2026' })).toEqual([]);
        expect(regles({ Source: 'Plaque du puits, relevée sur place lors de deux visites : 10 mars 2025 et 3 novembre 2025' })).toEqual([]);
    });

    it('forme de l\'observation', () => {
        expect(regles({ Source: 'Inscriptions et observations relevées sur place le 14 novembre 2025' })).toEqual(['forme-observation']);
        expect(regles({ Source: 'Plaques de la mosquée et observation sur place, le 14 novembre 2025' })).toEqual([]);
        expect(regles({ Source: 'Observation sur place et carte du restaurant, le 16 mars 2026' })).toEqual([]);
    });

    it('forme du répertoire de Jalel', () => {
        expect(regles({ Source: 'Répertoire J. Fathallah, n° 318 | http://palaisbenayed.com/wp-content/uploads/2021/03/répertoire-des-mosquées-de-Djerba.pdf' })).toEqual(['forme-jalel']);
        expect(regles({ Source: JALEL })).toEqual([]);
    });

    it('forme Wikipédia', () => {
        expect(regles({ Source: 'Wikipedia | https://fr.wikipedia.org/wiki/Djerba' })).toEqual(['forme-wikipedia']);
        expect(regles({ Source: 'Wikipédia, « Djerba » | https://fr.wikipedia.org/wiki/Djerba' })).toEqual([]);
    });
});

describe('check-gabarit — choix des fiches', () => {
    const f = (props) => ({ type: 'Feature', geometry: null, properties: props });
    const features = [
        f({ HW_ID: 'A', 'Nom du site FR': 'Publique', descriptionPublic: true, description: 'x' }),
        f({ HW_ID: 'B', 'Nom du site FR': 'Brouillon', descriptionPublic: false, description: 'x' }),
        f({ HW_ID: 'C', 'Nom du site FR': 'Supprimée', descriptionPublic: true, description: 'x', userData: { _deleted: true } }),
        f({ HW_ID: 'D', 'Nom du site FR': 'Vide', descriptionPublic: false }),
    ];

    it('par défaut : les descriptions publiques, sans les fiches supprimées', () => {
        expect(fichesAControler(features).map(x => x.properties.HW_ID)).toEqual(['A']);
    });
    it('avec les brouillons : toute fiche qui a une description ou une Source', () => {
        expect(fichesAControler(features, { brouillons: true }).map(x => x.properties.HW_ID)).toEqual(['A', 'B']);
    });
    it('--fiche : par nom ou HW_ID, même en brouillon ; une fiche inconnue est une erreur', () => {
        expect(fichesAControler(features, { fiches: ['Brouillon', 'A'] }).map(x => x.properties.HW_ID)).toEqual(['A', 'B']);
        expect(() => fichesAControler(features, { fiches: ['Inconnue'] })).toThrow(/introuvable/);
    });
});

describe('check-gabarit — horsGuillemets', () => {
    it('retire le contenu des citations', () => {
        expect(horsGuillemets('mosquée, de datation « très récente ».')).toBe('mosquée, de datation « ».');
    });
});
