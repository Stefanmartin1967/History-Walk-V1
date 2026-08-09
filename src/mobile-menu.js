// mobile-menu.js
// Menu mobile refondu (PR 4 chantier design — handoff Claude Design).
// Pattern : 4 sections groupées (Mon parcours / Outils / Préférences / Soutenir
// & à propos), section admin optionnelle. Chaque item a un sous-titre contextuel
// dynamique (Option C validée Stefan : tout dynamique — compteurs réels pour
// Mon Carnet, thème courant pour Préférences). Variants visuels : danger
// (rouge), love (cœur rose pour Buy Me a Coffee), brand-emph (CC plein brand).

import { state, APP_VERSION } from './state.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { escapeHtml } from './utils.js';
import { showConfirm } from './modal.js';
import { showLegalNoticeModal } from './legal-modal.js';
import { deleteDatabase } from './database.js';
import { startGenericScanner } from './sync.js';
import { showStatisticsModal } from './statistics.js';
import { showAdminLoginModal, logoutAdmin } from './admin.js';
import { openControlCenter } from './admin-control-center.js';
import { openDestinationSheet } from './mobile-destinations.js';
import { openSaveModal } from './save-modal-ui.js';
import { cycleTheme, getCurrentTheme, THEME_LABELS } from './theme.js';
import { getCurrentPatrimonialLang, setPatrimonialLang } from './patrimonial-names.js';
import { eventBus } from './events.js';
import { getCurrentView, isMobileView, setMobileHeaderSlot, clearMobileViewFooter } from './mobile-state.js';

// ─── Sous-titres dynamiques ──────────────────────────────────────────────────
// Compteurs réels lus de state pour donner du contexte à chaque action.
function computeSubtitles() {
    const visitedPois = (state.loadedFeatures || []).filter(f => f?.properties?.userData?.vu).length;
    const officialCompleted = (state.officialCircuits || []).filter(c => state.officialCircuitsStatus?.[c.id] === true).length;
    const myCompleted = (state.myCircuits || []).filter(c => c.isCompleted === true).length;
    const completedCircuits = officialCompleted + myCompleted;
    const currentThemeLabel = THEME_LABELS[getCurrentTheme()] || 'Maritime';
    const currentNamesLabel = getCurrentPatrimonialLang() === 'ar' ? 'Arabe' : 'Français';

    const activeDestName = state.destinations?.maps?.[state.currentMapId]?.name || state.currentMapId || '—';

    const plural = (n, s, p) => `${n} ${n === 1 || n === 0 ? s : p}`;
    return {
        carnet: `${plural(visitedPois, 'lieu visité', 'lieux visités')} · ${plural(completedCircuits, 'circuit complété', 'circuits complétés')}`,
        backup: 'Légère (partage) ou Complète (locale)',
        scan: 'QR code partagé par un autre voyageur',
        reset: 'Supprime carnet & circuits hors-ligne',
        theme: `Actuel : ${currentThemeLabel}`,
        names: `Actuel : ${currentNamesLabel}`,
        bmc: 'Soutenir le projet',
        cc: 'Tableau de bord opérations',
        destSwitch: `Active : ${activeDestName}`,
    };
}

// ─── Définition des sections (data) ──────────────────────────────────────────
function buildSections(subs) {
    const sections = [
        {
            label: 'Mon parcours',
            items: [
                { id: 'mob-action-stats', ico: 'trophy', label: 'Mon Carnet de Voyage', sub: subs.carnet },
            ],
        },
        {
            label: 'Outils',
            items: [
                { id: 'mob-action-scan', ico: 'scan-line', label: 'Scanner un circuit', sub: subs.scan },
                { id: 'mob-action-backup', ico: 'hard-drive', label: 'Sauvegarder', sub: subs.backup },
                { id: 'mob-action-reset', ico: 'trash-2', label: 'Vider les données locales', sub: subs.reset, variant: 'danger' },
            ],
        },
        {
            label: 'Préférences',
            items: [
                { id: 'mob-action-theme', ico: 'palette', label: 'Changer Thème', sub: subs.theme },
                { id: 'mob-action-names', ico: 'languages', label: 'Langue des noms', sub: subs.names },
            ],
        },
        {
            label: 'Soutenir & à propos',
            items: [
                { id: 'mob-action-bmc', ico: 'coffee', label: 'Offrir un café', sub: subs.bmc, variant: 'love' },
                { id: 'mob-action-facebook', ico: 'facebook', label: 'Page Facebook' },
                { id: 'mob-action-legal-notice', ico: 'scale', label: 'Mentions légales' },
            ],
        },
    ];

    if (state.isAdmin) {
        // Section admin réduite à 2 items (followup #5 post-chantier mobile) :
        // Publier modifs / Data Manager / Scout / Token étaient redondants car
        // déjà accessibles via le Centre de Contrôle (CC) ou outils PC-only.
        // Le CC reste le point d'entrée brand-emph vers tout.
        sections.push({
            label: 'Outils admin',
            items: [
                { id: 'mob-action-switch-dest', ico: 'map', label: 'Changer de destination', sub: subs.destSwitch },
                { id: 'mob-action-admin-login', ico: 'log-out', label: 'Déconnexion Admin', variant: 'danger' },
                { id: 'mob-action-admin-control-center', ico: 'layout-dashboard', label: 'Centre de Contrôle', sub: subs.cc, variant: 'brand-emph' },
            ],
        });
    }

    return sections;
}

