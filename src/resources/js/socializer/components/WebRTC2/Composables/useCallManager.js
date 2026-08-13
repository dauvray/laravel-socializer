/**
 * ☎️ useCallManager (Call Layer)
 *
 *  cycle de vie d'un appel : invite → accept → open → stop → reset
 *
 * 👉 gère :
 * - les transitions de la machine d'état d'appel (ctx.callMachine)
 * - l'ID de room d'appel et la liste des participants
 * - l'arrêt partiel (un pair) et complet (tout l'appel), local ou distant
 * - les retries d'invitation (délégués à usePeerCore)
 *
 * 👉 utilise (par injection, jamais par import) :
 * - usePeerCore (signalisation), usePeerMedia (stream + players),
 *   usePeerConnections (fermeture), usePeerTransport (peer local),
 *   useConnectionPool (établissement + annulation des retries)
 *
 * 👉 ne connaît PAS :
 * - l'orchestrateur ni useStreamManager : aucune couche supérieure ne lui est injectée
 * - l'UI métier ni les composants Vue
 *
 * 🔒 Seul propriétaire de `ctx.callMachine` en dehors de `createPeerContext` : la
 * couche streams passe par les verbes `markCallConnected` / `isRemoteClosing` /
 * `beginRemoteClosing` / `endRemoteClosing` plutôt que de transitionner elle-même.
 */

import { CALL_STATES } from '~socializer/components/WebRTC2/Composables/utils/useCallStateMachine.js'
import { isValidSlug, isValidCallType } from '~socializer/components/WebRTC2/Composables/utils/validators.js'

