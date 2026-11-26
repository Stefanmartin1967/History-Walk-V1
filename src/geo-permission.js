// geo-permission.js — position indisponible ou introuvable : textes communs + aide.
//
// Audit avant publication, tests sur S25 (Brave) :
//  - 24/11/2026 : une fois la position refusée, le navigateur ne la redemande
//    plus ; un bouton « Autoriser » qui relance la recherche ne faisait rien.
//  - 25-26/11/2026 (test E) : localisation du TÉLÉPHONE coupée → le navigateur
//    renvoie le même code 1 qu'un refus, et l'état de la permission du site
//    passe lui aussi à « bloqué » (vérifié par élimination, #1163 puis #1164).
//    L'app ne peut donc pas savoir lequel des deux réglages bloque.
// D'où deux cas seulement (maquette écrans 68-70, validée le 26/11/2026) :
//  - bloquée (code 1) : « Position indisponible », on nomme les DEUX réglages
//    (localisation du téléphone, autorisation du navigateur) ;
//  - introuvable (codes 2 et 3 : pas de signal, délai dépassé) → « Réessayer ».
// Le message du navigateur (anglais, « User denied Geolocation ») n'est jamais
// montré.
import { openHwModal } from './modal.js';
import { isIOS } from './install-pwa-banner.js';

/** Position bloquée : refusée pour le site OU localisation du téléphone coupée. */
export function isGeoBlocked(err) {
    return err?.code === 1;
}

const BLOCKED_HINT = "vérifiez la localisation du téléphone et l'autorisation du navigateur";

/** { title, text } pour une erreur de position (fenêtres et encadrés courts). */
export function geoErrorTexts(err) {
    return isGeoBlocked(err)
        ? { title: 'Position indisponible', text: "Vérifiez la localisation du téléphone et l'autorisation du navigateur." }
        : { title: 'Position introuvable', text: 'Vérifiez que la localisation du téléphone est activée.' };
}

/** Une phrase pour un toast (« Position indisponible : vérifiez… »). */
export function geoErrorSentence(err, suffix = '') {
    const sentence = isGeoBlocked(err)
        ? `Position indisponible : ${BLOCKED_HINT}`
        : 'Position introuvable : vérifiez que la localisation du téléphone est activée';
    return `${sentence}${suffix}.`;
}

const chip = (label) => `<span class="ios-install-chip">${label}</span>`;

/** Écran 69 : les deux volets, { phone, browser }, numérotés à la suite. */
export function geoHelpSteps(ios = isIOS()) {
    if (ios) {
        // Non vérifié sur un iPhone : chemin des Réglages d'iOS.
        return {
            phone: [
                "Ouvrez les Réglages de l'iPhone.",
                'Touchez « Confidentialité et sécurité », puis activez « Service de localisation ».',
            ],
            browser: [
                "Dans « Service de localisation », touchez « Sites web Safari » et choisissez « Lorsque l'app est active ».",
            ],
        };
    }
    // Volet navigateur : chemin suivi par Stefan dans Brave (S25, 24/11/2026).
    return {
        phone: [
            "Tirez le volet du haut de l'écran.",
            "Touchez « Localisation » pour l'activer.",
        ],
        browser: [
            'Ouvrez le navigateur avec lequel vous avez installé Heripia (Chrome, Brave, Samsung Internet…).',
            `Menu ${chip('⋮')} → Paramètres → Paramètres des sites → Position.`,
            'Touchez heripia.com et choisissez « Autoriser ».',
        ],
    };
}

/** Écran 69 : « Retrouver votre position », en deux volets. */
export function openGeoPermissionHelp() {
    const { phone, browser } = geoHelpSteps();
    let n = 0;
    const list = (steps) => `<ol class="ios-install-steps">${steps
        .map((s) => `<li><span class="ios-install-num">${++n}</span><span>${s}</span></li>`).join('')}</ol>`;
    return openHwModal({
        size: 'sm',
        icon: 'map-pin',
        title: 'Retrouver votre position',
        body: `<p class="ios-install-why">Deux réglages peuvent bloquer la position. Vérifiez-les dans cet ordre.</p>
            <div class="geo-help-sec">1 · La localisation du téléphone</div>${list(phone)}
            <div class="geo-help-sec">2 · L'autorisation du navigateur</div>${list(browser)}
            <div class="geo-help-end">Revenez ensuite dans Heripia : votre position apparaîtra toute seule.</div>`,
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
