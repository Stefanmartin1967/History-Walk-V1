// sync-reminders.js — rappeler qu'une donnée n'est que sur cet appareil, tant que
// le user n'a ni relié son compte Google ni choisi de faire ses sauvegardes
// lui-même (PR 9 du chantier « synchro users », maquette écrans 52-54 validée
// par Stefan le 23/11/2026 ; décisions du 19/11).
//
//  - Premier rappel (écrans 52 et 54) : une fenêtre, une seule fois, à la toute
//    première vraie modification, qui dit QUOI (« Votre visite de… »).
//  - Rappels suivants (écran 53) : un toast ordinaire, aux seuils de la copie de
//    secours (10 modifications ou 3 jours DEPUIS LA DERNIÈRE SAUVEGARDE), avec
//    « Relier à mon compte Google ».
//  - « Non merci, je ferai des sauvegardes moi-même » (ou « Sauvegarde en
//    fichier » dans Sauvegarder) : plus de rappel Google, la copie de secours
//    automatique en fichier reprend (backup-auto-local.js).
//  - Relié : plus rien.

import { state } from './state.js';
import { escapeXml } from './utils.js';
import { openHwModal, closeHwModal } from './modal.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { showToast } from './toast.js';
import { getLinkedAccount, preloadGoogle } from './google-account.js';

const CHOICE_KEY = 'hw_sync_choice';        // 'file' : sauvegardes en fichier, plus de rappel
const FIRST_KEY = 'hw_sync_first_reminder'; // le premier rappel a été montré
const REMIND_KEY = 'hw_sync_remind';         // { count, at } du dernier rappel

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, String(v)); } catch { /* rien */ } };

/** 'google' (relié), 'file' (sauvegardes en fichier) ou null (pas encore choisi). */
export function getSyncChoice() {
    if (getLinkedAccount()) return 'google';
    return read(CHOICE_KEY) === 'file' ? 'file' : null;
}

/** « Non merci » / « Sauvegarde en fichier » : 'file' ; null pour revenir aux rappels. */
export function setSyncChoice(choice) {
    write(CHOICE_KEY, choice === 'file' ? 'file' : null);
}

/** Les rappels valent-ils pour cet appareil ? */
export function remindersActive() {
    return !state.isAdmin && getSyncChoice() === null;
}

// ─── Relier depuis un rappel ────────────────────────────────────────────────

let linker = null;
/** google-link-ui.js fournit le geste « Relier » (ouvre Sauvegarder et la fenêtre Google). */
export function setLinker(fn) { linker = typeof fn === 'function' ? fn : null; }
function link() { linker?.(); }
/** « Relier à mon compte Google » depuis l'accueil. */
export function linkNow() { link(); }

// ─── Premier rappel (écrans 52 et 54) ──────────────────────────────────────

/**
 * Phrase du premier rappel selon ce qui vient d'être fait.
 * @param {{kind?:'visit'|'note'|'place'|'circuit', name?:string}} [detail]
 */
export function firstReminderSentence(detail = {}) {
    const name = detail.name ? escapeXml(detail.name) : '';
    switch (detail.kind) {
        case 'visit': return name ? `Votre visite de <b>${name}</b> est enregistrée ici, sur cet appareil seulement.` : 'Votre visite est enregistrée ici, sur cet appareil seulement.';
        case 'note': return name ? `Votre note sur <b>${name}</b> est enregistrée ici, sur cet appareil seulement.` : 'Votre note est enregistrée ici, sur cet appareil seulement.';
        case 'place': return name ? `Votre lieu <b>${name}</b> est enregistré ici, sur cet appareil seulement.` : 'Votre lieu est enregistré ici, sur cet appareil seulement.';
        case 'circuit': return name ? `Votre circuit <b>${name}</b> est enregistré ici, sur cet appareil seulement.` : 'Votre circuit est enregistré ici, sur cet appareil seulement.';
        default: return 'Votre modification est enregistrée ici, sur cet appareil seulement.';
    }
}

