// toast.js
// Ce fichier gère uniquement les petits messages d'alerte (notifications)

export function showToast(message, type = 'info', duration = 4000, action = null) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    // Annonce lecteur d'écran (audit AC5) : les erreurs interrompent (alert),
    // le reste passe par la file polie (status, hérite du aria-live du conteneur).
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

    let iconSvg = '';
    // Définition des icônes spécifiques aux notifications
    if (type === 'success') iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>`;
    else if (type === 'error') iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>`;
    else if (type === 'warning') iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>`;
    else iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`;

    toast.innerHTML = iconSvg;
    const span = document.createElement('span');
    span.textContent = message;
    toast.appendChild(span);

    if (action) {
        const btn = document.createElement('button');
        btn.className = 'toast-action';
        btn.textContent = action.label;
        btn.addEventListener('click', () => {
            toast.remove();
            action.onClick();
        });
        toast.appendChild(btn);
    }

    // Durée honorée via variable CSS (audit AC5) : le délai 3.5s figé dans
    // base.css neutralisait tout `duration` > 4s. CSSOM (.style.setProperty),
    // compatible CSP prod.
    toast.style.setProperty('--toast-fade-delay', `${Math.max(duration - 500, 300)}ms`);
    container.appendChild(toast);

    // Retrait par minuterie, PAS sur animationend : les animations CSS
    // n'avancent pas quand la page n'est pas rendue (onglet caché) — des
    // toasts zombies s'accumuleraient. Le fadeOut CSS est purement visuel
    // et se termine pile à `duration` (delay + 0.5s).
    setTimeout(() => toast.remove(), Math.max(duration, 800));
}
