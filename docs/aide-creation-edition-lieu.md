# Aide « Créer ou éditer un lieu » — contenu source (v1)

> **Statut** : brouillon pour relecture. Deviendra la source unique de l'aide « ? »
> in-app (`src/help-content.js` → `GUIDE_LIEU`), posée dans le header de la modale
> richEditor (« Nouveau Lieu » / « Éditer le Lieu »).
> **Conventions de rédaction** : cf. mémoire `feedback_doc_writing_conventions`
> (Heripia · cliquer [PC] · importer/déposer · « et/ou » · phrases courtes ·
> concret · vocabulaire technique juste · actif + réassurance · « • » dans les schémas).
> **Paradigme** : l'utilisateur enrichit le patrimoine comme l'admin (il crée et complète
> les fiches des lieux) ; ses lieux restent locaux, il ne publie pas sur GitHub.
> **Réserve connue** : la création passe par un **clic droit** non évident ; sa
> découvrabilité (faire connaître le geste avant d'ouvrir la fiche) est un autre chantier
> (« Vue d'ensemble »), cf. mémoire `project_documentation_heripia`.

---

## Le guide « Créer ou éditer un lieu » (panneau global « ? »)

**Emplacement du « ? »** : header de la modale (à côté du titre « Nouveau Lieu » /
« Éditer le Lieu » et de la croix).

**Intro :** Chaque lieu a une **fiche** : nom, catégorie, descriptions, infos pratiques,
position. Vous **créez** un nouveau lieu, ou vous **enrichissez** un lieu existant. Tout
est enregistré dans votre version d'Heripia.

**Schéma :** `Clic droit (ou Éditer) → Remplir la fiche → Enregistrer`

### 0 · La fiche d'un lieu
Un lieu se décrit par une fiche. Deux façons d'y arriver : **créer** un nouveau lieu, ou
**éditer** un lieu déjà présent. C'est le **même formulaire** dans les deux cas.

### 1 · Créer un lieu
**Cliquez droit** à l'endroit voulu sur la carte. Un marqueur apparaît avec la question
**« Nouveau Lieu ? »** :
- **glissez** le marqueur pour ajuster la position *(« Glissez pour ajuster »)* ;
- *Maps* et *OSM* ouvrent l'endroit sur Google Maps et/ou OpenStreetMap pour **vérifier** ;
- cliquez **« Valider cette position »** → la fiche **« Nouveau Lieu »** s'ouvre.

*Deux autres entrées mènent à la même fiche : la **recherche** d'un lieu encore absent, et
le bouton **« Créer un lieu »** de l'import photo.*

### 2 · Éditer un lieu
Sur la fiche d'un lieu, le bouton **« Éditer »** ouvre le formulaire **« Éditer le Lieu »**
(mêmes champs, déjà remplis).

### 3 · L'essentiel pour enregistrer
Deux champs suffisent à enregistrer :
- **Nom (FR)** — obligatoire ;
- **Catégorie** — à choisir *(« Choisir une catégorie… »)*.

Tant qu'il manque l'un des deux, le bouton **« Enregistrer »** reste **grisé** *(il indique
ce qui manque)*. La **Zone** *(Houmt Souk, Midoun…)* se remplit **toute seule** d'après la
position — non modifiable.

### 4 · Catégorie et précisions
Choisir la **Catégorie** fait apparaître, selon le type de lieu, jusqu'à trois précisions :
- **Sous-type** — la variante du lieu. **Quand la catégorie en propose** *(Mosquée,
  Église, Artisanat)*, le sous-type **choisit aussi l'icône** sur la carte : une mosquée
  *à minaret*, *à coupoles* ou *fortifiée* n'a pas le même pictogramme.
- **État** — par exemple *En activité*, *Désaffecté*, *Ruine*.
- **Accès** — *Intérieur visitable*, *Extérieur seulement* ou *Non visitable*.

*(Ces champs restent masqués tant qu'aucune catégorie n'est choisie ; les valeurs proposées
dépendent de la catégorie.)*

### 5 · Décrire
- **Description courte** — un **résumé** *(il apparaît dans la liste)*.
- **Description complète** — le texte détaillé du lieu.

### 6 · Infos pratiques *(facultatif)*
Pour enrichir la fiche : **temps de visite**, **prix** *(en TND)*, **téléphone**,
**horaires**, **Facebook**. À remplir si vous les connaissez.

### 7 · Source et notes
- **Source** — d'où vient l'information *(un lien et/ou un texte)*.
- **Notes** — vos remarques personnelles.

### 8 · Position et enregistrer
- **« Déplacer »** *(en bas de la fiche)* : réajuster le point sur la carte ; les
  coordonnées GPS s'affichent à côté.
- **« Enregistrer »** : le lieu rejoint **votre version** d'Heripia. **« Annuler »**
  ferme sans rien garder.
- *En édition, les flèches **Précédent / Suivant** passent d'un lieu à l'autre quand le
  lieu fait partie d'un circuit affiché.*

**Astuce :** un clic droit **n'importe où** sur la carte crée un lieu à cet endroit —
ajustez-le ensuite par glisser, ou avec **« Déplacer »**.

*Vos lieux restent **sur cet appareil**. Pour les sauvegarder ou les transférer, passez
par **Mon Espace** (comme pour vos circuits).*

---

## Les ancres « ? » contextuelles (PR2 — pour mémoire)

À poser sur le formulaire :

| Ancre | Emplacement | Contenu |
|-------|-------------|---------|
| **Zone** | label « Zone » (verrouillé) | se remplit d'après la position, non modifiable |
| **Catégorie / taxonomie** | label « Catégorie » | débloque Sous-type / État / Accès |
| **Description courte** | label « Description Courte » | c'est le résumé vu dans la liste |
| **Source** | label « Source » | d'où vient l'info (lien ou texte) |
| *(panneau global)* | « ? » du header | le guide complet (ci-dessus) |

---

## Annexe — repères techniques (libellés exacts vérifiés dans le code)

**Création (clic droit)** : `desktopMode.js` — `map.on('contextmenu')` (neutralisé en
focus mode circuit, `state.circuitFocusActive`) → `createDraftMarker` : popup « Nouveau
Lieu ? » + « Glissez pour ajuster » + liens Maps/OSM + bouton « Valider cette position »
(`#btn-validate-desktop-poi`) → `RichEditor.openForCreate`. Autres entrées :
`searchManager.js` (lieu cherché absent), `ui-photo-batch.js` (« Créer un lieu »).

**Modale** (`richEditor.js`) : `openHwModal` — icône `map-pin-plus` (création) /
`edit-3` (édition), titre **« Nouveau Lieu »** / **« Éditer le Lieu »**, `size: 'lg'`,
`closeOnBackdrop: false`.

**Champs** (`RICH_POI_BODY_HTML`) : Nom (FR)* (`rich-poi-name-fr`) · Nom (AR) · Catégorie
(`rich-poi-category`, défaut « Choisir une catégorie… », exclut « A définir »/« Autre ») ·
Zone (`rich-poi-zone`, auto via `getZoneFromCoords`, `disabled`) · taxonomie
`rich-poi-taxonomy` (Sous-type / État / Accès, `is-hidden` si pas de catégorie) ·
Description Courte (Résumé) · Description Complète · Temps de visite (h+min) · Prix (TND) ·
Téléphone · Horaires · Facebook · Source (URL ou Texte) · Notes · footer GPS « Déplacer »
(`btn-rich-move-marker`) + coords.

**Taxonomie & icônes** (`taxonomy.js` → `public/poi-categories.json` ; `poi-icons.js`) :
valeurs PAR catégorie. Ex. **Mosquée** → sous-types « À minaret / À coupoles / Fortifiée /
Générique », états « En activité / Désaffecté / Ruine », accès « Intérieur visitable /
Extérieur seulement / Non visitable ». Le **sous-type pilote l'icône** pour les catégories
multi-icônes (Mosquée, Église, Artisanat) : `getIconForFeature` → `getIconHtml(catégorie,
sous-type)` (lookup hiérarchique). Catégories sans sous-type → 1 icône.

**Validation** (`updateSaveButtonState`) : « Enregistrer » désactivé tant que Nom vide
(« Le nom est obligatoire ») ou Catégorie vide/« A définir » (« Veuillez sélectionner une
catégorie »). La règle source-obligatoire-si-description est **désactivée**.

**Boutons** : footer « Annuler » (`btn-cancel-rich-poi`) / « Enregistrer »
(`btn-save-rich-poi`, icône save) · subheader nav « Précédent »/« Suivant »
(`btn-rich-prev`/`btn-rich-next`, `is-hidden` hors circuit). Le `btn-suggest-email`
listé dans `DOM_IDS` n'est pas rendu (mort).

**Édition** : bouton de la fiche POI → event `richEditor:open-for-edit` →
`RichEditor.openForEdit(poiId)` (fusion `properties` + `userData`).
