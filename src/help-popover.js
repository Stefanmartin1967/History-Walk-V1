// help-popover.js
// ============================================================================
// Patron d'aide contextuelle « ? » — réutilisable dans toute l'app HW.
//
// Deux granularités, un seul modèle de contenu :
//   1. INLINE  — un petit « ? » discret posé à côté d'un concept précis. Clic →
//                mini-popover ciblé ancré sous le déclencheur.
//   2. PANNEAU — un « ? » d'en-tête de vue. Clic → panneau d'aide structuré qui
//                glisse depuis la droite (drawer), par-dessus la modale.
//
// Pourquoi un drawer et pas une sous-modale openHwModal ?
//   → Le drawer est un simple overlay `position: fixed`, il NE passe PAS par
//     openHwModal. Il ne déclenche donc pas la garde anti-empilement (« stacking
//     interdit ») qui détruirait la modale d'import. Aucun suspendHwModal/
//     resumeHwModal nécessaire : le bug de fermeture de la parente est évité par
//     construction. (cf. note ZIP dans le brief.)
//
// Accessibilité : role="dialog", aria-labelledby, focus déplacé à l'ouverture
// et rendu au déclencheur à la fermeture, trap de focus dans le drawer, Échap +
// clic-dehors pour fermer. Un seul popover ouvert à la fois (singleton).
//
// Modèle de contenu (objet « point d'aide ») — c'est l'API à déclarer ailleurs :
//   { title: string, html: string | HTMLElement }                      (inline)
//   { title, intro?, schema?: string[], sections?: [{heading, html}],   (panneau)
//     html?, footnote? }
//
// Intégration icônes (production) — une fois au démarrage de l'app :
//   import { createIcons, appIcons } from './lucide-icons.js';
//   import { configureHelp } from './help-popover.js';
//   configureHelp({ renderIcons: (root) => createIcons({ icons: appIcons, root }) });
// L'icône « ? » utilise `circle-help` (CircleHelp), DÉJÀ présent dans appIcons —
// rien à ajouter à lucide-icons.js.
// ============================================================================

/* --------------------------------------------------------------------------
   Configuration / intégration hôte
   -------------------------------------------------------------------------- */
let _renderIcons = null;   // (root: HTMLElement) => void
let _variant = 'sobre';    // 'sobre' | 'accentue' | 'compact' (cf. help.css)

export function configureHelp({ renderIcons, variant } = {}) {
    if (typeof renderIcons === 'function') _renderIcons = renderIcons;
    if (variant) _variant = variant;
}

// Variante visuelle globale du patron (densité / ton). Reflétée par un attribut
// data-help-variant sur la racine de chaque surface d'aide → ciblé par help.css.
/** @public — API du patron d'aide réutilisable (variantes sobre/accentué/compact). */
export function setHelpVariant(variant) {
    _variant = variant || 'sobre';
    document.querySelectorAll('.help-pop, .help-drawer').forEach(el => {
        el.dataset.helpVariant = _variant;
    });
}

function renderIconsIn(root) {
    if (_renderIcons) { try { _renderIcons(root); return; } catch (_) { /* noop */ } }
    // Sans intégration : on laisse les <i data-lucide> tels quels (l'hôte peut
    // lancer une passe globale). Le composant reste fonctionnel.
}

const ICON_HELP = '<i data-lucide="circle-help"></i>';
const ICON_X = '<i data-lucide="x"></i>';

/* --------------------------------------------------------------------------
   Singleton : un seul popover/drawer ouvert à la fois
   -------------------------------------------------------------------------- */
let _open = null;  // { el, trigger, kind, cleanup, onClose }

function closeOpen(returnFocus = true) {
    if (!_open) return;
    const { el, trigger, cleanup, onClose } = _open;
    cleanup && cleanup();
    el.classList.add('help-closing');
    const node = el;
    setTimeout(() => { node.remove(); }, 220);
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    if (returnFocus && trigger && typeof trigger.focus === 'function') {
        try { trigger.focus({ preventScroll: true }); } catch (_) { trigger.focus(); }
    }
    _open = null;
    // Hook de fermeture (ex. onboarding : lancer une action APRÈS lecture du guide).
    // Appelé après _open=null pour éviter toute réentrance.
    if (typeof onClose === 'function') { try { onClose(); } catch (_) { /* noop */ } }
}

export function closeHelp() { closeOpen(false); }

/* --------------------------------------------------------------------------
   Rendu du contenu (partagé inline ↔ panneau)
   -------------------------------------------------------------------------- */
