# Guide de l'Administrateur (God Mode)

Ce document explique comment gérer le contenu de l'application **History Walk** directement depuis l'interface, sans avoir besoin d'éditer du code.

---

## 🛡️ Activer le "God Mode"
Le God Mode débloque les outils d'édition et d'administration.

1.  Ouvrez l'application.
2.  Tapez séquentiellement les lettres `g`, `o`, `d` sur votre clavier (ou imaginez un clavier virtuel sur mobile).
3.  Une notification "Mode GOD : ACTIVÉ" apparaît.
4.  Un bouton rouge **GOD MODE** s'affiche en haut à droite (sur PC) ou dans le menu (sur Mobile).

---

## 🗺️ Gestion des Circuits

### Créer ou Modifier un Circuit
1.  Activez le **Mode Sélection** (bouton "Explorer" qui devient "Créer circuit").
2.  Cliquez sur les lieux (pins bleus) dans l'ordre de votre choix pour construire l'itinéraire.
3.  Ouvrez le panneau "Circuit" à droite.
4.  Donnez un titre, une description et ajustez l'ordre si nécessaire.

### Officialiser un Circuit (Mise en ligne)
Une fois votre circuit prêt, vous pouvez l'envoyer sur le serveur (GitHub) pour que tout le monde puisse le voir.

1.  Exportez d'abord votre circuit en **.gpx** ou **.json** via le bouton "Exporter" du panneau circuit (sauvegarde locale).
2.  Cliquez sur le bouton rouge **GOD MODE** -> **Upload GitHub**.
3.  Une fenêtre s'ouvre :
    *   **Token :** Entrez votre "Personal Access Token" GitHub (demandé une seule fois, il sera mémorisé).
    *   **Fichier :** Sélectionnez le fichier `.gpx` ou `.json` que vous venez de créer.
4.  Cliquez sur **Envoyer**.
5.  ✅ **Résultat :** Le fichier est envoyé dans le dossier `public/circuits/djerba/`.
6.  ⏳ **Attente :** GitHub va automatiquement régénérer l'index des circuits. Cela prend environ **1 à 2 minutes**.
7.  🔄 **Vérification :** Rafraîchissez l'application. Le circuit devrait apparaître avec le badge "Officiel".

---

## 📸 Gestion des Photos

Vous pouvez désormais héberger vos photos gratuitement et à vie sur GitHub, directement depuis l'application.

### Ajouter des Photos à un Lieu
1.  En God Mode, cliquez sur un lieu pour ouvrir sa fiche.
2.  Cliquez sur le bouton **Crayon (Éditer)** ou allez dans la section "Photos".
3.  Cliquez sur le cadre **"+"** pour ajouter des photos depuis votre appareil.
4.  Elles apparaissent localement (prévisualisation).

### Officialiser les Photos (Upload GitHub)
Pour que ces photos soient visibles par tous les utilisateurs (et ne disparaissent pas si vous videz votre cache) :

1.  Dans la section "Photos" de la fiche du lieu, repérez le bouton **Nuage (Upload)** (à côté de la poubelle rouge).
2.  Cliquez dessus.
3.  Confirmez l'envoi.
4.  L'application va :
    *   Compresser les images (pour qu'elles chargent vite).
    *   Les envoyer sur GitHub dans le dossier `public/photos/`.
    *   Mettre à jour la fiche du lieu avec le nouveau lien officiel (`photos/poi_...jpg`).
5.  ✅ **Succès :** Un message confirme le nombre de photos envoyées.

### ⚠️ Étape Cruciale : Sauvegarder le Lien
L'upload des photos met à jour le lieu **dans votre navigateur uniquement**. Pour que ce lien soit enregistré définitivement pour tout le monde :

1.  Après avoir uploadé les photos, vous devez **ré-exporter le circuit** (ou le fichier `djerba.json` global si vous travaillez sur le master) qui contient ce lieu.
2.  Utilisez la fonction **Upload GitHub** (décrite plus haut) pour mettre à jour le fichier du circuit.

**Résumé du workflow Photos :**
1. Ajout Photo (Local) ➔ 2. Upload Nuage (Vers GitHub) ➔ 3. Export Circuit (Sauvegarde du lien) ➔ 4. Upload Circuit (Publication).

---

## 🛠️ Autres Outils Utiles

*   **Export Master GeoJSON :** Télécharge toute la base de données des lieux (avec vos modifications) en un seul fichier. Utile pour les sauvegardes complètes.
*   **Capturer la vue :** Enregistre la position actuelle de la carte (zoom + centre) comme vue par défaut pour le démarrage de l'appli.
*   **Scout (Overpass) :** Outil avancé pour trouver des lieux manquants via OpenStreetMap.
