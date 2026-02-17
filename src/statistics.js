import { state } from './state.js';
import { getRealDistance, getOrthodromicDistance } from './map.js';
import { getPoiId } from './data.js';
import { showAlert } from './modal.js';
import { createIcons, icons } from 'lucide';

export function calculateStats() {
    // 1. POIs Visités
    const totalPois = state.loadedFeatures.length;
    let visitedPois = 0;

    // On parcourt tous les POIs chargés
    state.loadedFeatures.forEach(feature => {
        const id = getPoiId(feature);
        if (state.userData[id] && state.userData[id].vu) {
            visitedPois++;
        }
    });

    const poiPercent = totalPois > 0 ? Math.round((visitedPois / totalPois) * 100) : 0;

    // 2. Circuits Terminés & Distance
    let completedCircuits = 0;
    let totalCircuits = 0;
    let totalDistanceMeters = 0;

    // A. Circuits Officiels
    const officialCircuits = state.officialCircuits || [];
    officialCircuits.forEach(c => {
        totalCircuits++;
        // Check completion in status map
        if (state.officialCircuitsStatus[String(c.id)]) {
            completedCircuits++;
            totalDistanceMeters += getCircuitDistance(c);
        }
    });

    // B. Circuits Locaux (non supprimés, et qui ne sont pas des shadows d'officiels)
    const localCircuits = (state.myCircuits || []).filter(c => {
        if (c.isDeleted) return false;
        // Si c'est un shadow d'un officiel, on l'a déjà compté dans la boucle A via le status map
        const isShadow = officialCircuits.some(off => String(off.id) === String(c.id));
        return !isShadow;
    });

    localCircuits.forEach(c => {
        totalCircuits++;
        if (c.isCompleted) {
            completedCircuits++;
            totalDistanceMeters += getCircuitDistance(c);
        }
    });

    const totalKm = (totalDistanceMeters / 1000).toFixed(1);

    // 3. Rang
    const rank = getRank(poiPercent);

    return {
        visitedPois,
        totalPois,
        poiPercent,
        completedCircuits,
        totalCircuits,
        totalKm,
        rank
    };
}

function getCircuitDistance(circuit) {
    if (circuit.realTrack && circuit.realTrack.length > 0) {
        return getRealDistance(circuit);
    }

    // Fallback : Orthodromic distance based on POIs
    const circuitFeatures = (circuit.poiIds || [])
        .map(id => state.loadedFeatures.find(f => getPoiId(f) === id))
        .filter(Boolean);

    return getOrthodromicDistance(circuitFeatures);
}

function getRank(percent) {
    if (percent >= 100) return { title: "Expert Local", icon: "trophy", color: "#F59E0B" }; // Gold
    if (percent >= 75) return { title: "Guide Émérite", icon: "medal", color: "#10B981" }; // Green
    if (percent >= 50) return { title: "Grand Explorateur", icon: "compass", color: "#3B82F6" }; // Blue
    if (percent >= 25) return { title: "Voyageur Curieux", icon: "map", color: "#8B5CF6" }; // Purple
    if (percent > 0) return { title: "Promeneur", icon: "footprints", color: "#6B7280" }; // Grey
    return { title: "Nouvel Arrivant", icon: "baby", color: "#9CA3AF" };
}

export async function showStatisticsModal() {
    const stats = calculateStats();

    // OPTIMISATION UI : Layout plus compact, Horizontal, et Coloré
    const html = `
        <div style="display:flex; flex-direction:column; gap:12px; text-align:center;">

            <!-- RANK BADGE (Horizontal & Compact) -->
            <div style="background: ${stats.rank.color}15; padding: 12px 16px; border-radius: 12px; border: 1px solid ${stats.rank.color}; display: flex; align-items: center; gap: 16px; text-align: left;">
                <div style="color: ${stats.rank.color}; background: #fff; border-radius: 50%; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                    <i data-lucide="${stats.rank.icon}" style="width:28px; height:28px;"></i>
                </div>
                <div style="flex-grow: 1;">
                    <div style="font-size: 11px; text-transform: uppercase; color: var(--ink-soft); letter-spacing: 0.5px; margin-bottom: 2px;">Votre Rang</div>
                    <div style="font-size: 18px; font-weight: 800; color: var(--ink); line-height: 1.2;">
                        ${stats.rank.title}
                    </div>
                    <div style="font-size: 13px; color: var(--ink-soft); margin-top: 2px;">
                        ${stats.poiPercent}% de l'île explorée
                    </div>
                </div>
            </div>

            <!-- GRID STATS (3 Columns for better space usage) -->
            <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:8px;">
                <!-- POIS -->
                <div style="background:var(--surface-muted); padding:10px; border-radius:10px; display:flex; flex-direction:column; align-items:center; justify-content:center;">
                    <div style="color:var(--brand); margin-bottom:4px;">
                        <i data-lucide="map-pin" style="width:20px; height:20px;"></i>
                    </div>
                    <div style="font-size:18px; font-weight: 700; color:var(--ink);">
                        ${stats.visitedPois}<span style="font-size:12px; font-weight:400; color:var(--ink-soft);">/${stats.totalPois}</span>
                    </div>
                    <div style="font-size:10px; color:var(--ink-soft); text-transform:uppercase; margin-top:2px;">Lieux</div>
                </div>

                <!-- KM -->
                <div style="background:var(--surface-muted); padding:10px; border-radius:10px; display:flex; flex-direction:column; align-items:center; justify-content:center;">
                    <div style="color:var(--warn); margin-bottom:4px;">
                        <i data-lucide="footprints" style="width:20px; height:20px;"></i>
                    </div>
                    <div style="font-size:18px; font-weight: 700; color:var(--ink);">
                        ${stats.totalKm}
                    </div>
                    <div style="font-size:10px; color:var(--ink-soft); text-transform:uppercase; margin-top:2px;">Km</div>
                </div>

                <!-- CIRCUITS -->
                <div style="background:var(--surface-muted); padding:10px; border-radius:10px; display:flex; flex-direction:column; align-items:center; justify-content:center;">
                    <div style="color:var(--ok); margin-bottom:4px;">
                        <i data-lucide="route" style="width:20px; height:20px;"></i>
                    </div>
                    <div style="font-size:18px; font-weight: 700; color:var(--ink);">
                        ${stats.completedCircuits}<span style="font-size:12px; font-weight:400; color:var(--ink-soft);">/${stats.totalCircuits}</span>
                    </div>
                    <div style="font-size:10px; color:var(--ink-soft); text-transform:uppercase; margin-top:2px;">Circuits</div>
                </div>
            </div>

             <!-- PROGRESS BAR (Visual Feedback) -->
            <div style="background: var(--line); height: 8px; border-radius: 4px; overflow: hidden; margin-top: 4px;">
                <div style="width: ${stats.poiPercent}%; background: ${stats.rank.color}; height: 100%;"></div>
            </div>

            <div style="font-size: 11px; color: var(--ink-soft); font-style: italic;">
                Continuez d'explorer pour débloquer le prochain rang !
            </div>

        </div>
    `;

    await showAlert("Mon Carnet de Voyage", html, "Génial !");

    // Refresh icons inside the modal (since they are dynamic HTML)
    const modalContent = document.getElementById('custom-modal-message');
    if (modalContent) {
        createIcons({ icons, root: modalContent });
    }
}
