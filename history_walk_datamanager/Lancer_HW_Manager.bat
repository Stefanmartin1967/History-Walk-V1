@echo off
:: Cette ligne sert à se placer dans le dossier où se trouve ce fichier
cd /d "%~dp0"

echo Démarrage de History Walk Data Manager...
echo L'application va s'ouvrir dans ton navigateur.
echo Ne ferme PAS cette fenetre noire tant que tu utilises l'appli.

:: Lance le serveur et ouvre le navigateur automatiquement (-- --open)
npm run dev -- --open