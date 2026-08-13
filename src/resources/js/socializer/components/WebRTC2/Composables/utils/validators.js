/**
 * validators.js — Gardes de format partagés (slug utilisateur, type d'appel)
 *
 * Utilitaire pur : aucun état, aucune dépendance au contexte, importable depuis
 * n'importe quelle couche. Regroupe les gardes qui étaient dupliqués dans
 * `usePeerOrchestrator` et `usePeerTransport`, et dont `useConnectionPool` /
 * `useCallManager` ont besoin tous les deux.
 *
 * ⚠️ `VALID_CALL_TYPES` n'est PAS `VALID_CONNECTION_TYPES` (webrtc2.config.js) :
 * les types d'appel acceptent `'audio'`, les types de connexion PeerJS non.
 * Asymétrie historique conservée telle quelle — la fusionner changerait le
 * comportement de `startCallWithPeer` / `acceptCallFromPeer` (cf. TODOLIST).
 */
import { SLUG_PATTERN } from '../../webrtc2.config.js'

/** Types d'appel acceptés par la couche appels (payloads entrants inclus). */
export const VALID_CALL_TYPES = ['data', 'visio', 'vocal', 'stream', 'screen', 'audio']

/**
 * Valide un slug utilisateur (provenance : payload réseau ou signalisation).
 * @param {*} value
 * @returns {boolean}
 */
export const isValidSlug = (value) =>
    typeof value === 'string' && SLUG_PATTERN.test(value)

/**
 * Valide un type d'appel.
 * @param {*} value
 * @returns {boolean}
 */
export const isValidCallType = (value) =>
    typeof value === 'string' && VALID_CALL_TYPES.includes(value)
