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
    })

    // MEDIA STATE
    const media = reactive({
        // currentStream: null,
        // isStreaming: false,
        // isCapturing: false,
    })

    // UI STATE
    const ui = reactive({
        // videoStates: {
        //     isMuted: false,
        //     isVideoEnabled: true,
        // }
    })

    // CONNECTION STATE
    const connection = reactive({
        // isConnecting: false,
        usersInRoom: [],
    })

    // CONNECTION EVENTS
   const connectionEvents = reactive({
       onConnectionOpen: {
            callbacks: [],
            isActive: false,
        },
        onConnectionClose: {
            callbacks: [],
            isActive: false,
        },
        onConnectionError: {
            callbacks: [],
            isActive: false,
        },
        onDataReceived: {
            callbacks: [],
            isActive: false,
        },
        onStreamReceived: {
            callbacks: [],
            isActive: false,
        },
        onStreamClosed: {
            callbacks: [],
            isActive: false,
       },
    })


    // COMPUTED (read-only projections)
    const computedState = {
        currentType: computed(() => session.currentType),
        currentRoom: computed(() => session.currentRoom),
        onAirRoom: computed(() => session.onAirRoom),

        usersInRoom: computed(() => connection.usersInRoom),

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
    
    const storeEventCallback = (callbacks) => {
        Object.entries(callbacks).forEach(([event, callback]) => {
            if(connectionEvents[event]) {
                connectionEvents[event].callbacks.push(callback)
                connectionEvents[event].isActive = true
            } else {
                console.warn(`Event ${event} is not defined in connectionEvents`)
            }
        })
        console.log('storeEventCallback', connectionEvents)
    }

    return {
        contextId,
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
        connectionEvents,

        // computed
        ...computedState,

        // helpers
        waitForMeReady,
        storeEventCallback,
    }
}