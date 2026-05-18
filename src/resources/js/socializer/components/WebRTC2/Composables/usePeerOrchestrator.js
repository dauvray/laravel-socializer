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

import { inject, onUnmounted, ref, watch } from 'vue'
import { createPeerContext } from '~socializer/components/WebRTC2/Composables/createPeerContext.js'
import { usePeerCore } from '~socializer/components/WebRTC2/Composables/usePeerCore.js'
import { usePeerMedia } from '~socializer/components/WebRTC2/Composables/usePeerMedia.js'
import { usePeerConnections } from '~socializer/components/WebRTC2/Composables/usePeerConnections.js'
import { usePeerTransport } from '~socializer/components/WebRTC2/Composables/usePeerTransport.js'
import { usePeerRetry } from '~socializer/components/WebRTC2/Composables/utils/usePeerRetry.js'

export function usePeerOrchestrator( type = 'data', room = 'app', options = {}) {

    const eventBus = inject('eventBus')
    const syncUsersConnectionsLock = ref(false)
    const isShuttingDown = ref(false)  // 🔒 Guard pour bloquer les retries pendant le cleanup

    // ── Constantes ───────────────────────────────────────────────────────────
    const MAX_REMOTE_STREAMS = 12        // limite haute de streams distants simultanés (~13 pairs en mesh)
    const STREAM_STALE_MS    = 300_000   // 5 min — entrée sans activité considérée stale

    // ── Validation des inputs ────────────────────────────────────────────────
    const VALID_CALL_TYPES = ['data', 'visio', 'vocal', 'stream', 'screen', 'audio']
    const SLUG_PATTERN = /^[a-zA-Z0-9_\-.]{1,100}$/

    const _isValidSlug = (value) =>
        typeof value === 'string' && SLUG_PATTERN.test(value)

    const _isValidCallType = (value) =>
        typeof value === 'string' && VALID_CALL_TYPES.includes(value)

    const normalizedType = _isValidCallType(type) ? type : 'data'
    const normalizedRoom = (typeof room === 'string' && room.trim().length > 0) ? room.trim() : 'app'
    // ─────────────────────────────────────────────────────────────────────────

    // 1. Initialisation du Contexte et des Sous-Modules
    const context = createPeerContext({
        type: normalizedType,
        room: normalizedRoom,
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
        // 🛑 Ne relance RIEN si on est en train d'arrêter
        if (isShuttingDown.value) return true

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
                room: context.session.currentCallRoomId || context.currentRoom.value,
            })
            if (connected) return true
        }

        // 4. Signalisation stale : On ne demande l'ID que si on est toujours en attente (waiting)
        if (waiting) {
            const STALE_MS = 12000
            const age = Date.now() - (waiting.createdAt ?? 0)
            if (age >= STALE_MS) {
                core.requestRemotePeerConnection(userSlug)
            }
        }

        return false
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
                room: context.session.currentCallRoomId || context.currentRoom.value,
            })
        } else if (!waiting) {
            // On ne demande que si on n'est pas déjà en train d'attendre
            core.requestRemotePeerConnection(userSlug)
        }

        // On lance le moteur de retry (qui surveillera l'évolution vers 'open')
        retryManager.scheduleRetry(userSlug, 0, _handleConnectionAttempt)
    }

    // ── Recovery watch : peer-unavailable ──────────────────────────────────────
    // usePeerTransport écrit le slug du peer indisponible dans context.peerUnavailableSignal.
    // On observe ce signal ici (watch réactif) pour relancer le cycle de connexion.
    // Plus propre que la mutation implicite de hooks.onPeerUnavailable.
    // ─────────────────────────────────────────────────────────────────────────
    const unwatchPeerUnavailable = watch(context.peerUnavailableSignal, (userSlug) => {
        if (!userSlug) return
        if (isShuttingDown.value) return
        if (!_isValidSlug(userSlug)) return
        _requestOrConnectPeer(userSlug)
        // On remet le signal à null pour pouvoir détecter une prochaine émission
        // (watch ne se re-déclenche pas si la valeur ne change pas).
        context.peerUnavailableSignal.value = null
    })

    // Filet de sécurité : stoppe le watcher et les timers de retry si le composant
    // est détruit sans que cleanupPeerConnection() ait été appelé explicitement
    // (navigation abrupte, erreur, lazy-unmount, etc.).
    // ⚠️ NE PAS appeler cleanupPeerConnection() ici : createPeerContext.destroy()
    // s'exécute en premier (FIFO) et vide la session, ce qui rendrait
    // connections.closePeerConnection() inefficace.
    onUnmounted(() => {
        isShuttingDown.value = true   // 🛑 Bloque tout retry post-unmount
        unwatchPeerUnavailable()      // Arrête l'observation du signal peer-unavailable
        retryManager.clearAll()       // Libère tous les timers de retry en vol
    })

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
        isShuttingDown.value = true  // 🛑 Guard permanent : reste actif après le teardown terminal
        
        unwatchPeerUnavailable()  // Arrête l'observation du signal peer-unavailable
        retryManager.clearAll()
        connections.closePeerConnection({
            room: context.session.currentCallRoomId || context.session.currentRoom,
            type: context.session.currentType,
            clearSignalQueue: true,
        })

        transport.unregisterLocalContext()
    }    

    const syncUsersConnections = async (users) => {
        if (!Array.isArray(users)) return
    
        if (syncUsersConnectionsLock.value) {
            return
        }

        syncUsersConnectionsLock.value = true

        try {

            // on attend d’avoir les infos de contexte nécessaires (meStore ready) avant de faire quoi que ce soit.
            const ready = await context.waitForMeReady()
            if (!ready) {
                return
            }

            const { newUsers, removedUsers } = await connections.getRoomUsersDiff(users)

            // Nettoyage des peers qui ne sont plus dans la room.
            removedUsers.forEach(userSlug => {
                const activeRoom = context.session.currentCallRoomId || context.currentRoom.value
                retryManager.clearRetry(userSlug)
                context.peerStore.removeWaitingRemotePeerId(userSlug)
                context.peerStore.removeRemotePeerId(userSlug)
                context.peerStore.clearConnectionsRoom(activeRoom, userSlug, context.currentType.value)
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
            syncUsersConnectionsLock.value = false
        }
    }

    const sendDataToPeer = (data, destUserSlugs = null) => {
        transport.sendData(data, destUserSlugs)
    }

    const startWebcamStream = async (is_local = false) => {
        await media.startCurrentStream(is_local)
        context.usersInRoom.value.forEach(userSlug => {
        _requestOrConnectPeer(userSlug)
      })
    }

    const stopWebcamStream = () => {
        isShuttingDown.value = true
        
        retryManager.clearAll()
        connections.closePeerConnection({
            room: context.session.currentCallRoomId || context.session.currentRoom,
            type: context.session.currentType,
            clearSignalQueue: true,
        })

        media.stopCurrentStream()
        media.removeVideoElement('local-webcam')
        context.session.currentCallRoomId = null
        
        isShuttingDown.value = false
    }

    /*---------------------
    | CALLS
    ------------------------*/

    const startCallWithPeer = (payload) => {
        if (!payload || typeof payload !== 'object') return
        if (!_isValidSlug(payload.toUserSlug)) return

        const ready = transport.setLocalPeer()
        if (!ready) return

        const toUserSlug = payload.toUserSlug
        const type = _isValidCallType(payload.type) ? payload.type : 'visio'

        ensureCurrentCallRoomId()
        addCurrentCallUser(toUserSlug, type)
        setCallInProgress(true)
        context.session.currentType = type

        core.requestAuthorizationRemotePeerId({ toUserSlug, type })
        return
    }

    const acceptCallFromPeer = async (payload) => {
        if (!payload || typeof payload !== 'object') return

        const ready = transport.setLocalPeer()
        if (!ready) return

        if(payload?.status) {
            const fromUserSlug = payload?.fromUserSlug
            if (!_isValidSlug(fromUserSlug)) return

            const room = payload?.options?.room || null
            const type = _isValidCallType(payload?.options?.type) ? payload.options.type : 'visio'

            ensureCurrentCallRoomId(room)
            addCurrentCallUser(fromUserSlug, type)
            setCallInProgress(true)
            context.session.currentType = type
            context.session.currentCallRoomId = room

            await media.startCurrentStream(true)
            media.createVideoElement({ 
                videoId: 'local-webcam',
                type: type, 
                source: 'local'
            }, 
            context.media.currentStream
            )
        }

        // ✅ Ajouter l'inviteId dans les options retournées
        const options = payload?.options || {}
        if (payload?.options?.inviteId) {
            options.inviteId = payload.options.inviteId
        }

        core.sendAuthorizationRemotePeerId({ ...payload, 
            options,  // ← assure que inviteId est inclus 
        })
        return
    }

    const openCallBetweenPeer = async (payload) => {
        if (!payload || typeof payload !== 'object') return

        // Arrête le retry pour ce userSlug (fiable peu importe le retour de inviteId)
        if (payload?.fromUserSlug && _isValidSlug(payload.fromUserSlug)) {
            core.stopCallInviteRetryForUser(payload.fromUserSlug)
        }
        
        if(!payload?.status) {
            removeCurrentCallUser(payload.fromUserSlug)
            if(context.session.currentCallUsers.length === 0) {
                await stopCallWithPeers([], false, {
                    mode: 'full',
                })
                resetCallState()
            }
            return
        }

        const fromUserSlug = payload?.fromUserSlug
        if (!_isValidSlug(fromUserSlug)) return

        const room = payload?.options?.room || null
        const type = _isValidCallType(payload?.options?.type) ? payload.options.type : 'visio'

        ensureCurrentCallRoomId(room)
        addCurrentCallUser(fromUserSlug, type)
        setCallInProgress(true)
        
        context.peerStore.removeWaitingRemotePeerId(payload.fromUserSlug)
        context.peerStore.addRemotePeerId(payload.fromUserSlug, payload.options.peerId)
        await media.startCurrentStream(true)
        media.createVideoElement({ 
                videoId: 'local-webcam',
                type: payload.options.type, 
                source: 'local'
            }, 
            context.media.currentStream
        )
        context.session.currentType = payload.options.type
        context.session.currentCallRoomId = payload.options.room
        _requestOrConnectPeer(payload.fromUserSlug)
    }

    const createVideoElement = media.createVideoElement // exposé pour être utilisé par useMediaBroadcast (diffusion) pour créer les éléments vidéo des flux distants (et local)    

    const removeVideoElement = media.removeVideoElement // exposé pour être utilisé par useMediaBroadcast pour supprimer les éléments vidéo des flux distants (et local) quand un stream se termine ou qu’un appel est raccroché.

    const stopCallWithPeers = async (users = [], notifyRemote = true, options = {}) => {
       
       if (context.session.isStoppingCall) return
       context.session.isStoppingCall = true

        const roomId = options?.roomId || context.session.currentCallRoomId || context.currentRoom.value
       
        isShuttingDown.value = true  // 🛑 Bloquer les retries immédiatement

        const mode = options?.mode || 'full'
        const callType = context.session.currentType || 'visio'

        const normalizedUsers = (users || [])
            .map((u) => ({ userSlug: u?.userSlug || u?.slug, type: u?.type || callType }))
            .filter((u) => !!u.userSlug)

        if (notifyRemote) {
            normalizedUsers.forEach((u) => {
                core.notifyCloseConnectionToPeer({
                    toUserSlug: u.userSlug,
                    type: u.type || callType,
                    room: roomId,
                })
            })
        }

        if (mode === 'partial') {
            normalizedUsers.forEach((u) => {
                retryManager.clearRetry(u.userSlug)
                context.peerStore.removeWaitingRemotePeerId(u.userSlug)
            })

            connections.closePeerConnection({
                room: roomId,
                type: callType,
                users: normalizedUsers.map((u) => u.userSlug),
                clearSignalQueue: false,
            })

            isShuttingDown.value = false  // ✅ Réactiver les retries après partial close
            context.session.isStoppingCall = false
            return
        }

        // === MODE FULL ===
        retryManager.clearAll()

        connections.closePeerConnection({
            room: roomId,
            type: callType,
            clearSignalQueue: true,
        })

        media.stopCurrentStream()
        media.removeVideoElement('local-webcam')
        context.session.currentCallRoomId = null
        
        isShuttingDown.value = false  // ✅ Réactiver après cleanup complet

        resetCallState()
    }

    const setCurrentCallRoomId = (roomId = null) => {
        context.session.currentCallRoomId = roomId || null
        return context.session.currentCallRoomId
    }

    /**
     * Retourne un ID de room valide pour les appels, en utilisant l'ID préféré si fourni, 
     * ou en générant un nouvel ID si nécessaire.
     * @param {*} preferred 
     * @returns 
     */
    const ensureCurrentCallRoomId = (preferred = null) => {
        if (preferred) {
            context.session.currentCallRoomId = preferred
            return context.session.currentCallRoomId
        }

        if (!context.session.currentCallRoomId) {
            context.session.currentCallRoomId = Math.random().toString(36).substring(2, 10)
        }

        return context.session.currentCallRoomId
    }

    const setCurrentCallUsers = (users = []) => {
        return context.setCurrentCallUsers(users)
    }

    const addCurrentCallUser = (userSlug, type = 'visio') => {
        return context.addCurrentCallUser(userSlug, type)
    }

    const removeCurrentCallUser = (userSlug) => {
        if (!userSlug) return
        return context.removeCurrentCallUser(userSlug)
    }

    const clearCurrentCallUsers = () => {
        return context.clearCurrentCallUsers()
    }

    const setCallInProgress = (inProgress) => {
        context.session.callInprogress = inProgress
        return context.session.callInprogress
    }

    const isCallInProgress = () => {
        return context.session.callInprogress
    }

    const remoteStopCall = async (payload) => {
        if (!payload || typeof payload !== 'object') return

        const remoteSlug = payload?.fromUserSlug || null
        const remoteType = _isValidCallType(payload?.type) ? payload.type : 'visio'
        const roomId = payload?.room || context.session.currentCallRoomId || context.currentRoom.value

        if (!remoteSlug || !_isValidSlug(remoteSlug)) return
        if (context.session.closingUsers.has(remoteSlug)) return

        context.session.closingUsers.add(remoteSlug)

        await stopCallWithPeers([{ userSlug: remoteSlug, type: remoteType }], false, {
            mode: 'partial',
            roomId,
        })

        removeCurrentCallUser(remoteSlug)
        media.removeVideoElement(`remote-${remoteSlug}-${remoteType}`)
        context.media.remoteStreamsMap.forEach((value, key) => {
            if (value?.metadata?.from === remoteSlug) {
                context.media.remoteStreamsMap.delete(key)
            }
        })

        if (context.session.currentCallUsers.length === 0) {
            await stopCallWithPeers([], false, {
                mode: 'full',
                roomId,
            })
            resetCallState()
        }

        context.session.closingUsers.delete(remoteSlug)

        eventBus.$emit('close-call', [{
            userSlug: remoteSlug,
            type: remoteType,
        }])
    }

    const resetCallState = () => {
        media.cleanupCallPlayers()
        setCallInProgress(false)
        clearCurrentCallUsers()
        setCurrentCallRoomId(null)
        context.media.remoteStreamsMap.clear()
        context.session.isStoppingCall = false
        context.session.closingUsers.clear()
    }

    /*------------------------
    | SIGNALISATION CALLS
    --------------------------*/

    /**
     * Supprime les entrées stales (trop anciennes ou map trop grande) de remoteStreamsMap.
     * Appelé avant chaque ajout pour garantir une taille bornée.
     */
    const _cleanupStaleRemoteStreams = () => {
        const now = Date.now()

        // 1. Supprimer les entrées expirées (TTL)
        for (const [key, entry] of context.media.remoteStreamsMap.entries()) {
            if (now - (entry.createdAt ?? 0) > STREAM_STALE_MS) {
                media.removeVideoElement(`remote-${entry.remoteSlug}-${entry.remoteType}`)
                context.media.remoteStreamsMap.delete(key)
            }
        }

        // 2. Si encore trop grand, supprimer les plus anciens (FIFO)
        if (context.media.remoteStreamsMap.size >= MAX_REMOTE_STREAMS) {
            const overflow = context.media.remoteStreamsMap.size - MAX_REMOTE_STREAMS + 1
            let count = 0
            for (const [key, entry] of context.media.remoteStreamsMap.entries()) {
                if (count >= overflow) break
                media.removeVideoElement(`remote-${entry.remoteSlug}-${entry.remoteType}`)
                context.media.remoteStreamsMap.delete(key)
                count++
            }
        }
    }

    const handleStreamReceived = async (stream, conn, metadata) => {
        const ready = await context.waitForMeReady()
        if (!ready) return 
        
        const meta = metadata || conn?.metadata || {}
        const remoteSlug = resolveRemoteSlug(meta)
        const remoteType = meta?.type || conn?.metadata?.type || 'visio'

        if (!remoteSlug) return

        const streamKey = conn?.connectionId || `${remoteSlug}-${remoteType}`
    
        if (context.media.remoteStreamsMap.has(streamKey)) {
            return
        }

        // Nettoyage préventif avant ajout (taille bornée + TTL)
        _cleanupStaleRemoteStreams()

        context.media.remoteStreamsMap.set(streamKey, {
            stream,
            metadata: meta,
            remoteSlug,
            remoteType,
            createdAt: Date.now(),
        })

        if (stream instanceof MediaStream) {
            media.createVideoElement(
                {
                    videoId: `remote-${remoteSlug}-${remoteType}`,
                    type: remoteType,
                    source: 'remote',
                },
                stream
            )
        }
    }

    const handleStreamRemoved = async (conn, metadata) => {
        const ready = await context.waitForMeReady()
        if (!ready) return 
        
        const meta = conn?.metadata || {}
        const remoteSlug = resolveRemoteSlug(meta)
        const remoteType = meta?.type || 'visio'
        const roomId = meta?.room || context.session.currentCallRoomId || null

        if (!remoteSlug) return
        if (context.session.closingUsers.has(remoteSlug)) return

        context.session.closingUsers.add(remoteSlug)

        try {
            const videoId = `remote-${remoteSlug}-${remoteType}`
            media.removeVideoElement(videoId)

            const streamKey = conn?.connectionId || `${remoteSlug}-${remoteType}`
            context.media.remoteStreamsMap.delete(streamKey)

            context.media.remoteStreamsMap.forEach((value, key) => {
                if (
                    (value?.remoteSlug === remoteSlug && value?.remoteType === remoteType) ||
                    value?.metadata?.from === remoteSlug
                ) {
                    context.media.remoteStreamsMap.delete(key)
                }
            })

            removeCurrentCallUser(remoteSlug)

            eventBus.$emit('close-call', [{ 
                userSlug: remoteSlug, 
                type: remoteType 
            }])

            if (context.session.currentCallUsers.length === 0) {
                await stopCallWithPeers([], false, {
                    mode: 'full',
                    roomId,
                })
                resetCallState()
            }

        } catch (error) {
            console.error('Error removing video element:', error)
        } finally {
            context.session.closingUsers.delete(remoteSlug)
        }
    }

    const resolveRemoteSlug = (metadata = {}) => {
         if (!metadata) return null

        const mySlug = context.meStore.getMe?.slug || null
        if (!mySlug) return null   

        if (metadata.from && metadata.from !== mySlug) {
            return metadata.from
        }

        if (metadata.slug && metadata.slug !== mySlug) {
            return metadata.slug
        }

        return null
    }

    const stopCallInviteRetry = (inviteId) => {
        if (!inviteId) return
        core.stopCallInviteRetry(inviteId)
    }

    const clearAllCallInviteRetries = () => {
        core.clearAllCallInviteRetries()
    }

    /*---------------------
    | API exposée aux features (useMediaBroadcast)
    ----------------------*/
    return {
        initializePeerConnection,
        syncUsersConnections,
        sendDataToPeer,
        cleanupPeerConnection,
        startWebcamStream,
        stopWebcamStream,
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
        setCallInProgress,
        isCallInProgress,  
        remoteStopCall,

        handleStreamReceived,
        handleStreamRemoved,

        stopCallInviteRetry,
        clearAllCallInviteRetries,
     

        /*---------------------------------
        | ÉTAT INTERNE (observable / debug)
        ----------------------------------*/
        isShuttingDown,
        syncUsersConnectionsLock,

        /*---------------------------------
        | COMPUTED
        ----------------------------------*/
        contextId: context.contextId,

        // session
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

        // media
        currentStream: context.currentStream,

        // meStore
        mySlug: context.mySlug,
        myName: context.myName,
    }
}