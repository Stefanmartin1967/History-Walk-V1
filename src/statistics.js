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

export const RANKS = [
    { min: 100, title: "Expert Local", icon: "trophy", color: "#F59E0B" },
    { min: 75, title: "Guide Émérite", icon: "medal", color: "#10B981" },
    { min: 50, title: "Grand Explorateur", icon: "compass", color: "#3B82F6" },
    { min: 25, title: "Voyageur Curieux", icon: "map", color: "#8B5CF6" },
    { min: 1, title: "Promeneur", icon: "footprints", color: "#6B7280" },
    { min: 0, title: "Nouvel Arrivant", icon: "baby", color: "#9CA3AF" }
];

function getRank(percent) {
    return RANKS.find(r => percent >= r.min) || RANKS[RANKS.length - 1];
}

function getNextRank(percent) {
    // On cherche le premier rang dont le min est strictement supérieur au pourcentage actuel
    // Le tableau RANKS est trié décroissant (100 -> 0)
    // Donc on doit inverser ou chercher intelligemment
    const reversed = [...RANKS].reverse(); // 0 -> 100
    return reversed.find(r => r.min > percent);
}

export async function showStatisticsModal() {
    const stats = calculateStats();
    const nextRank = getNextRank(stats.poiPercent);

    // Calcul de la progression vers le prochain rang
    // Ex: Actuel 15%. Prochain 25%. Précédent 0%.
    // Progression relative : (15 - 0) / (25 - 0) = 60% de la barre
    let progressPercent = 0;
    if (nextRank) {
        const currentRank = getRank(stats.poiPercent);
        const range = nextRank.min - currentRank.min;
        const value = stats.poiPercent - currentRank.min;
        progressPercent = Math.max(5, Math.min(100, (value / range) * 100)); // Min 5% pour visibilité
    } else {
        progressPercent = 100; // Niveau Max atteint
    }

    const html = `
        <div style="display:flex; flex-direction:column; gap:16px; text-align:center;">

            <!-- RANK BADGE (Compact & Design) -->
            <div style="background: linear-gradient(135deg, ${stats.rank.color}15, ${stats.rank.color}05); padding: 20px; border-radius: 20px; position: relative; overflow: hidden; border: 1px solid ${stats.rank.color}30;">

                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px;">
                    <div style="text-align: left;">
                        <div style="font-size: 11px; text-transform: uppercase; color: var(--ink-soft); letter-spacing: 1px; font-weight: 600;">Votre Rang</div>
                        <div style="font-size: 22px; font-weight: 800; color: var(--ink); margin-top: 2px;">${stats.rank.title}</div>
                    </div>
                    <div style="background: white; width: 56px; height: 56px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px ${stats.rank.color}40;">
                        <i data-lucide="${stats.rank.icon}" style="width: 28px; height: 28px; color: ${stats.rank.color};"></i>
                    </div>
                </div>

                <!-- PROGRESS BAR -->
                <div style="background: rgba(0,0,0,0.05); height: 6px; border-radius: 3px; width: 100%; position: relative; margin-bottom: 8px;">
                    <div style="background: ${stats.rank.color}; width: ${progressPercent}%; height: 100%; border-radius: 3px; transition: width 1s ease;"></div>
                </div>

                <div style="display: flex; justify-content: space-between; font-size: 11px; font-weight: 500;">
                    <span style="color: var(--ink);">${stats.poiPercent}% exploré</span>
                    <span style="color: var(--ink-soft);">${nextRank ? 'Prochain : ' + nextRank.title : 'Niveau Max !'}</span>
                </div>
            </div>

            <!-- STATS GRID (Cleaner) -->
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px;">

                <div class="stat-card" style="background: var(--surface-muted); padding: 15px 10px; border-radius: 12px; display: flex; flex-direction: column; align-items: center;">
                    <div style="font-size: 20px; font-weight: 700; color: var(--ink);">${stats.visitedPois}<span style="font-size: 12px; opacity: 0.6;">/${stats.totalPois}</span></div>
                    <div style="font-size: 10px; text-transform: uppercase; color: var(--ink-soft); font-weight: 600; margin-top: 4px;">Lieux</div>
                </div>

                <div class="stat-card" style="background: var(--surface-muted); padding: 15px 10px; border-radius: 12px; display: flex; flex-direction: column; align-items: center;">
                    <div style="font-size: 20px; font-weight: 700; color: var(--ink);">${stats.totalKm}</div>
                    <div style="font-size: 10px; text-transform: uppercase; color: var(--ink-soft); font-weight: 600; margin-top: 4px;">Km</div>
                </div>

                <div class="stat-card" style="background: var(--surface-muted); padding: 15px 10px; border-radius: 12px; display: flex; flex-direction: column; align-items: center;">
                    <div style="font-size: 20px; font-weight: 700; color: var(--ink);">${stats.completedCircuits}<span style="font-size: 12px; opacity: 0.6;">/${stats.totalCircuits}</span></div>
                    <div style="font-size: 10px; text-transform: uppercase; color: var(--ink-soft); font-weight: 600; margin-top: 4px;">Circuits</div>
                </div>

            </div>

            <div style="height: 1px; background: var(--line); margin: 5px 20px;"></div>

            <p style="font-size: 12px; color: var(--ink-soft); font-style: italic;">
                Continuez d'explorer pour débloquer le prochain rang !
            </p>

        </div>
    `;

    await showAlert("Mon Carnet de Voyage", html, "Génial !");

    // Refresh icons inside the modal (since they are dynamic HTML)
    const modalContent = document.getElementById('custom-modal-message');
    if (modalContent) {
        createIcons({ icons, root: modalContent });
    }
}
