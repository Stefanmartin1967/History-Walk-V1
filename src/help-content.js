// help-content.js
// ============================================================================
// Contenu d'aide « Importer des photos ».
// Source unique : docs/aide-import-photos.md.
// Conventions de rédaction : cf. mémoire « feedback_doc_writing_conventions »
//   (Heripia · cliquer [PC] · importer/déposer · « et/ou » · phrases courtes ·
//    concret · vocabulaire technique juste · actif + « à vous de valider » · « • »).
//
// Chaque export est un « point d'aide » au format attendu par help-popover.js :
//   { title, html }  ou  { title, intro, schema, sections, footnote }
// ============================================================================

// — Fragments « Préparer ses photos » (réutilisés : format + position) —
const BLOC_FORMAT = `
    <p><strong>JPEG et HEIC.</strong> <span class="help-muted">Heripia accepte les deux :
    les photos HEIC d'iPhone sont converties automatiquement à l'import.</span></p>`;

const BLOC_POSITION = `
    <p>Activez la <strong>localisation de votre appareil photo</strong>
    <em>avant votre voyage</em> : Heripia place alors vos photos toutes seules sur
    la carte.</p>
    <div class="help-callout" data-tone="warn">
        Les photos reçues par messagerie, ou téléchargées du web, perdent souvent
        leur position : elles arriveront « <strong>À rattacher</strong> » (à relier
        à un lieu à la main).
    </div>`;

/* === ANCRE — « ? » Format (chip « JPEG » de l'en-tête) === */
export const HELP_FORMAT = {
    title: 'Format des photos',
    html: BLOC_FORMAT,
};

/* === ANCRE — « ? » 120 m (distance affichée d'un groupe rattaché) === */
export const HELP_DISTANCE = {
    title: 'Regroupement par lieu',
    html: `
        <p>La distance entre vos photos et le lieu connu le plus proche.</p>
        <p>En dessous de <strong>120&nbsp;m</strong>, Heripia <strong>regroupe
        automatiquement</strong> les photos sur ce lieu et vous les propose
        <span class="help-muted">(à vous de valider)</span>.</p>
        <p class="help-muted">Au-delà, les photos restent « Hors POI » (prises en
        chemin) — vous pouvez toujours les rattacher à la main.</p>`,
};

/* === ANCRE — « ? » sur le badge « À rattacher » / « Hors POI » === */
export const HELP_HORS_POI = {
    title: '« Hors POI » et « À rattacher »',
    html: `
        <p><strong>Hors POI</strong> : photos prises en chemin, sans lieu connu à
        proximité.</p>
        <p><strong>À rattacher</strong> <span class="help-muted">(ambre)</span> : soit
        un lieu connu est à portée (≤ 300 m), soit la photo n'a pas de position — à
        vous de choisir le lieu (menu « Rattacher à un lieu… »).</p>
        <p class="help-muted">Sans position : activez la localisation de votre appareil
        photo avant de partir (voir le guide « ? » en haut).</p>
        <div class="help-callout" data-tone="warn">
            <strong>Une photo non rattachée à un lieu n'est pas enregistrée dans
            Heripia.</strong> Pour la garder : rattachez-la à un lieu, ou téléchargez
            le ZIP.
        </div>`,
};

/* === ANCRE — « ? » sur le bouton « Créer un lieu » === */
export const HELP_CREATE = {
    title: 'Créer un lieu',
    html: `
        <p>Crée un <strong>nouveau lieu</strong> dans Heripia à partir de ces photos,
        à leur position. À utiliser quand l'endroit photographié
        <strong>n'existe pas encore</strong> dans Heripia.</p>
        <p class="help-muted">Si le lieu existe déjà, préférez
        « Rattacher à un lieu… ».</p>`,
};

/* === ANCRE — « ? » sur le titre d'un groupe (renommage → ordre) === */
export const HELP_NAMING = {
    title: 'Nommer pour ordonner',
    html: `
        <p>Le nom (« NN - lieu - PP ») fixe l'<strong>ordre de tri</strong>
        (alphanumérique).</p>
        <p>Vous retrouvez le <strong>même ordre</strong> dans votre dossier et lors
        d'un envoi qui trie par nom <span class="help-muted">(par exemple sur
        Facebook)</span>.</p>
        <p class="help-muted">Renommer un groupe est surtout utile pour un
        « Hors POI » : lui donner un nom parlant.</p>`,
};

