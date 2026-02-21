import { state } from './state.js';
import { getRealDistance, getOrthodromicDistance } from './map.js';
import { getPoiId } from './data.js';
import { showAlert } from './modal.js';
import { createIcons, icons } from 'lucide';

// --- 1. LES ANIMAUX (Basé sur la Distance Km) ---
// Échelle : x10 plus accessible que Gemini (1000km max au lieu de 10000)
export const ANIMAL_RANKS = [
    { min: 1000, title: "Phénix", icon: "flame", description: "Légendaire" },
    { min: 700, title: "Aigle Royal", icon: "bird", description: "Vue d'ensemble sur l'île" },
    { min: 400, title: "Ours Polaire", icon: "snowflake", description: "Un marcheur confirmé" }, // Note: Djerba n'a pas d'ours, mais c'est le symbole de l'endurance ;)
    { min: 200, title: "Grand Cerf", icon: "crown", description: "Majestueux" },
    { min: 100, title: "Loup", icon: "paw-print", description: "L'endurance s'installe" },
    { min: 60, title: "Chamois", icon: "mountain", description: "On grimpe en compétence" },
    { min: 35, title: "Lynx", icon: "eye", description: "L'agilité augmente" },
    { min: 15, title: "Renard", icon: "dog", description: "On sort des sentiers battus" }, // Lucide n'a pas 'fox', 'dog' est proche
    { min: 5, title: "Hérisson", icon: "sprout", description: "On commence à explorer" },
    { min: 0, title: "Colibri", icon: "feather", description: "Les premiers pas" }
];

// --- 2. LES MATIÈRES (Basé sur le Nombre de Circuits) ---
// Échelle : 100 circuits max
export const MATERIAL_RANKS = [
    { min: 100, title: "Diamant", color: "#b9f2ff", cssClass: "rank-diamond" }, // Bleu Glacé / Prisme
    { min: 80, title: "Saphir", color: "#0F52BA", cssClass: "rank-sapphire" },   // Bleu Profond
    { min: 60, title: "Cristal", color: "#e6e6fa", cssClass: "rank-crystal" },   // Blanc Pur / Translucide
    { min: 40, title: "Or", color: "#FFD700", cssClass: "rank-gold" },          // Or Jaune
    { min: 25, title: "Argent", color: "#C0C0C0", cssClass: "rank-silver" },     // Gris Métal
    { min: 15, title: "Acier", color: "#434B4D", cssClass: "rank-steel" },       // Gris Foncé Industriel
    { min: 10, title: "Bronze", color: "#CD7F32", cssClass: "rank-bronze" },     // Orange/Marron
    { min: 5, title: "Cuivre", color: "#B87333", cssClass: "rank-copper" },      // Orange/Rouge
    { min: 3, title: "Pierre", color: "#888888", cssClass: "rank-stone" },       // Gris Pierre
    { min: 1, title: "Bois", color: "#8B4513", cssClass: "rank-wood" },          // Marron
    { min: 0, title: "Poussière", color: "#dcdcdc", cssClass: "rank-dust" }      // Gris très clair (Défaut)
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

    // 3. Calcul des Rangs (Nouveau Système)
    const animalRank = getRank(ANIMAL_RANKS, totalKm);
    const nextAnimalRank = getNextRank(ANIMAL_RANKS, totalKm);

    const materialRank = getRank(MATERIAL_RANKS, completedCircuits);
    const nextMaterialRank = getNextRank(MATERIAL_RANKS, completedCircuits);

    return {
        visitedPois,
        totalPois,
        poiPercent,
        completedCircuits,
        totalCircuits,
        totalKm,
        animalRank,
        nextAnimalRank,
        materialRank,
        nextMaterialRank
    };
}

