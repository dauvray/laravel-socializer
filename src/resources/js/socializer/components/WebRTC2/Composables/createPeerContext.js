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

import { reactive, computed, onBeforeMount } from 'vue'
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
            const hub = session.hubSlug ? [session.hubSlug] : []
            const others = connection.usersInRoom.filter(slug => slug !== session.hubSlug)
            return [...connection.usersInRoom, meStore.getMe?.slug]
        }),

        topology: computed(() => session.topology),
        hubSlug: computed(() => session.hubSlug),
        isHub: computed(() => session.isHub),
        isHubConnected: computed(() => {
            return session.hubSlug && computedState.allUsersInRoom.value.includes(session.hubSlug)
        }),

        currentStream: computed(() => media.currentStream),

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
    const waitForMeReady = (timeoutMs = 15000) => {
        return new Promise((resolve) => {
             const startedAt = Date.now()

            const checkPeer = () => {
                if (meStore.getMe?.slug && (peerStore.localPeer?.id || peerStore.localPeer?._id)) {

                     // On initialise le contexte dès que l'identité locale est réellement prête.
                    session.isHub = (meStore.getMe.slug === session.hubSlug)
                    resolve(true)
                    return
                } 

                if (Date.now() - startedAt >= timeoutMs) {
                    console.warn('waitForMeReady a expiré après', timeoutMs, 'ms')
                    resolve(false)
                    return
                }
                
                setTimeout(checkPeer, 100)

                // else {
                //     setTimeout(checkPeer, 100)
                // }
            }
            checkPeer()
        })
    }  

    const setUpConnectionListeners = (conn) => {
        if (!conn || typeof conn.on !== 'function') {
            return
        }

        // Evite de binder plusieurs fois les mêmes handlers sur la même instance
        if (conn.__ctxListenersBound) {
            return
        }
        conn.__ctxListenersBound = true

        //------------------
        // core events
        //------------------
        conn.on("open", function () {
            console.trace("connection " + (conn.metadata?.type || "unknown") + " ouverte dans Context", conn.metadata)
        })

        conn.on("close", function () {
            // Idempotence: un close déjà traité ne doit pas retraiter le cleanup
            if (conn.__ctxCloseHandled) {
                return
            }
            conn.__ctxCloseHandled = true

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
        })

        //------------------
        // custom events
        //------------------
        if (connectionEvents && connectionEvents.onConnectionOpen.isActive) {
            conn.on("open", connectionEvents.onConnectionOpen.callback)
        }

        if (connectionEvents && connectionEvents.onDataReceived.isActive) {
            conn.on("data", connectionEvents.onDataReceived.callback)
        }

        if (connectionEvents && connectionEvents.onStreamReceived.isActive) {
            conn.on("stream", (stream) => connectionEvents.onStreamReceived.callback(stream, conn, conn.metadata))
        }

        if (connectionEvents && connectionEvents.onConnectionClose.isActive) {
            conn.on("close", () => {
                // Evite callback close métier en double
                if (conn.__ctxCustomCloseEmitted) {
                    return
                }
                conn.__ctxCustomCloseEmitted = true
                connectionEvents.onConnectionClose.callback(conn)
            })
        }

        if (connectionEvents && connectionEvents.onConnectionError.isActive) {
            conn.on("error", connectionEvents.onConnectionError.callback)
        }
    }

    const storeConnectionEventCallbacks = (callbacks) => {
        try {
            Object.keys(callbacks).forEach(callbackKey => {
                if(!connectionEvents[callbackKey].isActive) {
                    connectionEvents[callbackKey].callback = callbacks[callbackKey]
                    connectionEvents[callbackKey].isActive = true
                }
            })
        } catch(e) {
            console.log('Erreur lors de l\'initialisation des callbacks de connexion', e)
        }
    }

    const setCurrentCallUsers = (users = []) => {
        session.currentCallUsers = Array.isArray(users) ? users : []
        return session.currentCallUsers
    }

    const addCurrentCallUser = (userSlug, type = 'visio') => {
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
     * Lifecycle hook
     */
    onBeforeMount(() => {
        // On crée la "room de signalisation" dans le peerStore 
        // dès que le contexte est initialisé.
        peerStore.createSignalQueueRoom(contextId)
    })
        
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
    }
}