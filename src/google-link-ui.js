// google-link-ui.js — Partie « Synchroniser avec mon compte Google » de l'écran
// Sauvegarder (synchro users). Maquettes validées par Stefan le 20/11/2026 :
// écrans 28-34 (PR 5 : relier, déconnecter, effacer) et 35-42 (PR 6 : la
// synchronisation — état, attente, réunion juste après « Relier »).
//
// Pas de toast : la partie change sous les yeux du user, et un échec s'affiche
// dans un encadré à la place. Jamais en mode admin (ses données suivent par
// GitHub ; deux synchros se marcheraient dessus).

import { state } from './state.js';
import { eventBus } from './events.js';
import { escapeHtml } from './utils.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { hwConfirm, suspendHwModal, resumeHwModal } from './modal.js';
import {
    getLinkedAccount,
    preloadGoogle,
    linkGoogleAccount,
    disconnectGoogleAccount,
    eraseGoogleData,
} from './google-account.js';
import {
    getSyncStatus,
    syncNowFromGesture,
    firstSyncAfterLink,
    resetSyncStatus,
    refreshSyncIndicators,
    autoNewest,
    setAutoNewest,
} from './google-sync-ui.js';
import { clearSyncConflicts } from './google-sync.js';

const INTRO = "Vos visites, notes et circuits suivent sur tous vos appareils reliés au même compte Google. Ils y sont rangés à part, sans toucher à vos fichiers, et Heripia ne les reçoit jamais. Les photos ne suivent pas : pour elles, gardez une copie dans un fichier ci-dessous.";

const LINK_FAIL = {
    closed: "La liaison n'a pas été faite : la fenêtre Google a été fermée avant la fin. Vous pouvez réessayer quand vous voulez.",
    denied: "La liaison n'a pas été faite : l'autorisation n'a pas été donnée dans la fenêtre Google. Vous pouvez réessayer quand vous voulez.",
    blocked: "Votre navigateur a empêché la fenêtre Google de s'ouvrir. Autorisez les fenêtres pour heripia.com, puis réessayez.",
    offline: "Pas de connexion à Internet. Réessayez quand vous serez connecté.",
    error: "La liaison n'a pas été faite : Google n'a pas répondu comme prévu. Réessayez plus tard.",
};
const SYNC_FAIL = {
    closed: "La synchronisation n'a pas été faite : la fenêtre Google a été fermée avant la fin. Vos modifications restent sur cet appareil.",
    denied: "La synchronisation n'a pas été faite : l'autorisation n'a pas été donnée dans la fenêtre Google. Vos modifications restent sur cet appareil.",
    blocked: "Votre navigateur a empêché la fenêtre Google de s'ouvrir. Autorisez les fenêtres pour heripia.com, puis réessayez.",
    offline: "Pas de connexion à Internet. Vos modifications restent sur cet appareil et partiront plus tard.",
    error: "La synchronisation n'a pas été faite : Google n'a pas répondu comme prévu. Vos modifications restent sur cet appareil.",
};
const ERASE_FAIL = {
    closed: "L'effacement n'a pas été fait : la fenêtre Google a été fermée avant la fin. Vos données sont toujours dans votre compte Google.",
    denied: "L'effacement n'a pas été fait : l'autorisation n'a pas été donnée dans la fenêtre Google. Vos données sont toujours dans votre compte Google.",
    blocked: "Votre navigateur a empêché la fenêtre Google de s'ouvrir. Autorisez les fenêtres pour heripia.com, puis réessayez.",
    offline: "Pas de connexion à Internet. Réessayez quand vous serez connecté.",
    error: "L'effacement n'a peut-être pas été complet : Google n'a pas répondu comme prévu. Réessayez plus tard.",
};
const ERASE_DONE = 'Vos données Heripia ont été effacées de votre compte Google.';
const FIRST_COPY_DONE = 'Vos données de cet appareil sont maintenant dans votre compte Google.';

// État de la partie, gardé tant que l'écran est ouvert.
let busy = false;     // liaison ou effacement en cours
let flash = null;     // { tone: 'warn' | 'ok', text }
let currentBody = null;

function flashHtml() {
    if (!flash) return '';
    const icon = flash.tone === 'ok' ? 'check-circle' : 'alert-triangle';
    return `<div class="gl-flash gl-flash--${flash.tone}" role="${flash.tone === 'ok' ? 'status' : 'alert'}">
      <i data-lucide="${icon}"></i><span>${escapeHtml(flash.text)}</span>
    </div>`;
}