/** À la toute première vraie modification : la fenêtre, une seule fois. @returns {boolean} montrée */
export function maybeFirstReminder(detail) {
    if (!remindersActive() || read(FIRST_KEY) === '1') return false;
    write(FIRST_KEY, '1');
    preloadGoogle();
    const body = `
        <p class="sr-text">${firstReminderSentence(detail)}</p>
        <p class="sr-text">Pour la retrouver sur votre téléphone et votre PC, et ne pas la perdre si vous changez d'appareil, reliez Heripia à votre compte Google. Vos données y sont rangées à part, sans toucher à vos fichiers, et Heripia ne les reçoit jamais.</p>`;
    const footer = `
        <div class="sr-actions">
            <button class="btn btn-secondary" type="button" data-sr-later>Plus tard</button>
            <button class="btn btn-primary" type="button" data-sr-link>Relier à mon compte Google</button>
        </div>
        <button class="sr-refuse" type="button" data-sr-refuse>Non merci, je ferai des sauvegardes moi-même</button>`;
    openHwModal({ size: 'sm', icon: 'smartphone', title: 'Enregistré sur cet appareil', body, footer });
    const root = document.querySelector('.hw-modal-overlay:last-of-type') || document;
    root.querySelector('.hw-modal-footer')?.classList.add('sr-footer');
    createIcons({ icons: appIcons, root });
    root.querySelector('[data-sr-later]')?.addEventListener('click', () => closeHwModal());
    root.querySelector('[data-sr-refuse]')?.addEventListener('click', () => { setSyncChoice('file'); closeHwModal(); });
    root.querySelector('[data-sr-link]')?.addEventListener('click', () => { closeHwModal(); link(); });
    return true;
}

// ─── Rappels suivants (écran 53) ────────────────────────────────────────────

const MODIFS_STEP = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS = 3;

function lastRemind() {
    try { return JSON.parse(read(REMIND_KEY) || 'null') || { count: 0, at: 0 }; } catch { return { count: 0, at: 0 }; }
}

/** Le compte vient de repartir à zéro (sauvegarde faite) : les rappels aussi. */
export function resetReminders() { write(REMIND_KEY, null); }

/**
 * Faut-il rappeler ? Tous les 10 modifications depuis la dernière sauvegarde, ou
 * 3 jours après la dernière sauvegarde (ou le dernier rappel) s'il y en a au moins une.
 * @param {{count:number, lastTimestamp:number}} s état de backup-auto-local
 */
export function reminderDue(s, now = Date.now()) {
    const r = lastRemind();
    if (s.count >= MODIFS_STEP && s.count - r.count >= MODIFS_STEP) return true;
    const since = Math.max(s.lastTimestamp || 0, r.at || 0);
    return since > 0 && s.count > 0 && now - since >= DAYS * DAY_MS;
}

/** Un rappel suivant, si c'est le moment. @returns {boolean} montré */
export function maybeReminder(s, now = Date.now()) {
    if (!remindersActive() || read(FIRST_KEY) !== '1' || !reminderDue(s, now)) return false;
    write(REMIND_KEY, JSON.stringify({ count: s.count, at: now }));
    preloadGoogle();
    const since = s.lastTimestamp > 0 ? ' depuis votre dernière sauvegarde' : '';
    const many = s.count > 1;
    showToast(`${s.count} modification${many ? 's' : ''}${since} ${many ? 'ne sont' : "n'est"} que sur cet appareil. Reliez Heripia à votre compte Google pour ${many ? 'les' : 'la'} garder.`,
        'warning', 12000, { label: 'Relier à mon compte Google', onClick: () => link() });
    return true;
}

/** Ligne de l'entrée « Sauvegarder » du menu (écran 53), ou null. */
export function backupMenuHint(s) {
    if (!remindersActive() || !s || s.count <= 0) return null;
    return `${s.count} modification${s.count > 1 ? 's' : ''}${s.lastTimestamp > 0 ? ' depuis votre dernière sauvegarde' : ' sur cet appareil seulement'}`;
}

/** L'indication sous « Sauvegarder » du menu Outils (PC). */
export function refreshBackupHint(s) {
    const el = document.getElementById('tools-backup-hint');
    if (!el) return;
    const hint = backupMenuHint(s);
    el.textContent = hint || '';
    el.classList.toggle('is-hidden', !hint);
}