/* === ANCRE — « ? » de la fenêtre Comparer === */
export const HELP_COMPARE = {
    title: 'Choisir les meilleures photos',
    html: `
        <p>Affichez vos photos côte à côte pour comparer celles qui se ressemblent et
        garder la ou les meilleure(s).</p>
        <ul class="help-list">
            <li>cliquez sur une vignette de la pellicule pour l'afficher ; glissez pour
                réordonner ;</li>
            <li>pour une photo : <strong>Masquer</strong> (œil) · <strong>Rogner</strong> ·
                <strong>Détacher / Séparer</strong> · <strong>Supprimer</strong> ;</li>
            <li>en bas, les boutons agissent <strong>sur ce groupe</strong> : Fermer la
                comparaison · Télécharger ce groupe · Enregistrer ce lieu.</li>
        </ul>`,
};

/* === Thème complet « Préparer ses photos » (réutilisable : onboarding, etc.) === */
/** @public — réutilisé hors import photo (onboarding « avant de partir »). */
export const HELP_PREPARER = {
    title: 'Préparer ses photos',
    sections: [
        { heading: 'Format', html: BLOC_FORMAT },
        { heading: 'Position (localisation)', html: BLOC_POSITION },
    ],
};

/* === PANNEAU GLOBAL — le guide d'import (parcours complet) === */
export const GUIDE_IMPORT = {
    title: 'Importer des photos',
    intro: `Vous importez vos photos ; Heripia les regroupe automatiquement par lieu,
        grâce à la position enregistrée dans chaque photo. Vous vérifiez et ajustez
        chaque groupe, puis vous <strong>Enregistrez</strong> le résultat dans Heripia,
        <strong>et/ou</strong> vous <strong>Téléchargez</strong> un ZIP sur votre disque.`,
    schema: [
        'Vos photos <span class="help-muted">(JPEG ou HEIC)</span>',
        'regroupées par lieu',
        'vérifier / ajuster',
        'Enregistrer <span class="help-muted">•</span> Télécharger',
    ],
    sections: [
        {
            heading: '0 · Avant de commencer',
            html: `<p>Format : <strong>JPEG ou HEIC</strong> <span class="help-muted">(le
                HEIC d'iPhone est converti automatiquement)</span>. Vérifiez que vos photos
                contiennent bien leur <strong>position</strong> → voir « Préparer ses photos ».</p>`,
        },
        {
            heading: '1 · Ouvrir l\'import',
            html: `<p>Menu <strong>Outils → « import photos »</strong> (ou la carte
                « Importer photos GPS » de la visite guidée). Choisissez un lot de photos
                <strong>.jpg</strong> ou <strong>.heic</strong> : Heripia lit leur position et
                ouvre la <strong>fenêtre d'organisation</strong>.</p>`,
        },
        {
            heading: '2 · Comprendre les groupes',
            html: `<p>À partir de la position des photos, Heripia crée des
                <strong>groupes</strong> :</p>
                <ul class="help-list">
                    <li><strong>Rattaché à un lieu</strong> : un lieu connu est à
                        <strong>moins de 120&nbsp;m</strong> → les photos prises à proximité
                        lui sont rattachées <span class="help-muted">(à vous de valider ; la
                        distance s'affiche : « POI rattaché · 45&nbsp;m »)</span>.</li>
                    <li><strong>« À rattacher »</strong> <span class="help-muted">(ambre)</span> :
                        un lieu connu est à portée, ou la photo n'a pas de position → à vous
                        de choisir le lieu.</li>
                    <li><strong>« Hors POI »</strong> : photos prises en chemin, sans lieu
                        connu à proximité.</li>
                    <li>Les <strong>doublons</strong> (déjà importés) sont écartés
                        automatiquement.</li>
                </ul>`,
        },
        {
            heading: '3 · Ajuster (vue d\'ensemble)',
            html: `<p>Pour chaque groupe : <strong>renommer</strong> ·
                <strong>réordonner</strong> (poignée à gauche) · <strong>déplacer une
                photo</strong> d'un groupe à l'autre (glisser-déposer) ·
                <strong>renommer une photo</strong>.</p>
                <p class="help-muted">Le nom fixe l'ordre de tri (dossier, envoi
                Facebook…) — cf. « Nommer pour ordonner ».</p>
                <p class="help-muted">Selon le cas : Rattacher à un lieu · Créer un lieu ·
                Catégoriser · Éditer la fiche.</p>
                <p>Pour une photo : <strong>Extraire vers Hors POI</strong>
                <span class="help-muted">(icône route)</span> — ou, dans un groupe Hors POI,
                <strong>Séparer</strong> <span class="help-muted">(icône split)</span> ·
                <strong>Supprimer</strong>.</p>
                <p><strong>Rogner</strong> <span class="help-muted">(icône recadrage)</span> :
                recadrer une photo pour couper un bord gênant ; la version rognée remplace
                l'originale dans Heripia. <span class="help-muted">Votre fichier d'origine sur le
                disque n'est pas modifié, et la position (GPS) est conservée.</span></p>`,
        },
        {
            heading: '4 · Comparer (tri fin)',
            html: `<p>Le bouton <strong>Comparer</strong> ouvre un groupe en grand, jusqu'à
                <strong>6 photos côte à côte</strong>, pour choisir la ou les meilleure(s) :</p>
                <ul class="help-list">
                    <li>la <strong>pellicule</strong> (en bas) montre toutes les photos :
                        cliquez sur une vignette pour l'afficher · glissez pour réordonner ;</li>
                    <li>pour une photo : <strong>Masquer</strong> (œil) · <strong>Rogner</strong> ·
                        <strong>Détacher / Séparer</strong> · <strong>Supprimer</strong> ;</li>
                    <li>en bas, les boutons agissent <strong>sur ce groupe</strong> : Fermer
                        la comparaison · Télécharger ce groupe · Enregistrer ce lieu.</li>
                </ul>`,
        },
        {
            heading: '5 · Ajouter d\'autres photos en cours de route',
            html: `<p>Bouton <strong>« Ajouter des photos »</strong> (ou glissez des fichiers
                dans la fenêtre) : cela <strong>complète</strong> votre travail sans rien
                perdre.</p>`,
        },
        {
            heading: '6 · Finaliser — deux boutons à ne pas confondre',
            tone: 'warn',
            html: `<ul class="help-list">
                    <li><strong>Enregistrer</strong> = range les photos <strong>dans
                        Heripia</strong>, rattachées à leurs lieux, dans votre version.
                        <span class="help-muted">(Admin : en attente de publication GitHub.)</span></li>
                    <li><strong>Télécharger le ZIP</strong> = crée un <strong>fichier sur
                        votre disque</strong> (sauvegarde / partage), en dehors de Heripia.</li>
                </ul>
                <div class="help-callout" data-tone="warn">
                    Deux actions indépendantes : enregistrer ne crée pas de ZIP, et
                    télécharger un ZIP n'enregistre rien dans Heripia.
                </div>
                <div class="help-callout" data-tone="warn">
                    <strong>Une photo non rattachée à un lieu n'est pas enregistrée dans
                    Heripia.</strong> Pour la garder : rattachez-la à un lieu, ou
                    téléchargez le ZIP.
                </div>`,
        },
    ],
    footnote: `Astuce : activez la localisation de votre appareil photo <em>avant de
        partir</em> — c'est elle qui place vos photos toutes seules sur la carte.`,
};

