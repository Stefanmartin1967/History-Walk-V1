import { state } from './state.js';
import { getAllPoiPhotosForMap } from './database.js';

// --- ÉDITION DE CONTENU ---

export function closeAllDropdowns() {
    // PR 3 (refonte topbar) : 'zonesMenu' / 'categoriesMenu' retirés.
    const ids = ['tools-menu-content', 'admin-menu-content'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.style.display = '';
            el.classList.remove('active');
        }
    });
}

// --- ESTIMATION TAILLE SAUVEGARDE ---

export async function updateBackupSizeEstimates() {
    // 1. Calcul taille JSON (Lite) — ne contient plus les photos (stockées dans poiPhotos)
    const liteData = {
        appVersion: "ESTIMATION",
        backupVersion: "3.0",
        timestamp: new Date().toISOString(),
        userData: state.userData || {},
        myCircuits: state.myCircuits || []
    };
    const jsonStr = JSON.stringify(liteData);
    const bytesLite = new Blob([jsonStr]).size;

    const spanLite = document.getElementById('backup-size-lite');
    if (spanLite) spanLite.textContent = `~${formatBytes(bytesLite)}`;

    // 2. Calcul taille Photos — lit les Blobs depuis le store poiPhotos
    let photoCount = 0;
    let photoBytes = 0;

    try {
        if (state.currentMapId) {
            const allPhotoRecords = await getAllPoiPhotosForMap(state.currentMapId);
            allPhotoRecords.forEach(record => {
                (record.photos || []).forEach(item => {
                    if (item.blob instanceof Blob) {
                        photoCount++;
                        photoBytes += item.blob.size;
                    }
                });
            });
        }
    } catch (err) {
        console.warn("Impossible de calculer la taille des photos:", err);
    }

    const totalFull = bytesLite + photoBytes;
    const spanFull = document.getElementById('backup-size-full');
    if (spanFull) {
        if (photoCount > 0) {
            spanFull.textContent = `~${formatBytes(totalFull)} (${photoCount} photo${photoCount > 1 ? 's' : ''})`;
        } else {
            spanFull.textContent = `~${formatBytes(totalFull)} (Sans photos)`;
        }
    }
}

export function formatBytes(bytes, decimals = 1) {
    if (!+bytes) return '0 Octets';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Octets', 'Ko', 'Mo', 'Go'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}