function appendBody(container, opts) {
    if (opts.html != null) {
        if (opts.html instanceof HTMLElement) container.appendChild(opts.html);
        else container.insertAdjacentHTML('beforeend', String(opts.html));
        return;
    }
    if (opts.intro) {
        const p = document.createElement('p');
        p.className = 'help-lead';
        p.innerHTML = opts.intro;
        container.appendChild(p);
    }
    if (Array.isArray(opts.schema) && opts.schema.length) {
        const flow = document.createElement('div');
        flow.className = 'help-flow';
        opts.schema.forEach((step, i) => {
            if (i > 0) {
                const arr = document.createElement('span');
                arr.className = 'help-flow-arrow';
                arr.setAttribute('aria-hidden', 'true');
                arr.textContent = '→';
                flow.appendChild(arr);
            }
            const chip = document.createElement('span');
            chip.className = 'help-flow-step';
            chip.innerHTML = step;
            flow.appendChild(chip);
        });
        container.appendChild(flow);
    }
    if (Array.isArray(opts.sections)) {
        opts.sections.forEach(sec => {
            const s = document.createElement('section');
            s.className = 'help-section';
            if (sec.tone) s.dataset.tone = sec.tone;
            if (sec.heading) {
                const h = document.createElement('h3');
                h.className = 'help-section-title';
                h.innerHTML = sec.heading;
                s.appendChild(h);
            }
            const b = document.createElement('div');
            b.className = 'help-section-body';
            b.innerHTML = sec.html || '';
            s.appendChild(b);
            container.appendChild(s);
        });
    }
    if (opts.footnote) {
        const fn = document.createElement('p');
        fn.className = 'help-footnote';
        fn.innerHTML = opts.footnote;
        container.appendChild(fn);
    }
}

/* --------------------------------------------------------------------------
   Focus trap (drawer) + utilitaires
   -------------------------------------------------------------------------- */
const FOCUSABLE = 'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])';

function trapFocus(container, e) {
    const items = [...container.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

let _uid = 0;
const nextId = (p) => `${p}-${++_uid}`;

/* --------------------------------------------------------------------------
   1. MINI-POPOVER INLINE
   -------------------------------------------------------------------------- */
function openInlinePopover(trigger, opts) {
    // Toggle : re-clic sur le même déclencheur ferme.
    if (_open && _open.trigger === trigger) { closeOpen(); return; }
    closeOpen(false);

    const titleId = nextId('help-title');
    const pop = document.createElement('div');
    pop.className = 'help-pop';
    pop.dataset.helpVariant = _variant;
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-labelledby', titleId);

    const head = document.createElement('div');
    head.className = 'help-pop-head';
    head.innerHTML = `<span class="help-pop-title" id="${titleId}">${opts.title || 'Aide'}</span>
        <button type="button" class="help-pop-close" aria-label="Fermer l'aide">${ICON_X}</button>`;
    pop.appendChild(head);

    const body = document.createElement('div');
    body.className = 'help-pop-body';
    appendBody(body, opts);
    pop.appendChild(body);

    const arrow = document.createElement('span');
    arrow.className = 'help-pop-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    pop.appendChild(arrow);

    document.body.appendChild(pop);
    renderIconsIn(pop);
    positionPopover(pop, trigger, arrow);

    trigger.setAttribute('aria-expanded', 'true');

    const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeOpen(); }
    };
    const onDocClick = (e) => {
        if (pop.contains(e.target) || trigger.contains(e.target)) return;
        closeOpen(false);
    };
    const onReposition = () => positionPopover(pop, trigger, arrow);
    pop.querySelector('.help-pop-close').addEventListener('click', () => closeOpen());

    // Différé : ne pas capturer le clic d'ouverture.
    setTimeout(() => {
        document.addEventListener('keydown', onKey, true);
        document.addEventListener('mousedown', onDocClick, true);
        window.addEventListener('resize', onReposition);
        window.addEventListener('scroll', onReposition, true);
        const closeBtn = pop.querySelector('.help-pop-close');
        if (closeBtn) try { closeBtn.focus({ preventScroll: true }); } catch (_) { closeBtn.focus(); }
    }, 0);

    // L'état ouvert est le défaut CSS : le popover est visible dès l'insertion
    // et s'anime via @keyframes (aucun toggle différé — fiable hors rAF/timers).

    _open = {
        el: pop, trigger, kind: 'inline',
        cleanup: () => {
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('mousedown', onDocClick, true);
            window.removeEventListener('resize', onReposition);
            window.removeEventListener('scroll', onReposition, true);
        },
    };
}

function positionPopover(pop, trigger, arrow) {
    const r = trigger.getBoundingClientRect();
    const W = pop.offsetWidth || 300;
    const H = pop.offsetHeight || 160;
    const M = 10; // marge viewport
    const GAP = 10; // espace déclencheur ↔ popover

    // Vertical : sous le déclencheur ; au-dessus si pas de place.
    let below = true;
    let top = r.bottom + GAP;
    if (top + H > window.innerHeight - M && r.top - GAP - H > M) {
        below = false;
        top = r.top - GAP - H;
    }
    // Horizontal : centré sur le déclencheur, clampé au viewport.
    const cx = r.left + r.width / 2;
    let left = cx - W / 2;
    if (left < M) left = M;
    if (left + W > window.innerWidth - M) left = window.innerWidth - M - W;

    pop.style.top = `${Math.max(M, top)}px`;
    pop.style.left = `${left}px`;
    pop.classList.toggle('is-above', !below);

    // Flèche : alignée sur le centre du déclencheur.
    const arrowX = Math.min(Math.max(cx - left, 16), W - 16);
    arrow.style.left = `${arrowX}px`;
}

