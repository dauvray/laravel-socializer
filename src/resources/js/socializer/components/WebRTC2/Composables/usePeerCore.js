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