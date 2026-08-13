/**
 * createMockContext.js — Factory de contexte minimal pour les tests
 *
 * Reproduit l'interface complète retournée par createPeerContext()
 * sans aucune dépendance réelle (stores Pinia, AjaxService, PeerJS, DOM).
 *
 * Toutes les fonctions des stores sont des vi.fn() pour permettre
 * l'assertion et la simulation de comportements.
 *
 * Usage :
 *   const ctx = createMockContext()
 *   const ctx = createMockContext({
 *       meStore: { getMe: { slug: 'alice', name: 'Alice' } },
 *       session: { currentType: 'visio' },
 *   })
 *
 * @param {Object} overrides  Overrides partiels appliqués après la création
 * @returns {Object}          Contexte complet compatible avec les composables WebRTC2
 */
import { reactive, computed, ref } from 'vue'
import { vi } from 'vitest'
import { createCallStateMachine } from '~socializer/components/WebRTC2/Composables/utils/useCallStateMachine.js'
import { mockEventBus } from './mockEventBus.js'

export function createMockContext(overrides = {}) {
    const contextId = overrides.contextId ?? 'test-data-app'

    // ── Machine d'état d'appel ────────────────────────────────────────────────
    const callMachine = createCallStateMachine(contextId)

    // ── EventBus ─────────────────────────────────────────────────────────────
    const eventBus = overrides.eventBus ?? mockEventBus()

    // ── Session state ─────────────────────────────────────────────────────────
    const session = reactive({
        currentType: 'data',
        currentRoom: 'app',
        onAirRoom: 'app',
        currentCallRoomId: null,
        currentCallUsers: [],
        topology: 'mesh',
        hubSlug: null,
        isHub: null,
        ...(overrides.session ?? {}),
    })

    // ── Media state ───────────────────────────────────────────────────────────
    const media = reactive({
        videoContainer: '#videoContainer',
        currentStream: null,
        screenStream: null,
        remoteStreamsMap: new Map(),
        isStreaming: false,
        isCapturing: false,
        isAudioStream: false,
        ...(overrides.media ?? {}),
    })

    // ── UI state ──────────────────────────────────────────────────────────────
    const ui = reactive({
        streamStates: {
            isMuted: false,
            isVideoEnabled: true,
        },
        ...(overrides.ui ?? {}),
    })

    // ── Connection state ──────────────────────────────────────────────────────
    const connection = reactive({
        usersInRoom: [],
        ...(overrides.connection ?? {}),
    })

    // ── Lifecycle state (garde de teardown partagé) ───────────────────────────
    // Compteur ré-entrant, comme createPeerContext : `endShutdown` ne relâche le
    // garde que quand tous les arrêts en cours sont terminés.
    const lifecycle = reactive({
        shutdownCount: 0,
        ...(overrides.lifecycle ?? {}),
    })

    const beginShutdown = vi.fn(() => { lifecycle.shutdownCount += 1 })
    const endShutdown   = vi.fn(() => { lifecycle.shutdownCount = Math.max(0, lifecycle.shutdownCount - 1) })

    // ── Connection events ─────────────────────────────────────────────────────
    const connectionEvents = reactive({
        onConnectionOpen:  { callback: vi.fn(), isActive: false },
        onConnectionClose: { callback: vi.fn(), isActive: false },
        onConnectionError: { callback: vi.fn(), isActive: false },
        onDataReceived:    { callback: vi.fn(), isActive: false },
        onStreamReceived:  { callback: vi.fn(), isActive: false },
    })

    // ── Signals ───────────────────────────────────────────────────────────────
    // Le routage vit dans useSignalingQueue, qui n'observe que `lastRoomSignal` :
    // pas de SIGNAL_TYPES ni de file complète exposés (cf. createPeerContext).
    const _signalQueue = ref([])
    const lastRoomSignal = computed(() => _signalQueue.value.at(-1) ?? null)

    // ── peerStore mock ────────────────────────────────────────────────────────
    const _connections = {}
    const _players = []
    // ⚠️ De vraies Map, comme dans peers2/state.js : la recovery `peer-unavailable`
    // de usePeerTransport fait une recherche inverse en itérant
    // `peerStore.remotePeersId.entries()` — un objet nu la rendrait inerte.
    const _remotePeerIds = new Map()
    const _waitingRemotePeerIds = new Map()
    const _signalQueueRooms = {}

    const peerStore = {
        lastLocalPeerId: overrides.peerStore?.lastLocalPeerId ?? null,
        getLocalPeerId: overrides.peerStore?.getLocalPeerId ?? 'local-peer-id-mock',
        getLocalPeer: overrides.peerStore?.getLocalPeer ?? null,
        // ⚠️ Objet nu, PAS un computed : les getters Pinia sont auto-déballés, et le code
        // sous test lit `ctx.peerStore.getConnections?.[room]` sans `.value`. Enveloppé
        // dans un computed, tout accès retournait undefined → `hasOpenConnection`
        // systématiquement false (faux négatif silencieux).
        getConnections: _connections,
        getPlayers: _players,

        // Exposées telles quelles : la recovery du transport les parcourt directement.
        remotePeersId: _remotePeerIds,
        waitingRemotePeerId: _waitingRemotePeerIds,

        getRemotePeerId: vi.fn((slug) => _remotePeerIds.get(slug) ?? null),
        hasRemotePeerId: vi.fn((slug) => _remotePeerIds.has(slug)),
        addRemotePeerId: vi.fn((slug, peerId) => { _remotePeerIds.set(slug, peerId) }),
        // Fidèle au store réel : le mapping n'est supprimé que si le pair n'apparaît
        // plus dans AUCUNE room de `connections` (cf. peers2/actions.js:217).
        removeRemotePeerId: vi.fn((slug) => {
            const stillConnected = Object.values(_connections).some((room) => slug in room)
            if (!stillConnected) _remotePeerIds.delete(slug)
        }),
        // Invalidation inconditionnelle : le peerId est mort, pas « peut-être encore
        // utile ailleurs ». Purge aussi le waiting pour ne pas étrangler la re-demande.
        invalidateRemotePeerId: vi.fn((slug) => {
            _remotePeerIds.delete(slug)
            _waitingRemotePeerIds.delete(slug)
        }),

        getWaitingRemotePeerId: vi.fn((slug) => _waitingRemotePeerIds.get(slug) ?? null),
        hasWaitingRemotePeerId: vi.fn((slug) => _waitingRemotePeerIds.has(slug)),
        addWaitingRemotePeerId: vi.fn((slug, data) => {
            _waitingRemotePeerIds.set(slug, { ...data, createdAt: Date.now() })
        }),
        removeWaitingRemotePeerId: vi.fn((slug) => { _waitingRemotePeerIds.delete(slug) }),

        getQueueForRoom: vi.fn((room) => _signalQueueRooms[room] ?? []),
        createSignalQueueRoom: vi.fn((room) => { _signalQueueRooms[room] = [] }),
        clearSignalQueueRoom: vi.fn((room) => { delete _signalQueueRooms[room] }),

        // Prépare la structure imbriquée room → slug → type → [] à partir du `config`
        // produit par _buildPeerConnectionConfig (cf. peers2/actions.js:15).
        prepareRoomConnection: vi.fn((payload) => {
            const { room, slug, type } = payload?.options?.metadata ?? {}
            if (!_connections[room]) _connections[room] = {}
            if (!_connections[room][slug]) _connections[room][slug] = {}
            if (!_connections[room][slug][type]) _connections[room][slug][type] = []
        }),
        storePeerConnection: vi.fn((room, slug, type, conn) => {
            _connections[room][slug][type].push(conn)
        }),
        // Ferme les instances sans les retirer du store — le retrait est le rôle de
        // clearConnectionsRoom / removePeerConnectionInstance (cf. peers2/actions.js:80).
        closePeerConnection: vi.fn((room, slug, type) => {
            const list = _connections[room]?.[slug]?.[type]
            if (!Array.isArray(list)) return
            list.forEach((conn) => {
                if (!conn || typeof conn !== 'object') return
                if (conn.__ctxClosing === true || conn.__ctxCloseHandled === true) return
                if (!Object.hasOwn(conn, 'peer')) return
                if (type === 'data' && conn.open !== true) return
                conn.__ctxClosing = true
                conn.close?.()
                if (type !== 'data' && conn.peerConnection?.signalingState !== 'closed') {
                    conn.peerConnection?.close?.()
                }
            })
        }),

        addPeerConnectionInstance: vi.fn((room, slug, type, conn) => {
            if (!_connections[room]) _connections[room] = {}
            if (!_connections[room][slug]) _connections[room][slug] = {}
            if (!_connections[room][slug][type]) _connections[room][slug][type] = []
            _connections[room][slug][type].push(conn)
        }),
        removePeerConnectionInstance: vi.fn((room, slug, type, conn) => {
            const list = _connections[room]?.[slug]?.[type]
            if (!list) return
            const idx = list.indexOf(conn)
            if (idx !== -1) list.splice(idx, 1)
            if (list.length === 0) peerStore.clearConnectionsRoom(room, slug, type)
        }),
        // Fidèle au store réel : supprime la clé et remonte la purge sur les parents
        // devenus vides (cf. peers2/actions.js:154) — un slug sans type disparaît de la
        // room, ce dont dépend removeRemotePeerId.
        clearConnectionsRoom: vi.fn((room, slug, type) => {
            if (!_connections[room]?.[slug]) return
            delete _connections[room][slug][type]
            if (Object.keys(_connections[room][slug]).length === 0) delete _connections[room][slug]
            if (Object.keys(_connections[room]).length === 0) delete _connections[room]
        }),

        setLocalPeer: vi.fn(),
        setLocalPeerId: vi.fn(),
        addPlayer: vi.fn((player) => { _players.push(player) }),
        removePlayer: vi.fn((videoId) => {
            const idx = _players.findIndex((p) => p.videoId === videoId)
            if (idx !== -1) _players.splice(idx, 1)
        }),

        // Permet d'injecter des données dans le signalQueue pour simuler un signal entrant
        _pushSignal: (signal) => { _signalQueue.value = [..._signalQueue.value, signal] },
        _clearSignals: () => { _signalQueue.value = [] },

        ...(overrides.peerStore ?? {}),
    }

    // ── meStore mock ──────────────────────────────────────────────────────────
    const meStore = {
        getMe: overrides.meStore?.getMe ?? { slug: 'test-user', name: 'Test User' },
        ...(overrides.meStore ?? {}),
    }

    // ── serverStore mock ──────────────────────────────────────────────────────
    const serverStore = {
        getServer: overrides.serverStore?.getServer ?? null,
        ...(overrides.serverStore ?? {}),
    }

    // ── AjaxService mock ──────────────────────────────────────────────────────
    const AjaxService = {
        load: vi.fn().mockResolvedValue({ data: {} }),
        ...(overrides.AjaxService ?? {}),
    }

    // ── Computed (projections read-only) ──────────────────────────────────────
    const currentType        = computed(() => session.currentType)
    const currentRoom        = computed(() => session.currentRoom)
    const onAirRoom          = computed(() => session.onAirRoom)
    const currentCallRoomId  = computed(() => session.currentCallRoomId)
    const currentCallUsers   = computed(() => session.currentCallUsers)
    const usersInRoom        = computed(() => connection.usersInRoom)
    const allUsersInRoom     = computed(() => {
        const mySlug = meStore.getMe?.slug
        if (!mySlug || connection.usersInRoom.includes(mySlug)) return [...connection.usersInRoom]
        return [...connection.usersInRoom, mySlug]
    })
    const topology           = computed(() => session.topology)
    const hubSlug            = computed(() => session.hubSlug)
    const isHub              = computed(() => session.isHub)
    const isHubConnected     = computed(
        () => !!session.hubSlug && allUsersInRoom.value.includes(session.hubSlug)
    )
    const currentStream      = computed(() => media.currentStream)
    const isStreaming        = computed(() => media.isStreaming)
    const isCapturing        = computed(() => media.isCapturing)
    const mySlug             = computed(() => meStore.getMe?.slug)
    const myName             = computed(() => meStore.getMe?.name)

    // ── Signal peerUnavailable ────────────────────────────────────────────────
    const peerUnavailableSignal = ref(null)

    // ── waitForMeReady ────────────────────────────────────────────────────────
    // Dans les tests on résout immédiatement sauf override explicite (ex: tester le timeout)
    const waitForMeReady = overrides.waitForMeReady
        ?? vi.fn().mockResolvedValue(true)

    // ── setUpConnectionListeners (passthrough minimal) ────────────────────────
    const setUpConnectionListeners = vi.fn(() => () => {})

    // ── storeConnectionEventCallbacks ─────────────────────────────────────────
    const storeConnectionEventCallbacks = vi.fn((callbacks) => {
        if (!callbacks || typeof callbacks !== 'object') return
        Object.keys(callbacks).forEach((key) => {
            const entry = connectionEvents[key]
            if (entry && typeof callbacks[key] === 'function' && !entry.isActive) {
                entry.callback = callbacks[key]
                entry.isActive = true
            }
        })
    })

    // ── currentCallUsers helpers ──────────────────────────────────────────────
    const setCurrentCallUsers = (users = []) => {
        session.currentCallUsers = Array.isArray(users) ? users : []
        return session.currentCallUsers
    }
    const addCurrentCallUser = (userSlug, type = 'visio') => {
        if (!userSlug) return session.currentCallUsers
        const exists = session.currentCallUsers.some(
            (u) => u.userSlug === userSlug && u.type === type
        )
        if (!exists) {
            session.currentCallUsers = [...session.currentCallUsers, { userSlug, type }]
        }
        return session.currentCallUsers
    }
    const removeCurrentCallUser = (userSlug) => {
        if (!userSlug) return session.currentCallUsers
        session.currentCallUsers = session.currentCallUsers.filter((u) => u.userSlug !== userSlug)
        return session.currentCallUsers
    }
    const clearCurrentCallUsers = () => {
        session.currentCallUsers = []
        return session.currentCallUsers
    }

    // ── destroy ───────────────────────────────────────────────────────────────
    const destroy = vi.fn(() => {
        media.remoteStreamsMap.clear()
        media.currentStream = null
        session.currentCallUsers = []
        media.isStreaming = false
        media.isCapturing = false
        callMachine.reset()
        connection.usersInRoom = []
    })

    return {
        contextId,
        lastRoomSignal,

        // infra
        peerStore,
        meStore,
        serverStore,
        AjaxService,
        eventBus,

        // state
        session,
        media,
        ui,
        connection,
        lifecycle,
        connectionEvents,

        // FSM
        callMachine,

        // computed
        currentType,
        currentRoom,
        onAirRoom,
        currentCallRoomId,
        currentCallUsers,
        callInprogress: callMachine.callInprogress,
        callStatus: computed(() => callMachine.callState.value),
        isShuttingDown: computed(() => lifecycle.shutdownCount > 0),
        usersInRoom,
        allUsersInRoom,
        topology,
        hubSlug,
        isHub,
        isHubConnected,
        currentStream,
        isStreaming,
        isCapturing,
        mySlug,
        myName,

        // helpers
        waitForMeReady,
        beginShutdown,
        endShutdown,
        setUpConnectionListeners,
        storeConnectionEventCallbacks,
        setCurrentCallUsers,
        addCurrentCallUser,
        removeCurrentCallUser,
        clearCurrentCallUsers,

        // signal réactif
        peerUnavailableSignal,

        // destroy
        destroy,
    }
}
