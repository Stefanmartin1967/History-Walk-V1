// tts.js — Text-To-Speech (lecture vocale d'un texte via window.speechSynthesis).
// Utilisé par le bouton "Lire" sur la fiche POI (ui-details.js).
import { showToast } from './toast.js';

export function speakText(text, button) {
    if (!window.speechSynthesis) {
        showToast("Synthèse vocale non supportée.", "warning");
        return;
    }

    const resetIcon = () => {
        if (button) {
            // Icône "Play" (Triangle)
            button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;
        }
    };

    if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
        resetIcon();
        return;
    }

    if (!text || text.trim() === '') {
        showToast("Le champ est vide.", "info");
        return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'fr-FR';

    utterance.onstart = () => {
        if (button) {
            // Icône "Stop" (Carré/Lignes)
            button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/></svg>`;
        }
    };

    utterance.onend = resetIcon;
    utterance.onerror = resetIcon;

    window.speechSynthesis.speak(utterance);
}
