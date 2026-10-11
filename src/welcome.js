// welcome.js
// Écran « Que voulez-vous faire ? », accessible à la demande via le bouton
// boussole de la topbar (PC seulement ; le déclenchement automatique au 1er
// lancement a été retiré au profit de version-note.js — cf. main.js).
//
// 4 cartes (texte et ordre validés par Stefan le 11/10/2026) : Légende des
// icônes / Créer un lieu / Créer un circuit / Associer mes photos. Les cartes
// « Découvrir » et « Voir les circuits » ont été retirées : elles ouvraient ce
// qui est déjà affiché au lancement (la carte et la liste des circuits).
//
// Émet eventBus 'welcome:choice' { choice } à la sélection.
// Le câblage de chaque choix sur l'état de l'app est géré ailleurs.

import { eventBus } from './events.js';

// Épingle + « + » : même style que les autres illustrations (à reprendre avec
// Claude Design, comme le libellé du bouton boussole).
const SVG_PIN_PLUS = `
<svg viewBox="0 0 220 160" xmlns="http://www.w3.org/2000/svg">
    <circle cx="110" cy="80" r="72" fill="var(--brand)" opacity="0.08"/>
    <ellipse cx="104" cy="126" rx="22" ry="5" fill="var(--ink-soft)" opacity="0.2"/>
    <path d="M 104 124 C 104 124 74 92 74 68 A 30 30 0 0 1 134 68 C 134 92 104 124 104 124 Z" fill="var(--brand)" opacity="0.85"/>
    <circle cx="104" cy="68" r="11" fill="var(--surface)"/>
    <circle cx="150" cy="52" r="16" fill="var(--surface)" stroke="var(--brand)" stroke-width="2"/>
    <line x1="150" y1="44" x2="150" y2="60" stroke="var(--brand)" stroke-width="3" stroke-linecap="round"/>
    <line x1="142" y1="52" x2="158" y2="52" stroke="var(--brand)" stroke-width="3" stroke-linecap="round"/>
</svg>`;

const SVG_MAP_CIRCUIT = `
<svg viewBox="0 0 220 160" xmlns="http://www.w3.org/2000/svg">
    <circle cx="110" cy="80" r="72" fill="var(--brand)" opacity="0.08"/>
    <line x1="45" y1="55" x2="175" y2="55" stroke="var(--brand)" stroke-width="1" opacity="0.25"/>
    <line x1="45" y1="80" x2="175" y2="80" stroke="var(--brand)" stroke-width="1" opacity="0.25"/>
    <line x1="45" y1="105" x2="175" y2="105" stroke="var(--brand)" stroke-width="1" opacity="0.25"/>
    <line x1="80" y1="35" x2="80" y2="130" stroke="var(--brand)" stroke-width="1" opacity="0.25"/>
    <line x1="110" y1="35" x2="110" y2="130" stroke="var(--brand)" stroke-width="1" opacity="0.25"/>
    <line x1="140" y1="35" x2="140" y2="130" stroke="var(--brand)" stroke-width="1" opacity="0.25"/>
    <path d="M 58 118 C 65 90 85 75 110 70 C 130 66 148 75 155 58" stroke="var(--brand)" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="58" cy="118" r="7" fill="var(--brand)" opacity="0.9"/>
    <circle cx="110" cy="70" r="7" fill="var(--brand)" opacity="0.9"/>
    <circle cx="155" cy="58" r="7" fill="var(--brand)" opacity="0.9"/>
</svg>`;

const SVG_BOOK = `
<svg viewBox="0 0 220 160" xmlns="http://www.w3.org/2000/svg">
    <circle cx="110" cy="80" r="72" fill="var(--brand)" opacity="0.08"/>
    <path d="M 55 50 L 55 120 Q 55 125 60 125 L 108 118 L 108 45 L 62 45 Q 55 45 55 50 Z" fill="var(--surface-muted)" stroke="var(--brand)" stroke-width="1.5"/>
    <path d="M 165 50 L 165 120 Q 165 125 160 125 L 112 118 L 112 45 L 158 45 Q 165 45 165 50 Z" fill="var(--surface-muted)" stroke="var(--brand)" stroke-width="1.5"/>
    <line x1="110" y1="44" x2="110" y2="126" stroke="var(--brand)" stroke-width="2"/>
    <line x1="65" y1="62" x2="100" y2="62" stroke="var(--ink-soft)" stroke-width="1.5" opacity="0.5"/>
    <line x1="65" y1="72" x2="100" y2="72" stroke="var(--ink-soft)" stroke-width="1.5" opacity="0.5"/>
    <line x1="65" y1="82" x2="95" y2="82" stroke="var(--ink-soft)" stroke-width="1.5" opacity="0.5"/>
    <rect x="118" y="58" width="38" height="28" rx="3" fill="var(--brand)" opacity="0.2" stroke="var(--brand)" stroke-width="1"/>
    <path d="M 118 76 L 130 65 L 140 73 L 148 66 L 156 76 L 156 86 L 118 86 Z" fill="var(--brand)" opacity="0.3"/>
    <circle cx="128" cy="67" r="4" fill="var(--brand)" opacity="0.4"/>
    <line x1="118" y1="93" x2="155" y2="93" stroke="var(--ink-soft)" stroke-width="1.5" opacity="0.5"/>
    <line x1="118" y1="102" x2="148" y2="102" stroke="var(--ink-soft)" stroke-width="1.5" opacity="0.5"/>
</svg>`;

