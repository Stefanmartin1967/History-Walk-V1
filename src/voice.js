// voice.js
import { showToast } from './toast.js';
import { createIcons, icons } from 'lucide';

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

let state = {
    isActive: false,
    currentButton: null,
    currentTargetInput: null,
    finalTranscript: ''
};

const punctuationMap = [
    { key: 'point d\'exclamation', value: '!' }, // J'ai retiré l'espace avant, on le gère plus bas
    { key: 'point d\'interrogation', value: '?' },
    { key: 'point virgule', value: ';' },
    { key: 'deux points', value: ':' },
    { key: 'ouvrir la parenthèse', value: '(' },
    { key: 'fermer la parenthèse', value: ')' },
    { key: 'à la ligne', value: '\n' },
    { key: 'point', value: '.' },
    { key: 'virgule', value: ',' },
];

// --- FONCTION CORRIGÉE ---
function applyPunctuation(text) {
    let correctedText = text;

    for (const p of punctuationMap) {
        // Regex complexe pour :
        // 1. Échapper les caractères spéciaux dans la clé
        // 2. 'gi' = Case insensitive (trouve "Point" et "point")
        // 3. \b = Word Boundary (évite de remplacer "pointer" par ".")
        // Note : Pour les clés avec espaces (ex: point d'exclamation), \b fonctionne aux extrémités
        const safeKey = p.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${safeKey}\\b`, 'gi');
        
        // On remplace par la ponctuation
        correctedText = correctedText.replace(regex, p.value);
    }

    // Nettoyage cosmétique :
    // 1. On s'assure qu'il n'y a pas d'espace AVANT la ponctuation simple (.,) sauf si voulu
    // 2. On s'assure qu'il y a un espace APRÈS la ponctuation
    // (Simplifié ici pour ne pas trop alourdir, on gère surtout les espaces doubles)
    correctedText = correctedText.replace(/\s+([.,:;!?])/g, '$1'); // "mot ." -> "mot."
    correctedText = correctedText.replace(/([.,:;!?])(?=[a-zA-Z])/g, '$1 '); // "mot.mot" -> "mot. mot"

    // Capitalisation (Début de phrase, ou après . ? ! ou retour à la ligne)
    return correctedText.trim().replace(/((^|[.?!]\s*|\n\s*)[a-z])/g, (match) => match.toUpperCase());
}

function updateIcon(button, isRecording) {
    if (button) {
        button.classList.toggle('recording', isRecording);
        button.innerHTML = isRecording ? '<i data-lucide="mic-off"></i>' : '<i data-lucide="mic"></i>';
        createIcons({ icons });
    }
}

function initializeRecognition() {
    if (!SpeechRecognition) {
        console.warn("La reconnaissance vocale n'est pas supportée par ce navigateur.");
        return null;
    }

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'fr-FR';

    rec.onstart = () => {
        state.isActive = true;
        // Ajout d'un espace si le champ n'est pas vide pour ne pas coller le texte
        const currentVal = state.currentTargetInput.value;
        state.finalTranscript = currentVal ? currentVal + (currentVal.endsWith(' ') ? '' : ' ') : '';
        updateIcon(state.currentButton, true);
    };

    rec.onend = () => {
        state.isActive = false;
        if (state.currentTargetInput && state.currentTargetInput.value) {
            state.currentTargetInput.value = applyPunctuation(state.currentTargetInput.value);
        }
        updateIcon(state.currentButton, false);
        state.currentButton = null;
        state.currentTargetInput = null;
    };

    rec.onresult = (event) => {
        if (!state.currentTargetInput) return;
        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                state.finalTranscript += event.results[i][0].transcript;
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }
        
        state.currentTargetInput.value = state.finalTranscript + interimTranscript;
    };

    rec.onerror = (event) => {
        console.error('Erreur de reconnaissance vocale:', event.error);
        if (event.error === 'no-speech' || event.error === 'audio-capture') {
            showToast("Micro arrêté (silence).", 'warning');
        } else if (event.error !== 'aborted') {
            showToast("Erreur vocale : " + event.error, 'error');
        }
    };

    return rec;
}

recognition = initializeRecognition();

export function startDictation(button, targetInput) {
    if (!recognition) {
        showToast("Dictée vocale non supportée.", "error");
        return;
    }
    if (state.isActive) {
        stopDictation();
        return;
    }
    state.currentButton = button;
    state.currentTargetInput = targetInput;
    try {
        recognition.start();
    } catch (e) {
        console.error("Erreur au démarrage de la reconnaissance : ", e);
        if (e.name !== 'InvalidStateError') {
            showToast("Impossible de démarrer le micro.", "error");
        }
    }
}

export function stopDictation() {
    if (recognition && state.isActive) {
        recognition.stop();
    }
}

export function isDictationActive() {
    return state.isActive;
}

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