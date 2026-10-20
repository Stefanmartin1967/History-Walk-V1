// dock-diag.js — MESURE PROVISOIRE (v3.7.448, 20/10/2026). À retirer avec le
// correctif du dock, dans la PR qui suivra les relevés.
//
// Bug : sur le téléphone de Stefan (Samsung S25, One UI 9, barre Android à trois
// boutons, Heripia installée depuis Chrome), le dock du bas disparaît au
// démarrage qui suit une mise à jour. Pas reproductible sur PC : après une vraie
// mise à jour du service worker en vue mobile, le dock y reste affiché. Relevé de
// mai (#571) : le dock était là, mais 56 px trop bas, derrière la barre Android.
// La fenêtre était donc mesurée trop haute.
//
// Relevé du 20/10 (v3.7.448, démarrage après mise à jour) : fenêtre 750, dock
// 744→805. Le conteneur gardait un 100dvh converti quand la fenêtre faisait
// 805 ; corrigé en v3.7.449 (hauteur en %, cf. base.css). Mesure gardée un tour
// de plus pour le constater sur le téléphone, avec la hauteur de la page (html,
// sur laquelle s'appuie le pourcentage).
//
// À chaque démarrage mobile, on note ce qui décide de la place du dock, puis
// chaque changement de hauteur pendant la session (rotation comprise). Les trois
// derniers démarrages s'affichent en bas du Menu : on les lit à l'ouverture
// suivante, même si le dock manquait pendant la session mesurée.

const STORAGE_KEY = 'hw_dock_diag';
const MAX_BOOTS = 3;
const MAX_CHANGES = 6;
const FIRST_MEASURE_MS = 3000;
const RESIZE_SETTLE_MS = 400;

const NAV_LABELS = { navigate: 'ouverture', reload: 'rechargement', back_forward: 'retour' };

function readBoots() {
    try {
        const boots = JSON.parse(localStorage.getItem(STORAGE_KEY));
        return Array.isArray(boots) ? boots : [];
    } catch {
        return [];
    }
}

function saveBoots(boots) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(boots));
    } catch { /* stockage plein ou refusé : la mesure est facultative */ }
}

// Hauteur d'une unité CSS de fenêtre (100svh…), lue sur un élément témoin.
// Styles posés en CSSOM : autorisés par la CSP, contrairement à style="…".
function probeHeight(probe, value) {
    probe.style.height = value;
    return Math.round(probe.getBoundingClientRect().height);
}

/** Relevé instantané : hauteurs de fenêtre, marge du bas, position du dock. */
export function measureLayout() {
    const probe = document.createElement('div');
    Object.assign(probe.style, { position: 'fixed', top: '0', left: '0', width: '0', visibility: 'hidden', pointerEvents: 'none' });
    document.body.appendChild(probe);
    const svh = probeHeight(probe, '100svh');
    const dvh = probeHeight(probe, '100dvh');
    const lvh = probeHeight(probe, '100lvh');
    probe.style.height = '0';
    probe.style.paddingBottom = 'env(safe-area-inset-bottom, 0px)';
    const marge = Math.round(parseFloat(getComputedStyle(probe).paddingBottom) || 0);
    probe.remove();

    const dock = document.getElementById('mobile-dock');
    let dockPos = 'absent';
    if (dock) {
        const r = dock.getBoundingClientRect();
        dockPos = getComputedStyle(dock).display === 'none'
            ? 'masqué'
            : `${Math.round(r.top)}→${Math.round(r.bottom)}`;
    }
    return {
        fenetre: window.innerHeight,
        page: document.documentElement.clientHeight,
        ecran: window.screen?.height ?? null,
        dispo: window.screen?.availHeight ?? null,
        svh, dvh, lvh, marge,
        dock: dockPos,
    };
}

function navigationType() {
    try {
        return performance.getEntriesByType('navigation')[0]?.type || '?';
    } catch {
        return '?';
    }
}

/**
 * Démarre la mesure pour ce démarrage mobile : premier relevé après 3 s, puis
 * un relevé à chaque changement de taille de fenêtre (6 au plus). Renvoie la
 * fonction qui l'arrête.
 */
export function startDockDiag(version) {
    const start = Date.now();
    const boot = {
        at: new Date(start).toISOString(),
        version,
        nav: navigationType(),
        appli: !!window.matchMedia?.('(display-mode: standalone)').matches,
        mesure: null,
        changements: [],
    };
    const boots = [...readBoots(), boot].slice(-MAX_BOOTS);
    saveBoots(boots);

    const first = setTimeout(() => {
        boot.mesure = measureLayout();
        saveBoots(boots);
    }, FIRST_MEASURE_MS);

    let settle;
    const onResize = () => {
        clearTimeout(settle);
        settle = setTimeout(() => {
            if (boot.changements.length >= MAX_CHANGES) return;
            const m = measureLayout();
            boot.changements.push({ s: Math.round((Date.now() - start) / 1000), fenetre: m.fenetre, dock: m.dock });
            saveBoots(boots);
        }, RESIZE_SETTLE_MS);
    };
    window.addEventListener('resize', onResize);

    return () => {
        clearTimeout(first);
        clearTimeout(settle);
        window.removeEventListener('resize', onResize);
    };
}

const pad = (n) => String(n).padStart(2, '0');

/** Lignes d'un démarrage, pour le bas du Menu. */
export function formatBoot(boot) {
    const d = new Date(boot.at);
    const lines = [
        `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())} · v${boot.version} · ${NAV_LABELS[boot.nav] || boot.nav} · ${boot.appli ? 'appli' : 'onglet'}`,
    ];
    const m = boot.mesure;
    if (m) {
        lines.push(`fenêtre ${m.fenetre} · page ${m.page ?? '?'} (écran ${m.ecran}, dispo ${m.dispo}) · svh ${m.svh} dvh ${m.dvh} lvh ${m.lvh} · marge bas ${m.marge}`);
        lines.push(`dock ${m.dock}`);
    } else {
        lines.push('pas encore mesuré');
    }
    for (const c of boot.changements || []) {
        lines.push(`après ${c.s} s : fenêtre ${c.fenetre}, dock ${c.dock}`);
    }
    return lines;
}

/** Démarrages mesurés, du plus récent au plus ancien, déjà mis en lignes. */
export function getDockDiagBlocks() {
    return readBoots().slice().reverse().map(formatBoot);
}
