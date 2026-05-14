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
 */

import { inject } from 'vue'
import { createPeerContext } from '~socializer/components/WebRTC2/Composables/createPeerContext.js'
import { usePeerCore } from '~socializer/components/WebRTC2/Composables/usePeerCore.js'
import { usePeerMedia } from '~socializer/components/WebRTC2/Composables/usePeerMedia.js'
import { usePeerConnections } from '~socializer/components/WebRTC2/Composables/usePeerConnections.js'
import { usePeerTransport } from '~socializer/components/WebRTC2/Composables/usePeerTransport.js'
import { usePeerRetry } from '~socializer/components/WebRTC2/Composables/usePeerRetry.js'

export function usePeerOrchestrator( type = 'data', room = 'app', options = {}) {

    const eventBus = inject('eventBus')
    let syncUsersConnectionsLock = false

    // 1. Initialisation du Contexte et des Sous-Modules
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

    // 2. Initialisation du moteur de Retry
    const retryManager = usePeerRetry(context)

    /**
     * LOGIQUE DE TENTATIVE (Callback pour le RetryManager)
     * Détermine si on doit continuer à essayer de se connecter à un user.
     */
    const _handleConnectionAttempt = async (userSlug) => {
        // 1. Succès ultime : connexion établie
        if (connections.hasOpenConnection(userSlug)) return true

        const remotePeerId = context.peerStore.getRemotePeerId(userSlug)
        const waiting = context.peerStore.getWaitingRemotePeerId(userSlug)

        // 2. Sécurité : Si on n'a plus d'ID ET plus d'intention (waiting), l'user est vraiment parti.
        if (!remotePeerId && !waiting) return true

        // 3. Si on a un ID, on tente la connexion (même si waiting a sauté)
        if (remotePeerId) {
            const connected = connections.connectToPeer({
                userSlug,
                peerId: remotePeerId,
                type: context.currentType.value,
                room: context.currentRoom.value,
            })
            if (connected) return true
        }

        // 4. Signalisation stale : On ne demande l'ID que si on est toujours en attente (waiting)
        if (waiting) {
            // Si la demande est "stale" (périmée), on relance une demande via le serveur
            const STALE_MS = 12000
            const age = Date.now() - (waiting.createdAt ?? 0)
            if (age >= STALE_MS) {
                core.requestRemotePeerConnection(userSlug)
            }
        }

        return false // Échec de cette tentative -> le manager replanifiera
    }

    /**
     * Tente de se connecter à un peer distant ou de demander une connexion si nécessaire.
     *
     * @param {string} userSlug - L'identifiant de l'utilisateur pour lequel la connexion est tentée.
     * @returns {void}
     */
    const _requestOrConnectPeer = (userSlug) => {
        if (!userSlug) return
        if (connections.hasOpenConnection(userSlug)) return

        const remotePeerId = context.peerStore.getRemotePeerId(userSlug)
        const waiting = context.peerStore.getWaitingRemotePeerId(userSlug)
        
        if (remotePeerId) {
            connections.connectToPeer({
                userSlug,
                peerId: remotePeerId,
                type: context.currentType.value,
                room: context.currentRoom.value,
            })
        } else if (!waiting) {
            // On ne demande que si on n'est pas déjà en train d'attendre
            core.requestRemotePeerConnection(userSlug)
        }

        // On lance le moteur de retry (qui surveillera l'évolution vers 'open')
        retryManager.scheduleRetry(userSlug, 0, _handleConnectionAttempt)
    }

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

            wrappedCallbacks.onDataReceived = (data) => {
                const isRoutingEnvelope = data?.__starRoute === true
                const isHubUser = context.isHub.value === true

                // Le hub intercepte les enveloppes de routage et les retransmet.
                // Le check isHub se fait ici (et non à l'init) car isHub peut être
                // null au moment de l'initialisation (résolu après waitForMeReady).
                // Hub: route l'enveloppe puis affiche le message "métier" (payload)
                if (isRoutingEnvelope && isHubUser) {
                    transport.forwardStarMessage(data)

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

        // IMPORTANT: on stocke bien les callbacks wrappés dans le contexte, pas les originaux.
        context.storeConnectionEventCallbacks(wrappedCallbacks)
        transport.setLocalPeer()
    }

    const cleanupPeerConnection = () => {
        retryManager.clearAll()
        connections.closePeerConnection()

        // Important en mode multi-contexte:
        // le contexte est retiré du dispatcher global à l'unmount.
        transport.unregisterLocalContext() 
    }

    const syncUsersConnections = async (users) => {
    
        if (syncUsersConnectionsLock) {
            return
        }

        syncUsersConnectionsLock = true

        try {

            // on attend d’avoir les infos de contexte nécessaires (meStore ready) avant de faire quoi que ce soit.
            const ready = await context.waitForMeReady()
            if (!ready) {
                return
            }

            const { newUsers, removedUsers } = await connections.getRoomUsersDiff(users)

            // Nettoyage des peers qui ne sont plus dans la room.
            removedUsers.forEach(userSlug => {
                retryManager.clearRetry(userSlug)
                context.peerStore.removeWaitingRemotePeerId(userSlug)
                context.peerStore.removeRemotePeerId(userSlug)
                context.peerStore.clearConnectionsRoom(context.currentRoom.value, userSlug, context.currentType.value)
            })

            // Mesh: tout le monde se connecte à tout le monde.
            if (context.topology.value === 'mesh') {
                newUsers.forEach(user => {
                    _requestOrConnectPeer(user.slug)
                })
            }
            // Star: le hub se connecte à tout le monde, les clients seulement au hub.
            else if (context.topology.value === 'star' && context.hubSlug.value) {
                if (context.isHub.value) {
                    newUsers.forEach(user => {
                        _requestOrConnectPeer(user.slug)
                    })
                } else {
                    _requestOrConnectPeer(context.hubSlug.value)
                }
            }
            // SFU: pas de maillage pair à pair côté client.

        } finally {
            syncUsersConnectionsLock = false
        }
    }

    const sendDataToPeer = (data, destUserSlugs = null) => {
        transport.sendData(data, destUserSlugs)
    }

    const startWebcamStream = async (is_local = false) => {
       await media.startWebcamStream(is_local)
      context.usersInRoom.value.forEach(userSlug => {
        _requestOrConnectPeer(userSlug)
      })
    }

    const stopWebcamStream = () => {
        media.stopCurrentStream()
        connections.closePeerConnection()
    }

    const startCallWithPeer = async (payload) => {
        transport.setLocalPeer()
        const ready = await context.waitForMeReady()
        core.requestAuthorizationRemotePeerId(payload.userSlug, payload.type)
    }

    const acceptCallFromPeer = async (payload) => {
        transport.setLocalPeer()
        const ready = await context.waitForMeReady()
        core.sendAuthorizationRemotePeerId(payload)
    }

    const openCallBetweenPeer = async (payload) => {
        console.log('openCallBetweenPeer', payload)
        context.peerStore.removeWaitingRemotePeerId(payload.fromUserSlug)
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
        stopWebcamStream,
        startCallWithPeer,
        acceptCallFromPeer,
        openCallBetweenPeer,

        /*---------------------------------
        | COMPUTED
        ----------------------------------*/
        contextId: context.contextId,

        // session
        currentType: context.currentType,
        currentRoom: context.currentRoom,
        currentCallRoomId: context.currentCallRoomId,
        onAirRoom: context.onAirRoom,
        topology: context.topology,
        hubSlug: context.hubSlug,
        isHub: context.isHub,
        isHubConnected: context.isHubConnected,

        // connection
        usersInRoom: context.usersInRoom,

        // media
        currentStream: context.currentStream,

        // meStore
        mySlug: context.mySlug,
        myName: context.myName,
    }
}