/** « à l'instant », « il y a 2 min », « aujourd'hui à 14:30 », « hier à 18:40 », « le 18/11 à 09:05 ». */
export function relativeWhen(ms, now = Date.now()) {
    const diff = now - ms;
    if (diff < 60 * 1000) return "à l'instant";
    if (diff < 60 * 60 * 1000) return `il y a ${Math.floor(diff / 60000)} min`;
    const d = new Date(ms), today = new Date(now);
    const p = (n) => String(n).padStart(2, '0');
    const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
    const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    if (ms >= dayStart) return `aujourd'hui à ${hm}`;
    if (ms >= dayStart - 24 * 3600 * 1000) return `hier à ${hm}`;
    return `le ${p(d.getDate())}/${p(d.getMonth() + 1)} à ${hm}`;
}

function linkedHtml(acc) {
    const st = getSyncStatus();
    const working = st.syncing || busy;
    const waiting = !working && st.pending > 0;
    let status;
    if (working) status = 'Synchronisation…';
    else if (!st.lastAt) status = 'Pas encore synchronisé';
    else if (waiting) status = `Dernière synchronisation : ${relativeWhen(st.lastAt)}`;
    else status = `Synchronisé ${relativeWhen(st.lastAt)} · rien en attente`;
    const disabled = working ? 'disabled' : '';
    const pendingBox = waiting ? `
    <div class="gl-pending">
      <div class="gl-pending-head"><i data-lucide="clock"></i><strong>${st.pending} modification${st.pending > 1 ? 's' : ''} en attente</strong></div>
      <p>Elles sont enregistrées sur cet appareil et partiront dans votre compte à la prochaine synchronisation.</p>
      <button class="me-btn primary gl-btn-big" id="gl-btn-sync" type="button">Synchroniser maintenant</button>
      <p class="gl-pending-hint">Une fenêtre Google peut s'ouvrir un instant : c'est normal.</p>
    </div>` : '';
    return `
  <section class="me-block gl-section gl-section--on" aria-labelledby="lbl-google">
    <h3 class="me-block-title me-block-title-lg" id="lbl-google">Synchroniser avec mon compte Google</h3>
    <div class="gl-linked">
      <i data-lucide="check-circle"></i>
      <span class="gl-linked-text">
        <span class="gl-linked-main"><strong>Relié</strong><span class="gl-sep"> · </span><span class="gl-email">${escapeHtml(acc.email)}</span></span>
        <span class="gl-status" aria-live="polite">${status}</span>
      </span>
    </div>
    <p class="me-block-desc">Vos visites, notes et circuits suivent sur tous vos appareils reliés à ce compte.</p>
    ${flashHtml()}
    ${pendingBox}
    <div class="gl-actions">
      ${waiting ? '' : `<button class="me-btn secondary" id="gl-btn-sync" type="button" ${disabled}>Synchroniser maintenant</button>`}
      <button class="me-btn secondary" id="gl-btn-disconnect" type="button" ${disabled}>Déconnecter</button>
      <button class="gl-link-danger" id="gl-btn-erase" type="button" ${disabled}>Effacer mes données Heripia de mon compte Google</button>
    </div>
    <label class="gl-auto">
      <span>Texte modifié sur deux appareils :</span>
      <select id="gl-auto-select">
        <option value="ask" ${autoNewest() ? '' : 'selected'}>je choisis</option>
        <option value="newest" ${autoNewest() ? 'selected' : ''}>garder le plus récent</option>
      </select>
    </label>
  </section>`;
}

