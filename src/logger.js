// logger.js
import { initDB } from './database.js';
import { state } from './state.js';

async function getDbConnection() {
    return initDB();
}

export async function logModification(poiId, action, field, oldValue, newValue) {
    let db;
    try {
        db = await getDbConnection();
        const transaction = db.transaction('modifications', 'readwrite');
        const store = transaction.objectStore('modifications');
        
        const poi = state.loadedFeatures.find(f => f.properties.HW_ID === poiId);
        const poiName = poi ? (poi.properties.userData?.custom_title || poi.properties['Nom du site FR']) : 'N/A';

        const logEntry = {
            timestamp: new Date().toISOString(),
            poiId,
            poiName: poiName || 'N/A',
            action,
            field: field || 'N/A',
            oldValue: oldValue !== undefined && oldValue !== null ? JSON.stringify(oldValue) : JSON.stringify(''),
            newValue: newValue !== undefined && newValue !== null ? JSON.stringify(newValue) : JSON.stringify('')
        };
        store.add(logEntry);
    } catch (error) {
        console.error("Impossible d'enregistrer la modification dans le journal:", error);
    } finally {
        if (db) db.close();
    }
}