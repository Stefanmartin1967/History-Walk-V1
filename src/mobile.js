// mobile.js — Barrel de compatibilité
// Re-exporte toutes les APIs publiques des sous-modules mobile.
// Les 11 fichiers qui importent de './mobile.js' n'ont pas besoin de changer.

export { isMobileView, initMobileMode, switchMobileView, renderMobileSearch } from './mobile-nav.js';
export { renderMobileCircuitsList } from './mobile-circuits.js';
export { renderMobilePoiList, updatePoiPosition } from './mobile-poi.js';
export { renderMobileMenu } from './mobile-menu.js';
