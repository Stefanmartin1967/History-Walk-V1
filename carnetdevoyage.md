# Carnet de Voyage - Point sur les Rangs et la Progression

Ce document récapitule la logique actuelle (implémentée dans `src/statistics.js`) pour le calcul des rangs, des stades et de la pondération.

## 1. Pondération Globale (XP)

L'expérience (XP) est calculée sur une base de **20 000 points maximum**, répartis équitablement entre la distance parcourue et le nombre de circuits terminés.

**Formule :**
`XP = (DistanceParcourue / DistanceTotaleOfficielle * 10 000) + (CircuitsTermines / CircuitsTotauxOfficiels * 10 000)`

- **Distance :** 50% de la note (10 000 XP max)
- **Circuits :** 50% de la note (10 000 XP max)

### Rangs Globaux (Basés sur l'XP Total)

| XP Minimum | Titre |
| :--- | :--- |
| 20 000 | **Lueur d'Éternité** (100%) |
| 17 000 | Souffle Céleste |
| 13 500 | Sagesse des Sables |
| 10 000 | Regard d'Horizon |
| 7 000 | Sillage d'Argent |
| 4 500 | Âme Vagabonde |
| 2 500 | Cœur Vaillant |
| 1 200 | Esprit Curieux |
| 500 | Petite Étincelle |
| 0 | Premier Souffle |

---

## 2. Rangs Animaux (Basés sur la Distance)

Ces rangs sont déterminés par le **pourcentage de la distance totale officielle** parcourue.
*Note : Dans l'interface d'administration actuelle, ces valeurs peuvent apparaître avec l'unité "km", mais le code utilise bien des pourcentages (0-100%).*

| Pourcentage Min | Titre | Icône | Description |
| :--- | :--- | :--- | :--- |
| 90% | **Phénix** | flame | Légendaire |
| 80% | Aigle Royal | bird | Vue d'ensemble sur l'île |
| 70% | Ours Polaire | snowflake | Un marcheur confirmé |
| 60% | Grand Cerf | crown | Majestueux |
| 50% | Loup | paw-print | L'endurance s'installe |
| 40% | Chamois | mountain | On grimpe en compétence |
| 30% | Lynx | eye | L'agilité augmente |
| 20% | Renard | dog | On sort des sentiers battus |
| 10% | Hérisson | sprout | On commence à explorer |
| 0% | Colibri | feather | Les premiers pas |

---

## 3. Rangs Matières (Basés sur les Circuits)

Ces rangs sont déterminés par le **pourcentage du nombre total de circuits officiels** terminés.

| Pourcentage Min | Titre | Couleur |
| :--- | :--- | :--- |
| 90% | **Diamant** | #b9f2ff |
| 80% | Saphir | #0F52BA |
| 70% | Cristal | #e6e6fa |
| 60% | Or | #FFD700 |
| 50% | Argent | #C0C0C0 |
| 40% | Acier | #434B4D |
| 30% | Bronze | #CD7F32 |
| 20% | Cuivre | #B87333 |
| 10% | Pierre | #888888 |
| 0% | Bois | #8B4513 |

---

## Résumé Technique

- **Fichier source :** `src/statistics.js`
- **Variables exportées :** `GLOBAL_RANKS`, `ANIMAL_RANKS`, `MATERIAL_RANKS`
- **Calcul :** Fonction `calculateStats()`
