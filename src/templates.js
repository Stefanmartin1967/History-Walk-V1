// templates.js
import { getPatrimonialName } from './data.js';
import { getCurrentPatrimonialLang } from './patrimonial-names.js';
import { escapeXml, getDerivedZone } from './utils.js';
import { state } from './state.js';
import { isMobileView } from './mobile-state.js';
import { getAccessPointStatus } from './access-point.js';

// Devise de la destination active. Seul consommateur : buildDetailsPanelHtml ci-dessous.
function getCurrentCurrency() {
    if (!state.currentMapId || !state.destinations || !state.destinations.maps[state.currentMapId]) {
        return '';
    }
    return state.destinations.maps[state.currentMapId].currency || '';
}

export const ICONS = {
    mosque: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20H4v-7a8 8 0 0 1 16 0z"/><path d="M12 5V2"/><circle cx="12" cy="8" r="2"/></svg>`,
    pen: `<i data-lucide="pencil" class="icon-sm"></i>`,
    check: `<i data-lucide="check" class="icon-sm"></i>`,
    chevronLeft: `<i data-lucide="chevron-left" class="icon-sm"></i>`,
    chevronRight: `<i data-lucide="chevron-right" class="icon-sm"></i>`,
    x: `<i data-lucide="x" class="icon-sm"></i>`,
    arrowLeft: `<i data-lucide="arrow-left" class="icon-md"></i>`,
    arrowLeftToLine: `<i data-lucide="arrow-left-to-line" class="icon-sm"></i>`,
    volume: `<i data-lucide="volume-2" class="icon-sm"></i>`,
    imagePlus: `<i data-lucide="image-plus" class="icon-sm"></i>`,
    locate: `<i data-lucide="locate-fixed" class="icon-sm"></i>`,
    clock: `<i data-lucide="clock" class="icon-sm"></i>`,
    minus: `<i data-lucide="minus" class="icon-sm"></i>`,
    plus: `<i data-lucide="plus" class="icon-sm"></i>`,
    ticket: `<i data-lucide="ticket" class="icon-sm"></i>`,
    upload: `<i data-lucide="upload" class="icon-sm"></i>`,
    download: `<i data-lucide="download" class="icon-sm"></i>`,
    play: `<i data-lucide="play" class="icon-sm"></i>`,
    trash: `<i data-lucide="trash-2" class="icon-sm"></i>`,
    googleMaps: `<i data-lucide="map-pin" class="icon-sm"></i>`,
    globe: `<i data-lucide="globe" class="icon-sm"></i>`,
    languages: `<i data-lucide="languages" class="icon-sm"></i>`,
    fileText: `<i data-lucide="file-text" class="icon-sm"></i>`,
    move: `<i data-lucide="move" class="icon-sm"></i>`
};

export function renderSource(allProps) {
    const sourceString = allProps.Source;
    if (!sourceString || typeof sourceString !== 'string' || sourceString.trim() === '') return '';
    const firstLine = sourceString.split('\n')[0].trim();
    try {
        const fullUrl = firstLine.startsWith('http') ? firstLine : `https://${firstLine}`;
        new URL(fullUrl);
        const domain = new URL(fullUrl).hostname.replace(/^www\./, '');
        return `<div class="poi-source-link">Source : <a href="${escapeXml(fullUrl)}" target="_blank" rel="noopener noreferrer">${escapeXml(domain)}</a></div>`;
    } catch (_) {
        return `<div class="poi-source-link">Source : <span>${escapeXml(firstLine)}</span></div>`;
    }
}

function formatTimeText(h, m) {
    if (!h && !m) return '';
    if (h === 0) return `${m} min`;
    if (m === 0) return `${h}h`;
    return `${h}h${String(m).padStart(2, '0')}`;
}

// Classe sémantique d'un état de lieu (pastille du hero). « Ruine » est
// volontairement neutre (muted), pas « danger » : dans une app de patrimoine,
// une ruine est un lieu à voir, pas un statut à éviter.
function stateTagClass(etat) {
    switch (etat) {
        case 'En activité':
        case 'Conservé':
        case 'Reconverti':
            return 'ok';
        case 'Vestiges partiels':
            return 'warn';
        default: // Désaffecté, Ruine
            return 'muted';
    }
}