// ─── Rendu ───────────────────────────────────────────────────────────────────
export function renderMobileMenu() {
    const container = document.getElementById('mobile-main-container');
    if (!container) return;
    container.style.display = '';
    container.style.flexDirection = '';
    container.style.overflow = '';

    // Vue Menu : pas de footer custom → clear pour restaurer le dock.
    clearMobileViewFooter();

    const subs = computeSubtitles();
    const sections = buildSections(subs);

    // Header dans le slot dédié (cohérent avec le pattern des autres vues).
    const headerHtml = `
        <div class="m-top">
            <div class="m-top-trail"></div>
            <div class="m-top-title">Menu</div>
            <div class="m-top-trail"></div>
        </div>
    `;
    setMobileHeaderSlot(headerHtml);

    // Body : sections groupées
    let html = '<div class="menu-list">';
    sections.forEach(sec => {
        html += `<section class="menu-section">
            <div class="menu-section-label">${escapeHtml(sec.label)}</div>
            <div class="menu-group">`;
        sec.items.forEach(it => {
            const variantCls = it.variant === 'danger' ? ' danger'
                            : it.variant === 'love' ? ' love'
                            : it.variant === 'brand-emph' ? ' brand-emph'
                            : '';
            // L'icône trail : cœur plein pour love (BMC), chevron pour le reste.
            const trailIcon = it.variant === 'love' ? 'heart' : 'chevron-right';
            html += `
                <button type="button" class="menu-item${variantCls}" id="${it.id}">
                    <span class="menu-item-icon"><i data-lucide="${it.ico}"></i></span>
                    <span class="menu-item-text">
                        <div class="menu-item-label">${escapeHtml(it.label)}</div>
                        ${it.sub ? `<div class="menu-item-sub">${escapeHtml(it.sub)}</div>` : ''}
                    </span>
                    <span class="menu-item-trail"><i data-lucide="${trailIcon}"></i></span>
                </button>
            `;
        });
        html += '</div></section>';
    });
    html += `<div class="menu-version">Heripia Mobile v${APP_VERSION}</div>`;
    html += '</div>';

    container.innerHTML = html;

    // Icons (header + container)
    createIcons({ icons: appIcons, root: container });
    const headerSlot = document.getElementById('mobile-header-slot');
    if (headerSlot) createIcons({ icons: appIcons, root: headerSlot });

    // ─── Event listeners ─────────────────────────────────────────────────────
    document.getElementById('mob-action-stats')?.addEventListener('click', () => showStatisticsModal());
    document.getElementById('mob-action-backup')?.addEventListener('click', () => openSaveModal());
    document.getElementById('mob-action-scan')?.addEventListener('click', () => startGenericScanner());
    document.getElementById('mob-action-reset')?.addEventListener('click', async () => {
        if (await showConfirm(
            "Danger Zone",
            "ATTENTION : Cela va effacer toutes les données locales (caches, sauvegardes automatiques). Continuez ?",
            "TOUT EFFACER", "Annuler", true
        )) {
            await deleteDatabase();
            location.reload();
        }
    });
    document.getElementById('mob-action-theme')?.addEventListener('click', () => {
        cycleTheme();
        // Re-render pour rafraîchir le sous-titre « Actuel : <thème> ».
        renderMobileMenu();
    });
    document.getElementById('mob-action-names')?.addEventListener('click', () => {
        // FR ⇄ AR (réglage GLOBAL — équivalent mobile du segmenté topbar PC).
        setPatrimonialLang(getCurrentPatrimonialLang() === 'ar' ? 'fr' : 'ar');
        // Re-render pour rafraîchir le sous-titre « Actuel : <langue> ».
        renderMobileMenu();
    });
    document.getElementById('mob-action-bmc')?.addEventListener('click', () => {
        window.open('https://www.buymeacoffee.com/history_walk', '_blank');
    });
    document.getElementById('mob-action-facebook')?.addEventListener('click', () => {
        window.open('https://www.facebook.com/profile.php?id=61592156811687', '_blank', 'noopener,noreferrer');
    });
    document.getElementById('mob-action-legal-notice')?.addEventListener('click', () => showLegalNoticeModal());

    document.getElementById('mob-action-admin-login')?.addEventListener('click', () => {
        if (state.isAdmin) logoutAdmin();
        else showAdminLoginModal();
    });

    if (state.isAdmin) {
        document.getElementById('mob-action-switch-dest')?.addEventListener('click', () => openDestinationSheet());
        document.getElementById('mob-action-admin-control-center')?.addEventListener('click', openControlCenter);
    }
}

// ─── Listener eventBus — rechargement menu si admin change ───────────────────
eventBus.on('admin:mode-toggled', () => {
    if (getCurrentView() === 'actions' && isMobileView()) {
        renderMobileMenu();
    }
});
