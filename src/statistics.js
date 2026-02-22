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

    // 5. Détermination des Rangs et Next Rangs
    // Pour Animaux/Matières, on utilise le pourcentage d'avancement (0-100)
    const distancePercent = totalOfficialDistanceAvailable > 0
        ? (userOfficialDistance / totalOfficialDistanceAvailable) * 100
        : 0;

    const circuitPercent = totalOfficialCircuitsAvailable > 0
        ? (userOfficialCircuits / totalOfficialCircuitsAvailable) * 100
        : 0;

    const animalRank = getRank(ANIMAL_RANKS, distancePercent);
    const nextAnimalRank = getNextRank(ANIMAL_RANKS, distancePercent);

    const materialRank = getRank(MATERIAL_RANKS, circuitPercent);
    const nextMaterialRank = getNextRank(MATERIAL_RANKS, circuitPercent);

    const globalRank = getRank(GLOBAL_RANKS, totalXP);
    const nextGlobalRank = getNextRank(GLOBAL_RANKS, totalXP);

    // 6. Calcul Progression Relative (Rang Actuel -> Rang Suivant)
    const getRelativeProgress = (val, currentR, nextR) => {
        if (!nextR) return 100; // Niveau Max atteint
        const range = nextR.min - currentR.min;
        const current = val - currentR.min;
        // Protection contre division par zéro ou valeurs négatives
        if (range <= 0) return 100;
        return Math.min(100, Math.max(0, (current / range) * 100));
    };

    const animalProgressRel = getRelativeProgress(distancePercent, animalRank, nextAnimalRank);
    const materialProgressRel = getRelativeProgress(circuitPercent, materialRank, nextMaterialRank);
    const xpProgressRel = getRelativeProgress(totalXP, globalRank, nextGlobalRank);

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
        xpProgressRel,

        // Sous-Rangs (pour badges)
        animalRank,
        nextAnimalRank,
        animalProgressRel,

        materialRank,
        nextMaterialRank,
        materialProgressRel,

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
    // Liste triée par min décroissant.
    // On cherche le dernier élément dont le min est > value.
    // Mais ANIMAL_RANKS est décroissant (90, 80...).
    // Donc on veut le rang avec min > value le plus petit possible.
    // En fait, dans une liste décroissante [90, 80, ...], le "Next Rank" est celui juste AVANT le rang actuel dans la liste.

    // Exemple: value=25.
    // getRank renvoie Renard (min 20).
    // Le rang au dessus est Lynx (min 30).

    // On inverse la liste pour chercher croissant [0, 10, 20, 30...]
    const reversed = [...rankList].reverse();
    return reversed.find(r => r.min > value);
}

// --- AFFICHAGE MODALE ---

