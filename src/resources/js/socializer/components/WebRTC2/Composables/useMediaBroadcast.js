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

export function useMediaBroadcast(type = 'data', room = 'app', options = {}) {
    
    const {
        contextId, // id du contexte (type-room) 

        // session
        currentType, // type de broadcast (stream, screen, audio/video call)
        currentRoom, // room "logique" (peut différer de onAirRoom si on gère plusieurs rooms)
        onAirRoom, // room dans laquelle le peer est actif (peut différer de currentRoom si on gère plusieurs rooms)
        topology, // topologie de diffusion : 'mesh' (pair à pair), 'star' (étoile) ou 'sfu' (serveur de diffusion)
        hubSlug, // slug du hub de diffusion (si applicable)
        isHub, // le peer est-il le hub de diffusion ?
        isHubConnected, // le hub de diffusion est-il présent dans la room (utile pour les clients en topologie star)

        // connection
        usersInRoom, // liste des utilisateurs présents dans la room 

        // media
        currentStream, // flux média local (MediaStream) créé par getUserMedia ou getDisplayMedia

        // meStore
        mySlug,
        myName,

        // actions
        initializePeerConnection, // Initialisation de la connexion PeerJS
        cleanupPeerConnection, // Nettoyage des connexions et ressources associées
        syncUsersConnections, // Synchronisation des connexions lorsque de nouveaux utilisateurs rejoignent la room
        sendDataToPeer, // fonction pour envoyer des données via une connexion data

        startWebcamStream, // fonction pour démarrer un stream webcam
        stopWebcamStream, // fonction pour arrêter le stream webcam et les appels associés
    } = usePeerOrchestrator( type, room, options)


    /*---------------------
        * Logique métier
    ----------------------*/

    // Initialisation de la connexion et des ressources nécessaires pour le broadcast
    function initialize(callbacks) {
        initializePeerConnection(callbacks)
    }
    // Nettoyage des ressources
    function cleanup() {
        cleanupPeerConnection()
    }
    // watch users list to sync connections when new user join the room
    const watchUsers = (newVal) => {
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
    // Envoi de données via une connexion data à un ou plusieurs peers distants
    function sendData(data, destUserSlugs = null) {
        sendDataToPeer(data, destUserSlugs)
    }
    // Démarrage d’un stream webcam
    function getWebcamStream(isLocal = false) {
        startWebcamStream(isLocal)
    }
    function stopStream() {
        stopWebcamStream()
    }

    return {
        // system
        initialize,
        cleanup,
        watchUsers,

        // stream
        getWebcamStream,
        stopStream,

        // screen

        // data
        sendData,

        /*------------------------
        | CONTEXTE
        --------------------------*/
        // session
        currentType,
        currentRoom,
        onAirRoom,
        topology,
        hubSlug,
        isHub,
        isHubConnected,

        // connection
        usersInRoom,

        // media
        currentStream,

        // meStore
        mySlug,
        myName,
    }
}