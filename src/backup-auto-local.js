// backup-auto-local.js
// Phase 1 — Couche 1 du système de protection des données user.
//
// Compte les modifications user (POI ajouté, édité, supprimé, circuit créé,
// photo ajoutée…) et déclenche un téléchargement automatique du backup quand
// un seuil est atteint :
//   - 10 modifications depuis le dernier backup, OU
//   - 3 jours depuis le dernier backup avec au moins 1 modification
//
// L'objectif : protéger l'user lambda qui n'a configuré aucune option de
// sauvegarde — il aura toujours un backup récent dans son dossier Téléchargements.
//
// Désactivé en mode admin (l'admin gère ses propres backups via le CC).

import { state } from './state.js';
import { getAppState, saveAppState } from './database.js';
import { showToast } from './toast.js';

const STATE_KEY = 'backup_auto_local_state';
const MODIFS_THRESHOLD = 10;
const DAYS_THRESHOLD = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

// Cache mémoire pour éviter un round-trip IDB à chaque modif. Initialisé
// paresseusement au premier accès.
let _cache = null;

// Guard mutex pour éviter les déclenchements concurrents (recordModification
// lance checkAndTriggerAutoBackup en async sans await ; sans ce guard, plusieurs
// modifs successives qui passent le seuil quasi en même temps déclencheraient
// plusieurs backups en parallèle).
let _backupInProgress = false;

async function getBackupState() {
    if (_cache) return _cache;
    const stored = await getAppState(STATE_KEY);
    _cache = stored && typeof stored === 'object'
        ? { count: stored.count || 0, lastTimestamp: stored.lastTimestamp || 0 }
        : { count: 0, lastTimestamp: 0 };
    return _cache;
}

async function persistBackupState(newState) {
    _cache = newState;
    await saveAppState(STATE_KEY, newState);
}

/**
 * Compte une modification user. À appeler depuis chaque mutation côté user
 * (data.js, circuit-actions.js, desktopMode.js…). Skippé si state.isAdmin.
 *
 * Déclenche un auto-backup quand le seuil est atteint.
 */
export async function recordModification() {
    if (state.isAdmin) return; // L'admin a son propre flow CC

    const s = await getBackupState();
    s.count = (s.count || 0) + 1;
    await persistBackupState(s);

    // Vérifie sans bloquer la modif en cours (pas await sur le trigger).
    void checkAndTriggerAutoBackup();
}

/**
 * Vérifie si un auto-backup doit être déclenché et le fait si oui.
 * Exporté pour permettre un trigger manuel (boot de l'app par exemple).
 */
export async function checkAndTriggerAutoBackup() {
    if (state.isAdmin) return false;
    if (_backupInProgress) return false;

    const s = await getBackupState();
    const now = Date.now();

    const reachedModifs = s.count >= MODIFS_THRESHOLD;
    // Le critère "jours" ne s'applique QUE si un backup a déjà eu lieu une fois
    // (lastTimestamp > 0). Sinon le 1er auto-backup d'un user fraîchement
    // installé se déclencherait dès sa toute première modif (lastTimestamp=0
    // donnant un "elapsed" infini), ce qui est trop agressif.
    const elapsedDays = s.lastTimestamp > 0 ? (now - s.lastTimestamp) / DAY_MS : 0;
    const reachedDays = s.lastTimestamp > 0 && s.count > 0 && elapsedDays >= DAYS_THRESHOLD;

    if (!reachedModifs && !reachedDays) return false;

    _backupInProgress = true;
    try {
        const { saveUserData } = await import('./fileManager.js');
        await saveUserData(false); // mode LITE (pas les photos blobs)

        await persistBackupState({ count: 0, lastTimestamp: now });

        const reason = reachedModifs ? `${s.count} modifications` : `${Math.floor(elapsedDays)} jours`;
        showToast(`Backup auto téléchargé (${reason}). Pense à le ranger en sûr.`, 'info', 6000);
        return true;
    } catch (err) {
        console.error('[backup-auto-local] auto-backup failed:', err);
        return false;
    } finally {
        _backupInProgress = false;
    }
}

/**
 * Déclenche un backup manuel (depuis le bouton "Forcer un backup" de l'onglet
 * Sécurité). Reset le compteur comme un auto-backup réussi.
 */
export async function forceBackup() {
    try {
        const { saveUserData } = await import('./fileManager.js');
        await saveUserData(false);
        await persistBackupState({ count: 0, lastTimestamp: Date.now() });
        showToast('Backup téléchargé.', 'success');
        return true;
    } catch (err) {
        console.error('[backup-auto-local] manual backup failed:', err);
        showToast('Impossible de créer le backup.', 'error');
        return false;
    }
}

/**
 * Statut courant pour l'affichage dans l'onglet Sécurité.
 * @returns {Promise<{count: number, lastDate: Date|null, daysSince: number|null}>}
 */
export async function getBackupStatusForUI() {
    const s = await getBackupState();
    const lastDate = s.lastTimestamp > 0 ? new Date(s.lastTimestamp) : null;
    const daysSince = lastDate ? Math.floor((Date.now() - s.lastTimestamp) / DAY_MS) : null;
    return {
        count: s.count || 0,
        lastDate,
        daysSince,
        modifsThreshold: MODIFS_THRESHOLD,
        daysThreshold: DAYS_THRESHOLD,
    };
}

/** Test-only : reset le cache mémoire (utilisé en setup vitest). */
export function _resetCacheForTests() {
    _cache = null;
}

/** Test-only : retourne le cache courant (sans I/O IDB). */
export function _getCacheForTests() {
    return _cache;
}
