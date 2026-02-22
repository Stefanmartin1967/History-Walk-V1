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

    // -- HTML: Format CARTE BANCAIRE (Paysage) --
    // Dimensions standard ISO/IEC 7810 ID-1 : 85.60 × 53.98 mm -> Ratio ~1.58
    // On va utiliser un conteneur relatif et une mise en page CSS Grid/Flex

    const html = `
        <div class="walker-card-container">
            <!-- CARTE RECTO -->
            <div class="walker-card" id="walker-card-print">
                <!-- COLONNE GAUCHE : IDENTITÉ -->
                <div class="card-left-col">
                    <div class="card-avatar-container ${stats.materialRank.cssClass}" style="border-color: ${stats.materialRank.color}; box-shadow: 0 0 10px ${stats.materialRank.color}40;">
                        <i data-lucide="${stats.animalRank.icon}" class="card-avatar-icon" style="color: ${stats.materialRank.color};"></i>
                    </div>
                    <div class="card-identity-text">
                        <div class="identity-name">History Walk</div>
                        <div class="identity-rank" style="color: ${stats.materialRank.color};">${stats.globalRank.title}</div>
                        <div class="identity-badge">${badgeTitle}</div>
                    </div>
                </div>

                <!-- COLONNE DROITE : STATS -->
                <div class="card-right-col">
                    <!-- XP BAR -->
                    <div class="stat-mini-row">
                        <div class="stat-label-mini">XP <span class="stat-val-mini">${stats.totalXP}</span></div>
                        <div class="progress-track-mini">
                            <div class="progress-fill-mini" style="width: ${xpProgress}%; background: linear-gradient(90deg, ${stats.materialRank.color}, var(--brand));"></div>
                        </div>
                    </div>

                    <!-- DISTANCE -->
                    <div class="stat-mini-row">
                        <div class="stat-label-mini">
                            <i data-lucide="footprints" class="mini-icon"></i> ${stats.userOfficialKm} km
                        </div>
                        <div class="progress-track-mini">
                            <div class="progress-fill-mini" style="width: ${stats.distancePercent}%; background: var(--brand);"></div>
                        </div>
                    </div>

                    <!-- CIRCUITS -->
                    <div class="stat-mini-row">
                        <div class="stat-label-mini">
                            <i data-lucide="map" class="mini-icon"></i> ${stats.userOfficialCircuits} circ.
                        </div>
                        <div class="progress-track-mini">
                            <div class="progress-fill-mini" style="width: ${stats.circuitPercent}%; background: ${stats.materialRank.color};"></div>
                        </div>
                    </div>

                    <!-- MINI STATS GRID (Bas de carte) -->
                    <div class="card-mini-grid">
                        <div class="grid-item">
                            <div class="grid-val">${stats.visitedPois}</div>
                            <div class="grid-lbl">Lieux</div>
                        </div>
                        <div class="grid-item">
                            <div class="grid-val">${stats.poiPercent}%</div>
                            <div class="grid-lbl">Découv.</div>
                        </div>
                    </div>
                </div>

                <!-- BANDE DECO EN BAS -->
                <div class="card-bottom-strip" style="background: ${stats.materialRank.color};"></div>
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
                width: 340px; /* Base width */
                height: 215px; /* Ratio ~1.58 (Bank Card) */
                background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); /* Dark theme default */
                border-radius: 12px; /* Rounded corners standard ISO */
                box-shadow: 0 10px 25px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.1);
                display: flex;
                overflow: hidden;
                color: white;
                font-family: 'Segoe UI', system-ui, sans-serif;
            }

            /* Mode Clair Support (Optionnel, ici on force un look "Carte Premium" sombre) */

            /* --- COLONNE GAUCHE --- */
            .card-left-col {
                width: 40%;
                padding: 15px;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                background: rgba(255,255,255,0.03);
                border-right: 1px solid rgba(255,255,255,0.05);
                z-index: 2;
            }

            .card-avatar-container {
                width: 64px;
                height: 64px;
                border-radius: 50%;
                background: rgba(255,255,255,0.1);
                border: 3px solid #ccc; /* Default */
                display: flex;
                align-items: center;
                justify-content: center;
                margin-bottom: 12px;
                box-shadow: 0 4px 10px rgba(0,0,0,0.2);
            }

            .card-avatar-icon {
                width: 32px;
                height: 32px;
            }

            .card-identity-text {
                text-align: center;
            }

            .identity-name {
                font-size: 10px;
                text-transform: uppercase;
                letter-spacing: 1px;
                opacity: 0.6;
                margin-bottom: 4px;
            }

            .identity-rank {
                font-size: 16px; /* Plus petit pour tenir */
                font-weight: 700;
                line-height: 1.2;
                margin-bottom: 4px;
                text-transform: uppercase;
            }

            .identity-badge {
                font-size: 11px;
                font-style: italic;
                opacity: 0.8;
                color: #cbd5e1;
            }

            /* --- COLONNE DROITE --- */
            .card-right-col {
                flex: 1;
                padding: 15px 15px 25px 15px; /* Bottom padding pour la bande */
                display: flex;
                flex-direction: column;
                justify-content: center;
                gap: 12px;
                position: relative;
                z-index: 2;
            }

            .stat-mini-row {
                width: 100%;
            }

            .stat-label-mini {
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 11px;
                font-weight: 600;
                margin-bottom: 4px;
                color: #e2e8f0;
            }

            .stat-val-mini {
                font-weight: 700;
                color: white;
            }

            .mini-icon {
                width: 12px;
                height: 12px;
                margin-right: 4px;
                opacity: 0.7;
            }

            .progress-track-mini {
                width: 100%;
                height: 6px;
                background: rgba(255,255,255,0.1);
                border-radius: 3px;
                overflow: hidden;
            }

            .progress-fill-mini {
                height: 100%;
                border-radius: 3px;
                transition: width 0.5s ease;
            }

            .card-mini-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 8px;
                margin-top: 4px;
            }

            .grid-item {
                background: rgba(255,255,255,0.05);
                border-radius: 6px;
                padding: 4px;
                text-align: center;
                border: 1px solid rgba(255,255,255,0.05);
            }

            .grid-val {
                font-size: 13px;
                font-weight: 700;
                color: white;
            }

            .grid-lbl {
                font-size: 9px;
                text-transform: uppercase;
                opacity: 0.6;
            }

            /* --- BANDE DECO --- */
            .card-bottom-strip {
                position: absolute;
                bottom: 0;
                left: 0;
                width: 100%;
                height: 6px;
                z-index: 1;
                opacity: 0.8;
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

            /* --- STYLE D'IMPRESSION SPÉCIFIQUE --- */
            @media print {
                body * {
                    visibility: hidden;
                }
                #custom-modal-message, #custom-modal-message * {
                    visibility: visible;
                }
                /* Cacher tout sauf la carte */
                .custom-modal-overlay, .custom-modal-box, .custom-modal-title, .custom-modal-actions, .card-actions {
                    display: none !important;
                }

                /* Positionner la carte au centre de la page A4 */
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
                    background: white !important; /* Force white paper bg */
                    padding: 0;
                    margin: 0;
                }

                .walker-card {
                    /* Force Print Size */
                    width: 85.6mm !important;
                    height: 53.98mm !important;
                    box-shadow: none !important; /* No shadow on print */
                    border: 1px solid #ddd; /* Light border for cutting */
                    print-color-adjust: exact !important;
                    -webkit-print-color-adjust: exact !important;
                }

                /* Ajuster les polices pour la taille physique */
                .identity-rank { font-size: 11pt !important; }
                .identity-badge { font-size: 7pt !important; }
                .stat-label-mini { font-size: 6pt !important; }
                .grid-val { font-size: 8pt !important; }
                .grid-lbl { font-size: 5pt !important; }
                .card-avatar-container { width: 15mm !important; height: 15mm !important; }
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
                // Créer une fenêtre d'impression dédiée pour éviter les conflits CSS globaux
                printCardElement();
            });
        }
    }
}

function printCardElement() {
    const cardElement = document.getElementById('walker-card-print');
    if (!cardElement) return;

    // Créer une iframe invisible pour l'impression
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow.document;

    // Récupérer les styles calculés ou insérer les styles nécessaires
    // Pour simplifier, on réinjecte le style de la carte
    // On doit cloner l'élément pour ne pas déplacer l'original
    const cardClone = cardElement.cloneNode(true);

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
                    background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
                    border-radius: 3.18mm; /* Standard corner radius ~3mm */
                    display: flex;
                    overflow: hidden;
                    color: white;
                    border: 1px dashed #ccc; /* Guide de découpe */
                    print-color-adjust: exact;
                    -webkit-print-color-adjust: exact;
                }

                /* Réplication des styles CSS de la modale pour l'impression */
                /* Copier ici les styles critiques */
                .card-left-col {
                    width: 40%;
                    padding: 4mm;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    background: rgba(255,255,255,0.03);
                    border-right: 1px solid rgba(255,255,255,0.05);
                    box-sizing: border-box;
                }
                .card-right-col {
                    flex: 1;
                    padding: 4mm 4mm 6mm 4mm;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    gap: 3mm;
                    position: relative;
                    box-sizing: border-box;
                }
                .card-avatar-container {
                    width: 15mm;
                    height: 15mm;
                    border-radius: 50%;
                    background: rgba(255,255,255,0.1);
                    border: 1px solid #ccc;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin-bottom: 3mm;
                }
                .card-avatar-icon {
                    width: 8mm;
                    height: 8mm;
                }
                .identity-name {
                    font-size: 6pt;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                    opacity: 0.6;
                    margin-bottom: 1mm;
                    text-align: center;
                }
                .identity-rank {
                    font-size: 9pt;
                    font-weight: 700;
                    line-height: 1.2;
                    margin-bottom: 1mm;
                    text-transform: uppercase;
                    text-align: center;
                }
                .identity-badge {
                    font-size: 7pt;
                    font-style: italic;
                    opacity: 0.8;
                    color: #cbd5e1;
                    text-align: center;
                }
                .stat-mini-row { width: 100%; }
                .stat-label-mini {
                    display: flex;
                    justify-content: space-between;
                    font-size: 6pt;
                    font-weight: 600;
                    margin-bottom: 1mm;
                    color: #e2e8f0;
                }
                .progress-track-mini {
                    width: 100%;
                    height: 1.5mm;
                    background: rgba(255,255,255,0.1);
                    border-radius: 1mm;
                    overflow: hidden;
                }
                .progress-fill-mini {
                    height: 100%;
                    border-radius: 1mm;
                }
                .card-mini-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 2mm;
                    margin-top: 2mm;
                }
                .grid-item {
                    background: rgba(255,255,255,0.05);
                    border-radius: 2mm;
                    padding: 1mm;
                    text-align: center;
                    border: 1px solid rgba(255,255,255,0.05);
                }
                .grid-val { font-size: 8pt; font-weight: 700; }
                .grid-lbl { font-size: 5pt; text-transform: uppercase; opacity: 0.6; }
                .card-bottom-strip {
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    width: 100%;
                    height: 1.5mm;
                    z-index: 1;
                    opacity: 0.8;
                }
                /* Reset icons */
                svg { width: 100%; height: 100%; }
            </style>
            <!-- Lucide Icons Script from CDN for the print preview if needed, or inline SVG -->
            <!-- Since we use createIcons, the SVGs are already in the DOM structure of cardClone -->
        </head>
        <body>
            <!-- Content -->
        </body>
        </html>
    `);

    doc.body.appendChild(cardClone);
    doc.close();

    // Attendre que le contenu soit rendu
    setTimeout(() => {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        // Nettoyage après impression (ou annulation)
        setTimeout(() => document.body.removeChild(iframe), 2000);
    }, 500);
}
