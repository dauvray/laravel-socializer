/**
 * 🧱 createPeerContext (Context Factory)
 *
 * 👉 gère :
 * - création d’une instance isolée du système peer
 * - centralisation des dépendances (stores, services, eventBus)
 * - stockage des états partagés (session, media, connections, ui)
 *
 * 👉 garantit :
 * - aucune dépendance implicite (tout est injecté ici)
 * - isolation entre plusieurs instances (multi-room, multi-type)
 *
 * 👉 ne fait PAS :
 * - logique métier
 * - logique réseau
 * - manipulation directe des streams
 *
 * 👉 rôle :
 * - fournir une "source de vérité" unique à tous les composables techniques
 */

import { reactive, computed, ref, onBeforeMount, onUnmounted, watchEffect, effectScope } from 'vue'
import { useAjaxService } from '~estarter/services/AjaxService.js'
import { usePeer2Store } from '~socializer/stores/peers2.js'
import { useServerStore } from '~socializer/stores/server.js'
import { useMeStore } from '~estarter/stores/me.js'

export function createPeerContext({ type, room, eventBus, options }) {

    const contextId = `${type}-${room}`

    // STORES (infra)
    const peerStore = usePeer2Store()
    const meStore = useMeStore()
    const serverStore = useServerStore()
    const AjaxService = useAjaxService()

    // SESSION STATE (runtime)
    const session = reactive({
        currentType: type || 'data',
        currentRoom: room || 'app',
        onAirRoom: room || 'app',
        currentCallRoomId: null, // roomId spécifique pour les appels audio/vidéo (différent de currentRoom qui est la room "logique")
        currentCallUsers: [], // liste des slugs des utilisateurs actuellement en appel avec moi (utile pour gérer les connexions et l'UI d'appel)
        callInprogress: false, // y a-t-il un appel en cours avec au moins un utilisateur ?
        isStoppingCall: false, // état temporaire pour indiquer que je suis en train de stopper un appel (utile pour éviter les conflits de logique lors du nettoyage des connexions et des flux)
        closingUsers: new Set(), // Set des slugs des utilisateurs dont la connexion est en cours de fermeture (utile pour éviter les conflits de logique lors du nettoyage des connexions et des flux)
      
        // a mettre dans media
        isStreaming: false,
        isCapturing: false,
      
        topology: options.topology || 'mesh', // topologie de diffusion : 'mesh' (pair à pair), 'star' (étoile) ou 'sfu' (serveur de diffusion)
        hubSlug: options.hubSlug || null, // slug du hub de diffusion (si utilisé)
        isHub: null, // le peer est-il le hub de diffusion ? (si hubSlug fourni)
    })

    // MEDIA STATE
    const media = reactive({
        videoContainer: '#videoContainer',
        currentStream: null,
        remoteStreamsMap: new Map(), // Map pour stocker les flux distants avec une clé composite (userSlug-type) pour éviter les collisions
       
        // isStreaming: false,
        // isCapturing: false,
    })

    // UI STATE
    const ui = reactive({
        streamStates: {
            isMuted: false,
            isVideoEnabled: true,
        }
    })

    // CONNECTION STATE
    const connection = reactive({
        // isConnecting: false,
        usersInRoom: [],
    })

    // SIGNAUX DISPOS
    const SIGNAL_TYPES = {
        core: [
            'PEER_CONNECTION_REQUEST',
        ],
        connections: [
            'PEER_CONNECT_TO_REMOTE_PEER',
        ], 
    }

    // SIGNAUX reçus pour la room
    const roomSignals = computed(() =>
        peerStore.getQueueForRoom(contextId)
    )

    // dernier signal reçu pour la room
    const lastRoomSignal = computed(() => {
        const q = peerStore.getQueueForRoom(contextId)
        return q?.at(-1) ?? null
    })

    // CONNECTION EVENTS
   const connectionEvents = reactive({
       onConnectionOpen: {
            callback: () => {},
            isActive: false,
        },
        onConnectionClose: {
            callback: () => {},
            isActive: false,
        },
        onConnectionError: {
            callback: () => {},
            isActive: false,
        },
        onDataReceived: {
            callback: () => {},
            isActive: false,
        },
        onStreamReceived: {
            callback: () => {},
            isActive: false,
        }
   })

    // COMPUTED (read-only projections)
    const computedState = {
        currentType: computed(() => session.currentType),
        currentRoom: computed(() => session.currentRoom),
        onAirRoom: computed(() => session.onAirRoom),
        currentCallRoomId: computed(() => session.currentCallRoomId),
        currentCallUsers: computed(() => session.currentCallUsers),
        callInprogress: computed(() => session.callInprogress),
        usersInRoom: computed(() => connection.usersInRoom),
        allUsersInRoom: computed(() => {
            const others = connection.usersInRoom.filter(slug => slug !== session.hubSlug)
            const mySlug = meStore.getMe?.slug
            return mySlug ? [...others, mySlug] : [...others]
        }),

        topology: computed(() => session.topology),
        hubSlug: computed(() => session.hubSlug),
        isHub: computed(() => session.isHub),
        isHubConnected: computed(() => {
            return session.hubSlug && computedState.allUsersInRoom.value.includes(session.hubSlug)
        }),

        currentStream: computed(() => media.currentStream),
        remoteStreams: computed(() => Array.from(media.remoteStreamsMap.values())),

        mySlug: computed(() => meStore.getMe?.slug),
        myName: computed(() => meStore.getMe?.name),
        // localPeer: computed(() => peerStore.getLocalPeer),
        // localPeerId: computed(() => peerStore.getLocalPeerId),
        // connections: computed(() => peerStore.getConnections),
        // pendingRequests: computed(() => peerStore.getPendingRequests),
        // remoteStreams: computed(() => peerStore.getRemoteStreams),
        // callInProgress: computed(() => peerStore.getIsCallInProgress),
        // isStreaming: computed(() => peerStore.getIsStreaming),
        // isCapturing: computed(() => peerStore.getIsCapturing),
    }

    // HELPERS (fonctions utilitaires, actions synchrones)

    // Attendre que le peer soit prêt (ex: meStore.getMe.slug disponible) avant de faire des actions dépendantes du peerId
    // Utilise un watchEffect réactif (effectScope détaché) plutôt qu'un polling setTimeout.
    // Se résout dès que meStore.getMe.slug ET peerStore.lastLocalPeerId sont disponibles.
    const waitForMeReady = (timeoutMs = 15000) => {
        return new Promise((resolve) => {
            let resolved = false
            let timeoutId = null

            // Scope détaché : pas lié au cycle de vie d'un composant, nettoyé manuellement.
            // Permet d'appeler watchEffect hors contexte setup() sans warning Vue.
            const scope = effectScope(true)

            const _resolve = (value) => {
                if (resolved) return
                resolved = true
                clearTimeout(timeoutId)
                scope.stop()
                resolve(value)
            }

            scope.run(() => {
                watchEffect(() => {
                    const slug = meStore.getMe?.slug
                    // peerStore.lastLocalPeerId est réactif (Pinia) et mis à jour par l'événement
                    // 'open' de PeerJS — contrairement à localPeer.id qui est markRaw.
                    const peerId = peerStore.lastLocalPeerId
                    if (slug && peerId) {
                        // On initialise le contexte dès que l'identité locale est réellement prête.
                        session.isHub = (slug === session.hubSlug)
                        _resolve(true)
                    }
                })
            })

            // Timeout de sécurité — une seule alarme, pas de boucle de polling
            timeoutId = setTimeout(() => {
                console.warn('waitForMeReady a expiré après', timeoutMs, 'ms')
                _resolve(false)
            }, timeoutMs)
        })
    }

    // WeakSet interne pour suivre les connexions déjà bindées et éviter les doublon s de listeners (idempotence) 
    // sans polluer les objets tiers PeerJS avec des flags personnalisés.
    const _boundConnections = new WeakSet()

    const setUpConnectionListeners = (conn) => {
        if (!conn || typeof conn.on !== 'function') {
            return () => {}
        }

        // Evite de binder plusieurs fois les mêmes handlers sur la même instance
        if (_boundConnections.has(conn)) {
            return () => {}
        }
        _boundConnections.add(conn)

        // Variables de closure
        // collés sur l'objet tiers PeerJS
        let closeHandled = false
        let customCloseEmitted = false

        // Déclaré ici (let) pour être accessible dans handleClose avant l'assignation finale
        let cleanup = () => {}

        //------------------
        // core events — handlers nommés pour pouvoir les passer à conn.off()
        //------------------
        const handleOpen = () => {
            console.trace("connection " + (conn.metadata?.type || "unknown") + " ouverte dans Context", conn.metadata)
        }

        const handleClose = () => {
            // Idempotence: un close déjà traité ne doit pas retraiter le cleanup
            if (closeHandled) {
                return
            }
            closeHandled = true

            console.log("connection " + (conn.metadata?.type || "unknown") + " fermée dans Context", conn.metadata)

            const room = conn.metadata?.room
            const type = conn.metadata?.type
            const storedSlug = conn.metadata?.slug

            // Détection robuste du peer distant (évite de supprimer mon propre slug)
            const mySlug = meStore.getMe?.slug || null
            const fromSlug = conn.metadata?.from || null
            const slugMeta = conn.metadata?.slug || null

            let remoteSlug = null
            if (fromSlug && fromSlug !== mySlug) {
                remoteSlug = fromSlug
            } else if (slugMeta && slugMeta !== mySlug) {
                remoteSlug = slugMeta
            }

            // Retirer uniquement cette instance (ne pas fermer en cascade ici)
            peerStore.removePeerConnectionInstance(
                room,
                storedSlug,
                type,
                conn
            )

            // Supprime le remotePeerId seulement si l'utilisateur n'est plus en room
            if (remoteSlug && !connection.usersInRoom.includes(remoteSlug)) {
                peerStore.removeRemotePeerId(remoteSlug)
            }

            // Auto-cleanup : retire tous les listeners dès que la connexion est fermée
            // (cleanup est déjà assigné au moment où ce handler s'exécute car c'est async)
            cleanup()
        }

        //------------------
        // custom events — handlers nommés pour pouvoir les passer à conn.off()
        //------------------
        const handleCustomOpen = (connectionEvents?.onConnectionOpen?.isActive)
            ? connectionEvents.onConnectionOpen.callback
            : null

        const handleData = (connectionEvents?.onDataReceived?.isActive)
            ? connectionEvents.onDataReceived.callback
            : null

        // Wrapper nommé nécessaire pour capturer la référence et pouvoir faire conn.off()
        const handleStream = (connectionEvents?.onStreamReceived?.isActive)
            ? (stream) => connectionEvents.onStreamReceived.callback(stream, conn, conn.metadata)
            : null

        const handleCustomClose = (connectionEvents?.onConnectionClose?.isActive)
            ? () => {
                // Evite callback close metier en double
                if (customCloseEmitted) {
                    return
                }
                customCloseEmitted = true

                const closeCallback = connectionEvents?.onConnectionClose?.callback
                if (typeof closeCallback === "function") {
                    closeCallback(conn)
                }
            }
            : null

        const handleError = (connectionEvents?.onConnectionError?.isActive)
            ? connectionEvents.onConnectionError.callback
            : null

        //------------------
        // Enregistrement
        //------------------
        conn.on("open", handleOpen)
        conn.on("close", handleClose)

        if (handleCustomOpen) conn.on("open", handleCustomOpen)
        if (handleData)       conn.on("data", handleData)
        if (handleStream)     conn.on("stream", handleStream)
        if (handleCustomClose) conn.on("close", handleCustomClose)
        if (handleError)      conn.on("error", handleError)

        //------------------
        // Cleanup (retourné pour désinscription explicite anticipée)
        //------------------
        // Assignation du let déclaré en haut du scope (accessible dans handleClose)
        cleanup = () => {
            if (!_boundConnections.has(conn)) return
            _boundConnections.delete(conn)

            conn.off("open", handleOpen)
            conn.off("close", handleClose)

            if (handleCustomOpen)  conn.off("open", handleCustomOpen)
            if (handleData)        conn.off("data", handleData)
            if (handleStream)      conn.off("stream", handleStream)
            if (handleCustomClose) conn.off("close", handleCustomClose)
            if (handleError)       conn.off("error", handleError)
        }

        return cleanup
    }

    const storeConnectionEventCallbacks = (callbacks) => {
    try {
        if (!callbacks || typeof callbacks !== "object") {
            return
        }

        Object.keys(callbacks).forEach((callbackKey) => {
            const eventEntry = connectionEvents[callbackKey]
            const candidate = callbacks[callbackKey]

            // Ignore les cles inconnues et les callbacks non-fonction
            if (!eventEntry || typeof candidate !== "function") {
                return
            }

            if (!eventEntry.isActive) {
                eventEntry.callback = candidate
                eventEntry.isActive = true
            }
        })
    } catch (e) {
        console.log("Erreur lors de l'initialisation des callbacks de connexion", e)
    }
}

    const setCurrentCallUsers = (users = []) => {
        session.currentCallUsers = Array.isArray(users) ? users : []
        return session.currentCallUsers
    }

    const addCurrentCallUser = (userSlug = null, type = 'visio') => {
        if (!userSlug) {
            return session.currentCallUsers
        }

        const exists = session.currentCallUsers.some(
            (u) => u.userSlug === userSlug && u.type === type
        )

        if (!exists) {
            session.currentCallUsers = [...session.currentCallUsers, { userSlug, type }]
        }

        session.callInprogress = session.currentCallUsers.length > 0

        return session.currentCallUsers
    }

    const removeCurrentCallUser = (userSlug) => {
        if (!userSlug) {
            return session.currentCallUsers
        }

        session.currentCallUsers = session.currentCallUsers.filter((u) => u.userSlug !== userSlug)
        
        session.callInprogress = session.currentCallUsers.length > 0
        
        return session.currentCallUsers
    }

    const clearCurrentCallUsers = () => {
        session.currentCallUsers = []
        return session.currentCallUsers
    }

    /**
     * Lifecycle hooks
     */
    onBeforeMount(() => {
        // On crée la "room de signalisation" dans le peerStore 
        // dès que le contexte est initialisé.
        peerStore.createSignalQueueRoom(contextId)
    })

    // Nettoyage complet du contexte à la destruction du composant propriétaire
    const destroy = () => {
        // Supprime la signal queue room créée dans onBeforeMount
        peerStore.clearSignalQueueRoom(contextId)

        // Libère les références aux streams distants
        media.remoteStreamsMap.clear()
        media.currentStream = null

        // Réinitialise les états de session
        session.currentCallUsers = []
        session.closingUsers = new Set()
        session.callInprogress = false
        session.isStoppingCall = false
        session.isStreaming = false
        session.isCapturing = false

        // Réinitialise la liste des utilisateurs en room
        connection.usersInRoom = []
    }

    onUnmounted(() => {
        destroy()
    })

    // Signal réactif : communication inverse usePeerTransport → usePeerOrchestrator
    // usePeerTransport écrit le slug du peer indisponible ici ;
    // usePeerOrchestrator l'observe via watch() et déclenche la recovery.
    // Remplace l'ancienne mutation implicite de hooks.onPeerUnavailable.
    const peerUnavailableSignal = ref(null)
        
    return {
        contextId,
        roomSignals,
        lastRoomSignal,
        
        // infra
        peerStore,
        meStore,
        serverStore,
        AjaxService,
        eventBus,

        // state (grouped)
        session,
        media,
        ui,
        connection,
        SIGNAL_TYPES,
        connectionEvents,

        // computed
        ...computedState,

        // helpers
        waitForMeReady,
        setUpConnectionListeners,
        storeConnectionEventCallbacks,
        setCurrentCallUsers,
        addCurrentCallUser,
        removeCurrentCallUser,
        clearCurrentCallUsers,

        // signal réactif (usePeerTransport → usePeerOrchestrator)
        peerUnavailableSignal,

        // destruction explicite (cleanup manuel si nécessaire hors lifecycle)
        destroy,
    }
}