// ============================================================================
// Contenu d'aide « Créer un circuit ».
// Source unique : docs/aide-creation-circuit.md (libellés vérifiés dans le code
// et en preview). Mêmes conventions de rédaction que ci-dessus.
// ============================================================================

/* === ANCRE — « ? » sur le hint « Tracer l'itinéraire » (bloc tracé) === */
export const HELP_TRACER = {
    title: 'Tracer l\'itinéraire',
    html: `
        <p><strong>BRouter</strong> calcule un chemin qui <strong>suit les voies
        piétonnes</strong> <span class="help-muted">(rues, sentiers)</span>.</p>
        <p>Il remplace le trait <strong>« à vol d'oiseau »</strong> (la ligne droite entre
        vos lieux) par une <strong>trace réellement marchable</strong>, et donne la
        <strong>vraie distance</strong>.</p>`,
};

/* === ANCRE — « ? » sur le chip « Calque de référence » === */
export const HELP_CALQUE = {
    title: 'Calque de référence',
    html: `
        <p>Une trace GPX <span class="help-muted">(Wikiloc, GPS…)</span> affichée
        <strong>en fond</strong>, comme <strong>guide visuel</strong>.</p>
        <p>Elle <strong>n'entre pas</strong> dans le tracé de votre circuit — elle vous sert
        juste de <strong>repère</strong> pendant que vous le construisez.</p>`,
};

