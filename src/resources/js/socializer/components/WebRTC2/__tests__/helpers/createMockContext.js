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
import { reactive, computed, ref, watch } from 'vue'
import { vi } from 'vitest'
import { createCallStateMachine } from '~socializer/components/WebRTC2/Composables/utils/useCallStateMachine.js'
import { isValidSlug } from '~socializer/components/WebRTC2/Composables/utils/validators.js'
// ⚠️ Importée du store, jamais réécrite ici : la clé est un contrat partagé, une
// seconde implémentation dans le mock divergerait en silence.
import { waitingPeerIdKey } from '~socializer/stores/peers2/keys.js'
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
        // Allowlist du garde sortant — registre dédié, jamais currentCallUsers
        // (cf. createPeerContext)
        authorizedCallPeers: new Map(),
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
        // Pairs dont un flux est annoncé mais pas encore reçu (cf. createPeerContext)
        announcedStreamsMap: new Map(),
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
    // `presenceSynced: true` par défaut — un contexte de test qui se voit attribuer un
    // `usersInRoom` (fût-il vide) décrit une room qu'il CONNAÎT. Le laisser à false
    // ferait basculer chaque garde d'admission sur le chemin « je ne sais pas encore »
    // et rendrait les tests de refus dépendants d'un timeout. Les tests qui visent
    // précisément le démarrage d'un contexte le passent explicitement à false.
    const connection = reactive({
        usersInRoom: [],
        presenceSynced: true,
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
    const _roomMembers = {}
    const _signalQueueRooms = {}
    // Registre des contextes montés. Une vraie Map, comme dans peers2/state.js — mais
    // NON réactive des deux côtés : le store réel la pose en `markRaw` précisément pour
    // que les valeurs ressorties soient les objets de contexte eux-mêmes et non des
    // proxies, dont les comparaisons d'identité (`unregisterContext`) échoueraient.
    const _contextRegistry = new Map()
    // Jetons des consommateurs du peer singleton — un Set, comme peers2/state.js.
    const _peerConsumers = new Set()

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

        // ── Registre des contextes montés ─────────────────────────────────────
        // Mêmes deux gardes que le store réel, et ils ne sont PAS décoratifs :
        // last-write-wins à l'inscription (un contexte remonté reprend l'id de celui
        // qui se démonte), identité au retrait (sinon l'onUnmounted de l'ancien
        // effacerait l'entrée du nouveau, qui ne recevrait plus rien).
        contextRegistry: _contextRegistry,
        registerContext: vi.fn((registered) => {
            if (!registered?.contextId) return
            _contextRegistry.set(registered.contextId, registered)
        }),
        unregisterContext: vi.fn((registered) => {
            if (!registered?.contextId) return
            if (_contextRegistry.get(registered.contextId) === registered) {
                _contextRegistry.delete(registered.contextId)
            }
        }),
        getContextById: vi.fn((contextId) => {
            if (!contextId) return null
            return _contextRegistry.get(contextId) ?? null
        }),
        // Une FONCTION, comme le getter réel — dont le commentaire explique pourquoi :
        // sur une collection `markRaw`, un getter Pinia mis en cache figerait le registre.
        getRegisteredContexts: vi.fn(() => [..._contextRegistry.values()]),

        getRemotePeerId: vi.fn((slug) => _remotePeerIds.get(slug) ?? null),
        hasRemotePeerId: vi.fn((slug) => _remotePeerIds.has(slug)),
        addRemotePeerId: vi.fn((slug, peerId) => { _remotePeerIds.set(slug, peerId) }),
        // Fidèle au store réel : le mapping n'est oublié que si le pair n'est déclaré
        // présent dans AUCUNE room de l'onglet. Le prédicat porte sur `roomMembers`
        // (présence), jamais sur `connections` (connexions PeerJS) — s'en écarter ici
        // rendrait verts des tests de purge qui ne prouveraient rien.
        removeRemotePeerId: vi.fn((slug) => {
            if (peerStore.isUserInAnyRoom(slug)) return
            _remotePeerIds.delete(slug)
        }),
        // Invalidation inconditionnelle : le peerId est mort, pas « peut-être encore
        // utile ailleurs ». Purge aussi TOUTES les demandes en vol pour ce pair (tous
        // contextes), sans quoi la re-demande serait étranglée par SIGNALING_STALE_MS.
        invalidateRemotePeerId: vi.fn((slug) => {
            _remotePeerIds.delete(slug)
            peerStore.clearWaitingRemotePeerIds(slug)
        }),

        // ── Index de présence (roomMembers) ───────────────────────────────────
        roomMembers: _roomMembers,
        setRoomMembers: vi.fn((contextId, slugs = []) => {
            if (!contextId) return
            _roomMembers[contextId] = Array.isArray(slugs) ? [...slugs] : []
        }),
        clearRoomMembers: vi.fn((contextId) => {
            if (!contextId) return
            delete _roomMembers[contextId]
        }),
        isUserInAnyRoom: vi.fn((slug) => {
            if (!slug) return false
            return Object.values(_roomMembers).some(
                (slugs) => Array.isArray(slugs) && slugs.includes(slug)
            )
        }),

        // ── Demandes de peerId en vol — clé (slug, room, type) ────────────────
        // ⚠️ La clé composite EST le correctif : un mock indexé sur le slug seul
        // reproduirait la confiscation inter-contextes qu'on vient de supprimer.
        getWaitingRemotePeerId: vi.fn((slug, room = null, type = null) => (
            _waitingRemotePeerIds.get(waitingPeerIdKey(slug, room, type)) ?? null
        )),
        hasWaitingRemotePeerId: vi.fn((slug, room = null, type = null) => (
            _waitingRemotePeerIds.has(waitingPeerIdKey(slug, room, type))
        )),
        getWaitingRemotePeerIds: vi.fn((slug) => (
            [..._waitingRemotePeerIds.values()].filter((entry) => entry?.userSlug === slug)
        )),
        addWaitingRemotePeerId: vi.fn((slug, data = {}) => {
            _waitingRemotePeerIds.set(
                waitingPeerIdKey(slug, data?.room, data?.type),
                { ...data, userSlug: slug, createdAt: Date.now() },
            )
        }),
        removeWaitingRemotePeerId: vi.fn((slug, room = null, type = null) => {
            _waitingRemotePeerIds.delete(waitingPeerIdKey(slug, room, type))
        }),
        clearWaitingRemotePeerIds: vi.fn((slug, room = null) => {
            for (const [key, entry] of [..._waitingRemotePeerIds.entries()]) {
                if (entry?.userSlug !== slug) continue
                if (room !== null && entry?.room !== room) continue
                _waitingRemotePeerIds.delete(key)
            }
        }),
        clearWaitingRemotePeerIdsForContext: vi.fn((ctxId) => {
            if (!ctxId) return
            for (const [key, entry] of [..._waitingRemotePeerIds.entries()]) {
                if (entry?.contextId === ctxId) _waitingRemotePeerIds.delete(key)
            }
        }),

        // Peer local : `usePeerTransport` lit et écrit ces deux membres directement.
        // Leur absence du mock était invisible (undefined se lit sans erreur) mais
        // rendait tout test du transport muet sur ces chemins.
        localPeer: overrides.peerStore?.localPeer ?? null,
        localPeerReady: overrides.peerStore?.localPeerReady ?? false,

        // ─── Runtime du Peer singleton ────────────────────────────────────────
        // Ref-counting, garde d'init et reconnexion : cet état vit dans le store réel
        // (cf. stores/peers2/state.js) précisément pour ne PAS dépendre de la durée de
        // vie du module `usePeerTransport`. Le mock doit donc compter pour de vrai —
        // des `vi.fn()` vides rendraient verts des tests de destruction différée qui
        // ne prouveraient plus rien.
        peerInitPromise: overrides.peerStore?.peerInitPromise ?? null,
        peerReconnectAttempts: overrides.peerStore?.peerReconnectAttempts ?? 0,
        peerDestroyTimer: overrides.peerStore?.peerDestroyTimer ?? null,
        peerReconnectTimer: overrides.peerStore?.peerReconnectTimer ?? null,
        peerIceRefreshTimer: overrides.peerStore?.peerIceRefreshTimer ?? null,
        peerIceRefreshAttempts: overrides.peerStore?.peerIceRefreshAttempts ?? 0,
        peerListenersDetach: overrides.peerStore?.peerListenersDetach ?? null,

        // ⚠️ Des JETONS, comme le store réel, et le `null` de retour est le point de
        // fidélité qui compte : un retrait de jeton inconnu rend `null` (« rien à
        // conclure »), jamais `0`. Reproduire un compteur planché ici rendrait vert un
        // appelant qui testerait `<= 0` — c'est-à-dire exactement le bug corrigé, qui
        // permettait de détruire un Peer encore consommé.
        peerConsumers: _peerConsumers,
        addPeerConsumer: vi.fn((token) => {
            if (token === undefined || token === null) return _peerConsumers.size
            _peerConsumers.add(token)
            return _peerConsumers.size
        }),
        removePeerConsumer: vi.fn((token) => {
            if (!_peerConsumers.delete(token)) return null
            return _peerConsumers.size
        }),

        // ── Observabilité de l'état du Peer ───────────────────────────────────
        // La logique est DUPLIQUÉE du store réel, à contre-cœur mais à dessein : c'est le
        // seul fait dérivé que le transport journalise, et un mock qui rendrait un état
        // constant ferait taire l'audit exactement là où il doit crier. Les deux
        // implémentations sont épinglées par les mêmes codes de violation.
        //
        // ⚠️ Des FONCTIONS, comme les getters réels : `localPeer` porte un Peer `markRaw`,
        // donc un `computed` servirait un état partiellement périmé.
        peerIdentity: vi.fn(() => {
            const peer = peerStore.localPeer
            const id = (typeof peer?.id === 'string') ? peer.id : null
            const base = { id, lastId: peerStore.lastLocalPeerId, consumers: _peerConsumers.size }

            if (!peer) return { state: peerStore.peerInitPromise ? 'creating' : 'absent', ...base }
            if (peer.destroyed) return { state: 'destroyed', ...base }
            if (peer.disconnected) return { state: 'disconnected', ...base }
            return { state: peerStore.localPeerReady ? 'ready' : 'connecting', ...base }
        }),
        peerStateViolations: vi.fn(() => {
            const peer = peerStore.localPeer
            const violations = []
            const add = (code, message) => violations.push({ code, message })

            if (peerStore.localPeerReady && !peer) {
                add('pret-sans-peer', 'localPeerReady est vrai alors que localPeer est nul')
            }
            if (peerStore.lastLocalPeerId && !peer && !peerStore.peerInitPromise) {
                add('id-historique-sans-peer', 'lastLocalPeerId est posé alors qu\'aucun peer n\'existe et qu\'aucune init n\'est en vol')
            }
            if (peer && peerStore.localPeerReady && typeof peer.id !== 'string') {
                add('pret-sans-id', 'localPeerReady est vrai alors que le peer n\'a pas d\'id utilisable')
            }
            if (peerStore.lastLocalPeerId && peer && (peer.destroyed || (peer.disconnected && !peerStore.peerReconnectTimer))) {
                add('id-historique-sur-peer-inutilisable', 'lastLocalPeerId est posé sur un peer détruit ou déconnecté sans reconnexion en vol')
            }
            if (peer?.destroyed && peerStore.localPeerReady) {
                add('pret-mais-detruit', 'localPeerReady est vrai sur un peer détruit')
            }
            if (peer && !peer.destroyed && _peerConsumers.size === 0 && !peerStore.peerDestroyTimer) {
                add('peer-orphelin', 'un peer vivant n\'a plus aucun consommateur et aucune destruction n\'est armée')
            }
            return violations
        }),
        auditPeerState: vi.fn((where = '?') => {
            const violations = peerStore.peerStateViolations()
            if (violations.length === 0) return violations
            console.error(
                `[WebRTC2][invariant] ${where} — ${violations.length} contradiction(s) dans l'état du Peer :`,
                { identity: peerStore.peerIdentity(), violations }
            )
            return violations
        }),

        setPeerInitPromise: vi.fn((promise = null) => { peerStore.peerInitPromise = promise }),
        resetReconnectAttempts: vi.fn(() => { peerStore.peerReconnectAttempts = 0 }),
        incrementReconnectAttempts: vi.fn(() => {
            peerStore.peerReconnectAttempts += 1
            return peerStore.peerReconnectAttempts
        }),
        // Retournent un booléen « un timer était bien armé » : le transport ne loggue
        // l'annulation de la destruction que dans ce cas.
        clearPeerDestroyTimer: vi.fn(() => {
            if (!peerStore.peerDestroyTimer) return false
            clearTimeout(peerStore.peerDestroyTimer)
            peerStore.peerDestroyTimer = null
            return true
        }),
        clearReconnectTimer: vi.fn(() => {
            if (!peerStore.peerReconnectTimer) return false
            clearTimeout(peerStore.peerReconnectTimer)
            peerStore.peerReconnectTimer = null
            return true
        }),
        clearIceRefreshTimer: vi.fn(() => {
            if (!peerStore.peerIceRefreshTimer) return false
            clearTimeout(peerStore.peerIceRefreshTimer)
            peerStore.peerIceRefreshTimer = null
            return true
        }),
        resetIceRefreshAttempts: vi.fn(() => { peerStore.peerIceRefreshAttempts = 0 }),
        incrementIceRefreshAttempts: vi.fn(() => {
            peerStore.peerIceRefreshAttempts += 1
            return peerStore.peerIceRefreshAttempts
        }),
        // Contrat du store réel reproduit à l'identique — sinon `mockFidelity` garantirait
        // la surface et laisserait passer le mensonge : remplacer une closure **exécute** la
        // précédente, et le détachement vide le champ AVANT d'appeler (jamais rejouer une
        // closure qui a jeté). Des `vi.fn()` vides rendraient verts des tests de destruction
        // qui ne prouveraient plus rien.
        setPeerListenersDetach: vi.fn((detach = null) => {
            peerStore.detachPeerListeners()
            peerStore.peerListenersDetach = detach
        }),
        detachPeerListeners: vi.fn(() => {
            const detach = peerStore.peerListenersDetach
            peerStore.peerListenersDetach = null
            if (typeof detach !== 'function') return false
            try { detach() } catch (e) { /* absorbée comme dans le store réel */ }
            return true
        }),

        // ⚠️ Ne touche PAS aux consommateurs, comme le store réel : un consommateur est un
        // composant monté, pas une propriété du Peer. C'est ce qui a rendu l'ancien
        // paramètre `keepConsumerCount` sans objet.
        resetPeerState: vi.fn(() => {
            peerStore.detachPeerListeners()
            peerStore.localPeer = null
            peerStore.localPeerReady = false
            peerStore.lastLocalPeerId = null
            peerStore.peerInitPromise = null
            peerStore.peerReconnectAttempts = 0
            peerStore.clearPeerDestroyTimer()
            peerStore.clearReconnectTimer()
            peerStore.clearIceRefreshTimer()
            peerStore.peerIceRefreshAttempts = 0
        }),

        // File de signaux brute : lue par `useSignalingQueue` (détecteur de coalescence).
        signalQueues: _signalQueueRooms,

        getQueueForRoom: vi.fn((room) => _signalQueueRooms[room] ?? []),
        getLastRoomSignal: vi.fn((room) => _signalQueueRooms[room]?.at(-1) ?? null),
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

        // ⚠️ HELPER DE TEST — n'existe PAS sur le store réel (cf. mockFidelity.test.js).
        // Raccourci de `prepareRoomConnection` + `storePeerConnection`, pour injecter une
        // connexion factice en une ligne. Produit exactement la même structure que ces
        // deux actions ; toute divergence en ferait un mock qui ment.
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
        // `setLocalPeerId` retiré : n'existait ni sur le store réel (qui expose
        // `setLastLocalPeerId`) ni dans aucun appelant — API purement imaginaire.
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
    const announcedStreamPeers = computed(() => Array.from(media.announcedStreamsMap.keys()))
    const mySlug             = computed(() => meStore.getMe?.slug)
    const myName             = computed(() => meStore.getMe?.name)

    // ── Signal peerUnavailable ────────────────────────────────────────────────
    const peerUnavailableSignal = ref(null)

    // ── waitForMeReady ────────────────────────────────────────────────────────
    // Dans les tests on résout immédiatement sauf override explicite (ex: tester le timeout)
    const waitForMeReady = overrides.waitForMeReady
        ?? vi.fn().mockResolvedValue(true)

    // ── waitForPresenceSync ───────────────────────────────────────────────────
    // Fidèle au contexte réel : résout `true` sans attendre quand la présence est déjà
    // connue, sinon dès qu'elle le devient. Pas de timeout ici — c'est le test qui
    // décide quand la présence arrive ; un test qui veut le refus sans jamais
    // synchroniser garde le défaut `presenceSynced: true` (chemin rapide) ou passe son
    // propre override.
    const waitForPresenceSync = overrides.waitForPresenceSync ?? vi.fn(() => {
        if (connection.presenceSynced) return Promise.resolve(true)
        return new Promise((resolve) => {
            const stop = watch(() => connection.presenceSynced, (synced) => {
                if (!synced) return
                stop()
                resolve(true)
            })
        })
    })

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

    // ── announcedStreams helpers ──────────────────────────────────────────────
    // Fidèles aux accesseurs de createPeerContext : slug valide et jamais soi-même.
    const markAnnouncedStream = vi.fn((userSlug, source = 'signal') => {
        if (!isValidSlug(userSlug)) return false
        if (userSlug === meStore.getMe?.slug) return false
        media.announcedStreamsMap.set(userSlug, { source, at: Date.now() })
        return true
    })
    const clearAnnouncedStream = vi.fn((userSlug) => {
        if (!userSlug) return false
        return media.announcedStreamsMap.delete(userSlug)
    })

    // ── authorizedCallPeers helpers ───────────────────────────────────────────
    // Allowlist du garde sortant. Fidèles aux accesseurs de createPeerContext :
    // slug valide, jamais soi-même, jamais d'écriture directe. Un mock permissif ici
    // rendrait vert un garde qui ne garde rien.
    const markAuthorizedCallPeer = vi.fn((userSlug) => {
        if (!isValidSlug(userSlug)) return false
        if (userSlug === meStore.getMe?.slug) return false
        session.authorizedCallPeers.set(userSlug, { at: Date.now() })
        return true
    })
    const isAuthorizedCallPeer = vi.fn((userSlug) => {
        if (!userSlug) return false
        return session.authorizedCallPeers.has(userSlug)
    })
    const clearAuthorizedCallPeer = vi.fn((userSlug) => {
        if (!userSlug) return false
        return session.authorizedCallPeers.delete(userSlug)
    })
    const clearAllAuthorizedCallPeers = vi.fn(() => {
        session.authorizedCallPeers.clear()
    })

    // ── destroy ───────────────────────────────────────────────────────────────
    const destroy = vi.fn(() => {
        media.remoteStreamsMap.clear()
        media.announcedStreamsMap.clear()
        media.currentStream = null
        session.currentCallUsers = []
        media.isStreaming = false
        media.isCapturing = false
        callMachine.reset()
        connection.usersInRoom = []
        connection.presenceSynced = false
        session.authorizedCallPeers.clear()
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
        announcedStreamPeers,
        mySlug,
        myName,

        // helpers
        waitForMeReady,
        waitForPresenceSync,
        beginShutdown,
        endShutdown,
        setUpConnectionListeners,
        storeConnectionEventCallbacks,
        setCurrentCallUsers,
        addCurrentCallUser,
        removeCurrentCallUser,
        clearCurrentCallUsers,
        markAnnouncedStream,
        clearAnnouncedStream,
        markAuthorizedCallPeer,
        isAuthorizedCallPeer,
        clearAuthorizedCallPeer,
        clearAllAuthorizedCallPeers,

        // signal réactif
        peerUnavailableSignal,

        // destroy
        destroy,
    }
}