export async function showStatisticsModal() {
    const stats = calculateStats();

    // -- Titre Complet (Badge) --
    const fullRankTitle = `${stats.animalRank.title} de ${stats.materialRank.title}`;

    // -- HTML: Format CARTE D'EXPLORATEUR (Parchemin) --
    // Dimensions standard ISO/IEC 7810 ID-1 : 85.60 × 53.98 mm

    const html = `
        <div class="walker-card-container">
            <!-- CARTE RECTO -->
            <div class="walker-card" id="walker-card-print">
                <!-- TEXTURE BG (CSS via class) -->

                <!-- ENTÊTE -->
                <div class="card-header">
                    <div class="card-title-main">CARTE D'EXPLORATEUR</div>
                    <div class="card-logo-icon">
                        <i data-lucide="compass" style="width: 100%; height: 100%; color: #5d4037;"></i>
                    </div>
                </div>

                <!-- CONTENU -->
                <div class="card-body">

                    <!-- COLONNE GAUCHE: AVATAR -->
                    <div class="card-col-left">
                        <div class="card-avatar-frame">
                            <i data-lucide="user" style="color: #3e2723; width: 48px; height: 48px;"></i>
                        </div>
                        <div class="card-name">Nom du Marcheur</div>
                    </div>

                    <!-- COLONNE DROITE: STATS -->
                    <div class="card-col-right">
                        <!-- TITRE RANG -->
                        <div class="rank-display">
                            <span class="rank-text-large">${fullRankTitle.toUpperCase()}</span>
                        </div>

                        <!-- BARRE 1: DISTANCE (ANIMAL) -->
                        <div class="stat-group">
                            <div class="stat-label">
                                <span>DISTANCE (${stats.animalRank.title.toUpperCase()})</span>
                            </div>
                            <div class="progress-bar-container">
                                <div class="progress-bar-fill animal-fill" style="width: ${stats.animalProgressRel}%;"></div>
                            </div>
                            <div class="stat-sublabel">
                                ${stats.nextAnimalRank ? 'Prochain: ' + stats.nextAnimalRank.title : 'Niveau Max !'}
                            </div>
                        </div>

                        <!-- BARRE 2: CIRCUITS (MATIERE) -->
                        <div class="stat-group">
                            <div class="stat-label">
                                <span>CIRCUITS (${stats.materialRank.title.toUpperCase()})</span>
                            </div>
                            <div class="progress-bar-container">
                                <div class="progress-bar-fill material-fill" style="width: ${stats.materialProgressRel}%;"></div>
                            </div>
                            <div class="stat-sublabel">
                                ${stats.nextMaterialRank ? 'Prochain: ' + stats.nextMaterialRank.title : 'Niveau Max !'}
                            </div>
                        </div>

                        <!-- BARRE 3: XP (GLOBAL) -->
                        <div class="stat-group">
                            <div class="stat-label">
                                <span>POINTS D'AVENTURE</span>
                            </div>
                            <div class="progress-bar-container">
                                <div class="progress-bar-fill xp-fill" style="width: ${stats.xpProgressRel}%;"></div>
                            </div>
                            <div class="stat-sublabel-right">
                                Rang Global: <strong>${stats.globalRank.title}</strong>
                            </div>
                        </div>

                    </div>
                </div>

                <!-- FOOTER -->
                <div class="card-footer">
                    <div class="footer-item">
                        <i data-lucide="map-pin" class="footer-icon"></i> POI: ${stats.visitedPois}
                    </div>
                    <div class="footer-divider">|</div>
                    <div class="footer-item">
                        <i data-lucide="compass" class="footer-icon"></i> EXPLORÉ: ${stats.poiPercent}%
                    </div>
                    <div class="footer-divider">|</div>
                    <div class="footer-item">
                        <i data-lucide="map" class="footer-icon"></i> DISPO: ${stats.totalOfficialCircuitsAvailable}
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
            /* --- FONTS --- */
            @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&family=Lato:wght@400;700&display=swap');

            /* --- CONTAINER --- */
            .walker-card-container {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 20px;
                padding: 10px;
                background: transparent;
            }

            /* --- CARD BASE --- */
            .walker-card {
                position: relative;
                width: 340px;
                height: 215px; /* Ratio ID-1 */
                background-color: #f4e4bc; /* Parchment Fallback */
                /* Texture parchemin via CSS gradient pattern */
                background-image:
                    radial-gradient(circle at 10% 20%, rgba(0,0,0,0.05) 0%, transparent 20%),
                    radial-gradient(circle at 90% 80%, rgba(0,0,0,0.05) 0%, transparent 20%),
                    linear-gradient(to bottom right, #fdfbf7, #e6d0a0);
                border-radius: 10px;
                box-shadow: 0 10px 20px rgba(0,0,0,0.3);
                display: flex;
                flex-direction: column;
                overflow: hidden;
                color: #3e2723; /* Dark Brown */
                font-family: 'Lato', sans-serif;
                border: 1px solid #d7c59a;
            }

            /* --- HEADER --- */
            .card-header {
                display: flex;
                align-items: center;
                padding: 10px 15px 5px 15px;
            }

            .card-title-main {
                font-family: 'Cinzel', serif;
                font-weight: 700;
                font-size: 14px;
                line-height: 1;
                text-transform: uppercase;
                letter-spacing: 1px;
                color: #2d1b15;
            }

            .card-logo-icon {
                margin-left: 8px;
                width: 16px;
                height: 16px;
                opacity: 0.8;
            }

            /* --- BODY --- */
            .card-body {
                display: flex;
                flex: 1;
                padding: 5px 15px;
                gap: 15px;
            }

            /* LEFT COL */
            .card-col-left {
                width: 30%;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
            }

            .card-avatar-frame {
                width: 70px;
                height: 70px;
                background: #d7ccc8;
                border: 3px solid #5d4037;
                border-radius: 50%; /* Cercle pour l'avatar */
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: inset 0 2px 5px rgba(0,0,0,0.2);
                margin-bottom: 5px;
            }

            .card-name {
                font-family: 'Cinzel', serif;
                font-size: 9px;
                font-weight: 700;
                text-align: center;
                line-height: 1.2;
            }

            /* RIGHT COL */
            .card-col-right {
                flex: 1;
                display: flex;
                flex-direction: column;
                justify-content: center;
                gap: 6px;
            }

            .rank-display {
                margin-bottom: 4px;
            }

            .rank-text-large {
                font-family: 'Cinzel', serif;
                font-weight: 800;
                font-size: 16px;
                color: #3e2723;
                text-transform: uppercase;
                text-shadow: 0 1px 0px rgba(255,255,255,0.5);
                display: block;
                line-height: 1;
            }

            /* STAT GROUPS */
            .stat-group {
                display: flex;
                flex-direction: column;
                gap: 2px;
            }

            .stat-label {
                font-size: 8px;
                font-weight: 700;
                text-transform: uppercase;
                display: flex;
                justify-content: space-between;
                opacity: 0.9;
            }

            .stat-sublabel {
                font-size: 7px;
                font-style: italic;
                opacity: 0.7;
                text-align: right;
            }
            .stat-sublabel-right {
                font-size: 7px;
                text-align: right;
                opacity: 0.8;
            }

            .progress-bar-container {
                width: 100%;
                height: 10px; /* Plus épais comme sur l'image */
                background: rgba(62, 39, 35, 0.15); /* Brownish light */
                border-radius: 5px;
                overflow: hidden;
                box-shadow: inset 0 1px 2px rgba(0,0,0,0.1);
                border: 1px solid rgba(62, 39, 35, 0.1);
            }

            .progress-bar-fill {
                height: 100%;
                border-radius: 4px;
                /* Gradient métallique générique, surchargé ci-dessous */
                background: linear-gradient(to bottom, #d7ccc8, #a1887f);
                box-shadow: 0 1px 0 rgba(255,255,255,0.3) inset;
            }

            /* Specific Gradients mimicking metals/earth */
            .animal-fill {
                /* Copper/Bronze style */
                background: linear-gradient(to bottom, #ffccbc, #bf360c);
            }
            .material-fill {
                /* Steel/Gold style - dynamically set? For now static Bronze/Gold mix */
                background: linear-gradient(to bottom, #fff9c4, #fbc02d);
            }
            .xp-fill {
                /* Blue/Mystic style or Green */
                background: linear-gradient(to bottom, #b2dfdb, #00695c);
            }

            /* --- FOOTER --- */
            .card-footer {
                height: 24px;
                background: #efebe9; /* Lighter brown */
                border-top: 1px solid #d7ccc8;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
            }

            .footer-item {
                display: flex;
                align-items: center;
                gap: 4px;
                font-size: 8px;
                font-weight: 700;
                color: #5d4037;
                text-transform: uppercase;
            }

            .footer-icon {
                width: 10px;
                height: 10px;
                color: #8d6e63;
            }

            .footer-divider {
                color: #a1887f;
                font-size: 8px;
            }

            /* --- PRINT BUTTON --- */
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

            /* --- PRINT MEDIA QUERY --- */
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
                    width: 85.6mm !important;
                    height: 53.98mm !important;
                    box-shadow: none !important;
                    border: 1px dashed #ccc;
                    print-color-adjust: exact !important;
                    -webkit-print-color-adjust: exact !important;
                }

                /* Font Scaling for Print */
                .card-title-main { font-size: 10pt !important; }
                .card-name { font-size: 6pt !important; }
                .rank-text-large { font-size: 11pt !important; }
                .stat-label { font-size: 5pt !important; }
                .stat-sublabel, .stat-sublabel-right { font-size: 4pt !important; }
                .footer-item { font-size: 5pt !important; }

                .card-avatar-frame {
                    width: 15mm !important;
                    height: 15mm !important;
                }
                .progress-bar-container { height: 2mm !important; }
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

    // Copy computed styles for gradients/bg
    // Note: CSS defined in style block is not auto-copied to iframe head unless we inject it.
    // So we need to inject the CSS block again or inline styles.
    // The previous implementation injected styles in the iframe head.

    doc.open();
    doc.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Impression Carte Walker</title>
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&family=Lato:wght@400;700&display=swap');
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
                    font-family: 'Lato', sans-serif;
                }
                .walker-card {
                    position: relative;
                    width: 85.6mm;
                    height: 53.98mm;
                    background-color: #f4e4bc;
                    background-image:
                        radial-gradient(circle at 10% 20%, rgba(0,0,0,0.05) 0%, transparent 20%),
                        radial-gradient(circle at 90% 80%, rgba(0,0,0,0.05) 0%, transparent 20%),
                        linear-gradient(to bottom right, #fdfbf7, #e6d0a0);
                    border-radius: 3.18mm;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    color: #3e2723;
                    border: 1px dashed #ccc;
                    print-color-adjust: exact;
                    -webkit-print-color-adjust: exact;
                }

                /* Layout Replication */
                .card-header { display: flex; align-items: center; padding: 2mm 4mm 1mm 4mm; }
                .card-title-main { font-family: 'Cinzel', serif; font-weight: 700; font-size: 10pt; line-height: 1; text-transform: uppercase; letter-spacing: 1px; color: #2d1b15; }
                .card-logo-icon { margin-left: 2mm; width: 3mm; height: 3mm; opacity: 0.8; }

                .card-body { display: flex; flex: 1; padding: 1mm 4mm; gap: 4mm; }

                .card-col-left { width: 30%; display: flex; flex-direction: column; align-items: center; justify-content: center; }
                .card-avatar-frame { width: 15mm; height: 15mm; background: #d7ccc8; border: 0.5mm solid #5d4037; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 1mm; }
                .card-name { font-family: 'Cinzel', serif; font-size: 6pt; font-weight: 700; text-align: center; }

                .card-col-right { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 1.5mm; }
                .rank-display { margin-bottom: 1mm; }
                .rank-text-large { font-family: 'Cinzel', serif; font-weight: 800; font-size: 11pt; color: #3e2723; text-transform: uppercase; line-height: 1; }

                .stat-group { display: flex; flex-direction: column; gap: 0.5mm; }
                .stat-label { font-size: 5pt; font-weight: 700; text-transform: uppercase; display: flex; justify-content: space-between; opacity: 0.9; }
                .stat-sublabel { font-size: 4pt; font-style: italic; opacity: 0.7; text-align: right; }
                .stat-sublabel-right { font-size: 4pt; text-align: right; opacity: 0.8; }

                .progress-bar-container { width: 100%; height: 2mm; background: rgba(62, 39, 35, 0.15); border-radius: 1mm; overflow: hidden; border: 0.1mm solid rgba(62, 39, 35, 0.1); }
                .progress-bar-fill { height: 100%; border-radius: 1mm; }

                .animal-fill { background: linear-gradient(to bottom, #ffccbc, #bf360c); }
                .material-fill { background: linear-gradient(to bottom, #fff9c4, #fbc02d); }
                .xp-fill { background: linear-gradient(to bottom, #b2dfdb, #00695c); }

                .card-footer { height: 5mm; background: #efebe9; border-top: 0.2mm solid #d7ccc8; display: flex; align-items: center; justify-content: center; gap: 2mm; }
                .footer-item { display: flex; align-items: center; gap: 1mm; font-size: 5pt; font-weight: 700; color: #5d4037; text-transform: uppercase; }
                .footer-icon { width: 2mm; height: 2mm; color: #8d6e63; }
                .footer-divider { color: #a1887f; font-size: 5pt; }

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
