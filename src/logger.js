// logger.js
import { initDB } from './database.js';
import { downloadFile } from './utils.js';
import { state } from './state.js';
import { showToast } from './toast.js';

async function getDbConnection() {
    await initDB();
    const request = indexedDB.open('HistoryWalkDB');
    return new Promise((resolve, reject) => {
        request.onsuccess = event => resolve(event.target.result);
        request.onerror = event => reject(event.target.error);
    });
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

export async function exportModificationLog() {
    let db;
    try {
        db = await getDbConnection();
        const transaction = db.transaction('modifications', 'readonly');
        const store = transaction.objectStore('modifications');
        const allLogs = await new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = (event) => reject(event.target.error);
        });

        if (allLogs.length === 0) {
            showToast("Le journal des modifications est vide.", 'info');
            return;
        }

        const headers = ['Timestamp', 'ID_POI', 'Nom_POI', 'Action', 'Champ', 'Ancienne_Valeur', 'Nouvelle_Valeur'];
        const csvRows = [headers.join(';')];
        
        const escapeCSV = (str) => {
            if (str === null || str === undefined) return '';
            let result = String(str);
            if (result.includes(';') || result.includes('"') || result.includes('\n')) {
                result = result.replace(/"/g, '""');
                result = `"${result}"`;
            }
            return result;
        };

        allLogs.forEach(log => {
            let oldValStr = ''; try { oldValStr = JSON.parse(log.oldValue); } catch (e) { oldValStr = log.oldValue; }
            let newValStr = ''; try { newValStr = JSON.parse(log.newValue); } catch (e) { newValStr = log.newValue; }
            const row = [
                log.timestamp,
                escapeCSV(log.poiId),
                escapeCSV(log.poiName),
                escapeCSV(log.action),
                escapeCSV(log.field),
                escapeCSV(oldValStr),
                escapeCSV(newValStr)
            ];
            csvRows.push(row.join(';'));
        });

        const csvContent = '\uFEFF' + csvRows.join('\n'); // BOM for Excel
        const date = new Date().toISOString().slice(0, 10);
        downloadFile(`HistoryWalk_Log_${state.currentMapId}_${date}.csv`, csvContent, 'text/csv;charset=utf-8;');

    } catch (error) {
        console.error("Erreur lors de l'export du journal:", error);
        showToast("Une erreur est survenue lors de l'export du journal.", 'error');
    } finally {
        if (db) db.close();
    }
}