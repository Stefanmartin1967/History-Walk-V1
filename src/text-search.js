// text-search.js
//
// Clé de comparaison pour TOUTE recherche textuelle par nom (lieux, circuits,
// zones). Un seul but : que ce que l'utilisateur TAPE retrouve ce que la fiche
// STOCKE, même s'il n'a ni l'accent, ni le tiret, ni l'espace au bon endroit.
//
// Pourquoi un module à part plutôt qu'utils.js : aucune dépendance. utils.js
// importe zones.js et taxonomy.js, et il est mocké en entier par plusieurs
// fichiers de test — y ajouter un export oblige à mettre les mocks à jour et
// casse la suite au premier oubli (leçon PR #934, 34 tests d'un coup).
//
// La règle, volontairement UNE seule : on ne garde que les lettres et les
// chiffres, sans accents ni signes diacritiques, en minuscules.
//
// - Accents : `Ténafsa` était introuvable en tapant `tenafsa`, `Sidi Saïd` en
//   tapant `sidi said` — soit 41 des 409 noms de Djerba, et le premier réflexe
//   de n'importe quel clavier de téléphone.
// - Séparateurs (espace, tiret, apostrophe, ponctuation) : le même lieu s'écrit
//   `Hadherbach` chez nous et `Hadher Bach` sur OSM, `El-Guechaï` ici et
//   `El Guechai` ailleurs. Les supprimer des DEUX côtés rend la comparaison
//   insensible au découpage. Contrepartie assumée : la recherche peut matcher
//   à cheval sur deux mots — sans conséquence pratique sur des noms propres.
// - Arabe : les harakat sont des diacritiques, donc retirées ; et la
//   décomposition NFD ramène أ/إ/آ à ا, ce qui réconcilie `سيدي يأتي` (le
//   lieu-dit de Midoun sur OSM) et `سيدي ياتي` (le saint). Le tatweel ـ, lui,
//   est une lettre modificative (\p{L}) : il survivrait au filtre, on le
//   retire donc explicitement.
//
// Ce N'EST PAS un slugifieur : `makeUniqueDestId` (local-destinations.js) a sa
// propre normalisation, qui doit rendre du [a-z0-9-] et garder le tiret comme
// séparateur. Les deux règles doivent pouvoir diverger — on ne les fusionne pas.
export function foldForSearch(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/ـ/g, '')          // tatweel arabe : allongement décoratif
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '');
}