const SVG_PHONE_PHOTO = `
<svg viewBox="0 0 220 160" xmlns="http://www.w3.org/2000/svg">
    <circle cx="110" cy="80" r="72" fill="var(--brand)" opacity="0.08"/>
    <rect x="82" y="35" width="56" height="90" rx="6" fill="var(--surface)" stroke="var(--brand)" stroke-width="2"/>
    <rect x="86" y="42" width="48" height="66" rx="3" fill="var(--brand)" opacity="0.12"/>
    <rect x="92" y="50" width="36" height="26" rx="2" fill="var(--brand)" opacity="0.25"/>
    <circle cx="100" cy="60" r="3" fill="var(--brand)" opacity="0.5"/>
    <path d="M 92 76 L 102 66 L 110 72 L 118 65 L 128 76 L 128 76 L 92 76 Z" fill="var(--brand)" opacity="0.4"/>
    <circle cx="110" cy="116" r="3.5" fill="var(--brand)" opacity="0.6"/>
    <circle cx="158" cy="62" r="14" fill="var(--brand)" opacity="0.15" stroke="var(--brand)" stroke-width="1.5"/>
    <circle cx="158" cy="62" r="6" fill="var(--brand)" opacity="0.5"/>
</svg>`;

// Le livre ouvert (ex-carte « Voir les circuits ») reprend l'icône du bouton
// Légende de la carte : le visiteur retrouve le même symbole.
const CARDS = [
    {
        id: 'legend',
        svg: SVG_BOOK,
        title: 'Voir la légende des icônes',
        subtitle: 'Je comprends ce que signifie chaque symbole'
    },
    {
        id: 'new-place',
        svg: SVG_PIN_PLUS,
        title: 'Créer un nouveau lieu',
        subtitle: 'J\'ajoute un lieu qui manque, je peux le signaler'
    },
    {
        id: 'create',
        svg: SVG_MAP_CIRCUIT,
        title: 'Créer mon propre circuit',
        subtitle: 'Je m\'aventure, je trace mon parcours'
    },
    {
        id: 'photos',
        svg: SVG_PHONE_PHOTO,
        title: 'Associer mes photos aux lieux',
        subtitle: 'Je personnalise, j\'ajoute mes photos à mes visites'
    }
];

export function showWelcomeAgain() {
    if (document.getElementById('welcome-overlay')) return;

    const cards = CARDS;

    const overlay = document.createElement('div');
    overlay.id = 'welcome-overlay';
    overlay.innerHTML = `
        <div class="welcome-modal" role="dialog" aria-modal="true" aria-labelledby="welcome-modal-title">
            <h2 class="welcome-modal-title" id="welcome-modal-title">Que voulez-vous faire ?</h2>

            <div class="welcome-cards" id="welcome-cards"></div>

            <button class="welcome-btn-skip" id="welcome-skip" type="button">Fermer</button>
        </div>
    `;
    document.body.appendChild(overlay);

    const cardsEl = overlay.querySelector('#welcome-cards');
    cards.forEach(card => {
        const btn = document.createElement('button');
        btn.className = 'welcome-card';
        btn.type = 'button';
        btn.dataset.choice = card.id;
        btn.innerHTML = `
            <div class="welcome-card-icon">${card.svg}</div>
            <div class="welcome-card-content">
                <span class="welcome-card-title">${card.title}</span>
                <span class="welcome-card-subtitle">${card.subtitle}</span>
            </div>
        `;
        btn.addEventListener('click', () => choose(card.id));
        cardsEl.appendChild(btn);
    });

    // « Fermer » : ferme seulement (l'ancien « Passer » émettait 'discover').
    overlay.querySelector('#welcome-skip').addEventListener('click', close);

    function choose(choiceId) {
        eventBus.emit('welcome:choice', { choice: choiceId });
        close();
    }

    function close() {
        overlay.classList.add('welcome-fadeout');
        setTimeout(() => overlay.remove(), 350);
    }

    requestAnimationFrame(() => overlay.classList.add('welcome-visible'));
}
