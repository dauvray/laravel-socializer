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
import { watch, onUnmounted } from 'vue'
import { usePeerRetry } from '~socializer/components/WebRTC2/Composables/utils/usePeerRetry.js'
import { ENDPOINTS } from '~socializer/components/WebRTC2/webrtc2.config.js'

export function usePeerCore(ctx) {

    /*------  Retry invitation pour calls ----------*/

    const MAX_INVITE_RETRIES = 20 // max 20 invitations simultanées en attente (Map size guard)

    // Moteur de retry dédié aux invitations (séparé du retryManager connexions de l'orchestrateur)
    const inviteRetryManager = usePeerRetry(ctx)

    // Mapping userSlug → inviteId (pour annulation par inviteId)
    const userSlugToInviteId = new Map()

    const buildInviteId = () => {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID()
        }
        return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    }

    const stopCallInviteRetry = (inviteId) => {
        if (!inviteId) return
        for (const [userSlug, id] of userSlugToInviteId.entries()) {
            if (id === inviteId) {
                stopCallInviteRetryForUser(userSlug)
                return
            }
        }
    }

    const stopCallInviteRetryForUser = (userSlug) => {
        if (!userSlug) return
        inviteRetryManager.clearRetry(userSlug)
        userSlugToInviteId.delete(userSlug)
    }

    const clearAllCallInviteRetries = () => {
        inviteRetryManager.clearAll()
        userSlugToInviteId.clear()
    }

    /*------  Connection directe ----------*/

    /**
     * Demande à un peer distant son peerId pour pouvoir ensuite ouvrir une connexion WebRTC.
     * @param {*} userSlug 
     * @returns 
     */
    const requestRemotePeerConnection = async (userSlug) => {

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

        try {
            await ctx.AjaxService.load(ENDPOINTS.ASK_TO_PEER_ID, 'post', {
                toUserSlug: userSlug,
                room: room,
                type: type
            })
            ctx.peerStore.addWaitingRemotePeerId(userSlug, { room, type })
            return true
        } catch (e) {
            console.error('[usePeerCore] requestRemotePeerConnection failed:', e)
            return false
        }
    }

    /**
     * Répond à une demande de connexion d'un peer distant en lui envoyant notre peerId.
     * @param {*} fromUserSlug 
     * @param {*} type 
     * @param {*} room 
     */
    const responseRemotePeerConnection = async (payload) => {

        try {
            await ctx.AjaxService.load(ENDPOINTS.RESPONSE_TO_PEER_ID, 'post', {
                peerId: ctx.peerStore.localPeer?.id || ctx.peerStore.localPeer?._id || ctx.peerStore.lastLocalPeerId,
                toUserSlug: payload.fromUserSlug,
                room: payload.room,
                type: payload.type
            })
        } catch (e) {
            console.error('[usePeerCore] responseRemotePeerConnection failed:', e)
        }
    }

    /*------  Connection avec accord ----------*/

    const requestAuthorizationRemotePeerId = async (payload) => {

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

        // Éviction de la plus ancienne entrée si la Map atteint la limite
        if (userSlugToInviteId.size >= MAX_INVITE_RETRIES) {
            const oldestSlug = userSlugToInviteId.keys().next().value
            stopCallInviteRetryForUser(oldestSlug)
        }

        userSlugToInviteId.set(toUserSlug, inviteId)

        // Premier envoi immédiat
        try {
            await ctx.AjaxService.load(ENDPOINTS.SEND_ALERT_TO_USER, 'post', {
                toUserSlug,
                options: data
            })
        } catch (e) {
            console.error('[usePeerCore] requestAuthorizationRemotePeerId initial send failed:', e)
            // Le moteur de retry prendra le relais
        }

        // Planifie les tentatives suivantes via le moteur de retry partagé.
        // Le callback retourne true (stop) si l'invitation n'est plus en attente
        // (acceptée, refusée ou annulée), false pour continuer.
        inviteRetryManager.scheduleRetry(toUserSlug, 0, async (userSlug) => {
            if (!userSlugToInviteId.has(userSlug)) return true

            try {
                await ctx.AjaxService.load(ENDPOINTS.SEND_ALERT_TO_USER, 'post', {
                    toUserSlug: userSlug,
                    options: data
                })
            } catch (e) {
                console.error('[usePeerCore] requestAuthorizationRemotePeerId retry send failed:', e)
            }

            return !userSlugToInviteId.has(userSlug)
        })

        return inviteId
    }

    const sendAuthorizationRemotePeerId = async (payload) => { 
        if(payload.status) {
            payload.options.peerId = ctx.peerStore.localPeer?.id || ctx.peerStore.localPeer?._id || ctx.peerStore.lastLocalPeerId
        }

        try {
            await ctx.AjaxService.load(ENDPOINTS.RESPONSE_TO_AUTHORIZATION_PEER, 'post', {
                toUserSlug: payload.fromUserSlug,
                options: payload.status ? payload.options : { type: payload.options.type }, // on envoie les infos de connexion seulement si l'accès est autorisé, sinon on précise juste le type d'appel pour que le client puisse réagir (ex: afficher une notification d'appel refusé)
                status: payload.status
            })
        } catch (e) {
            console.error('[usePeerCore] sendAuthorizationRemotePeerId failed:', e)
        }
    }

    const notifyCloseConnectionToPeer = async (payload) => {
        const toUserSlug = payload?.toUserSlug
        const type = payload?.type || 'visio'
        const room = payload?.room || ctx.session.currentCallRoomId || ctx.session.currentRoom

        if (!toUserSlug || !room) return

        try {
            await ctx.AjaxService.load(ENDPOINTS.CLOSE_CONNECTION_TO_PEER_ID, 'post', {
                toUserSlug,
                fromUserSlug: ctx.mySlug.value,
                room,
                type,
            })
        } catch (e) {
            console.error('[usePeerCore] notifyCloseConnectionToPeer failed:', e)
        }
    }

    /*------  Signal Watcher ----------*/

    const stopSignalWatch = watch(ctx.lastRoomSignal, async (signal) => {
        if (!signal || !ctx.SIGNAL_TYPES.core.includes(signal.type)) return

        switch (signal.type) {
            case 'PEER_CONNECTION_REQUEST':
                await responseRemotePeerConnection(signal.payload)
                break
            default:
                break
        }
    })

    onUnmounted(() => {
        stopSignalWatch()
        clearAllCallInviteRetries()
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