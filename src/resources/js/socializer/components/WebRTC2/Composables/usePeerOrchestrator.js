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
 * Fonctions concernées dans l'ancien code :
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
     * 🔥 Glue logique (SEUL endroit où on mixe les couches)
     */

    const initializePeerConnection = (callbacks) => {

        const type = context.currentType.value
        const room = context.currentRoom.value

        transport.setLocalPeer()

        // une boucle pour stocker les calbbacks dans createPeerContext et éviter les dépendances circulaires (core → transport → peerStore)
        Object.keys(callbacks).forEach(callbackKey => {
            if(!context.connectionEvents[callbackKey].isActive) {
                context.connectionEvents[callbackKey].callback = callbacks[callbackKey]
                context.connectionEvents[callbackKey].isActive = true
            }
        })



        // todo : on en est là
      //  connections.setLocalDataPeer(type)

        // switch(type) {
        //     case 'stream':
        //     case 'screen':
        //         transport.setLocalVideoPeer(callbacks)
        //         break
        //     case 'call':
        //         // pour les appels, on attend d’avoir le stream avant de créer le peer (car besoin du stream dans la connexion)
        //         // c’est géré dans usePeerMedia.startCallStream → createVideoPeer
        //         break
        //     default:
        //         transport.setLocalDataPeer(callbacks)
        // }
    }

    const cleanupPeerConnection = () => {

    }

    const syncUsersConnections = async (users) => {
       const newUsers = await connections.getNewUsersInRoom(users)
       newUsers.forEach(user => {
            core.requestRemotePeerConnection(user)
       })
    }

    const sendDataToPeer = (data, destUserSlugs = null) => {
        transport.sendData(data, destUserSlugs)
    }

    return {
        ...core,
        ...media,
        ...connections,
        ...transport,

        // API métier exposée aux features (useMediaBroadcast)
        initializePeerConnection,
        syncUsersConnections,
        sendDataToPeer,

        /*---------------------------------
        | COMPUTED
        ----------------------------------*/
        contextId: context.contextId,

        // session
        currentType: context.currentType,
        currentRoom: context.currentRoom,
        onAirRoom: context.onAirRoom,

        // connection
        usersInRoom: context.usersInRoom,

        // meStore
        mySlug: context.mySlug,
        myName: context.myName,
    }
}