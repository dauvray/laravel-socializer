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

    /*------  Connection directe ----------*/

    /**
     * Demande à un peer distant son peerId pour pouvoir ensuite ouvrir une connexion WebRTC.
     * @param {*} userSlug 
     * @returns 
     */
    const requestRemotePeerConnection = (userSlug) => {

        const room = ctx.session.onAirRoom
        const type = ctx.session.currentType
        const localPeerId = ctx.peerStore.localPeer._id

        if (!localPeerId) {
            console.warn('requestRemotePeerConnection ignoré: localPeer pas encore prêt')
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
            peerId: localPeerId,
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
    const responseRemotePeerConnection = (fromUserSlug, type, room) => {

        ctx.AjaxService.load('/response-to-peer-id', 'post', {
            peerId: ctx.peerStore.localPeer._id,
            toUserSlug: fromUserSlug,
            room: room,
            type: type
        })
    }

    /*------  Connection avec accord ----------*/

    const requestAuthorizationRemotePeerId = (toUserSlug = '', type = 'vocal') => {

        const localPeerId =
            ctx.peerStore.localPeer?.id
            || ctx.peerStore.localPeer?._id
            || ctx.peerStore.lastLocalPeerId

        ctx.session.currentCallRoomId = Math.random().toString(36).substring(2, 10) // ID de room temporaire pour sécuriser l'échange de peerId

        const data = {
            type: type,
            action: 'peer-access-permission',
            room: ctx.session.currentCallRoomId,
            peerId: localPeerId,
        }

        ctx.peerStore.addWaitingRemotePeerId(toUserSlug, data)

        ctx.AjaxService.load('/send-alert-to-user', 'post', {
            toUserSlug: toUserSlug,
            options: data
        }) 
    }

    const sendAuthorizationRemotePeerId = (payload) => { 
        ctx.session.currentCallRoomId = payload.options.room 
        payload.options.peerId = ctx.peerStore.localPeer?.id || ctx.peerStore.localPeer?._id || ctx.peerStore.lastLocalPeerId

        ctx.AjaxService.load('/response-to-authorization-peer', 'post', {
            toUserSlug: payload.fromUserSlug,
            options: payload.status ? payload.options : null,
            type: payload.options.type, // on ajoute type pour pouvoir gérer la fermeture du call en cas de refus d'autorisation
            status: payload.status
        }) 
    }

    /*------  Signal Watcher ----------*/

    watch(ctx.lastRoomSignal, async (signal) => {
        if (!signal || !ctx.SIGNAL_TYPES.core.includes(signal.type)) return

        switch (signal.type) {
            case 'PEER_CONNECTION_REQUEST':
                await responseRemotePeerConnection(signal.payload.fromUserSlug, signal.payload.type, signal.payload.room)
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
    }
}