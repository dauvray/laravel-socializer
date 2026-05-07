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

import { reactive, computed } from 'vue'
import { useAjaxService } from '~estarter/services/AjaxService.js'
import { usePeer2Store } from '~socializer/stores/peers2.js'
import { useServerStore } from '~socializer/stores/server.js'
import { useMeStore } from '~estarter/stores/me.js'

export function createPeerContext({ type, room, eventBus }) {

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
        },
        onStreamClosed: {
            callback: () => {},
            isActive: false,
       },
       onStreamStarted: {
            callback: () => {},
            isActive: false,
       },
       onStreamStopped: {
            callback: () => {},
            isActive: false,
       },
   })



    // COMPUTED (read-only projections)
    const computedState = {
        currentType: computed(() => session.currentType),
        currentRoom: computed(() => session.currentRoom),
        onAirRoom: computed(() => session.onAirRoom),

        usersInRoom: computed(() => connection.usersInRoom),

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
    const waitForMeReady = () => {
        return new Promise((resolve) => {
            const checkPeer = () => {
                if (meStore.getMe?.slug && peerStore.localPeer?._id) {
                    resolve('ready')
                } else {
                    setTimeout(checkPeer, 100)
                }
            }
            checkPeer()
        })
    }  
    


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
        
    }
}