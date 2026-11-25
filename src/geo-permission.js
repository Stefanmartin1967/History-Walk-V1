// geo-permission.js — position refusée ou introuvable : textes communs + aide.
//
// Audit avant publication, test 4 sur S25 (24/11/2026, maquette écrans 65-67
// validée par Stefan) : une fois la position REFUSÉE, le navigateur ne la
// redemande plus ; un bouton « Autoriser » qui relance la recherche ne fait
// rien. On distingue donc deux cas :
//  - refusée (code 1) : seuls les réglages du navigateur y changent quelque
//    chose → « Comment faire ? » ouvre la marche à suivre ;
//  - introuvable (codes 2 et 3 : pas de signal, délai dépassé ; ou code 1
//    alors que le site est autorisé = localisation du téléphone coupée)
//    → « Réessayer » a un sens.
// Le message du navigateur (anglais, « User denied Geolocation ») n'est plus
// jamais montré.
import { openHwModal } from './modal.js';
import { isIOS } from './install-pwa-banner.js';

// Test E sur S25 (25/11/2026, Brave) : localisation du TÉLÉPHONE coupée,
// permission du site accordée → le navigateur renvoie AUSSI le code 1. Le code
// seul ne suffit donc pas : on demande l'état de la permission du site. Encore
// « granted » → ce n'est pas un refus, c'est la localisation coupée
// (« introuvable »). Sans Permissions API (vieux Safari) : on garde le code.
async function sitePermissionState() {
    try {
        const st = await navigator.permissions?.query({ name: 'geolocation' });
        return st?.state ?? null;
    } catch {
        return null;
    }
}

/** true seulement si la position est vraiment refusée pour le site. */
export async function isGeoDenied(err) {
    if (err?.code !== 1) return false;
    return (await sitePermissionState()) !== 'granted';
}

/** { title, text } pour une erreur de position (fenêtres et encadrés courts). */
export async function geoErrorTexts(err) {
    return (await isGeoDenied(err))
        ? { title: 'Position refusée', text: 'Autorisez-la dans les réglages du navigateur.' }
        : { title: 'Position introuvable', text: 'Vérifiez que la localisation du téléphone est activée.' };
}

/** Une phrase pour un toast (« Position refusée : autorisez-la… »). */
export async function geoErrorSentence(err, suffix = '') {
    const sentence = (await isGeoDenied(err))
        ? 'Position refusée : autorisez-la dans les réglages du navigateur'
        : 'Position introuvable : vérifiez que la localisation du téléphone est activée';
    return `${sentence}${suffix}.`;
}

const chip = (label) => `<span class="ios-install-chip">${label}</span>`;

export function geoPermissionSteps(ios = isIOS()) {
    if (ios) {
        // Non vérifié sur un iPhone (24/11/2026) : chemin des Réglages d'iOS.
        return [
            "Ouvrez les Réglages de l'iPhone.",
            'Touchez « Confidentialité et sécurité », puis « Service de localisation ».',
            'Activez le service, puis touchez « Sites web Safari » et choisissez « Lorsque l\'app est active ».',
            'Revenez dans Heripia : votre position apparaîtra.',
        ];
    }
    // Chemin suivi par Stefan dans Brave (S25, 24/11/2026).
    return [
        "Ouvrez le navigateur avec lequel vous avez installé Heripia (Chrome, Brave, Samsung Internet…).",
        `Menu ${chip('⋮')} → Paramètres → Paramètres des sites → Position.`,
        'Touchez heripia.com et choisissez « Autoriser ».',
        'Revenez dans Heripia : votre position apparaîtra toute seule.',
    ];
}

/** Écran 66 : la marche à suivre quand la position a été refusée. */
export function openGeoPermissionHelp() {
    const steps = geoPermissionSteps()
        .map((s, i) => `<li><span class="ios-install-num">${i + 1}</span><span>${s}</span></li>`).join('');
    return openHwModal({
        size: 'sm',
        icon: 'map-pin',
        title: 'Autoriser la position',
        body: `<p class="ios-install-why">Vous avez refusé la position une fois : le navigateur ne la redemande plus. Il faut la rétablir dans ses réglages.</p>
            <ol class="ios-install-steps">${steps}</ol>`,
        footer: `<button class="btn btn-primary ios-install-ok" data-hw-modal-action="close">J'ai compris</button>`,
    });
}

/**
 * Appelle `fn` quand la position redevient autorisée (réglage changé pendant que
 * l'app est ouverte, ou au retour dans l'app). Renvoie de quoi se désabonner.
 * Sans Permissions API (vieux Safari) : ne fait rien.
 */
export function onGeoPermissionGranted(fn) {
    let status = null;
    let stopped = false;
    const handler = () => { if (status?.state === 'granted') fn(); };
    try {
        navigator.permissions?.query({ name: 'geolocation' })
            .then((st) => {
                if (stopped) return;
                status = st;
                st.addEventListener?.('change', handler);
            })
            .catch(() => {});
    } catch { /* Permissions API absente */ }
    return () => {
        stopped = true;
        status?.removeEventListener?.('change', handler);
    };
}
