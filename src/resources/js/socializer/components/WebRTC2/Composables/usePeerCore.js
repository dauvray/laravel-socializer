/**
 * 🧠 usePeerCore (Signaling Layer)
 * 
 *  gestion des identités, autorisations, peerId exchange (tout ce qui passe par HTTP/Ajax + store sans ouvrir de connexion)
 *
 * 👉 gère :
 * - échanges de peerId (ask / response)
 * - autorisations de connexion
 * - communication avec le backend (Ajax)
 *
 * 👉 ne gère PAS :
 * - connexions WebRTC (peer.connect / peer.call)
 * - MediaStream
 *
 * 👉 rôle :
 * - agir comme serveur de signalisation côté client
 * - préparer les informations nécessaires aux connexions 
 */
import { watch } from 'vue'

export function usePeerCore(ctx) {

    /*------  Retry invitation pour calls ----------*/

    const inviteRetries = new Map()
    const userSlugToInviteId = new Map()

    const buildInviteId = () => {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID()
        }
        return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    }

    const stopCallInviteRetry = (inviteId) => {
        if (!inviteId) return
        // Cherche le userSlug associé à cet inviteId
        for (const [userSlug, id] of userSlugToInviteId.entries()) {
            if (id === inviteId) {
                stopCallInviteRetryForUser(userSlug)
                return
            }
        }
    }

    const stopCallInviteRetryForUser = (userSlug) => {
        if (!userSlug) return
        const state = inviteRetries.get(userSlug)
        if (!state) return
        state.stopped = true
        if (state.timer) {
            clearTimeout(state.timer)
        }
        inviteRetries.delete(userSlug)
        userSlugToInviteId.delete(userSlug)
    }

    const clearAllCallInviteRetries = () => {
        inviteRetries.forEach((state) => {
            state.stopped = true
            if (state.timer) clearTimeout(state.timer)
        })
        inviteRetries.clear()
        userSlugToInviteId.clear()
    }

    /*------  Connection directe ----------*/

    /**
     * Demande à un peer distant son peerId pour pouvoir ensuite ouvrir une connexion WebRTC.
     * @param {*} userSlug 
     * @returns 
     */
    const requestRemotePeerConnection = (userSlug) => {

        const room = ctx.session.onAirRoom
        const type = ctx.session.currentType
        const localPeerId =
            ctx.peerStore.localPeer?.id
            || ctx.peerStore.localPeer?._id
            || ctx.peerStore.lastLocalPeerId

        if (!localPeerId) {
            console.warn('localPeer pas encore prêt')
            return false
        }

        const waiting = ctx.peerStore.getWaitingRemotePeerId(userSlug)
        if (waiting && waiting.room === room && waiting.type === type) {
            const age = Date.now() - (waiting.createdAt ?? 0)

            // Si on a déjà demandé ce peerId récemment, on évite le spam réseau.
            if (age < 12000) {
                return false
            }
        }

        ctx.AjaxService.load('/ask-to-peer-id', 'post', {
            toUserSlug: userSlug,
            room: room,
            type: type
        })
        ctx.peerStore.addWaitingRemotePeerId(userSlug, { room, type })
        return true
    }

    /**
     * Répond à une demande de connexion d'un peer distant en lui envoyant notre peerId.
     * @param {*} fromUserSlug 
     * @param {*} type 
     * @param {*} room 
     */
    const responseRemotePeerConnection = (payload) => {

        ctx.AjaxService.load('/response-to-peer-id', 'post', {
            peerId: ctx.peerStore.localPeer?.id || ctx.peerStore.localPeer?._id || ctx.peerStore.lastLocalPeerId,
            toUserSlug: payload.fromUserSlug,
            room: payload.room,
            type: payload.type
        })
    }

    /*------  Connection avec accord ----------*/

    const requestAuthorizationRemotePeerId = (payload) => {

        const localPeerId =
            ctx.peerStore.localPeer?.id
            || ctx.peerStore.localPeer?._id
            || ctx.peerStore.lastLocalPeerId

        const inviteId = payload?.inviteId || buildInviteId()
        const toUserSlug = payload.toUserSlug

        const data = {
            type: payload.type,
            action: 'peer-access-permission',
            room: ctx.session.currentCallRoomId,
            peerId: localPeerId,
            inviteId,
        }

        ctx.peerStore.addWaitingRemotePeerId(toUserSlug, data)

        // Enregistre le mapping
        userSlugToInviteId.set(toUserSlug, inviteId)

        const state = {
            stopped: false,
            timer: null,
            attempts: 0,
            maxAttempts: 7,
        }

        inviteRetries.set(toUserSlug, state)

        const sendAttempt = async () => {
            if (state.stopped) return

            await ctx.AjaxService.load('/send-alert-to-user', 'post', {
                toUserSlug: toUserSlug,
                options: data
            })

            if (state.stopped) return

            if (state.attempts >= state.maxAttempts) {
                inviteRetries.delete(toUserSlug)
                userSlugToInviteId.delete(toUserSlug)
                return
            }

            const delay = Math.min(1200 * (2 ** state.attempts), 10000) + Math.floor(Math.random() * 400)
            state.attempts += 1
            state.timer = setTimeout(sendAttempt, delay)
        }

        sendAttempt()
        return inviteId
    }

    const sendAuthorizationRemotePeerId = (payload) => { 
        if(payload.status) {
            payload.options.peerId = ctx.peerStore.localPeer?.id || ctx.peerStore.localPeer?._id || ctx.peerStore.lastLocalPeerId
        }

        ctx.AjaxService.load('/response-to-authorization-peer', 'post', {
            toUserSlug: payload.fromUserSlug,
            options: payload.status ? payload.options : { type: payload.options.type }, // on envoie les infos de connexion seulement si l'accès est autorisé, sinon on précise juste le type d'appel pour que le client puisse réagir (ex: afficher une notification d'appel refusé)
            status: payload.status
        }) 
    }

    const notifyCloseConnectionToPeer = (payload) => {
        const toUserSlug = payload?.toUserSlug
        const type = payload?.type || 'visio'
        const room = payload?.room || ctx.session.currentCallRoomId || ctx.session.currentRoom

        if (!toUserSlug || !room) return

        ctx.AjaxService.load('/close-connection-to-peer-id', 'post', {
            toUserSlug,
            fromUserSlug: ctx.mySlug.value,
            room,
            type,
        })
    }

    /*------  Signal Watcher ----------*/

    watch(ctx.lastRoomSignal, async (signal) => {
        if (!signal || !ctx.SIGNAL_TYPES.core.includes(signal.type)) return

        switch (signal.type) {
            case 'PEER_CONNECTION_REQUEST':
                await responseRemotePeerConnection(signal.payload)
                break
            default:
                break
        }
    })

    return {
        requestRemotePeerConnection,
        responseRemotePeerConnection,
        requestAuthorizationRemotePeerId,
        sendAuthorizationRemotePeerId,
        notifyCloseConnectionToPeer,
        stopCallInviteRetry,
        stopCallInviteRetryForUser,
        clearAllCallInviteRetries,
    }
}