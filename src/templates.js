// templates.js
import { getPoiName } from './data.js';
import { escapeXml } from './utils.js';
import { state } from './state.js';
import { isMobileView } from './mobile-state.js';

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
        return `<div class="poi-source-link">Source : <a href="${fullUrl}" target="_blank" rel="noopener noreferrer">${domain}</a></div>`;
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

function buildHero(opts) {
    const { photos, tagsHtml, hasFullscreenClose } = opts;
    const photoCount = photos.length;
    const closeBtn = hasFullscreenClose
        ? `<button class="poi-back-pill" id="close-details-button" title="Fermer" aria-label="Fermer"><i data-lucide="x"></i></button>`
        : '';

    if (photoCount > 0) {
        // Le background-image est appliqué côté JS (CSSOM) pour rester CSP-safe
        return `
            <div class="poi-hero has-photo" id="poi-hero" data-bg-url="${escapeXml(photos[0])}">
                ${closeBtn}
                ${photoCount > 0 ? `<span class="poi-photo-count"><i data-lucide="image"></i>${photoCount} ${photoCount > 1 ? 'photos' : 'photo'}</span>` : ''}
                ${tagsHtml ? `<div class="poi-hero-overlay"><div class="poi-hero-tags">${tagsHtml}</div></div>` : ''}
            </div>`;
    }

    return `
        <div class="poi-hero is-empty" id="poi-hero">
            ${closeBtn}
            <div class="empty-icon"><i data-lucide="image-off"></i></div>
            <span class="empty-label">Aucune photo</span>
        </div>`;
}

function buildToolsPanelHtml({ hasAr, hasGpxDesc, isMobile }) {
    // 3 groupes : Recherche externe · Données du lieu · Édition.
    // Différenciation PC / mobile sur la position :
    //   - PC  : "Déplacer marqueur" (drag pin sur la carte)
    //   - Mobile : "Capturer position" (getCurrentPosition)

    const rechercheBtns = `
        <button class="poi-tool-btn btn-web-search" id="btn-web-search" title="Rechercher sur Google" aria-label="Rechercher sur Google">
            <div class="ico-box"><i data-lucide="search"></i></div>Google
        </button>
        <button class="poi-tool-btn" id="open-gmaps-btn" title="Vérifier sur Google Maps" aria-label="Vérifier sur Google Maps">
            <div class="ico-box"><i data-lucide="map"></i></div>Maps
        </button>
        <button class="poi-tool-btn ${hasAr ? '' : 'is-disabled'}" id="${isMobile ? 'mobile-btn-toggle-lang' : 'btn-toggle-lang'}" title="Afficher le titre arabe" aria-label="Afficher le titre arabe" ${hasAr ? '' : 'disabled'}>
            <div class="ico-box"><i data-lucide="languages"></i></div>Arabe
        </button>
    `;

    const donneesBtns = `
        <button class="poi-tool-btn ${hasGpxDesc ? '' : 'is-disabled'}" id="${isMobile ? 'mobile-btn-toggle-gpx-desc' : 'btn-toggle-gpx-desc'}" title="Description GPX" aria-label="Description GPX" ${hasGpxDesc ? '' : 'disabled'}>
            <div class="ico-box"><i data-lucide="file-text"></i></div>Desc. GPX
        </button>
        ${isMobile
            ? `<button class="poi-tool-btn" id="mobile-move-poi-btn" title="Capturer ma position" aria-label="Capturer ma position">
                   <div class="ico-box"><i data-lucide="locate-fixed"></i></div>Capturer position
               </button>`
            : `<button class="poi-tool-btn" id="btn-move-marker" title="Déplacer le marqueur sur la carte" aria-label="Déplacer le marqueur sur la carte">
                   <div class="ico-box"><i data-lucide="move"></i></div>Déplacer marqueur
               </button>`
        }
        <button class="poi-tool-btn" id="btn-open-photo-grid" title="Gérer les photos" aria-label="Gérer les photos">
            <div class="ico-box"><i data-lucide="image-plus"></i></div>Photos
        </button>
    `;

    const editionBtns = `
        <button class="poi-tool-btn" id="btn-global-edit" title="Modifier le lieu" aria-label="Modifier le lieu">
            <div class="ico-box"><i data-lucide="pencil"></i></div>Éditer
        </button>
        <button class="poi-tool-btn danger" id="btn-soft-delete" title="Signaler pour suppression" aria-label="Signaler pour suppression">
            <div class="ico-box"><i data-lucide="trash-2"></i></div>Supprimer
        </button>
    `;

    return `
        <p class="poi-tools-cap">Recherche externe</p>
        <div class="poi-tools-grid">${rechercheBtns}</div>
        <div class="poi-tools-divider"></div>
        <p class="poi-tools-cap">Données du lieu</p>
        <div class="poi-tools-grid">${donneesBtns}</div>
        <div class="poi-tools-divider"></div>
        <p class="poi-tools-cap">Édition</p>
        <div class="poi-tools-grid">${editionBtns}</div>
    `;
}

