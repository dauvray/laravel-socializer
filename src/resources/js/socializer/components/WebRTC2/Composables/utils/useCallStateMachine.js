import { ref, computed } from 'vue'

/**
 * États possibles d'un appel.
 *
 * IDLE       → pas d'appel actif
 * CALLING    → initiateur : invite envoyée, en attente de réponse
 * RECEIVING  → récepteur  : invitation acceptée, session en cours d'initialisation
 * CONNECTED  → appel actif (flux établis)
 * CLOSING    → fermeture complète en cours (full stop)
 */
export const CALL_STATES = {
    IDLE:      'idle',
    CALLING:   'calling',
    RECEIVING: 'receiving',
    CONNECTED: 'connected',
    CLOSING:   'closing',
}

/**
 * Transitions autorisées par état courant.
 *
 * IDLE      → CALLING | RECEIVING
 * CALLING   → CONNECTED | CLOSING | IDLE  (IDLE = refus direct, CLOSING = annulation avec cleanup)
 * RECEIVING → CONNECTED | CLOSING | IDLE
 * CONNECTED → CLOSING
 * CLOSING   → IDLE
 */
const VALID_TRANSITIONS = {
    [CALL_STATES.IDLE]:      [CALL_STATES.CALLING, CALL_STATES.RECEIVING],
    [CALL_STATES.CALLING]:   [CALL_STATES.CONNECTED, CALL_STATES.CLOSING, CALL_STATES.IDLE],
    [CALL_STATES.RECEIVING]: [CALL_STATES.CONNECTED, CALL_STATES.CLOSING, CALL_STATES.IDLE],
    [CALL_STATES.CONNECTED]: [CALL_STATES.CLOSING],
    [CALL_STATES.CLOSING]:   [CALL_STATES.IDLE],
}

/**
 * Crée une machine d'état réactive pour le cycle de vie d'un appel.
 *
 * Remplace les trois flags éparpillés dans createPeerContext :
 *   - session.callInprogress  → dérivé : callInprogress = (state !== IDLE)
 *   - session.isStoppingCall  → dérivé : isStopping     = (state === CLOSING)
 *   - session.closingUsers    → encapsulé : isUserClosing / markUserClosing / unmarkUserClosing
 *
 * @param {string} contextId  Identifiant du contexte peer (utilisé dans les avertissements)
 */
export function createCallStateMachine(contextId = '') {

    const callState = ref(CALL_STATES.IDLE)

    /**
     * Garde par utilisateur pour les fermetures individuelles concurrentes.
     * Utilisé par `useCallManager.handleRemoteDeparture` — point d'entrée unique du
     * départ d'un pair — pour dédoublonner les deux transports qui peuvent l'annoncer
     * (signal serveur / fermeture de connexion PeerJS).
     * Orthogonal à l'état global : plusieurs fermetures partielles peuvent coexister
     * en état CONNECTED sans déclencher de CLOSING global.
     *
     * Reste privé à la closure — l'API publique passe par les accesseurs
     * isUserClosing / markUserClosing / unmarkUserClosing pour éviter toute
     * mutation externe non prévue (clear, iteration, etc.).
     */
    const closingUsers = new Set()

    const isUserClosing     = (slug) => closingUsers.has(slug)
    const markUserClosing   = (slug) => closingUsers.add(slug)
    const unmarkUserClosing = (slug) => closingUsers.delete(slug)

    // ── Transitions ────────────────────────────────────────────────────────────

    const canTransition = (to) =>
        (VALID_TRANSITIONS[callState.value] ?? []).includes(to)

    /**
     * Tente la transition vers `to`.
     * @param {string} to  Une des constantes CALL_STATES
     * @returns {boolean}  true si la transition a été effectuée
     */
    const transition = (to) => {
        if (!canTransition(to)) {
            console.warn(`[CallFSM][${contextId}] Transition invalide : ${callState.value} → ${to}`)
            return false
        }
        callState.value = to
        return true
    }

    // ── Dérivés (remplacent les anciens flags booléens) ─────────────────────────

    /** Remplace session.callInprogress : vrai dès qu'un appel est en cours (hors IDLE). */
    const callInprogress = computed(() => callState.value !== CALL_STATES.IDLE)

    /** Remplace session.isStoppingCall : vrai uniquement pendant un full stop. */
    const isStopping = computed(() => callState.value === CALL_STATES.CLOSING)

    // ── Reset complet ──────────────────────────────────────────────────────────

    /** Remet la machine à IDLE et vide closingUsers (appelé en fin de cleanup). */
    const reset = () => {
        callState.value = CALL_STATES.IDLE
        closingUsers.clear()
    }

    return {
        callState,
        canTransition,
        transition,
        callInprogress,
        isStopping,
        isUserClosing,
        markUserClosing,
        unmarkUserClosing,
        reset,
        CALL_STATES,
    }
}