/* === ANCRE — « ? » sur la pastille « séquence modifiée » (tracé périmé) === */
export const HELP_STALE = {
    title: 'Tracé à mettre à jour',
    html: `
        <p>Vous avez <strong>changé les lieux</strong> <span class="help-muted">(ajout,
        retrait ou ordre)</span> depuis le dernier tracé.</p>
        <p>Le tracé affiché ne correspond donc <strong>plus</strong> à la liste actuelle.
        Cliquez <strong>« Re-tracer l'itinéraire »</strong> pour le recalculer.</p>`,
};

/* === ANCRE — « ? » sur la note « Un passage est resté en ligne droite » === */
export const HELP_WAYPOINT = {
    title: 'Segment en ligne droite',
    html: `
        <p>BRouter n'a pas trouvé de chemin pour <strong>un passage</strong> : il le laisse
        en <strong>ligne droite</strong>.</p>
        <p>Ajoutez un <strong>point de passage</strong> <span class="help-muted">(« Éditer
        l'itinéraire » → cliquer sur la carte)</span> pour le guider, ou affinez dans
        <strong>GPX Studio</strong>.</p>`,
};

/* === PANNEAU GLOBAL — le guide « Créer un circuit » (parcours complet) ===
   Posé sur le « ? » de la toolbar « Mes Circuits » (à côté de « Nouveau
   circuit ») → découvrable avant même de commencer un circuit. */