function sectionHtml() {
    const acc = getLinkedAccount();
    if (acc) return linkedHtml(acc);
    const linkBtn = busy
        ? `<button class="me-btn primary" id="gl-btn-link" type="button" disabled aria-busy="true"><i data-lucide="loader-circle" class="gl-spin"></i> Connexion à Google…</button>`
        : `<button class="me-btn primary" id="gl-btn-link" type="button">Relier à mon compte Google</button>`;
    return `
  <section class="me-block gl-section" aria-labelledby="lbl-google">
    <h3 class="me-block-title me-block-title-lg" id="lbl-google">Synchroniser avec mon compte Google</h3>
    <p class="me-block-desc">${INTRO}</p>
    ${busy ? `<p class="me-block-desc gl-hint">Une fenêtre Google s'est ouverte : choisissez votre compte, puis acceptez.</p>` : ''}
    ${flashHtml()}
    <div class="gl-actions">${linkBtn}</div>
  </section>`;
}

/** HTML de la partie Google, à placer en tête de l'écran Sauvegarder (rien en admin). */
export function googleSectionHtml() {
    return state.isAdmin ? '' : `<div id="gl-mount">${sectionHtml()}</div>`;
}

function rerender(bodyEl) {
    const mount = bodyEl?.querySelector('#gl-mount');
    if (!mount) return;
    mount.innerHTML = sectionHtml();
    createIcons({ icons: appIcons, root: mount });
    bind(bodyEl);
}

async function onLink(bodyEl) {
    flash = null;
    busy = true;
    // ⚠ La demande à Google part dans le clic, AVANT le premier rendu.
    const work = linkGoogleAccount();
    rerender(bodyEl);
    try {
        await work;
    } catch (e) {
        console.warn('[google-link] liaison', e);
        flash = { tone: 'warn', text: LINK_FAIL[e?.kind] || LINK_FAIL.error };
        busy = false;
        rerender(bodyEl);
        return;
    }
    rerender(bodyEl); // Relié · Synchronisation…
    // Première fois sur cet appareil : on réunit l'appareil et le compte (écran 35).
    const res = await firstSyncAfterLink();
    busy = false;
    if (!res.ok) flash = { tone: 'warn', text: SYNC_FAIL.error };
    else if (res.created) flash = { tone: 'ok', text: FIRST_COPY_DONE };
    rerender(bodyEl);
}

async function onSync(bodyEl) {
    flash = null;
    // ⚠ Dans le clic : la fenêtre Google peut devoir s'ouvrir un instant.
    const work = syncNowFromGesture();
    rerender(bodyEl);
    try {
        const r = await work;
        if (r === null) flash = { tone: 'warn', text: SYNC_FAIL.error };
    } catch (e) {
        flash = { tone: 'warn', text: SYNC_FAIL[e?.kind] || SYNC_FAIL.error };
    }
    rerender(bodyEl);
}

async function forgetSyncState() {
    resetSyncStatus();
    await clearSyncConflicts();
    await refreshSyncIndicators();
}

async function onDisconnect(bodyEl) {
    const acc = getLinkedAccount();
    if (!acc) return;
    suspendHwModal();
    const ok = await hwConfirm({
        title: 'Déconnecter cet appareil ?',
        body: `<p>Cet appareil ne sera plus relié à <strong>${escapeHtml(acc.email)}</strong>.</p>
<p>Vos données restent sur cet appareil, et celles déjà enregistrées dans votre compte Google y restent aussi. Vous pourrez le relier de nouveau quand vous voulez.</p>`,
        confirmLabel: 'Déconnecter',
    });
    resumeHwModal();
    if (!ok) return;
    disconnectGoogleAccount();
    await forgetSyncState();
    flash = null;
    rerender(bodyEl);
}

async function onErase(bodyEl) {
    const acc = getLinkedAccount();
    if (!acc) return;
    suspendHwModal();
    const ok = await hwConfirm({
        title: 'Effacer vos données Heripia de votre compte Google ?',
        body: `<p>Tout ce que Heripia a enregistré dans le compte <strong>${escapeHtml(acc.email)}</strong> sera supprimé : visites, notes, circuits, et les versions gardées 30 jours. Heripia n'aura plus accès à ce compte.</p>
<p>Vos données restent sur cet appareil.</p>
<p class="gl-confirm-warn">Un autre appareil encore relié à ce compte renverrait ses données. Déconnectez-le d'abord.</p>`,
        confirmLabel: 'Effacer',
        danger: true,
    });
    resumeHwModal();
    if (!ok) return;
    flash = null;
    busy = true;
    // ⚠ Juste après le clic « Effacer » : la fenêtre Google peut encore s'ouvrir.
    const work = eraseGoogleData();
    rerender(bodyEl);
    try {
        await work;
        await forgetSyncState();
        flash = { tone: 'ok', text: ERASE_DONE };
    } catch (e) {
        console.warn('[google-link] effacement', e);
        flash = { tone: 'warn', text: ERASE_FAIL[e?.kind] || ERASE_FAIL.error };
    }
    busy = false;
    rerender(bodyEl);
}

function bind(bodyEl) {
    bodyEl.querySelector('#gl-btn-link')?.addEventListener('click', () => onLink(bodyEl));
    bodyEl.querySelector('#gl-btn-sync')?.addEventListener('click', () => onSync(bodyEl));
    bodyEl.querySelector('#gl-btn-disconnect')?.addEventListener('click', () => onDisconnect(bodyEl));
    bodyEl.querySelector('#gl-btn-erase')?.addEventListener('click', () => onErase(bodyEl));
    bodyEl.querySelector('#gl-auto-select')?.addEventListener('change', (e) => setAutoNewest(e.target.value === 'newest'));
}

function onStatus() {
    if (!currentBody?.isConnected) { eventBus.off('google:sync-status', onStatus); currentBody = null; return; }
    if (!busy) rerender(currentBody);
}

/**
 * Branche la partie Google après le rendu de l'écran Sauvegarder, et charge
 * la bibliothèque Google pour qu'elle soit prête au clic.
 */
export function bindGoogleSection(bodyEl) {
    if (state.isAdmin) return;
    flash = null;
    busy = false;
    bind(bodyEl);
    preloadGoogle();
    if (currentBody) eventBus.off('google:sync-status', onStatus);
    currentBody = bodyEl;
    eventBus.on('google:sync-status', onStatus);
}
