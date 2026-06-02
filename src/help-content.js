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
    <p><strong>JPEG.</strong> <span class="help-muted">(iPhone en HEIC → régler sur
    « Le plus compatible », ou convertir en JPEG.)</span></p>
    <p class="help-muted">Le support HEIC est une limite temporaire, prévu plus tard.</p>`;

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
            <li>pour une photo : <strong>Masquer</strong> (œil) ·
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
        'Vos photos <span class="help-muted">(JPEG)</span>',
        'regroupées par lieu',
        'vérifier / ajuster',
        'Enregistrer <span class="help-muted">•</span> Télécharger',
    ],
    sections: [
        {
            heading: '0 · Avant de commencer',
            html: `<p>Format : <strong>JPEG</strong>. Vérifiez que vos photos contiennent
                bien leur <strong>position</strong> → voir « Préparer ses photos ».</p>`,
        },
        {
            heading: '1 · Ouvrir l\'import',
            html: `<p>Menu <strong>Outils → « import photos »</strong> (ou la carte
                « Importer photos GPS » de la visite guidée). Choisissez un lot de photos
                <strong>.jpg</strong> : Heripia lit leur position et ouvre la
                <strong>fenêtre d'organisation</strong>.</p>`,
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
                <strong>Supprimer</strong>.</p>`,
        },
        {
            heading: '4 · Comparer (tri fin)',
            html: `<p>Le bouton <strong>Comparer</strong> ouvre un groupe en grand, jusqu'à
                <strong>6 photos côte à côte</strong>, pour choisir la ou les meilleure(s) :</p>
                <ul class="help-list">
                    <li>la <strong>pellicule</strong> (en bas) montre toutes les photos :
                        cliquez sur une vignette pour l'afficher · glissez pour réordonner ;</li>
                    <li>pour une photo : <strong>Masquer</strong> (œil) ·
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
