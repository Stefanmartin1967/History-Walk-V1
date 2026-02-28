// Simulate the publishing process on this object
const finalFeatures = [{
    properties: {
        "Nom du site FR": "Test console suppression",
        "Catégorie": "Salon de thé",
        "Zone": "Houmt Souk",
        "timeH": 0,
        "timeM": 0,
        "price": 0,
        "HW_ID": "HW-01KJK2GG96X25DJWZDMKSD3ABM",
        "Description": "Ajouté via Rich Editor",
        "description": "Ajouté via Rich Editor",
        "userData": {
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
        }
    }
}];

const updates = {
    changes: [
      {
        sourceKey: 'description',
        targetKey: 'Description',
        displayKey: 'Description',
        old: 'Ajouté via Rich Editor',
        new: 'Salon de thé agrémenté de délicieux fruits secs grillés'
      }
    ]
};

// 2. Content Updates (Publish step logic)
const feat = finalFeatures[0];
updates.changes.forEach(c => {
    feat.properties[c.targetKey] = c.new;
});

// 5. NETTOYAGE COMPLET ET FINAL DES DOUBLONS AVANT ENVOI
finalFeatures.forEach(f => {
    if (f.properties && f.properties.userData) {
        // On s'assure que le champ userData ne part JAMAIS sur GitHub
        delete f.properties.userData;
    }
    // Also cleanup redundant mobile-specific keys that might have leaked into root properties
    // like the lowercase 'description', 'timeH', 'timeM', 'price' which are mapped to
    // 'Description', 'Temps de visite', 'Prix d'entrée' respectively.
    const redundantKeys = ['description', 'Description_courte', 'notes', 'price', 'timeH', 'timeM'];
    redundantKeys.forEach(k => {
        if (f.properties.hasOwnProperty(k)) {
            delete f.properties[k];
        }
    });
});

console.log(JSON.stringify(finalFeatures, null, 2));
