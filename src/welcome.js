// welcome.js
// Onboarding par choix d'usage, accessible à la demande via le bouton
// "Visite guidée" de la topbar (le déclenchement automatique au 1er
// lancement a été retiré au profit de version-note.js — cf. main.js).
//
// 4 cartes : Découvrir / Voir les circuits / Créer / Importer photos GPS.
//
// Émet eventBus 'welcome:choice' { choice } à la sélection.
// Le câblage de chaque choix sur l'état de l'app est géré ailleurs.

import { eventBus } from './events.js';
import { state, getActiveDestinationName } from './state.js';

// Repli propre à l'UI : une phrase doit rester lisible même destination inconnue.
const destinationLabel = () => getActiveDestinationName() || 'la destination';

const SVG_COMPASS = `
<svg viewBox="0 0 220 160" xmlns="http://www.w3.org/2000/svg">
    <circle cx="110" cy="80" r="72" fill="var(--brand)" opacity="0.08"/>
    <circle cx="110" cy="78" r="45" fill="none" stroke="var(--brand)" stroke-width="2" opacity="0.3"/>
    <circle cx="110" cy="78" r="38" fill="none" stroke="var(--brand)" stroke-width="1" opacity="0.2"/>
    <text x="110" y="36" font-size="11" fill="var(--brand)" text-anchor="middle" font-weight="bold" opacity="0.7">N</text>
    <text x="110" y="128" font-size="11" fill="var(--ink-soft)" text-anchor="middle" opacity="0.5">S</text>
    <text x="64" y="82" font-size="11" fill="var(--ink-soft)" text-anchor="middle" opacity="0.5">O</text>
    <text x="156" y="82" font-size="11" fill="var(--ink-soft)" text-anchor="middle" opacity="0.5">E</text>
    <polygon points="110,42 106,78 110,72 114,78" fill="var(--brand)" opacity="0.9"/>
    <polygon points="110,114 106,78 110,84 114,78" fill="var(--ink-soft)" opacity="0.4"/>
    <circle cx="110" cy="78" r="5" fill="var(--brand)" opacity="0.8"/>
    <circle cx="110" cy="78" r="2.5" fill="var(--surface)"/>
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

function buildCards() {
    return [
        {
            id: 'discover',
            svg: SVG_COMPASS,
            title: `Découvrir ${destinationLabel()}`,
            subtitle: 'Je flâne, je regarde ce qui existe'
        },
        {
            id: 'import',
            svg: SVG_BOOK,
            title: 'Voir les circuits existants',
            subtitle: 'Je m\'inspire des circuits, je filtre selon mes envies'
        },
        {
            id: 'create',
            svg: SVG_MAP_CIRCUIT,
            title: 'Créer mon propre circuit',
            subtitle: 'Je m\'aventure, je trace mon parcours'
        }
    ];
}

const CARD_PHOTOS = {
    id: 'photos',
    svg: SVG_PHONE_PHOTO,
    title: 'Associer mes photos aux lieux',
    subtitle: 'Je personnalise, j\'ajoute mes photos à mes visites'
};

export function showWelcomeAgain() {
    if (document.getElementById('welcome-overlay')) return;

    const cards = [...buildCards(), CARD_PHOTOS];

    const overlay = document.createElement('div');
    overlay.id = 'welcome-overlay';
    overlay.innerHTML = `
        <div class="welcome-modal" role="dialog" aria-modal="true" aria-labelledby="welcome-modal-title">
            <h2 class="welcome-modal-title" id="welcome-modal-title">Que voulez-vous faire ?</h2>
            <p class="welcome-modal-subtitle">Bienvenue sur Heripia</p>

            <div class="welcome-cards" id="welcome-cards"></div>

            <button class="welcome-btn-skip" id="welcome-skip" type="button">Passer →</button>
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

    overlay.querySelector('#welcome-skip').addEventListener('click', () => choose('discover'));

    function choose(choiceId) {
        eventBus.emit('welcome:choice', { choice: choiceId });
        overlay.classList.add('welcome-fadeout');
        setTimeout(() => overlay.remove(), 350);
    }

    requestAnimationFrame(() => overlay.classList.add('welcome-visible'));
}
