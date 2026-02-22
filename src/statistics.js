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

    // 4. Calculs XP (Pondération Dynamique - LEGACY SUPPORT)
    let xpDistance = 0;
    if (totalOfficialDistanceAvailable > 0) {
        xpDistance = (userOfficialDistance / totalOfficialDistanceAvailable) * 10000;
    }

    let xpCircuits = 0;
    if (totalOfficialCircuitsAvailable > 0) {
        xpCircuits = (userOfficialCircuits / totalOfficialCircuitsAvailable) * 10000;
    }

    const totalXP = Math.round(xpDistance + xpCircuits);

    // 5. Détermination des Rangs (LEGACY SUPPORT)
    const distancePercent = totalOfficialDistanceAvailable > 0
        ? (userOfficialDistance / totalOfficialDistanceAvailable) * 100
        : 0;

    const circuitPercent = totalOfficialCircuitsAvailable > 0
        ? (userOfficialCircuits / totalOfficialCircuitsAvailable) * 100
        : 0;

    const animalRank = getRank(ANIMAL_RANKS, distancePercent);
    const materialRank = getRank(MATERIAL_RANKS, circuitPercent);
    const globalRank = getRank(GLOBAL_RANKS, totalXP);

    return {
        visitedPois,
        totalPois,
        poiPercent,

        // Données Brutes
        userOfficialCircuits,
        totalOfficialCircuitsAvailable,
        userOfficialKm,
        totalOfficialKmAvailable,

        // XP & Rangs (Legacy)
        totalXP,
        globalRank,
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

// --- AFFICHAGE MODALE ---

// CSS partagé pour réutilisation dans l'impression
const EXPLORER_CARD_CSS = `
    :root {
        --bg-parchment: #f4ecd8;
        --accent-copper: #b87333;
        --text-dark: #2c2c2c;
        --progress-bg: rgba(0, 0, 0, 0.1);
    }

    body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    }

    #explorer-card-root {
        white-space: normal; /* Reset inherited pre-wrap from modal */
    }

    .explorer-card {
        width: 100%;
        max-width: 450px;
        background: var(--bg-parchment);
        border-radius: 15px;
        padding: 20px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.2);
        color: var(--text-dark);
        position: relative;
        border: 2px solid #e2d1a8;
        display: flex;
        flex-direction: column;
            gap: 15px;
        margin: 0 auto;
        box-sizing: border-box;
    }

    .card-header { display: flex; align-items: center; gap: 20px; margin-bottom: 15px; }

    .avatar {
        width: 80px;
        height: 80px;
        min-width: 80px;
        border-radius: 50%;
        background: #e2d1a8;
        border: 4px solid var(--accent-copper);
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .avatar svg {
        width: 60%;
        height: 60%;
        stroke: var(--accent-copper);
        stroke-width: 1.5;
    }

    .title-area h2 {
        margin: 0;
        font-family: 'Georgia', serif;
        letter-spacing: 1px;
        text-transform: uppercase;
        font-size: 1.4rem;
        line-height: 1.2;
        color: var(--text-dark);
    }

    .global-rank {
        font-style: italic;
        font-size: 0.9rem;
        color: #666;
        margin-top: 4px;
    }

    .stats-container { margin-top: 5px; }

    .stat-group { margin-bottom: 12px; }

    .stat-label {
        display: flex;
        justify-content: space-between;
        font-size: 0.75rem;
        font-weight: bold;
        margin-bottom: 4px;
        text-transform: uppercase;
        color: var(--text-dark);
    }

    .progress-bar-container {
        width: 100%;
        height: 8px;
        background: var(--progress-bg);
        border-radius: 4px;
        overflow: hidden;
    }

    .progress-fill {
        height: 100%;
        background: linear-gradient(90deg, var(--accent-copper), #e68a3e);
        transition: width 0.5s ease-in-out;
    }

    .footer-stats {
        display: flex;
        justify-content: space-between;
        border-top: 1px solid rgba(0,0,0,0.1);
        padding-top: 15px;
        font-size: 0.8rem;
        margin-top: 10px;
        color: var(--text-dark);
    }

    .next-goal { font-size: 0.7rem; color: #888; margin-top: 2px; text-align: right; }

    /* Print Button Style - hidden in print media via CSS in function if needed, or ignored since we print specific element */
    .card-actions {
        margin-top: 20px;
        display: flex;
        justify-content: center;
    }
    .action-btn-print {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 20px;
        background: #fff;
        border: 1px solid #ddd;
        border-radius: 8px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
        color: #333;
        box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    }
    .action-btn-print:hover {
        background: #f9f9f9;
        transform: translateY(-1px);
    }
`;

export async function showStatisticsModal() {
    const stats = calculateStats();

    // Configuration conforme à la demande utilisateur (ordre croissant)
    const CONFIG = {
        paliers: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
        animaux: ["Colibri", "Hérisson", "Renard", "Lynx", "Chamois", "Loup", "Grand Cerf", "Ours Polaire", "Aigle Royal", "Phénix"],
        matieres: ["Bois", "Pierre", "Cuivre", "Bronze", "Acier", "Argent", "Or", "Cristal", "Saphir", "Diamant"],
        rangs: ["Premier Souffle", "Petite Étincelle", "Esprit Curieux", "Cœur Vaillant", "Âme Vagabonde", "Sillage d'Argent", "Regard d'Horizon", "Sagesse des Sables", "Souffle Céleste", "Lueur d'Éternité"]
    };

    // 1. Calculs Hardcore
    const pctDist = Math.min(100, Math.max(0, stats.distancePercent));
    const pctCirc = Math.min(100, Math.max(0, stats.circuitPercent));
    const pctGlobal = (pctDist * pctCirc) / 100; // Système Hardcore

    // 2. Trouver les rangs (Logique utilisateur)
    const getRankInfo = (pct, list) => {
        let idx = -1;
        for (let i = 0; i < CONFIG.paliers.length; i++) {
            if (pct >= CONFIG.paliers[i]) {
                idx = i;
            } else {
                break;
            }
        }
        if (idx >= list.length) idx = list.length - 1;
        if (idx < 0) idx = 0;

        const nextGoal = (idx < list.length - 1) ? CONFIG.paliers[idx + 1] : 100;

        return {
            title: list[idx],
            currentPct: pct,
            nextGoalPct: nextGoal
        };
    };

    const animal = getRankInfo(pctDist, CONFIG.animaux);
    const matiere = getRankInfo(pctCirc, CONFIG.matieres);
    const globalR = getRankInfo(pctGlobal, CONFIG.rangs);

    // Titre dynamique
    const formatDe = (mot) => {
        const voyelles = ['A', 'E', 'I', 'O', 'U', 'Y', 'É', 'È'];
        if (voyelles.includes(mot.charAt(0).toUpperCase())) {
            return `d'${mot}`;
        }
        return `de ${mot}`;
    };
    const finalTitle = `${animal.title} ${formatDe(matiere.title)}`;

    // Avatar SVG (Inline)
    const avatarSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

    // -- HTML --
    const html = `
    <style>${EXPLORER_CARD_CSS}</style>
    <div id="explorer-card-root">
        <div class="explorer-card" id="explorer-card-print">
            <div class="card-header">
                <div class="avatar">
                    ${avatarSvg}
                </div>
                <div class="title-area">
                    <h2 id="dynamic-title">${finalTitle}</h2>
                    <div id="global-rank-label" class="global-rank">Rang : ${globalR.title}</div>
                </div>
            </div>

            <div class="stats-container">
                <div class="stat-group">
                    <div class="stat-label">
                        <span id="label-animal">Distance (${animal.title})</span>
                        <span id="val-distance">${stats.userOfficialKm} / ${stats.totalOfficialKmAvailable} km</span>
                    </div>
                    <div class="progress-bar-container">
                        <div id="bar-distance" class="progress-fill" style="width: ${pctDist}%"></div>
                    </div>
                    <div id="goal-distance" class="next-goal">Objectif : ${animal.nextGoalPct}%</div>
                </div>

                <div class="stat-group">
                    <div class="stat-label">
                        <span id="label-matiere">Circuits (${matiere.title})</span>
                        <span id="val-circuits">${stats.userOfficialCircuits} / ${stats.totalOfficialCircuitsAvailable}</span>
                    </div>
                    <div class="progress-bar-container">
                        <div id="bar-circuits" class="progress-fill" style="width: ${pctCirc}%"></div>
                    </div>
                    <div id="goal-circuits" class="next-goal">Objectif : ${matiere.nextGoalPct}%</div>
                </div>
            </div>

            <div class="footer-stats">
                <div>📍 <span id="footer-km">${(stats.totalOfficialKmAvailable - stats.userOfficialKm).toFixed(1)}</span> km à parcourir</div>
                <div>🗺️ <span id="footer-circuits">${stats.totalOfficialCircuitsAvailable - stats.userOfficialCircuits}</span> défis en attente</div>
            </div>
        </div>

        <div class="card-actions">
            <button id="btn-print-card" class="action-btn-print">
                <i data-lucide="printer"></i> Imprimer ma carte
            </button>
        </div>
    </div>
    `;

    await showAlert("Mon Carnet de Voyage", html, "Fermer", "gamification-modal");

    const modalContent = document.getElementById('custom-modal-message');
    if (modalContent) {
        createIcons({ icons, root: modalContent });

        // Add Print Listener
        const btnPrint = document.getElementById('btn-print-card');
        if (btnPrint) {
            btnPrint.addEventListener('click', () => {
                printCardElement();
            });
        }
    }
}

function printCardElement() {
    const cardElement = document.getElementById('explorer-card-print');
    if (!cardElement) return;

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow.document;

    // Write full HTML doc for correct rendering
    doc.open();
    doc.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Impression Carte Explorateur</title>
            <style>
                ${EXPLORER_CARD_CSS}
                /* Print specific overrides */
                @page {
                    size: A4; /* Or landscape if preferred, but A4 usually fine for this size */
                    margin: 0;
                }
                body {
                    margin: 0;
                    padding: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                    -webkit-print-color-adjust: exact;
                    print-color-adjust: exact;
                }
                .explorer-card {
                    box-shadow: none;
                    border: 1px solid #ccc;
                }
            </style>
        </head>
        <body>
            ${cardElement.outerHTML}
        </body>
        </html>
    `);
    doc.close();

    // Image loading safety (if SVG relies on ext resources, which it doesn't, but good practice)
    setTimeout(() => {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        setTimeout(() => document.body.removeChild(iframe), 2000); // Cleanup
    }, 500);
}