function getCircuitDistance(circuit) {
    // 1. Priorité absolue : La distance officielle affichée (string "6.0 km")
    if (circuit.distance && typeof circuit.distance === 'string') {
        const parsed = parseFloat(circuit.distance.replace(',', '.').replace(/[^\d.]/g, ''));
        if (!isNaN(parsed) && parsed > 0) {
            return parsed * 1000;
        }
    }

    // 2. Fallback : Calcul réel
    if (circuit.realTrack && circuit.realTrack.length > 0) {
        return getRealDistance(circuit);
    }

    // 3. Fallback ultime : Vol d'oiseau
    const circuitFeatures = (circuit.poiIds || [])
        .map(id => state.loadedFeatures.find(f => getPoiId(f) === id))
        .filter(Boolean);
    return getOrthodromicDistance(circuitFeatures);
}

function getRank(rankList, value) {
    // On suppose que la liste est triée par min décroissant (du plus grand au plus petit)
    // ANIMAL_RANKS et MATERIAL_RANKS sont définis ainsi.
    return rankList.find(r => value >= r.min) || rankList[rankList.length - 1];
}

function getNextRank(rankList, value) {
    // On inverse pour trouver le premier qui est strictement plus grand
    const reversed = [...rankList].reverse();
    return reversed.find(r => r.min > value);
}


// --- AFFICHAGE MODALE (CARTE D'IDENTITÉ) ---

