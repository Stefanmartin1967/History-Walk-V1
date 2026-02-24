# Boîte à Idées V2.0

Ce document recense les idées d'améliorations futures qui ont été discutées mais reportées pour prioriser la stabilité et la simplicité de la version actuelle.

## Gestion avancée de la planification des circuits officiels

### Le problème
Actuellement, **tous** les circuits officiels sont considérés comme "Planifiés" par défaut.
- Cela signifie que leurs POI apparaissent comme "Planifiés" (compteur > 0) sur la carte.
- Si un utilisateur active le filtre "Masquer les planifiés" pour créer son propre circuit, **tous les POI des circuits officiels disparaissent**, ce qui peut vider la carte et empêcher de piocher dedans.
- L'utilisateur n'a pas forcément l'intention de réaliser les 50 circuits officiels, donc cette "planification par défaut" peut être une contrainte.

### La solution proposée (Reportée)
Permettre à l'utilisateur de choisir quels circuits officiels il compte réellement faire ("Panier de courses").

1.  **Par défaut :** Les circuits officiels ne comptent **PAS** comme planifiés.
2.  **Action :** Un bouton "Planifier" (📅) sur la fiche d'un circuit officiel permet de l'ajouter à son programme.
3.  **Résultat :** Seuls les circuits explicitement "cochés" masquent leurs POI via le filtre "Masquer les planifiés".

### Raison du report
- Complexité pour l'administrateur/créateur qui doit "tout cocher" pour vérifier son travail.
- Risque que l'utilisateur passe à côté des circuits officiels s'ils ne sont pas mis en avant par défaut.
- Urgence de la mise en production actuelle.

### Pistes alternatives pour le futur
- **Switch Global :** Un filtre "Inclure tous les circuits officiels" dans les options de planification.
- **Distinction Visuelle :** Utiliser des couleurs différentes pour les "Planifiés Perso" (Bleu) et "Suggérés Officiels" (Orange), avec des filtres séparés.
