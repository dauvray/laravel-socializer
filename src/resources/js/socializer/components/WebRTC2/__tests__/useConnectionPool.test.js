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

        /**
         * Monte le pool sur un contexte dont `waitForMeReady` est tenu ouvert : c'est la
         * seule façon d'observer le verrou, puisqu'il n'est détenu que le temps de cette
         * attente et du diff.
         *
         * ⚠️ Une SEULE barrière pour tous les appels, à la différence d'un
         * `new Promise` reconstruit à chaque invocation : le rejeu rappelle
         * `waitForMeReady`, et une barrière neuve à ce moment-là bloquerait le drain qu'on
         * cherche justement à mesurer.
         */
        const mountGatedPool = () => {
            let openGate
            const gate = new Promise((resolve) => { openGate = resolve })
            const gatedCtx = createMockContext({
                waitForMeReady: vi.fn(() => gate.then(() => true)),
            })
            app.unmount()
            mountPool(gatedCtx)

            return { gatedCtx, openGate }
        }

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

        it('rejoue la liste reçue pendant que le verrou est tenu', async () => {
            const { openGate } = mountGatedPool()

            const first = pool.syncUsersConnections([{ slug: 'alice' }])
            // Deuxième appel pendant que le premier est encore en vol : sa liste n'est
            // plus jetée, elle est retenue et rejouée à la libération.
            const coalesced = pool.syncUsersConnections([{ slug: 'bob' }])

            expect(connections.getRoomUsersDiff).not.toHaveBeenCalled()

            openGate()
            await first
            await coalesced

            expect(connections.getRoomUsersDiff).toHaveBeenCalledTimes(2)
            expect(connections.getRoomUsersDiff).toHaveBeenNthCalledWith(1, [{ slug: 'alice' }])
            expect(connections.getRoomUsersDiff).toHaveBeenNthCalledWith(2, [{ slug: 'bob' }])
            expect(pool.syncUsersConnectionsLock.value).toBe(false)
        })

        it('ne retient que la DERNIÈRE liste reçue pendant le tour', async () => {
            const { openGate } = mountGatedPool()

            const first = pool.syncUsersConnections([{ slug: 'alice' }])
            const superseded = pool.syncUsersConnections([{ slug: 'bob' }])
            const kept = pool.syncUsersConnections([{ slug: 'carol' }])

            openGate()
            await Promise.all([first, superseded, kept])

            // Une liste de présence n'a pas d'historique : la composition intermédiaire
            // n'est pas rejouée, elle est écrasée.
            expect(connections.getRoomUsersDiff).toHaveBeenCalledTimes(2)
            expect(connections.getRoomUsersDiff).toHaveBeenNthCalledWith(1, [{ slug: 'alice' }])
            expect(connections.getRoomUsersDiff).toHaveBeenNthCalledWith(2, [{ slug: 'carol' }])
            expect(connections.getRoomUsersDiff).not.toHaveBeenCalledWith([{ slug: 'bob' }])
        })

        it('la promesse de l\'appel coalescé ne résout qu\'une fois sa liste traitée', async () => {
            const { openGate } = mountGatedPool()

            let settled = false
            const first = pool.syncUsersConnections([{ slug: 'alice' }])
            const coalesced = pool.syncUsersConnections([{ slug: 'bob' }])
                .then(() => { settled = true })

            // Toutes les microtâches en attente sont drainées : rien ne peut avancer tant
            // que la barrière tient, et la promesse coalescée ne ment donc pas.
            await vi.advanceTimersByTimeAsync(0)
            expect(settled).toBe(false)

            openGate()
            await first
            await coalesced

            expect(settled).toBe(true)
            expect(connections.getRoomUsersDiff).toHaveBeenCalledWith([{ slug: 'bob' }])
        })

        it('absorbe dans le MÊME drain un appel arrivé pendant le rejeu', async () => {
            const { openGate } = mountGatedPool()

            connections.getRoomUsersDiff.mockImplementation(async (users) => {
                // Une nouvelle composition tombe pendant le rejeu de bob.
                if (users[0]?.slug === 'bob') {
                    pool.syncUsersConnections([{ slug: 'carol' }])
                }
                return { newUsers: [], removedUsers: [] }
            })

            const first = pool.syncUsersConnections([{ slug: 'alice' }])
            pool.syncUsersConnections([{ slug: 'bob' }])

            openGate()
            // `first` est le propriétaire du verrou : qu'il ne résolve qu'après les trois
            // tours est la preuve que le drain les a enchaînés sans relâcher.
            await first

            expect(connections.getRoomUsersDiff).toHaveBeenCalledTimes(3)
            expect(connections.getRoomUsersDiff).toHaveBeenNthCalledWith(3, [{ slug: 'carol' }])
            expect(pool.syncUsersConnectionsLock.value).toBe(false)
        })

        it('ne rejoue rien si le contexte est en train de s\'arrêter', async () => {
            const { gatedCtx, openGate } = mountGatedPool()

            const first = pool.syncUsersConnections([{ slug: 'alice' }])
            const coalesced = pool.syncUsersConnections([{ slug: 'bob' }])

            gatedCtx.beginShutdown()
            openGate()

            await first
            // Résout quand même : une promesse pendante serait pire que le rejeu manqué.
            await coalesced

            expect(connections.getRoomUsersDiff).toHaveBeenCalledTimes(1)
            expect(connections.getRoomUsersDiff).toHaveBeenCalledWith([{ slug: 'alice' }])
            expect(pool.syncUsersConnectionsLock.value).toBe(false)
        })

        it('rejoue même quand le tour précédent est sorti sur un contexte non prêt', async () => {
            // L'early-return sur `!ready` termine le tour, il n'annule pas le drain : la
            // liste retenue est bien rejouée, et ne reste pas coincée derrière un tour
            // stérile.
            ctx.waitForMeReady.mockResolvedValue(false)

            const first = pool.syncUsersConnections([{ slug: 'alice' }])
            const coalesced = pool.syncUsersConnections([{ slug: 'bob' }])

            await first
            await coalesced

            expect(ctx.waitForMeReady).toHaveBeenCalledTimes(2)
            expect(connections.getRoomUsersDiff).not.toHaveBeenCalled()
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
            // ⚠️ Le pré-semis de `usersInRoom` n'est pas décoratif : ce fichier stube
            // `getRoomUsersDiff`, donc la composition n'est jamais écrite et le hub ne
            // serait membre d'aucune room. Sans lui, ce cas verdirait par ABSENCE du hub
            // dans les cibles — c'est-à-dire pour la raison exactement inverse de ce
            // qu'il prétend épingler. Avec lui, il dit ce qu'il doit : alice et bob sont
            // membres eux aussi, et le client les ignore quand même.
            ctx.session.topology = 'star'
            ctx.session.hubSlug = 'teacher'
            ctx.session.isHub = false
            ctx.connection.usersInRoom = ['teacher', 'alice', 'bob']
            connections.getRoomUsersDiff.mockResolvedValue({
                newUsers: [{ slug: 'alice' }, { slug: 'bob' }],
                removedUsers: [],
            })

            await pool.syncUsersConnections([{ slug: 'alice' }, { slug: 'bob' }])

            expect(core.requestRemotePeerConnection).toHaveBeenCalledTimes(1)
            expect(core.requestRemotePeerConnection).toHaveBeenCalledWith('teacher', ctx.session.currentType)
        })

        // ── Le client star applique le prédicat de la réconciliation ──────────
        //
        // « Membre de la room ET rien d'établi », restreint au hub : la branche client
        // est la branche mesh filtrée, pas une règle à part. Ces trois cas épinglent les
        // trois moitiés du prédicat — l'appartenance, l'établissement, et l'horizon
        // d'abandon du moteur de retry.
        it('star : un client ne compose pas un hub absent de la room', async () => {
            // ⭐ Le défaut corrigé. L'appel au hub était INCONDITIONNEL : à chaque tour de
            // présence où rien n'est ouvert vers lui, un POST /ask-to-peer-id partait, un
            // jeton du plafond de cadence était consommé et un retry s'armait — y compris
            // quand le hub n'est pas dans la room. `isAuthorizedPeer` ne rattrapait qu'un
            // tour plus tard, dans `_handleConnectionAttempt`, donc après le coût.
            ctx.session.topology = 'star'
            ctx.session.hubSlug = 'teacher'
            ctx.session.isHub = false
            ctx.connection.usersInRoom = ['alice']
            connections.getRoomUsersDiff.mockResolvedValue({
                newUsers: [{ slug: 'alice' }],
                removedUsers: [],
            })

            await pool.syncUsersConnections([{ slug: 'alice' }])

            expect(core.requestRemotePeerConnection).not.toHaveBeenCalled()
            expect(connections.connectToPeer).not.toHaveBeenCalled()
        })

        it('star : un client ne recompose pas un hub déjà établi', async () => {
            ctx.session.topology = 'star'
            ctx.session.hubSlug = 'teacher'
            ctx.session.isHub = false
            ctx.connection.usersInRoom = ['teacher']
            connections.isConnectionEstablished.mockReturnValue(true)
            connections.getRoomUsersDiff.mockResolvedValue({ newUsers: [], removedUsers: [] })

            await pool.syncUsersConnections([{ slug: 'teacher' }])

            expect(core.requestRemotePeerConnection).not.toHaveBeenCalled()
            expect(connections.connectToPeer).not.toHaveBeenCalled()
        })

        it('star : un client ne réarme pas la chaîne de retry du hub', async () => {
            // Même horizon d'abandon que le mesh, et il se défait de la même façon :
            // `scheduleRetry(slug, 0, …)` commence par `clearRetry`. Un tour de présence
            // est un appelant PÉRIODIQUE — il repasse indéfiniment — donc sans
            // `preserveRetry` il remet `attempt` à zéro à chaque passage et les ≈55 s
            // d'insistance ne tombent jamais. Le client star était la dernière branche du
            // fan-out à ne pas porter le garde.
            ctx.session.topology = 'star'
            ctx.session.hubSlug = 'teacher'
            ctx.session.isHub = false
            ctx.connection.usersInRoom = ['teacher']
            connections.getRoomUsersDiff.mockResolvedValue({
                newUsers: [{ slug: 'teacher' }],
                removedUsers: [],
            })

            // Tour 1 : le hub est un arrivant, donc une chaîne NEUVE est armée — défaut
            // inchangé, un fait neuf mérite une chaîne neuve.
            await pool.syncUsersConnections([{ slug: 'teacher' }])

            // À mi-chemin du premier délai, un tour de présence sans arrivant.
            await vi.advanceTimersByTimeAsync(700)
            connections.getRoomUsersDiff.mockResolvedValue({ newUsers: [], removedUsers: [] })
            await pool.syncUsersConnections([{ slug: 'teacher' }])

            core.requestRemotePeerConnection.mockClear()

            // La chaîne d'origine arrive à échéance : elle a survécu au tour de présence.
            // Réarmée à zéro par ce tour, elle n'aurait pas encore tiré ici.
            await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS - 700)

            expect(core.requestRemotePeerConnection).toHaveBeenCalledWith('teacher', ctx.session.currentType)
        })

        // ── Pas d'observation, pas d'émission ─────────────────────────────────
        //
        // Le tour sur liste vide a le droit d'OUBLIER — c'est même le seul qui puisse
        // purger le dernier partant — jamais celui d'OUVRIR. Le garde vit entre la purge
        // et le fan-out ; ces deux cas l'épinglent des deux côtés.
        it('un tour vide purge mais n\'ouvre rien (client star)', async () => {
            // Le garde vit ENTRE la purge et le fan-out, et il porte sur le BLOC : il ne
            // doit pas dépendre de ce que telle ou telle branche regarde aujourd'hui. Le
            // client star reste le meilleur révélateur — c'est la branche dont le prédicat
            // est le plus court — mais la règle qu'on épingle ici est « pas d'observation,
            // pas d'émission », pas le contenu de cette branche.
            ctx.session.topology = 'star'
            ctx.session.hubSlug = 'teacher'
            ctx.session.isHub = false
            connections.getRoomUsersDiff.mockResolvedValue({
                newUsers: [],
                removedUsers: ['bob'],
            })

            await pool.syncUsersConnections([])

            expect(ctx.peerStore.removeRemotePeerId).toHaveBeenCalledWith('bob')
            expect(core.requestRemotePeerConnection).not.toHaveBeenCalled()
            expect(connections.connectToPeer).not.toHaveBeenCalled()
        })

        it('un tour vide n\'ouvre rien en mesh non plus', async () => {
            // Le garde porte sur le BLOC, pas sur la seule branche star : la règle ne doit
            // pas dépendre du fait que mesh itère aujourd'hui `newUsers`, vide ici par
            // construction. Un `newUsers` non vide sur une entrée vide est incohérent — et
            // c'est précisément ce que le garde doit rendre inoffensif.
            connections.getRoomUsersDiff.mockResolvedValue({
                newUsers: [{ slug: 'alice' }],
                removedUsers: [],
            })

            await pool.syncUsersConnections([])

            expect(core.requestRemotePeerConnection).not.toHaveBeenCalled()
            expect(connections.connectToPeer).not.toHaveBeenCalled()
        })

        // ── Le fan-out réconcilie, il ne diffe pas ────────────────────────────
        //
        // `newUsers` ne nomme que les TRANSITIONS vues par le diff. Un pair parti et
        // revenu entre deux instantanés comparés n'y figure pas — il est dans
        // `previousSlugs` ET `nextSlugs`. L'autorité est donc « membre de la room ET rien
        // d'établi ».
        //
        // ⚠️ Ce fichier stube `getRoomUsersDiff`, donc `ctx.connection.usersInRoom` n'est
        // JAMAIS écrit ici : ces trois cas doivent le pré-semer eux-mêmes. Sans ce
        // pré-semis, la réconciliation ne voit aucun membre et les cas verdissent pour la
        // mauvaise raison. Le bout-en-bout du même défaut vit dans
        // `scenarios/peerDeparture.test.js`.
        it('compose un membre présent des deux côtés du diff avec qui rien n\'est établi', async () => {
            ctx.connection.usersInRoom = ['alice']
            // Ni arrivante ni partante : la composition n'a pas bougé d'un iota.
            connections.getRoomUsersDiff.mockResolvedValue({ newUsers: [], removedUsers: [] })

            await pool.syncUsersConnections([{ slug: 'alice' }])

            expect(core.requestRemotePeerConnection).toHaveBeenCalledWith('alice', ctx.session.currentType)
        })

        it('ne recompose pas un membre déjà établi', async () => {
            ctx.connection.usersInRoom = ['alice']
            connections.isConnectionEstablished.mockReturnValue(true)
            connections.getRoomUsersDiff.mockResolvedValue({ newUsers: [], removedUsers: [] })

            await pool.syncUsersConnections([{ slug: 'alice' }])

            expect(core.requestRemotePeerConnection).not.toHaveBeenCalled()
            expect(connections.connectToPeer).not.toHaveBeenCalled()
        })

        it('ne réarme pas le moteur de retry d\'un membre qui en a déjà un en vol', async () => {
            // L'horizon d'abandon, sinon défait en silence : `scheduleRetry(slug, 0, …)`
            // commence par `clearRetry`, donc une réconciliation qui repasse à chaque tour
            // de présence remettrait `attempt` à zéro — MAX_RETRY_ATTEMPTS ne serait jamais
            // atteint et un pair injoignable serait rappelé indéfiniment.
            ctx.connection.usersInRoom = ['alice']
            connections.getRoomUsersDiff.mockResolvedValue({
                newUsers: [{ slug: 'alice' }],
                removedUsers: [],
            })

            // Tour 1 : alice est une arrivante, donc une chaîne NEUVE est armée — c'est le
            // comportement par défaut, et il ne change pas : un fait neuf mérite une
            // chaîne neuve.
            await pool.syncUsersConnections([{ slug: 'alice' }])

            // À mi-chemin du premier délai (1000 ms + jitter < 300), un tour de présence
            // sans arrivant : la réconciliation compose alice de nouveau.
            await vi.advanceTimersByTimeAsync(700)
            connections.getRoomUsersDiff.mockResolvedValue({ newUsers: [], removedUsers: [] })
            await pool.syncUsersConnections([{ slug: 'alice' }])

            core.requestRemotePeerConnection.mockClear()

            // La chaîne d'origine arrive à échéance : elle a survécu au tour de présence.
            // Réarmée à zéro par ce tour, elle n'aurait pas encore tiré ici.
            await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS - 700)

            expect(core.requestRemotePeerConnection).toHaveBeenCalledWith('alice', ctx.session.currentType)
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

    // ── Re-composition : connectionLostSignal ───────────────────────────────
    //
    // Le SECOND déclencheur de composition, à côté du tour de présence. Il ferme le cas
    // que la réconciliation borne sans le fermer : un rechargement chevauchant ne produit
    // AUCUN événement de présence, donc aucun tour n'a lieu et rien de fondé sur la
    // présence ne peut faire mieux.
    //
    // ⚠️ Ce fichier stube `getRoomUsersDiff`, donc `ctx.connection.usersInRoom` n'est
    // JAMAIS écrit ici : chaque cas qui doit franchir le garde d'autorisation le
    // pré-sème lui-même. Sans ce pré-semis ils verdiraient par le mauvais bout — le
    // garde sortirait avant même d'atteindre la composition.
    //
    // Le bout-en-bout, lui, vit dans `scenarios/peerDeparture.test.js` (« A recharge en
    // chevauchement ») : c'est le seul étage où le symptôme est observable.
    describe('re-composition sur perte de connexion', () => {

        it('recompose le pair perdu et remet le signal à null', async () => {
            ctx.connection.usersInRoom = ['alice']

            ctx.connectionLostSignal.value = 'alice'
            await nextTick()

            expect(core.requestRemotePeerConnection).toHaveBeenCalledWith('alice', ctx.session.currentType)
            expect(ctx.connectionLostSignal.value).toBe(null)
        })

        it('compose directement quand le peerId est encore sous bail', async () => {
            ctx.connection.usersInRoom = ['alice']
            ctx.peerStore.addRemotePeerId('alice', 'peer-alice')

            ctx.connectionLostSignal.value = 'alice'
            await nextTick()

            expect(connections.connectToPeer).toHaveBeenCalledWith(
                expect.objectContaining({ userSlug: 'alice', peerId: 'peer-alice' })
            )
        })

        it('ignore un slug au format invalide, fût-il dans la composition', async () => {
            // Le porteur est `isAuthorizedPeer`, qui valide le format en première ligne —
            // ce watcher n'a donc pas de garde de format à lui. D'où la composition
            // empoisonnée : sans elle, le cas sortirait sur « pas membre » et n'épinglerait
            // pas ce qu'il croit.
            ctx.connection.usersInRoom = ['not a valid slug!']

            ctx.connectionLostSignal.value = 'not a valid slug!'
            await nextTick()

            expect(core.requestRemotePeerConnection).not.toHaveBeenCalled()
            expect(connections.connectToPeer).not.toHaveBeenCalled()
        })

        it('ignore le signal pendant un teardown', async () => {
            ctx.connection.usersInRoom = ['alice']
            ctx.beginShutdown()

            ctx.connectionLostSignal.value = 'alice'
            await nextTick()

            expect(core.requestRemotePeerConnection).not.toHaveBeenCalled()
        })

        it('ne recompose pas un pair qui n\'est plus autorisé', async () => {
            // `usersInRoom` vide et aucune autorisation d'appel : le pair est réellement
            // parti. Sans ce garde, la perte relancerait une composition sur un absent —
            // un POST, un jeton du plafond de cadence et un retry armé sur rien, que
            // `_handleConnectionAttempt` ne rattraperait qu'un tour plus tard.
            ctx.connectionLostSignal.value = 'alice'
            await nextTick()

            expect(core.requestRemotePeerConnection).not.toHaveBeenCalled()
            expect(connections.connectToPeer).not.toHaveBeenCalled()
        })

        it('reste muet tant qu\'une chaîne de retry veille sur ce pair', async () => {
            // ⭐ Le garde qui porte DEUX propriétés à lui seul.
            //
            // 1. l'anti-boucle : composer un peerId périmé rend une connexion orpheline,
            //    dont la fermeture repasserait ici — le second tour sort sur ce garde ;
            // 2. le pair pas encore revenu : un rechargement dure une seconde, pendant
            //    laquelle personne ne répond. Composer alors poserait un `waiting` de
            //    SIGNALING_STALE_MS qui muselle la demande suivante, y compris celle du
            //    tour de présence quand le pair est enfin là.
            //
            // Autrement dit, ce déclencheur ne vise QUE le régime établi : une connexion
            // qui vivait a éteint son moteur, et plus personne ne veille quand elle tombe.
            ctx.connection.usersInRoom = ['alice']
            connections.connectToPeer.mockReturnValue(false)
            pool.requestOrConnectPeer('alice')   // arme une chaîne pour 'alice'
            core.requestRemotePeerConnection.mockClear()
            connections.connectToPeer.mockClear()

            ctx.connectionLostSignal.value = 'alice'
            await nextTick()

            expect(core.requestRemotePeerConnection).not.toHaveBeenCalled()
            expect(connections.connectToPeer).not.toHaveBeenCalled()
        })

        it('mode stream : le récepteur, sans flux local, ne recompose rien', async () => {
            // En mode stream le flux ne part que du diffuseur : un récepteur qui
            // recomposerait armerait une chaîne de ~55 s incapable d'ouvrir quoi que ce
            // soit (`connectToPeer` sort par `true` sans rien ouvrir faute de flux), pour
            // finir sur un warn d'abandon — à chaque fin de diffusion, chez chaque
            // spectateur.
            app.unmount()
            ctx = createMockContext({ session: { currentType: 'stream' } })
            mountPool(ctx)
            ctx.connection.usersInRoom = ['alice']

            ctx.connectionLostSignal.value = 'alice'
            await nextTick()

            expect(core.requestRemotePeerConnection).not.toHaveBeenCalled()
            expect(connections.connectToPeer).not.toHaveBeenCalled()
        })

        it('mode stream : le diffuseur, lui, recompose', async () => {
            // La contre-épreuve du cas précédent — sans elle, « ne recompose rien »
            // serait vert même si le déclencheur était mort tout entier.
            app.unmount()
            ctx = createMockContext({ session: { currentType: 'stream' } })
            mountPool(ctx)
            ctx.connection.usersInRoom = ['alice']
            ctx.media.currentStream = liveStream()

            ctx.connectionLostSignal.value = 'alice'
            await nextTick()

            expect(core.requestRemotePeerConnection).toHaveBeenCalledWith('alice', 'stream')
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
