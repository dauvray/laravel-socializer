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
        currentCallRoomId, // roomId spécifique pour les appels audio/vidéo (différent de currentRoom qui est la room "logique")
        currentCallUsers, // liste des slugs des utilisateurs actuellement en appel avec moi (utile pour gérer les connexions et l'UI d'appel)
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

        startCallWithPeer, // fonction pour initier un appel audio/vidéo avec un peer distant
        acceptCallFromPeer, // fonction pour accepter un appel audio/vidéo d'un peer distant
        openCallBetweenPeer, // fonction pour ouvrir un appel audio/vidéo entre deux peers distants
    
        stopCallWithPeers, // fonction pour arrêter un appel audio/vidéo avec un ou plusieurs peers distants    
        createVideoElement, // fonction pour créer dynamiquement un élément vidéo dans le DOM pour afficher un flux distant    
        removeVideoElement, // fonction pour supprimer un élément vidéo du DOM lorsque le flux distant se termine ou que l'appel est raccroché   
    
        setCurrentCallRoomId, // fonction pour définir le currentCallRoomId (roomId spécifique pour les appels audio/vidéo)
        ensureCurrentCallRoomId, // fonction pour s'assurer que le currentCallRoomId est défini avant d'initier ou d'accepter un appel audio/vidéo
   
        setCurrentCallUsers, // fonction pour définir la liste des utilisateurs actuellement en appel avec moi
        addCurrentCallUser, // fonction pour ajouter un utilisateur à la liste des utilisateurs actuellement en appel avec moi
        removeCurrentCallUser, // fonction pour supprimer un utilisateur de la liste des utilisateurs actuellement en appel avec moi
        clearCurrentCallUsers, // fonction pour vider la liste des utilisateurs actuellement en appel avec moi

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

        // call
        startCallWithPeer,
        acceptCallFromPeer,
        openCallBetweenPeer,
        stopCallWithPeers,
        createVideoElement,
        removeVideoElement,
        setCurrentCallRoomId,
        ensureCurrentCallRoomId,
        setCurrentCallUsers,
        addCurrentCallUser,
        removeCurrentCallUser,
        clearCurrentCallUsers,

        // data
        sendData,

        /*------------------------
        | CONTEXTE
        --------------------------*/
        // session
        currentType,
        currentRoom,
        currentCallRoomId,
        currentCallUsers,
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