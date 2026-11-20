// google-link-ui.js — Partie « Synchroniser avec mon compte Google » de l'écran
// Sauvegarder (synchro users, PR 5). Maquette écrans 28-34 validée le 20/11/2026.
//
// PR 5 = relier, déconnecter, effacer. Rien n'est encore envoyé : la
// synchronisation (« Synchronisé il y a… », « Synchroniser maintenant ») arrive
// avec la PR 6. Pas de toast : la partie change sous les yeux du user, et un
// échec s'affiche dans un encadré à la place.

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

const INTRO = "Vos visites, notes et circuits suivent sur tous vos appareils reliés au même compte Google. Ils y sont rangés à part, sans toucher à vos fichiers, et Heripia ne les reçoit jamais. Les photos ne suivent pas : pour elles, gardez une copie dans un fichier ci-dessous.";

const LINK_FAIL = {
    closed: "La liaison n'a pas été faite : la fenêtre Google a été fermée avant la fin. Vous pouvez réessayer quand vous voulez.",
    denied: "La liaison n'a pas été faite : l'autorisation n'a pas été donnée dans la fenêtre Google. Vous pouvez réessayer quand vous voulez.",
    blocked: "Votre navigateur a empêché la fenêtre Google de s'ouvrir. Autorisez les fenêtres pour heripia.com, puis réessayez.",
    offline: "Pas de connexion à Internet. Réessayez quand vous serez connecté.",
    error: "La liaison n'a pas été faite : Google n'a pas répondu comme prévu. Réessayez plus tard.",
};
const ERASE_FAIL = {
    closed: "L'effacement n'a pas été fait : la fenêtre Google a été fermée avant la fin. Vos données sont toujours dans votre compte Google.",
    denied: "L'effacement n'a pas été fait : l'autorisation n'a pas été donnée dans la fenêtre Google. Vos données sont toujours dans votre compte Google.",
    blocked: "Votre navigateur a empêché la fenêtre Google de s'ouvrir. Autorisez les fenêtres pour heripia.com, puis réessayez.",
    offline: "Pas de connexion à Internet. Réessayez quand vous serez connecté.",
    error: "L'effacement n'a peut-être pas été complet : Google n'a pas répondu comme prévu. Réessayez plus tard.",
};
const ERASE_DONE = 'Vos données Heripia ont été effacées de votre compte Google.';

// État de la partie, gardé tant que l'écran est ouvert.
let busy = false;
let flash = null; // { tone: 'warn' | 'ok', text }

function flashHtml() {
    if (!flash) return '';
    const icon = flash.tone === 'ok' ? 'check-circle' : 'alert-triangle';
    return `<div class="gl-flash gl-flash--${flash.tone}" role="${flash.tone === 'ok' ? 'status' : 'alert'}">
      <i data-lucide="${icon}"></i><span>${escapeHtml(flash.text)}</span>
    </div>`;
}

function sectionHtml() {
    const acc = getLinkedAccount();
    if (acc) {
        return `
  <section class="me-block gl-section gl-section--on" aria-labelledby="lbl-google">
    <h3 class="me-block-title me-block-title-lg" id="lbl-google">Synchroniser avec mon compte Google</h3>
    <div class="gl-linked">
      <i data-lucide="check-circle"></i>
      <span><strong>Relié</strong> · <span class="gl-email">${escapeHtml(acc.email)}</span></span>
    </div>
    <p class="me-block-desc">Vos visites, notes et circuits suivent sur tous vos appareils reliés à ce compte.</p>
    ${flashHtml()}
    <div class="gl-actions">
      <button class="me-btn secondary" id="gl-btn-disconnect" type="button" ${busy ? 'disabled' : ''}>Déconnecter</button>
      <button class="gl-link-danger" id="gl-btn-erase" type="button" ${busy ? 'disabled' : ''}>Effacer mes données Heripia de mon compte Google</button>
    </div>
  </section>`;
    }
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

/** HTML de la partie Google, à placer en tête de l'écran Sauvegarder. */
export function googleSectionHtml() {
    return `<div id="gl-mount">${sectionHtml()}</div>`;
}

function rerender(bodyEl) {
    const mount = bodyEl.querySelector('#gl-mount');
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
    }
    busy = false;
    rerender(bodyEl);
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
    bodyEl.querySelector('#gl-btn-disconnect')?.addEventListener('click', () => onDisconnect(bodyEl));
    bodyEl.querySelector('#gl-btn-erase')?.addEventListener('click', () => onErase(bodyEl));
}

/**
 * Branche la partie Google après le rendu de l'écran Sauvegarder, et charge
 * la bibliothèque Google pour qu'elle soit prête au clic.
 */
export function bindGoogleSection(bodyEl) {
    flash = null;
    busy = false;
    bind(bodyEl);
    preloadGoogle();
}
