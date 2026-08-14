/**
 * validators.js — Gardes de format partagés (slug utilisateur, type d'appel)
 *
 * Utilitaire pur : aucun état, aucune dépendance au contexte, importable depuis
 * n'importe quelle couche. Regroupe les gardes qui étaient dupliqués dans
 * `usePeerOrchestrator` et `usePeerTransport`, et dont `useConnectionPool` /
 * `useCallManager` ont besoin tous les deux.
 *
 * `VALID_CALL_TYPES` est désormais **dérivé** de `VALID_CONNECTION_TYPES` : une seule
 * source de vérité pour les deux couches.
 *
 * Historiquement les deux jeux divergeaient — la couche appels acceptait `'audio'`, pas
 * la couche connexions. Un appel `'audio'` passait donc la validation d'entrée puis se
 * faisait refuser à l'ouverture de connexion : jamais fonctionnel, et l'échec arrivait
 * loin de sa cause. Vérification faite avant de trancher, `'audio'` n'était émis par
 * **aucun** appelant (seule sa propre définition le mentionnait) et `normalizeType`
 * (EventBus/webrtc2Events.js) ne reconnaît que `'visio' | 'vocal'` : le type était mort.
 * D'où l'alignement sur `VALID_CONNECTION_TYPES`, qui fait autorité.
 */
import { SLUG_PATTERN, VALID_CONNECTION_TYPES } from '../../webrtc2.config.js'

/** Types d'appel acceptés par la couche appels (payloads entrants inclus). */
export const VALID_CALL_TYPES = [...VALID_CONNECTION_TYPES]

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
