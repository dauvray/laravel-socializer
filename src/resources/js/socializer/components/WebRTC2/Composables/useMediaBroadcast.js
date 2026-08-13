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

        // machine d'état d'appel
        callState,       // état courant : 'idle' | 'calling' | 'receiving' | 'connected' | 'closing'
        callInprogress,  // computed : vrai dès que l'appel n'est plus à l'état IDLE

        // session
        localPeerId, // id du peer local (null tant que le peer n'est pas prêt)
        currentType, // type de broadcast (stream, screen, audio/video call)
        currentRoom, // room "logique" (peut différer de onAirRoom si on gère plusieurs rooms)
        onAirRoom, // room dans laquelle le peer est actif (peut différer de currentRoom si on gère plusieurs rooms)
        currentCallRoomId, // roomId spécifique pour les appels audio/vidéo (différent de currentRoom qui est la room "logique")
        currentCallUsers, // liste des slugs des utilisateurs actuellement en appel avec moi (utile pour gérer les connexions et l'UI d'appel)
        topology, // topologie de diffusion : 'mesh' (pair à pair), 'star' (étoile) ou 'sfu' (serveur de diffusion)
        hubSlug, // slug du hub de diffusion
        isHub, // le peer est-il le hub de diffusion ?
        isHubConnected, // le hub de diffusion est-il présent dans la room.

        // connection
        usersInRoom, // liste des utilisateurs remote présents dans la room 
        allUsersInRoom, // liste de tous les utilisateurs présents dans la room (y compris le local)
        
        // media
        currentStream, // flux média local (MediaStream) créé par getUserMedia
        screenStream, // flux de partage d'écran local (MediaStream) créé par getDisplayMedia
        isStreaming, // indique si un flux est actuellement diffusé
        isCapturing, // indique si on est en train de partager son écran
        isAudioStream, // indique si le flux local est un flux audio
        remoteStreams, // liste des flux médias distants reçus
        remoteScreens, // liste des flux de partage d'écran distants reçus

        // ui
        isMuted, // état muet/non muet du flux local
        isVideoEnabled, // état vidéo activée/désactivée du flux local
        streamStates, // objet regroupant les états liés au flux local (isMuted, isVideoEnabled, etc.)

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
        toggleAudioState, // fonction pour basculer l'état audio (muet/non muet) du flux local
        toggleVideoState, // fonction pour basculer l'état vidéo (activée/désactivée) du flux local

        startAudioStream, // fonction pour démarrer un stream audio
        stopAudioStream, // fonction pour arrêter le stream audio et les appels associés

        startScreenCapture, // fonction pour démarrer le partage d'écran
        stopScreenCapture, // fonction pour arrêter le partage d'écran

        startCallWithPeer, // fonction pour initier un appel audio/vidéo avec un peer distant
        acceptCallFromPeer, // fonction pour accepter un appel audio/vidéo d'un peer distant
        openCallBetweenPeer, // fonction pour ouvrir un appel audio/vidéo entre deux peers distants
    
        stopCallWithPeers, // fonction pour arrêter un appel audio/vidéo avec un ou plusieurs peers distants    
        createVideoElement, // fonction pour créer dynamiquement un élément vidéo dans le DOM pour afficher un flux distant    
        removeVideoElement, // fonction pour supprimer un élément vidéo du DOM lorsque le flux distant se termine ou que l'appel est raccroché   
    
        setCurrentCallRoomId, // fonction pour définir le currentCallRoomId (roomId spécifique pour les appels audio/vidéo)
        ensureCurrentCallRoomId, // fonction pour s'assurer que le currentCallRoomId est défini avant d'initier ou d'accepter un appel audio/vidéo

        isCallInProgress, // fonction pour vérifier s'il y a un appel en cours avec au moins un utilisateur
        callStatus, // fonction pour obtenir l'état actuel de l'appel (idle, calling, receiving, connected, closing)


        remoteStopCall, // fonction pour gérer l'arrêt d'un appel initié à distance (ex: quand un peer distant raccroche)
   
        handleStreamReceived, // fonction pour gérer la réception d'un flux distant (ex: ajouter le flux à un player vidéo)
        handleStreamRemoved, // callback onConnectionClose : traduit la fermeture d'une connexion PeerJS en départ du pair distant (même séquence que remoteStopCall, qui part du signal serveur)
   
        stopCallInviteRetry, // fonction pour stopper les tentatives de retry d'invitation à un appel (ex: lorsqu'on reçoit une réponse à une invitation)
        clearAllCallInviteRetries, // fonction pour stopper toutes les tentatives de retry d'invitation à un appel (ex: lorsqu'on quitte la room ou que le composant est détruit)
    } = usePeerOrchestrator( type, room, options)

   

    /*---------------------
        * Logique métier
    ----------------------*/

    // pour éviter les invitations en double (ex: à cause de bugs ou de comportements utilisateurs imprévus), 
    // on garde une trace des invitations déjà vues récemment
    const seenInviteIds = new Set()

    const clearSeenInvites = () => seenInviteIds.clear()

    const isInviteDuplicate = (inviteId) => {
        if (!inviteId) return false
        if (seenInviteIds.has(inviteId)) return true
        seenInviteIds.add(inviteId)
        return false
    }

    // watch users list to sync connections when new user join the room
    const watchUsers = (newVal) => {
        try {
            if(newVal && newVal.length === 0) {
                return
            }

            syncUsersConnections(newVal)

        } catch (e) {
            console.error(e)
        }
    }

    // Initialisation de la connexion et des ressources nécessaires pour le broadcast
    function initialize(callbacks) {
        initializePeerConnection(callbacks)
    }
    // Nettoyage des ressources
    function cleanup() {
        cleanupPeerConnection()
    }
    // Envoi de données via une connexion data à un ou plusieurs peers distants
    function sendData(data, destUserSlugs = null) {
        sendDataToPeer(data, destUserSlugs)
    }
    // Démarrage d’un stream webcam
    function getWebcamStream() {
        startWebcamStream()
    }
    function stopStream() {
        stopWebcamStream()
    }
    // Démarrage d'un stream audio
    function getAudioStream() {
        startAudioStream()
    }
    function stopAudio() {
        stopAudioStream()
     }
    // Démarrage partage ecran
    function startCapture() {
        startScreenCapture()
    }
    function stopCapture() {
        stopScreenCapture()
    }
    function toggleAudioMute() {
        toggleAudioState()
    }
    function toggleVideoVisibility() {
        toggleVideoState()
    }

    return {
        // system
        initialize,
        cleanup,
        watchUsers,
        clearSeenInvites,
        isInviteDuplicate,

        // stream
        getWebcamStream,
        stopStream,
        getAudioStream,
        stopAudio,
        toggleAudioMute,
        toggleVideoVisibility,

        // screen
        startCapture,
        stopCapture,

        // call
        startCallWithPeer,
        acceptCallFromPeer,
        openCallBetweenPeer,
        stopCallWithPeers,
        createVideoElement,
        removeVideoElement,
        setCurrentCallRoomId,
        ensureCurrentCallRoomId,

        callStatus,
        isCallInProgress,


        callState,
        callInprogress,
        remoteStopCall,

        handleStreamReceived,
        handleStreamRemoved,

        stopCallInviteRetry,
        clearAllCallInviteRetries,

        // data
        sendData,

        /*------------------------
        | CONTEXTE
        --------------------------*/
        // session
        localPeerId,
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
        screenStream,
        isStreaming,
        isCapturing,
        isAudioStream,
        remoteStreams,
        remoteScreens,

        // ui
        isMuted,
        isVideoEnabled,
        streamStates,

        // meStore
        mySlug,
        myName,
    }
}