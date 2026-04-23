// mobile-menu.js
// Rendu du menu principal mobile (vue "actions") + listener eventBus admin

import { state, APP_VERSION } from './state.js';
import { DOM } from './ui-dom.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { showToast } from './toast.js';
import { showConfirm } from './modal.js';
import { saveUserData } from './fileManager.js';
import { deleteDatabase } from './database.js';
import { startGenericScanner } from './sync.js';
import { showStatisticsModal } from './statistics.js';
import { showAdminLoginModal, logoutAdmin } from './admin.js';
import { openControlCenter, openControlCenterSettings, quickPublish } from './admin-control-center.js';
import { eventBus } from './events.js';
import { getCurrentView, isMobileView } from './mobile-state.js';

// ─── Rendu du menu ────────────────────────────────────────────────────────────

export function renderMobileMenu() {
    const container = document.getElementById('mobile-main-container');
    container.style.display = '';
    container.style.flexDirection = '';
    container.style.overflow = '';

    container.innerHTML = `
        <div class="mobile-view-header mobile-header-harmonized">
            <h1>Menu</h1>
        </div>
        <div class="mobile-list actions-list mobile-standard-padding mobile-actions-container">
            <button class="mobile-list-item" id="mob-action-stats">
                <i data-lucide="trophy"></i>
                <span>Mon Carnet de Voyage</span>
            </button>
            <div class="mobile-divider"></div>
            <button class="mobile-list-item" id="mob-action-scan">
                <i data-lucide="scan-line"></i>
                <span>Scanner un circuit</span>
            </button>
            <div class="mobile-divider"></div>
            <button class="mobile-list-item" id="mob-action-restore">
                <i data-lucide="folder-down"></i>
                <span>Restaurer les données</span>
            </button>
            <button class="mobile-list-item" id="mob-action-save">
                <i data-lucide="save"></i>
                <span>Sauvegarder les données</span>
            </button>
            <div class="mobile-divider"></div>
            <button class="mobile-list-item" id="mob-action-geojson">
                <i data-lucide="map"></i>
                <span>Charger Destination (GeoJSON)</span>
            </button>
            <button class="mobile-list-item text-danger" id="mob-action-reset">
                <i data-lucide="trash-2"></i>
                <span>Vider les données locales</span>
            </button>
            <div class="mobile-divider"></div>
            <button class="mobile-list-item" id="mob-action-theme">
                <i data-lucide="palette"></i>
                <span>Changer Thème</span>
            </button>
            <div class="mobile-divider"></div>
            <button class="mobile-list-item bmc-btn-mobile" id="mob-action-bmc">
                <i data-lucide="coffee"></i>
                <span>Offrir un café</span>
                <i data-lucide="heart" class="bmc-heart-icon icon-heart"></i>
            </button>
            ${state.isAdmin ? `
            <div class="mobile-divider"></div>
            <button class="mobile-list-item mobile-admin-login-btn--admin" id="mob-action-admin-login">
                <i data-lucide="log-out"></i>
                <span>Déconnexion Admin</span>
            </button>
            <div class="mobile-divider"></div>
            <div class="mobile-menu-admin-header">Outils Admin</div>
            <button class="mobile-list-item mobile-menu-brand-item" id="mob-action-admin-control-center">
                <i data-lucide="layout-dashboard"></i>
                <span>Centre de Contrôle</span>
            </button>
            <button class="mobile-list-item" id="mob-action-admin-quick-publish">
                <i data-lucide="upload-cloud"></i>
                <span>Publier les modifs</span>
            </button>
            <button class="mobile-list-item" id="mob-action-admin-datamanager">
                <i data-lucide="table"></i>
                <span>Data Manager</span>
            </button>
            <button class="mobile-list-item" id="mob-action-admin-scout">
                <i data-lucide="scan-eye"></i>
                <span>Scout (Overpass)</span>
            </button>
            <button class="mobile-list-item" id="mob-action-admin-config-token">
                <i data-lucide="key"></i>
                <span>Enregistrer token</span>
            </button>
            ` : ''}
        </div>
        <div class="mobile-version-footer">
            History Walk Mobile v${APP_VERSION}
        </div>
    `;

    createIcons({ icons: appIcons, root: container });

    // ─── Event listeners ──────────────────────────────────────────────────────

    document.getElementById('mob-action-stats').addEventListener('click', () => showStatisticsModal());
    document.getElementById('mob-action-scan').addEventListener('click', () => startGenericScanner());
    document.getElementById('mob-action-restore').addEventListener('click', () => DOM.restoreLoader.click());
    document.getElementById('mob-action-save').addEventListener('click', () => saveUserData());
    document.getElementById('mob-action-geojson').addEventListener('click', () => DOM.geojsonLoader.click());
    document.getElementById('mob-action-reset').addEventListener('click', async () => {
        if (await showConfirm(
            "Danger Zone",
            "ATTENTION : Cela va effacer toutes les données locales (caches, sauvegardes automatiques). Continuez ?",
            "TOUT EFFACER", "Annuler", true
        )) {
            await deleteDatabase();
            location.reload();
        }
    });
    document.getElementById('mob-action-theme').addEventListener('click', () => {
        document.getElementById('btn-theme-selector').click();
    });
    document.getElementById('mob-action-bmc').addEventListener('click', () => {
        window.open('https://www.buymeacoffee.com/history_walk', '_blank');
    });

    const btnAdminLogin = document.getElementById('mob-action-admin-login');
    if (btnAdminLogin) {
        btnAdminLogin.addEventListener('click', () => {
            if (state.isAdmin) {
                logoutAdmin();
            } else {
                showAdminLoginModal();
            }
        });
    }

    if (state.isAdmin) {
        const btnControl = document.getElementById('mob-action-admin-control-center');
        if (btnControl) btnControl.addEventListener('click', openControlCenter);

        const btnQuickPublish = document.getElementById('mob-action-admin-quick-publish');
        if (btnQuickPublish) btnQuickPublish.addEventListener('click', quickPublish);

        const btnDataManager = document.getElementById('mob-action-admin-datamanager');
        if (btnDataManager) btnDataManager.addEventListener('click', () =>
            window.open('history_walk_datamanager/index.html', '_blank')
        );

        const btnScout = document.getElementById('mob-action-admin-scout');
        if (btnScout) btnScout.addEventListener('click', () =>
            window.open('tools/scout.html', '_blank')
        );

        const btnToken = document.getElementById('mob-action-admin-config-token');
        if (btnToken) btnToken.addEventListener('click', openControlCenterSettings);
    }
}

// ─── QR Code partage de l'application ────────────────────────────────────────

async function handleShareAppClick() {
    const url = window.location.href.split('?')[0];
    try {
        const QRCode = (await import('qrcode')).default;
        const qrDataUrl = await QRCode.toDataURL(url, {
            width: 300, margin: 2,
            color: { dark: "#000000", light: "#ffffff" }
        });

        const content = `
            <div class="app-share-qr-container">
                <p class="app-share-qr-text">Scannez ce code pour installer l'application :</p>
                <img src="${qrDataUrl}" class="app-share-qr-img">
                <p class="app-share-qr-url">${url}</p>
            </div>
        `;

        showConfirm("Partager l'application", content, "Fermer", null, false).catch(() => {});
    } catch (err) {
        console.error(err);
        showToast("Erreur génération QR Code", "error");
    }
}

// ─── Listener eventBus — rechargement menu si admin change ───────────────────

eventBus.on('admin:mode-toggled', () => {
    if (getCurrentView() === 'actions' && isMobileView()) {
        renderMobileMenu();
    }
});
