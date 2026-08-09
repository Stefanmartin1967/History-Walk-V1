// version-note.js
// Note de version : remplace l'ancien écran de bienvenue auto-déclenché au
// 1er lancement (welcome.js gardait ce rôle + celui du bouton "Visite
// guidée" — les deux ont été dissociés, welcome.js ne sert plus que le 2e).
//
// S'affiche au 1er lancement, puis à chaque fois que NOTE_VERSION est
// incrémenté — PAS à chaque bump d'APP_VERSION (state.js), qui change à
// chaque livraison. NOTE_VERSION est un compteur à part, à incrémenter
// manuellement UNIQUEMENT quand un changement mérite de repasser devant les
// visiteurs (nouvelle réserve sur les données, nouvelle fonctionnalité
// notable...).

import { hwAlert } from './modal.js';

const NOTE_KEY = 'hw_version_note_seen';

// Contenu courant de la note. Incrémenter NOTE_VERSION à chaque mise à jour
// qui doit redéclencher l'affichage.
const NOTE_VERSION = 1;

const NOTE_TITLE = 'Avant de continuer';

const NOTE_BODY = `
    <p>Heripia est encore en phase d'amélioration.</p>
    <p><strong>Chaque lieu a été vérifié sur Google Maps et OpenStreetMap.</strong>
    Il n'a été retenu que s'il apparaît sur au moins l'un des deux services —
    vous pouvez l'ouvrir directement depuis sa fiche.</p>
    <p><strong>Le nom affiché peut être imprécis.</strong> Google Maps et
    OpenStreetMap se contredisent parfois, et la transcription d'un nom arabe
    en français varie selon les sources.</p>
`;

function getSeenVersion() {
    return parseInt(localStorage.getItem(NOTE_KEY) || '0', 10);
}

export function showVersionNoteIfNeeded() {
    if (getSeenVersion() >= NOTE_VERSION) return;

    hwAlert({
        title: NOTE_TITLE,
        body: NOTE_BODY,
        label: "J'ai compris",
    }).then(() => {
        localStorage.setItem(NOTE_KEY, String(NOTE_VERSION));
    });
}