export const GUIDE_CIRCUIT = {
    title: 'Créer un circuit',
    intro: `Un circuit, c'est une suite de <strong>lieux</strong> reliés par un
        <strong>itinéraire</strong>. Vous choisissez les lieux sur la carte, vous les mettez
        dans l'ordre, puis Heripia <strong>trace l'itinéraire</strong> qui suit les chemins.
        Votre travail est enregistré au fur et à mesure — rien à valider pour ne pas le perdre.`,
    schema: [
        'Choisir les lieux',
        'Les ordonner <span class="help-muted">(étapes)</span>',
        'Tracer l\'itinéraire',
        'Brouillon <span class="help-muted">auto-sauvegardé</span>',
    ],
    sections: [
        {
            heading: `0 · Ce qu'est un circuit`,
            html: `<p>Une suite de <strong>lieux</strong> (les <strong>étapes</strong>,
                numérotées 1, 2, 3…) et un <strong>itinéraire</strong> qui les relie. Un lieu
                est un <strong>point d'intérêt</strong> — Heripia l'abrège « <strong>POI</strong> »
                à l'écran <span class="help-muted">(par exemple le compteur « 3&nbsp;POIs »)</span>.</p>
                <p>Tant que vous construisez le circuit, il reste un <strong>brouillon ·
                auto-sauvegardé</strong> : vous pouvez fermer Heripia et le retrouver intact.</p>`,
        },
        {
            heading: `1 · Démarrer`,
            html: `<p>Onglet <strong>Mes Circuits → « Nouveau circuit »</strong> (le
                <strong>+</strong>). Heripia ouvre un circuit vierge et passe la carte en
                <strong>mode création</strong>.</p>`,
        },
        {
            heading: `2 · Ajouter les lieux`,
            html: `<p><strong>Cliquez un lieu sur la carte</strong> : il rejoint le circuit
                <span class="help-muted">(« Commençons par le premier lieu »)</span>. Chaque lieu
                ajouté devient une <strong>étape</strong> numérotée.</p>
                <ul class="help-list">
                    <li><strong>Réordonner</strong> : glissez-déposez une étape
                        <span class="help-muted">(ou les flèches « Monter » / « Descendre »)</span>.</li>
                    <li><strong>Retirer</strong> une étape : <strong>« Retirer du circuit »</strong>
                        <span class="help-muted">(la corbeille)</span>.</li>
                    <li>Au passage, Heripia <strong>nomme le circuit tout seul</strong> et met à
                        jour le <strong>nombre de lieux</strong> et la <strong>distance</strong>.</li>
                </ul>`,
        },
        {
            heading: `3 · Personnaliser le nom, décrire`,
            html: `<ul class="help-list">
                    <li><strong>Nom automatique</strong> : Heripia nomme le circuit d'après vos
                        lieux et le <strong>met à jour à chaque ajout</strong>
                        <span class="help-muted">— « Départ de … » (un seul lieu), « Circuit de … à … »
                        (plusieurs lieux), « Boucle autour de … » (si le départ = l'arrivée)</span>.</li>
                    <li><strong>Votre propre titre</strong> <span class="help-muted">(facultatif)</span> :
                        le <strong>crayon</strong> <span class="help-muted">(ou un double-clic sur le
                        titre)</span> ouvre un champ ; tapez, <strong>Entrée</strong>. Votre titre
                        <strong>remplace</strong> le nom automatique.</li>
                    <li><strong>Description</strong> : cliquez <strong>« Ajouter une description… »</strong>,
                        écrivez ; enregistré dès que vous <strong>sortez du champ</strong>.</li>
                    <li><strong>Transport</strong> <span class="help-muted">(repliable)</span> : temps
                        <span class="help-muted">(min)</span> et/ou coût de l'<strong>aller</strong> et
                        du <strong>retour</strong>.</li>
                </ul>`,
        },
        {
            heading: `4 · Tracer l'itinéraire`,
            html: `<p>Dès <strong>2 lieux</strong>, le bouton <strong>« Tracer l'itinéraire »</strong>
                apparaît.</p>
                <p>Heripia route le circuit avec <strong>BRouter</strong>, qui <strong>suit les
                chemins piétons</strong> : il transforme le trait « à vol d'oiseau » en
                <strong>trace réellement marchable</strong>. Résultat : <strong>« Itinéraire
                tracé »</strong> et la <strong>distance réelle</strong>.</p>
                <p class="help-muted">C'est « Tracer l'itinéraire » qui enregistre le circuit avec
                son tracé.</p>`,
        },
        {
            heading: `5 · Ajuster le tracé`,
            html: `<ul class="help-list">
                    <li><strong>« Éditer l'itinéraire »</strong> : ajoutez des <strong>points de
                        passage</strong> <span class="help-muted">(cliquez sur la carte)</span> pour
                        guider le tracé ; déplacez-les. Seul le segment touché est recalculé.</li>
                    <li><strong>« Tracé presque complet »</strong> : un <strong>segment droit</strong>
                        est un passage que BRouter n'a pas su tracer — il reste en ligne droite.
                        Ajoutez-y un <strong>point de passage</strong> pour le guider.</li>
                    <li><strong>« Re-tracer l'itinéraire »</strong> : si vous changez les lieux après
                        coup, le tracé est signalé <strong>« séquence modifiée »</strong>
                        <span class="help-muted">(« Tracé à mettre à jour »)</span>. Re-tracez pour
                        le remettre à jour.</li>
                </ul>`,
        },
        {
            heading: `6 · Apporter ou afficher une trace existante`,
            html: `<ul class="help-list">
                    <li><strong>« Importer un GPX »</strong> : apporte une trace GPX
                        <span class="help-muted">(Wikiloc, GPS…)</span> <strong>comme itinéraire du
                        circuit</strong>.</li>
                    <li><strong>« Calque de référence »</strong> : affiche une trace GPX <strong>en
                        fond, comme guide visuel</strong>. Elle <strong>n'entre pas</strong> dans le
                        tracé — elle vous sert juste de repère.</li>
                    <li><strong>« Boucler le circuit »</strong> : ajoute le <strong>premier lieu en
                        dernière étape</strong> (retour au départ).</li>
                    <li><strong>« Affiner dans GPX Studio »</strong> : outil externe, pour les montages
                        spéciaux <span class="help-muted">(option, pas une obligation)</span>.</li>
                </ul>`,
        },
        {
            heading: `7 · Enregistrer et retrouver le circuit`,
            html: `<ul class="help-list">
                    <li><strong>Brouillon auto-sauvegardé</strong> en continu → le circuit vit dans
                        <strong>Mes Circuits</strong>.</li>
                    <li><strong>« Exporter le GPX »</strong> : crée un <strong>fichier .gpx</strong> sur
                        votre disque <span class="help-muted">(sauvegarde ou partage)</span>, en dehors
                        d'Heripia.</li>
                    <li><strong>« Vider le brouillon »</strong> : repartir de zéro.</li>
                </ul>
                <p class="help-muted">Vos circuits restent <strong>sur cet appareil</strong>. Pour les
                emporter sur un autre appareil ou ne pas les perdre, <strong>sauvegardez vos
                données</strong> depuis <strong>Mon Espace</strong>.</p>`,
        },
    ],
    footnote: `Astuce : posez d'abord tous les lieux dans l'ordre, puis <strong>tracez à la
        fin</strong>. Vous pourrez toujours réordonner et <strong>re-tracer</strong>.`,
};

