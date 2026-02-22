<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <style>
        :root {
            --bg-parchment: #f4ecd8;
            --accent-copper: #b87333;
            --text-dark: #2c2c2c;
            --progress-bg: rgba(0, 0, 0, 0.1);
        }

        .explorer-card {
            width: 450px;
            height: 280px;
            background: var(--bg-parchment);
            border-radius: 15px;
            padding: 20px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            color: var(--text-dark);
            position: relative;
            border: 2px solid #e2d1a8;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
        }

        .header { display: flex; align-items: center; gap: 20px; }

        .avatar {
            width: 80px;
            height: 80px;
            border-radius: 50%;
            background: #ccc;
            border: 4px solid var(--accent-copper);
            overflow: hidden;
        }

        .title-area h2 {
            margin: 0;
            font-family: 'Georgia', serif;
            letter-spacing: 1px;
            text-transform: uppercase;
            font-size: 1.4rem;
        }

        .global-rank {
            font-style: italic;
            font-size: 0.9rem;
            color: #666;
        }

        .stats-container { margin-top: 15px; }

        .stat-group { margin-bottom: 12px; }

        .stat-label {
            display: flex;
            justify-content: space-between;
            font-size: 0.75rem;
            font-weight: bold;
            margin-bottom: 4px;
            text-transform: uppercase;
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
            padding-top: 10px;
            font-size: 0.8rem;
        }

        .next-goal { font-size: 0.7rem; color: #888; margin-top: 2px; text-align: right; }
    </style>
</head>
<body>

<div class="explorer-card">
    <div class="header">
        <div class="avatar">
            <img src="https://via.placeholder.com/80" alt="Avatar">
        </div>
        <div class="title-area">
            <h2 id="dynamic-title">Chargement...</h2>
            <div id="global-rank-label" class="global-rank">Rang : --</div>
        </div>
    </div>

    <div class="stats-container">
        <div class="stat-group">
            <div class="stat-label">
                <span id="label-animal">Distance</span>
                <span id="val-distance">0 km</span>
            </div>
            <div class="progress-bar-container">
                <div id="bar-distance" class="progress-fill" style="width: 0%"></div>
            </div>
            <div id="goal-distance" class="next-goal">Objectif : --</div>
        </div>

        <div class="stat-group">
            <div class="stat-label">
                <span id="label-matiere">Circuits</span>
                <span id="val-circuits">0</span>
            </div>
            <div class="progress-bar-container">
                <div id="bar-circuits" class="progress-fill" style="width: 0%"></div>
            </div>
            <div id="goal-circuits" class="next-goal">Objectif : --</div>
        </div>
    </div>

    <div class="footer-stats">
        <div>📍 <span id="footer-km">--</span> km à parcourir</div>
        <div>🗺️ <span id="footer-circuits">--</span> défis en attente</div>
    </div>
</div>

<script>
    // Configuration issue de tes images
    const CONFIG = {
        paliers: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
        animaux: ["Colibri", "Hérisson", "Renard", "Lynx", "Chamois", "Loup", "Grand Cerf", "Ours Polaire", "Aigle Royal", "Phénix"],
        matieres: ["Bois", "Pierre", "Cuivre", "Bronze", "Acier", "Argent", "Or", "Cristal", "Saphir", "Diamant"],
        rangs: ["Premier Souffle", "Petite Étincelle", "Esprit Curieux", "Cœur Vaillant", "Âme Vagabonde", "Sillage d'Argent", "Regard d'Horizon", "Sagesse des Sables", "Souffle Céleste", "Lueur d'Éternité"]
    };

    // DONNÉES À INJECTER PAR TON APPLI
    const userStats = {
        kmParcourus: 37.5,
        totalKmCircuits: 100.0,
        circuitsTermines: 6,
        totalCircuitsDisponibles: 20
    };

    function updateCard() {
        // 1. Calcul des pourcentages globaux
        const pctDist = (userStats.kmParcourus / userStats.totalKmCircuits) * 100;
        const pctCirc = (userStats.circuitsTermines / userStats.totalCircuitsDisponibles) * 100;
        const pctGlobal = (pctDist * pctCirc) / 100; // Système Hardcore

        // 2. Trouver les rangs actuels
        const getRankInfo = (pct, list) => {
            let idx = CONFIG.paliers.findIndex(p => pct < p) - 1;
            if (idx < 0) idx = CONFIG.paliers.length - 1; // Max ou défaut
            return {
                title: list[idx] || list[list.length-1],
                nextLimit: CONFIG.paliers[idx+1] || 100
            };
        };

        const rankAnimal = getRankInfo(pctDist, CONFIG.animaux);
        const rankMatiere = getRankInfo(pctCirc, CONFIG.matieres);
        const rankGlobal = getRankInfo(pctGlobal, CONFIG.rangs);

        // 3. Mise à jour DOM
        document.getElementById('dynamic-title').innerText = `${rankAnimal.title} de ${rankMatiere.title}`;
        document.getElementById('global-rank-label').innerText = `Rang : ${rankGlobal.title}`;

        // Barres
        document.getElementById('bar-distance').style.width = `${pctDist}%`;
        document.getElementById('bar-circuits').style.width = `${pctCirc}%`;

        // Textes
        document.getElementById('val-distance').innerText = `${userStats.kmParcourus} km / ${userStats.totalKmCircuits} km`;
        document.getElementById('val-circuits').innerText = `${userStats.circuitsTermines} / ${userStats.totalCircuitsDisponibles}`;

        // Footer & Objectifs
        const kmRestants = (userStats.totalKmCircuits - userStats.kmParcourus).toFixed(1);
        const circuitsRestants = userStats.totalCircuitsDisponibles - userStats.circuitsTermines;

        document.getElementById('footer-km').innerText = kmRestants;
        document.getElementById('footer-circuits').innerText = circuitsRestants;

        document.getElementById('goal-distance').innerText = `Prochain palier : ${rankAnimal.nextLimit}%`;
        document.getElementById('goal-circuits').innerText = `Prochain palier : ${rankMatiere.nextLimit}%`;
    }

    // Init
    updateCard();
</script>
</body>
</html>
