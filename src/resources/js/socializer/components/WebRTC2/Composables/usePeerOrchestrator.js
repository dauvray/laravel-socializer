/**
 * 🔧 usePeerOrchestrator (Technical Orchestrator)
 *
 *  point d’entrée unique + composition + DOM
 *
 * 👉 gère :
 * - point d’entrée unique pour tout le système peer
 * - composition des couches Core / Media / Connections / Transport / Pool / Call / Stream / Signaling
 * - exposition d’une API simple aux features (useMediaBroadcast)
 *
 * 👉 utilise :
 * - createPeerContext (instance isolée)
 * - usePeerCore / usePeerMedia / usePeerConnections / usePeerTransport (sous-modules)
 * - useConnectionPool → useCallManager → useStreamManager → useSignalingQueue (couches empilées)
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
import { useBroadcastPresence } from '~socializer/components/WebRTC2/Composables/useBroadcastPresence.js'
import { useSignalingQueue } from '~socializer/components/WebRTC2/Composables/useSignalingQueue.js'
import { isValidCallType } from '~socializer/components/WebRTC2/Composables/utils/validators.js'

/**
 * @param {string} type
 * @param {string} room
 * @param {Object} options
 * @param {Object} [deps]         Dépendances d'infrastructure fournies par l'appelant
 * @param {Object} [deps.reverb]  Canal de présence Reverb (useReverbPresence), optionnel
 */
