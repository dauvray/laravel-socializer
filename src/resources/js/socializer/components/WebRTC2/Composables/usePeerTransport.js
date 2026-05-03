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
 * Fonctions concernées :
 * ----------------------
 * setLocalPeer
 * registerIncomingPeerCallback
 * unregisterIncomingPeerCallback
 * sendData
 */

export function usePeerTransport(ctx) {

    const setLocalDataPeer = (callbacks) => {
        registerIncomingPeerCallbacks(callbacks)
        ctx.peerStore.setLocalDataPeer(ctx.session.currentType)
    }

    const registerIncomingPeerCallbacks = (callbacks) => {
        ctx.peerStore.registerIncomingPeerCallbacks(`${ctx.session.currentType}-${ctx.session.onAirRoom}`, callbacks)
    }

    const unregisterIncomingPeerCallbacks = (callbacks) => {
        ctx.peerStore.unregisterIncomingPeerCallbacks(`${ctx.session.currentType}-${ctx.session.onAirRoom}`)
    }

    const sendData = (data) => {
        ctx.peerStore.sendData(data, ctx.session.onAirRoom)
    }

    return {
        setLocalDataPeer,
        sendData
    }
}