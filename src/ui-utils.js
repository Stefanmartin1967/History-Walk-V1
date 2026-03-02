import { state } from './state.js';

// --- ÉDITION DE CONTENU ---

export function closeAllDropdowns() {
    const ids = ['zonesMenu', 'categoriesMenu', 'tools-menu-content', 'admin-menu-content'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            // Pour les menus gérés par classe CSS (Outils / Admin), on retire le style inline qui bloque la classe active
            if (id === 'tools-menu-content' || id === 'admin-menu-content') {
                el.style.display = '';
            } else {
                // Pour les autres (Zones / Catégories), on utilise display: none
                el.style.display = 'none';
            }
            el.classList.remove('active');
        }
    });
}

// --- ESTIMATION TAILLE SAUVEGARDE ---

export function updateBackupSizeEstimates() {
    // 1. Calcul taille JSON (Lite)
    // On simule l'objet qui sera exporté
    const liteData = {
        appVersion: "ESTIMATION",
        backupVersion: "3.0",
        timestamp: new Date().toISOString(),
        userData: state.userData || {},
        myCircuits: state.myCircuits || []
    };
    const jsonStr = JSON.stringify(liteData);
    const bytesLite = new Blob([jsonStr]).size;

    // Formatage Lite
    const sizeLite = formatBytes(bytesLite);
    const spanLite = document.getElementById('backup-size-lite');
    if(spanLite) spanLite.textContent = `~${sizeLite}`;

    // 2. Calcul taille Photos (Full)
    // On parcourt userData pour trouver les photos Base64
    let photoCount = 0;
    let photoBytes = 0;

    if (state.userData) {
        Object.values(state.userData).forEach(data => {
            if (data.photos && Array.isArray(data.photos)) {
                data.photos.forEach(photo => {
                    if (typeof photo === 'string' && photo.startsWith('data:image')) {
                        photoCount++;
                        // Estimation taille Base64 : taille string * 0.75 (approx)
                        photoBytes += photo.length; // En mémoire JS string = 2 octets/char mais en UTF-8 export c'est proche
                    }
                });
            }
        });
    }

    const totalFull = bytesLite + photoBytes;
    const sizeFull = formatBytes(totalFull);

    const spanFull = document.getElementById('backup-size-full');
    if(spanFull) {
        if(photoCount > 0) {
            spanFull.textContent = `~${sizeFull} (${photoCount} photo${photoCount > 1 ? 's' : ''})`;
        } else {
            spanFull.textContent = `~${sizeFull} (Sans photos)`;
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
