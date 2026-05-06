/**
 * 📡 usePeerTransport (DataChannel Layer)
 * 
 * abstraction du transport DATA (PeerJS data connections)
 * 
 *
 * 👉 gère :
 * - communication via datachannel (send / receive)
 * - enregistrement des callbacks entrants
 *
 * 👉 ne gère PAS :
 * - audio / vidéo
 * - UI
 * - signaling
 *
 * 👉 rôle :
 * - abstraction du transport de données temps réel
 * - indépendant du media (réutilisable pour chat, events, etc.)
 * 
 * Fonctions concernées dans l'ancien code :
 * ----------------------
 * setLocalPeer
 * registerIncomingPeerCallback
 * unregisterIncomingPeerCallback
 * sendData
 */

import { Peer } from "peerjs"
import { watch } from 'vue'

export function usePeerTransport(ctx) {

    const setLocalPeer = () => {

        if(ctx.peerStore.localPeerReady) return

        const peerStore = ctx.peerStore
        peerStore.localPeerReady = true

        peerStore.localPeer =  new Peer({
            host: import.meta.env.VITE_PEERS_SERVER_HOST,
            port: import.meta.env.VITE_PEERS_SERVER_PORT,
            path: import.meta.env.VITE_PEERS_SERVER_PATH,
            key: import.meta.env.VITE_PEERS_SERVER_KEY,
            secure: true,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    {
                        urls: `turn:${import.meta.env.VITE_PEERS_SERVER_HOST}:3478`,
                        username: import.meta.env.VITE_COTURN_USERNAME,
                        credential: import.meta.env.VITE_COTURN_CREDENTIAL
                    }
                ]
            }
        })

        peerStore.localPeer.on('open', id => {
            // Workaround for peer.reconnect deleting previous id
            if (id === null) {
                peerStore.localPeer.id = peerStore.lastLocalPeerId
            } else {
                peerStore.lastLocalPeerId = id
            }
        })

        peerStore.localPeer.on('error', (err) => {
            console.error('Erreur PeerJS :', err);
        })

        peerStore.localPeer.on('disconnected', () => {
            // Workaround for peer.reconnect deleting previous id
            peerStore.localPeer.id = peerStore.lastLocalPeerId
            peerStore.localPeer._lastServerId = peerStore.lastLocalPeerId
            peerStore.localPeer.reconnect()
        })

    }

    const sendData = (data, destUserSlugs = null) => {
        const users = destUserSlugs || ctx.connection.usersInRoom
        users.forEach(userSlug => {
            ctx.peerStore.getConnections[ctx.session.onAirRoom][userSlug]['data'][0].send(data)
        })
    }

    return {
        setLocalPeer,
        sendData,
    }
}