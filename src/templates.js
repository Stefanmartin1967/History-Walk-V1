// templates.js
import { getPoiName } from './data.js';
import { escapeXml } from './utils.js';
import { POI_CATEGORIES, state, getCurrentCurrency } from './state.js';
import { isMobileView } from './mobile.js';

export const ICONS = {
    mosque: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20H4v-7a8 8 0 0 1 16 0z"/><path d="M12 5V2"/><circle cx="12" cy="8" r="2"/></svg>`,    
    pen: `<i data-lucide="pencil" style="width:18px;height:18px;"></i>`,
    check: `<i data-lucide="check" style="width:18px;height:18px;"></i>`,
    chevronLeft: `<i data-lucide="chevron-left" style="width:18px;height:18px;"></i>`,
    chevronRight: `<i data-lucide="chevron-right" style="width:18px;height:18px;"></i>`,
    x: `<i data-lucide="x" style="width:18px;height:18px;"></i>`,
    arrowLeft: `<i data-lucide="arrow-left" style="width:24px;height:24px;"></i>`,
    arrowLeftToLine: `<i data-lucide="arrow-left-to-line" style="width:18px;height:18px;"></i>`,
    volume: `<i data-lucide="volume-2" style="width:18px;height:18px;"></i>`,
    imagePlus: `<i data-lucide="image-plus" style="width:18px;height:18px;"></i>`,
    locate: `<i data-lucide="locate-fixed" style="width:18px;height:18px;"></i>`,
    clock: `<i data-lucide="clock" style="width:18px;height:18px;"></i>`,
    minus: `<i data-lucide="minus" style="width:18px;height:18px;"></i>`,
    plus: `<i data-lucide="plus" style="width:18px;height:18px;"></i>`,
    ticket: `<i data-lucide="ticket" style="width:18px;height:18px;"></i>`,
    upload: `<i data-lucide="upload" style="width:18px;height:18px;"></i>`,
    download: `<i data-lucide="download" style="width:18px;height:18px;"></i>`,
    play: `<i data-lucide="play" style="width:18px;height:18px;"></i>`,
    trash: `<i data-lucide="trash-2" style="width:18px;height:18px;"></i>`,
    googleMaps: `<i data-lucide="map-pin" style="width:18px;height:18px;"></i>`,
    globe: `<i data-lucide="globe" style="width:18px;height:18px;"></i>`,
    languages: `<i data-lucide="languages" style="width:18px;height:18px;"></i>`,
    fileText: `<i data-lucide="file-text" style="width:18px;height:18px;"></i>`,
    move: `<i data-lucide="move" style="width:18px;height:18px;"></i>`
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
            <img src="${src}" class="img-preview" title="Cliquez pour agrandir">
            <button class="photo-delete-btn" data-index="${index}">${ICONS.trash}</button>
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
                        <button class="stepper-btn" id="time-decrement-btn" title="- 5 min">${ICONS.minus}</button>
                        <span id="panel-time-display" class="value-display" data-hours="${hours}" data-minutes="${minutes}">${timeText}</span>
                        <button class="stepper-btn" id="time-increment-btn" title="+ 5 min">${ICONS.plus}</button>
                    </div>
                </div>
                <div class="input-group">
                    <div class="stepper-control price-editor">
                        <button class="stepper-btn" id="price-decrement-btn" title="- 0.5">${ICONS.minus}</button>
                        <span id="panel-price-display" class="value-display" data-value="${priceValue || 0}">${priceDisplay}</span>
                        <span class="stepper-currency" id="panel-price-currency" style="${priceValue > 0 ? '' : 'display:none;'}">${currency}</span>
                        <button class="stepper-btn" id="price-increment-btn" title="+ 0.5">${ICONS.plus}</button>
                    </div>
                </div>
            </div>
        </div>`;

    const gmapsButtonHtml = `<button class="action-button" id="open-gmaps-btn" title="Itinéraire Google Maps">${ICONS.googleMaps}</button>`;
    
    const categorySelectHtml = `
        <select id="panel-category-select" class="editable-input header-input" style="display:none; margin-top:5px; width:100%; font-size:14px;">
            ${categoryOptions}
        </select>
    `;

    // --- TEMPLATE PC ---
    const pcHtml = `
        <div class="panel-header editable-field pc-layout" data-field-id="title" style="display:flex; flex-direction:column; gap:0; align-items:stretch; padding-bottom:4px;">
            <!-- ROW 1: Title + Close -->
            <div style="display:flex; justify-content:space-between; align-items:center; width:100%; padding-bottom: 8px; border-bottom: 1px solid #e5e7eb;">
                <div class="left-text-block" style="flex:1; min-width:0; margin-right:10px; overflow:hidden;">
                     <h2 id="panel-title-fr" title="${escapeXml(poiName)}" style="margin:0; font-size:20px; font-weight:700; color:var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeXml(poiName)}</h2>
                     <h2 id="panel-title-ar" style="display:none; margin:0; font-size:20px; font-weight:700; color:var(--ink); text-align:right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" dir="rtl">${escapeXml(arName)}</h2>
                </div>
                <div style="flex-shrink:0;">
                     <button class="action-button" id="close-details-button" title="Fermer" style="margin:0;">${ICONS.x}</button>
                </div>
            </div>

            <!-- ROW 2: Actions Toolbar -->
            <div style="display:flex; justify-content:space-between; align-items:center; width:100%; padding-top: 8px;">
                <!-- Left: Tools -->
                <div style="display:flex; gap:5px; align-items:center;">
                     <button class="action-button" id="btn-toggle-lang" title="Afficher le titre arabe" ${hasAr ? '' : 'disabled'} style="${hasAr ? '' : 'opacity:0.5; cursor:not-allowed;'}">${ICONS.languages}</button>
                     <button class="action-button" id="btn-toggle-gpx-desc" title="Afficher/Masquer Description GPX">${ICONS.fileText}</button>
                     <button class="action-button btn-web-search" id="btn-web-search" title="Rechercher sur Google">${ICONS.globe}</button>
                     ${gmapsButtonHtml}
                     <button class="action-button" id="btn-move-marker" title="Déplacer le marqueur">${ICONS.move}</button>
                     <button class="action-button" id="btn-global-edit" title="Modifier le lieu">${ICONS.pen}</button>
                     <button class="action-button" id="btn-soft-delete" title="Signaler pour suppression" style="color: var(--danger);">${ICONS.trash}</button>
                </div>
                <!-- Right: Navigation -->
                <div style="display:flex; gap:5px; align-items:center;">
                     ${inCircuit ? `<button class="action-button" id="prev-poi-button" title="Précédent" ${circuitIndex === 0 ? 'disabled' : ''}>${ICONS.chevronLeft}</button>
                                    <button class="action-button" id="next-poi-button" title="Suivant" ${circuitIndex === state.currentCircuit.length - 1 ? 'disabled' : ''}>${ICONS.chevronRight}</button>` : ''}
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
                    <p id="panel-short-desc-display" class="editable-text short-text" style="height:auto; min-height:24px; max-height:none; overflow:visible; display:block; white-space:normal !important; text-overflow:clip; -webkit-line-clamp:unset;">${escapeXml(allProps.Description_courte || allProps.Desc_wpt || '')}</p>
                </div>
            </div>
            <div class="detail-section editable-field description-section" data-field-id="description">
                <h3 style="display:flex; justify-content:space-between; align-items:center;">
                    <span>Description</span>
                    <button class="action-button speak-btn" title="Lire la description" style="margin:0;">${ICONS.volume}</button>
                </h3>
                <div class="content">
                    <div id="panel-description-display" class="description-content editable-text" style="max-height:200px; overflow-y:auto;">${(allProps.description || allProps.Description || '').replace(/\n/g, '<br>')}</div>
                    ${renderSource(allProps)}
                </div>
            </div>
            ${practicalDetailsHtml}
            <div class="detail-section">
                <h3>Position</h3>
                <div class="content" style="display:flex; gap:10px;">
                     <div style="flex:1;">
                        <label style="font-size:11px; color:var(--ink-soft); display:block; margin-bottom:2px;">Latitude</label>
                        <input type="number" id="poi-lat" step="0.00001" value="${feature.geometry.coordinates[1]}" readonly style="width:100%; padding:6px; border:1px solid var(--line); border-radius:6px; background:var(--surface-muted); color:var(--ink);">
                     </div>
                     <div style="flex:1;">
                        <label style="font-size:11px; color:var(--ink-soft); display:block; margin-bottom:2px;">Longitude</label>
                        <input type="number" id="poi-lng" step="0.00001" value="${feature.geometry.coordinates[0]}" readonly style="width:100%; padding:6px; border:1px solid var(--line); border-radius:6px; background:var(--surface-muted); color:var(--ink);">
                     </div>
                </div>
            </div>
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
                    <div id="panel-notes-display" class="description-content editable-text">${(allProps.notes || '').replace(/\n/g, '<br>')}</div>
                </div>
            </div>
            <div class="detail-section photos-section">
                <h3>Photos (${photos.length})
                    ${photos.length > 0 ? `
                    <div class="edit-controls section-controls">
                        <button class="action-button" id="btn-delete-all-photos" title="Tout supprimer" style="color: var(--danger);">${ICONS.trash}</button>
                    </div>` : ''}
                </h3>
                <div class="content">
                    <div class="photos-grid-scroller">
                        ${photosHtml}
                        <div class="photo-placeholder" title="Ajouter une photo">${ICONS.imagePlus}</div>
                    </div>
                    <input type="file" id="panel-photo-input" accept="image/*" multiple style="display: none;">
                </div>
            </div>
        </div>`;
    
    // --- TEMPLATE MOBILE ---
    const mobileBtnStyle = 'width:36px; height:36px; background:var(--surface-muted); padding:0; border-radius:8px; border:none; display:grid; place-items:center;';
    const mobileGmapsBtn = gmapsButtonHtml.replace('class="action-button"', `class="action-button" style="${mobileBtnStyle}"`);

    // Style spécifique pour la flèche retour (transparent)
    const backBtnStyle = 'width:44px; height:44px; background:transparent; padding:0; border:none; display:grid; place-items:center; margin-left:-8px;';

    const mobileHtml = `
        <div class="panel-content" style="padding-bottom: 100px;">
            <div class="detail-section editable-field" data-field-id="title" style="position:sticky; top:0; z-index:20; background:var(--surface-muted); padding-bottom:12px; margin-bottom:0; border-bottom:1px solid var(--line);">
                <div class="content" style="display:flex; flex-direction:column; gap:0;">

                    <!-- ROW 1: Header Grid (Back + Centered Title) -->
                    <div style="display:grid; grid-template-columns: 44px 1fr 44px; align-items:center; width:100%; padding-bottom: 10px; border-bottom: 1px solid #e5e7eb; margin-bottom: 10px;">

                        <!-- Left: Back Button -->
                        <div style="display:flex; justify-content:flex-start;">
                             <button id="details-close-btn" class="action-button" style="${backBtnStyle}">${ICONS.arrowLeft}</button>
                        </div>

                        <!-- Center: Title -->
                        <div class="title-names" style="text-align:center; overflow:hidden;">
                             <h2 id="mobile-title-fr" class="editable-text" style="margin:0; font-size:18px; font-weight:700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeXml(poiName)}</h2>
                             <h2 id="mobile-title-ar" style="display:none; margin:0; font-size:18px; font-weight:700; text-align:center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" dir="rtl">${escapeXml(arName)}</h2>
                        </div>

                        <!-- Right: Empty Placeholder (for balance) -->
                        <div style="display:flex; justify-content:flex-end;">
                             <!-- Reserved space -->
                        </div>
                    </div>

                    <!-- ROW 2: Toolbar -->
                    <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                         <!-- Left: Tools -->
                         <div style="display:flex; gap:6px; align-items:center;">
                             <button class="action-button" id="mobile-btn-toggle-lang" title="Arabe" ${hasAr ? '' : 'disabled'} style="${mobileBtnStyle} ${hasAr ? '' : 'opacity:0.5;'}">${ICONS.languages}</button>
                             <button class="action-button" id="mobile-btn-toggle-gpx-desc" title="GPX Desc" style="${mobileBtnStyle}">${ICONS.fileText}</button>
                             <button class="action-button btn-web-search" id="btn-web-search" title="Google" style="${mobileBtnStyle}">${ICONS.globe}</button>
                             ${mobileGmapsBtn}
                             <button class="action-button" id="btn-global-edit" title="Editer" style="${mobileBtnStyle}">${ICONS.pen}</button>
                             <button class="action-button" id="btn-soft-delete" title="Supprimer" style="${mobileBtnStyle} color: var(--danger);">${ICONS.trash}</button>
                         </div>

                         <!-- Right: Navigation -->
                         <div style="display:flex; gap:6px; align-items:center;">
                             <button id="details-prev-btn" data-direction="-1" ${(!inCircuit || circuitIndex === 0) ? 'disabled' : ''} style="${mobileBtnStyle}">${ICONS.chevronLeft}</button>
                             <button id="details-next-btn" data-direction="1" ${(!inCircuit || circuitIndex === state.currentCircuit.length - 1) ? 'disabled' : ''} style="${mobileBtnStyle}">${ICONS.chevronRight}</button>
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
                    <p class="editable-text short-text" style="height:auto; min-height:24px; max-height:none; overflow:visible; display:block; white-space:normal !important; text-overflow:clip; -webkit-line-clamp:unset;">${escapeXml(allProps.Description_courte || allProps.Desc_wpt || '')}</p>
                </div>
            </div>
            <div class="detail-section editable-field description-section" data-field-id="description">
                <h3 style="display:flex; justify-content:space-between; align-items:center;">
                    <span>Description</span>
                    <button class="action-button speak-btn" title="Lire la description" style="margin:0;">${ICONS.volume}</button>
                </h3>
                <div class="content">
                    <div class="description-content editable-text" style="max-height:200px; overflow-y:auto;">${(allProps.description || allProps.Description || '').replace(/\n/g, '<br>')}</div>
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
                    <div class="description-content editable-text">${(allProps.notes || '').replace(/\n/g, '<br>')}</div>
                </div>
            </div>
            <div class="detail-section photos-section">
                <h3>Photos (${photos.length})
                    ${photos.length > 0 ? `
                    <div class="edit-controls section-controls">
                        <button class="action-button" id="btn-delete-all-photos" title="Tout supprimer" style="color: var(--danger);">${ICONS.trash}</button>
                    </div>` : ''}
                </h3>
                <div class="content">
                    <div class="photos-grid-scroller">
                        ${photosHtml}
                        <div class="photo-placeholder" title="Ajouter une photo">${ICONS.imagePlus}</div>
                    </div>
                    <input type="file" id="panel-photo-input" accept="image/*" multiple style="display: none;">
                </div>
            </div>
        </div>`;

    return isMobileView() ? mobileHtml : pcHtml;
}
