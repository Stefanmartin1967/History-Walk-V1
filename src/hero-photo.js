// hero-photo.js
// ─── Photo d'en-tête (hero) : pose + photo portrait affichée entière ─────────
// Commun aux trois heros photo : fiche POI (#poi-hero), cover du panneau
// Circuit PC (#circuit-cover) et hero de l'onglet Circuit mobile (.cc-hero).
//
// Le hero est un bandeau ~2:1 rempli « en cover » : une photo PORTRAIT (église,
// monument élancé) n'y montrait qu'une tranche horizontale. Constat de Stefan
// le 07/11/2026 sur le Monument aux héros coloniaux de Vezin. Désormais, une
// photo plus haute que large est affichée ENTIÈRE, centrée, sur un fond fait de
// la même photo floutée et assombrie (pas de bandes vides, qui ressemblent à une
// erreur). Automatique, aucun réglage enregistré. Les photos paysage gardent le
// cadrage actuel (cover centré).
//
// Mécanique : le background du hero reste la photo en cover (inchangé). Pour un
// portrait, on ajoute en premier enfant un calque .hero-portrait dont le
// backdrop-filter floute ce fond, et dont le propre background pose la photo
// « contain » par-dessus. Les puces (compteur, photo de travail) ont z-index 2 et
// restent au-dessus. Sans backdrop-filter, le repli est un fond net : acceptable.
//
// CSP : backgroundImage posé via CSSOM (el.style.x), jamais d'attribut style="".
// URL en inline-style (et non via var() depuis la feuille bundlée) : résolue
// contre le document, cf. PR #554.

// Dernière URL demandée par hero : une sonde de ratio arrivée en retard (autre
// photo posée entre-temps, autre fiche ouverte) ne doit rien appliquer.
const pendingByHero = new WeakMap();

/**
 * Pose la photo d'un hero (gradient de lisibilité + photo en cover), puis,
 * de façon asynchrone, l'affiche entière si elle est en portrait.
 *
 * @param {HTMLElement} hero
 * @param {string} url       URL publiée, relative, ou objectURL (blob)
 * @param {object} opts
 * @param {string} opts.gradient  linear-gradient(...) posé au-dessus de la photo
 * @param {string} [opts.cssVar]  variable CSS à renseigner (lisibilité/debug)
 */
export function setHeroPhoto(hero, url, { gradient, cssVar } = {}) {
    if (!hero || !url) return;
    const safe = String(url).replace(/['"\\]/g, encodeURIComponent);
    if (cssVar) hero.style.setProperty(cssVar, `url("${safe}")`);
    hero.style.backgroundImage = `${gradient}, url("${safe}")`;

    hero.querySelector(':scope > .hero-portrait')?.remove();
    pendingByHero.set(hero, safe);

    // Sonde de ratio : même URL que le background, servie par le cache du
    // navigateur. naturalWidth/Height tiennent compte de l'orientation EXIF.
    const probe = new Image();
    probe.onload = () => {
        if (pendingByHero.get(hero) !== safe || !hero.isConnected) return;
        if (!isPortrait(probe.naturalWidth, probe.naturalHeight)) return;
        hero.querySelector(':scope > .hero-portrait')?.remove();
        const layer = document.createElement('span');
        layer.className = 'hero-portrait';
        layer.setAttribute('aria-hidden', 'true');
        layer.style.backgroundImage = `${gradient}, url("${safe}")`;
        hero.prepend(layer);
    };
    probe.src = url;
}

/** Plus haute que large (un carré reste en cover). Exportée pour les tests. */
export function isPortrait(width, height) {
    return width > 0 && height > width;
}