export function buildDetailsPanelHtml(feature, circuitIndex) {
    const allProps = { ...feature.properties, ...feature.properties.userData };
    const poiName = getPoiName(feature);
    const inCircuit = circuitIndex !== null;
    const mobile = isMobileView();

    // Identité
    const arName = allProps['Nom du site arabe'] || allProps['Nom du site AR'] || '';
    const hasAr = !!arName && arName.trim() !== '';
    const zone = (allProps.Zone || '').trim();
    const category = (allProps['Catégorie'] || '').trim();
    const showCategory = !!category && category !== 'A définir';

    // États utilisateur
    const isVu = !!allProps.vu;
    const isIncontournable = !!allProps.incontournable;

    // Photos
    const photos = Array.isArray(allProps.photos) ? allProps.photos : [];

    // Description longue (override userData prioritaire)
    const longDesc = (allProps.description || allProps.Description || '').trim();
    const hasLongDesc = longDesc !== '';

    // Description GPX (Wikiloc)
    const gpxDesc = (allProps.Description_courte || allProps.Desc_wpt || '').trim();
    const hasGpxDesc = gpxDesc !== '';

    // Détails pratiques
    let timeH = 0, timeM = 0;
    if (allProps.timeH !== undefined && allProps.timeM !== undefined) {
        timeH = parseInt(allProps.timeH, 10) || 0;
        timeM = parseInt(allProps.timeM, 10) || 0;
    } else if (allProps['Temps de visite']) {
        const parts = String(allProps['Temps de visite']).split(':');
        timeH = parseInt(parts[0], 10) || 0;
        timeM = parseInt(parts[1], 10) || 0;
    }
    const hasTime = timeH > 0 || timeM > 0;
    const timeText = formatTimeText(timeH, timeM);

    let priceValue = null;
    if (allProps.price !== undefined && allProps.price !== '') {
        priceValue = Number(allProps.price);
        if (!Number.isFinite(priceValue)) priceValue = null;
    } else if (allProps['Prix d\'entrée'] !== undefined) {
        const parsed = parseFloat(allProps['Prix d\'entrée']);
        if (!isNaN(parsed)) priceValue = parsed;
    }
    const hasPrice = priceValue !== null;
    const currency = getCurrentCurrency();
    const priceText = !hasPrice ? '' : (priceValue === 0 ? 'Gratuit' : `${priceValue}${currency ? ' ' + currency : ''}`);

    const phone = (allProps['Téléphone'] || allProps.telephone || '').trim();
    const hasPhone = phone !== '';
    const hours = (allProps['Horaires'] || allProps.horaires || '').trim();
    const hasHours = hours !== '';

    const notes = (allProps.notes || '').toString();

    // Tags hero
    const tagsHtml = [
        zone ? `<span class="poi-tag brand"><i data-lucide="map-pin"></i>${escapeXml(zone)}</span>` : '',
        showCategory ? `<span class="poi-tag amber"><i data-lucide="landmark"></i>${escapeXml(category)}</span>` : '',
        isIncontournable ? `<span class="poi-tag"><i data-lucide="star"></i>Incontournable</span>` : ''
    ].filter(Boolean).join('');

    // Section Description
    const descBlock = hasLongDesc
        ? `<p class="poi-desc">${escapeXml(longDesc).replace(/\n/g, '<br>')}</p>${renderSource(allProps)}`
        : `<p class="poi-desc is-placeholder">Aucune description disponible.</p>`;

    // Section GPX (cachée par défaut, ouverte par bouton tiroir)
    const gpxSection = hasGpxDesc
        ? `<section class="poi-section poi-gpx-section is-hidden" id="${mobile ? 'mobile-section-gpx-desc' : 'section-gpx-desc'}">
              <h3 class="poi-section-title"><span class="ttl-text"><i data-lucide="file-text"></i>Description GPX</span></h3>
              <p class="poi-desc" id="${mobile ? '' : 'panel-short-desc-display'}">${escapeXml(gpxDesc).replace(/\n/g, '<br>')}</p>
           </section>`
        : '';

    // Section Détails pratiques
    // - Si pas de temps de visite ET (prix vide OU prix=0) → "Visite libre" (1 chip englobante)
    // - Sinon → chips renseignées (durée si renseignée, prix payant uniquement, horaires/téléphone si renseignés)
    const isPaid = hasPrice && priceValue > 0;
    const isFreeAccess = !hasTime && !isPaid;

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
    const practicalSection = `
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
                    <div class="lab-text">Incontournable<span class="lab-hint">${isIncontournable ? 'Mis en avant sur la carte' : 'Mettre en avant sur la carte'}</span></div>
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

    // Compteur position dans le circuit (3 / 12) — affiché en eyebrow si in circuit
    const positionText = inCircuit && state.currentCircuit
        ? `${circuitIndex + 1} / ${state.currentCircuit.length}`
        : '';

    // Tools panel content (commun PC + mobile, mais boutons spécifiques device)
    const toolsContent = buildToolsPanelHtml({ hasAr, hasGpxDesc, isMobile: mobile });

    // Navigation prev/next quand POI in circuit
    const isFirst = inCircuit && circuitIndex === 0;
    const isLast = inCircuit && state.currentCircuit && circuitIndex === state.currentCircuit.length - 1;
    const navHtmlDesktop = inCircuit ? `
            <button id="prev-poi-button" class="poi-nav-btn" title="Précédent" aria-label="Précédent" ${isFirst ? 'disabled' : ''}><i data-lucide="chevron-left"></i></button>
            <button id="next-poi-button" class="poi-nav-btn" title="Suivant" aria-label="Suivant" ${isLast ? 'disabled' : ''}><i data-lucide="chevron-right"></i></button>` : '';
    const navHtmlMobilePrev = inCircuit ? `<button id="details-prev-btn" class="poi-nav-pill" data-direction="-1" title="Précédent" aria-label="Précédent" ${isFirst ? 'disabled' : ''}><i data-lucide="chevron-left"></i></button>` : '';
    const navHtmlMobileNext = inCircuit ? `<button id="details-next-btn" class="poi-nav-pill" data-direction="1" title="Suivant" aria-label="Suivant" ${isLast ? 'disabled' : ''}><i data-lucide="chevron-right"></i></button>` : '';

    // ========== TEMPLATE DESKTOP ==========
    if (!mobile) {
        // PC : pas de croix de fermeture (audit Stefan #2 : la nav se fait
        // via les onglets sidebar, croix redondante).
        const heroHtml = buildHero({ photos, tagsHtml, hasFullscreenClose: false });

        return `
            <div class="poi-panel" data-poi-id="${escapeXml(feature.properties.HW_ID || '')}">
                ${heroHtml}
                <div class="poi-body">
                    <div class="poi-title-block">
                        ${positionText || zone || showCategory ? `<div class="poi-eyebrow">${[zone, showCategory ? category : '', positionText].filter(Boolean).map(escapeXml).join(' · ')}</div>` : ''}
                        <h2 class="poi-title" id="panel-title-fr">${escapeXml(poiName)}</h2>
                        ${hasAr ? `<h2 class="poi-title poi-subtitle-ar is-hidden" id="panel-title-ar" dir="rtl">${escapeXml(arName)}</h2>` : ''}
                    </div>
                    ${descSection}
                    ${gpxSection}
                    ${practicalSection}
                    ${suiviSection}
                </div>
                <div class="poi-footer">
                    <button class="poi-cta" id="poi-cta-itinerary" title="Voir l'itinéraire dans Google Maps" aria-label="Voir l'itinéraire dans Google Maps">
                        <i data-lucide="map-pin"></i>
                        Voir l'itinéraire vers ce lieu
                    </button>
                    <div class="poi-tools" id="poi-tools">
                        <button class="poi-tools-trigger" id="poi-tools-trigger" type="button" aria-expanded="false">
                            <span class="dots"><i></i><i></i><i></i></span>
                            Outils
                            <span class="chev"><i data-lucide="chevron-down"></i></span>
                        </button>
                        <div class="poi-tools-panel is-hidden" id="poi-tools-panel">
                            ${toolsContent}
                        </div>
                    </div>
                    ${inCircuit ? `<div class="poi-nav-row">${navHtmlDesktop}</div>` : ''}
                </div>
            </div>`;
    }

    // ========== TEMPLATE MOBILE ==========
    const heroHtml = buildHero({ photos, tagsHtml, hasFullscreenClose: false });
    const headerCap = [zone, showCategory ? category : '', positionText].filter(Boolean).join(' · ');

    return `
        <div class="poi-panel is-mobile" data-poi-id="${escapeXml(feature.properties.HW_ID || '')}">
            <div class="poi-mobile-header">
                <div class="poi-mobile-header-row">
                    <button class="poi-mobile-back" id="details-close-btn" title="Retour" aria-label="Retour"><i data-lucide="arrow-left"></i></button>
                    <div class="poi-mobile-title-wrap">
                        ${headerCap ? `<div class="poi-mobile-cap">${escapeXml(headerCap)}</div>` : ''}
                        <h1 class="poi-mobile-title" id="mobile-title-fr">${escapeXml(poiName)}</h1>
                        ${hasAr ? `<h1 class="poi-mobile-title is-hidden" id="mobile-title-ar" dir="rtl">${escapeXml(arName)}</h1>` : ''}
                    </div>
                    <button class="poi-mobile-tools-trigger" id="poi-tools-trigger" type="button" title="Outils" aria-label="Outils" aria-expanded="false">
                        <span class="dots"><i></i><i></i><i></i></span>
                    </button>
                </div>
            </div>
            <div class="poi-body">
                ${heroHtml}
                ${descSection}
                ${gpxSection}
                ${practicalSection}
                ${suiviSection}
            </div>
            <div class="poi-mobile-cta-bar">
                ${navHtmlMobilePrev}
                <button class="poi-cta" id="poi-cta-itinerary" title="Voir l'itinéraire" aria-label="Voir l'itinéraire">
                    <i data-lucide="map-pin"></i>
                    Voir l'itinéraire
                </button>
                ${navHtmlMobileNext}
            </div>
            <div class="poi-mobile-tools-sheet" id="poi-mobile-tools-sheet" aria-hidden="true">
                <div class="sheet-backdrop" id="poi-mobile-tools-backdrop"></div>
                <div class="sheet-panel">
                    <div class="sheet-handle"></div>
                    <h3 class="poi-section-title"><span class="ttl-text"><i data-lucide="wrench"></i>Outils</span></h3>
                    ${toolsContent}
                </div>
            </div>
        </div>`;
}
