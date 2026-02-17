============================================================
   HISTORY WALK DATA MANAGER - GUIDE D'UTILISATION
============================================================

------------------------------------------------------------
1. SAUVEGARDER MON TRAVAIL (ROUTINE QUOTIDIENNE)
------------------------------------------------------------
À faire chaque fois que tu ajoutes un fichier, modifies du code 
ou que tu veux faire une sauvegarde de sécurité.

1. Ouvre VS Code et le Terminal (Ctrl + ù).
2. Tape ces 3 commandes dans l'ordre :

   git add .
   (Cette commande prépare TOUS les fichiers : les nouveaux, les modifiés et les supprimés)

   git commit -m "Description de ce que j'ai fait"
   (Exemple : "Ajout de la fonction filtre" ou "Correction bug affichage")

   git push
   (Envoie la sauvegarde sur GitHub)

Si tu as le message "Writing objects: 100%", c'est gagné.

------------------------------------------------------------
2. INSTALLER SUR UN NOUVEL ORDINATEUR (PREMIÈRE FOIS)
------------------------------------------------------------
À faire si tu changes de PC ou si tu formates.

PRÉREQUIS : Installer Node.js, Git et VS Code sur la machine.

1. Crée un dossier vide pour tes projets.
2. Ouvre un terminal (ou Git Bash) dans ce dossier.
3. Télécharge le projet :
   git clone https://github.com/Stefanmartin1967/history-walk-data-manager.git

4. CRUCIAL (Sinon ça ne marche pas) :
   - Ouvre le dossier téléchargé avec VS Code.
   - Ouvre le terminal.
   - Tape : npm install
   (Cela va télécharger les "pièces détachées" manquantes dans le dossier node_modules).

------------------------------------------------------------
3. RÉCUPÉRER LE TRAVAIL FAIT AILLEURS
------------------------------------------------------------
À faire si tu as travaillé sur le PC A et que tu reprends sur le PC B.

1. Ouvre VS Code sur le PC B.
2. Ouvre le terminal.
3. Tape : 
   git pull

(Cela télécharge les dernières modifications depuis GitHub).

------------------------------------------------------------
4. LANCER L'APPLICATION
------------------------------------------------------------
Méthode A (Facile) :
Double-clique sur le fichier "Lancer_HW_Manager.bat".

Méthode B (Manuelle via VS Code) :
Tape dans le terminal : npm run dev -- --open

RAPPEL : Ne jamais fermer la fenêtre noire tant que tu utilises l'application.