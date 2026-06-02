# Aide « Importer des photos » — contenu source (v3)

> **Statut** : aligné sur `src/help-content.js` (aide « ? » in-app). Source unique
> pour l'onboarding et les visuels Facebook.
> **Conventions de rédaction** : cf. mémoire `feedback_doc_writing_conventions`
> (Heripia · cliquer [PC] · importer/déposer · « et/ou » · phrases courtes ·
> concret · vocabulaire technique juste · actif + « à vous de valider » · « • »).
> **Paradigme** : l'utilisateur a le même usage que l'admin (il importe SES photos
> géolocalisées, enrichit des POI, crée des circuits) ; seule différence = il est
> admin de SA version locale, l'admin publie sur GitHub. On documente donc TOUT.

---

## A. Thème transversal réutilisable : « Préparer ses photos »

> **Format** : JPEG. *(iPhone en HEIC → régler sur « Le plus compatible », ou
> convertir en JPEG — limite temporaire, support HEIC prévu plus tard.)*
>
> **Position (localisation)** : activez la localisation de votre appareil photo
> **avant votre voyage** → Heripia place vos photos toutes seules sur la carte.
>
> ⚠️ Les photos reçues par messagerie, ou téléchargées du web, perdent souvent leur
> position → elles arriveront « **À rattacher** » (à relier à un lieu à la main).

---

## B. Le guide d'import (panneau global « ? »)

**Intro :** Vous importez vos photos ; Heripia les regroupe automatiquement par lieu,
grâce à la position enregistrée dans chaque photo. Vous vérifiez et ajustez chaque
groupe, puis vous **Enregistrez** le résultat dans Heripia, **et/ou** vous
**Téléchargez** un ZIP sur votre disque.

**Schéma :** `Vos photos (JPEG) → regroupées par lieu → vérifier / ajuster → Enregistrer • Télécharger`

### 0 · Avant de commencer
Format : **JPEG**. Vérifiez que vos photos contiennent bien leur **position** → voir
« Préparer ses photos ».

### 1 · Ouvrir l'import
Menu **Outils → « import photos »** (ou la carte « Importer photos GPS » de la visite
guidée). Choisissez un lot de photos **.jpg** : Heripia lit leur position et ouvre la
**fenêtre d'organisation**.

### 2 · Comprendre les groupes
À partir de la position des photos, Heripia crée des **groupes** :
- **Rattaché à un lieu** : un lieu connu est à **moins de 120 m** → les photos prises
  à proximité lui sont rattachées *(à vous de valider ; la distance s'affiche :
  « POI rattaché · 45 m »)*.
- **« À rattacher »** *(ambre)* : un lieu connu est à portée, ou la photo n'a pas de
  position → à vous de choisir le lieu.
- **« Hors POI »** : photos prises en chemin, sans lieu connu à proximité.
- Les **doublons** (déjà importés) sont écartés automatiquement.

### 3 · Ajuster (vue d'ensemble)
Pour chaque groupe : **renommer** · **réordonner** (poignée à gauche) · **déplacer une
photo** d'un groupe à l'autre (glisser-déposer) · **renommer une photo**.
*Le nom fixe l'ordre de tri (dossier, envoi Facebook…) — cf. « Nommer pour ordonner ».*
*Selon le cas : Rattacher à un lieu · Créer un lieu · Catégoriser · Éditer la fiche.*
Pour une photo : **Extraire vers Hors POI** *(icône route)* — ou, dans un groupe Hors
POI, **Séparer** *(icône split)* · **Supprimer**.

### 4 · Comparer (tri fin)
Le bouton **Comparer** ouvre un groupe en grand, jusqu'à **6 photos côte à côte**, pour
choisir la ou les meilleure(s) :
- la **pellicule** (en bas) montre toutes les photos : cliquez sur une vignette pour
  l'afficher · glissez pour réordonner ;
- pour une photo : **Masquer** (œil) · **Détacher / Séparer** · **Supprimer** ;
- en bas, les boutons agissent **sur ce groupe** : Fermer la comparaison · Télécharger
  ce groupe · Enregistrer ce lieu.

### 5 · Ajouter d'autres photos en cours de route
Bouton **« Ajouter des photos »** (ou glissez des fichiers dans la fenêtre) : cela
**complète** votre travail sans rien perdre.

### 6 · Finaliser — deux boutons à ne pas confondre
- **Enregistrer** = range les photos **dans Heripia**, rattachées à leurs lieux, dans
  votre version. *(Admin : en attente de publication GitHub.)*
- **Télécharger le ZIP** = crée un **fichier sur votre disque** (sauvegarde / partage),
  en dehors de Heripia.

→ Deux actions indépendantes : enregistrer ne crée pas de ZIP, et télécharger un ZIP
n'enregistre rien dans Heripia.

⚠️ **Une photo non rattachée à un lieu n'est pas enregistrée dans Heripia.** Pour la
garder : rattachez-la à un lieu, ou téléchargez le ZIP.

*Astuce : activez la localisation de votre appareil photo avant de partir — c'est elle
qui place vos photos toutes seules sur la carte.*

---

## C. Les ancres « ? » (pop-ups contextuels)

| Ancre | Emplacement | Contenu |
|-------|-------------|---------|
| **Format** | chip « JPEG » de l'en-tête | JPEG / HEIC |
| **Regroupement par lieu** | distance d'un groupe rattaché (« · 45 m ») | seuil 120 m + « à vous de valider » |
| **« Hors POI » / « À rattacher »** | badge du groupe | définitions + ⚠️ « non enregistré » |
| **Nommer pour ordonner** | titre d'un groupe | nom → ordre de tri (dossier, Facebook) |
| **Créer un lieu** | bouton « Créer un lieu » | crée un nouveau lieu vs rattacher |
| **Choisir les meilleures photos** | titre de la fenêtre Comparer | comparer les ressemblantes, gestes |
| *(panneau global)* | « ? » d'en-tête | le guide complet (§B) |

---

## D. Diffusion (1 contenu source → plusieurs points)

- **Aide « ? » in-app** : le panneau global + les ancres ci-dessus (livré).
- **Onboarding** (1er lancement) : renvoi vers « Préparer ses photos » (à câbler).
- **Facebook** : 1 poster « Comment importer vos photos » + 1 GIF du happy path
  + 1 visuel « Avant de partir : activez la localisation de vos photos ».

---

## Annexe — repères techniques

- Seuils (`src/photo-clustering.js`) : `POI_RADIUS = 120 m` (auto-rattachement),
  `TRAJET_RADIUS = 80 m`, `NEARBY_RADIUS = 100 m`, `SUGGEST_RADIUS = 300 m` (plafond
  des suggestions « plus proche » / menu « Rattacher à un lieu »).
- Titre de la modale : **« Organiser les photos »**.
- Limite HEIC : voir backlog `project_heic_import_gap`.
