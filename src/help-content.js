// help-content.js
// ============================================================================
// Contenu d'aide « Importer des photos ».
// Source unique : docs/aide-import-photos.md (validé Stefan, 02/06/2026).
// Réutilisé par : l'aide « ? » in-app (1 panneau global + 3 ancres inline).
// Le même contenu alimente aussi l'onboarding et les visuels FB (hors scope ici).
//
// Chaque export est un « point d'aide » au format attendu par help-popover.js :
//   { title, html }  ou  { title, intro, schema, sections, footnote }
// ============================================================================

// — §A : thème transversal « Préparer ses photos » (contenu source UNIQUE) —
// Réutilisé tel quel dans l'ancre HEIC (bloc Format) et l'ancre Sans GPS (bloc
// Position GPS). On le déclare une fois en fragments pour éviter la duplication.
const BLOC_FORMAT = `
    <p><strong>JPEG.</strong> <span class="help-muted">(iPhone en HEIC → régler sur
    « Le plus compatible » ou convertir.)</span></p>
    <p class="help-muted">Le support HEIC est une limite temporaire, prévu plus tard.</p>`;

const BLOC_GPS = `
    <p>Activez le <strong>GPS de votre appareil photo</strong> <em>avant votre voyage</em> →
    vos photos se placent toutes seules sur la carte.</p>
    <div class="help-callout" data-tone="warn">
        Les photos reçues par messagerie ou téléchargées du web perdent souvent leur
        position → elles arriveront en <strong>« Sans GPS »</strong> (à rattacher à la main).
    </div>`;

/* === ANCRE 1 — « ? » HEIC (à l'entrée / format) === */
export const HELP_FORMAT = {
    title: 'Format des photos',
    html: BLOC_FORMAT,
};

/* === ANCRE 2 — « ? » 120 m (distance affichée d'un groupe) === */
export const HELP_DISTANCE = {
    title: 'Regroupement par lieu',
    html: `
        <p>La distance entre vos photos et le lieu connu le plus proche.</p>
        <p>En dessous de <strong>120&nbsp;m</strong>, l'app <strong>regroupe
        automatiquement</strong> les photos sur ce lieu et vous les propose.</p>
        <p class="help-muted">Au-delà, les photos restent « Hors POI » (prises en chemin) —
        vous pouvez toujours les rattacher à la main.</p>`,
};

/* === ANCRE 3 — « ? » Sans GPS (groupe « Sans GPS ») === */
export const HELP_SANS_GPS = {
    title: 'Position (GPS)',
    html: BLOC_GPS,
};

/* === Thème complet « Préparer ses photos » (réutilisable : onboarding, lien
   depuis le guide). Combine Format + Position. === */
/** @public — réutilisé hors import photo (onboarding « avant de partir »). */
export const HELP_PREPARER = {
    title: 'Préparer ses photos',
    sections: [
        { heading: 'Format', html: BLOC_FORMAT },
        { heading: 'Position (GPS)', html: BLOC_GPS },
    ],
};

