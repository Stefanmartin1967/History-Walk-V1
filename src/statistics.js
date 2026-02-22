import { state } from './state.js';
import { getRealDistance, getOrthodromicDistance } from './map.js';
import { getPoiId } from './data.js';
import { showAlert } from './modal.js';
import { createIcons, icons } from 'lucide';

// --- 0. RANGS GLOBAUX (Basé sur XP Total) ---
// XP = (UserDistance / TotalOfficialDistance * 10000) + (UserCircuits / TotalOfficialCircuits * 10000)
// Max XP = 20 000
export const GLOBAL_RANKS = [
    { min: 20000, title: "Lueur d'Éternité" },
    { min: 17000, title: "Souffle Céleste" },
    { min: 13500, title: "Sagesse des Sables" },
    { min: 10000, title: "Regard d'Horizon" },
    { min: 7000, title: "Sillage d'Argent" },
    { min: 4500, title: "Âme Vagabonde" },
    { min: 2500, title: "Cœur Vaillant" },
    { min: 1200, title: "Esprit Curieux" },
    { min: 500, title: "Petite Étincelle" },
    { min: 0, title: "Premier Souffle" }
];

// --- 1. LES ANIMAUX (Basé sur % Distance Officielle) ---
// 10 Paliers de 10%
export const ANIMAL_RANKS = [
    { min: 90, title: "Phénix", icon: "flame", description: "Légendaire" },
    { min: 80, title: "Aigle Royal", icon: "bird", description: "Vue d'ensemble sur l'île" },
    { min: 70, title: "Ours Polaire", icon: "snowflake", description: "Un marcheur confirmé" },
    { min: 60, title: "Grand Cerf", icon: "crown", description: "Majestueux" },
    { min: 50, title: "Loup", icon: "paw-print", description: "L'endurance s'installe" },
    { min: 40, title: "Chamois", icon: "mountain", description: "On grimpe en compétence" },
    { min: 30, title: "Lynx", icon: "eye", description: "L'agilité augmente" },
    { min: 20, title: "Renard", icon: "dog", description: "On sort des sentiers battus" },
    { min: 10, title: "Hérisson", icon: "sprout", description: "On commence à explorer" },
    { min: 0, title: "Colibri", icon: "feather", description: "Les premiers pas" }
];

// --- 2. LES MATIÈRES (Basé sur % Circuits Officiels) ---
// 10 Paliers de 10%
export const MATERIAL_RANKS = [
    { min: 90, title: "Diamant", color: "#b9f2ff", cssClass: "rank-diamond" },
    { min: 80, title: "Saphir", color: "#0F52BA", cssClass: "rank-sapphire" },
    { min: 70, title: "Cristal", color: "#e6e6fa", cssClass: "rank-crystal" },
    { min: 60, title: "Or", color: "#FFD700", cssClass: "rank-gold" },
    { min: 50, title: "Argent", color: "#C0C0C0", cssClass: "rank-silver" },
    { min: 40, title: "Acier", color: "#434B4D", cssClass: "rank-steel" },
    { min: 30, title: "Bronze", color: "#CD7F32", cssClass: "rank-bronze" },
    { min: 20, title: "Cuivre", color: "#B87333", cssClass: "rank-copper" },
    { min: 10, title: "Pierre", color: "#888888", cssClass: "rank-stone" },
    { min: 0, title: "Bois", color: "#8B4513", cssClass: "rank-wood" }
];