/**
 * Câble un comportement d'aide inline sur un élément déclencheur EXISTANT
 * (ex. rendre le « ? » que vous avez déjà dans le DOM cliquable).
 * @param {HTMLElement} trigger
 * @param {{title:string, html?:string|HTMLElement, intro?, sections?, schema?, footnote?}} opts
 * @returns {() => void} fonction de détachement
 */
export function attachHelp(trigger, opts) {
    if (!trigger) return () => {};
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
    if (!trigger.getAttribute('aria-label') && opts.title) {
        trigger.setAttribute('aria-label', `Aide : ${opts.title}`);
    }
    const handler = (e) => { e.preventDefault(); e.stopPropagation(); openInlinePopover(trigger, opts); };
    trigger.addEventListener('click', handler);
    return () => trigger.removeEventListener('click', handler);
}

/**
 * Crée un petit bouton « ? » inline prêt à insérer à côté d'un concept.
 * @param {object} opts - point d'aide ({title, html|sections|…})
 * @param {object} [cfg] - { size:'sm'|'md', label }
 * @returns {HTMLButtonElement}
 */
export function helpInline(opts, cfg = {}) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'help-dot' + (cfg.size === 'sm' ? ' help-dot--sm' : '');
    btn.innerHTML = ICON_HELP;
    btn.setAttribute('aria-label', cfg.label || (opts.title ? `Aide : ${opts.title}` : 'Aide'));
    attachHelp(btn, opts);
    renderIconsIn(btn);
    return btn;
}

/* --------------------------------------------------------------------------
   2. PANNEAU D'AIDE (DRAWER droite)
   -------------------------------------------------------------------------- */
/**
 * Ouvre le panneau d'aide structuré (drawer). Réutilisable pour n'importe
 * quelle vue : passez un objet « guide » { title, intro, schema, sections }.
 * @param {object} opts
 * @returns {{close: () => void}}
 */
export function openHelpPanel(opts, trigger = null) {
    closeOpen(false);

    const titleId = nextId('help-drawer-title');
    const scrim = document.createElement('div');
    scrim.className = 'help-drawer-scrim';

    const drawer = document.createElement('aside');
    drawer.className = 'help-drawer';
    drawer.dataset.helpVariant = _variant;
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.setAttribute('aria-labelledby', titleId);

    const head = document.createElement('header');
    head.className = 'help-drawer-head';
    head.innerHTML = `
        <span class="help-drawer-eyebrow">${ICON_HELP}<span>Aide</span></span>
        <h2 class="help-drawer-title" id="${titleId}">${opts.title || 'Aide'}</h2>
        <button type="button" class="help-drawer-close" aria-label="Fermer l'aide">${ICON_X}</button>`;
    drawer.appendChild(head);

    const body = document.createElement('div');
    body.className = 'help-drawer-body';
    appendBody(body, opts);
    drawer.appendChild(body);

    document.body.appendChild(scrim);
    document.body.appendChild(drawer);
    renderIconsIn(drawer);

    if (trigger) trigger.setAttribute('aria-expanded', 'true');

    const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeOpen(); }
        else if (e.key === 'Tab') { trapFocus(drawer, e); }
    };
    head.querySelector('.help-drawer-close').addEventListener('click', () => closeOpen());
    scrim.addEventListener('click', () => closeOpen());

    setTimeout(() => {
        document.addEventListener('keydown', onKey, true);
        const c = head.querySelector('.help-drawer-close');
        if (c) try { c.focus({ preventScroll: true }); } catch (_) { c.focus(); }
    }, 0);

    // Visible dès l'insertion ; entrée animée par @keyframes (cf. inline).

    _open = {
        el: drawer, trigger, kind: 'drawer',
        onClose: typeof opts.onClose === 'function' ? opts.onClose : null,
        cleanup: () => {
            document.removeEventListener('keydown', onKey, true);
            scrim.classList.add('help-closing');
            setTimeout(() => scrim.remove(), 220);
        },
    };
    return { close: () => closeOpen() };
}

/**
 * Crée le bouton « ? » global d'en-tête de vue, prêt à insérer dans un header.
 * @param {object} opts - le guide ({title, intro, schema, sections, …})
 * @param {object} [cfg] - { label, withText:boolean }
 * @returns {HTMLButtonElement}
 */
export function helpButton(opts, cfg = {}) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'help-trigger' + (cfg.withText ? ' help-trigger--text' : '');
    btn.innerHTML = cfg.withText
        ? `${ICON_HELP}<span>${cfg.label || 'Guide'}</span>`
        : ICON_HELP;
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', cfg.label || (opts.title ? `Aide : ${opts.title}` : 'Aide de la vue'));
    if (!cfg.withText && (cfg.label || opts.title)) btn.title = cfg.label || `Aide : ${opts.title}`;
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        if (_open && _open.trigger === btn && _open.kind === 'drawer') { closeOpen(); return; }
        openHelpPanel(opts, btn);
    });
    renderIconsIn(btn);
    return btn;
}
