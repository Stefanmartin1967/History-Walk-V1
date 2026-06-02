# Aide « Importer des photos » — contenu source (Niveau 0, v2)

> **Statut** : contenu validé (Stefan, 02/06/2026). Source unique pour l'aide
> in-app contextuelle, l'onboarding et les visuels Facebook.
> **Paradigme** : l'utilisateur a le même usage que l'admin (il importe SES
> photos GPS, enrichit des POI, crée des circuits) ; seule différence = il est
> admin de SA version locale, l'admin publie sur GitHub. On documente donc TOUT.

---

## A. Thème transversal réutilisable : « Préparer ses photos »

*(contenu source UNIQUE — affiché à plusieurs endroits, voir §D)*

> **Préparer ses photos**
>
> **Format** : JPEG. *(iPhone en HEIC → régler sur « Le plus compatible » ou
> convertir — limite temporaire, support HEIC prévu plus tard.)*
>
> **Position (GPS)** : activez le GPS de votre appareil photo **avant votre
> voyage** → vos photos se placent toutes seules sur la carte.
>
> ⚠️ Les photos reçues par messagerie ou téléchargées du web perdent souvent
> leur position → elles arriveront en « Sans GPS » (à rattacher à la main).

---

## B. Le guide d'import (parcours complet)

**L'idée en une phrase :** vous donnez vos photos à l'app, elle les **regroupe
automatiquement par lieu** grâce au GPS, vous **vérifiez/ajustez** chaque groupe,
puis vous **Enregistrez dans l'app** et/ou **Téléchargez un ZIP** sur votre disque.

**Schéma mental :**
`Vos photos (JPEG) → regroupées par lieu → vous vérifiez/ajustez → Enregistrer (dans VOTRE version) et/ou Télécharger (ZIP)`

### 0. Avant de commencer
Formats : **JPEG**. *[ancre « ? » HEIC]* · Pensez au **GPS** de vos photos → voir **« Préparer ses photos »**.

### 1. Ouvrir l'import
Menu **Outils → import photos** (ou la carte « Importer photos GPS » de la visite
guidée). Choisissez un lot de photos **.jpg**. L'app lit leur position et ouvre la
fenêtre de traitement.

### 2. Comprendre les groupes
L'app crée des **groupes** selon la position des photos :
- **Rattaché à un lieu** : un POI connu est à **moins de 120 m** → ses photos lui
  sont proposées. *(la distance réelle est affichée : « POI rattaché · 45 m »)*
  *[ancre « ? » 120 m]*
- **« Hors POI »** : photos prises *en chemin*, aucun lieu connu à proximité.
- **« Sans GPS »** (tout en bas) : photos sans position → à **rattacher à la
  main**. *[ancre « ? » → Préparer ses photos]*
- Les **doublons** (déjà importés / déjà dans l'app) sont écartés automatiquement.

### 3. Ajuster (vue d'ensemble)
Par groupe : **renommer** (titre) · **réordonner les groupes** (poignée à gauche) ·
**déplacer une photo** d'un groupe à l'autre (glisser-déposer) · **renommer une
photo** (= son nom dans le ZIP).
Selon le cas : **Rattacher au plus proche** · **changer de lieu** (sélecteur) ·
**Créer un lieu** · **Rattacher à un lieu…** (Sans GPS) · **Catégoriser** ·
**Éditer la fiche**.
Par photo : **Extraire vers Hors POI** (icône *route* = sortir du lieu vers le
trajet) ou, sur un groupe Hors POI, **Séparer** (icône *split* = scinder en deux) ·
**Supprimer**.

### 4. Comparer (tri fin)
Le bouton **Comparer** ouvre un groupe en grand, jusqu'à **6 photos côte à côte** :
- la **pellicule** (en bas) montre toutes les photos du groupe : taper une vignette
  l'affiche · **glisser pour réordonner** ;
- par photo : **Masquer** (œil — l'écarte de la comparaison en cours ; elle ne
  revient plus tant que vous ne fermez pas) · **Détacher/Séparer** · **Supprimer** ;
- en bas, les boutons agissent **sur ce groupe** : *Fermer la comparaison* ·
  *Télécharger ce groupe* · *Enregistrer ce lieu*.

### 5. Ajouter d'autres photos en cours
Bouton **« Ajouter des photos »** (ou glissez des fichiers dans la fenêtre) : ça
**complète** sans rien perdre de votre travail.

### 6. ⚠️ Finaliser — les deux boutons à ne pas confondre
- **Enregistrer** = range les photos **dans l'app**, rattachées à leurs lieux, dans
  **votre** version. *(vous, admin : en attente de publication GitHub.)*
- **Télécharger ZIP** = un **fichier sur votre disque** (sauvegarde/partage),
  **hors de l'app**.

→ **Deux actions indépendantes** : enregistrer ne crée pas de ZIP, et inversement.

---

## C. Les ancres « ? » (pop-ups contextuels — patron réutilisable)

1. **[? HEIC]** à l'étape 0 / entrée → bloc « Format » de *Préparer ses photos*.
2. **[? 120 m]** sur la distance affichée d'un groupe → « distance entre vos photos
   et le lieu ; regroupement automatique en dessous de **120 m** ».
3. **[? Sans GPS]** sur le groupe « Sans GPS » → bloc « Position (GPS) » de
   *Préparer ses photos*.

---

## D. Diffusion (1 contenu source → plusieurs points)

- **Onboarding** (1er lancement) : un court renvoi vers *Préparer ses photos*
  (cadrage « avant de partir »).
- **Aide « ? » in-app** : les 3 ancres ci-dessus + un « ? » global ouvrant ce guide.
- **Facebook** : 1 poster « Comment importer vos photos » (schéma + étapes) · 1 GIF
  court du happy path · **+ 1 visuel dédié « Avant de partir : activez le GPS de vos
  photos »** (véhicule pré-voyage).

---

## Annexe — repères techniques (pour l'implémentation, pas pour l'user)

- Seuils de regroupement (`src/photo-clustering.js`) : `POI_RADIUS = 120 m`
  (rattachement à un lieu), `TRAJET_RADIUS = 80 m` (groupes « trajet »),
  `NEARBY_RADIUS = 100 m` (candidats du sélecteur « changer de lieu »).
- Entrée import : `#btn-import-photos` (menu Outils) → `#photo-gps-loader`
  (`accept=".jpg,.jpeg"`). Flux : `desktopMode.handleDesktopPhotoImport`.
- Limite HEIC : voir backlog mémoire `project_heic_import_gap`.
- La distance par groupe est déjà affichée dans le sous-titre du groupe
  (`buildClusterSection`, `ui-photo-batch.js`).
