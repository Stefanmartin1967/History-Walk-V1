// back-button-debug.js
// Logger d'événements de navigation on-screen pour diagnostiquer le bouton
// Back Android (PWA standalone). Activé lorsque le mode admin est actif,
// ou via l'URL paramètre ?debug-back=1 (persistant en localStorage).
//
// À RETIRER une fois C7 résolu.

import { state } from './state.js';
import { getCurrentView } from './mobile-state.js';
import { eventBus } from './events.js';

const DEBUG_KEY = 'hw_debug_back';
const MAX_LOGS = 30;

let _panel = null;
let _body = null;
let _logs = [];
let _listenersAttached = false;

// ─── Activation ──────────────────────────────────────────────────────────────

function isDebugEnabled() {
    // URL param active le flag en localStorage (une seule visite suffit)
    const params = new URLSearchParams(window.location.search);
    if (params.get('debug-back') === '1') {
        localStorage.setItem(DEBUG_KEY, '1');
    } else if (params.get('debug-back') === '0') {
        localStorage.removeItem(DEBUG_KEY);
    }
    return (
        localStorage.getItem(DEBUG_KEY) === '1' ||
        state.isAdmin === true
    );
}

// ─── Formatage ───────────────────────────────────────────────────────────────

function stamp() {
    const d = new Date();
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    return `${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

// ─── Panel UI ────────────────────────────────────────────────────────────────

function createPanel() {
    if (_panel) return _panel;

    _panel = document.createElement('div');
    _panel.id = 'hw-back-debug';
    _panel.style.cssText = [
        'position:fixed',
        'top:0',
        'left:0',
        'right:0',
        'z-index:2147483647',
        'background:rgba(0,0,0,0.92)',
        'color:#0f0',
        'font:10px/1.25 ui-monospace,Menlo,monospace',
        'padding:4px 6px',
        'max-height:45vh',
        'overflow-y:auto',
        'border-bottom:2px solid #0f0',
        'pointer-events:auto',
    ].join(';');

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:3px';

    const title = document.createElement('span');
    title.textContent = 'BACK DEBUG';
    title.style.cssText = 'color:#ff0;font-weight:bold;flex:1';

    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear';
    clearBtn.style.cssText = 'background:#333;color:#0f0;border:1px solid #0f0;font:10px monospace;padding:1px 6px;cursor:pointer';
    clearBtn.onclick = () => { _logs = []; render(); };

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = 'background:#900;color:#fff;border:none;font:bold 14px sans-serif;width:22px;height:20px;cursor:pointer;line-height:1';
    closeBtn.onclick = () => { _panel.remove(); _panel = null; _body = null; };

    header.appendChild(title);
    header.appendChild(clearBtn);
    header.appendChild(closeBtn);
    _panel.appendChild(header);

    _body = document.createElement('div');
    _panel.appendChild(_body);

    document.body.appendChild(_panel);
    return _panel;
}

function render() {
    if (!_body) return;
    _body.innerHTML = _logs.map(e => {
        const extras = Object.entries(e.details || {})
            .map(([k, v]) => `${k}=${v}`)
            .join(' ');
        return `<div><span style="color:#ff0">${e.t}</span> <b style="color:#f0f">${e.type}</b> `
             + `<span style="color:#9cf">view=${e.view} hash=${e.hash} hLen=${e.histLen} poi=${e.featureId ?? '-'}</span>`
             + (extras ? ` <span style="color:#cfc">${extras}</span>` : '')
             + `</div>`;
    }).join('');
}

function log(type, details = {}) {
    _logs.unshift({
        t: stamp(),
        type,
        view: getCurrentView(),
        hash: location.hash || '-',
        histLen: history.length,
        featureId: state.currentFeatureId,
        details,
    });
    if (_logs.length > MAX_LOGS) _logs.length = MAX_LOGS;
    render();
}

// ─── Attachement listeners ───────────────────────────────────────────────────

function attachListeners() {
    if (_listenersAttached) return;
    _listenersAttached = true;

    window.addEventListener('popstate', (e) => {
        const st = e.state ? JSON.stringify(e.state) : 'null';
        log('popstate', { state: st.slice(0, 40) });
    });

    window.addEventListener('hashchange', (e) => {
        log('hashchange', {
            old: (e.oldURL || '').split('#')[1] || '-',
            new: (e.newURL || '').split('#')[1] || '-',
        });
    });

    window.addEventListener('pageshow', (e) => log('pageshow', { persisted: e.persisted }));
    window.addEventListener('pagehide', (e) => log('pagehide', { persisted: e.persisted }));
    document.addEventListener('visibilitychange', () => {
        log('visibility', { v: document.visibilityState });
    });

    // Navigation API (Chrome 102+)
    if ('navigation' in window) {
        try {
            window.navigation.addEventListener('navigate', (e) => {
                log('navigate', {
                    navType: e.navigationType,
                    canInt: e.canIntercept,
                    userInit: e.userInitiated,
                });
            });
            log('nav-api', { available: true });
        } catch (err) {
            log('nav-api-err', { msg: String(err).slice(0, 40) });
        }
    } else {
        log('nav-api', { available: false });
    }
}

// ─── API publique ────────────────────────────────────────────────────────────

/**
 * À appeler depuis initMobileMode(). Si le mode debug est actif (admin ou
 * ?debug-back=1), installe l'overlay et attache les listeners.
 */
export function initBackButtonDebug() {
    // Toujours attacher les listeners : s'ils firent avant qu'admin soit actif,
    // on veut quand même les capturer (ils seront affichés dès que le panneau
    // est créé).
    attachListeners();

    if (isDebugEnabled()) {
        createPanel();
        log('init', {
            url: location.href.slice(-50),
            mobile: window.innerWidth <= 768,
            admin: state.isAdmin,
            standalone: window.matchMedia('(display-mode: standalone)').matches,
        });
        render();
    }

    // Réagir au passage en mode admin (login à chaud)
    eventBus.on('admin:mode-toggled', (isAdmin) => {
        if (isAdmin && !_panel) {
            createPanel();
            log('admin-enabled');
            render();
        }
    });
}