// Classe sémantique + icône Lucide d'une valeur d'accès (pastille du hero).
function accessTagMeta(acces) {
    switch (acces) {
        case 'Intérieur visitable': return { cls: 'ok',     icon: 'door-open' };
        case 'Extérieur seulement': return { cls: 'muted',  icon: 'building' };
        case 'Non visitable':       return { cls: 'danger', icon: 'lock' };
        default:                    return { cls: 'muted',  icon: 'info' };
    }
}

function buildHero(opts) {
    const { photos, hasFullscreenClose } = opts;
    const photoCount = photos.length;
    const closeBtn = hasFullscreenClose
        ? `<button class="poi-back-pill" id="close-details-button" title="Fermer" aria-label="Fermer"><i data-lucide="x"></i></button>`
        : '';
    // v3 : le hero ne porte PLUS de statut (descendu dans le cartel, .cartel-status).
    // Il ne reste que la photo + le compteur (puce papier .cartel-chip), ou la
    // plaque « Ajouter une photo » à vide.
    const count = `<span class="cartel-hero-count"><span class="cartel-chip cartel-chip--muted"><i data-lucide="image"></i>${photoCount} ${photoCount > 1 ? 'photos' : 'photo'}</span></span>`;

    if (photoCount > 0) {
        // Le background-image est appliqué côté JS (CSSOM) pour rester CSP-safe
        return `
            <div class="poi-hero has-photo" id="poi-hero" data-bg-url="${escapeXml(photos[0])}">
                ${closeBtn}
                ${count}
            </div>`;
    }

    // Hero vide cliquable : plaque de papier gravé + invite à ajouter une photo
    // (clic branché par setupHeroClick).
    return `
        <div class="poi-hero is-empty is-clickable" id="poi-hero" role="button" tabindex="0" aria-label="Ajouter une photo">
            ${closeBtn}
            <div class="empty-plate">
                <div class="empty-icon"><i data-lucide="image-plus"></i></div>
                <span class="empty-label">Ajouter une photo</span>
            </div>
        </div>`;
}

// Mini-barre de raccourcis sous la fiche : Google · Maps · Éditer + kebab inline.
// Identique PC et mobile (cohérence "toolbar du bas").
function buildPoiQuickBar() {
    return `
        <div class="poi-quick-bar">
            <button class="poi-quick-btn btn-web-search" id="btn-web-search" type="button" title="Rechercher sur Google" aria-label="Rechercher sur Google">
                <i data-lucide="search"></i>Google
            </button>
            <button class="poi-quick-btn" id="open-gmaps-btn" type="button" title="Voir sur Google Maps" aria-label="Voir sur Google Maps">
                <i data-lucide="map-pin"></i>Maps
            </button>
            <button class="poi-quick-btn" id="open-osm-btn" type="button" title="Voir sur OpenStreetMap" aria-label="Voir sur OpenStreetMap">
                <i data-lucide="map"></i>OSM
            </button>
            <button class="poi-quick-btn" id="btn-global-edit" type="button" title="Modifier le lieu" aria-label="Modifier le lieu">
                <i data-lucide="pencil"></i>Éditer
            </button>
            <div class="poi-kebab-wrap in-mini-bar">
                <button class="poi-kebab" id="poi-tools-trigger" type="button"
                        aria-haspopup="menu" aria-expanded="false" aria-controls="poi-tools-pop"
                        title="Plus d'actions" aria-label="Plus d'actions">
                    <span class="dots"><i></i><i></i><i></i></span>
                </button>
            </div>
        </div>`;
}

// Popover du kebab — items secondaires : Arabe · Desc. GPX · Position · Supprimer.
// IDs identiques à l'ancien menu pour réutiliser tous les handlers existants.
function buildPoiKebabMenu({ hasGpxDesc, isMobile }) {
    const gpxId  = isMobile ? 'mobile-btn-toggle-gpx-desc' : 'btn-toggle-gpx-desc';
    const positionItem = isMobile
        ? `<button class="poi-pop-item" role="menuitem" id="mobile-move-poi-btn" type="button">
               <i data-lucide="locate-fixed"></i>Capturer ma position
           </button>`
        : `<button class="poi-pop-item" role="menuitem" id="btn-move-marker" type="button">
               <i data-lucide="move"></i>Déplacer le marqueur
           </button>`;

    // Admin : pose du « point d'accès au tracé » (drapeau pour les POI hors voie).
    // PC = pose carte de précision (drag/clic) ; mobile = pose à la position GPS
    // de l'admin sur le terrain (Option A, 19/06 — pas d'UI carte au doigt).
    const accessPointItem = !state.isAdmin ? ''
        : isMobile
        ? `<button class="poi-pop-item" role="menuitem" id="mobile-set-access-point-btn" type="button">
               <i data-lucide="flag"></i>Drapeau à ma position
           </button>`
        : `<button class="poi-pop-item" role="menuitem" id="btn-set-access-point" type="button">
               <i data-lucide="flag"></i>Point d'accès au tracé
           </button>`;

    return `
        <div class="poi-kebab-pop is-hidden" id="poi-tools-pop" role="menu" aria-label="Outils du lieu">
            <button class="poi-pop-item" role="menuitem" id="${gpxId}" type="button"
                    aria-disabled="${hasGpxDesc ? 'false' : 'true'}">
                <i data-lucide="file-text"></i>Info GPX
            </button>
            ${positionItem}
            ${accessPointItem}
            <div class="poi-pop-sep" role="separator"></div>
            <button class="poi-pop-item poi-pop-item--danger" role="menuitem" id="btn-soft-delete" type="button">
                <i data-lucide="trash-2"></i>Supprimer
            </button>
        </div>`;
}

