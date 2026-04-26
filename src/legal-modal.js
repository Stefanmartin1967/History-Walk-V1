// legal-modal.js
// Modale "Mentions légales" — point unique de vérité juridique de l'application
// (étape 2 de la protection juridique). Accessible depuis le menu Outils desktop
// et le menu mobile.

import { showAlert } from './modal.js';

const CONTACT_EMAIL = 'history.walk.007@gmail.com';
const COPYRIGHT_YEAR = 2026;
const COPYRIGHT_HOLDER = 'Stefan Martin';

export function showLegalNoticeModal() {
    const html = `
        <div class="legal-modal-content">
            <p class="legal-copyright">
                © ${COPYRIGHT_YEAR} ${COPYRIGHT_HOLDER} — History Walk.<br>
                Tous droits réservés.
            </p>

            <h3 class="legal-section-title">Propriété intellectuelle</h3>
            <p>
                Le contenu de cette application (textes, descriptions, photos personnelles,
                fiches de lieux, recherches historiques) est la propriété exclusive de l'auteur.
                Toute reproduction, modification ou utilisation sans autorisation écrite
                préalable est interdite.
            </p>

            <h3 class="legal-section-title">Données cartographiques</h3>
            <p>
                Données cartographiques © OpenStreetMap contributors, sous licence
                <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">ODbL (Open Database License)</a>.
                Ces données restent la propriété de leurs contributeurs et ne sont pas
                couvertes par la licence du présent projet.
            </p>

            <h3 class="legal-section-title">Contact</h3>
            <p>
                Pour toute question juridique, demande de licence ou signalement,
                contactez :<br>
                <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>
            </p>
        </div>
    `;
    return showAlert('Mentions légales', html, 'Fermer', 'legal-modal');
}
