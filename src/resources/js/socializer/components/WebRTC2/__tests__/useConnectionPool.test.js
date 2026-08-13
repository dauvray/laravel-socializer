/**
 * useConnectionPool.test.js — Couche connexions
 *
 * Périmètre : établissement/retry des connexions et synchronisation de la room.
 * Les sous-modules (core, connections) sont injectés sous forme de mocks : le pool
 * ne les importe jamais, ce qui rend cette couche testable sans PeerJS ni Ajax.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { createMockContext } from './helpers/createMockContext.js'
import { withSetup } from './helpers/withSetup.js'
import { useConnectionPool } from '~socializer/components/WebRTC2/Composables/useConnectionPool.js'
import { SIGNALING_STALE_MS } from '~socializer/components/WebRTC2/webrtc2.config.js'

// Délai suffisant pour couvrir la 1re tentative de retry (1000ms + jitter < 300ms)
const FIRST_RETRY_MS = 1400
// Délai suffisant pour couvrir la 2e tentative (2000ms + jitter)
const SECOND_RETRY_MS = 2400

describe('useConnectionPool', () => {
    let ctx
    let app
    let pool
    let core
    let connections

    const mountPool = (context = ctx) => {
        core = {
            requestRemotePeerConnection: vi.fn().mockResolvedValue(true),
        }
        connections = {
            hasOpenConnection: vi.fn(() => false),
            connectToPeer: vi.fn(() => true),
            getRoomUsersDiff: vi.fn().mockResolvedValue({ newUsers: [], removedUsers: [] }),
        }
        ;[pool, app] = withSetup(() => useConnectionPool(context, { core, connections }))
    }

    beforeEach(() => {
        vi.useFakeTimers()
        ctx = createMockContext()
        mountPool()
    })

    afterEach(() => {
        app.unmount()
        vi.useRealTimers()
    })

    // ── requestOrConnectPeer ────────────────────────────────────────────────

    describe('requestOrConnectPeer', () => {

        it('ne fait rien sans slug', () => {
            pool.requestOrConnectPeer(null)

            expect(connections.connectToPeer).not.toHaveBeenCalled()
            expect(core.requestRemotePeerConnection).not.toHaveBeenCalled()
        })

        it('ne fait rien si une connexion du type demandé est déjà ouverte', () => {
            connections.hasOpenConnection.mockReturnValue(true)

            pool.requestOrConnectPeer('alice')

            expect(connections.connectToPeer).not.toHaveBeenCalled()
            expect(core.requestRemotePeerConnection).not.toHaveBeenCalled()
        })

        it('ouvre la connexion quand le peerId distant est connu', () => {
            ctx.peerStore.addRemotePeerId('alice', 'peer-alice')

            pool.requestOrConnectPeer('alice')

            expect(connections.connectToPeer).toHaveBeenCalledWith({
                userSlug: 'alice',
                peerId: 'peer-alice',
                type: ctx.session.currentType,
                room: ctx.session.currentRoom,
            })
            expect(core.requestRemotePeerConnection).not.toHaveBeenCalled()
        })

        it('utilise la room d\'appel quand elle est définie', () => {
            ctx.session.currentCallRoomId = 'call-room-42'
            ctx.peerStore.addRemotePeerId('alice', 'peer-alice')

            pool.requestOrConnectPeer('alice')

            expect(connections.connectToPeer).toHaveBeenCalledWith(
                expect.objectContaining({ room: 'call-room-42' })
            )
        })

        it('respecte le type explicite (ex: screen)', () => {
            ctx.peerStore.addRemotePeerId('alice', 'peer-alice')

            pool.requestOrConnectPeer('alice', 'screen')

            expect(connections.hasOpenConnection).toHaveBeenCalledWith('alice', null, 'screen')
            expect(connections.connectToPeer).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'screen' })
            )
        })

        it('demande le peerId quand il est inconnu et qu\'aucune attente n\'est en cours', () => {
            pool.requestOrConnectPeer('alice')

            expect(core.requestRemotePeerConnection).toHaveBeenCalledWith('alice')
            expect(connections.connectToPeer).not.toHaveBeenCalled()
        })

        it('ne redemande pas le peerId si une attente est déjà en cours', () => {
            ctx.peerStore.addWaitingRemotePeerId('alice', { room: 'app', type: 'data' })

            pool.requestOrConnectPeer('alice')

            expect(core.requestRemotePeerConnection).not.toHaveBeenCalled()
        })
    })

    // ── _handleConnectionAttempt (via le moteur de retry) ───────────────────

    describe('logique de tentative (retry)', () => {

        it('arrête les tentatives quand la connexion est ouverte', async () => {
            ctx.peerStore.addRemotePeerId('alice', 'peer-alice')
            pool.requestOrConnectPeer('alice')
            connections.connectToPeer.mockClear()

            // La connexion est maintenant ouverte → la tentative doit conclure
            connections.hasOpenConnection.mockReturnValue(true)
            await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS)
            await vi.advanceTimersByTimeAsync(SECOND_RETRY_MS)

            expect(connections.connectToPeer).not.toHaveBeenCalled()
        })

        it('arrête les tentatives pendant un teardown (isShuttingDown)', async () => {
            ctx.peerStore.addRemotePeerId('alice', 'peer-alice')
            pool.requestOrConnectPeer('alice')
            connections.connectToPeer.mockClear()

            ctx.beginShutdown()
            await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS)
            await vi.advanceTimersByTimeAsync(SECOND_RETRY_MS)

            expect(connections.connectToPeer).not.toHaveBeenCalled()
        })

        it('arrête les tentatives quand l\'user n\'a plus ni peerId ni attente (il a quitté)', async () => {
            ctx.peerStore.addWaitingRemotePeerId('alice', { room: 'app', type: 'data' })
            pool.requestOrConnectPeer('alice')

            // L'user disparaît complètement entre-temps
            ctx.peerStore.removeWaitingRemotePeerId('alice')
            core.requestRemotePeerConnection.mockClear()

            await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS)
            await vi.advanceTimersByTimeAsync(SECOND_RETRY_MS)

            expect(connections.connectToPeer).not.toHaveBeenCalled()
            expect(core.requestRemotePeerConnection).not.toHaveBeenCalled()
        })

        it('replanifie une tentative quand connectToPeer échoue', async () => {
            ctx.peerStore.addRemotePeerId('alice', 'peer-alice')
            connections.connectToPeer.mockReturnValue(false)

            pool.requestOrConnectPeer('alice')
            expect(connections.connectToPeer).toHaveBeenCalledTimes(1)

            await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS)
            expect(connections.connectToPeer).toHaveBeenCalledTimes(2)

            await vi.advanceTimersByTimeAsync(SECOND_RETRY_MS)
            expect(connections.connectToPeer).toHaveBeenCalledTimes(3)
        })

        it('redemande le peerId quand la signalisation est stale', async () => {
            ctx.peerStore.getWaitingRemotePeerId.mockReturnValue({
                room: 'app',
                type: 'data',
                createdAt: Date.now() - (SIGNALING_STALE_MS + 1000),
            })

            pool.requestOrConnectPeer('alice')
            core.requestRemotePeerConnection.mockClear()

            await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS)

            expect(core.requestRemotePeerConnection).toHaveBeenCalledWith('alice')
        })

        it('ne redemande pas le peerId quand l\'attente est encore fraîche', async () => {
            ctx.peerStore.getWaitingRemotePeerId.mockReturnValue({
                room: 'app',
                type: 'data',
                createdAt: Date.now() - Math.floor(SIGNALING_STALE_MS / 2),
            })

            pool.requestOrConnectPeer('alice')
            core.requestRemotePeerConnection.mockClear()

            await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS)

            expect(core.requestRemotePeerConnection).not.toHaveBeenCalled()
        })

        it('ouvre aussi la connexion screen quand on partage l\'écran', async () => {
            ctx.media.isCapturing = true
            ctx.peerStore.addRemotePeerId('alice', 'peer-alice')
            // Type principal ouvert, screen non ouvert
            connections.hasOpenConnection.mockImplementation((slug, _conn, type) => type !== 'screen')

            pool.requestOrConnectPeer('alice', 'screen')
            connections.connectToPeer.mockClear()

            await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS)

            expect(connections.connectToPeer).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'screen', peerId: 'peer-alice' })
            )
        })

        it('clearRetry annule les tentatives d\'un seul user', async () => {
            ctx.peerStore.addRemotePeerId('alice', 'peer-alice')
            connections.connectToPeer.mockReturnValue(false)
            pool.requestOrConnectPeer('alice')
            connections.connectToPeer.mockClear()

            pool.clearRetry('alice')
            await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS + SECOND_RETRY_MS)

            expect(connections.connectToPeer).not.toHaveBeenCalled()
        })

        it('clearAllRetries annule toutes les tentatives en vol', async () => {
            ctx.peerStore.addRemotePeerId('alice', 'peer-alice')
            ctx.peerStore.addRemotePeerId('bob', 'peer-bob')
            connections.connectToPeer.mockReturnValue(false)
            pool.requestOrConnectPeer('alice')
            pool.requestOrConnectPeer('bob')
            connections.connectToPeer.mockClear()

            pool.clearAllRetries()
            await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS + SECOND_RETRY_MS)

            expect(connections.connectToPeer).not.toHaveBeenCalled()
        })
    })

    // ── syncUsersConnections ────────────────────────────────────────────────

    describe('syncUsersConnections', () => {

        it('ignore un argument non-tableau', async () => {
            await pool.syncUsersConnections(null)
            await pool.syncUsersConnections('alice')

            expect(connections.getRoomUsersDiff).not.toHaveBeenCalled()
        })

        it('ne fait rien si le contexte local n\'est pas prêt', async () => {
            ctx.waitForMeReady.mockResolvedValue(false)

            await pool.syncUsersConnections([{ slug: 'alice' }])

            expect(connections.getRoomUsersDiff).not.toHaveBeenCalled()
            expect(pool.syncUsersConnectionsLock.value).toBe(false)
        })

        it('ignore un second appel concurrent (lock)', async () => {
            let releaseReady
            const gatedCtx = createMockContext({
                waitForMeReady: vi.fn(() => new Promise((resolve) => { releaseReady = resolve })),
            })
            app.unmount()
            mountPool(gatedCtx)

            const first = pool.syncUsersConnections([{ slug: 'alice' }])
            // Deuxième appel pendant que le premier est encore en vol
            await pool.syncUsersConnections([{ slug: 'bob' }])

            expect(connections.getRoomUsersDiff).not.toHaveBeenCalled()

            releaseReady(true)
            await first

            expect(connections.getRoomUsersDiff).toHaveBeenCalledTimes(1)
            expect(connections.getRoomUsersDiff).toHaveBeenCalledWith([{ slug: 'alice' }])
            expect(pool.syncUsersConnectionsLock.value).toBe(false)
        })

        it('nettoie les peers qui ont quitté la room', async () => {
            connections.getRoomUsersDiff.mockResolvedValue({
                newUsers: [],
                removedUsers: ['bob'],
            })

            await pool.syncUsersConnections([{ slug: 'alice' }])

            expect(ctx.peerStore.removeWaitingRemotePeerId).toHaveBeenCalledWith('bob')
            expect(ctx.peerStore.removeRemotePeerId).toHaveBeenCalledWith('bob')
            expect(ctx.peerStore.clearConnectionsRoom).toHaveBeenCalledWith(
                ctx.session.currentRoom, 'bob', ctx.session.currentType
            )
        })

        it('ferme aussi la connexion screen d\'un peer parti quand on partage l\'écran', async () => {
            ctx.media.isCapturing = true
            connections.getRoomUsersDiff.mockResolvedValue({
                newUsers: [],
                removedUsers: ['bob'],
            })

            await pool.syncUsersConnections([{ slug: 'alice' }])

            expect(ctx.peerStore.clearConnectionsRoom).toHaveBeenCalledWith(
                ctx.session.currentRoom, 'bob', 'screen'
            )
        })

        it('mesh : se connecte à tous les nouveaux users', async () => {
            connections.getRoomUsersDiff.mockResolvedValue({
                newUsers: [{ slug: 'alice' }, { slug: 'bob' }],
                removedUsers: [],
            })

            await pool.syncUsersConnections([{ slug: 'alice' }, { slug: 'bob' }])

            expect(core.requestRemotePeerConnection).toHaveBeenCalledWith('alice')
            expect(core.requestRemotePeerConnection).toHaveBeenCalledWith('bob')
        })

        it('mesh : initie aussi les connexions screen pendant un partage d\'écran', async () => {
            ctx.media.isCapturing = true
            ctx.peerStore.addRemotePeerId('alice', 'peer-alice')
            connections.getRoomUsersDiff.mockResolvedValue({
                newUsers: [{ slug: 'alice' }],
                removedUsers: [],
            })

            await pool.syncUsersConnections([{ slug: 'alice' }])

            const types = connections.connectToPeer.mock.calls.map(([arg]) => arg.type)
            expect(types).toContain('data')
            expect(types).toContain('screen')
        })

        it('star : le hub se connecte à tous les nouveaux users', async () => {
            ctx.session.topology = 'star'
            ctx.session.hubSlug = 'teacher'
            ctx.session.isHub = true
            connections.getRoomUsersDiff.mockResolvedValue({
                newUsers: [{ slug: 'alice' }, { slug: 'bob' }],
                removedUsers: [],
            })

            await pool.syncUsersConnections([{ slug: 'alice' }, { slug: 'bob' }])

            expect(core.requestRemotePeerConnection).toHaveBeenCalledWith('alice')
            expect(core.requestRemotePeerConnection).toHaveBeenCalledWith('bob')
        })

        it('star : un client ne se connecte qu\'au hub', async () => {
            ctx.session.topology = 'star'
            ctx.session.hubSlug = 'teacher'
            ctx.session.isHub = false
            connections.getRoomUsersDiff.mockResolvedValue({
                newUsers: [{ slug: 'alice' }, { slug: 'bob' }],
                removedUsers: [],
            })

            await pool.syncUsersConnections([{ slug: 'alice' }, { slug: 'bob' }])

            expect(core.requestRemotePeerConnection).toHaveBeenCalledTimes(1)
            expect(core.requestRemotePeerConnection).toHaveBeenCalledWith('teacher')
        })

        it('sfu : aucune connexion pair-à-pair côté client', async () => {
            ctx.session.topology = 'sfu'
            connections.getRoomUsersDiff.mockResolvedValue({
                newUsers: [{ slug: 'alice' }],
                removedUsers: [],
            })

            await pool.syncUsersConnections([{ slug: 'alice' }])

            expect(core.requestRemotePeerConnection).not.toHaveBeenCalled()
            expect(connections.connectToPeer).not.toHaveBeenCalled()
        })
    })

    // ── Recovery : peerUnavailableSignal ────────────────────────────────────

    describe('recovery peer-unavailable', () => {

        it('relance le cycle de connexion et remet le signal à null', async () => {
            ctx.peerUnavailableSignal.value = 'alice'
            await nextTick()

            expect(core.requestRemotePeerConnection).toHaveBeenCalledWith('alice')
            expect(ctx.peerUnavailableSignal.value).toBe(null)
        })

        it('ignore un slug au format invalide', async () => {
            ctx.peerUnavailableSignal.value = 'not a valid slug!'
            await nextTick()

            expect(core.requestRemotePeerConnection).not.toHaveBeenCalled()
        })

        it('ignore le signal pendant un teardown', async () => {
            ctx.beginShutdown()

            ctx.peerUnavailableSignal.value = 'alice'
            await nextTick()

            expect(core.requestRemotePeerConnection).not.toHaveBeenCalled()
        })
    })

    // ── Cleanup ─────────────────────────────────────────────────────────────

    describe('cleanup', () => {

        it('stopPool libère les retries en vol et coupe l\'observation du signal', async () => {
            ctx.peerStore.addRemotePeerId('alice', 'peer-alice')
            connections.connectToPeer.mockReturnValue(false)
            pool.requestOrConnectPeer('alice')
            connections.connectToPeer.mockClear()

            pool.stopPool()

            await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS + SECOND_RETRY_MS)
            expect(connections.connectToPeer).not.toHaveBeenCalled()

            ctx.peerUnavailableSignal.value = 'bob'
            await nextTick()
            expect(core.requestRemotePeerConnection).not.toHaveBeenCalled()
        })

        it('le démontage active le garde de teardown et annule les tentatives', async () => {
            ctx.peerStore.addRemotePeerId('alice', 'peer-alice')
            connections.connectToPeer.mockReturnValue(false)
            pool.requestOrConnectPeer('alice')
            connections.connectToPeer.mockClear()

            app.unmount()

            expect(ctx.beginShutdown).toHaveBeenCalled()
            expect(ctx.isShuttingDown.value).toBe(true)

            await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS + SECOND_RETRY_MS)
            expect(connections.connectToPeer).not.toHaveBeenCalled()

            // Remontage pour que le afterEach global ait une app valide à démonter
            mountPool()
        })
    })
})
