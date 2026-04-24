// poi-icons.js — module feuille (zéro dépendance)
// Icônes HTML pour catégories POI, utilisé par map.js + mobile-nav.js + mobile-poi.js.
// Extrait de map.js (session 24/04) pour casser les edges mobile-nav → map et mobile-poi → map.

// Icônes MDI (Material Design Icons) — style filled, viewBox 0 0 24 24
const ICON_MDI = (path) => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">${path}</svg>`;

const ICON_MOSQUE_SVG       = ICON_MDI('<path d="M24 7C24 5.9 22 4 22 4S20 5.9 20 7C20 7.7 20.4 8.4 21 8.7V13H19V11C19 10.1 18.3 9.3 17.5 9.1C17.8 8.5 18 7.9 18 7.1C18 5.8 17.4 4.6 16.3 3.9L12 1L7.7 3.8C6.7 4.6 6 5.8 6 7.1C6 7.8 6.2 8.5 6.6 9.1C5.7 9.3 5 10.1 5 11V13H3V8.7C3.6 8.4 4 7.7 4 7C4 5.9 2 4 2 4S0 5.9 0 7C0 7.7 .4 8.4 1 8.7V21H11V17C11 16.5 11.4 16 12 16S13 16.5 13 17V21H23V8.7C23.6 8.4 24 7.7 24 7M8.9 5.5L12 3.4L15.1 5.5C15.7 5.9 16 6.4 16 7.1C16 8.1 15.1 9 14.1 9H9.9C8.9 9 8 8.1 8 7.1C8 6.4 8.3 5.9 8.9 5.5M21 19H15V17C15 15.4 13.6 14 12 14S9 15.4 9 17V19H3V15H7V11H17V15H21V19Z" />');
const ICON_PRAY_SVG         = ICON_MDI('<path d="M11.43 9.67C11.47 9.78 11.5 9.88 11.5 10V15.22C11.5 15.72 11.31 16.2 10.97 16.57L8.18 19.62L4.78 16.22L6 15L8.8 2.86C8.92 2.36 9.37 2 9.89 2C10.5 2 11 2.5 11 3.11V8.07C10.84 8.03 10.67 8 10.5 8C9.4 8 8.5 8.9 8.5 10V13C8.5 13.28 8.72 13.5 9 13.5S9.5 13.28 9.5 13V10C9.5 9.45 9.95 9 10.5 9C10.69 9 10.85 9.07 11 9.16C11.12 9.23 11.21 9.32 11.3 9.42C11.33 9.46 11.36 9.5 11.38 9.55C11.4 9.59 11.42 9.63 11.43 9.67M2 19L6 22L7.17 20.73L3.72 17.28L2 19M18 15L15.2 2.86C15.08 2.36 14.63 2 14.11 2C13.5 2 13 2.5 13 3.11V8.07C13.16 8.03 13.33 8 13.5 8C14.6 8 15.5 8.9 15.5 10V13C15.5 13.28 15.28 13.5 15 13.5S14.5 13.28 14.5 13V10C14.5 9.45 14.05 9 13.5 9C13.31 9 13.15 9.07 13 9.16C12.88 9.23 12.79 9.32 12.71 9.42C12.68 9.46 12.64 9.5 12.62 9.55C12.6 9.59 12.58 9.63 12.57 9.67C12.53 9.78 12.5 9.88 12.5 10V15.22C12.5 15.72 12.69 16.2 13.03 16.57L15.82 19.62L19.22 16.22L18 15M20.28 17.28L16.83 20.73L18 22L22 19L20.28 17.28Z" />');
const ICON_COFFEE_SVG       = ICON_MDI('<path d="M2,21V19H20V21H2M20,8V5H18V8H20M20,3A2,2 0 0,1 22,5V8A2,2 0 0,1 20,10H18V13A4,4 0 0,1 14,17H8A4,4 0 0,1 4,13V3H20M16,5H6V13A2,2 0 0,0 8,15H14A2,2 0 0,0 16,13V5Z" />');
const ICON_TEA_SVG          = ICON_MDI('<path d="M4,19H20V21H4V19M21.4,3.6C21,3.2 20.6,3 20,3H4V13C4,14.1 4.4,15 5.2,15.8C6,16.6 6.9,17 8,17H14C15.1,17 16,16.6 16.8,15.8C17.6,15 18,14.1 18,13V10H20C20.6,10 21,9.8 21.4,9.4C21.8,9 22,8.6 22,8V5C22,4.5 21.8,4 21.4,3.6M16,5V8L16,10V13C16,13.6 15.8,14 15.4,14.4C15,14.8 14.6,15 14,15H8C7.4,15 7,14.8 6.6,14.4C6.2,14 6,13.5 6,13V5H10V6.4L8.2,7.8C8,7.9 8,8.1 8,8.2V12.5C8,12.8 8.2,13 8.5,13H12.5C12.8,13 13,12.8 13,12.5V8.2C13,8 12.9,7.9 12.8,7.8L11,6.4V5H16M20,8H18V5H20V8Z" />');
const ICON_WATER_WELL_SVG   = ICON_MDI('<path d="M3.62 8H5V15H7V8H11V10H13V8H17V15H19V8H20.61C21.16 8 21.61 7.56 21.61 7C21.61 6.89 21.6 6.78 21.56 6.68L19 2H5L2.72 6.55C2.47 7.04 2.67 7.64 3.16 7.89C3.31 7.96 3.46 8 3.62 8M6.24 4H17.76L18.76 6H5.24L6.24 4M2 16V18H4V22H20V18H22V16H2M18 20H6V18H18V20M13.93 11C14.21 11 14.43 11.22 14.43 11.5C14.43 11.5 14.43 11.54 14.43 11.56L14.05 14.56C14 14.81 13.81 15 13.56 15H10.44C10.19 15 10 14.81 9.95 14.56L9.57 11.56C9.54 11.29 9.73 11.04 10 11C10.03 11 10.05 11 10.07 11H13.93Z" />');
const ICON_CAKE_SVG         = ICON_MDI('<path d="M12 6C13.11 6 14 5.1 14 4C14 3.62 13.9 3.27 13.71 2.97L12 0L10.29 2.97C10.1 3.27 10 3.62 10 4C10 5.1 10.9 6 12 6M18 9H13V7H11V9H6C4.34 9 3 10.34 3 12V21C3 21.55 3.45 22 4 22H20C20.55 22 21 21.55 21 21V12C21 10.34 19.66 9 18 9M19 20H5V17C5.9 17 6.76 16.63 7.4 16L8.5 14.92L9.56 16C10.87 17.3 13.15 17.29 14.45 16L15.53 14.92L16.6 16C17.24 16.63 18.1 17 19 17V20M19 15.5C18.5 15.5 18 15.3 17.65 14.93L15.5 12.8L13.38 14.93C12.64 15.67 11.35 15.67 10.61 14.93L8.5 12.8L6.34 14.93C6 15.29 5.5 15.5 5 15.5V12C5 11.45 5.45 11 6 11H18C18.55 11 19 11.45 19 12V15.5Z" />');
const ICON_STORE_SVG        = ICON_MDI('<path d="M18.36 9L18.96 12H5.04L5.64 9H18.36M20 4H4V6H20V4M20 7H4L3 12V14H4V20H14V14H18V20H20V14H21V12L20 7M6 18V14H12V18H6Z" />');
const ICON_RESTAURANT_SVG   = ICON_MDI('<path d="M11,9H9V2H7V9H5V2H3V9C3,11.12 4.66,12.84 6.75,12.97V22H9.25V12.97C11.34,12.84 13,11.12 13,9V2H11V9M16,6V14H18.5V22H21V2C18.24,2 16,4.24 16,6Z" />');
const ICON_PILLAR_SVG       = ICON_MDI('<path d="M6,5H18A1,1 0 0,1 19,6A1,1 0 0,1 18,7H6A1,1 0 0,1 5,6A1,1 0 0,1 6,5M21,2V4H3V2H21M15,8H17V22H15V8M7,8H9V22H7V8M11,8H13V22H11V8Z" />');
const ICON_BINOCULARS_SVG   = ICON_MDI('<path d="M11,6H13V13H11V6M9,20A1,1 0 0,1 8,21H5A1,1 0 0,1 4,20V15L6,6H10V13A1,1 0 0,1 9,14V20M10,5H7V3H10V5M15,20V14A1,1 0 0,1 14,13V6H18L20,15V20A1,1 0 0,1 19,21H16A1,1 0 0,1 15,20M14,5V3H17V5H14Z" />');

