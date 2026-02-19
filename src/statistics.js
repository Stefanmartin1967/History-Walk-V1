import { state } from './state.js';
import { getRealDistance, getOrthodromicDistance } from './map.js';
import { getPoiId } from './data.js';
import { showAlert } from './modal.js';
import { createIcons, icons } from 'lucide';

// --- DEFINITIONS DES RANGS & BADGES ---

export const POI_RANKS = [
    { min: 100, title: "Légende Locale", icon: "crown", color: "#F59E0B" }, // Or
    { min: 80, title: "Guide Émérite", icon: "medal", color: "#10B981" }, // Vert
    { min: 60, title: "Grand Explorateur", icon: "compass", color: "#3B82F6" }, // Bleu
    { min: 45, title: "Explorateur Urbain", icon: "map-pin", color: "#8B5CF6" }, // Violet
    { min: 30, title: "Voyageur Curieux", icon: "map", color: "#EC4899" }, // Rose
    { min: 15, title: "Promeneur", icon: "footprints", color: "#6B7280" }, // Gris foncé
    { min: 5, title: "Curieux de Quartier", icon: "search", color: "#9CA3AF" }, // Gris moyen
    { min: 0, title: "Nouvel Arrivant", icon: "baby", color: "#D1D5DB" } // Gris clair
];

export const KM_RANKS = [
    { min: 500, title: "Marathonien", color: "#EF4444" }, // Rouge
    { min: 250, title: "Grand Voyageur", color: "#F97316" }, // Orange
    { min: 100, title: "Randonneur", color: "#F59E0B" }, // Jaune
    { min: 50, title: "Marcheur", color: "#10B981" }, // Vert
    { min: 10, title: "Petit pas", color: "#3B82F6" }, // Bleu
    { min: 0, title: "Débutant", color: "#9CA3AF" } // Gris
];

export const CIRCUIT_BADGES = [
    { min: 30, title: "Maître des Parcours", id: "platinum", color: "#E5E4E2", label: "Platine" },
    { min: 15, title: "Expert des Sentiers", id: "gold", color: "#FFD700", label: "Or" },
    { min: 5, title: "Habitué", id: "silver", color: "#C0C0C0", label: "Argent" },
    { min: 1, title: "Initié", id: "bronze", color: "#CD7F32", label: "Bronze" }
];

