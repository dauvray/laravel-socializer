/**
 * 🔧 usePeerOrchestrator (Technical Orchestrator)
 *
 *  point d’entrée unique + composition + DOM
 *
 * 👉 gère :
 * - point d’entrée unique pour tout le système peer
 * - composition des couches Core / Media / Connections / Transport / Pool / Call / Stream
 * - exposition d’une API simple aux features (useMediaBroadcast)
 *
 * 👉 utilise :
 * - createPeerContext (instance isolée)
 * - usePeerCore / usePeerMedia / usePeerConnections / usePeerTransport (sous-modules)
 * - useConnectionPool → useCallManager → useStreamManager (couches empilées)
 *
 * 👉 ne connaît PAS :
 * - UI métier (aucun état type isMuted, isVideoCall…)
 * - composants Vue
 *
 * 👉 rôle :
 * - façade technique unifiée
 * - composition : la seule logique qui reste ici est le wrapping des callbacks de
 *   connexion (routage star, chaînage des handlers de flux) et les passthroughs média
 *
 * ⚠️ ORDRE DES COUCHES (cf. CONVENTIONS.md) : une couche ne reçoit jamais de
 * callback vers une couche supérieure. L'orchestrateur injecte donc le pool dans le
 * CallManager et le CallManager dans le StreamManager, jamais l'inverse.
 */

import { createPeerContext } from '~socializer/components/WebRTC2/Composables/createPeerContext.js'
import { usePeerCore } from '~socializer/components/WebRTC2/Composables/usePeerCore.js'
import { usePeerMedia } from '~socializer/components/WebRTC2/Composables/usePeerMedia.js'
import { usePeerConnections } from '~socializer/components/WebRTC2/Composables/usePeerConnections.js'
import { usePeerTransport } from '~socializer/components/WebRTC2/Composables/usePeerTransport.js'
import { useConnectionPool } from '~socializer/components/WebRTC2/Composables/useConnectionPool.js'
import { useCallManager } from '~socializer/components/WebRTC2/Composables/useCallManager.js'
import { useStreamManager } from '~socializer/components/WebRTC2/Composables/useStreamManager.js'
import { isValidCallType } from '~socializer/components/WebRTC2/Composables/utils/validators.js'

