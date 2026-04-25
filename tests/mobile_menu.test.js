// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted shared state pour capturer les callbacks eventBus enregistrés à l'import
const _hoisted = vi.hoisted(() => ({ adminToggleCallback: null }));

// --- Mocks (hoisted par vitest) ---
vi.mock('../src/state.js', () => {
    const state = { isAdmin: false };
    return { state, APP_VERSION: '4.2.0' };
});

vi.mock('../src/ui-dom.js', () => ({
    DOM: {
        restoreLoader: { click: vi.fn() },
        geojsonLoader: { click: vi.fn() }
    }
}));

vi.mock('../src/lucide-icons.js', () => ({
    createIcons: vi.fn(),
    appIcons: {}
}));

vi.mock('../src/toast.js', () => ({
    showToast: vi.fn()
}));

vi.mock('../src/modal.js', () => ({
    showConfirm: vi.fn()
}));

vi.mock('../src/fileManager.js', () => ({
    saveUserData: vi.fn()
}));

vi.mock('../src/database.js', () => ({
    deleteDatabase: vi.fn()
}));

vi.mock('../src/sync.js', () => ({
    startGenericScanner: vi.fn()
}));

vi.mock('../src/statistics.js', () => ({
    showStatisticsModal: vi.fn()
}));

vi.mock('../src/admin.js', () => ({
    showAdminLoginModal: vi.fn(),
    logoutAdmin: vi.fn()
}));

vi.mock('../src/admin-control-center.js', () => ({
    openControlCenter: vi.fn(),
    openControlCenterSettings: vi.fn(),
    quickPublish: vi.fn()
}));

vi.mock('../src/events.js', () => ({
    eventBus: {
        emit: vi.fn(),
        on: vi.fn((event, cb) => {
            if (event === 'admin:mode-toggled') {
                _hoisted.adminToggleCallback = cb;
            }
        }),
        off: vi.fn()
    }
}));

vi.mock('../src/mobile-state.js', () => ({
    getCurrentView: vi.fn(() => 'actions'),
    isMobileView: vi.fn(() => true)
}));

import { state } from '../src/state.js';
import { DOM } from '../src/ui-dom.js';
import { showStatisticsModal } from '../src/statistics.js';
import { startGenericScanner } from '../src/sync.js';
import { saveUserData } from '../src/fileManager.js';
import { deleteDatabase } from '../src/database.js';
import { showConfirm } from '../src/modal.js';
import { showAdminLoginModal, logoutAdmin } from '../src/admin.js';
import { openControlCenter } from '../src/admin-control-center.js';
import { eventBus } from '../src/events.js';
import { getCurrentView, isMobileView } from '../src/mobile-state.js';
import { renderMobileMenu } from '../src/mobile-menu.js';

