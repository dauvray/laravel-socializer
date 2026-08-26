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
import { REMOTE_PEER_ID_LEASE_MS, SIGNALING_STALE_MS } from '~socializer/components/WebRTC2/webrtc2.config.js'

// Délai suffisant pour couvrir la 1re tentative de retry (1000ms + jitter < 300ms)
const FIRST_RETRY_MS = 1400
// Délai suffisant pour couvrir la 2e tentative (2000ms + jitter)
const SECOND_RETRY_MS = 2400

/**
 * Vrai MediaStream avec une piste vivante : le pool réplique la précondition de
 * connectToPeer, qui filtre sur `instanceof MediaStream` + une piste `live`.
 * (MediaStreamTrack a un constructeur illégal, d'où la surcharge de getTracks.)
 */
const liveStream = () => {
    const stream = new MediaStream()
    stream.getTracks = () => [{ readyState: 'live' }]
    return stream
}

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
            // Les deux prédicats répondent à des questions opposées et ne doivent JAMAIS
            // être stubés d'un seul geste : `hasOpenConnection` = « ne pas ouvrir en
            // double » (optimiste, une connexion en vol compte), `isConnectionEstablished`
            // = « c'est fini » (strict). Les confondre ici reproduirait dans le double le
            // bug qu'on vient de retirer de la production.
            hasOpenConnection: vi.fn(() => false),
            isConnectionEstablished: vi.fn(() => false),
            connectToPeer: vi.fn(() => true),
            getRoomUsersDiff: vi.fn().mockResolvedValue({ newUsers: [], removedUsers: [] }),
        }
        ;[pool, app] = withSetup(() => useConnectionPool(context, { core, connections }))
    }

    /**
     * Rend le double `connections` fidèle à une ouverture qui ABOUTIT : le type ouvert
     * devient d'abord « en vol » (`hasOpenConnection`) puis établi
     * (`isConnectionEstablished`), et le pool peut conclure.
     *
     * ⚠️ Sans cette transition, le double décrit une connexion qui n'aboutit jamais —
     * état parfaitement légitime (un `peer.call()` que personne ne répond), mais qui
     * n'est pas le cas nominal. Les deux prédicats restent distincts : les stuber d'un
     * seul geste réintroduirait dans le double la confusion qu'on vient de retirer de la
     * production.
     *
     * Reproduit aussi la sortie « rien ouvert faute de flux » de connectToPeer : sur un
     * type média sans MediaStream valide, il renvoie `true` sans rien ouvrir.
     */
    const connectionsThatSucceed = () => {
        const opened = new Set()

        connections.connectToPeer.mockImplementation(({ type }) => {
            if (type !== 'data') {
                const stream = type === 'screen' ? ctx.media.screenStream : ctx.media.currentStream
                if (!(stream instanceof MediaStream)) return true
            }
            opened.add(type)
            return true
        })

        connections.hasOpenConnection.mockImplementation((_slug, _room, type) => opened.has(type))
        connections.isConnectionEstablished.mockImplementation((_slug, _room, type) => opened.has(type))
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

            expect(core.requestRemotePeerConnection).toHaveBeenCalledWith('alice', ctx.session.currentType)
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

        it('ne conclut PAS sur un appel ouvert mais jamais répondu', async () => {
            // ⭐ L'invariant qui manquait, et la panne qu'il épingle.
            //
            // `peer.call()` a bien créé une MediaConnection : elle est « en vol », donc
            // `hasOpenConnection` est vrai — c'est correct, il ne faut pas en ouvrir une
            // seconde. Mais le récepteur ne l'a jamais répondue (refus à l'admission,
            // contexte introuvable, stream local absent…), donc le RTCPeerConnection
            // reste `connecting`, et WebRTC ne le fera JAMAIS basculer en `failed`.
            //
            // Conclure ici, c'est abandonner pour toujours : l'émetteur croit avoir
            // réussi, le récepteur n'a rien, et aucune erreur n'apparaît nulle part.
            // C'est le « une seule fois, puis plus rien » observé en production.
            ctx.session.currentType = 'stream'
            ctx.media.currentStream = liveStream()
            ctx.peerStore.addRemotePeerId('alice', 'peer-alice')

            // L'appel s'ouvre (donc « en vol ») mais ne s'établit jamais.
            // ⚠️ Le flux local est valide et la tentative ne renvoie pas d'erreur : rien
            // d'autre que l'établissement ne peut faire la différence ici. C'est ce qui
            // rend ce test discriminant — avant le correctif, le moteur sortait par
            // `return settled` avec `settled === true`.
            const opened = new Set()
            connections.connectToPeer.mockImplementation(({ type }) => {
                opened.add(type)
                return true
            })
            connections.hasOpenConnection.mockImplementation((_s, _r, type) => opened.has(type))
            connections.isConnectionEstablished.mockReturnValue(false)

            pool.requestOrConnectPeer('alice')
            expect(connections.connectToPeer).toHaveBeenCalledTimes(1)

            // Tour après tour, la surveillance reste armée sans rouvrir en double.
            await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS)
            await vi.advanceTimersByTimeAsync(SECOND_RETRY_MS)
            expect(connections.connectToPeer).toHaveBeenCalledTimes(1)

            // Et le jour où la connexion morte disparaît du store, le retry la rouvre —
            // ce qu'un moteur arrêté une seconde après l'appel ne pourrait plus faire.
            opened.clear()
            await vi.advanceTimersByTimeAsync(4400)

            expect(connections.connectToPeer).toHaveBeenCalledTimes(2)
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

        it('partage d\'écran SEUL : tente quand même la connexion screen', async () => {
            // Cas non couvert jusqu'ici, et le seul qui compte pour un partage d'écran :
            // A capture son écran SANS diffuser sa webcam. Le type principal n'a alors
            // aucun flux à émettre, mais ça ne doit pas empêcher la tentative 'screen' —
            // c'est le SEUL chemin qui l'ouvre (requestRemotePeerConnection n'envoie
            // jamais type:'screen').
            ctx.session.currentType = 'stream'
            ctx.media.currentStream = null
            ctx.media.isCapturing = true
            ctx.media.screenStream = liveStream()
            ctx.peerStore.addRemotePeerId('alice', 'peer-alice')

            pool.requestOrConnectPeer('alice')
            connections.connectToPeer.mockClear()
            await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS)

            expect(connections.connectToPeer).toHaveBeenCalledWith(
                expect.objectContaining({ userSlug: 'alice', type: 'screen' })
            )
        })

        it('écran + webcam : les deux tentatives ont lieu', async () => {
            ctx.session.currentType = 'stream'
            ctx.media.currentStream = liveStream()
            ctx.media.isCapturing = true
            ctx.media.screenStream = liveStream()
            ctx.peerStore.addRemotePeerId('alice', 'peer-alice')

            pool.requestOrConnectPeer('alice')
            connections.connectToPeer.mockClear()
            await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS)

            expect(connections.connectToPeer).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'stream' })
            )
            expect(connections.connectToPeer).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'screen' })
            )
        })

        it('un échec du type principal n\'empêche pas la tentative screen', async () => {
            ctx.session.currentType = 'visio'
            ctx.media.currentStream = null
            ctx.media.isCapturing = true
            ctx.media.screenStream = liveStream()
            ctx.peerStore.addRemotePeerId('alice', 'peer-alice')
            // visio sans flux → connectToPeer renvoie false (seul type à signaler l'échec)
            connections.connectToPeer.mockImplementation(({ type }) => type !== 'visio')

            pool.requestOrConnectPeer('alice')
            connections.connectToPeer.mockClear()
            await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS)

            expect(connections.connectToPeer).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'screen' })
            )
        })

        it('sans capture d\'écran, aucune tentative screen', async () => {
            ctx.media.isCapturing = false
            ctx.peerStore.addRemotePeerId('alice', 'peer-alice')

            pool.requestOrConnectPeer('alice')
            await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS)

            expect(connections.connectToPeer).not.toHaveBeenCalledWith(
                expect.objectContaining({ type: 'screen' })
            )
        })

        it('diffère la tentative quand connectToPeer n\'a rien ouvert faute de flux prêt', async () => {
            // connectToPeer renvoie true sans rien ouvrir (stream local pas encore valide).
            // Avant correctif, ce true ANNULAIT le retry → la connexion n'était jamais
            // rouverte une fois le flux prêt.
            ctx.session.currentType = 'stream'
            ctx.media.currentStream = null
            ctx.peerStore.addRemotePeerId('alice', 'peer-alice')

            pool.requestOrConnectPeer('alice')
            expect(connections.connectToPeer).toHaveBeenCalledTimes(1)

            await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS)
            expect(connections.connectToPeer).toHaveBeenCalledTimes(2)
        })

        it('conclut dès que le flux local devient émettable', async () => {
            connectionsThatSucceed()
            ctx.session.currentType = 'stream'
            ctx.media.currentStream = null
            ctx.peerStore.addRemotePeerId('alice', 'peer-alice')
            pool.requestOrConnectPeer('alice')

            // Le flux arrive : la tentative suivante ouvre réellement la connexion.
            const stream = new MediaStream()
            stream.getTracks = () => [{ readyState: 'live' }]
            ctx.media.currentStream = stream

            await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS)
            connections.connectToPeer.mockClear()
            await vi.advanceTimersByTimeAsync(SECOND_RETRY_MS)

            expect(connections.connectToPeer).not.toHaveBeenCalled()
        })

        it('data : conclut après une tentative, sans empiler les connexions', async () => {
            // Non-régression du filet de retry : un data channel n'attend aucun flux, donc
            // il s'établit dès l'ouverture et le retry conclut au tour suivant.
            //
            // Ce qui empêche d'empiler des DataConnection n'est PAS de conclure tôt, c'est
            // `hasOpenConnection` : tant qu'une connexion est en vol, la tentative est
            // sautée. La distinction compte — c'est en concluant tôt « pour ne pas
            // empiler » qu'on tuait la surveillance d'un appel média jamais répondu.
            connectionsThatSucceed()
            ctx.peerStore.addRemotePeerId('alice', 'peer-alice')

            pool.requestOrConnectPeer('alice')
            expect(connections.connectToPeer).toHaveBeenCalledTimes(1)

            // Le canal est ouvert donc établi : les tours suivants concluent sans jamais
            // rouvrir. Une seule ouverture sur toute la vie du retry.
            await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS)
            await vi.advanceTimersByTimeAsync(SECOND_RETRY_MS)
            expect(connections.connectToPeer).toHaveBeenCalledTimes(1)
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

            expect(core.requestRemotePeerConnection).toHaveBeenCalledWith('alice', ctx.session.currentType)
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

            expect(ctx.peerStore.clearWaitingRemotePeerIds)
                .toHaveBeenCalledWith('bob', ctx.session.onAirRoom)
            expect(ctx.peerStore.removeRemotePeerId).toHaveBeenCalledWith('bob')
            expect(ctx.peerStore.clearConnectionsRoom).toHaveBeenCalledWith(
                ctx.session.currentRoom, 'bob', ctx.session.currentType
            )
        })

        it('laisse les demandes en vol des autres contextes du même onglet', async () => {
            // Bob quitte MA room. Le provider voisin (autre room, même onglet, même
            // store) attend toujours son peerId : sa demande ne m'appartient pas.
            ctx.peerStore.addWaitingRemotePeerId('bob', { room: 'room-voisine', type: 'data' })
            ctx.peerStore.addWaitingRemotePeerId('bob', {
                room: ctx.session.onAirRoom,
                type: ctx.session.currentType,
            })
            connections.getRoomUsersDiff.mockResolvedValue({ newUsers: [], removedUsers: ['bob'] })

            await pool.syncUsersConnections([{ slug: 'alice' }])

            const stillPending = ctx.peerStore.getWaitingRemotePeerIds('bob')
            expect(stillPending.map((entry) => entry.room)).toEqual(['room-voisine'])
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

            expect(core.requestRemotePeerConnection).toHaveBeenCalledWith('alice', ctx.session.currentType)
            expect(core.requestRemotePeerConnection).toHaveBeenCalledWith('bob', ctx.session.currentType)
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

            expect(core.requestRemotePeerConnection).toHaveBeenCalledWith('alice', ctx.session.currentType)
            expect(core.requestRemotePeerConnection).toHaveBeenCalledWith('bob', ctx.session.currentType)
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
            expect(core.requestRemotePeerConnection).toHaveBeenCalledWith('teacher', ctx.session.currentType)
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

    // ── La demande qui n'est jamais partie ──────────────────────────────────

    describe('demande de peerId non partie (ni ID, ni waiting)', () => {

        // ⭐ La course la plus coûteuse du module, et elle ne tient qu'à une latence.
        //
        // `requestOrConnectPeer` lance `requestRemotePeerConnection` SANS l'attendre, puis
        // arme le moteur à ~1 s. Le drapeau `waiting` n'est écrit qu'APRÈS l'aller-retour
        // HTTP — et pas écrit du tout si la demande sort par un de ses gardes (plafond de
        // cadence 3/10 s, peerId local pas prêt, POST en erreur). Au premier tour, le
        // moteur voit donc « ni ID, ni intention ».
        //
        // Lire ça comme « le pair est parti » éteint le moteur (`return true` ⇒ usePeerRetry
        // ne replanifie rien) : plus personne ne redemande jamais ce peerId. Vu de
        // l'utilisateur — A diffuse, B arrive, A logue UN `Could not connect to peer <uuid>`
        // puis se tait, et B n'a même pas de spinner : aucun contact ne lui est parvenu.

        it('reste armé et redemande tant que le pair est présent', async () => {
            // La demande part (mock) mais n'écrit aucun waiting : exactement l'état laissé
            // par un POST plus lent que ce tour-ci, ou par le plafond de cadence.
            ctx.connection.usersInRoom = ['alice']

            pool.requestOrConnectPeer('alice')
            expect(core.requestRemotePeerConnection).toHaveBeenCalledTimes(1)
            core.requestRemotePeerConnection.mockClear()

            // Premier tour : ni ID, ni waiting — et pourtant alice est là.
            await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS)
            expect(core.requestRemotePeerConnection).toHaveBeenCalledWith('alice', ctx.session.currentType)

            // Et le moteur est toujours vivant au tour suivant : c'est CE point que
            // l'ancien `return true` faisait échouer, pas la première demande.
            core.requestRemotePeerConnection.mockClear()
            await vi.advanceTimersByTimeAsync(SECOND_RETRY_MS)
            expect(core.requestRemotePeerConnection).toHaveBeenCalledWith('alice', ctx.session.currentType)
        })

        it('mais s\'arrête pour de bon si le pair n\'est plus nulle part', async () => {
            // Le pendant indispensable : sans lui, le correctif ci-dessus deviendrait un
            // insisteur perpétuel sur des pairs réellement partis. `usersInRoom` vide ET
            // aucun appel autorisé ⇒ plus rien ne concerne ce pair.
            ctx.connection.usersInRoom = []
            ctx.isAuthorizedCallPeer.mockReturnValue(false)

            pool.requestOrConnectPeer('alice')
            core.requestRemotePeerConnection.mockClear()

            await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS)
            await vi.advanceTimersByTimeAsync(SECOND_RETRY_MS)

            expect(core.requestRemotePeerConnection).not.toHaveBeenCalled()
        })
    })

    // ── Le bail des peerId distants ─────────────────────────────────────────

    /**
     * Le bail (`REMOTE_PEER_ID_LEASE_MS`) : passé le délai, on ne compose plus sur une
     * entrée du store, on redemande la signalisation. Sans lui, un pair qui recharge sa
     * page laissait son ancien peerId dans le store de tous les autres — qui appelaient un
     * numéro mort et n'apprenaient le neuf qu'au retour du `peer-unavailable`.
     *
     * Ce sont les DEUX points de décision d'appel qui portent le bail, et eux seuls.
     */
    describe('le bail des peerId (REMOTE_PEER_ID_LEASE_MS)', () => {

        /**
         * Faire vieillir le bail SANS exécuter la chaîne de retry.
         *
         * ⚠️ `advanceTimersByTime(REMOTE_PEER_ID_LEASE_MS)` ne convient pas : le bail est
         * dimensionné au-dessus de l'horizon du moteur (≈55 s), donc l'avance jouerait les
         * huit tentatives — chacune sous un bail encore valide — et le moteur aurait
         * abandonné avant la première assertion. `setSystemTime` décale l'horloge et les
         * échéances en vol du même delta : le temps a passé, rien ne s'est exécuté.
         */
        const ageLease = () => vi.setSystemTime(Date.now() + REMOTE_PEER_ID_LEASE_MS + 1)

        it('requestOrConnectPeer redemande au lieu de composer un peerId hors bail', () => {
            ctx.peerStore.addRemotePeerId('alice', 'peer-alice')
            ageLease()

            pool.requestOrConnectPeer('alice')

            expect(connections.connectToPeer).not.toHaveBeenCalled()
            expect(core.requestRemotePeerConnection).toHaveBeenCalledWith('alice', ctx.session.currentType)
        })

        it('ne redemande pas si CE contexte a déjà une demande en vol, et reste armé', async () => {
            ctx.connection.usersInRoom = ['alice']
            ctx.peerStore.addRemotePeerId('alice', 'peer-alice')
            ageLease()
            // APRÈS le saut d'horloge : posée avant, la demande serait stale elle aussi et le
            // garde d'âge SIGNALING_STALE_MS la relancerait — le test ne prouverait rien.
            ctx.peerStore.addWaitingRemotePeerId('alice', { room: 'app', type: 'data' })

            pool.requestOrConnectPeer('alice')

            // Ni composer, ni redemander : le tour ne conclut pas, il diffère.
            expect(connections.connectToPeer).not.toHaveBeenCalled()
            expect(core.requestRemotePeerConnection).not.toHaveBeenCalled()

            // Et la surveillance a bien été armée — c'est elle qui reprendra la main.
            await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS)
            expect(connections.hasOpenConnection).toHaveBeenCalled()
        })

        it('⭐ le moteur de retry bascule de « composer » à « demander » sans s\'éteindre', async () => {
            ctx.connection.usersInRoom = ['alice']
            ctx.peerStore.addRemotePeerId('alice', 'peer-alice')

            pool.requestOrConnectPeer('alice')
            expect(connections.connectToPeer).toHaveBeenCalledTimes(1)
            core.requestRemotePeerConnection.mockClear()

            // Saut d'horloge AVANT le premier tour, et non en comptant les tours : avec un
            // bail dimensionné au-dessus de l'horizon de retry, l'expiration tomberait
            // sinon à la dernière tentative et le test dépendrait de MAX_RETRY_ATTEMPTS.
            ageLease()
            await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS)

            expect(core.requestRemotePeerConnection).toHaveBeenCalledWith('alice', ctx.session.currentType)
            // Le peerId mort n'est plus composé…
            expect(connections.connectToPeer).toHaveBeenCalledTimes(1)
            // …et le moteur est toujours vivant au tour suivant (`return false`).
            core.requestRemotePeerConnection.mockClear()
            await vi.advanceTimersByTimeAsync(SECOND_RETRY_MS)
            expect(core.requestRemotePeerConnection).toHaveBeenCalled()
        })

        it('⭐ un bail échu ne contourne PAS le garde d\'autorisation', async () => {
            // La branche « ni ID, ni demande » est désormais atteignable par une voie
            // nouvelle. Elle doit rester gardée : un bail échu n'autorise pas à redemander
            // le peerId d'un pair que plus rien ne concerne.
            ctx.connection.usersInRoom = []
            ctx.isAuthorizedCallPeer.mockReturnValue(false)
            ctx.peerStore.addRemotePeerId('alice', 'peer-alice')
            ageLease()

            pool.requestOrConnectPeer('alice')
            core.requestRemotePeerConnection.mockClear()

            await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS)
            await vi.advanceTimersByTimeAsync(SECOND_RETRY_MS)

            expect(core.requestRemotePeerConnection).not.toHaveBeenCalled()
            expect(connections.connectToPeer).not.toHaveBeenCalled()
        })

        it('⭐ une connexion ÉTABLIE est indifférente au bail échu', async () => {
            // Garde de structure, et la démonstration exécutable du dessin retenu : la
            // preuve de vie est lue AVANT le bail (`hasOpenConnection` dans
            // requestOrConnectPeer, `isEstablished()` dans le moteur), donc une session
            // saine plus longue que le bail ne paie aucun aller-retour. C'est aussi
            // pourquoi le bail n'a pas besoin de consulter `connections` lui-même —
            // `hasOpenConnection` est optimiste sur une MediaConnection morte, soit
            // exactement l'état d'un pair qui vient de recharger sa page.
            ctx.peerStore.addRemotePeerId('alice', 'peer-alice')
            connectionsThatSucceed()
            pool.requestOrConnectPeer('alice')
            connections.connectToPeer.mockClear()
            core.requestRemotePeerConnection.mockClear()

            ageLease()
            pool.requestOrConnectPeer('alice')
            await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS)

            expect(connections.connectToPeer).not.toHaveBeenCalled()
            expect(core.requestRemotePeerConnection).not.toHaveBeenCalled()
        })
    })

    // ── Recovery : peerUnavailableSignal ────────────────────────────────────

    describe('recovery peer-unavailable', () => {

        it('relance le cycle de connexion et remet le signal à null', async () => {
            ctx.peerUnavailableSignal.value = 'alice'
            await nextTick()

            expect(core.requestRemotePeerConnection).toHaveBeenCalledWith('alice', ctx.session.currentType)
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

        it('un drapeau d\'attente résiduel empêcherait toute re-demande', async () => {
            // Caractérise la raison d'être de la purge du waiting dans
            // peerStore.invalidateRemotePeerId : ici on simule une invalidation
            // INCOMPLÈTE (mapping supprimé, waiting laissé). Le pool retombe alors dans
            // `else if (!waiting)` → il ne demande rien et le pair reste injoignable.
            ctx.peerStore.addWaitingRemotePeerId('alice', { room: ctx.session.currentRoom, type: ctx.session.currentType })

            ctx.peerUnavailableSignal.value = 'alice'
            await nextTick()

            expect(connections.connectToPeer).not.toHaveBeenCalled()
            expect(core.requestRemotePeerConnection).not.toHaveBeenCalled()
        })

        it('après une invalidation complète, le peerId est redemandé', async () => {
            // Chaîne réelle : usePeerTransport invalide (mapping + waiting) puis émet le
            // signal ; le pool doit alors relancer une demande de signalisation.
            ctx.peerStore.addRemotePeerId('alice', 'peer-mort')
            ctx.peerStore.addWaitingRemotePeerId('alice', { room: ctx.session.currentRoom, type: ctx.session.currentType })
            ctx.peerStore.invalidateRemotePeerId('alice')

            ctx.peerUnavailableSignal.value = 'alice'
            await nextTick()

            expect(core.requestRemotePeerConnection).toHaveBeenCalledWith('alice', ctx.session.currentType)
            expect(connections.connectToPeer).not.toHaveBeenCalled()
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
