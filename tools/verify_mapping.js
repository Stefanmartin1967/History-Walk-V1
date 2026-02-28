const assert = require('assert');

const uData = {
    'description': "Très bel hôtel 4 *",
    'Catégorie': 'Culture et tradition',
    'Nom du site FR': 'Atelier Fathi',
    'timeH': 1,
    'timeM': 30,
    'price': 5
};

const origProps = {
    'Description': "Vieil hôtel",
    'Catégorie': 'Site historique',
    'Nom du site FR': 'Atelier',
    'Temps de visite': null,
    "Prix d'entrée": null
};

const DATA_DICTIONARY = {
    'description': 'Description',
    'Description_courte': 'Desc_wpt',
    'notes': 'Notes_internes',
    'price': "Prix d'entrée",
    'timeH': 'Temps de visite',
    'timeM': 'Temps de visite'
};

const ignoredKeys = ['visited', 'vu', 'planifie', 'planifieCounter', 'lat', 'lng', '_deleted'];
const contentChanges = [];

Object.keys(uData).forEach(key => {
    if (ignoredKeys.includes(key)) return;

    let targetKey = key;
    if (DATA_DICTIONARY[key]) {
        targetKey = DATA_DICTIONARY[key];
    }

    let oldVal = origProps[targetKey];

    // Fallbacks if original key doesn't strictly match the dictionary (e.g., lowercase description exists)
    if (oldVal === undefined && origProps[key] !== undefined) {
        oldVal = origProps[key];
        targetKey = key;
    }

    let newVal = uData[key];

    // Format new values
    if (key === 'price') newVal = newVal + ' TND';
    if (key === 'timeH' || key === 'timeM') {
       if (contentChanges.some(c => c.key === 'timeH' || c.key === 'timeM')) return; // Already handled
       const h = uData.timeH || 0;
       const m = uData.timeM || 0;
       newVal = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
       targetKey = 'Temps de visite';
       oldVal = origProps['Temps de visite'];
    }

    if (String(oldVal) !== String(newVal) && !(oldVal === undefined && newVal === "")) {
        let displayKey = targetKey;
        if (key === 'timeH' || key === 'timeM') displayKey = 'Temps de visite';

        contentChanges.push({
            originalKey: targetKey, // To apply correctly later
            sourceKey: key,         // The uData key
            displayKey: displayKey,
            old: oldVal !== undefined ? oldVal : '—',
            new: newVal
        });
    }
});

console.log(contentChanges);
