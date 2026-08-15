// taxonomy.js — référentiel de la taxonomie POI : groupes / catégories / sous-types / état / accès.
// Module feuille (zéro dépendance), partagé HW + DM. Alimenté au boot par
// setTaxonomy() depuis poi-categories.json. Tant que ce JSON n'est pas chargé,
// le FALLBACK ci-dessous garantit un fonctionnement dégradé (catégories + groupes,
// sans la structure fine). FALLBACK à resynchroniser à la main avec le JSON.

const FALLBACK = {
    groups: ["Lieux de culte", "Site historique", "Architecture traditionnelle", "Culture & découvertes", "Manger & boire", "Services & commodités"],
    categories: [
        { label: "A définir", groupe: null },
        { label: "Artisanat", groupe: "Culture & découvertes" },
        { label: "Café", groupe: "Manger & boire" },
        { label: "Commerce", groupe: "Services & commodités" },
        { label: "Curiosité", groupe: "Culture & découvertes" },
        { label: "Église", groupe: "Lieux de culte" },
        { label: "Fortification", groupe: "Site historique" },
        { label: "Hôtel", groupe: "Services & commodités" },
        { label: "Mausolée", groupe: "Lieux de culte" },
        { label: "Marché", groupe: "Services & commodités" },
        { label: "Menzel", groupe: "Architecture traditionnelle", libelleDerive: true },
        { label: "Mosquée", groupe: "Lieux de culte" },
        { label: "Musée", groupe: "Culture & découvertes" },
        { label: "Pâtisserie", groupe: "Manger & boire" },
        { label: "Puits", groupe: "Architecture traditionnelle", libelleDerive: true },
        { label: "Restaurant", groupe: "Manger & boire" },
        { label: "Salon de thé", groupe: "Manger & boire" },
        { label: "Site archéologique", groupe: "Site historique" },
        { label: "Site funéraire", groupe: "Site historique" },
        { label: "Synagogue", groupe: "Lieux de culte" },
        { label: "Taxi", groupe: "Services & commodités" }
    ]
};

let _taxonomy = FALLBACK;

// Alimente le référentiel depuis poi-categories.json chargé. Conserve le
// FALLBACK si la donnée est absente ou malformée.
export function setTaxonomy(data) {
    if (data && Array.isArray(data.categories) && data.categories.length > 0) {
        _taxonomy = {
            groups: Array.isArray(data.groups) ? data.groups : [],
            categories: data.categories
        };
    }
}

function findCategory(label) {
    return _taxonomy.categories.find(c => c.label === label) || null;
}

// Liste plate triée des libellés de catégories — alimente POI_CATEGORIES (compat).
export function getCategoryLabels() {
    return _taxonomy.categories.map(c => c.label).sort((a, b) => a.localeCompare(b, 'fr'));
}

export function getGroups() {
    return [..._taxonomy.groups];
}

export function getGroupForCategory(label) {
    const cat = findCategory(label);
    return cat ? (cat.groupe ?? null) : null;
}

export function getCategoriesInGroup(groupe) {
    return _taxonomy.categories.filter(c => c.groupe === groupe).map(c => c.label);
}

// Sous-types d'une catégorie, filtrés par destination. Un sous-type "générique"
// est toujours retourné ; un sous-type à portée limitée n'est retourné que si
// destId figure dans sa portée.
export function getSubtypes(label, destId = null) {
    const cat = findCategory(label);
    if (!cat || !Array.isArray(cat.sousTypes)) return [];
    return cat.sousTypes
        .filter(st => st.portee === 'générique' || (Array.isArray(st.portee) && destId !== null && st.portee.includes(destId)))
        .map(st => st.label);
}

export function getStates(label) {
    const cat = findCategory(label);
    return Array.isArray(cat?.etats) ? [...cat.etats] : [];
}

export function getAccessValues(label) {
    const cat = findCategory(label);
    return cat?.acces?.valeurs ? [...cat.acces.valeurs] : [];
}

export function getAccessDefault(label) {
    const cat = findCategory(label);
    return cat?.acces?.defaut ?? null;
}

// True si la catégorie utilise un libellé dérivé quand le nom propre est vide.
export function usesDerivedLabel(label) {
    return findCategory(label)?.libelleDerive === true;
}

// Nom à afficher pour un POI : nom propre saisi, sinon libellé dérivé.
//  - catégorie à libellé dérivé + nom vide → "Catégorie — Zone"
//  - sinon, nom vide → "Catégorie" seule (jamais fusionnée avec la zone)
//
// Convention `userData` overlay : un nom/catégorie/zone modifié par l'admin via
// richEditor est stocké dans `userData`, qui doit primer sur `properties` (le
// patrimoine). Le merge est inline ici pour garder ce module feuille (zéro
// dépendance) — cf. utils.js getPoiProp pour le helper équivalent ailleurs.
export function getDisplayName(feature) {
    const p = (feature && feature.properties) || {};
    const merged = { ...p, ...(p.userData || {}) };
    const nom = (merged['Nom du site FR'] || '').trim();
    if (nom) return nom;
    const cat = merged['Catégorie'] || 'A définir';
    if (usesDerivedLabel(cat)) {
        const zone = (merged['Zone'] || '').trim();
        return zone ? `${cat} — ${zone}` : cat;
    }
    return cat;
}
