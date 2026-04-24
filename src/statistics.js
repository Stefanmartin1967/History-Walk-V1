import { state } from './state.js';
import { getRealDistance, getOrthodromicDistance } from './utils.js';
import { getPoiId } from './data.js';
import { showAlert } from './modal.js';
import { createIcons, appIcons } from './lucide-icons.js';
import explorerCardCssUrl from '../style/explorer-card.css?url';

// --- 0. RANGS GLOBAUX (Basé sur % Global = Distance% × POI% / 100) ---
// pctGlobal = (distancePercent * poiPercent) / 100  → 0-100%
// Système "hardcore" : il faut exceller sur BOTH axes pour atteindre les hauts rangs
export const GLOBAL_RANKS = [
    { min: 90, title: "Lueur d'Éternité" },
    { min: 80, title: "Souffle Céleste" },
    { min: 70, title: "Sagesse des Sables" },
    { min: 60, title: "Regard d'Horizon" },
    { min: 50, title: "Sillage d'Argent" },
    { min: 40, title: "Âme Vagabonde" },
    { min: 30, title: "Cœur Vaillant" },
    { min: 20, title: "Esprit Curieux" },
    { min: 10, title: "Petite Étincelle" },
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

// --- 2. LES MATIÈRES (Basé sur % POIs Visités) ---
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
    // 1. POIs Visités (Base de référence pour la Gamification)
    const totalPois = state.loadedFeatures.length;
    let visitedPois = 0;

    // Récupération de tous les IDs de POIs appartenant à des circuits terminés
    const completedCircuitPoiIds = new Set();
    const officialCircuits = state.officialCircuits || [];

    officialCircuits.forEach(c => {
        if (state.officialCircuitsStatus[String(c.id)]) {
            (c.poiIds || []).forEach(poiId => completedCircuitPoiIds.add(poiId));
        }
    });

    state.loadedFeatures.forEach(feature => {
        const id = getPoiId(feature);
        const isVisitedDirectly = state.userData[id] && state.userData[id].vu;
        const isVisitedViaCircuit = completedCircuitPoiIds.has(id);

        if (isVisitedDirectly || isVisitedViaCircuit) {
            visitedPois++;
        }
    });
    const poiPercent = totalPois > 0 ? Math.round((visitedPois / totalPois) * 100) : 0;

    // 2. Calculs Officiels (Distance)
    // On réutilise la variable 'officialCircuits' déjà déclarée plus haut
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

    // On garde xpCircuits pour le "XP Total" legacy, même si on change l'affichage "Matière"
    let xpCircuits = 0;
    if (totalOfficialCircuitsAvailable > 0) {
        xpCircuits = (userOfficialCircuits / totalOfficialCircuitsAvailable) * 10000;
    }

    const totalXP = Math.round(xpDistance + xpCircuits);

    // 5. Détermination des Rangs
    const distancePercent = totalOfficialDistanceAvailable > 0
        ? (userOfficialDistance / totalOfficialDistanceAvailable) * 100
        : 0;

    const circuitPercent = totalOfficialCircuitsAvailable > 0
        ? (userOfficialCircuits / totalOfficialCircuitsAvailable) * 100
        : 0;

    const animalRank = getRank(ANIMAL_RANKS, distancePercent);
    // CHANGEMENT ICI : Le rang Matière dépend désormais du % de POIs visités
    const materialRank = getRank(MATERIAL_RANKS, poiPercent);
    // Rang global basé sur le score combiné (même formule que la modale)
    const pctGlobal = (distancePercent * poiPercent) / 100;
    const globalRank = getRank(GLOBAL_RANKS, pctGlobal);

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
    // CHANGEMENT ICI : On utilise le pourcentage de POIs au lieu du pourcentage de Circuits
    const pctPoi = Math.min(100, Math.max(0, stats.poiPercent));
    const pctGlobal = (pctDist * pctPoi) / 100; // Système Hardcore : Distance * Exploration

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
    const matiere = getRankInfo(pctPoi, CONFIG.matieres);
    const globalR = getRankInfo(pctGlobal, CONFIG.rangs);

    // 3. Calculs des Barres de Progression (Objectif Prochain Palier)
    // Si on est à 32% et le prochain palier est 40%, la barre doit être à (32/40)*100 = 80%
    const pctDistBar = animal.nextGoalPct > 0 ? Math.min(100, (pctDist / animal.nextGoalPct) * 100) : 0;
    const pctPoiBar = matiere.nextGoalPct > 0 ? Math.min(100, (pctPoi / matiere.nextGoalPct) * 100) : 0;

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
    // Styles de la carte explorateur : chargés globalement via style/explorer-card.css
    const html = `
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
                        <div id="bar-distance" class="progress-fill" data-width="${pctDistBar}"></div>
                    </div>
                    <div id="goal-distance" class="next-goal">Objectif : ${animal.nextGoalPct}%</div>
                </div>

                <div class="stat-group">
                    <div class="stat-label">
                        <span id="label-matiere">Lieux (${matiere.title})</span>
                        <span id="val-circuits">${stats.visitedPois} / ${stats.totalPois}</span>
                    </div>
                    <div class="progress-bar-container">
                        <div id="bar-circuits" class="progress-fill" data-width="${pctPoiBar}"></div>
                    </div>
                    <div id="goal-circuits" class="next-goal">Objectif : ${matiere.nextGoalPct}%</div>
                </div>
            </div>

            <div class="footer-stats">
                <div>📍 <span id="footer-km">${(stats.totalOfficialKmAvailable - stats.userOfficialKm).toFixed(1)}</span> km à parcourir</div>
                <div>🗺️ <span id="footer-circuits">${stats.totalPois - stats.visitedPois}</span> lieux à découvrir</div>
            </div>
        </div>

        <div class="card-actions">
            <button id="btn-print-card" class="action-btn-print">
                <i data-lucide="printer"></i> Imprimer ma carte
            </button>
        </div>
    </div>
    `;

    const modalPromise = showAlert(
        "Mon Carnet de Voyage",
        html,
        "Fermer",
        "gamification-modal",
        // Callback onReady : Exécuté une fois le DOM de la modale en place
        ({ messageContainer }) => {
            if (messageContainer) {
                // 1. Initialiser les icônes Lucide
                createIcons({ icons: appIcons, root: messageContainer });

                // 2. Appliquer les largeurs des progress-fill via CSSOM (CSP-safe : data-width en template)
                messageContainer.querySelectorAll('.progress-fill[data-width]').forEach(bar => {
                    bar.style.width = `${bar.dataset.width}%`;
                });

                // 3. Attacher l'événement d'impression
                const btnPrint = messageContainer.querySelector('#btn-print-card');
                if (btnPrint) {
                    btnPrint.addEventListener('click', () => {
                        printCardElement();
                    });
                }
            }
        }
    );

    await modalPromise;
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

    // Write full HTML doc for correct rendering.
    // Styles (card + print overrides + @page) chargés via explorer-card.css
    // externe. La classe explorer-card-print-body sur <body> active les
    // règles scopées @page/flex center/color-adjust pour ce contexte iframe.
    // URL absolue via import.meta.env.BASE_URL → compatible GitHub Pages sub-path.
    doc.open();
    doc.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Impression Carte Explorateur</title>
            <link rel="stylesheet" href="${explorerCardCssUrl}">
        </head>
        <body class="explorer-card-print-body">
            ${cardElement.outerHTML}
        </body>
        </html>
    `);
    doc.close();

    // Re-apply progress-fill widths via CSSOM : CSP style-src (sans 'unsafe-inline')
    // strip les style="..." serialisés par outerHTML dans le HTML parsé. Les data-width
    // attributs ne sont pas affectés, donc on reconstruit les largeurs inline post-parse.
    doc.querySelectorAll('.progress-fill[data-width]').forEach(bar => {
        bar.style.width = `${bar.dataset.width}%`;
    });

    // Image loading safety (if SVG relies on ext resources, which it doesn't, but good practice)
    setTimeout(() => {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        setTimeout(() => document.body.removeChild(iframe), 2000); // Cleanup
    }, 500);
}
