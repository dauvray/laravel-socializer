/**
 * phases.js — Le cycle de vie du `Peer` singleton, en un seul nom.
 *
 * Extrait dans son propre fichier pour la raison de `keys.js` : la phase est un CONTRAT
 * partagé entre l'écriture (les transitions, dans `actions.js`, appelées par le seul
 * `usePeerTransport`), la lecture (`peerIdentity` / `peerStateViolations`, dans
 * `getters.js`) et le double de test (`createMockContext`). Une seconde table de
 * transitions recopiée quelque part divergerait sans jamais lever.
 *
 * ── Ce que la phase remplace ─────────────────────────────────────────────────
 *
 * Deux prédicats DÉCLARÉS répondaient à « où en est le Peer ? » : `localPeerReady` (un
 * booléen, donc muet sur tout ce qui n'est pas « ouvert ») et la présence de
 * `peerInitPromise` (un moyen d'attente, détourné en état). Ils étaient écrits depuis
 * quatre endroits, dans un ordre que rien ne contrôlait.
 *
 * Ce que la phase ne remplace PAS : `localPeer.destroyed` et `localPeer.disconnected`,
 * qui sont des faits OBSERVÉS, écrits par PeerJS. Ils gardent le dernier mot — cf.
 * `peerIdentity`, où l'observation l'emporte sur la déclaration. C'est la seule
 * conception qui ne puisse pas mentir : une phase qui prétendrait `ready` sur un peer
 * détruit ne serait pas crue, elle serait SIGNALÉE (`pret-mais-detruit`).
 */

/**
 * Les phases déclarées, dans l'ordre du cycle de vie.
 *
 * ABSENT     → aucun Peer, et rien en vol
 * CREATING   → init en cours, AVANT le `new Peer` (l'aller-retour ICE de `_doInit`)
 * CONNECTING → l'instance existe, son `'open'` n'est pas arrivé
 * READY      → `'open'` reçu : le pair est joignable
 * DISCONNECTED → socket tombé (`'disconnected'`), reconnexion possible ou non
 */
export const PEER_PHASES = {
    ABSENT: 'absent',
    CREATING: 'creating',
    CONNECTING: 'connecting',
    READY: 'ready',
    DISCONNECTED: 'disconnected',
}

/**
 * Les enchaînements attendus. `destroyed` n'y figure pas : c'est un fait observé sur
 * l'instance, jamais une phase déclarée — une destruction se solde par un retour à
 * `absent` (`resetPeerState`), pas par une phase terminale de plus.
 *
 * `disconnected → ready` est direct : `reconnect()` réutilise l'instance, et c'est le
 * même handler `'open'` qui conclut.
 */
export const PEER_PHASE_TRANSITIONS = {
    [PEER_PHASES.ABSENT]: [PEER_PHASES.CREATING],
    [PEER_PHASES.CREATING]: [PEER_PHASES.CONNECTING, PEER_PHASES.ABSENT],
    [PEER_PHASES.CONNECTING]: [PEER_PHASES.READY, PEER_PHASES.DISCONNECTED, PEER_PHASES.ABSENT],
    [PEER_PHASES.READY]: [PEER_PHASES.DISCONNECTED, PEER_PHASES.ABSENT],
    [PEER_PHASES.DISCONNECTED]: [PEER_PHASES.READY, PEER_PHASES.CONNECTING, PEER_PHASES.ABSENT],
}

/**
 * Cet enchaînement est-il prévu ?
 *
 * ⚠️ **Le refus n'est PAS le comportement**, et c'est la différence de fond avec
 * `useCallStateMachine`, qui refuse et rend `false`. Là-bas, la FSM ARBITRE des actions
 * (« un appel déjà en cours ne se relance pas ») : refuser est la décision. Ici, la phase
 * ne fait que SUIVRE le cycle de vie d'une bibliothèque tierce — refuser une transition
 * laisserait la phase décrire un peer qui n'existe plus, c'est-à-dire recréer exactement
 * la divergence qu'elle est là pour supprimer. Une transition inattendue est donc
 * appliquée, et journalisée.
 *
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
export function isExpectedPeerPhaseTransition(from, to) {
    if (from === to) return true
    return (PEER_PHASE_TRANSITIONS[from] ?? []).includes(to)
}