export function calculateStats() {
    // 1. POIs Visités (Legacy Stats)
    const totalPois = state.loadedFeatures.length;
    let visitedPois = 0;
    state.loadedFeatures.forEach(feature => {
        const id = getPoiId(feature);
        if (state.userData[id] && state.userData[id].vu) {
            visitedPois++;
        }
    });
    const poiPercent = totalPois > 0 ? Math.round((visitedPois / totalPois) * 100) : 0;

    // 2. Calculs Officiels (Base de référence pour la Gamification)
    const officialCircuits = state.officialCircuits || [];
    let totalOfficialCircuitsAvailable = officialCircuits.length;
    let totalOfficialDistanceAvailable = 0;

    officialCircuits.forEach(c => {
        totalOfficialDistanceAvailable += getCircuitDistance(c);
    });

    // Convertir en KM pour affichage, mais garder mètres pour calcul précis
    const totalOfficialKmAvailable = parseFloat((totalOfficialDistanceAvailable / 1000).toFixed(1));

    // 3. Performance Joueur (Sur contenu officiel uniquement)
    let userOfficialCircuits = 0;
    let userOfficialDistance = 0;

    officialCircuits.forEach(c => {
        // Circuit terminé ?
        if (state.officialCircuitsStatus[String(c.id)]) {
            userOfficialCircuits++;
            userOfficialDistance += getCircuitDistance(c);
        }
    });

    const userOfficialKm = parseFloat((userOfficialDistance / 1000).toFixed(1));

    // 4. Calculs XP (Pondération Dynamique)
    // Eviter division par zéro
    let xpDistance = 0;
    if (totalOfficialDistanceAvailable > 0) {
        xpDistance = (userOfficialDistance / totalOfficialDistanceAvailable) * 10000;
    }

    let xpCircuits = 0;
    if (totalOfficialCircuitsAvailable > 0) {
        xpCircuits = (userOfficialCircuits / totalOfficialCircuitsAvailable) * 10000;
    }

    const totalXP = Math.round(xpDistance + xpCircuits);

    // 5. Détermination des Rangs
    // Pour Animaux/Matières, on utilise le pourcentage d'avancement (0-100)
    const distancePercent = totalOfficialDistanceAvailable > 0
        ? (userOfficialDistance / totalOfficialDistanceAvailable) * 100
        : 0;

    const circuitPercent = totalOfficialCircuitsAvailable > 0
        ? (userOfficialCircuits / totalOfficialCircuitsAvailable) * 100
        : 0;

    const animalRank = getRank(ANIMAL_RANKS, distancePercent);
    const materialRank = getRank(MATERIAL_RANKS, circuitPercent);
    const globalRank = getRank(GLOBAL_RANKS, totalXP);
    const nextGlobalRank = getNextRank(GLOBAL_RANKS, totalXP);

    return {
        visitedPois,
        totalPois,
        poiPercent,

        // Données Brutes
        userOfficialCircuits,
        totalOfficialCircuitsAvailable,
        userOfficialKm,
        totalOfficialKmAvailable,

        // XP & Rangs
        totalXP,
        globalRank,
        nextGlobalRank,

        // Sous-Rangs (pour badges)
        animalRank,
        materialRank,
        distancePercent,
        circuitPercent
    };
}

function getCircuitDistance(circuit) {
    if (circuit.distance && typeof circuit.distance === 'string') {
        const parsed = parseFloat(circuit.distance.replace(',', '.').replace(/[^\d.]/g, ''));
        if (!isNaN(parsed) && parsed > 0) {
            return parsed * 1000;
        }
    }
    if (circuit.realTrack && circuit.realTrack.length > 0) {
        return getRealDistance(circuit);
    }
    const circuitFeatures = (circuit.poiIds || [])
        .map(id => state.loadedFeatures.find(f => getPoiId(f) === id))
        .filter(Boolean);
    return getOrthodromicDistance(circuitFeatures);
}

function getRank(rankList, value) {
    // Liste triée par min décroissant
    return rankList.find(r => value >= r.min) || rankList[rankList.length - 1];
}

function getNextRank(rankList, value) {
    const reversed = [...rankList].reverse();
    return reversed.find(r => r.min > value);
}

// --- AFFICHAGE MODALE ---

