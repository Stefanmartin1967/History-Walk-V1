const origFeat = {
    properties: {
        "Nom du site FR": "Test console suppression",
        "Catégorie": "Salon de thé",
        "Zone": "Houmt Souk",
        "timeH": 0,
        "timeM": 0,
        "price": 0,
        "HW_ID": "HW-01KJK2GG96X25DJWZDMKSD3ABM",
        "Description": "Ajouté via Rich Editor",
        "description": "Ajouté via Rich Editor"
    }
};

const uData = {
    "Nom du site FR": "Test console suppression",
    "Catégorie": "Salon de thé",
    "Zone": "Houmt Souk",
    "description": "Salon de thé agrémenté de délicieux fruits secs grillés",
    "timeH": 0,
    "timeM": 0,
    "price": 0,
    "Nom du site arabe": "",
    "Description_courte": "",
    "notes": "",
    "Source": ""
};

const ignoredKeys = ['visited', 'vu', 'planifie', 'planifieCounter', 'lat', 'lng', '_deleted'];
const contentChanges = [];

const DATA_DICTIONARY = {
    'description': 'Description',
    'Description_courte': 'Desc_wpt',
    'notes': 'Notes_internes',
    'price': "Prix d'entrée",
    'timeH': 'Temps de visite',
    'timeM': 'Temps de visite'
};

const processedTime = { timeH: false, timeM: false };

Object.keys(uData).forEach(key => {
    if (ignoredKeys.includes(key)) return;

    let targetKey = key;
    if (DATA_DICTIONARY[key]) {
        targetKey = DATA_DICTIONARY[key];
    }

    let oldVal = origFeat.properties[targetKey];

    if (oldVal === undefined && origFeat.properties[key] !== undefined) {
        oldVal = origFeat.properties[key];
        targetKey = key;
    }

    let newVal = uData[key];

    if (key === 'price' && newVal !== undefined && newVal !== 0 && newVal !== "") {
        newVal = newVal + ' TND';
    } else if (key === 'timeH' || key === 'timeM') {
        if (processedTime[key]) return;

        const h = uData.timeH || 0;
        const m = uData.timeM || 0;

        if (h === 0 && m === 0) return;

        newVal = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
        targetKey = 'Temps de visite';
        oldVal = origFeat.properties['Temps de visite'];

        processedTime.timeH = true;
        processedTime.timeM = true;
    }

    if (String(oldVal) !== String(newVal) && !(oldVal === undefined && (newVal === "" || newVal === "00:00" || newVal === "0 TND"))) {
        let displayKey = targetKey;
        if (key === 'timeH' || key === 'timeM') displayKey = 'Temps de visite';

        if (contentChanges.some(c => c.targetKey === targetKey && c.sourceKey === key)) return;
        if ((key === 'timeH' || key === 'timeM') && contentChanges.some(c => c.targetKey === 'Temps de visite')) return;

        contentChanges.push({
            sourceKey: key,
            targetKey: targetKey,
            displayKey: displayKey,
            old: oldVal !== undefined ? oldVal : '—',
            new: newVal
        });
    }
});

console.log(contentChanges);
