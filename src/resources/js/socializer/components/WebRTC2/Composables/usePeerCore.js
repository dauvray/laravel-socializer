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

    const requestRemotePeerConnection = (userSlug) => {

        const room = ctx.session.onAirRoom
        const type = ctx.session.currentType
        const localPeerId = ctx.peerStore.localPeer._id
        ctx.AjaxService.load('/ask-to-peer-id', 'post', {
            peerId: localPeerId,
            toUserSlug: userSlug,
            room: room,
            type: type
        })
        ctx.peerStore.addWaitingRemotePeerId(userSlug, { room, type })
    }

    const responseRemotePeerConnection = (fromUserSlug, type, room) => {

        ctx.AjaxService.load('/response-to-peer-id', 'post', {
            peerId: ctx.peerStore.localPeer._id,
            toUserSlug: fromUserSlug,
            room: room,
            type: type
        })
    }

    watch(ctx.lastRoomSignal, async (signal) => {
        if (!signal || !ctx.SIGNAL_TYPES.core.includes(signal.type)) return

        switch (signal.type) {
            case 'PEER_CONNECTION_REQUEST':
                await responseRemotePeerConnection(signal.payload.fromUserSlug, signal.payload.type, signal.payload.room)
                break
        }
    })

    return {
        requestRemotePeerConnection,
        responseRemotePeerConnection,
    }
}