// Icône SVG personnalisée Lucide (style outline) — conservée pour Culture et tradition
const ICON_AMPHORA_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2v5.632c0 .424-.272.795-.653.982A6 6 0 0 0 6 14c.006 4 3 7 5 8"/><path d="M10 5H8a2 2 0 0 0 0 4h.68"/><path d="M14 2v5.632c0 .424.272.795.652.982A6 6 0 0 1 18 14c0 4-3 7-5 8"/><path d="M14 5h2a2 2 0 0 1 0 4h-.68"/><path d="M18 22H6"/><path d="M9 2h6"/></svg>';

export const iconMap = {
    'A définir':           'circle-help',
    'Café':                ICON_COFFEE_SVG,
    'Commerce':            ICON_STORE_SVG,
    'Culture et tradition': ICON_AMPHORA_SVG,
    'Curiosité':           ICON_BINOCULARS_SVG,
    'Hôtel':               'hotel',
    'Mosquée':             ICON_MOSQUE_SVG,
    'Pâtisserie':          ICON_CAKE_SVG,
    'Photo':               'camera',
    'Puits':               ICON_WATER_WELL_SVG,
    'Restaurant':          ICON_RESTAURANT_SVG,
    'Salon de thé':        ICON_TEA_SVG,
    'Site historique':     ICON_PILLAR_SVG,
    'Site religieux':      ICON_PRAY_SVG,
    'Taxi':                'car-taxi-front'
};

export function getIconHtml(category) {
    const defaultIcon = 'map-pin';
    const iconContent = iconMap[category] || defaultIcon;

    if (iconContent.startsWith('<svg')) {
        return iconContent;
    } else {
        return `<i data-lucide="${iconContent}"></i>`;
    }
}

export function getIconForFeature(feature) {
    const category = (feature.properties.userData && feature.properties.userData.Catégorie) || feature.properties.Catégorie;
    return getIconHtml(category);
}
