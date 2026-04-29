// legal-modal.js
// Modale "Mentions légales" — point unique de vérité juridique de l'application
// (étape 2 de la protection juridique). Accessible depuis le menu Outils desktop
// et le menu mobile.
//
// Utilise le système HW Modal V2 (variante md, icône scale, sans footer :
// fermeture via croix uniquement — info-only, pas d'action explicite).

import { openHwModal } from './modal.js';

const CONTACT_EMAIL = 'history.walk.007@gmail.com';
const COPYRIGHT_YEAR = 2026;
const COPYRIGHT_HOLDER = 'Stefan Martin';

export function showLegalNoticeModal() {
    const body = `
        <p>© ${COPYRIGHT_YEAR} ${COPYRIGHT_HOLDER} — History Walk.<br>
            Tous droits réservés.</p>

        <h3>Propriété intellectuelle</h3>
        <p>Le contenu de cette application (textes, descriptions, photos personnelles,
            fiches de lieux, recherches historiques) est la propriété exclusive de l'auteur.
            Toute reproduction, modification ou utilisation sans autorisation écrite
            préalable est interdite.</p>

        <h3>Données cartographiques</h3>
        <p>Le fond de carte par défaut provient d'<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors,
            sous licence ODbL (Open Database License). Ces données restent la propriété de
            leurs contributeurs et ne sont pas couvertes par la licence du présent projet.</p>
        <p>L'application utilise également les
            <a href="https://www.google.com/intl/fr_fr/help/terms_maps/" target="_blank" rel="noopener noreferrer">fonds Google Maps</a>
            (vue satellite et plan), soumis aux conditions d'utilisation de Google.
            Le contenu Google reste la propriété exclusive de Google et de ses fournisseurs.</p>

        <h3>Contact</h3>
        <p>Pour toute question juridique, demande de licence ou signalement,
            contactez :<br>
            <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>
    `;

    return openHwModal({
        size: 'md',
        variant: 'default',
        icon: 'scale',
        title: 'Mentions légales',
        body,
        // footer: false → pas de bouton "Fermer" redondant avec la croix.
        // L'utilisateur ferme via la croix du header, le clic sur le backdrop ou Escape.
        footer: false,
    });
}
