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
 * **aucun** appelant (seule sa propre définition le mentionnait) et le seul normaliseur
 * d'alors — `normalizeType`, dans `EventBus/webrtc2Events.js`, module mort supprimé le
 * 31/08/2026 — ne reconnaissait que `'visio' | 'vocal'` : le type était mort.
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

/**
 * Les deux seuls types d'un APPEL DIRECT entre deux personnes.
 *
 * ⚠️ À ne pas confondre avec `VALID_CALL_TYPES` ci-dessus, et la confusion coûtait cher :
 * celui-là est dérivé de `VALID_CONNECTION_TYPES`, donc il accepte aussi `data`, `stream` et
 * `screen` — légitimes comme type de CONTEXTE (`usePeerOrchestrator`), jamais comme type
 * d'appel. `isValidCallType('screen')` rend `true`, si bien qu'un `startCallWithPeer` sur ce
 * type passait la validation, basculait la FSM en CALLING, puis mourait à l'ouverture de
 * connexion — où `config.stream` vaut `null` et où le `return true` ANNULE le retry. Cul-de-sac
 * silencieux, de la même famille que celui de l'invitation non émise.
 *
 * Le prédicat manquait au paquet, et pourtant il existait : `normalizeType`, dans
 * `EventBus/webrtc2Events.js` — un module que personne n'importait, supprimé le 31/08/2026.
 * C'est la seule chose qu'il valait ; elle est ici désormais.
 */
export const VALID_DIRECT_CALL_TYPES = ['visio', 'vocal']

/**
 * Ramène un type d'appel direct à l'une des deux valeurs admises.
 *
 * Normaliser plutôt que valider, et à la SOURCE : un `validator` de prop Vue ne fait que
 * journaliser (et le paquet n'en utilise nulle part), alors qu'un type non normalisé fuit vers
 * l'aval, où il devient un cul-de-sac. Ici l'icône, le titre et l'invitation disent tous les
 * trois la même chose.
 *
 * @param {*} value
 * @returns {'visio'|'vocal'}
 */
export const normalizeDirectCallType = (value) => {
    if (typeof value !== 'string') {
        return 'visio'
    }

    const type = value.trim().toLowerCase()

    return VALID_DIRECT_CALL_TYPES.includes(type) ? type : 'visio'
}