export async function showStatisticsModal() {
    const stats = calculateStats();

    // -- Progression XP Globale --
    let xpProgress = 0;
    let xpRemaining = 0;
    if (stats.nextGlobalRank) {
        const range = stats.nextGlobalRank.min - stats.globalRank.min;
        const current = stats.totalXP - stats.globalRank.min;
        xpProgress = Math.min(100, Math.max(5, (current / range) * 100));
        xpRemaining = stats.nextGlobalRank.min - stats.totalXP;
    } else {
        xpProgress = 100;
    }

    // -- Titre Complet (Badge) --
    // Ex: "Renard de Bronze"
    const badgeTitle = `${stats.animalRank.title} de ${stats.materialRank.title}`;

    const html = `
        <div class="walker-card">

            <!-- EN-TÊTE : RANG GLOBAL -->
            <div class="card-header" style="border-bottom: 2px solid ${stats.materialRank.color};">
                <div class="card-identity">
                    <div class="card-avatar-wrapper ${stats.materialRank.cssClass}" style="border-color: ${stats.materialRank.color}; box-shadow: 0 0 15px ${stats.materialRank.color}40;">
                        <i data-lucide="${stats.animalRank.icon}" class="card-avatar-icon" style="color: ${stats.materialRank.color};"></i>
                    </div>
                    <div class="card-titles">
                        <div class="global-rank-title" style="color: var(--ink); text-transform: uppercase; font-size: 14px; letter-spacing: 2px;">Rang Global</div>
                        <div class="card-rank-title" style="color: ${stats.materialRank.color}; font-size: 28px;">${stats.globalRank.title}</div>
                        <div class="card-subtitle badge-name">${badgeTitle}</div>
                    </div>
                </div>

                <!-- JAUGE XP GLOBALE -->
                <div class="global-xp-container">
                    <div class="xp-info">
                        <span class="xp-val">${stats.totalXP} XP</span>
                        <span class="xp-target">${stats.nextGlobalRank ? `Prochain: ${stats.nextGlobalRank.title} (${stats.nextGlobalRank.min} XP)` : 'Niveau Max'}</span>
                    </div>
                    <div class="progress-track xp-track">
                        <div class="progress-fill xp-fill" style="width: ${xpProgress}%; background: linear-gradient(90deg, ${stats.materialRank.color}, var(--brand));"></div>
                    </div>
                </div>
            </div>

            <div class="card-body">

                <!-- SECTION 1 : DISTANCE (ANIMAL) -->
                <div class="stat-row">
                    <div class="stat-icon-col">
                        <i data-lucide="footprints" style="color: var(--ink-soft);"></i>
                    </div>
                    <div class="stat-content-col">
                        <div class="stat-header">
                            <span class="stat-label">Distance (Officielle)</span>
                            <span class="stat-value">${stats.userOfficialKm} / ${stats.totalOfficialKmAvailable} km</span>
                        </div>
                        <div class="progress-track">
                            <div class="progress-fill" style="width: ${stats.distancePercent}%; background: var(--brand);"></div>
                        </div>
                        <div class="stat-footer">
                            <span class="current-rank">${stats.animalRank.title}</span>
                            <span class="next-objective">${Math.round(stats.distancePercent)}% complété</span>
                        </div>
                    </div>
                </div>

                <!-- SECTION 2 : CIRCUITS (MATIÈRE) -->
                <div class="stat-row">
                    <div class="stat-icon-col">
                        <i data-lucide="map" style="color: var(--ink-soft);"></i>
                    </div>
                    <div class="stat-content-col">
                        <div class="stat-header">
                            <span class="stat-label">Circuits (Officiels)</span>
                            <span class="stat-value">${stats.userOfficialCircuits} / ${stats.totalOfficialCircuitsAvailable}</span>
                        </div>
                        <div class="progress-track">
                            <div class="progress-fill" style="width: ${stats.circuitPercent}%; background: ${stats.materialRank.color};"></div>
                        </div>
                        <div class="stat-footer">
                            <span class="current-rank" style="color:${stats.materialRank.color}; font-weight:600;">${stats.materialRank.title}</span>
                            <span class="next-objective">${Math.round(stats.circuitPercent)}% complété</span>
                        </div>
                    </div>
                </div>

                <!-- SECTION 3 : EXTRA -->
                <div class="mini-stats-grid">
                    <div class="mini-stat">
                        <div class="mini-val">${stats.visitedPois}</div>
                        <div class="mini-lbl">Lieux</div>
                    </div>
                    <div class="mini-stat">
                        <div class="mini-val">${stats.poiPercent}%</div>
                        <div class="mini-lbl">Découverte</div>
                    </div>
                    <div class="mini-stat">
                        <div class="mini-val">${stats.totalOfficialCircuitsAvailable}</div>
                        <div class="mini-lbl">Circuits</div>
                    </div>
                </div>

            </div>

            <div class="card-footer">
                "Plus le chemin est long, plus le récit est beau."
            </div>
        </div>

        <style>
            .walker-card {
                font-family: 'Segoe UI', system-ui, sans-serif;
                color: var(--ink);
            }
            .card-header {
                padding-bottom: 20px;
                margin-bottom: 20px;
                text-align: center;
            }
            .card-identity {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 10px;
                margin-bottom: 20px;
            }
            .card-avatar-wrapper {
                width: 80px;
                height: 80px;
                border-radius: 50%;
                border: 4px solid #ccc;
                display: flex;
                align-items: center;
                justify-content: center;
                background: var(--surface);
                transition: transform 0.3s ease;
            }
            .card-avatar-wrapper:hover {
                transform: scale(1.05) rotate(5deg);
            }
            .card-avatar-icon {
                width: 40px;
                height: 40px;
            }
            .card-rank-title {
                font-weight: 800;
                text-transform: uppercase;
                letter-spacing: 1px;
                margin-top: 5px;
                text-shadow: 0 1px 2px rgba(0,0,0,0.1);
            }
            .badge-name {
                font-size: 16px;
                font-weight: 600;
                color: var(--ink-soft);
                margin-top: 5px;
            }
            .global-xp-container {
                margin-top: 15px;
                text-align: left;
            }
            .xp-info {
                display: flex;
                justify-content: space-between;
                font-size: 12px;
                margin-bottom: 4px;
                color: var(--ink-soft);
                font-weight: 600;
            }
            .xp-track {
                height: 12px;
                background: var(--surface-muted);
                border: 1px solid var(--line);
            }
            .xp-fill {
                transition: width 1s ease-out;
            }
            .stat-row {
                display: flex;
                gap: 15px;
                margin-bottom: 25px;
                align-items: center;
            }
            .stat-icon-col {
                width: 40px;
                display: flex;
                justify-content: center;
            }
            .stat-icon-col i {
                width: 24px;
                height: 24px;
            }
            .stat-content-col {
                flex: 1;
            }
            .stat-header {
                display: flex;
                justify-content: space-between;
                margin-bottom: 6px;
                font-size: 14px;
            }
            .stat-label { font-weight: 600; color: var(--ink); }
            .stat-value { font-weight: 700; color: var(--ink); }
            .progress-track {
                height: 8px;
                background: var(--surface-muted);
                border-radius: 4px;
                overflow: hidden;
                margin-bottom: 6px;
            }
            .progress-fill {
                height: 100%;
                border-radius: 4px;
                transition: width 1s ease-out;
            }
            .stat-footer {
                display: flex;
                justify-content: space-between;
                font-size: 12px;
            }
            .current-rank { font-weight: 700; text-transform: uppercase; }
            .next-objective { color: var(--ink-soft); }
            .mini-stats-grid {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 10px;
                background: var(--surface-muted);
                border-radius: 12px;
                padding: 15px;
                margin-top: 10px;
            }
            .mini-stat {
                text-align: center;
            }
            .mini-val {
                font-size: 18px;
                font-weight: 700;
                color: var(--brand);
            }
            .mini-lbl {
                font-size: 11px;
                color: var(--ink-soft);
                text-transform: uppercase;
                margin-top: 2px;
            }
            .card-footer {
                margin-top: 20px;
                text-align: center;
                font-size: 12px;
                color: var(--ink-soft);
                font-style: italic;
            }

            /* EFFETS DE MATIÈRE */
            .rank-wood { background: #8B4513; }
            .rank-stone { background: #888888; }
            .rank-copper { background: #B87333; }
            .rank-bronze { background: #CD7F32; }
            .rank-steel { background: #434B4D; }
            .rank-silver { background: radial-gradient(circle at 30% 30%, #f0f0f0, #c0c0c0); }
            .rank-gold { background: radial-gradient(circle at 30% 30%, #fffbe0, #ffd700); }
            .rank-crystal { background: radial-gradient(circle at 30% 30%, #ffffff, #e6e6fa); }
            .rank-sapphire { background: radial-gradient(circle at 30% 30%, #4facfe, #00f2fe); }
            .rank-diamond { background: radial-gradient(circle at 30% 30%, #e0faff, #b9f2ff); }
        </style>
    `;

    await showAlert("Mon Carnet de Voyage", html, "Fermer", "gamification-modal");

    const modalContent = document.getElementById('custom-modal-message');
    if (modalContent) {
        createIcons({ icons, root: modalContent });
    }
}