export function useCallManager(ctx, { core, media, connections, transport, pool }) {

    /*---------------------
    | ROOM D'APPEL
    ------------------------*/

    const setCurrentCallRoomId = (roomId = null) => {
        ctx.session.currentCallRoomId = roomId || null
        return ctx.session.currentCallRoomId
    }

    /**
     * Retourne un ID de room valide pour les appels, en utilisant l'ID préféré si fourni,
     * ou en générant un nouvel ID si nécessaire.
     * @param {*} preferred
     * @returns
     */
    const ensureCurrentCallRoomId = (preferred = null) => {
        if (preferred) {
            ctx.session.currentCallRoomId = preferred
            return ctx.session.currentCallRoomId
        }

        if (!ctx.session.currentCallRoomId) {
            ctx.session.currentCallRoomId = crypto.randomUUID()
        }

        return ctx.session.currentCallRoomId
    }

    /*---------------------
    | ÉTAT
    ------------------------*/

    const isCallInProgress = () => {
        return ctx.callMachine.callInprogress.value
    }

    const callStatus = () => {
        return ctx.callStatus.value
    }

    /**
     * Confirme qu'un appel reçu est réellement établi.
     * Appelé par la couche streams (`useStreamManager`) quand le premier flux distant
     * arrive : c'est elle qui observe le flux, mais c'est ici qu'on décide de la
     * transition — la FSM n'a qu'un seul propriétaire.
     *
     * @returns {boolean} true si la transition a eu lieu
     */
    const markCallConnected = () => {
        if (ctx.callMachine.callState.value !== CALL_STATES.RECEIVING) return false
        return ctx.callMachine.transition(CALL_STATES.CONNECTED)
    }

    /*---------------------
    | GARDE PAR PARTICIPANT
    | Fermetures individuelles concurrentes : orthogonal à l'état global (plusieurs
    | départs peuvent coexister en CONNECTED sans déclencher de CLOSING).
    | Exposé pour que la couche streams n'ait pas à toucher ctx.callMachine.
    ------------------------*/

    const isRemoteClosing    = (userSlug) => ctx.callMachine.isUserClosing(userSlug)
    const beginRemoteClosing = (userSlug) => ctx.callMachine.markUserClosing(userSlug)
    const endRemoteClosing   = (userSlug) => ctx.callMachine.unmarkUserClosing(userSlug)

    /*---------------------
    | OUVERTURE D'APPEL
    ------------------------*/

    const startCallWithPeer = (payload) => {
        if (!payload || typeof payload !== 'object') return
        if (!isValidSlug(payload.toUserSlug)) return

        const ready = transport.setLocalPeer()
        if (!ready) return

        const toUserSlug = payload.toUserSlug
        const type = isValidCallType(payload.type) ? payload.type : 'visio'

        // Room imposée par l'appelant (ex: salle déjà identifiée côté serveur).
        // Absente → ensureCurrentCallRoomId conserve la room courante ou en génère une.
        const room = (typeof payload.room === 'string' && payload.room.trim().length > 0)
            ? payload.room.trim()
            : null

        // Transition en premier : évite toute mutation d'état si un appel est déjà en cours.
        if (!ctx.callMachine.transition(CALL_STATES.CALLING)) return

        ensureCurrentCallRoomId(room)
        ctx.addCurrentCallUser(toUserSlug, type)
        ctx.session.currentType = type

        core.requestAuthorizationRemotePeerId({ toUserSlug, type })
        return
    }

    /**
     * Démarre la session d'appel locale.
     * Commun à `acceptCallFromPeer` (récepteur qui accepte) et `openCallBetweenPeer` (initiateur confirmé).
     * Configure l'état, démarre le stream local et crée l'élément vidéo local.
     *
     * @param {string}      fromUserSlug - Slug de l'interlocuteur
     * @param {string|null} room         - ID de room (null → conserve ou génère)
     * @param {string}      type         - Type d'appel (visio, vocal, …)
     */
    const _enterCallSession = async ({ fromUserSlug, room, type }) => {
        ensureCurrentCallRoomId(room)
        ctx.addCurrentCallUser(fromUserSlug, type)
        ctx.session.currentType = type

        await media.startCurrentStream(true)
        media.createVideoElement(
            { videoId: 'local-webcam', type, source: 'local' },
            ctx.media.currentStream
        )
    }

    const acceptCallFromPeer = async (payload) => {
        if (!payload || typeof payload !== 'object') return

        const ready = transport.setLocalPeer()
        if (!ready) return

        if (payload?.status) {
            const fromUserSlug = payload?.fromUserSlug
            if (!isValidSlug(fromUserSlug)) return

            const room = payload?.options?.room || null
            const type = isValidCallType(payload?.options?.type) ? payload.options.type : 'visio'

            // Mapping peerId vérifié de l'initiateur : DOIT être posé AVANT que sa peer.call
            // n'arrive (autrement _isAuthorizedIncomingPeer ne pourra pas valider l'identité
            // PeerJS réelle). `core.sendAuthorizationRemotePeerId` écrase ensuite
            // `payload.options.peerId` avec le peerId LOCAL — d'où l'enregistrement ici.
            if (payload?.options?.peerId) {
                ctx.peerStore.addRemotePeerId(fromUserSlug, payload.options.peerId)
            }

            if (!ctx.callMachine.transition(CALL_STATES.RECEIVING)) return
            await _enterCallSession({ fromUserSlug, room, type })
        }

        // ✅ Ajouter l'inviteId dans les options retournées
        const options = payload?.options || {}
        if (payload?.options?.inviteId) {
            options.inviteId = payload.options.inviteId
        }

        core.sendAuthorizationRemotePeerId({ ...payload,
            options,  // ← assure que inviteId est inclus
        })
        return
    }

    const openCallBetweenPeer = async (payload) => {
        if (!payload || typeof payload !== 'object') return

        // Arrête le retry pour ce userSlug (fiable peu importe le retour de inviteId)
        if (payload?.fromUserSlug && isValidSlug(payload.fromUserSlug)) {
            core.stopCallInviteRetryForUser(payload.fromUserSlug)
        }

        if(!payload?.status) {
            ctx.removeCurrentCallUser(payload.fromUserSlug)
            if(ctx.session.currentCallUsers.length === 0) {
                await stopCallWithPeers([], false, {
                    mode: 'full',
                })
            }
            return
        }

        const fromUserSlug = payload?.fromUserSlug
        if (!isValidSlug(fromUserSlug)) return

        const room = payload?.options?.room || null
        const type = isValidCallType(payload?.options?.type) ? payload.options.type : 'visio'

        ctx.peerStore.removeWaitingRemotePeerId(fromUserSlug)
        ctx.peerStore.addRemotePeerId(fromUserSlug, payload.options.peerId)

        if (!ctx.callMachine.transition(CALL_STATES.CONNECTED)) return
        await _enterCallSession({ fromUserSlug, room, type })

        pool.requestOrConnectPeer(fromUserSlug)
    }

    /*---------------------
    | FERMETURE D'APPEL
    ------------------------*/

    const stopCallWithPeers = async (users = [], notifyRemote = true, options = {}) => {
        const mode = options?.mode || 'full'

        // Garde full  : la transition vers CLOSING est le mutex du full stop.
        // Garde partial : géré par closingUsers (par utilisateur) en amont dans remoteStopCall.
        if (mode !== 'partial') {
            if (!ctx.callMachine.transition(CALL_STATES.CLOSING)) return
        }

        try {
            const roomId = options?.roomId || ctx.session.currentCallRoomId || ctx.currentRoom.value

            ctx.beginShutdown()  // 🛑 Bloquer les retries immédiatement

            const callType = ctx.session.currentType || 'visio'

            const normalizedUsers = (users || [])
                .map((u) => ({ userSlug: u?.userSlug || u?.slug, type: u?.type || callType }))
                .filter((u) => !!u.userSlug)

            if (notifyRemote) {
                normalizedUsers.forEach((u) => {
                    core.notifyCloseConnectionToPeer({
                        toUserSlug: u.userSlug,
                        type: u.type || callType,
                        room: roomId,
                    })
                })
            }

            if (mode === 'partial') {
                normalizedUsers.forEach((u) => {
                    pool.clearRetry(u.userSlug)
                    ctx.peerStore.removeWaitingRemotePeerId(u.userSlug)
                })

                connections.closePeerConnection({
                    room: roomId,
                    type: callType,
                    users: normalizedUsers.map((u) => u.userSlug),
                    clearSignalQueue: false,
                })

                ctx.endShutdown()  // ✅ Réactiver les retries après partial close
                return
            }

            // === MODE FULL ===
            pool.clearAllRetries()

            connections.closePeerConnection({
                room: roomId,
                type: callType,
                clearSignalQueue: true,
            })

            media.stopCurrentStream()
            media.removeVideoElement('local-webcam')
            ctx.session.currentCallRoomId = null

            ctx.endShutdown()  // ✅ Réactiver après cleanup complet

            resetCallState()  // → callMachine.reset() : CLOSING → IDLE
        } finally {
            // Filet de sécurité : si resetCallState n'a pas été appelé (exception),
            // garantir qu'on ne reste pas coincé en état CLOSING.
            if (ctx.callMachine.isStopping.value) {
                ctx.callMachine.reset()
            }
        }
    }

    const remoteStopCall = async (payload) => {
        if (!payload || typeof payload !== 'object') return

        const remoteSlug = payload?.fromUserSlug || null
        const remoteType = isValidCallType(payload?.type) ? payload.type : 'visio'
        const roomId = payload?.room || ctx.session.currentCallRoomId || ctx.currentRoom.value

        if (!remoteSlug || !isValidSlug(remoteSlug)) return
        if (isRemoteClosing(remoteSlug)) return

        beginRemoteClosing(remoteSlug)

        await stopCallWithPeers([{ userSlug: remoteSlug, type: remoteType }], false, {
            mode: 'partial',
            roomId,
        })

        ctx.removeCurrentCallUser(remoteSlug)
        media.removeVideoElement(`remote-${remoteSlug}-${remoteType}`)
        ctx.media.remoteStreamsMap.forEach((value, key) => {
            if (value?.metadata?.from === remoteSlug) {
                ctx.media.remoteStreamsMap.delete(key)
            }
        })

        if (ctx.session.currentCallUsers.length === 0) {
            await stopCallWithPeers([], false, {
                mode: 'full',
                roomId,
            })
        }

        endRemoteClosing(remoteSlug)

        ctx.eventBus.$emit('close-call', [{
            userSlug: remoteSlug,
            type: remoteType,
        }])
    }

    const resetCallState = () => {
        media.cleanupCallPlayers()
        ctx.callMachine.reset()  // CLOSING → IDLE + closingUsers.clear()
        ctx.clearCurrentCallUsers()
        setCurrentCallRoomId(null)
        ctx.media.remoteStreamsMap.clear()
    }

    /*---------------------
    | RETRIES D'INVITATION
    ------------------------*/

    const stopCallInviteRetry = (inviteId) => {
        if (!inviteId) return
        core.stopCallInviteRetry(inviteId)
    }

    const clearAllCallInviteRetries = () => {
        core.clearAllCallInviteRetries()
    }

    return {
        // ouverture
        startCallWithPeer,
        acceptCallFromPeer,
        openCallBetweenPeer,

        // fermeture
        stopCallWithPeers,
        remoteStopCall,
        resetCallState,

        // room d'appel
        setCurrentCallRoomId,
        ensureCurrentCallRoomId,

        // état
        isCallInProgress,
        callStatus,

        // FSM — verbes destinés à la couche streams
        markCallConnected,
        isRemoteClosing,
        beginRemoteClosing,
        endRemoteClosing,

        // retries d'invitation
        stopCallInviteRetry,
        clearAllCallInviteRetries,
    }
}