export function usePeerOrchestrator( type = 'data', room = 'app', options = {}, deps = {}) {

    // ── Validation des inputs ────────────────────────────────────────────────
    const normalizedType = isValidCallType(type) ? type : 'data'
    const normalizedRoom = (typeof room === 'string' && room.trim().length > 0) ? room.trim() : 'app'
    // ─────────────────────────────────────────────────────────────────────────

    // ⚠️ Le canal Reverb arrive en PARAMÈTRE, jamais par un `inject` posé ici. Deux
    // raisons, et la seconde est décisive : c'est la règle de composition du module (une
    // couche reçoit ses dépendances, elle ne va pas les chercher), et `withSetup` — le
    // harnais de test — pose ses `provides` avec `Object.entries`, qui IGNORE les clés
    // Symbol. Un `inject(REVERB_CHANNEL)` enfoui ici serait invisible depuis
    // `createVirtualPeer`, donc intestable en scénario. L'unique `inject` vit dans
    // `MediaBroadcastProvider.vue`, qui est un composant.
    const { reverb = null } = deps

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

    // 5. Couche présence de diffusion : le fait « je diffuse », sur deux transports —
    //    `BROADCAST_STATE` sur le data channel, et un whisper sur le canal de présence.
    //    Ne dépend que du transport et du canal. Seule la couche signalisation ci-dessous
    //    consomme un de ses verbes (`noteBroadcastFromSignal`), et elle est instanciée
    //    APRÈS : aucun cycle possible. L'UI, elle, ne lit que la projection
    //    `announcedStreamPeers`.
    const presence = useBroadcastPresence(context, { transport, reverb })

    // 6. Couche signalisation : route les signaux serveur entrants vers les handlers.
    //    Instanciée en dernier — personne ne consomme ses verbes, donc elle peut router
    //    vers n'importe quelle couche sans jamais créer de callback ascendant.
    //    Cette table est l'unique source de vérité du routage des signaux.
    //
    //    Les deux signaux de peerId portent l'état de diffusion de leur émetteur : on le
    //    note AVANT de déléguer, puis on rend le retour du handler **inchangé** — le
    //    routage l'attend, et `true` / `false` y portent une décision de retry. Ce n'est
    //    pas une précondition ajoutée : `noteBroadcastFromSignal` ne peut ni échouer ni
    //    court-circuiter, donc l'invariant « le routage ne pose aucune précondition »
    //    tient. C'est ici et pas dans les handlers parce que c'est le seul étage autorisé
    //    à mixer les couches (usePeerCore ignore l'existence de la couche présence).
    const signaling = useSignalingQueue(context, {
        routes: {
            PEER_CONNECTION_REQUEST: (payload) => {
                presence.noteBroadcastFromSignal(payload)
                return core.responseRemotePeerConnection(payload)
            },
            PEER_CONNECT_TO_REMOTE_PEER: (payload) => {
                presence.noteBroadcastFromSignal(payload)
                return connections.connectToPeer(payload)
            },
        },
    })

   /**
     * 🔥 Glue logique (SEUL endroit où on mixe les couches)
     */

    const initializePeerConnection = (callbacks) => {
        // ── Interception du callback onDataReceived ──────────────────────────────
        //
        // Deux messages transitent sur le data channel sans être « métier » :
        //
        //   1. les enveloppes de routage star (`__starRoute: true`) : quand le hub en
        //      reçoit une, c'est une instruction de retransmission, pas un message.
        //      Le check isHub se fait ici (et non à l'init) car isHub peut être null au
        //      moment de l'initialisation (résolu après waitForMeReady).
        //   2. les annonces de diffusion (`BROADCAST_STATE`) : protocole d'infra
        //      (useBroadcastPresence). Consommées ici, elles ne remontent jamais à
        //      l'app — un pair ne peut donc pas les injecter dans un flux de chat.
        //
        // Le wrap est désormais TOUJOURS posé (même sans callback applicatif) : sans lui
        // `handleData` ne serait pas branché et les annonces seraient perdues.
        // ─────────────────────────────────────────────────────────────────────────
        const wrappedCallbacks = { ...callbacks }

        const originalOnDataReceived = typeof callbacks?.onDataReceived === 'function'
            ? callbacks.onDataReceived
            : null

        wrappedCallbacks.onDataReceived = (data, conn, metadata) => {
            const isRoutingEnvelope = data?.__starRoute === true
            const isHubUser = context.isHub.value === true

            // Hub: route l'enveloppe puis traite le message "métier" (payload)
            if (context.topology.value === 'star' && isRoutingEnvelope && isHubUser) {
                transport.forwardStarMessage(data, conn)

                if (data?.payload) {
                    // Le hub est aussi un récepteur : l'annonce d'un de ses clients le
                    // concerne. Au-delà de lui, l'identité d'origine est perdue par la
                    // retransmission (cf. limite documentée dans useBroadcastPresence).
                    if (presence.handleBroadcastStateMessage(data.payload, conn)) return

                    // On remonte au chat un objet normalisé pour éviter Invalid Date
                    originalOnDataReceived?.(data.payload)
                }
                return
            }

            if (presence.handleBroadcastStateMessage(data, conn)) return

            // Message normal → on appelle le callback fourni par useMediaBroadcast
            // (arité préservée : les apps lisent `conn.peer` pour scoper leurs signaux)
            originalOnDataReceived?.(data, conn, metadata)
        }

        // Wrap onConnectionOpen : une connexion data qui s'ouvre est le seul moment
        // fiable pour annoncer une diffusion en cours à un arrivant (avant, le canal
        // n'existe pas). Toujours posé, pour la même raison que ci-dessus.
        const originalOnConnectionOpen = typeof callbacks?.onConnectionOpen === 'function'
            ? callbacks.onConnectionOpen
            : null

        wrappedCallbacks.onConnectionOpen = (conn) => {
            presence.announceBroadcastStateTo(conn)
            originalOnConnectionOpen?.(conn)
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

        // En tête du teardown : un signal PEER_CONNECT_TO_REMOTE_PEER arrivant pendant
        // le cleanup rouvrirait une connexion juste après closePeerConnection().
        signaling.stopSignaling()

        pool.stopPool()  // Arrête l'observation du signal peer-unavailable + les retries en vol
        presence.stopBroadcastPresence()  // Plus d'annonce pendant/après le teardown

        // Mes demandes de peerId en vol meurent avec moi. Hors de closePeerConnection
        // ci-dessous, et ce n'est pas un doublon : celui-ci sort par un early-return
        // quand la room n'a aucune connexion — cas d'un provider démonté avant que la
        // signalisation ait abouti. Une demande orpheline serait relue comme la sienne
        // par le contexte remonté à ma place, qui resterait alors muet.
        context.peerStore.clearWaitingRemotePeerIdsForContext(context.contextId)

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

        // ⚠️ try/finally obligatoire : une exception ici laisserait shutdownCount à ≥ 1
        // pour la vie du contexte, ce qui désactive silencieusement le moteur de retry
        // (_handleConnectionAttempt sort par `return true`, donc ANNULE les retries).
        try {
            pool.clearAllRetries()
            connections.closePeerConnection({
                room: context.session.currentCallRoomId || context.session.currentRoom,
                type: context.session.currentType,
                // Symétrique de stopScreenCapture, qui garde délibérément la file « pour le
                // stream webcam actif » : arrêter la webcam pendant un partage d'écran ne
                // doit pas vider la file de signaux dont la connexion d'écran a encore
                // besoin (elle n'est ouverte que par le moteur de retry).
                clearSignalQueue: !context.media.isCapturing,
            })

            media.stopCurrentStream()
            media.removeVideoElement('local-webcam')
            context.session.currentCallRoomId = null
            context.ui.streamStates.isVideoEnabled = true
            context.ui.streamStates.isMuted = false
        } finally {
            context.endShutdown()
        }
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

        // annonce de diffusion (useBroadcastPresence) — l'émission automatique couvre
        // les cas normaux ; le verbe reste exposé pour une re-annonce explicite.
        announceBroadcastState: presence.announceBroadcastState,

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

        // Invitation restée sans réponse : signal écrit par usePeerCore, consommé par l'UI
        // (Notifications.vue), qui le remet à null. Aucune couche intermédiaire ne l'observe.
        inviteAbandonedSignal: context.inviteAbandonedSignal,

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
        presenceSynced: context.presenceSynced,

        // media
        currentStream: context.currentStream,
        screenStream: context.screenStream,
        isStreaming: context.isStreaming,
        isCapturing: context.isCapturing,
        isAudioStream: context.isAudioStream,
        remoteStreams: context.remoteStreams,
        remoteScreens: context.remoteScreens,
        announcedStreamPeers: context.announcedStreamPeers,

        // ui
        isMuted: context.isMuted,
        isVideoEnabled: context.isVideoEnabled,
        streamStates: context.streamStates,

        // meStore
        mySlug: context.mySlug,
        myName: context.myName,
    }
}
