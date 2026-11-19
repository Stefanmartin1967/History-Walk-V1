// note-plan.js — que faire d'une note privée entre cet appareil et le dépôt
// (18/11/2026, point 3 des conflits, maquette « notes privées » validée).
// Module pur : décision seulement, l'exécution est dans note-sync.js.
//
// Chaque note locale retient `noteSync` (overlay perso, jamais publié) :
//   { sha, base, dirty, remote?, remoteSha? }
//   sha   : version du fichier du dépôt sur laquelle la note d'ici est basée
//           (null : pas de fichier ; undefined : jamais synchronisée, note
//           d'avant ce chantier) ;
//   base  : texte de cette version (départ commun pour la fusion) ;
//   dirty : modifiée ici, pas encore envoyée ;
//   remote / remoteSha : version du dépôt en conflit, en attente de résolution.

const norm = (t) => String(t ?? '').replace(/\r\n/g, '\n').trim();

/**
 * @param {string} local note d'ici
 * @param {object|undefined} sync noteSync d'ici
 * @param {{text: string, sha: string}|null} remote note du dépôt (null : absente)
 * @returns {{action: 'none'|'adopt'|'take'|'push'|'clear'|'conflict', base?: string}}
 */
export function decideNote(local, sync, remote) {
    const L = norm(local);
    if (remote && norm(remote.text) === L) return { action: 'adopt' };         // déjà pareil

    // Note d'avant ce chantier, jamais synchronisée ni touchée depuis : LE DÉPÔT
    // GAGNE (décision de Stefan, 19/11/2026). Avant, un appareil qui avait déjà
    // une note ne la relisait jamais : sa copie est restée à la version de
    // l'époque pendant que l'autre appareil la corrigeait (84 notes de Djerba
    // sur le téléphone, version de mars). Et une note absente du dépôt y avait
    // été SUPPRIMÉE ailleurs : la renvoyer la ressuscitait (13 notes le
    // 19/11). Ne joue qu'une fois : ensuite chaque note a sa version de départ.
    if (isUntouchedLegacy(sync)) {
        if (!remote) return { action: L ? 'clear' : 'adopt' };
        return { action: 'take' };
    }

    if (!remote) {
        if (!L) return { action: sync && sync.sha === null && !sync.dirty ? 'none' : 'adopt' };
        // Supprimée ailleurs, intacte ici → on la retire ici aussi.
        if (sync && sync.sha && !sync.dirty && L === norm(sync.base)) return { action: 'clear' };
        return { action: 'push' };                                             // jamais partie, ou recréée ici
    }

    // Le dépôt n'a pas bougé depuis la version de départ : la version d'ici est la plus récente.
    if (sync && sync.sha && remote.sha === sync.sha) {
        return L === norm(sync.base) && !sync.dirty ? { action: 'adopt' } : { action: 'push' };
    }

    // Le dépôt a changé (ou départ inconnu).
    if (!L && !(sync && sync.dirty)) return { action: 'take' };                // rien ici : on prend
    if (sync && sync.sha !== undefined && !sync.dirty && L === norm(sync.base)) return { action: 'take' };
    return { action: 'conflict', base: sync && sync.sha !== undefined ? (sync.base ?? '') : '' };
}

/** Note d'avant ce chantier : aucune version retenue, pas modifiée ici depuis. */
function isUntouchedLegacy(sync) {
    return !sync || (sync.sha === undefined && !sync.dirty);
}

/**
 * Conflit enregistré AVANT la règle « le dépôt gagne » (18-19/11/2026) pour
 * une note d'avant ce chantier : départ vide, aucune version, pas de marque
 * `legacy`. Il est rejoué avec la nouvelle règle. Les conflits écrits depuis
 * portent `legacy: false` et ne sont jamais touchés.
 */
export function isPreRuleLegacyConflict(sync) {
    return !!sync && sync.remote !== undefined && sync.legacy === undefined
        && (sync.sha === null || sync.sha === undefined) && (sync.base ?? '') === '';
}