// ============================================================================
// Contenu d'aide « Créer ou éditer un lieu ».
// Source unique : docs/aide-creation-edition-lieu.md (libellés + valeurs de
// taxonomie vérifiés dans le code et en preview). Mêmes conventions.
// ============================================================================

/* === PANNEAU GLOBAL — le guide « Créer ou éditer un lieu » ===
   Posé sur le « ? » du header de la modale richEditor (« Nouveau Lieu » /
   « Éditer le Lieu »). La découvrabilité du clic droit relève d'un autre
   chantier (« Vue d'ensemble »). */
export const GUIDE_LIEU = {
    title: 'Créer ou éditer un lieu',
    intro: `Chaque lieu a une <strong>fiche</strong> : nom, catégorie, descriptions, infos
        pratiques, position. Vous <strong>créez</strong> un nouveau lieu, ou vous
        <strong>enrichissez</strong> un lieu existant. Tout est enregistré dans votre
        version d'Heripia.`,
    schema: [
        'Clic droit <span class="help-muted">(ou « Éditer »)</span>',
        'Remplir la fiche',
        'Enregistrer',
    ],
    sections: [
        {
            heading: `0 · La fiche d'un lieu`,
            html: `<p>Un lieu se décrit par une <strong>fiche</strong>. Deux façons d'y
                arriver : <strong>créer</strong> un nouveau lieu, ou <strong>éditer</strong>
                un lieu déjà présent. C'est le <strong>même formulaire</strong> dans les deux
                cas.</p>`,
        },
        {
            heading: `1 · Créer un lieu`,
            html: `<p><strong>Cliquez droit</strong> à l'endroit voulu sur la carte. Un
                marqueur apparaît avec la question <strong>« Nouveau Lieu ? »</strong> :</p>
                <ul class="help-list">
                    <li><strong>glissez</strong> le marqueur pour ajuster la position ;</li>
                    <li><em>Maps</em> et <em>OSM</em> ouvrent l'endroit pour <strong>vérifier</strong> ;</li>
                    <li>cliquez <strong>« Valider cette position »</strong> → la fiche
                        <strong>« Nouveau Lieu »</strong> s'ouvre.</li>
                </ul>
                <p class="help-muted">Deux autres entrées mènent à la même fiche : la
                <strong>recherche</strong> d'un lieu encore absent, et « Créer un lieu » à
                l'import photo.</p>`,
        },
        {
            heading: `2 · Éditer un lieu`,
            html: `<p>Sur la fiche d'un lieu, le bouton <strong>« Éditer »</strong> ouvre le
                formulaire <strong>« Éditer le Lieu »</strong> (mêmes champs, déjà remplis).</p>`,
        },
        {
            heading: `3 · L'essentiel pour enregistrer`,
            html: `<p>Deux champs suffisent à enregistrer :</p>
                <ul class="help-list">
                    <li><strong>Nom (FR)</strong> — obligatoire ;</li>
                    <li><strong>Catégorie</strong> — à choisir <span class="help-muted">(« Choisir une catégorie… »)</span>.</li>
                </ul>
                <p>Tant qu'il manque l'un des deux, <strong>« Enregistrer »</strong> reste
                <strong>grisé</strong>. La <strong>Zone</strong> <span class="help-muted">(Houmt
                Souk, Midoun…)</span> se remplit <strong>toute seule</strong> d'après la
                position — non modifiable.</p>`,
        },
        {
            heading: `4 · Catégorie et précisions`,
            html: `<p>Choisir la <strong>Catégorie</strong> fait apparaître, selon le type de
                lieu, jusqu'à trois précisions :</p>
                <ul class="help-list">
                    <li><strong>Sous-type</strong> — la variante du lieu. <span class="help-muted">Quand
                        la catégorie en propose (Mosquée, Église, Artisanat), il choisit aussi
                        l'icône sur la carte : une mosquée à minaret, à coupoles ou fortifiée
                        n'a pas le même pictogramme.</span></li>
                    <li><strong>État</strong> — par exemple <em>En activité</em>,
                        <em>Désaffecté</em>, <em>Ruine</em>.</li>
                    <li><strong>Accès</strong> — <em>Intérieur visitable</em>, <em>Extérieur
                        seulement</em> ou <em>Non visitable</em>.</li>
                </ul>
                <p class="help-muted">Ces champs restent masqués tant qu'aucune catégorie n'est
                choisie ; les valeurs dépendent de la catégorie.</p>`,
        },
        {
            heading: `5 · Décrire`,
            html: `<ul class="help-list">
                    <li><strong>Description courte</strong> — un <strong>résumé</strong>
                        <span class="help-muted">(il apparaît dans la liste)</span>.</li>
                    <li><strong>Description complète</strong> — le texte détaillé du lieu.</li>
                </ul>`,
        },
        {
            heading: `6 · Infos pratiques`,
            html: `<p>Pour enrichir la fiche <span class="help-muted">(facultatif)</span> :
                <strong>temps de visite</strong>, <strong>prix</strong> (en TND),
                <strong>téléphone</strong>, <strong>horaires</strong>, <strong>Facebook</strong>.</p>`,
        },
        {
            heading: `7 · Source et notes`,
            html: `<ul class="help-list">
                    <li><strong>Source</strong> — d'où vient l'information
                        <span class="help-muted">(un lien et/ou un texte)</span>.</li>
                    <li><strong>Notes</strong> — vos remarques personnelles.</li>
                </ul>`,
        },
        {
            heading: `8 · Position et enregistrer`,
            html: `<ul class="help-list">
                    <li><strong>« Déplacer »</strong> <span class="help-muted">(en bas de la
                        fiche)</span> : réajuster le point sur la carte ; les coordonnées GPS
                        s'affichent à côté.</li>
                    <li><strong>« Enregistrer »</strong> : le lieu rejoint <strong>votre
                        version</strong> d'Heripia. <strong>« Annuler »</strong> ferme sans
                        rien garder.</li>
                </ul>
                <p class="help-muted">En édition, les flèches <strong>Précédent / Suivant</strong>
                passent d'un lieu à l'autre quand le lieu fait partie d'un circuit affiché.</p>`,
        },
    ],
    footnote: `Astuce : un clic droit <strong>n'importe où</strong> sur la carte crée un lieu
        à cet endroit — ajustez-le ensuite par glisser, ou avec « Déplacer ». Vos lieux restent
        sur cet appareil : pour les sauvegarder, passez par <strong>Mon Espace</strong>.`,
};