/* === PANNEAU GLOBAL — le guide d'import (parcours complet, §B) === */
export const GUIDE_IMPORT = {
    title: 'Importer des photos',
    intro: `Vous donnez vos photos à l'app, elle les <strong>regroupe automatiquement
        par lieu</strong> grâce au GPS, vous <strong>vérifiez / ajustez</strong> chaque
        groupe, puis vous <strong>Enregistrez dans l'app</strong> et/ou
        <strong>Téléchargez un ZIP</strong> sur votre disque.`,
    schema: [
        'Vos photos <span class="help-muted">(JPEG)</span>',
        'regroupées par lieu',
        'vous vérifiez / ajustez',
        'Enregistrer <span class="help-muted">&amp;/ou</span> Télécharger',
    ],
    sections: [
        {
            heading: '0 · Avant de commencer',
            html: `<p>Format : <strong>JPEG</strong>. Pensez au <strong>GPS</strong> de vos
                photos → voir <em>« Préparer ses photos »</em>.</p>`,
        },
        {
            heading: '1 · Ouvrir l\'import',
            html: `<p>Menu <strong>Outils → import photos</strong> (ou la carte « Importer
                photos GPS » de la visite guidée). Choisissez un lot de photos
                <strong>.jpg</strong>. L'app lit leur position et ouvre la fenêtre de
                traitement.</p>`,
        },
        {
            heading: '2 · Comprendre les groupes',
            html: `<p>L'app crée des <strong>groupes</strong> selon la position des photos :</p>
                <ul class="help-list">
                    <li><strong>Rattaché à un lieu</strong> : un lieu connu est à
                        <strong>moins de 120&nbsp;m</strong> → ses photos lui sont proposées
                        <span class="help-muted">(la distance réelle est affichée :
                        « POI rattaché · 45&nbsp;m »)</span>.</li>
                    <li><strong>« Hors POI »</strong> : photos prises en chemin, aucun lieu
                        connu à proximité.</li>
                    <li><strong>« Sans GPS »</strong> <span class="help-muted">(tout en bas)</span> :
                        photos sans position → à <strong>rattacher à la main</strong>.</li>
                    <li>Les <strong>doublons</strong> (déjà importés) sont écartés
                        automatiquement.</li>
                </ul>`,
        },
        {
            heading: '3 · Ajuster (vue d\'ensemble)',
            html: `<p>Par groupe : <strong>renommer</strong> · <strong>réordonner</strong>
                (poignée à gauche) · <strong>déplacer une photo</strong> d'un groupe à l'autre
                (glisser-déposer) · <strong>renommer une photo</strong> (= son nom dans le ZIP).</p>
                <p class="help-muted">Selon le cas : Rattacher au plus proche · changer de lieu ·
                Créer un lieu · Rattacher à un lieu… (Sans GPS) · Catégoriser · Éditer la fiche.</p>
                <p>Par photo : <strong>Extraire vers Hors POI</strong> <span class="help-muted">(icône
                route)</span> ou, sur un groupe Hors POI, <strong>Séparer</strong>
                <span class="help-muted">(icône split)</span> · <strong>Supprimer</strong>.</p>`,
        },
        {
            heading: '4 · Comparer (tri fin)',
            html: `<p>Le bouton <strong>Comparer</strong> ouvre un groupe en grand, jusqu'à
                <strong>6 photos côte à côte</strong> :</p>
                <ul class="help-list">
                    <li>la <strong>pellicule</strong> (en bas) montre toutes les photos : taper
                        une vignette l'affiche · glisser pour réordonner ;</li>
                    <li>par photo : <strong>Masquer</strong> (œil) · <strong>Détacher / Séparer</strong>
                        · <strong>Supprimer</strong> ;</li>
                    <li>en bas, les boutons agissent <strong>sur ce groupe</strong> : Fermer la
                        comparaison · Télécharger ce groupe · Enregistrer ce lieu.</li>
                </ul>`,
        },
        {
            heading: '5 · Ajouter d\'autres photos en cours',
            html: `<p>Bouton <strong>« Ajouter des photos »</strong> (ou glissez des fichiers dans
                la fenêtre) : ça <strong>complète</strong> sans rien perdre de votre travail.</p>`,
        },
        {
            heading: '6 · Finaliser — les deux boutons à ne pas confondre',
            tone: 'warn',
            html: `<ul class="help-list">
                    <li><strong>Enregistrer</strong> = range les photos <strong>dans l'app</strong>,
                        rattachées à leurs lieux, dans votre version.
                        <span class="help-muted">(Admin : en attente de publication GitHub.)</span></li>
                    <li><strong>Télécharger ZIP</strong> = un <strong>fichier sur votre disque</strong>
                        (sauvegarde / partage), hors de l'app.</li>
                </ul>
                <div class="help-callout" data-tone="warn">
                    <strong>Deux actions indépendantes</strong> : enregistrer ne crée pas de ZIP,
                    et inversement.
                </div>`,
        },
    ],
    footnote: `Astuce : activez le GPS de votre appareil photo <em>avant de partir</em> —
        c'est ce qui place vos photos toutes seules sur la carte.`,
};
