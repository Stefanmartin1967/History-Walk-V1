# Aide « Créer un circuit » — contenu source (v1)

> **Statut** : brouillon pour relecture. Deviendra la source unique de l'aide « ? »
> in-app (`src/help-content.js` → `GUIDE_CIRCUIT`), comme `aide-import-photos.md`
> l'est pour l'import.
> **Conventions de rédaction** : cf. mémoire `feedback_doc_writing_conventions`
> (Heripia · cliquer [PC] · importer/déposer · « et/ou » · phrases courtes ·
> concret · vocabulaire technique juste · actif + réassurance · « • » dans les schémas).
> **Paradigme** : l'utilisateur a le même usage que l'admin (il crée ses circuits) ;
> seule différence = il est admin de SA version **locale**. Il **ne publie pas** (seul
> l'administrateur du site publie sur GitHub) : côté utilisateur, on crée, on enregistre
> en local, et on **sauvegarde ses données** pour les transférer ou ne pas les perdre.

---

## Le guide « Créer un circuit » (panneau global « ? »)

**Emplacement du « ? »** : barre d'outils de l'onglet **Mes Circuits**, à côté du
bouton **« Nouveau circuit »**. Visible avant même de commencer un circuit.

**Intro :** Un circuit, c'est une suite de **lieux** reliés par un **itinéraire**. Vous
choisissez les lieux sur la carte, vous les mettez dans l'ordre, puis Heripia **trace
l'itinéraire** qui suit les chemins. Votre travail est enregistré au fur et à mesure
— rien à valider pour ne pas le perdre.

**Schéma :** `Choisir les lieux → Les ordonner (étapes) → Tracer l'itinéraire → Brouillon auto-sauvegardé`

### 0 · Ce qu'est un circuit
Une suite de **lieux** (les **étapes**, numérotées 1, 2, 3…) et un **itinéraire** qui
les relie. Un lieu est un **point d'intérêt** — Heripia l'abrège « **POI** » à l'écran
*(par exemple le compteur « 3 POIs »)*. Tant que vous construisez le circuit, il reste un
**brouillon · auto-sauvegardé** : vous pouvez fermer Heripia et le retrouver intact.

### 1 · Démarrer
Onglet **Mes Circuits → « Nouveau circuit »** (le **+**). Heripia ouvre un circuit
vierge et passe la carte en **mode création**.

### 2 · Ajouter les lieux
**Cliquez un lieu sur la carte** : il rejoint le circuit *(« Commençons par le premier
lieu »)*. Chaque lieu ajouté devient une **étape** numérotée.
- **Réordonner** : glissez-déposez une étape *(ou les flèches « Monter » / « Descendre »)*.
- **Retirer** une étape : **« Retirer du circuit »** (la corbeille).
- Au passage, Heripia **nomme le circuit tout seul** et met à jour le **nombre de lieux**
  et la **distance** *(voir l'étape 3)*.

### 3 · Personnaliser le nom, décrire
- **Nom automatique** : Heripia nomme le circuit d'après vos lieux et le **met à jour à
  chaque ajout** — *« Départ de … »* (un seul lieu), *« Circuit de … à … »* (plusieurs
  lieux), *« Boucle autour de … »* (si le départ = l'arrivée).
- **Votre propre titre** *(facultatif)* : le **crayon** *(ou un double-clic sur le titre)*
  ouvre un champ ; tapez, **Entrée**. Votre titre **remplace** le nom automatique.
- **Description** : cliquez **« Ajouter une description… »**, écrivez ; enregistré dès que
  vous **sortez du champ**.
- **Transport** *(repliable)* : temps *(min)* et/ou coût de l'**aller** et du **retour**.
  Tant que c'est vide : *« — non renseigné »*.

Tout est enregistré à la saisie.

### 4 · Tracer l'itinéraire
Dès **2 lieux**, le bouton **« Tracer l'itinéraire »** apparaît.
- Heripia route le circuit avec **BRouter**, qui **suit les chemins piétons** : il
  transforme le trait « à vol d'oiseau » en **trace réellement marchable**.
- Résultat : **« Itinéraire tracé »** et la **distance réelle**.

*C'est « Tracer l'itinéraire » qui enregistre le circuit avec son tracé.*

### 5 · Ajuster le tracé
- **« Éditer l'itinéraire »** : ajoutez des **points de passage** *(cliquez sur la
  carte)* pour guider le tracé ; déplacez-les. Seul le segment touché est recalculé.
- **« Tracé presque complet »** : un **segment droit** est un passage que BRouter n'a
  pas su tracer — il reste en **ligne droite**. Ajoutez-y un **point de passage** pour
  le guider.
- **« Re-tracer l'itinéraire »** : si vous changez les lieux après coup, le tracé est
  signalé **« séquence modifiée »** *(« Tracé à mettre à jour »)*. Re-tracez pour le
  remettre à jour.

### 6 · Apporter ou afficher une trace existante
- **« Importer un GPX »** : apporte une trace GPX *(Wikiloc, GPS…)* **comme itinéraire
  du circuit**.
- **« Calque de référence »** : affiche une trace GPX **en fond, comme guide visuel**.
  Elle **n'entre pas** dans le tracé — elle vous sert juste de repère.
- **« Boucler le circuit »** : ajoute le **premier lieu en dernière étape** (retour au
  départ).
- **« Affiner dans GPX Studio »** : outil externe, pour les montages spéciaux *(option,
  pas une obligation)*.

### 7 · Enregistrer et retrouver le circuit
- **Brouillon auto-sauvegardé** en continu → le circuit vit dans **Mes Circuits**.
- **« Exporter le GPX »** : crée un **fichier .gpx** sur votre disque *(sauvegarde ou
  partage)*, en dehors d'Heripia.
- **« Vider le brouillon »** : repartir de zéro.

*Vos circuits restent **sur cet appareil**. Pour les emporter sur un autre appareil ou ne
pas les perdre, **sauvegardez vos données** depuis **Mon Espace**.*

**Astuce :** posez d'abord tous les lieux dans l'ordre, puis **tracez à la fin**. Vous
pourrez toujours réordonner et **re-tracer**.

---

## Les ancres « ? » contextuelles du bloc tracé — LIVRÉ (PR2)

Petits « ? » inline posés par `attachTraceHelp` (`ui-circuit-routing.js`), chacun
n'apparaissant **que dans l'état où il a du sens** (le bloc tracé est re-rendu à chaque
changement → ré-attachés à chaque rendu).

**« ? » Tracer** — sur le hint « BRouter suit les chemins piétons… »
> **Tracer l'itinéraire** — BRouter calcule un chemin qui **suit les voies piétonnes**
> (rues, sentiers). Il remplace le trait **« à vol d'oiseau »** (la ligne droite entre vos
> lieux) par une **trace réellement marchable**, et donne la **vraie distance**.

**« ? » Calque** — sur le chip « Calque de référence »
> **Calque de référence** — Une trace GPX (Wikiloc, GPS…) affichée **en fond**, comme
> **guide visuel**. Elle **n'entre pas** dans le tracé de votre circuit — juste un **repère**.

**« ? » À mettre à jour** — sur la pastille « séquence modifiée »
> **Tracé à mettre à jour** — Vous avez **changé les lieux** (ajout, retrait ou ordre)
> depuis le dernier tracé. Le tracé affiché ne correspond **plus** à la liste actuelle →
> cliquez **« Re-tracer l'itinéraire »**.

**« ? » Segment droit** — sur la note « Un passage est resté en ligne droite »
> **Segment en ligne droite** — BRouter n'a pas trouvé de chemin pour **un passage** : il
> le laisse en **ligne droite**. Ajoutez un **point de passage** (« Éditer l'itinéraire »
> → cliquer sur la carte) pour le guider, ou affinez dans **GPX Studio**.

*(Le panneau global « ? » de la toolbar Mes Circuits ouvre le guide complet, § ci-dessus.)*

---

## Diffusion (1 contenu source → plusieurs points)

- **Aide « ? » in-app** : le panneau global (PR1) + les ancres (PR2).
- **Onboarding** *(1er lancement)* : renvoi possible vers ce guide (à câbler plus tard).

---

## Annexe — repères techniques (libellés exacts vérifiés dans le code)

**Démarrage** : `#mc-btn-new` « Nouveau circuit » (`src/ui-circuit-list.js`), émet
`circuit:create-new`.

**Identité / formulaire** : tag « Brouillon · auto-sauvegardé » · **titre auto-généré**
(`generateCircuitName`, `circuit.js`) : « Nouveau Circuit » (0 lieu) / « Départ de X » (1) /
« Circuit de A à B » (2+) / « Boucle autour de A » (boucle) — régénéré à chaque ajout tant
qu'il n'y a pas de nom saisi ; personnalisable via le crayon ou un double-clic
(`initTitleEdit`) → `customDraftName` qui prime · invite « Ajouter une description… » /
textarea « Décrivez ce circuit… » (`initDescriptionEdit`, création seulement) · accordéon
« Transport » / résumé « — non renseigné » (min · TND).

**Étapes** (`src/circuit-view.js`) : empty state « Commençons par le premier lieu » /
« Cliquez sur un lieu de la carte pour l'ajouter au circuit. Vous pourrez réordonner les
étapes par glisser-déposer. » · en-tête « Étapes » + « N POIs ».

**Bloc tracé** (`src/ui-circuit-routing.js`) : « Tracer l'itinéraire » · hint « BRouter suit
les chemins piétons pour transformer le vol d'oiseau en trace marchable. » · spinner
« BRouter calcule l'itinéraire… » · « Itinéraire tracé » / pastille « Tracé réel » ·
« Éditer l'itinéraire » · menu « Plus » : « Re-tracer l'itinéraire », « Affiner dans GPX
Studio », « Exporter le GPX » · périmé : « Tracé à mettre à jour » / « séquence modifiée » ·
échec partiel : « Tracé presque complet » / « N segments droits » + note furet « Un passage
est resté en ligne droite » / « Ajouter un point de passage ».

**Barre d'actions** (`index.html` ~338-369, handlers `src/ui-circuit-editor.js`) :
« Boucler le circuit » (ajoute le 1ᵉʳ lieu à la fin) · « Importer un GPX » (trace réelle du
circuit ; en création, peut créer le circuit depuis la trace) · « Calque de référence (guide
Wikiloc…) » (guide visuel, n'entre pas dans le tracé) · « Ouvrir GPX Studio » · « Exporter le
GPX » · « Vider le brouillon ».

**Modules** : `ui-circuit-list.js` (toolbar Mes Circuits + bouton Nouveau) ·
`circuit.js` (orchestration) · `circuit-view.js` (timeline + header + formulaire) ·
`ui-circuit-routing.js` (bloc tracé) · `circuit-routing.js` (BRouter) ·
`circuit-focus.js` (édition du tracé, points de passage) ·
`circuit-reference-layer.js` (calque) · `circuit-actions.js` (sauvegarde) ·
`ui-circuit-editor.js` (boucler / importer / exporter).
