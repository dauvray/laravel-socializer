/**
 * usePeerConnections.test.js
 *
 * Couche connexions : diff de room, état d'ouverture, ouverture/fermeture PeerJS.
 *
 * Depuis l'extraction de useSignalingQueue, ce composable n'enregistre plus AUCUN hook
 * de lifecycle Vue (cf. commentaire usePeerConnections.js:365) — il s'appelle donc
 * directement, sans `withSetup`, comme useCallManager / useStreamManager.
 *
 * ⚠️ Ces tests documentent le comportement ACTUEL. Deux asymétries connues et
 * volontairement non corrigées sont couvertes telles quelles (items ouverts de la
 * TODOLIST) : `stream`/`screen` renvoient `true` sans rien ouvrir quand le flux local
 * est absent, alors que `visio` renvoie `false` ; et `'audio'` n'appartient pas à
 * VALID_CONNECTION_TYPES.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { usePeerConnections } from '~socializer/components/WebRTC2/Composables/usePeerConnections.js'
import { MAX_PEERS_PER_ROOM } from '~socializer/components/WebRTC2/webrtc2.config.js'
import { createMockContext } from './helpers/createMockContext.js'
import { createMockDataConnection, createMockMediaConnection } from './__mocks__/peerjs.js'

const ROOM = 'room-1'
const ME = 'test-user'

/** Peer local factice : `connect` et `call` renvoient des connexions PeerJS mockées. */
const fakeLocalPeer = () => ({
    id: 'local-peer-id-mock',
    connect: vi.fn(() => createMockDataConnection()),
    call: vi.fn(() => createMockMediaConnection()),
})

/** Vrai MediaStream (le code filtre sur `instanceof`) avec au moins une piste vivante. */
const liveStream = () => {
    const stream = new MediaStream()
    stream.getTracks = () => [{ readyState: 'live', stop: vi.fn() }]
    return stream
}

/** MediaStream dont toutes les pistes sont terminées → considéré invalide par le code. */
const deadStream = () => {
    const stream = new MediaStream()
    stream.getTracks = () => [{ readyState: 'ended', stop: vi.fn() }]
    return stream
}

const makeCtx = (overrides = {}) =>
    createMockContext({
        session: { currentType: 'data', currentRoom: ROOM, ...(overrides.session ?? {}) },
        peerStore: { getLocalPeer: fakeLocalPeer(), ...(overrides.peerStore ?? {}) },
        ...overrides,
    })

