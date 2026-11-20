// google-account.js — Relier Heripia au compte Google du user (synchro users, PR 5).
// Maquette écrans 28-34 validée par Stefan le 20/11/2026.
//
// Accès demandé : `drive.appdata`, l'espace de Google Drive réservé à Heripia
// (dossier caché appDataFolder), classé « non sensible » par Google. Projet
// Google Cloud « Heripia », en production sans validation depuis le 20/11/2026.
// ⚠ Ne pas ajouter de logo au projet Google : cela déclencherait la validation.
//
// Sans serveur (essai réel du 19/11, page d'essai retirée depuis) :
//  - la bibliothèque Google (GIS) donne un accès d'une heure, gardé EN MÉMOIRE
//    seulement (jamais écrit : cf. Règles de confidentialité) ;
//  - la fenêtre Google ne s'ouvre que dans un geste du user (clic) : jamais de
//    demande d'accès automatique au démarrage ;
//  - l'adresse du compte est retenue sur l'appareil (localStorage, une seule
//    pour toutes les destinations) : affichée, et passée à Google en
//    `login_hint` pour qu'il ne redemande pas « Sélectionnez un compte »
//    (souci vu à l'essai sur un PC à plusieurs comptes).
//
// Déconnecter = cet appareil oublie l'adresse et l'accès. On ne RÉVOQUE PAS
// l'accord chez Google : il vaut pour le compte entier, et le révoquer
// obligerait les autres appareils reliés à redonner leur accord.
// Effacer = supprimer tous les fichiers de Heripia dans l'espace, puis révoquer
// l'accord (les deux temps que Google demande dans ses propres réglages).

// Identifiant du client OAuth « Application Web » : public par nature.
const CLIENT_ID = '618075568540-dbd6ein7nsbmgu3ieadcf9jjmgmcdke4.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const API = 'https://www.googleapis.com';
const DRIVE = '/drive/v3';
const UPLOAD = '/upload/drive/v3';
export const ACCOUNT_KEY = 'hw_google_account';

/**
 * Échec d'une demande à Google. `kind` choisit le texte montré au user :
 * 'closed' (fenêtre fermée), 'denied' (accord refusé), 'blocked' (fenêtre
 * bloquée par le navigateur), 'offline' (pas d'Internet), 'error' (autre).
 */
export class GoogleLinkError extends Error {
    constructor(kind, detail = '') {
        super(`${kind}${detail ? ` : ${detail}` : ''}`);
        this.kind = kind;
    }
}

// ─── Compte retenu sur l'appareil ───────────────────────────────────────────

/** @returns {{email: string, linkedAt: string} | null} */
export function getLinkedAccount() {
    try {
        const raw = localStorage.getItem(ACCOUNT_KEY);
        const acc = raw ? JSON.parse(raw) : null;
        return acc && typeof acc.email === 'string' && acc.email ? acc : null;
    } catch {
        return null;
    }
}

function rememberAccount(email) {
    try {
        localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ email, linkedAt: new Date().toISOString() }));
    } catch { /* stockage indisponible : la liaison vaudra pour la session */ }
}

function forgetAccount() {
    try { localStorage.removeItem(ACCOUNT_KEY); } catch { /* rien */ }
}

// ─── Bibliothèque Google (chargée à l'ouverture de l'écran Sauvegarder) ─────

let gisPromise = null;
let tokenClient = null;
let pending = null;     // { resolve, reject } de la demande en cours
let token = null;       // { value, expiresAt } — mémoire seulement

function gisLoaded() {
    return !!globalThis.google?.accounts?.oauth2;
}

/**
 * Charge la bibliothèque Google une seule fois. Appelée à l'OUVERTURE de
 * l'écran Sauvegarder, pour qu'elle soit prête au clic : la fenêtre Google
 * doit s'ouvrir dans le geste du user, sans attendre un chargement.
 */
export function preloadGoogle() {
    if (gisLoaded()) return Promise.resolve(true);
    if (gisPromise) return gisPromise;
    gisPromise = new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = GIS_SRC;
        s.async = true;
        s.onload = () => resolve(gisLoaded());
        s.onerror = () => { gisPromise = null; s.remove(); resolve(false); };
        document.head.appendChild(s);
    });
    return gisPromise;
}

function settle(fn) {
    const p = pending;
    pending = null;
    if (p) fn(p);
}

function getClient() {
    if (tokenClient) return tokenClient;
    tokenClient = globalThis.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPE,
        callback: (resp) => {
            if (resp?.error) {
                const kind = resp.error === 'access_denied' ? 'denied' : 'error';
                settle(p => p.reject(new GoogleLinkError(kind, resp.error)));
                return;
            }
            const oauth2 = globalThis.google.accounts.oauth2;
            if (typeof oauth2.hasGrantedAllScopes === 'function' && !oauth2.hasGrantedAllScopes(resp, SCOPE)) {
                settle(p => p.reject(new GoogleLinkError('denied', 'scope')));
                return;
            }
            const secs = Number(resp.expires_in) || 3600;
            token = { value: resp.access_token, expiresAt: Date.now() + secs * 1000 };
            settle(p => p.resolve(token.value));
        },
        error_callback: (err) => {
            const type = err?.type || '';
            const kind = type === 'popup_failed_to_open' ? 'blocked'
                : type === 'popup_closed' ? 'closed'
                : 'error';
            settle(p => p.reject(new GoogleLinkError(kind, type)));
        },
    });
    return tokenClient;
}

function hasValidToken() {
    return !!token && Date.now() < token.expiresAt - 60000;
}

/**
 * Obtient un accès. ⚠ À appeler DIRECTEMENT dans un clic : la demande à
 * Google part sans aucune attente avant elle (sinon la fenêtre est bloquée).
 */