export function buildDetailsPanelHtml(feature, circuitIndex) {
    const allProps = { ...feature.properties, ...feature.properties.userData };
    const poiName = getPatrimonialName(feature); // nom affiché = selon la langue choisie
    const inCircuit = circuitIndex !== null;
    const mobile = isMobileView();

    // Identité
    const arName = allProps['Nom du site arabe'] || allProps['Nom du site AR'] || '';
    const hasAr = !!arName && arName.trim() !== '';
    const zone = (getDerivedZone(feature) || '').trim();
    const category = (allProps['Catégorie'] || '').trim();
    const showCategory = !!category && category !== 'A définir';

    // Attributs taxonomie (Sous-type / État / Accès) — saisis via le Data
    // Manager ou le richEditor. Affichés uniquement s'ils sont renseignés.
    const subtype = (allProps['Sous-type'] || '').trim();
    const etat = (allProps['État'] || '').trim();
    const acces = (allProps['Accès'] || '').trim();

    // États utilisateur
    const isVu = !!allProps.vu;
    const isIncontournable = !!allProps.incontournable;

    // Photos
    const photos = Array.isArray(allProps.photos) ? allProps.photos : [];

    // Description longue (override userData prioritaire). La clé canonique est
    // `description` lowercase depuis l'unification (cf. chantier unification
    // PR à venir + migration scripts/migrate-description-case.mjs).
    const longDesc = (allProps.description || '').trim();
    const hasLongDesc = longDesc !== '';

    // Info GPX (texte exporté dans le <desc> des waypoints — visible côté
    // Wikiloc / GPX Studio). Clé canonique `info_gpx` lowercase depuis le
    // renommage de Description_courte.
    const gpxDesc = (allProps.info_gpx || '').trim();
    const hasGpxDesc = gpxDesc !== '';

    // Détails pratiques (Temps_minutes / Prix_TND : numbers depuis PR 5 chantier DM)
    let timeH = 0, timeM = 0;
    if (Number.isFinite(allProps['Temps_minutes'])) {
        const total = allProps['Temps_minutes'];
        timeH = Math.floor(total / 60);
        timeM = total % 60;
    }
    const hasTime = timeH > 0 || timeM > 0;
    const timeText = formatTimeText(timeH, timeM);

    let priceValue = null;
    if (Number.isFinite(allProps['Prix_TND'])) {
        priceValue = allProps['Prix_TND'];
    }
    const hasPrice = priceValue !== null;
    const currency = getCurrentCurrency();
    const priceText = !hasPrice ? '' : (priceValue === 0 ? 'Gratuit' : `${priceValue}${currency ? ' ' + currency : ''}`);

    const phone = (allProps['Téléphone'] || allProps.telephone || '').trim();
    const hasPhone = phone !== '';
    const hours = (allProps['Horaires'] || allProps.horaires || '').trim();
    const hasHours = hours !== '';
    // Lien Facebook : on n'autorise QUE http(s) en href (bloque javascript:, data:…).
    const fbRaw = (allProps['Facebook'] || '').trim();
    const facebookUrl = /^https?:\/\//i.test(fbRaw) ? fbRaw : '';

    const notes = (allProps.notes || '').toString();

    // Ligne d'état du cartel (v3) — le STATUT descend de la photo vers le cartel,
    // sous le titre (.cartel-status). L'identité (zone, catégorie) reste portée
    // par l'eyebrow ; on ne double rien sur la photo. État · Accès ·
    // Incontournable · (admin) « À évaluer ».
    const accesMeta = acces ? accessTagMeta(acces) : null;
    const statusItems = [
        etat ? `<span class="cartel-status-item cartel-status-item--${stateTagClass(etat)}"><span class="dot"></span>${escapeXml(etat)}</span>` : '',
        accesMeta ? `<span class="cartel-status-item cartel-status-item--${accesMeta.cls}"><i data-lucide="${accesMeta.icon}"></i>${escapeXml(acces)}</span>` : '',
        isIncontournable ? `<span class="cartel-status-item cartel-status-item--brand"><i data-lucide="star"></i>Incontournable</span>` : '',
        // P8 — alerte PUBLIÉE (admin ET visiteur) : lieu non situable sur Maps/OSM
        // (flag `introuvableCarte`, posé en curation). Réutilise le style d'alerte
        // existant (--warn). Le visiteur est ainsi prévenu que la position peut être
        // approximative, sans qu'on cache le lieu.
        allProps.introuvableCarte ? `<span class="cartel-status-item cartel-status-item--warn"><i data-lucide="map-pin-off"></i>Localisation à confirmer</span>` : '',
        // Admin only : « À évaluer » UNIQUEMENT quand le point d'accès a échoué
        // (status='failed') → signal d'action. Pas pour un point d'accès normal
        // (osm/moved) : quasi tous en ont un, c'était du bruit (retour Stefan
        // 03/06). L'action « Point d'accès au tracé » reste dans le kebab.
        (() => {
            if (!state.isAdmin) return '';
            if (getAccessPointStatus(feature) !== 'failed') return '';
            return `<span class="cartel-status-item cartel-status-item--warn"><i data-lucide="flag"></i>À évaluer</span>`;
        })()
    ].filter(Boolean);
    const statusHtml = statusItems.length
        ? `<div class="cartel-status">${statusItems.join('<span class="cartel-status-sep"></span>')}</div>`
        : '';

    // Section Description
    const descBlock = hasLongDesc
        ? `<p class="poi-desc">${escapeXml(longDesc).replace(/\n/g, '<br>')}</p>${renderSource(allProps)}`
        : `<p class="poi-desc is-placeholder">Aucune description disponible.</p>`;

    // Section GPX (cachée par défaut, ouverte par bouton tiroir)
    const gpxSection = hasGpxDesc
        ? `<section class="poi-section poi-gpx-section is-hidden" id="${mobile ? 'mobile-section-gpx-desc' : 'section-gpx-desc'}">
              <h3 class="poi-section-title"><span class="ttl-text"><i data-lucide="file-text"></i>Info GPX</span></h3>
              <p class="poi-desc" id="${mobile ? '' : 'panel-short-desc-display'}">${escapeXml(gpxDesc).replace(/\n/g, '<br>')}</p>
           </section>`
        : '';

    // Section Détails pratiques
    // - Si pas de temps de visite ET (prix vide OU prix=0) → "Visite libre" (1 chip englobante)
    // - Sinon → chips renseignées (durée si renseignée, prix payant uniquement, horaires/téléphone si renseignés)
    const isPaid = hasPrice && priceValue > 0;
    // Le repli calculé « Accès : Visite libre » est supprimé dès qu'un POI a
    // une valeur d'Accès taxonomie : c'est la pastille du hero qui fait foi
    // (évite deux « Accès » contradictoires sur la même fiche).
    const isFreeAccess = !hasTime && !isPaid && !acces;

    const facts = [];
    if (isFreeAccess) {
        facts.push(`
            <div class="poi-fact">
                <div class="ico"><i data-lucide="door-open"></i></div>
                <div><span class="lab">Accès</span><span class="val">Visite libre</span></div>
            </div>`);
    } else {
        if (hasTime) facts.push(`
            <div class="poi-fact">
                <div class="ico"><i data-lucide="clock"></i></div>
                <div><span class="lab">Durée de visite</span><span class="val">${escapeXml(timeText)}</span></div>
            </div>`);
        if (isPaid) facts.push(`
            <div class="poi-fact">
                <div class="ico"><i data-lucide="ticket"></i></div>
                <div><span class="lab">Prix d'entrée</span><span class="val">${escapeXml(priceText)}</span></div>
            </div>`);
    }
    if (hasHours) facts.push(`
        <div class="poi-fact">
            <div class="ico"><i data-lucide="calendar-clock"></i></div>
            <div><span class="lab">Horaires</span><span class="val">${escapeXml(hours)}</span></div>
        </div>`);
    if (hasPhone) {
        const tel = phone.replace(/\s+/g, '');
        facts.push(`
            <div class="poi-fact">
                <div class="ico"><i data-lucide="phone"></i></div>
                <div><span class="lab">Téléphone</span><span class="val"><a href="tel:${escapeXml(tel)}">${escapeXml(phone)}</a></span></div>
            </div>`);
    }
    if (facebookUrl) {
        facts.push(`
            <div class="poi-fact">
                <div class="ico"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 13.5h2.5l1-4H14v-2c0-1.03 0-2 2-2h1.5V2.14c-.326-.043-1.557-.14-2.857-.14C11.928 2 10 3.657 10 6.7v2.8H7v4h3V22h4v-8.5z"/></svg></div>
                <div><span class="lab">Facebook</span><span class="val"><a href="${escapeXml(facebookUrl)}" target="_blank" rel="noopener noreferrer">Voir sur Facebook</a></span></div>
            </div>`);
    }
    const practicalSection = facts.length === 0 ? '' : `
        <section class="poi-section">
            <h3 class="poi-section-title"><span class="ttl-text"><i data-lucide="info"></i>Détails pratiques</span></h3>
            <div class="poi-practical">${facts.join('')}</div>
        </section>`;

    // Section Mon suivi
    const suiviSection = `
        <section class="poi-section">
            <h3 class="poi-section-title"><span class="ttl-text"><i data-lucide="bookmark"></i>Mon suivi</span></h3>
            <div class="poi-suivi">
                <div class="poi-toggle ${isVu ? 'is-on' : ''}" data-toggle="vu" id="poi-toggle-vu">
                    <i class="poi-toggle-icon" data-lucide="${isVu ? 'check-circle-2' : 'circle'}"></i>
                    <div class="lab-text">Visité<span class="lab-hint">${isVu ? 'Ajouté à mon carnet de voyage' : 'Cocher après visite sur place'}</span></div>
                </div>
                <div class="poi-toggle amber ${isIncontournable ? 'is-on' : ''}" data-toggle="incontournable" id="poi-toggle-incontournable">
                    <i class="poi-toggle-icon" data-lucide="${isIncontournable ? 'star' : 'star-off'}"></i>
                    <div class="lab-text">Incontournable<span class="lab-hint">Ignore les filtres visités/planifiés</span></div>
                </div>
                <textarea class="poi-notes-area" id="poi-notes-area" placeholder="Mes notes : impressions, conseils, photos manquantes…">${escapeXml(notes)}</textarea>
            </div>
        </section>`;

    // Description block (TTS button uniquement si description présente — rien à lire sinon)
    const descSection = `
        <section class="poi-section description-section">
            <h3 class="poi-section-title">
                <span class="ttl-text">Description</span>
                ${hasLongDesc ? `<button class="ttl-action speak-btn" title="Lire à voix haute" aria-label="Lire à voix haute"><i data-lucide="volume-2"></i></button>` : ''}
            </h3>
            ${descBlock}
        </section>`;

    // Compteur position dans le circuit (3 / 12) — affiché en eyebrow si in circuit.
    // Si in circuit, deux chevrons cliquables encadrent le compteur pour naviguer
    // entre POIs (remplace les nav pills/row supprimés du footer).
    const isFirst = inCircuit && circuitIndex === 0;
    const isLast = inCircuit && state.currentCircuit && circuitIndex === state.currentCircuit.length - 1;
    const positionText = inCircuit && state.currentCircuit
        ? `<span class="cartel-nav">
              <button class="cartel-nav-chev" id="poi-eyebrow-prev" type="button"
                      title="POI précédent" aria-label="POI précédent" ${isFirst ? 'disabled' : ''}>
                  <i data-lucide="chevron-left"></i>
              </button>
              <span class="cartel-nav-pos">${circuitIndex + 1} / ${state.currentCircuit.length}</span>
              <button class="cartel-nav-chev" id="poi-eyebrow-next" type="button"
                      title="POI suivant" aria-label="POI suivant" ${isLast ? 'disabled' : ''}>
                  <i data-lucide="chevron-right"></i>
              </button>
           </span>`
        : '';

    // Mini-barre + popover kebab — communs PC + mobile.
    // Le kebab vit dans la mini-barre sur les deux (cohérence PC/mobile).
    const quickBarHtml = buildPoiQuickBar({ withKebab: true });
    const kebabPopover = buildPoiKebabMenu({ hasGpxDesc, isMobile: mobile });

    // Eyebrow contextuel partagé PC/mobile.
    // zone et category sont escapés ; positionText est du HTML safe (chevrons + index).
    // Eyebrow du cartel : zone · catégorie (— sous-type), en <span> séparés par
    // un filet « · », + la nav in-circuit (positionText = .cartel-nav, poussée à
    // droite). Les <span> permettent de colorer .sep et .subtype indépendamment.
    const eyebrowTextParts = [
        zone ? `<span>${escapeXml(zone)}</span>` : '',
        showCategory
            ? `<span>${escapeXml(category)}${subtype ? ` <span class="subtype">${escapeXml(subtype)}</span>` : ''}</span>`
            : ''
    ].filter(Boolean);
    const eyebrowTextHtml = eyebrowTextParts.join('<span class="sep">·</span>');
    // Rangée utilitaire (v3) : eyebrow (zone · catégorie) à gauche ; à droite,
    // dé-empilées du titre : la nav circuit (positionText) et l'aide « ? »
    // (.cartel-help). La langue des noms est un réglage GLOBAL (topbar sur PC,
    // menu sur mobile) — pas de bascule par fiche.
    const curLang = getCurrentPatrimonialLang();
    const titleIsAr = hasAr && curLang === 'ar'; // titre réellement affiché en arabe → dir RTL
    const helpBtnHtml = `<button class="cartel-help" type="button" aria-label="Aide : lire la fiche d'un lieu"><i data-lucide="circle-help"></i></button>`;
    const utilityHtml = `<div class="cartel-utility">${eyebrowTextParts.length ? `<p class="cartel-eyebrow">${eyebrowTextHtml}</p>` : ''}<div class="cartel-utility-actions">${positionText}${helpBtnHtml}</div></div>`;

    // ========== TEMPLATE DESKTOP ==========
    if (!mobile) {
        // PC : pas de croix de fermeture (audit Stefan #2 : la nav se fait
        // via les onglets sidebar, croix redondante).
        const heroHtml = buildHero({ photos, hasFullscreenClose: false });

        return `
            <div class="poi-panel" data-poi-id="${escapeXml(feature.properties.HW_ID || '')}">
                ${heroHtml}
                <div class="poi-body">
                    <div class="cartel-head">
                        ${utilityHtml}
                        <h2 class="cartel-title" id="panel-title-fr"${titleIsAr ? ' dir="rtl"' : ''}>${escapeXml(poiName)}</h2>
                        ${statusHtml}
                    </div>
                    ${descSection}
                    ${gpxSection}
                    ${practicalSection}
                    ${suiviSection}
                </div>
                <div class="poi-footer">
                    ${quickBarHtml}
                    ${kebabPopover}
                </div>
            </div>`;
    }

    // ========== TEMPLATE MOBILE ==========
    // Refonte étape 5 : retourne un objet { header, body, footer } pour que
    // openDetailsPanel mobile (ui-details.js) puisse rendre dans les 3 slots
    // du #mobile-container. Plus de wrapper .poi-panel.is-mobile (le contenu
    // est éclaté dans header-slot / main-container / view-footer-slot).
    const heroHtml = buildHero({ photos, hasFullscreenClose: false });
    const dataPoiId = escapeXml(feature.properties.HW_ID || '');

    return {
        header: `
            <div class="poi-mobile-header" data-poi-id="${dataPoiId}">
                <div class="poi-mobile-header-row">
                    <div class="poi-mobile-title-wrap">
                        ${utilityHtml}
                        <h1 class="cartel-title" id="mobile-title-fr"${titleIsAr ? ' dir="rtl"' : ''}>${escapeXml(poiName)}</h1>
                        ${statusHtml}
                    </div>
                    <button class="poi-mobile-back" id="details-close-btn" title="Fermer la fiche" aria-label="Fermer la fiche"><i data-lucide="x"></i></button>
                </div>
            </div>
        `,
        body: `
            <div class="poi-body" data-poi-id="${dataPoiId}">
                ${heroHtml}
                ${descSection}
                ${gpxSection}
                ${practicalSection}
                ${suiviSection}
            </div>
        `,
        footer: `
            <div class="poi-mobile-quick-bar-wrap">
                ${quickBarHtml}
                ${kebabPopover}
            </div>
        `
    };
}