export function calculateStats() {
    // 1. POIs Visités
    const totalPois = state.loadedFeatures.length;
    let visitedPois = 0;

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
        if (state.officialCircuitsStatus[String(c.id)]) {
            completedCircuits++;
            totalDistanceMeters += getCircuitDistance(c);
        }
    });

    // B. Circuits Locaux
    const localCircuits = (state.myCircuits || []).filter(c => {
        if (c.isDeleted) return false;
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

    const totalKm = parseFloat((totalDistanceMeters / 1000).toFixed(1));

    // 3. Calculs de Progression
    const poiRank = getRank(POI_RANKS, poiPercent);
    const nextPoiRank = getNextRank(POI_RANKS, poiPercent);
    const kmRank = getRank(KM_RANKS, totalKm);
    const nextKmRank = getNextRank(KM_RANKS, totalKm);

    return {
        visitedPois,
        totalPois,
        poiPercent,
        completedCircuits,
        totalCircuits,
        totalKm,
        poiRank,
        nextPoiRank,
        kmRank,
        nextKmRank,
        earnedBadges: getEarnedBadges(completedCircuits)
    };
}

function getCircuitDistance(circuit) {
    if (circuit.realTrack && circuit.realTrack.length > 0) {
        return getRealDistance(circuit);
    }
    const circuitFeatures = (circuit.poiIds || [])
        .map(id => state.loadedFeatures.find(f => getPoiId(f) === id))
        .filter(Boolean);
    return getOrthodromicDistance(circuitFeatures);
}

function getRank(rankList, value) {
    return rankList.find(r => value >= r.min) || rankList[rankList.length - 1];
}

function getNextRank(rankList, value) {
    const reversed = [...rankList].reverse();
    return reversed.find(r => r.min > value);
}

function getEarnedBadges(count) {
    // Retourne la liste des badges avec leur état (acquis ou non)
    // On veut afficher tous les badges (gris vs coloré)
    return CIRCUIT_BADGES.slice().reverse().map(badge => ({
        ...badge,
        earned: count >= badge.min
    }));
}

// --- AFFICHAGE MODALE ---

export async function showStatisticsModal() {
    const stats = calculateStats();

    // Calcul Progression POI (Barre Bleue)
    let poiProgress = 0;
    let poiNextVal = 100; // Default max
    let poiPrevVal = 0;

    if (stats.nextPoiRank) {
        poiNextVal = stats.nextPoiRank.min;
        poiPrevVal = stats.poiRank.min;
        // % dans le rang actuel
        const range = poiNextVal - poiPrevVal;
        const relative = stats.poiPercent - poiPrevVal;
        poiProgress = Math.min(100, Math.max(5, (relative / range) * 100));
    } else {
        poiProgress = 100;
    }

    // Calcul de la valeur absolue restante (approx) pour POI
    // nextRank.min est un %, on veut le nombre de POI
    // n = (min / 100) * total
    const remainingPois = stats.nextPoiRank
        ? Math.ceil((stats.nextPoiRank.min / 100) * stats.totalPois) - stats.visitedPois
        : 0;

    // Calcul Progression KM (Barre Verte)
    let kmProgress = 0;
    let kmNextVal = 500;
    let kmPrevVal = 0;

    if (stats.nextKmRank) {
        kmNextVal = stats.nextKmRank.min;
        kmPrevVal = stats.kmRank.min;
        const range = kmNextVal - kmPrevVal;
        const relative = stats.totalKm - kmPrevVal;
        kmProgress = Math.min(100, Math.max(5, (relative / range) * 100));
    } else {
        kmProgress = 100;
    }

    const html = `
        <div class="gamification-container">

            <!-- SECTION RANG ACTUEL -->
            <div class="rank-header">
                <div class="rank-icon-wrapper" style="box-shadow: 0 0 20px ${stats.poiRank.color}40;">
                    <i data-lucide="${stats.poiRank.icon}" style="color: ${stats.poiRank.color}; width: 40px; height: 40px;"></i>
                </div>
                <div class="rank-info">
                    <div class="rank-label">VOTRE RANG</div>
                    <div class="rank-title">${stats.poiRank.title}</div>
                </div>
            </div>

            <!-- PROGRESSION LIEUX -->
            <div class="progress-section">
                <div class="progress-labels">
                    <span class="progress-title">Exploration (${stats.poiPercent}%)</span>
                    <span class="progress-next">${stats.nextPoiRank ? `Prochain : ${stats.nextPoiRank.title}` : 'Sommet atteint !'}</span>
                </div>
                <div class="progress-track">
                    <div class="progress-fill poi-fill" style="width: ${poiProgress}%; background: ${stats.poiRank.color};"></div>
                </div>
                <div class="progress-sub">
                    ${stats.nextPoiRank
                        ? `<span class="progress-left">Encore <strong>${remainingPois} lieux</strong></span>`
                        : '<span>Félicitations !</span>'}
                </div>
            </div>

            <!-- PROGRESSION KM -->
            <div class="progress-section">
                <div class="progress-labels">
                    <span class="progress-title">Distance (${stats.totalKm} km)</span>
                    <span class="progress-next">${stats.nextKmRank ? `Objectif : ${stats.nextKmRank.title}` : 'Objectif Ultime !'}</span>
                </div>
                <div class="progress-track">
                    <div class="progress-fill km-fill" style="width: ${kmProgress}%; background: #10B981;"></div>
                </div>
                <div class="progress-sub">
                     ${stats.nextKmRank
                        ? `<span class="progress-left">Encore <strong>${(stats.nextKmRank.min - stats.totalKm).toFixed(1)} km</strong></span>`
                        : '<span>Tour du monde ?!</span>'}
                </div>
            </div>

            <div class="separator-line"></div>

            <!-- STATS & BADGES -->
            <div class="stats-grid">
                <div class="stat-item">
                    <div class="stat-value">${stats.visitedPois}<span class="stat-total">/${stats.totalPois}</span></div>
                    <div class="stat-label">Lieux</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${stats.totalKm}</div>
                    <div class="stat-label">Km</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${stats.completedCircuits}</div>
                    <div class="stat-label">Circuits</div>
                </div>
            </div>

            <div class="badges-section">
                <div class="badges-title">Collection de Badges</div>
                <div class="badges-row">
                    ${stats.earnedBadges.map(b => `
                        <div class="badge-item ${b.earned ? 'earned' : 'locked'}" title="${b.title} (${b.min} circuits)">
                            <div class="badge-circle" style="${b.earned ? `background: ${b.color}; border-color: ${b.color};` : ''}">
                                ${b.earned
                                    ? `<i data-lucide="award" style="color: white; fill: rgba(255,255,255,0.2);"></i>`
                                    : `<i data-lucide="lock" style="color: #cbd5e1;"></i>`}
                            </div>
                            <span class="badge-label">${b.label}</span>
                        </div>
                    `).join('')}
                </div>
            </div>

            <p class="gamification-footer">
                Continuez d'explorer pour débloquer le prochain rang !
            </p>
        </div>
    `;

    // Utilisation de la classe CSS personnalisée 'gamification-modal'
    await showAlert("Mon Carnet de Voyage", html, "Génial !", "gamification-modal");

    const modalContent = document.getElementById('custom-modal-message');
    if (modalContent) {
        createIcons({ icons, root: modalContent });
    }
}