export function usePeerOrchestrator( type = 'data', room = 'app', options = {}) {

    // ── Validation des inputs ────────────────────────────────────────────────
    const normalizedType = isValidCallType(type) ? type : 'data'
    const normalizedRoom = (typeof room === 'string' && room.trim().length > 0) ? room.trim() : 'app'
    // ─────────────────────────────────────────────────────────────────────────

    // 1. Initialisation du Contexte et des Sous-Modules
    const context = createPeerContext({
        type: normalizedType,
        room: normalizedRoom,
        options,
    })
    const core = usePeerCore(context)
    const media = usePeerMedia(context)
    const connections = usePeerConnections(context)
    const transport = usePeerTransport(context)

    // 2. Couche connexions : retry, établissement, synchronisation de la room
    const pool = useConnectionPool(context, { core, connections })

    // 3. Couche appels : elle dépend du pool, jamais l'inverse
    const callManager = useCallManager(context, { core, media, connections, transport, pool })

    // 4. Couche streams : elle dépend de la couche appels, jamais l'inverse
    const streamManager = useStreamManager(context, { media, callManager })

   /**
     * 🔥 Glue logique (SEUL endroit où on mixe les couches)
     */

    const initializePeerConnection = (callbacks) => {
        // ── En topologie star, on intercepte le callback onDataReceived ──────────
        //
        // Pourquoi ? Quand le hub reçoit un message d'un client avec __starRoute: true,
        // ce n'est PAS un message "métier" → c'est une instruction de routage.
        // Le hub doit retransmettre le payload aux vrais destinataires, sans remonter
        // le message brut à la couche feature (useMediaBroadcast).
        //
        // On wrappe donc le callback onDataReceived AVANT de le stocker dans le contexte.
        // ─────────────────────────────────────────────────────────────────────────
        const wrappedCallbacks = { ...callbacks }

        if (context.topology.value === 'star' && typeof callbacks.onDataReceived === 'function') {
            const originalOnDataReceived = callbacks.onDataReceived

            wrappedCallbacks.onDataReceived = (data, conn) => {
                const isRoutingEnvelope = data?.__starRoute === true
                const isHubUser = context.isHub.value === true

                // Le hub intercepte les enveloppes de routage et les retransmet.
                // Le check isHub se fait ici (et non à l'init) car isHub peut être
                // null au moment de l'initialisation (résolu après waitForMeReady).
                // Hub: route l'enveloppe puis affiche le message "métier" (payload)
                if (isRoutingEnvelope && isHubUser) {
                    transport.forwardStarMessage(data, conn)

                    // On remonte au chat un objet normalisé pour éviter Invalid Date
                    if (data?.payload) {
                        originalOnDataReceived(data.payload)
                    }
                    return
                }

                // Message normal → on appelle le callback fourni par useMediaBroadcast
                originalOnDataReceived(data)
            }
        }

        // Wrap onStreamReceived : chaîne le tracking interne (remoteStreamsMap) avant le callback utilisateur.
        // Sans ce wrap, handleStreamReceived n'est jamais appelé et remoteStreams reste vide.
        const originalOnStreamReceived = callbacks?.onStreamReceived ?? null
        wrappedCallbacks.onStreamReceived = async (stream, conn, metadata) => {
            await streamManager.handleStreamReceived(stream, conn, metadata)
            if (typeof originalOnStreamReceived === 'function') {
                originalOnStreamReceived(stream, conn, metadata)
            }
        }

        // Wrap onConnectionClose pour le mode stream : chaîne le cleanup interne (remoteStreamsMap)
        // avant le callback utilisateur. Limité au type 'stream' pour éviter les effets de bord
        // sur les connexions data (stopCallWithPeers, removeCurrentCallUser, etc.).
        if (type === 'stream') {
            const originalOnConnectionClose = callbacks?.onConnectionClose ?? null
            wrappedCallbacks.onConnectionClose = async (conn) => {
                const mySlug = context.meStore.getMe?.slug
                const senderSlug = conn?.metadata?.from

                // Ne déclencher le cleanup que si le remote était l'émetteur (connexion entrante).
                // Si senderSlug === mySlug, c'est notre propre conn sortante qui se ferme :
                // le remote peut encore streamer via PC-2 (connexion inverse) — ne pas le retirer.
                if (!mySlug || !senderSlug || senderSlug !== mySlug) {
                    await streamManager.handleStreamRemoved(conn)
                }


                if (typeof originalOnConnectionClose === 'function') {
                    originalOnConnectionClose(conn)
                }
            }
        }

        // IMPORTANT: on stocke bien les callbacks wrappés dans le contexte, pas les originaux.
        context.storeConnectionEventCallbacks(wrappedCallbacks)
        transport.setLocalPeer()
    }

    const cleanupPeerConnection = () => {
        context.beginShutdown()  // 🛑 Guard permanent : reste actif après le teardown terminal

        pool.stopPool()  // Arrête l'observation du signal peer-unavailable + les retries en vol

        connections.closePeerConnection({
            room: context.session.currentCallRoomId || context.session.currentRoom,
            type: context.session.currentType,
            clearSignalQueue: true,
        })

        // Teardown terminal : le pool de players garde ses instances montées entre
        // deux flux, c'est ici (et seulement ici) qu'on les démonte pour de bon.
        media.destroyPlayers()

        transport.unregisterLocalContext()
    }

    const sendDataToPeer = (data, destUserSlugs = null) => {
        transport.sendData(data, destUserSlugs)
    }

    const startWebcamStream = async () => {
        await media.startCurrentStream()
        context.usersInRoom.value.forEach(userSlug => {
            pool.requestOrConnectPeer(userSlug)
        })
    }

    const stopWebcamStream = () => {
        context.beginShutdown()

        pool.clearAllRetries()
        connections.closePeerConnection({
            room: context.session.currentCallRoomId || context.session.currentRoom,
            type: context.session.currentType,
            clearSignalQueue: true,
        })

        media.stopCurrentStream()
        media.removeVideoElement('local-webcam')
        context.session.currentCallRoomId = null
        context.ui.streamStates.isVideoEnabled = true
        context.ui.streamStates.isMuted = false

        context.endShutdown()
    }

    const startAudioStream = async () => {
        await media.startAudioStream()
        context.usersInRoom.value.forEach(userSlug => {
            pool.requestOrConnectPeer(userSlug)
        })
    }

    const stopAudioStream = () => {
        stopWebcamStream()
    }

    const startScreenCapture = async () => {
        await media.startScreenCapture()

        // Détecter l'arrêt natif du navigateur ("Stop sharing") :
        // On écoute 'ended' sur la piste vidéo pour déclencher le même nettoyage qu'un arrêt manuel.
        const screenStream = context.media.screenStream
        if (screenStream instanceof MediaStream) {
            const videoTracks = screenStream.getVideoTracks()
            if (videoTracks.length > 0) {
                videoTracks[0].addEventListener('ended', () => {
                    // Guard : si stopScreenCapture a déjà été appelé (via bouton UI),
                    // isCapturing est déjà false → on n'entre pas en boucle.
                    if (context.media.isCapturing) {
                        stopScreenCapture()
                    }
                }, { once: true })
            }
        }

        context.usersInRoom.value.forEach(userSlug => {
            pool.requestOrConnectPeer(userSlug, 'screen')
        })
    }

    const stopScreenCapture = () => {
        media.stopScreenCapture()
        connections.closePeerConnection({
            room: context.session.currentCallRoomId || context.currentRoom.value,
            type: 'screen',          // ← hardcodé, jamais context.currentType.value
            clearSignalQueue: false, // garder la queue pour le stream webcam actif
        })
    }

    const toggleAudioState = () => {
        // 1. Bascule le flag dans le contexte
        context.ui.streamStates.isMuted = !context.ui.streamStates.isMuted

        // 2. Applique l'état sur les tracks audio du stream courant (sans couper/recapturer)
        const stream = context.media.currentStream
        if (stream instanceof MediaStream) {
            stream.getAudioTracks().forEach(track => {
                track.enabled = !context.ui.streamStates.isMuted
            })
        }
    }

    const toggleVideoState = () => {
        // 1. Bascule le flag dans le contexte (devient false si true, et inversement)
        context.ui.streamStates.isVideoEnabled = !context.ui.streamStates.isVideoEnabled

        // 2. Applique l'état sur les tracks vidéo du stream courant
        const stream = context.media.currentStream
        if (stream instanceof MediaStream) {
            stream.getVideoTracks().forEach(track => {
                // Si isVideoEnabled est true, track.enabled sera true (l'image s'affiche)
                // Si isVideoEnabled est false, track.enabled sera false (écran noir)
                track.enabled = context.ui.streamStates.isVideoEnabled
            })
        }
    }

    const createVideoElement = media.createVideoElement // exposé pour être utilisé par useMediaBroadcast (diffusion) pour créer les éléments vidéo des flux distants (et local)

    const removeVideoElement = media.removeVideoElement // exposé pour être utilisé par useMediaBroadcast pour supprimer les éléments vidéo des flux distants (et local) quand un stream se termine ou qu’un appel est raccroché.

    /*---------------------
    | API exposée aux features (useMediaBroadcast)
    | Façade explicite : pas de ...spread des composables internes.
    ----------------------*/
    return {
        initializePeerConnection,
        cleanupPeerConnection,
        sendDataToPeer,

        // connexions (useConnectionPool)
        syncUsersConnections: pool.syncUsersConnections,

        // streams locaux
        startWebcamStream,
        stopWebcamStream,
        startAudioStream,
        stopAudioStream,
        startScreenCapture,
        stopScreenCapture,
        toggleAudioState,
        toggleVideoState,
        createVideoElement,
        removeVideoElement,

        // appels (useCallManager)
        startCallWithPeer: callManager.startCallWithPeer,
        acceptCallFromPeer: callManager.acceptCallFromPeer,
        openCallBetweenPeer: callManager.openCallBetweenPeer,
        stopCallWithPeers: callManager.stopCallWithPeers,
        remoteStopCall: callManager.remoteStopCall,
        setCurrentCallRoomId: callManager.setCurrentCallRoomId,
        ensureCurrentCallRoomId: callManager.ensureCurrentCallRoomId,
        isCallInProgress: callManager.isCallInProgress,
        callStatus: callManager.callStatus,
        stopCallInviteRetry: callManager.stopCallInviteRetry,
        clearAllCallInviteRetries: callManager.clearAllCallInviteRetries,

        // streams distants (useStreamManager)
        handleStreamReceived: streamManager.handleStreamReceived,
        handleStreamRemoved: streamManager.handleStreamRemoved,

        /*---------------------------------
        | ÉTAT INTERNE (observable / debug)
        ----------------------------------*/
        isShuttingDown: context.isShuttingDown,
        syncUsersConnectionsLock: pool.syncUsersConnectionsLock,

        /*---------------------------------
        | COMPUTED
        ----------------------------------*/
        contextId: context.contextId,

        // machine d'état d'appel (projections readonly du contexte — la FSM elle-même
        // n'est manipulée que par useCallManager)
        callState: context.callStatus,
        callInprogress: context.callInprogress,

        // session
        localPeerId: context.localPeerId,
        currentType: context.currentType,
        currentRoom: context.currentRoom,
        currentCallRoomId: context.currentCallRoomId,
        currentCallUsers: context.currentCallUsers,
        onAirRoom: context.onAirRoom,
        topology: context.topology,
        hubSlug: context.hubSlug,
        isHub: context.isHub,
        isHubConnected: context.isHubConnected,

        // connection
        usersInRoom: context.usersInRoom,
        allUsersInRoom: context.allUsersInRoom,

        // media
        currentStream: context.currentStream,
        screenStream: context.screenStream,
        isStreaming: context.isStreaming,
        isCapturing: context.isCapturing,
        isAudioStream: context.isAudioStream,
        remoteStreams: context.remoteStreams,
        remoteScreens: context.remoteScreens,

        // ui
        isMuted: context.isMuted,
        isVideoEnabled: context.isVideoEnabled,
        streamStates: context.streamStates,

        // meStore
        mySlug: context.mySlug,
        myName: context.myName,
    }
}