describe('usePeerConnections', () => {
    let ctx
    let connections

    beforeEach(() => {
        ctx = makeCtx()
        connections = usePeerConnections(ctx)
    })

    // ── getRoomUsersDiff ──────────────────────────────────────────────────────
    describe('getRoomUsersDiff', () => {
        it('détecte les arrivants et met à jour la liste de la room', async () => {
            const diff = await connections.getRoomUsersDiff([
                { slug: 'alice' },
                { slug: 'bob' },
            ])

            expect(diff.newUsers.map((u) => u.slug)).toEqual(['alice', 'bob'])
            expect(diff.removedUsers).toEqual([])
            expect(ctx.connection.usersInRoom).toEqual(['alice', 'bob'])
        })

        it('détecte les partants et ne les compte pas comme arrivants', async () => {
            await connections.getRoomUsersDiff([{ slug: 'alice' }, { slug: 'bob' }])

            const diff = await connections.getRoomUsersDiff([{ slug: 'alice' }])

            expect(diff.newUsers).toEqual([])
            expect(diff.removedUsers).toEqual(['bob'])
            expect(ctx.connection.usersInRoom).toEqual(['alice'])
        })

        it('exclut mon propre slug de la liste (filtrage à la source)', async () => {
            const diff = await connections.getRoomUsersDiff([{ slug: ME }, { slug: 'alice' }])

            expect(diff.newUsers.map((u) => u.slug)).toEqual(['alice'])
            expect(ctx.connection.usersInRoom).not.toContain(ME)
        })

        it('retourne un diff vide et ne touche à rien si l\'identité locale n\'est pas prête', async () => {
            ctx.waitForMeReady.mockResolvedValue(false)

            const diff = await connections.getRoomUsersDiff([{ slug: 'alice' }])

            expect(diff).toEqual({ newUsers: [], removedUsers: [] })
            expect(ctx.connection.usersInRoom).toEqual([])
        })

        it('sérialise les appels concurrents (pas de TOCTOU sur usersInRoom)', async () => {
            // Sans le mutex, les deux appels liraient le même `previousSlugs` vide et le
            // second annoncerait alice comme un arrivant une seconde fois.
            const [first, second] = await Promise.all([
                connections.getRoomUsersDiff([{ slug: 'alice' }]),
                connections.getRoomUsersDiff([{ slug: 'alice' }, { slug: 'bob' }]),
            ])

            expect(first.newUsers.map((u) => u.slug)).toEqual(['alice'])
            expect(second.newUsers.map((u) => u.slug)).toEqual(['bob'])
            expect(ctx.connection.usersInRoom).toEqual(['alice', 'bob'])
        })

        it('une erreur dans un appel ne bloque pas le verrou pour les suivants', async () => {
            ctx.waitForMeReady.mockRejectedValueOnce(new Error('boom'))

            await expect(connections.getRoomUsersDiff([{ slug: 'alice' }])).rejects.toThrow('boom')

            const diff = await connections.getRoomUsersDiff([{ slug: 'bob' }])
            expect(diff.newUsers.map((u) => u.slug)).toEqual(['bob'])
        })

        it('getNewUsersInRoom ne renvoie que les arrivants', async () => {
            const newUsers = await connections.getNewUsersInRoom([{ slug: 'alice' }])

            expect(newUsers.map((u) => u.slug)).toEqual(['alice'])
        })
    })

    // ── hasOpenConnection ─────────────────────────────────────────────────────
    describe('hasOpenConnection', () => {
        const register = (slug, type, conn) =>
            ctx.peerStore.addPeerConnectionInstance(ROOM, slug, type, conn)

        it('renvoie false quand aucune connexion n\'est enregistrée', () => {
            expect(connections.hasOpenConnection('alice', ROOM, 'data')).toBe(false)
        })

        it('data : suit le drapeau `open` de la DataConnection', () => {
            const conn = createMockDataConnection()
            register('alice', 'data', conn)

            expect(connections.hasOpenConnection('alice', ROOM, 'data')).toBe(false)
            conn.open = true
            expect(connections.hasOpenConnection('alice', ROOM, 'data')).toBe(true)
        })

        it('media : connectionState `connected` → ouverte', () => {
            register('alice', 'visio', createMockMediaConnection())

            expect(connections.hasOpenConnection('alice', ROOM, 'visio')).toBe(true)
        })

        it.each(['closed', 'failed', 'disconnected'])(
            'media : connectionState `%s` → fermée',
            (state) => {
                const conn = createMockMediaConnection()
                conn.peerConnection.connectionState = state
                register('alice', 'visio', conn)

                expect(connections.hasOpenConnection('alice', ROOM, 'visio')).toBe(false)
            }
        )

        it('media : retombe sur signalingState quand connectionState est absent', () => {
            const conn = createMockMediaConnection()
            conn.peerConnection = { signalingState: 'closed' }
            register('alice', 'visio', conn)

            expect(connections.hasOpenConnection('alice', ROOM, 'visio')).toBe(false)
        })

        it('media : un RTCPeerConnection illisible est traité comme fermé (lecture défensive)', () => {
            const conn = createMockMediaConnection()
            Object.defineProperty(conn, 'peerConnection', {
                get() { throw new Error('objet détruit') },
            })
            register('alice', 'visio', conn)

            expect(connections.hasOpenConnection('alice', ROOM, 'visio')).toBe(false)
        })

        it('media : sans peerConnection exploitable, la connexion est réputée active (fallback)', () => {
            const conn = createMockMediaConnection()
            conn.peerConnection = null
            register('alice', 'visio', conn)

            expect(connections.hasOpenConnection('alice', ROOM, 'visio')).toBe(true)
        })

        it('une seule connexion ouverte parmi plusieurs suffit', () => {
            const closed = createMockDataConnection()
            const open = createMockDataConnection()
            open.open = true
            register('alice', 'data', closed)
            register('alice', 'data', open)

            expect(connections.hasOpenConnection('alice', ROOM, 'data')).toBe(true)
        })

        it('sans arguments explicites, room et type viennent du contexte', () => {
            const conn = createMockDataConnection()
            conn.open = true
            register('alice', 'data', conn)

            expect(connections.hasOpenConnection('alice')).toBe(true)
        })

        it('la room d\'appel prend le pas sur la room courante', () => {
            ctx.session.currentCallRoomId = 'call-room'
            const conn = createMockDataConnection()
            conn.open = true
            ctx.peerStore.addPeerConnectionInstance('call-room', 'alice', 'data', conn)

            expect(connections.hasOpenConnection('alice')).toBe(true)
        })
    })

    // ── connectToPeer ─────────────────────────────────────────────────────────
    describe('connectToPeer', () => {
        it('refuse un payload sans userSlug ou sans peerId', () => {
            expect(connections.connectToPeer({ peerId: 'p1' })).toBe(false)
            expect(connections.connectToPeer({ userSlug: 'alice' })).toBe(false)
            expect(ctx.peerStore.getLocalPeer.connect).not.toHaveBeenCalled()
        })

        it('accepte `fromUserSlug` comme alias de `userSlug`', () => {
            expect(connections.connectToPeer({ fromUserSlug: 'alice', peerId: 'p-alice' })).toBe(true)
            expect(ctx.peerStore.getLocalPeer.connect).toHaveBeenCalled()
        })

        it('ne se connecte jamais à soi-même (par slug comme par peerId)', () => {
            expect(connections.connectToPeer({ userSlug: ME, peerId: 'p-other' })).toBe(true)
            expect(connections.connectToPeer({ userSlug: 'alice', peerId: 'local-peer-id-mock' })).toBe(true)
            expect(ctx.peerStore.getLocalPeer.connect).not.toHaveBeenCalled()
        })

        it('n\'ouvre pas de seconde connexion si une est déjà ouverte', () => {
            const conn = createMockDataConnection()
            conn.open = true
            ctx.peerStore.addPeerConnectionInstance(ROOM, 'alice', 'data', conn)

            expect(connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice' })).toBe(true)
            expect(ctx.peerStore.getLocalPeer.connect).not.toHaveBeenCalled()
        })

        it('refuse au-delà de MAX_PEERS_PER_ROOM pairs actifs', () => {
            for (let i = 0; i < MAX_PEERS_PER_ROOM; i++) {
                const conn = createMockDataConnection()
                conn.open = true
                ctx.peerStore.addPeerConnectionInstance(ROOM, `peer-${i}`, 'data', conn)
            }

            expect(connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice' })).toBe(false)
            expect(ctx.peerStore.getLocalPeer.connect).not.toHaveBeenCalled()
        })

        it('purge le drapeau d\'attente et mémorise le peerId distant', () => {
            ctx.peerStore.addWaitingRemotePeerId('alice', { room: ROOM, type: 'data' })

            connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice' })

            expect(ctx.peerStore.removeWaitingRemotePeerId).toHaveBeenCalledWith('alice')
            expect(ctx.peerStore.getRemotePeerId('alice')).toBe('p-alice')
        })

        it('rafraîchit un mapping périmé avec le peerId de la signalisation', () => {
            // Le payload vient de PEER_CONNECT_TO_REMOTE_PEER : c'est l'information la
            // plus fraîche qui existe. Conserver l'ancienne valeur rendait un peerId mort
            // « collant » — le pair devenait définitivement injoignable (bug du 2026-08-13).
            ctx.peerStore.addRemotePeerId('alice', 'p-perime')

            connections.connectToPeer({ userSlug: 'alice', peerId: 'p-frais' })

            expect(ctx.peerStore.getRemotePeerId('alice')).toBe('p-frais')
            expect(ctx.peerStore.getLocalPeer.connect).toHaveBeenCalledWith(
                'p-frais',
                expect.anything()
            )
        })

        describe('par type de connexion', () => {
            it('data : ouvre une DataConnection fiable et l\'enregistre', () => {
                expect(connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice' })).toBe(true)

                expect(ctx.peerStore.getLocalPeer.connect).toHaveBeenCalledWith(
                    'p-alice',
                    expect.objectContaining({ reliable: true })
                )
                expect(ctx.peerStore.getLocalPeer.call).not.toHaveBeenCalled()
                expect(ctx.setUpConnectionListeners).toHaveBeenCalledTimes(1)
                expect(ctx.peerStore.storePeerConnection).toHaveBeenCalledTimes(1)
            })

            it('stream : ouvre l\'appel média ET la DataConnection associée', () => {
                ctx.session.currentType = 'stream'
                ctx.media.currentStream = liveStream()

                expect(connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice' })).toBe(true)

                expect(ctx.peerStore.getLocalPeer.call).toHaveBeenCalledTimes(1)
                expect(ctx.peerStore.getLocalPeer.connect).toHaveBeenCalledTimes(1)
                expect(ctx.peerStore.storePeerConnection).toHaveBeenCalledTimes(2)
            })

            it('screen : n\'ouvre que l\'appel média, à partir de screenStream', () => {
                ctx.session.currentType = 'screen'
                const stream = liveStream()
                ctx.media.screenStream = stream

                expect(connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice' })).toBe(true)

                expect(ctx.peerStore.getLocalPeer.call).toHaveBeenCalledWith(
                    'p-alice',
                    stream,
                    expect.anything()
                )
                expect(ctx.peerStore.getLocalPeer.connect).not.toHaveBeenCalled()
            })

            it('visio : appelle avec le flux courant', () => {
                ctx.session.currentType = 'visio'
                const stream = liveStream()
                ctx.media.currentStream = stream

                expect(connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice' })).toBe(true)
                expect(ctx.peerStore.getLocalPeer.call).toHaveBeenCalledWith(
                    'p-alice',
                    stream,
                    expect.anything()
                )
            })

            it.each(['stream', 'screen'])(
                '%s sans flux valide : renvoie true SANS rien ouvrir (asymétrie documentée)',
                (type) => {
                    ctx.session.currentType = type
                    ctx.media.currentStream = deadStream()
                    ctx.media.screenStream = deadStream()

                    // ⚠️ `true` alors qu'aucune connexion n'est ouverte : c'est ce retour qui
                    // annule le retry dans useConnectionPool (item ouvert de la TODOLIST).
                    expect(connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice' })).toBe(true)
                    expect(ctx.peerStore.getLocalPeer.call).not.toHaveBeenCalled()
                }
            )

            it('visio sans flux valide : renvoie false (seul type à signaler l\'échec)', () => {
                ctx.session.currentType = 'visio'
                ctx.media.currentStream = null

                expect(connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice' })).toBe(false)
                expect(ctx.peerStore.getLocalPeer.call).not.toHaveBeenCalled()
            })

            it('vocal : type valide mais aucune branche d\'ouverture — renvoie true sans connexion', () => {
                ctx.session.currentType = 'vocal'
                ctx.media.currentStream = liveStream()

                expect(connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice' })).toBe(true)
                expect(ctx.peerStore.getLocalPeer.call).not.toHaveBeenCalled()
                expect(ctx.peerStore.getLocalPeer.connect).not.toHaveBeenCalled()
            })
        })

        describe('validation de la configuration', () => {
            it('rejette un type hors VALID_CONNECTION_TYPES', () => {
                expect(connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice', type: 'inconnu' })).toBe(false)
            })

            it('rejette `audio`, accepté par la couche appels mais pas par la couche connexions', () => {
                // Asymétrie VALID_CALL_TYPES / VALID_CONNECTION_TYPES — item ouvert.
                expect(connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice', type: 'audio' })).toBe(false)
            })

            it('rejette une room vide', () => {
                ctx.session.currentRoom = ''
                expect(connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice' })).toBe(false)
            })

            it('rejette un contexte sans identité locale', () => {
                ctx.meStore.getMe = null
                expect(connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice' })).toBe(false)
            })

            it('renvoie false si l\'ouverture jette', () => {
                ctx.peerStore.getLocalPeer.connect.mockImplementation(() => {
                    throw new Error('peer indisponible')
                })

                expect(connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice' })).toBe(false)
            })

            it('construit des métadonnées complètes (identité, room, type, état UI)', () => {
                ctx.ui.streamStates.isMuted = true

                connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice' })

                expect(ctx.peerStore.getLocalPeer.connect).toHaveBeenCalledWith('p-alice', {
                    reliable: true,
                    metadata: {
                        slug: 'alice',
                        from: ME,
                        fromName: 'Test User',
                        type: 'data',
                        room: ROOM,
                        callbackKey: ctx.contextId,
                        isAudioMuted: true,
                        isVideoEnabled: true,
                    },
                })
            })
        })
    })

    // ── closePeerConnection ───────────────────────────────────────────────────
    describe('closePeerConnection', () => {
        beforeEach(() => {
            ;['alice', 'bob'].forEach((slug) => {
                const conn = createMockDataConnection()
                conn.open = true
                ctx.peerStore.addPeerConnectionInstance(ROOM, slug, 'data', conn)
                ctx.peerStore.addRemotePeerId(slug, `p-${slug}`)
            })
        })

        it('ferme tous les pairs de la room par défaut', () => {
            connections.closePeerConnection()

            expect(ctx.peerStore.closePeerConnection).toHaveBeenCalledWith(ROOM, 'alice', 'data')
            expect(ctx.peerStore.closePeerConnection).toHaveBeenCalledWith(ROOM, 'bob', 'data')
            expect(ctx.peerStore.getConnections[ROOM]).toBeUndefined()
        })

        it('ne ferme que les pairs listés', () => {
            connections.closePeerConnection({ users: ['alice'] })

            expect(ctx.peerStore.closePeerConnection).toHaveBeenCalledWith(ROOM, 'alice', 'data')
            expect(ctx.peerStore.closePeerConnection).not.toHaveBeenCalledWith(ROOM, 'bob', 'data')
            expect(ctx.peerStore.getConnections[ROOM].bob).toBeDefined()
        })

        it('oublie le peerId d\'un pair dont la connexion est fermée', () => {
            connections.closePeerConnection({ users: ['alice'] })

            expect(ctx.peerStore.getRemotePeerId('alice')).toBeNull()
            expect(ctx.peerStore.getRemotePeerId('bob')).toBe('p-bob')
        })

        it('purge aussi le drapeau d\'attente', () => {
            ctx.peerStore.addWaitingRemotePeerId('alice', { room: ROOM, type: 'data' })

            connections.closePeerConnection({ users: ['alice'] })

            expect(ctx.peerStore.removeWaitingRemotePeerId).toHaveBeenCalledWith('alice')
        })

        it('vide la file de signaux du contexte par défaut', () => {
            connections.closePeerConnection()

            expect(ctx.peerStore.clearSignalQueueRoom).toHaveBeenCalledWith(ctx.contextId)
        })

        it('respecte clearSignalQueue: false', () => {
            connections.closePeerConnection({ clearSignalQueue: false })

            expect(ctx.peerStore.clearSignalQueueRoom).not.toHaveBeenCalled()
        })

        it('vide quand même la file quand la room n\'a aucune connexion', () => {
            connections.closePeerConnection({ room: 'room-vide' })

            expect(ctx.peerStore.closePeerConnection).not.toHaveBeenCalled()
            expect(ctx.peerStore.clearSignalQueueRoom).toHaveBeenCalledWith(ctx.contextId)
        })
    })
})
