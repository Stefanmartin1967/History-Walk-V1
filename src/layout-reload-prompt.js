// layout-reload-prompt.js — la fenêtre a changé d'affichage (mobile ↔ bureau)
// APRÈS le démarrage.
//
// Les deux interfaces se construisent une seule fois (main.js, lockLayoutMode) :
// la carte n'existe pas en mobile, la liste mobile n'existe pas en bureau. Le
// CSS, lui, suit la fenêtre en direct (MOBILE_LAYOUT_QUERY) : une fenêtre de PC
// passée en demi-écran, une tablette tournée affichaient donc l'interface
// JAMAIS construite — écran vide, boutons inertes (mesuré le 18/10/2026).
// On recouvre cet écran mort d'un message et d'un bouton « Recharger ». Pas de
// rechargement automatique (choix de Stefan, 18/10/2026) : il surprendrait en
// plein redimensionnement, et le bouton passe par les alertes « modifications
// non enregistrées » déjà en place. Si la fenêtre reprend sa taille, le message
// disparaît de lui-même.
import { MOBILE_LAYOUT_QUERY, isMobileView } from './mobile-state.js';

const PROMPT_ID = 'layout-reload-prompt';

function buildPrompt() {
    const prompt = document.createElement('div');
    prompt.id = PROMPT_ID;
    prompt.className = 'layout-reload-prompt';
    prompt.hidden = true;
    prompt.setAttribute('role', 'alertdialog');
    prompt.setAttribute('aria-labelledby', 'layout-reload-title');
    prompt.setAttribute('aria-describedby', 'layout-reload-text');
    prompt.innerHTML = `
        <div class="layout-reload-card">
            <h2 id="layout-reload-title" class="layout-reload-title">Affichage à adapter</h2>
            <p id="layout-reload-text" class="layout-reload-text">La fenêtre a changé de taille. Rechargez Heripia pour passer à l'affichage adapté, ou rendez à la fenêtre sa taille précédente.</p>
            <button type="button" class="btn btn-primary layout-reload-btn">Recharger</button>
        </div>`;
    prompt.querySelector('.layout-reload-btn').addEventListener('click', () => window.location.reload());
    document.body.appendChild(prompt);
    return prompt;
}

function setPromptVisible(visible) {
    let prompt = document.getElementById(PROMPT_ID);
    if (!visible) {
        if (prompt) prompt.hidden = true;
        return;
    }
    if (!prompt) prompt = buildPrompt();
    if (!prompt.hidden) return;
    prompt.hidden = false;
    // Une modale ouverte (saisie en cours) reste au-dessus et garde le focus.
    if (!document.querySelector('.hw-modal-overlay.is-active')) {
        prompt.querySelector('.layout-reload-btn')?.focus();
    }
}

/**
 * Surveille la fenêtre : message affiché tant que l'affichage qu'elle appelle
 * n'est pas celui construit au démarrage. À appeler APRÈS lockLayoutMode.
 */
export function startLayoutReloadPrompt() {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(MOBILE_LAYOUT_QUERY);
    const sync = () => setPromptVisible(query.matches !== isMobileView());
    query.addEventListener('change', sync);
    sync();
}
