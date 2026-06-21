// destination-switch.js
// Bascule de la destination active — helper PARTAGÉ par le sélecteur PC (topbar-v2)
// et le sélecteur mobile (mobile-destinations). Une seule source de vérité.
//
// Mécanique (inchangée vs l'historique topbar) : on synchronise `hw_active_dest`
// (clé lue AUSSI par le Data Manager pour rester aligné) puis on RECHARGE la page
// avec `?map={id}` — au boot, tout l'état par destination (POI, circuits, userData,
// zones, rejets Scout) est rechargé par `mapId`, d'où le reload obligatoire (pas de
// bascule in-place). Le garde non-admin du boot empêche un visiteur d'atterrir sur
// un brouillon.
export function switchActiveDestination(id) {
    if (!id) return;
    try { localStorage.setItem('hw_active_dest', id); } catch (e) { /* stockage indispo : on bascule quand même via l'URL */ }
    const url = new URL(window.location.href);
    url.searchParams.set('map', id);
    window.location.href = url.toString();
}
