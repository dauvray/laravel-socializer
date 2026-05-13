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
        // currentCallRoomId: peerStore.getCurrenCallRoomId || null,
        isStreaming: false,
        isCapturing: false,
        topology: options.topology || 'mesh', // topologie de diffusion : 'mesh' (pair à pair), 'star' (étoile) ou 'sfu' (serveur de diffusion)
        hubSlug: options.hubSlug || null, // slug du hub de diffusion (si utilisé)
        isHub: null, // le peer est-il le hub de diffusion ? (si hubSlug fourni)
    })

    // MEDIA STATE
    const media = reactive({
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
        // currentCallRoomId: computed(() => peerStore.getCurrenCallRoomId),
        // isStreaming: computed(() => peerStore.getIsStreaming),
        // isCapturing: computed(() => peerStore.getIsCapturing),
    }

    // HELPERS (fonctions utilitaires, actions synchrones)

    // Attendre que le peer soit prêt (ex: meStore.getMe.slug disponible) avant de faire des actions dépendantes du peerId
    const waitForMeReady = (timeoutMs = 15000) => {
        return new Promise((resolve) => {
             const startedAt = Date.now()

            const checkPeer = () => {
                if (meStore.getMe?.slug && peerStore.localPeer?._id) {

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

        //------------------
        // core events
        //------------------
        conn.on("open", function () {
            console.trace(`connection ${conn.metadata?.type} ouverte dans Context`, conn.metadata)
        })

        conn.on("close", function () {
            console.log(`connection ${conn.metadata?.type} fermée dans Context`, conn.metadata)
            const room = conn.metadata?.room
            const type = conn.metadata?.type
            const slug = conn.metadata?.from
        
            // On ferme la connexion dans le peerStore
            peerStore.closePeerConnection(
                room,
                slug,
                type,
            )
            // clear rooms
            peerStore.clearConnectionsRoom(room, slug, type)
            // On ne supprime le remotePeerId que si le peer n'est plus censé être dans la room.
            // Ça évite de casser un peer encore valide lors d'une coupure transitoire.
            if (!connection.usersInRoom.includes(slug)) {
                peerStore.removeRemotePeerId(slug)
            }
        })

        //------------------
        // custom events
        //------------------
        // handle connection open
        if(connectionEvents && connectionEvents.onConnectionOpen.isActive) {
            conn.on("open", connectionEvents.onConnectionOpen.callback)
        }

        // Receive data
        if(connectionEvents && connectionEvents.onDataReceived.isActive) {
            conn.on("data", connectionEvents.onDataReceived.callback)
        }
        // Receive stream
        if(connectionEvents && connectionEvents.onStreamReceived.isActive) {
            conn.on("stream", (stream) => connectionEvents.onStreamReceived.callback(stream, conn, conn.metadata))
        }

        // Handle connection close
        if(connectionEvents && connectionEvents.onConnectionClose.isActive) {
            conn.on("close", connectionEvents.onConnectionClose.callback)
        }

        // Handle connection error
        if(connectionEvents && connectionEvents.onConnectionError.isActive) {
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
    }
}