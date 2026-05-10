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

export function usePeerOrchestrator( type = 'data', room = 'app', options = {}) {

    const eventBus = inject('eventBus')

    const context = createPeerContext({
        type,
        room,
        eventBus,
        options,
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

        // une boucle pour stocker les calbbacks dans createPeerContext et éviter les dépendances circulaires (core → transport → peerStore)
        try {
            Object.keys(callbacks).forEach(callbackKey => {
                if(!context.connectionEvents[callbackKey].isActive) {
                    context.connectionEvents[callbackKey].callback = callbacks[callbackKey]
                    context.connectionEvents[callbackKey].isActive = true
                }
            })
        } catch(e) {
            console.log('Erreur lors de l\'initialisation des callbacks de connexion', e)
        }

        transport.setLocalPeer()





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
        connections.closePeerConnection()
    }

    const syncUsersConnections = async (users) => {

       await context.waitForMeReady()

       const newUserConnections = await connections.getNewUsersInRoom(users)
       
        //ATENTION : la logique est validée pour une topologie mesh, 
        // mais doit être adaptée pour les autres topologies (star, sfu)
        // ne pas prendre cette logique comme une vérité universelle pour toutes les topologies, mais plutôt comme un exemple de ce qui peut être fait dans une topologie mesh.
       // - mesh : on se connecte à tous les nouveaux utilisateurs
       // - star : on se connecte uniquement au hub (si hubSlug fourni)
       // - sfu : la logique de connexion dépend de l’implémentation du serveur SFU (généralement, les clients se connectent au serveur SFU, pas entre eux)
        if(context.topology.value === 'mesh') {
            newUserConnections.forEach(user => {
                _requestOrConnectPeer(user.slug)  
            })
        } 
        else if (context.topology.value === 'star' && context.hubSlug.value) {
            // Si je suis hub: je me connecte à tous les nouveaux users.
            // Si je suis client: je me connecte uniquement au hub.
            if(context.isHub.value) {
                newUserConnections.forEach(user => {
                     _requestOrConnectPeer(user.slug) 
                })
            } else {
                const hubSlugName = context.hubSlug.value
                if(hubSlugName) {
                     _requestOrConnectPeer(hubSlugName)
                } else {
                    console.warn('Hub peer ID not found for hubSlug', context.hubSlug.value)
                }
            }
        }
        // pour une topologie SFU, la logique de connexion dépend de l’implémentation du serveur SFU et n’est généralement pas gérée côté client
    }

    const _requestOrConnectPeer = (userSlug) => {
        if (!context.peerStore.hasRemotePeerId(userSlug)) {
            core.requestRemotePeerConnection(userSlug)
        } else {
            connections.connectToPeer({
                userSlug: userSlug,
                peerId: context.peerStore.getRemotePeerId(userSlug),
                type: context.currentType.value,
                room: context.currentRoom.value,
            })
        } 
    }
    
    const sendDataToPeer = (data, destUserSlugs = null) => {
        transport.sendData(data, destUserSlugs)
    }

    const startWebcamStream = (is_local = false) => {
       media.startWebcamStream(is_local)
    }

    return {
        // on pourrait ne pas exposer tout ça
        ...core,
        ...media,
        ...connections,
        ...transport,
        //

        // API métier exposée aux features (useMediaBroadcast)
        initializePeerConnection,
        syncUsersConnections,
        sendDataToPeer,
        cleanupPeerConnection,
        startWebcamStream,

        /*---------------------------------
        | COMPUTED
        ----------------------------------*/
        contextId: context.contextId,

        // session
        currentType: context.currentType,
        currentRoom: context.currentRoom,
        onAirRoom: context.onAirRoom,
        topology: context.topology,
        hubSlug: context.hubSlug,
        isHub: context.isHub,

        // connection
        usersInRoom: context.usersInRoom,

        // media
        currentStream: context.currentStream,

        // meStore
        mySlug: context.mySlug,
        myName: context.myName,
    }
}