function requestAccess({ hint } = {}) {
    if (hasValidToken()) return Promise.resolve(token.value);
    if (globalThis.navigator?.onLine === false) return Promise.reject(new GoogleLinkError('offline'));
    if (!gisLoaded()) return Promise.reject(new GoogleLinkError('offline', 'bibliothèque Google absente'));
    // Une demande déjà en cours (deux clics proches : premier toucher et bouton)
    // est partagée : une seule fenêtre Google.
    if (pending) return pending.promise;
    let resolveFn, rejectFn;
    const promise = new Promise((resolve, reject) => { resolveFn = resolve; rejectFn = reject; });
    pending = { resolve: resolveFn, reject: rejectFn, promise };
    try {
        getClient().requestAccessToken(hint ? { login_hint: hint } : {});
    } catch (e) {
        settle(p => p.reject(new GoogleLinkError('error', e?.message)));
    }
    return promise;
}

// ─── Espace Heripia dans Google Drive ───────────────────────────────────────

async function drive(path, opts = {}) {
    let res;
    try {
        res = await fetch(`${API}${path}`, {
            ...opts,
            headers: { ...(opts.headers || {}), Authorization: `Bearer ${token.value}` },
        });
    } catch (e) {
        throw new GoogleLinkError('offline', e?.message);
    }
    if (res.status === 401) token = null;
    if (!res.ok && !(opts.method === 'DELETE' && res.status === 404)) {
        throw new GoogleLinkError('error', `HTTP ${res.status}`);
    }
    return res;
}

async function listAppFiles() {
    const ids = [];
    let pageToken = '';
    do {
        const q = `spaces=appDataFolder&fields=nextPageToken,files(id)&pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
        const data = await (await drive(`${DRIVE}/files?${q}`)).json();
        for (const f of data.files || []) ids.push(f.id);
        pageToken = data.nextPageToken || '';
    } while (pageToken);
    return ids;
}

// ─── Fichiers de la synchronisation (google-sync.js) ───────────────────────

/** Un accès valable est-il en mémoire (pas besoin de la fenêtre Google) ? */
export function hasGoogleAccess() {
    return hasValidToken();
}

/**
 * Renouvelle l'accès du compte relié. ⚠ Dans un geste du user seulement (la
 * fenêtre Google s'ouvre un instant et se referme seule).
 */
export function renewGoogleAccess() {
    return requestAccess({ hint: getLinkedAccount()?.email });
}

/** Fichiers de l'espace Heripia : { nom: id }. */
export async function listAppFileIds() {
    const out = {};
    let pageToken = '';
    do {
        const q = `spaces=appDataFolder&fields=nextPageToken,files(id,name)&pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
        const data = await (await drive(`${DRIVE}/files?${q}`)).json();
        for (const f of data.files || []) if (f?.name && !(f.name in out)) out[f.name] = f.id;
        pageToken = data.nextPageToken || '';
    } while (pageToken);
    return out;
}

/** Contenu JSON d'un fichier de l'espace Heripia. */
export async function readAppFile(id) {
    return (await drive(`${DRIVE}/files/${encodeURIComponent(id)}?alt=media`)).json();
}

/**
 * Écrit un fichier JSON dans l'espace Heripia : le remplace si `id` est donné,
 * sinon le crée. @returns {Promise<string>} son id
 */
export async function writeAppFile(id, name, data) {
    const body = JSON.stringify(data);
    if (id) {
        await drive(`${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body,
        });
        return id;
    }
    const boundary = `heripia${Math.random().toString(36).slice(2)}`;
    const meta = JSON.stringify({ name, parents: ['appDataFolder'] });
    const multipart = `--${boundary}

Content-Type: application/json; charset=UTF-8



${meta}

--${boundary}

Content-Type: application/json



${body}

--${boundary}--`;
    const res = await drive(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
        method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart,
    });
    return (await res.json()).id;
}

// ─── Actions de l'écran Sauvegarder ─────────────────────────────────────────

/**
 * « Relier à mon compte Google ». Ouvre la fenêtre Google (choix du compte,
 * puis accord), lit l'adresse du compte et la retient sur l'appareil.
 * @returns {Promise<{email: string, linkedAt: string}>}
 */
export async function linkGoogleAccount() {
    await requestAccess();
    const about = await (await drive(`${DRIVE}/about?fields=user(emailAddress)`)).json();
    const email = about?.user?.emailAddress;
    if (!email) throw new GoogleLinkError('error', 'adresse absente');
    rememberAccount(email);
    return getLinkedAccount() || { email, linkedAt: new Date().toISOString() };
}

/** « Déconnecter » : cet appareil oublie l'adresse et l'accès. Rien n'est effacé. */
export function disconnectGoogleAccount() {
    token = null;
    forgetAccount();
}

/**
 * « Effacer mes données Heripia de mon compte Google » : supprime tout ce que
 * Heripia a enregistré dans son espace, puis retire son accès au compte.
 * @returns {Promise<number>} nombre de fichiers supprimés
 */
export async function eraseGoogleData() {
    const hint = getLinkedAccount()?.email;
    await requestAccess({ hint });
    const ids = await listAppFiles();
    for (const id of ids) {
        await drive(`${DRIVE}/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
    }
    const value = token?.value;
    await new Promise((resolve) => {
        try {
            globalThis.google.accounts.oauth2.revoke(value, () => resolve());
        } catch {
            resolve(); // l'effacement est fait ; l'accès expirera de lui-même
        }
    });
    token = null;
    forgetAccount();
    return ids.length;
}

/** Tests seulement : remet le module à zéro. */
export function _resetGoogleAccountForTests() {
    gisPromise = null;
    tokenClient = null;
    pending = null;
    token = null;
}
