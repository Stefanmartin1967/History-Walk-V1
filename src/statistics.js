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
    if (stats.nextGlobalRank) {
        const range = stats.nextGlobalRank.min - stats.globalRank.min;
        const current = stats.totalXP - stats.globalRank.min;
        xpProgress = Math.min(100, Math.max(5, (current / range) * 100));
    } else {
        xpProgress = 100;
    }

    // -- Titre Complet (Badge) --
    const badgeTitle = `${stats.animalRank.title} de ${stats.materialRank.title}`;

    // -- Image de fond --
    // Pour GitHub Pages, on utilise le chemin relatif ou absolu complet si nécessaire
    // On suppose que le serveur sert la racine correctement
    const bgImage = './images/gamification/id_card_bg.png';

    // -- HTML: Format CARTE BANCAIRE (Paysage) --
    // Dimensions standard ISO/IEC 7810 ID-1 : 85.60 × 53.98 mm -> Ratio ~1.58

    const html = `
        <div class="walker-card-container">
            <!-- CARTE RECTO -->
            <div class="walker-card" id="walker-card-print" style="background-image: url('${bgImage}');">

                <!-- ENTÊTE GAUCHE -->
                <div class="card-header-left">
                    <div class="card-title-small">CARTE D'EXPLORATEUR</div>
                </div>

                <!-- BADGE CENTRAL (Rank Icon) -->
                <div class="card-badge">
                    <i data-lucide="${stats.animalRank.icon}" style="color: ${stats.materialRank.color}; width: 24px; height: 24px;"></i>
                </div>

                <!-- CONTENU PRINCIPAL -->
                <div class="card-body">

                    <!-- COLONNE GAUCHE (Avatar + Identité) -->
                    <div class="card-col-left">
                        <div class="card-avatar-wrapper">
                            <div class="card-avatar" style="border-color: ${stats.materialRank.color};">
                                <i data-lucide="user" style="color: white; width: 32px; height: 32px;"></i>
                            </div>
                        </div>
                        <div class="card-identity-block">
                            <div class="card-user-name">MARCHEUR</div>
                            <div class="card-user-rank">${stats.globalRank.title}</div>
                        </div>
                    </div>

                    <!-- COLONNE DROITE (Rangs + Stats) -->
                    <div class="card-col-right">
                        <!-- RANG TITLE -->
                        <div class="rank-title-block">
                            <div class="rank-main-title" style="color: ${stats.materialRank.color}; text-shadow: 0 1px 2px rgba(0,0,0,0.8);">${badgeTitle.toUpperCase()}</div>
                            <div class="rank-subtitle">Rang ${stats.animalRank.description}</div>
                        </div>

                        <!-- PROGRESS BARS -->
                        <div class="stats-bars-container">
                            <!-- DISTANCE -->
                            <div class="stat-row">
                                <div class="stat-info">
                                    <span class="stat-lbl">DISTANCE</span>
                                    <span class="stat-val">${stats.userOfficialKm} <span class="unit">km</span></span>
                                </div>
                                <div class="stat-track">
                                    <div class="stat-fill" style="width: ${stats.distancePercent}%; background: ${stats.materialRank.color};"></div>
                                </div>
                            </div>

                            <!-- CIRCUITS -->
                            <div class="stat-row">
                                <div class="stat-info">
                                    <span class="stat-lbl">CIRCUITS</span>
                                    <span class="stat-val">${stats.userOfficialCircuits} <span class="unit">/ ${stats.totalOfficialCircuitsAvailable}</span></span>
                                </div>
                                <div class="stat-track">
                                    <div class="stat-fill" style="width: ${stats.circuitPercent}%; background: ${stats.materialRank.color};"></div>
                                </div>
                            </div>
                        </div>

                        <!-- XP (Bottom Right) -->
                        <div class="xp-block">
                            <div class="xp-val">${stats.totalXP}</div>
                            <div class="xp-lbl">Points d'Aventure</div>
                        </div>
                    </div>
                </div>

                <!-- FOOTER (Data Strip) -->
                <div class="card-footer-strip">
                    <div class="strip-item">
                        <span class="strip-lbl">LIEUX</span>
                        <span class="strip-val">${stats.visitedPois}</span>
                    </div>
                    <div class="strip-item">
                        <span class="strip-lbl">EXPLORATION</span>
                        <span class="strip-val">${stats.poiPercent}%</span>
                    </div>
                    <div class="strip-item">
                        <span class="strip-lbl">ID</span>
                        <span class="strip-val">HW-${new Date().getFullYear()}-001</span>
                    </div>
                </div>
            </div>

            <!-- BOUTON IMPRESSION -->
            <div class="card-actions">
                <button id="btn-print-card" class="action-btn-print">
                    <i data-lucide="printer"></i> Imprimer ma carte
                </button>
            </div>
        </div>

        <style>
            /* --- CONTENEUR GLOBAL --- */
            .walker-card-container {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 20px;
                padding: 10px;
                background: transparent;
            }

            /* --- LA CARTE --- */
            .walker-card {
                position: relative;
                width: 340px; /* Largeur écran */
                height: 215px; /* Ratio ~1.58 */
                background-color: #1a202c; /* Fallback color */
                background-size: cover;
                background-position: center;
                background-repeat: no-repeat;
                border-radius: 12px;
                box-shadow: 0 10px 25px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1);
                display: flex;
                flex-direction: column;
                overflow: hidden;
                color: white;
                font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            }

            /* --- HEADER --- */
            .card-header-left {
                position: absolute;
                top: 14px;
                left: 18px;
            }

            .card-title-small {
                font-size: 9px;
                text-transform: uppercase;
                letter-spacing: 1px;
                opacity: 0.9;
                font-weight: 700;
                text-shadow: 0 1px 2px rgba(0,0,0,0.8);
                color: #e2e8f0;
            }

            /* --- BADGE --- */
            .card-badge {
                position: absolute;
                top: 14px;
                left: 142px; /* Ajusté visuellement */
                width: 36px;
                height: 36px;
                border-radius: 50%;
                background: white;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                z-index: 10;
                border: 2px solid #ccc;
            }

            /* --- BODY --- */
            .card-body {
                display: flex;
                flex: 1;
                margin-top: 25px; /* Espace pour le header */
                padding: 0 15px 5px 15px;
            }

            /* --- LEFT COL --- */
            .card-col-left {
                width: 35%;
                display: flex;
                flex-direction: column;
                align-items: center;
                padding-top: 12px;
            }

            .card-avatar-wrapper {
                margin-bottom: 8px;
            }

            .card-avatar {
                width: 64px;
                height: 64px;
                border-radius: 50%; /* Cercle ou Carré arrondi selon préférence */
                background: rgba(0,0,0,0.5); /* Plus sombre pour couvrir BG */
                border: 2px solid white;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 4px 8px rgba(0,0,0,0.3);
            }

            .card-identity-block {
                text-align: center;
            }

            .card-user-name {
                font-size: 10px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                margin-bottom: 2px;
                text-shadow: 0 1px 2px rgba(0,0,0,0.8);
            }

            .card-user-rank {
                font-size: 8px;
                opacity: 0.8;
                font-style: italic;
            }

            /* --- RIGHT COL --- */
            .card-col-right {
                flex: 1;
                display: flex;
                flex-direction: column;
                padding-left: 10px;
            }

            .rank-title-block {
                text-align: right;
                margin-bottom: 15px;
            }

            .rank-main-title {
                font-size: 14px;
                font-weight: 800;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                line-height: 1.1;
            }

            .rank-subtitle {
                font-size: 9px;
                font-style: italic;
                opacity: 0.7;
            }

            .stats-bars-container {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            .stat-row {
                display: flex;
                flex-direction: column;
                gap: 2px;
            }

            .stat-info {
                display: flex;
                justify-content: space-between;
                font-size: 8px;
                font-weight: 600;
                text-transform: uppercase;
                opacity: 0.9;
            }

            .stat-val .unit {
                opacity: 0.6;
                font-size: 7px;
            }

            .stat-track {
                width: 100%;
                height: 4px;
                background: rgba(255,255,255,0.15);
                border-radius: 2px;
                overflow: hidden;
            }

            .stat-fill {
                height: 100%;
                border-radius: 2px;
            }

            .xp-block {
                margin-top: auto;
                text-align: right;
                padding-bottom: 5px;
            }

            .xp-val {
                font-size: 16px;
                font-weight: 800;
                line-height: 1;
                text-shadow: 0 1px 2px rgba(0,0,0,0.8);
            }

            .xp-lbl {
                font-size: 7px;
                text-transform: uppercase;
                opacity: 0.6;
            }

            /* --- FOOTER STRIP --- */
            .card-footer-strip {
                height: 24px;
                background: rgba(0,0,0,0.4);
                backdrop-filter: blur(2px);
                display: flex;
                align-items: center;
                justify-content: space-around;
                border-top: 1px solid rgba(255,255,255,0.1);
            }

            .strip-item {
                display: flex;
                align-items: center;
                gap: 4px;
            }

            .strip-lbl {
                font-size: 7px;
                text-transform: uppercase;
                opacity: 0.5;
            }

            .strip-val {
                font-size: 9px;
                font-weight: 700;
            }

            /* --- BOUTON PRINT --- */
            .action-btn-print {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 10px 20px;
                background: var(--surface);
                border: 1px solid var(--line);
                border-radius: 8px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s;
                color: var(--ink);
            }

            .action-btn-print:hover {
                background: var(--surface-muted);
                transform: translateY(-1px);
            }

            /* --- STYLE D'IMPRESSION --- */
            @media print {
                body * {
                    visibility: hidden;
                }
                #custom-modal-message, #custom-modal-message * {
                    visibility: visible;
                }
                .custom-modal-overlay, .custom-modal-box, .custom-modal-title, .custom-modal-actions, .card-actions {
                    display: none !important;
                }

                .walker-card-container {
                    position: fixed;
                    left: 50%;
                    top: 50%;
                    transform: translate(-50%, -50%);
                    width: 100%;
                    height: 100%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: white !important;
                    padding: 0;
                    margin: 0;
                }

                .walker-card {
                    /* Force Print Size - ISO ID-1 */
                    width: 85.6mm !important;
                    height: 53.98mm !important;
                    box-shadow: none !important;
                    border: 1px dashed #ccc;
                    print-color-adjust: exact !important;
                    -webkit-print-color-adjust: exact !important;
                    background-image: url('${bgImage}') !important; /* Ensure BG prints */
                }

                /* Scale fonts for physical size */
                .card-title-small { font-size: 5pt !important; }
                .card-user-name { font-size: 7pt !important; }
                .card-user-rank { font-size: 5pt !important; }
                .rank-main-title { font-size: 9pt !important; }
                .rank-subtitle { font-size: 6pt !important; }
                .stat-info { font-size: 5pt !important; }
                .stat-val .unit { font-size: 4pt !important; }
                .xp-val { font-size: 10pt !important; }
                .xp-lbl { font-size: 4pt !important; }
                .strip-lbl { font-size: 4pt !important; }
                .strip-val { font-size: 6pt !important; }

                .card-avatar {
                    width: 14mm !important;
                    height: 14mm !important;
                }
            }
        </style>
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
    const cardElement = document.getElementById('walker-card-print');
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
    const cardClone = cardElement.cloneNode(true);

    // Récupérer l'image de fond computed
    const bgStyle = window.getComputedStyle(cardElement).backgroundImage;
    cardClone.style.backgroundImage = bgStyle;

    doc.open();
    doc.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Impression Carte Walker</title>
            <style>
                @page {
                    size: A4;
                    margin: 0;
                }
                body {
                    margin: 0;
                    padding: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                    font-family: sans-serif;
                }
                .walker-card {
                    position: relative;
                    width: 85.6mm;
                    height: 53.98mm;
                    background-color: #1a202c; /* Fallback */
                    background-size: cover;
                    background-position: center;
                    background-repeat: no-repeat;
                    border-radius: 3.18mm;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    color: white;
                    border: 1px dashed #ccc;
                    print-color-adjust: exact;
                    -webkit-print-color-adjust: exact;
                }

                /* Réplication Styles CSS */
                .card-header-left { position: absolute; top: 3.5mm; left: 4.5mm; }
                .card-title-small { font-size: 6pt; text-transform: uppercase; letter-spacing: 1px; opacity: 0.9; font-weight: 700; text-shadow: 0 1px 2px rgba(0,0,0,0.8); color: #e2e8f0; }

                .card-badge { position: absolute; top: 3.5mm; left: 35.5mm; width: 9mm; height: 9mm; border-radius: 50%; background: white; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.3); z-index: 10; border: 0.5mm solid #ccc; }

                .card-body { display: flex; flex: 1; margin-top: 6mm; padding: 0 4mm 1.5mm 4mm; }

                .card-col-left { width: 35%; display: flex; flex-direction: column; align-items: center; padding-top: 3mm; }
                .card-avatar-wrapper { margin-bottom: 2mm; }
                .card-avatar { width: 14mm; height: 14mm; border-radius: 50%; background: rgba(0,0,0,0.5); border: 0.5mm solid white; display: flex; align-items: center; justify-content: center; }
                .card-identity-block { text-align: center; }
                .card-user-name { font-size: 7pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 0.5mm; text-shadow: 0 1px 2px rgba(0,0,0,0.8); }
                .card-user-rank { font-size: 5pt; opacity: 0.8; font-style: italic; }

                .card-col-right { flex: 1; display: flex; flex-direction: column; padding-left: 2mm; }
                .rank-title-block { text-align: right; margin-bottom: 3mm; }
                .rank-main-title { font-size: 9pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; line-height: 1.1; }
                .rank-subtitle { font-size: 6pt; font-style: italic; opacity: 0.7; }

                .stats-bars-container { display: flex; flex-direction: column; gap: 2mm; }
                .stat-row { display: flex; flex-direction: column; gap: 0.5mm; }
                .stat-info { display: flex; justify-content: space-between; font-size: 5pt; font-weight: 600; text-transform: uppercase; opacity: 0.9; }
                .stat-val .unit { opacity: 0.6; font-size: 4pt; }
                .stat-track { width: 100%; height: 1mm; background: rgba(255,255,255,0.15); border-radius: 0.5mm; overflow: hidden; }
                .stat-fill { height: 100%; border-radius: 0.5mm; }

                .xp-block { margin-top: auto; text-align: right; padding-bottom: 1mm; }
                .xp-val { font-size: 10pt; font-weight: 800; line-height: 1; text-shadow: 0 1px 2px rgba(0,0,0,0.8); }
                .xp-lbl { font-size: 4pt; text-transform: uppercase; opacity: 0.6; }

                .card-footer-strip { height: 6mm; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: space-around; border-top: 0.2mm solid rgba(255,255,255,0.1); }
                .strip-item { display: flex; align-items: center; gap: 1mm; }
                .strip-lbl { font-size: 4pt; text-transform: uppercase; opacity: 0.5; }
                .strip-val { font-size: 6pt; font-weight: 700; }

                svg { width: 100%; height: 100%; }
            </style>
        </head>
        <body>
            <!-- Content -->
        </body>
        </html>
    `);

    doc.body.innerHTML = cardClone.outerHTML;
    doc.close();

    setTimeout(() => {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        setTimeout(() => document.body.removeChild(iframe), 2000);
    }, 500);
}
