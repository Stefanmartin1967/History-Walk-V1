// hero-framing.js
// ─── Mode « Cadrer » de la photo d'en-tête de fiche (admin, PC, 07/11/2026) ───
// Une photo paysage n'est coupée qu'en haut et en bas dans le hero (cf.
// photo-focus.js). L'admin clique la puce « Cadrer », fait glisser la photo
// vers le haut ou le bas (souris, ou flèches ↑ ↓), puis Valider / Annuler.
//
// Choix d'interface :
//   - PC seulement : sur mobile, glisser se battrait avec le défilement de la
//     fiche. Le résultat, lui, s'affiche partout.
//   - Un MODE plutôt qu'un glisser direct : un clic sur la photo ouvre la
//     visionneuse ; il ne doit jamais déplacer la photo par mégarde.
//   - Puce en BAS à gauche : le haut gauche porte « Photos gardées », le haut
//     droit le compteur.
//   - Pas de puce quand il n'y a rien à cadrer : portrait (affiché entier) ou
//     photo plus panoramique que le bandeau (aucune marge verticale).
//
// Enregistrement : updatePoiData(poiId, 'photoFocus', …) → overlay userData →
// Centre de Contrôle (« Cadrage photo ») → publication avec le data.
import { state } from './state.js';
import { updatePoiData } from './data.js';
import { getPoiProp } from './utils.js';
import { createIcons, appIcons } from './lucide-icons.js';
import { setHeroFocus, verticalSlack } from './hero-photo.js';
import { FOCUS_KEY, getPhotoFocus, withPhotoFocus, clampFocus } from './photo-focus.js';

// En dessous de cette marge (px), le cadrage ne changerait presque rien.
const MIN_SLACK_PX = 12;
const KEY_STEP = 2; // % par appui sur ↑ / ↓

/**
 * Pose la puce « Cadrer » sur le hero si la photo a de la marge verticale.
 * Appelé par la fiche quand les dimensions de la photo sont connues.
 *
 * @param {HTMLElement} hero  #poi-hero
 * @param {object} ctx
 * @param {object} ctx.feature   POI affiché
 * @param {string} ctx.poiId
 * @param {string} ctx.url       photo affichée (photos[0] publiée)
 * @param {{width:number, height:number}} ctx.measured  dimensions naturelles
 */
export function attachHeroFraming(hero, { feature, poiId, url, measured }) {
    if (!hero?.isConnected || hero.querySelector('.cartel-hero-frame')) return;
    const slackNow = () => verticalSlack(hero.clientWidth, hero.clientHeight, measured.width, measured.height);
    if (slackNow() < MIN_SLACK_PX) return;

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'cartel-hero-frame';
    chip.title = 'Choisir la partie visible de la photo';
    chip.setAttribute('aria-label', chip.title);
    chip.innerHTML = '<span class="cartel-chip cartel-chip--muted"><i data-lucide="crop"></i>Cadrer</span>';
    chip.addEventListener('click', (e) => {
        e.stopPropagation(); // sinon le clic remonte au hero → visionneuse
        enterFraming();
    });
    hero.appendChild(chip);
    createIcons({ icons: appIcons, root: chip });

    function enterFraming() {
        const startFocus = getPhotoFocus(feature, url);
        let y = startFocus ?? 50;
        let drag = null;

        hero.classList.add('is-framing');
        chip.hidden = true;

        const bar = document.createElement('div');
        bar.className = 'cartel-hero-framebar';
        bar.innerHTML =
            '<span class="cartel-chip cartel-chip--muted cartel-hero-framehint"><i data-lucide="move-vertical"></i><span>Glisse la photo</span></span>'
            + '<button type="button" class="cartel-chip cartel-hero-framebtn" data-act="cancel"><i data-lucide="x"></i>Annuler</button>'
            + '<button type="button" class="cartel-chip cartel-hero-framebtn is-primary" data-act="save"><i data-lucide="check"></i>Valider</button>';
        hero.appendChild(bar);
        createIcons({ icons: appIcons, root: bar });

        const apply = (v) => { y = clampFocus(v); setHeroFocus(hero, y); };

        const onPointerDown = (e) => {
            if (e.button !== 0 || e.target.closest('.cartel-hero-framebar')) return;
            e.preventDefault();
            drag = { startClientY: e.clientY, startY: y, slack: slackNow() };
            hero.setPointerCapture?.(e.pointerId);
        };
        const onPointerMove = (e) => {
            if (!drag || drag.slack <= 0) return;
            // Photo tirée vers le bas = on découvre le haut = position plus petite.
            apply(drag.startY - ((e.clientY - drag.startClientY) / drag.slack) * 100);
        };
        const onPointerUp = (e) => {
            if (!drag) return;
            drag = null;
            hero.releasePointerCapture?.(e.pointerId);
        };
        const onKey = (e) => {
            if (!hero.isConnected) { cleanup(); return; } // fiche re-rendue
            // Même sens que le glisser : ↓ descend la photo (découvre le haut).
            const actions = {
                ArrowUp: () => apply(y + KEY_STEP),
                ArrowDown: () => apply(y - KEY_STEP),
                Escape: cancel,
                Enter: save,
            };
            if (!actions[e.key]) return;
            e.preventDefault();
            e.stopPropagation();
            actions[e.key]();
        };

        function cleanup() {
            hero.removeEventListener('pointerdown', onPointerDown);
            hero.removeEventListener('pointermove', onPointerMove);
            hero.removeEventListener('pointerup', onPointerUp);
            hero.removeEventListener('pointercancel', onPointerUp);
            document.removeEventListener('keydown', onKey, true);
            bar.remove();
            hero.classList.remove('is-framing');
            chip.hidden = false;
        }
        function cancel() {
            setHeroFocus(hero, startFocus);
            cleanup();
            chip.focus();
        }
        async function save() {
            cleanup();
            if (y === (startFocus ?? 50)) { chip.focus(); return; }
            const next = withPhotoFocus(getPoiProp(feature, FOCUS_KEY), getPoiProp(feature, 'photos'), url, y);
            await updatePoiData(poiId, FOCUS_KEY, next);
            chip.focus();
        }

        bar.addEventListener('click', (e) => {
            e.stopPropagation();
            const act = e.target.closest('[data-act]')?.dataset.act;
            if (act === 'cancel') cancel();
            else if (act === 'save') save();
        });
        hero.addEventListener('pointerdown', onPointerDown);
        hero.addEventListener('pointermove', onPointerMove);
        hero.addEventListener('pointerup', onPointerUp);
        hero.addEventListener('pointercancel', onPointerUp);
        // Capture : passe avant les raccourcis globaux (Échap ferme la fiche).
        document.addEventListener('keydown', onKey, true);
        bar.querySelector('[data-act="save"]').focus();
    }
}

/** Mode « Cadrer » permis ici ? (admin, PC, photo publiée). */
export function canFrameHero({ isMobile, url }) {
    return state.isAdmin === true && !isMobile && typeof url === 'string' && !/^(blob|data):/i.test(url);
}
