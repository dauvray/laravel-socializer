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
 * 
 * 
 * Fonctions concernées dans l'ancien code :
 * ----------------------
 * getAuthorizationRemotePeerId
 * sendAuthorizationRemotePeerId
 * receiveAuthorizationRemotePeerId
 * onResponseCallError
 *
 * getRemotePeerId
 * sendLocalPeerId
 *
 * setCallInProgress
 * setCurrentCallRoomId
 *
 * updateCurrentRoom
 * updateCurrentType
 * 
 */
import { watch } from 'vue'

export function usePeerCore(ctx) {

    const requestRemotePeerConnection = (user) => {

        const room = ctx.session.onAirRoom
        const type = ctx.session.currentType
        const loacalPeerId = ctx.peerStore.localPeer._id
        const remotePeerID = ctx.peerStore.hasRemotePeerId(user.slug)

        if (!remotePeerID) {
            // éviter les requêtes redondantes pour un même utilisateur tant que sa réponse n’est pas reçue
            if(!ctx.peerStore.hasWaitingRemotePeerId(user.slug)) {
                ctx.AjaxService.load('/ask-to-peer-id', 'post', {
                    peerId: loacalPeerId,
                    toUserSlug: user.slug,
                    room: room,
                    type: type
                })
                ctx.peerStore.addWaitingRemotePeerId(user.slug, { room, type })
            }
        } else {
            // connectToQueuedConnections({
            //     peerId: remotePeerID,
            //     userSlug: user.slug,
            //     room: room,
            //     type: type,
            // })
        }
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
        if (!signal) return

        switch (signal.type) {
            case 'sendLocalPeerData':
                await responseRemotePeerConnection(signal.payload.fromUserSlug, signal.payload.type, signal.payload.room)
                break
        }
    })

    return {
        requestRemotePeerConnection,
        responseRemotePeerConnection,
    }
}