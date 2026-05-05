/**
 * 🎬 useMediaBroadcast (Feature Layer - métier)
 *
 * 👉 gère :
 * - logique fonctionnelle de broadcast (stream, screen, audio/video call)
 * - états UI métier (isMuted, isVideoEnabled, etc.)
 * - orchestration des actions utilisateur (start/stop/toggle)
 * - synchronisation des utilisateurs (join → connexions)
 *
 * 👉 utilise :
 * - usePeerOrchestrator (API technique)
 *
 * 👉 ne connaît PAS :
 * - détails internes de WebRTC / PeerJS
 * - structure du peerStore
 *
 * 👉 rôle :
 * - transformer des intentions utilisateur en actions techniques
 * - rester découplé de l’infrastructure
 */

import { usePeerOrchestrator } from '~socializer/components/WebRTC2/Composables/usePeerOrchestrator.js'

export function useMediaBroadcast(type = 'data', room = 'app') {
    
    const {
        // session
        currentType, // type de broadcast (stream, screen, audio/video call)
        currentRoom, // room "logique" (peut différer de onAirRoom si on gère plusieurs rooms)
        onAirRoom, // room dans laquelle le peer est actif (peut différer de currentRoom si on gère plusieurs rooms)

        // connection
        usersInRoom, // liste des utilisateurs présents dans la room 

        // meStore
        mySlug,
        myName,

        // actions
        initializePeerConnection, // Initialisation de la connexion PeerJS
        syncUsersConnections, // Synchronisation des connexions lorsque de nouveaux utilisateurs rejoignent la room
        answerToRemotePeerConnection, // Réponse à une demande de connexion d'un peer distant
        connectToQueuedConnection, // Connexion aux peer dont les identifiants ont été reçus mais pour lesquels la connexion n’a pas encore été établie
        sendDataToPeer, // fonction pour envoyer des données via une connexion data
    } = usePeerOrchestrator( type, room)

    /*---------------------
        * Logique métier
    ----------------------*/

    function initialize(callbacks) {
        initializePeerConnection(callbacks)
    }
    // watch users list to sync connections when new user join the room
    function watchUsers(newVal) {
        try {
            if(newVal && newVal.length === 0) {
                return
            }

            syncUsersConnections(newVal)

            // TODO : a faire si un broadcast est en cours (isStreaming || isCapturing) → syncJoingingUsers(newVal)
            // if (isStreaming.value || isCapturing.value) {
            //     syncJoingingUsers(newVal)
            // }
        } catch (e) {
            console.error(e)
        }
    }

    // Envoi des données du peer local à un peer distant pour initier une connexion 
    // (ex: en réponse à une demande de peerId)
    function sendLocalPeerData(fromSlug, type, room) {
        answerToRemotePeerConnection(fromSlug, type, room)
    }

    // Connexion à un peer distant dont l’identifiant a été reçu 
    function connectToPeer(payload) {
        connectToQueuedConnection(payload)
    }

    // Envoi de données via une connexion data à un ou plusieurs peers distants
    function sendData(data, destUserSlugs = null) {
        sendDataToPeer(data, destUserSlugs)
    }

    return {
        // system
        initialize,
        watchUsers,
        sendLocalPeerData,
        connectToPeer,
        // // stream


        // // screen

        // data
        sendData,


        /*------------------------
        | CONTEXTE
        --------------------------*/
        // session
        currentType,
        currentRoom,
        onAirRoom,

        // connection
        usersInRoom,

        // meStore
        mySlug,
        myName,
    }
}