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

/**
 * @param {string} type
 * @param {string} room
 * @param {Object} options
 * @param {Object} [deps]         Dépendances d'infrastructure, transmises telles quelles à
 *                                l'orchestrateur (`deps.reverb` : canal de présence)
 */
export function useMediaBroadcast(type = 'data', room = 'app', options = {}, deps = {}) {
    
    const {
        // machine d'état d'appel
        callState,       // état courant : 'idle' | 'calling' | 'receiving' | 'connected' | 'closing'
        callInprogress,  // computed : vrai dès que l'appel n'est plus à l'état IDLE
        inviteAbandonedSignal, // { userSlug, type } quand une invitation n'a jamais reçu de réponse — à consommer (remise à null)

        // session
        localPeerId, // id du peer local (null tant que le peer n'est pas prêt)
        currentType, // type de broadcast (stream, screen, audio/video call)
        currentRoom, // room "logique" (peut différer de onAirRoom si on gère plusieurs rooms)
        onAirRoom, // room dans laquelle le peer est actif (peut différer de currentRoom si on gère plusieurs rooms)
        currentCallRoomId, // roomId spécifique pour les appels audio/vidéo (différent de currentRoom qui est la room "logique")
        currentCallUsers, // liste des slugs des utilisateurs actuellement en appel avec moi (utile pour gérer les connexions et l'UI d'appel)
        topology, // topologie de diffusion : 'mesh' (pair à pair) ou 'star' (étoile). 'sfu' est RÉSERVÉ, non implémenté : le passer lève à la construction du contexte
        hubSlug, // slug du hub de diffusion — OBLIGATOIRE en 'star', son absence lève elle aussi
        isHub, // le peer est-il le hub de diffusion ?
        isHubConnected, // le hub de diffusion est-il présent dans la room.

        // connection
        remotePeers, // les pairs distants présents dans la room (mon slug en est exclu)
        presenceSynced, // la composition de la room a-t-elle été synchronisée au moins une fois ? (un remotePeers vide ne dit pas « personne », il dit « je ne sais pas encore »)

        // media
        currentStream, // flux média local (MediaStream) créé par getUserMedia
        screenStream, // flux de partage d'écran local (MediaStream) créé par getDisplayMedia
        isStreaming, // indique si un flux est actuellement diffusé
        isCapturing, // indique si on est en train de partager son écran
        isAudioStream, // indique si le flux local est un flux audio
        remoteStreams, // liste des flux médias distants reçus
        remoteScreens, // liste des flux de partage d'écran distants reçus
        announcedStreamPeers, // slugs des pairs dont un flux est annoncé mais pas encore reçu (UI d'attente)
        announceBroadcastState, // re-annonce explicite de mon état de diffusion aux pairs joignables

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
        sendDataToConnection, // fonction pour répondre SUR une connexion reçue (introuvable par slug)

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
    } = usePeerOrchestrator( type, room, options, deps)

   

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

    // Watcher de la liste de présence : chaque composition reçue est synchronisée, y
    // compris la LISTE VIDE. C'est le seul tour capable de purger le dernier partant — le
    // tenir dehors laissait son fantôme dans `remotePeers`, c'est-à-dire dans l'allowlist
    // que lisent les deux gardes d'autorisation, le ciblage de `forwardStarMessage` et les
    // destinataires par défaut de `sendData`.
    //
    // ⚠️ Le garde retiré ici ne l'est que parce que la distinction « synchroniser » /
    // « déclarer la présence connue » existe désormais plus bas. Le premier tour du
    // provider — `watch(() => props.users, api.watchUsers, { immediate: true })`, armé sur
    // une liste encore vide — traverse la chaîne, purge (rien) et n'apprend rien :
    // `getRoomUsersDiff` ne passe `presenceSynced` à true que sur un tour qui a OBSERVÉ
    // au moins un membre, et `_doSyncUsersConnections` n'ouvre rien sur un tour qui n'a
    // rien observé. Sans ces deux-là, la liste vide ferait passer la présence pour connue
    // et transformerait un refus d'admission en ignorance déguisée.
    //
    // `null`/`undefined` tombent jusqu'à `syncUsersConnections`, qui les rejette sur son
    // `Array.isArray` : la forme se valide à un seul endroit.
    const watchUsers = (newVal) => {
        try {
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
    // Envoi de données SUR une connexion précise — typiquement celle reçue en
    // `onConnectionOpen`, que `sendData` ne peut PAS retrouver : la résolution par slug ne
    // voit que les connexions sortantes. Le « pourquoi » entier est au transport.
    function sendDataOnConnection(conn, data) {
        sendDataToConnection(conn, data)
    }
    // Démarrage d’un stream webcam
    //
    // ⚠️ Le `return` des trois démarrages n'est pas cosmétique : les verbes amont sont
    // `async` et personne n'attrape le rejet de `getUserMedia`/`getDisplayMedia` sur toute
    // la chaîne (`usePeerMedia` les appelle nus). Sans lui, un refus de permission de
    // l'utilisateur devient un rejet non traité — pas de toast, pas de changement d'état,
    // un bouton qui semble mort. C'est ici, et seulement ici, que la promesse peut encore
    // revenir à l'appelant. Les trois arrêts sont synchrones en amont : rien à rendre.
    function getWebcamStream() {
        return startWebcamStream()
    }
    function stopStream() {
        stopWebcamStream()
    }
    // Démarrage d'un stream audio
    function getAudioStream() {
        return startAudioStream()
    }
    function stopAudio() {
        stopAudioStream()
     }
    // Démarrage partage ecran
    function startCapture() {
        return startScreenCapture()
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
        inviteAbandonedSignal,
        remoteStopCall,

        handleStreamReceived,
        handleStreamRemoved,

        stopCallInviteRetry,
        clearAllCallInviteRetries,

        // data
        sendData,
        sendDataOnConnection,

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
        remotePeers,
        presenceSynced,

        // media
        currentStream,
        screenStream,
        isStreaming,
        isCapturing,
        isAudioStream,
        remoteStreams,
        remoteScreens,
        announcedStreamPeers,
        announceBroadcastState,

        // ui
        isMuted,
        isVideoEnabled,
        streamStates,

        // meStore
        mySlug,
        myName,
    }
}