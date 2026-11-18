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