beforeEach(() => {
    document.body.innerHTML = '<div id="mobile-main-container"></div>';
    state.isAdmin = false;
    vi.clearAllMocks();
    // Stub window.open (BMC link). location.reload is NOT spied because jsdom
    // makes reload non-configurable and `vi.spyOn` would throw. The reload call
    // logs a "Not implemented: navigation" warning but does not throw.
    vi.spyOn(window, 'open').mockImplementation(() => null);
    getCurrentView.mockReturnValue('actions');
    isMobileView.mockReturnValue(true);
});

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('renderMobileMenu — render structure', () => {
    it('rend les 8 boutons standards (non-admin)', () => {
        renderMobileMenu();
        expect(document.getElementById('mob-action-stats')).not.toBeNull();
        expect(document.getElementById('mob-action-scan')).not.toBeNull();
        expect(document.getElementById('mob-action-restore')).not.toBeNull();
        expect(document.getElementById('mob-action-save')).not.toBeNull();
        expect(document.getElementById('mob-action-geojson')).not.toBeNull();
        expect(document.getElementById('mob-action-reset')).not.toBeNull();
        expect(document.getElementById('mob-action-theme')).not.toBeNull();
        expect(document.getElementById('mob-action-bmc')).not.toBeNull();
    });

    it('section admin absente si !state.isAdmin', () => {
        state.isAdmin = false;
        renderMobileMenu();
        expect(document.getElementById('mob-action-admin-login')).toBeNull();
        expect(document.getElementById('mob-action-admin-control-center')).toBeNull();
        expect(document.getElementById('mob-action-admin-quick-publish')).toBeNull();
        expect(document.getElementById('mob-action-admin-datamanager')).toBeNull();
        expect(document.getElementById('mob-action-admin-scout')).toBeNull();
        expect(document.getElementById('mob-action-admin-config-token')).toBeNull();
    });

    it('section admin présente si state.isAdmin', () => {
        state.isAdmin = true;
        renderMobileMenu();
        expect(document.getElementById('mob-action-admin-login')).not.toBeNull();
        expect(document.getElementById('mob-action-admin-control-center')).not.toBeNull();
        expect(document.getElementById('mob-action-admin-quick-publish')).not.toBeNull();
        expect(document.getElementById('mob-action-admin-datamanager')).not.toBeNull();
        expect(document.getElementById('mob-action-admin-scout')).not.toBeNull();
        expect(document.getElementById('mob-action-admin-config-token')).not.toBeNull();
    });

    it('inclut APP_VERSION dans le footer', () => {
        renderMobileMenu();
        const footer = document.querySelector('.mobile-version-footer');
        expect(footer.textContent).toContain('4.2.0');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('renderMobileMenu — listeners boutons standards', () => {
    it('click "Stats" → showStatisticsModal()', () => {
        renderMobileMenu();
        document.getElementById('mob-action-stats').click();
        expect(showStatisticsModal).toHaveBeenCalled();
    });

    it('click "Scanner" → startGenericScanner()', () => {
        renderMobileMenu();
        document.getElementById('mob-action-scan').click();
        expect(startGenericScanner).toHaveBeenCalled();
    });

    it('click "Sauvegarder" → saveUserData()', () => {
        renderMobileMenu();
        document.getElementById('mob-action-save').click();
        expect(saveUserData).toHaveBeenCalled();
    });

    it('click "Restaurer" → DOM.restoreLoader.click()', () => {
        renderMobileMenu();
        document.getElementById('mob-action-restore').click();
        expect(DOM.restoreLoader.click).toHaveBeenCalled();
    });

    it('click "Charger Destination" → DOM.geojsonLoader.click()', () => {
        renderMobileMenu();
        document.getElementById('mob-action-geojson').click();
        expect(DOM.geojsonLoader.click).toHaveBeenCalled();
    });

    it('click "Vider données" confirmé → deleteDatabase appelé (reload ignoré : jsdom)', async () => {
        showConfirm.mockResolvedValueOnce(true);
        renderMobileMenu();
        document.getElementById('mob-action-reset').click();
        // Attendre la résolution de la promise async
        await vi.waitFor(() => expect(deleteDatabase).toHaveBeenCalled());
        // location.reload est appelé après mais non testable en jsdom (warning navigation seulement)
    });

    it('click "Vider données" annulé → no-op (pas de deleteDatabase)', async () => {
        showConfirm.mockResolvedValueOnce(false);
        renderMobileMenu();
        document.getElementById('mob-action-reset').click();
        // Attendre que la promise se résolve
        await Promise.resolve();
        await Promise.resolve();
        expect(deleteDatabase).not.toHaveBeenCalled();
    });

    it('click "Offrir un café" → window.open BMC URL', () => {
        renderMobileMenu();
        document.getElementById('mob-action-bmc').click();
        expect(window.open).toHaveBeenCalledWith('https://www.buymeacoffee.com/history_walk', '_blank');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('renderMobileMenu — listeners admin', () => {
    it('click "Admin login" (non-admin) → showAdminLoginModal', () => {
        state.isAdmin = false;
        renderMobileMenu();
        // Le bouton n'existe pas en mode non-admin (le bloc admin n'est pas rendu)
        // Donc on teste plutôt le scénario inverse : admin → logoutAdmin
        expect(document.getElementById('mob-action-admin-login')).toBeNull();
    });

    it('click "Admin login" (admin) → logoutAdmin', () => {
        state.isAdmin = true;
        renderMobileMenu();
        document.getElementById('mob-action-admin-login').click();
        expect(logoutAdmin).toHaveBeenCalled();
        expect(showAdminLoginModal).not.toHaveBeenCalled();
    });

    it('click "Centre de Contrôle" (admin) → openControlCenter', () => {
        state.isAdmin = true;
        renderMobileMenu();
        document.getElementById('mob-action-admin-control-center').click();
        expect(openControlCenter).toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('mobile-menu — eventBus listener admin:mode-toggled', () => {
    it('enregistre un listener pour "admin:mode-toggled" au top-level du module', () => {
        // Capturé via vi.hoisted lors de l'import initial (pas vidé par clearAllMocks)
        expect(typeof _hoisted.adminToggleCallback).toBe('function');
    });

    it('callback : re-render menu si view="actions" ET isMobileView()', () => {
        getCurrentView.mockReturnValue('actions');
        isMobileView.mockReturnValue(true);
        // Pré-remplir le DOM pour pouvoir détecter un re-render
        document.body.innerHTML = '<div id="mobile-main-container"></div>';

        _hoisted.adminToggleCallback();
        // Si re-render, mob-action-stats existe maintenant
        expect(document.getElementById('mob-action-stats')).not.toBeNull();
    });

    it('callback : PAS de re-render si view ≠ "actions"', () => {
        getCurrentView.mockReturnValue('search');
        isMobileView.mockReturnValue(true);
        document.body.innerHTML = '<div id="mobile-main-container"></div>';

        _hoisted.adminToggleCallback();
        // Container reste vide
        expect(document.getElementById('mob-action-stats')).toBeNull();
    });

    it('callback : PAS de re-render si !isMobileView()', () => {
        getCurrentView.mockReturnValue('actions');
        isMobileView.mockReturnValue(false);
        document.body.innerHTML = '<div id="mobile-main-container"></div>';

        _hoisted.adminToggleCallback();
        expect(document.getElementById('mob-action-stats')).toBeNull();
    });
});
