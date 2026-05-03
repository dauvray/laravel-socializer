/**
 * 🔧 usePeerOrchestrator (Technical Orchestrator)
 * 
 *  point d’entrée unique + coordination + DOM
 *
 * 👉 gère :
 * - point d’entrée unique pour tout le système peer
 * - coordination entre Core / Media / Connections / Transport
 * - exposition d’une API simple aux features (useMediaBroadcast)
 *
 * 👉 utilise :
 * - createPeerContext (instance isolée)
 * - usePeerCore / usePeerMedia / usePeerConnections / usePeerTransport
 *
 * 👉 ne connaît PAS :
 * - UI métier (aucun état type isMuted, isVideoCall…)
 * - composants Vue
 *
 * 👉 rôle :
 * - façade technique unifiée
 * - éviter que les couches supérieures manipulent directement les sous-modules
 * 
 * Fonctions concernées :
 * ----------------------
 * createVideoElement
 * removeVideoElement
 * closeEventBusStream
 */

import { inject } from 'vue'
import { createPeerContext } from '~socializer/components/WebRTC2/Composables/createPeerContext.js'
import { usePeerCore } from '~socializer/components/WebRTC2/Composables/usePeerCore.js'
import { usePeerMedia } from '~socializer/components/WebRTC2/Composables/usePeerMedia.js'
import { usePeerConnections } from '~socializer/components/WebRTC2/Composables/usePeerConnections.js'
import { usePeerTransport } from '~socializer/components/WebRTC2/Composables/usePeerTransport.js'

export function usePeerOrchestrator( type = 'data', room = 'app') {

    const eventBus = inject('eventBus')

    const context = createPeerContext({
        type,
        room,
        eventBus
    })

    const core = usePeerCore(context)
    const media = usePeerMedia(context)
    const connections = usePeerConnections(context)
    const transport = usePeerTransport(context)

    /**
     * 🔥 Glue logique (SEUL endroit où tu mixes les couches)
     */
    // const startCall = async (userSlug) => {
    //     await media.startWebcamStream({ video: true, audio: true })

    //     core.getRemotePeerId(userSlug)
    // }

    // const handleRemotePeer = (payload) => {
    //     connections.connectToPeer({
    //         ...payload,
    //         stream: context.currentStream.value
    //     })
    // }

    const initializePeerConnection = (callbacks) => {

        const type = context.currentType

        switch(type) {
            case 'stream':
            case 'screen':
                transport.setLocalVideoPeer(callbacks)
                break
            case 'call':
                // pour les appels, on attend d’avoir le stream avant de créer le peer (car besoin du stream dans la connexion)
                // c’est géré dans usePeerMedia.startCallStream → createVideoPeer
                break
            default:
                transport.setLocalDataPeer(callbacks)
        }
    }

    const syncUsersConnections = async (users) => {
       const newUsers = await connections.getNewUsersInRoom(users)
       newUsers.forEach(user => {
            core.getRemotePeerId(user)
       })
    }

    return {
        ...core,
        ...media,
        ...connections,
        ...transport,

        // API métier exposée aux features (useMediaBroadcast)
        // startCall,
        // handleRemotePeer,
        initializePeerConnection,
        syncUsersConnections,


        // currentStream: context.currentStream,
        // isConnecting: context.isConnecting,

         // expose state
        // session: context.session,
        // mediaState: context.media,
        // connectionState: context.connection,
        // uiState: context.ui,

        // computed
        // localPeerId: context.localPeerId,
        // connections: context.connections,
        currentMode: context.currentMode,
        currentRoom: context.currentRoom,
        onAirRoom: context.onAirRoom,
    }
}