export async function showStatisticsModal() {
    const stats = calculateStats();

    // -- Calculs Progression KM (Animal) --
    let kmProgress = 0;
    let kmRemaining = 0;
    if (stats.nextAnimalRank) {
        const range = stats.nextAnimalRank.min - stats.animalRank.min;
        const current = stats.totalKm - stats.animalRank.min;
        kmProgress = Math.min(100, Math.max(5, (current / range) * 100));
        kmRemaining = (stats.nextAnimalRank.min - stats.totalKm).toFixed(1);
    } else {
        kmProgress = 100;
    }

    // -- Calculs Progression Circuits (Matière) --
    let circuitProgress = 0;
    let circuitsRemaining = 0;
    if (stats.nextMaterialRank) {
        const range = stats.nextMaterialRank.min - stats.materialRank.min;
        const current = stats.completedCircuits - stats.materialRank.min;
        circuitProgress = Math.min(100, Math.max(5, (current / range) * 100));
        circuitsRemaining = stats.nextMaterialRank.min - stats.completedCircuits;
    } else {
        circuitProgress = 100;
    }

    // -- Construction du Titre --
    // Ex: "Renard de Bronze"
    // Si pas de matière (Poussière), juste "Colibri" (ex: Colibri de Poussière sonne bizarre, mais "Colibri" tout court est mieux ?)
    // Gemini proposait "Titre complet". Allons-y : "Animal de Matière"
    let fullTitle = `${stats.animalRank.title}`;
    if (stats.materialRank.min > 0) { // Si on a fait au moins 1 circuit
        fullTitle += ` de ${stats.materialRank.title}`; // "Renard de Bronze"
    } else {
        fullTitle += " Vagabond"; // "Colibri Vagabond" (Pas encore de circuit)
    }

    // -- HTML --
    const html = `
        <div class="walker-card">

            <!-- EN-TÊTE : IDENTITÉ -->
            <div class="card-header" style="border-bottom: 2px solid ${stats.materialRank.color};">
                <div class="card-identity">
                    <div class="card-avatar-wrapper ${stats.materialRank.cssClass}" style="border-color: ${stats.materialRank.color}; box-shadow: 0 0 15px ${stats.materialRank.color}40;">
                        <i data-lucide="${stats.animalRank.icon}" class="card-avatar-icon" style="color: ${stats.materialRank.color};"></i>
                    </div>
                    <div class="card-titles">
                        <div class="card-rank-title" style="color: ${stats.materialRank.color};">${fullTitle}</div>
                        <div class="card-subtitle">Explorateur de Djerba</div>
                    </div>
                </div>
            </div>

            <div class="card-body">

                <!-- SECTION 1 : L'ANIMAL (Endurance / KM) -->
                <div class="stat-row">
                    <div class="stat-icon-col">
                        <i data-lucide="footprints" style="color: var(--ink-soft);"></i>
                    </div>
                    <div class="stat-content-col">
                        <div class="stat-header">
                            <span class="stat-label">Endurance (Distance)</span>
                            <span class="stat-value">${stats.totalKm} km</span>
                        </div>
                        <div class="progress-track">
                            <div class="progress-fill" style="width: ${kmProgress}%; background: var(--brand);"></div>
                        </div>
                        <div class="stat-footer">
                            <span class="current-rank">${stats.animalRank.title}</span>
                            ${stats.nextAnimalRank
                                ? `<span class="next-objective">Prochain : ${stats.nextAnimalRank.title} dans <strong>${kmRemaining} km</strong></span>`
                                : '<span class="next-objective">Sommet atteint !</span>'}
                        </div>
                    </div>
                </div>

                <!-- SECTION 2 : LA MATIÈRE (Régularité / Circuits) -->
                <div class="stat-row">
                    <div class="stat-icon-col">
                        <i data-lucide="map" style="color: var(--ink-soft);"></i>
                    </div>
                    <div class="stat-content-col">
                        <div class="stat-header">
                            <span class="stat-label">Régularité (Circuits)</span>
                            <span class="stat-value">${stats.completedCircuits}</span>
                        </div>
                        <div class="progress-track">
                            <div class="progress-fill" style="width: ${circuitProgress}%; background: ${stats.materialRank.color};"></div>
                        </div>
                        <div class="stat-footer">
                            <span class="current-rank" style="color:${stats.materialRank.color}; font-weight:600;">${stats.materialRank.title}</span>
                            ${stats.nextMaterialRank
                                ? `<span class="next-objective">Prochain : ${stats.nextMaterialRank.title} dans <strong>${circuitsRemaining} circuits</strong></span>`
                                : '<span class="next-objective">Légende vivante !</span>'}
                        </div>
                    </div>
                </div>

                <!-- SECTION 3 : EXPLORATION (Total POI) - Bonus -->
                <div class="mini-stats-grid">
                    <div class="mini-stat">
                        <div class="mini-val">${stats.visitedPois}</div>
                        <div class="mini-lbl">Lieux Visités</div>
                    </div>
                    <div class="mini-stat">
                        <div class="mini-val">${stats.poiPercent}%</div>
                        <div class="mini-lbl">Découverte</div>
                    </div>
                    <div class="mini-stat">
                        <div class="mini-val">${stats.totalCircuits}</div>
                        <div class="mini-lbl">Circuits Dispo</div>
                    </div>
                </div>

            </div>

            <div class="card-footer">
                "Chaque pas compte, chaque lieu raconte une histoire."
            </div>
        </div>

        <style>
            /* STYLES INTERNES POUR LA CARTE (Injectés dynamiquement) */
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
                gap: 15px;
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
                font-size: 24px;
                font-weight: 800;
                text-transform: uppercase;
                letter-spacing: 1px;
                margin-bottom: 4px;
                text-shadow: 0 1px 2px rgba(0,0,0,0.1);
            }

            .card-subtitle {
                font-size: 14px;
                color: var(--ink-soft);
                font-style: italic;
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

            /* EFFETS DE MATIÈRE (CSS Classes) */
            .rank-gold { background: radial-gradient(circle at 30% 30%, #fffbe0, #ffd700); }
            .rank-silver { background: radial-gradient(circle at 30% 30%, #f0f0f0, #c0c0c0); }
            .rank-bronze { background: radial-gradient(circle at 30% 30%, #ffdec2, #cd7f32); }
            .rank-diamond { background: radial-gradient(circle at 30% 30%, #e0faff, #b9f2ff); }
            /* Ajouter d'autres si besoin */
        </style>
    `;

    // Utilisation de la classe CSS personnalisée 'gamification-modal'
    await showAlert("Mon Carnet de Voyage", html, "Fermer", "gamification-modal");

    const modalContent = document.getElementById('custom-modal-message');
    if (modalContent) {
        createIcons({ icons, root: modalContent });
    }
}
