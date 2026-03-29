// templates.js
import { getPoiName } from './data.js';
import { escapeXml } from './utils.js';
import { POI_CATEGORIES, state, getCurrentCurrency } from './state.js';
import { isMobileView } from './mobile.js';

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
        return `<div class="source-container">Source: <a href="${fullUrl}" target="_blank" rel="noopener noreferrer">${domain}</a></div>`;
    } catch (_) {
        return `<div class="source-container">Source: <span>${escapeXml(firstLine)}</span></div>`;
    }
}

export function buildDetailsPanelHtml(feature, circuitIndex) {
    const allProps = { ...feature.properties, ...feature.properties.userData };
    const poiName = getPoiName(feature);
    const inCircuit = circuitIndex !== null;
    const currentCat = allProps['Catégorie'] || '';

    // Extraction Titre AR
    const arName = allProps['Nom du site arabe'] || allProps['Nom du site AR'] || '';
    const hasAr = !!arName && arName.trim() !== '';

    const categoryOptions = POI_CATEGORIES.map(c =>
        `<option value="${c}" ${c === currentCat ? 'selected' : ''}>${c}</option>`
    ).join('');

    let timeText = '00h00', hours = 0, minutes = 0;
    if (allProps.timeH !== undefined && allProps.timeM !== undefined) {
        hours = allProps.timeH; minutes = allProps.timeM;
    } else if (allProps['Temps de visite']) {
        const timeParts = allProps['Temps de visite'].split(':');
        hours = parseInt(timeParts[0], 10) || 0;
        minutes = parseInt(timeParts[1], 10) || 0;
    }
    timeText = `${String(hours).padStart(2, '0')}h${String(minutes).padStart(2, '0')}`;

    const priceValue = allProps.price !== undefined ? allProps.price : (parseFloat(allProps['Prix d\'entrée']) || '');
    const isVuChecked = allProps.vu ? 'checked' : '';
    const isIncontournableChecked = allProps.incontournable ? 'checked' : '';

    const photos = allProps.photos || [];
    let photosHtml = photos.map((src, index) => `
        <div class="photo-item">
            <img src="${src}" class="img-preview" title="Cliquez pour agrandir" data-index="${index}">
        </div>
    `).join('');

    const currency = getCurrentCurrency();
    const priceDisplay = priceValue === 0 || priceValue === '0' || priceValue === '' ? 'Gratuit' : priceValue;

    const practicalDetailsHtml = `
        <div class="detail-section">
            <h3>Détails Pratiques</h3>
            <div class="content structured-input-row">
                <div class="input-group">
                    <div class="stepper-control time-editor">
                        <button class="stepper-btn" id="time-decrement-btn" title="- 5 min" aria-label="- 5 min">${ICONS.minus}</button>
                        <span id="panel-time-display" class="value-display" data-hours="${hours}" data-minutes="${minutes}">${timeText}</span>
                        <button class="stepper-btn" id="time-increment-btn" title="+ 5 min" aria-label="+ 5 min">${ICONS.plus}</button>
                    </div>
                </div>
                <div class="input-group">
                    <div class="stepper-control price-editor">
                        <button class="stepper-btn" id="price-decrement-btn" title="- 0.5" aria-label="- 0.5">${ICONS.minus}</button>
                        <span id="panel-price-display" class="value-display" data-value="${priceValue || 0}">${priceDisplay}</span>
                        <span class="stepper-currency" id="panel-price-currency" style="${priceValue > 0 ? '' : 'display:none;'}">${currency}</span>
                        <button class="stepper-btn" id="price-increment-btn" title="+ 0.5" aria-label="+ 0.5">${ICONS.plus}</button>
                    </div>
                </div>
            </div>
        </div>`;

    const gmapsButtonHtml = `<button class="action-button" id="open-gmaps-btn" title="Itinéraire Google Maps" aria-label="Itinéraire Google Maps">${ICONS.googleMaps}</button>`;

    const categorySelectHtml = `
        <select id="panel-category-select" class="editable-input header-input panel-category-select" style="display:none;">
            ${categoryOptions}
        </select>
    `;

    // --- TEMPLATE PC ---
    const pcHtml = `
        <div class="panel-header editable-field pc-layout" data-field-id="title">
            <!-- ROW 1: Title + Close -->
            <div class="panel-header-title-row">
                <div class="left-text-block panel-title-block">
                     <h2 id="panel-title-fr" class="panel-title-text" title="${escapeXml(poiName)}">${escapeXml(poiName)}</h2>
                     <h2 id="panel-title-ar" class="panel-title-text panel-title-text--ar" style="display:none;" dir="rtl">${escapeXml(arName)}</h2>
                </div>
                <div class="panel-title-close">
                     <button class="action-button" id="close-details-button" title="Fermer" aria-label="Fermer">${ICONS.x}</button>
                </div>
            </div>

            <!-- ROW 2: Actions Toolbar -->
            <div class="panel-header-actions-row">
                <!-- Left: Tools -->
                <div class="panel-btn-group">
                     <button class="action-button${hasAr ? '' : ' btn-disabled-look'}" id="btn-toggle-lang" title="Afficher le titre arabe" aria-label="Afficher le titre arabe" ${hasAr ? '' : 'disabled'}>${ICONS.languages}</button>
                     <button class="action-button" id="btn-toggle-gpx-desc" title="Afficher/Masquer Description GPX" aria-label="Afficher/Masquer Description GPX">${ICONS.fileText}</button>
                     <button class="action-button btn-web-search" id="btn-web-search" title="Rechercher sur Google" aria-label="Rechercher sur Google">${ICONS.globe}</button>
                     ${gmapsButtonHtml}
                     <button class="action-button" id="btn-move-marker" title="Déplacer le marqueur" aria-label="Déplacer le marqueur">${ICONS.move}</button>
                     <button class="action-button" id="btn-open-photo-grid" title="Gérer les photos" aria-label="Gérer les photos">${ICONS.imagePlus}</button>
                     <button class="action-button" id="btn-global-edit" title="Modifier le lieu" aria-label="Modifier le lieu">${ICONS.pen}</button>
                </div>
                <!-- Right: Navigation + Delete -->
                <div class="panel-btn-group">
                     <button class="action-button btn-danger-icon" id="btn-soft-delete" title="Signaler pour suppression" aria-label="Signaler pour suppression">${ICONS.trash}</button>
                     ${inCircuit ? `<button class="action-button" id="prev-poi-button" title="Précédent" aria-label="Précédent" ${circuitIndex === 0 ? 'disabled' : ''}>${ICONS.chevronLeft}</button>
                                    <button class="action-button" id="next-poi-button" title="Suivant" aria-label="Suivant" ${circuitIndex === state.currentCircuit.length - 1 ? 'disabled' : ''}>${ICONS.chevronRight}</button>` : ''}
                </div>
            </div>

            <!-- Hidden Inputs -->
            <input type="text" id="panel-title-input" class="editable-input header-input" style="display: none;">
            ${categorySelectHtml}
        </div>

        <div class="panel-content">
            <div class="detail-section editable-field" id="section-gpx-desc" data-field-id="short_desc" style="display:none;">
                <h3>Description GPX</h3>
                <div class="content">
                    <p id="panel-short-desc-display" class="editable-text short-text text-expanded">${escapeXml(allProps.Description_courte || allProps.Desc_wpt || '')}</p>
                </div>
            </div>
            <div class="detail-section editable-field description-section" data-field-id="description">
                <h3 class="section-title-row">
                    <span>Description</span>
                    <button class="action-button speak-btn" title="Lire la description" aria-label="Lire la description">${ICONS.volume}</button>
                </h3>
                <div class="content">
                    <div id="panel-description-display" class="description-content editable-text description-scrollable">${escapeXml(allProps.description || allProps.Description || '').replace(/\n/g, '<br>')}</div>
                    ${renderSource(allProps)}
                </div>
            </div>
            ${practicalDetailsHtml}
            <div class="detail-section">
                <h3>Mon Suivi</h3>
                <div class="content checkbox-group">
                  <label class="checkbox-label"><input type="checkbox" id="panel-chk-vu" ${isVuChecked}> Visité</label>
                  <label class="checkbox-label"><input type="checkbox" id="panel-chk-incontournable" ${isIncontournableChecked}> Incontournable</label>
                </div>
            </div>
            <div class="detail-section editable-field notes-section" data-field-id="notes">
                <h3>Notes</h3>
                <div class="content">
                    <div id="panel-notes-display" class="description-content editable-text">${escapeXml(allProps.notes || '').replace(/\n/g, '<br>')}</div>
                </div>
            </div>
        </div>`;

    // --- TEMPLATE MOBILE ---
    const mobileGmapsBtn = gmapsButtonHtml.replace('class="action-button"', 'class="action-button btn-mobile-action"');

    const mobileHtml = `
        <div class="panel-content mobile-panel-content">
            <div class="detail-section editable-field mobile-sticky-header" data-field-id="title">
                <div class="content mobile-header-inner">

                    <!-- ROW 1: Header Grid (Back + Centered Title) -->
                    <div class="mobile-header-grid">

                        <!-- Left: Back Button -->
                        <div class="mobile-header-left">
                             <button id="details-close-btn" class="action-button btn-back-mobile">${ICONS.arrowLeft}</button>
                        </div>

                        <!-- Center: Title -->
                        <div class="title-names mobile-header-center">
                             <h2 id="mobile-title-fr" class="editable-text mobile-title-text">${escapeXml(poiName)}</h2>
                             <h2 id="mobile-title-ar" class="mobile-title-text mobile-title-text--ar" style="display:none;" dir="rtl">${escapeXml(arName)}</h2>
                        </div>

                        <!-- Right: Empty Placeholder (for balance) -->
                        <div class="mobile-header-right">
                             <!-- Reserved space -->
                        </div>
                    </div>

                    <!-- ROW 2: Toolbar -->
                    <div class="mobile-header-actions-row">
                         <!-- Left: Tools -->
                         <div class="mobile-btn-group">
                             <button class="action-button btn-mobile-action${hasAr ? '' : ' btn-disabled-look'}" id="mobile-btn-toggle-lang" title="Arabe" aria-label="Arabe" ${hasAr ? '' : 'disabled'}>${ICONS.languages}</button>
                             <button class="action-button btn-mobile-action" id="mobile-btn-toggle-gpx-desc" title="GPX Desc" aria-label="GPX Desc">${ICONS.fileText}</button>
                             <button class="action-button btn-mobile-action btn-web-search" id="btn-web-search" title="Google" aria-label="Google">${ICONS.globe}</button>
                             ${mobileGmapsBtn}
                             <button class="action-button btn-mobile-action" id="btn-open-photo-grid" title="Gérer les photos" aria-label="Gérer les photos">${ICONS.imagePlus}</button>
                             <button class="action-button btn-mobile-action" id="btn-global-edit" title="Editer" aria-label="Editer">${ICONS.pen}</button>
                         </div>

                         <!-- Right: Navigation + Delete -->
                         <div class="mobile-btn-group">
                             <button class="action-button btn-mobile-action btn-danger-color" id="btn-soft-delete" title="Supprimer" aria-label="Supprimer">${ICONS.trash}</button>
                             <button id="details-prev-btn" class="action-button btn-mobile-action" data-direction="-1" ${(!inCircuit || circuitIndex === 0) ? 'disabled' : ''}>${ICONS.chevronLeft}</button>
                             <button id="details-next-btn" class="action-button btn-mobile-action" data-direction="1" ${(!inCircuit || circuitIndex === state.currentCircuit.length - 1) ? 'disabled' : ''}>${ICONS.chevronRight}</button>
                         </div>
                    </div>

                    <!-- Hidden Stuff -->
                    <input type="text" class="editable-input" style="display: none;" value="${escapeXml(poiName)}">
                    ${categorySelectHtml}
                </div>
            </div>

            <div class="detail-section editable-field" id="mobile-section-gpx-desc" data-field-id="short_desc" style="display:none;">
                <h3>Description GPX</h3>
                <div class="content">
                    <p class="editable-text short-text text-expanded">${escapeXml(allProps.Description_courte || allProps.Desc_wpt || '')}</p>
                </div>
            </div>
            <div class="detail-section editable-field description-section" data-field-id="description">
                <h3 class="section-title-row">
                    <span>Description</span>
                    <button class="action-button speak-btn" title="Lire la description" aria-label="Lire la description">${ICONS.volume}</button>
                </h3>
                <div class="content">
                    <div class="description-content editable-text description-scrollable">${escapeXml(allProps.description || allProps.Description || '').replace(/\n/g, '<br>')}</div>
                    ${renderSource(allProps)}
                </div>
            </div>
            ${practicalDetailsHtml}
            <div class="detail-section">
                <h3>Mon Suivi</h3>
                <div class="content checkbox-group">
                  <label class="checkbox-label"><input type="checkbox" id="panel-chk-vu" ${isVuChecked}> Visité</label>
                  <label class="checkbox-label"><input type="checkbox" id="panel-chk-incontournable" ${isIncontournableChecked}> Incontournable</label>
                </div>
            </div>
            <div class="detail-section editable-field notes-section" data-field-id="notes">
                <h3>Notes</h3>
                <div class="content">
                    <div class="description-content editable-text">${escapeXml(allProps.notes || '').replace(/\n/g, '<br>')}</div>
                </div>
            </div>
        </div>`;

    return isMobileView() ? mobileHtml : pcHtml;
}
