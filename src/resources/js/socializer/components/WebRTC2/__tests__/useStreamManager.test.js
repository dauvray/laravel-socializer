/**
 * useStreamManager.test.js — Couche streams
 *
 * Périmètre : registre des flux distants (clé canonique, TTL, éviction), players
 * DOM des flux distants, départ d'un pair dont la connexion se ferme.
 * `media` et `callManager` sont injectés sous forme de mocks : la couche streams
 * ne les importe jamais et ne touche jamais `ctx.callMachine` directement.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createMockContext } from './helpers/createMockContext.js'
import { useStreamManager } from '~socializer/components/WebRTC2/Composables/useStreamManager.js'
import { MAX_REMOTE_STREAMS, STREAM_STALE_MS } from '~socializer/components/WebRTC2/webrtc2.config.js'

describe('useStreamManager', () => {
    let ctx
    let sm
    let media
    let callManager
    let closingUsers

    /** Connexion PeerJS factice */
    const fakeConn = (overrides = {}) => ({
        peer: 'peer-alice',
        metadata: { from: 'alice', type: 'visio', room: 'call-room-1', ...(overrides.metadata ?? {}) },
        ...overrides,
    })

    /** MediaStream factice reconnu par `instanceof MediaStream` */
    const fakeStream = () => Object.create(MediaStream.prototype)

    beforeEach(() => {
        ctx = createMockContext({ meStore: { getMe: { slug: 'me', name: 'Me' } } })

        media = {
            createVideoElement: vi.fn(),
            removeVideoElement: vi.fn(),
        }

        // Garde par participant : on reproduit la sémantique du CallManager sans lui
        closingUsers = new Set()
        callManager = {
            markCallConnected: vi.fn(),
            isRemoteClosing: vi.fn((slug) => closingUsers.has(slug)),
            beginRemoteClosing: vi.fn((slug) => closingUsers.add(slug)),
            endRemoteClosing: vi.fn((slug) => closingUsers.delete(slug)),
            stopCallWithPeers: vi.fn().mockResolvedValue(undefined),
        }

        sm = useStreamManager(ctx, { media, callManager })
    })

    // ── handleStreamReceived ────────────────────────────────────────────────

    describe('handleStreamReceived', () => {

        it('ne fait rien si le contexte local n\'est pas prêt', async () => {
            ctx.waitForMeReady.mockResolvedValue(false)

            await sm.handleStreamReceived(fakeStream(), fakeConn())

            expect(ctx.media.remoteStreamsMap.size).toBe(0)
            expect(media.createVideoElement).not.toHaveBeenCalled()
        })

        it('enregistre le flux sous la clé canonique slug-type', async () => {
            const stream = fakeStream()

            await sm.handleStreamReceived(stream, fakeConn())

            expect(ctx.media.remoteStreamsMap.has('alice-visio')).toBe(true)
            const entry = ctx.media.remoteStreamsMap.get('alice-visio')
            expect(entry).toMatchObject({
                stream,
                remoteSlug: 'alice',
                remoteType: 'visio',
                peerId: 'peer-alice',
            })
            expect(entry.createdAt).toBeTypeOf('number')
        })

        it('crée le player du flux distant', async () => {
            const stream = fakeStream()

            await sm.handleStreamReceived(stream, fakeConn())

            expect(media.createVideoElement).toHaveBeenCalledWith(
                { videoId: 'remote-alice-visio', type: 'visio', source: 'remote' },
                stream
            )
        })

        it('confirme l\'établissement de l\'appel via le CallManager', async () => {
            await sm.handleStreamReceived(fakeStream(), fakeConn())

            expect(callManager.markCallConnected).toHaveBeenCalled()
        })

        it('ignore un flux dont on ne peut pas distinguer l\'émetteur (c\'est moi)', async () => {
            await sm.handleStreamReceived(fakeStream(), fakeConn({ metadata: { from: 'me' } }))

            expect(ctx.media.remoteStreamsMap.size).toBe(0)
        })

        it('résout le slug via metadata.slug quand `from` est absent', async () => {
            await sm.handleStreamReceived(
                fakeStream(),
                { peer: 'p', metadata: { slug: 'bob', type: 'visio' } }
            )

            expect(ctx.media.remoteStreamsMap.has('bob-visio')).toBe(true)
        })

        it('utilise le paramètre metadata en priorité sur conn.metadata', async () => {
            await sm.handleStreamReceived(
                fakeStream(),
                fakeConn(),
                { from: 'bob', type: 'vocal' }
            )

            expect(ctx.media.remoteStreamsMap.has('bob-vocal')).toBe(true)
        })

        it('retombe sur visio quand le type est absent', async () => {
            await sm.handleStreamReceived(fakeStream(), { peer: 'p', metadata: { from: 'alice' } })

            expect(ctx.media.remoteStreamsMap.has('alice-visio')).toBe(true)
        })

        it('ignore un second flux pour la même clé (idempotence)', async () => {
            await sm.handleStreamReceived(fakeStream(), fakeConn())
            media.createVideoElement.mockClear()
            callManager.markCallConnected.mockClear()

            await sm.handleStreamReceived(fakeStream(), fakeConn())

            expect(ctx.media.remoteStreamsMap.size).toBe(1)
            expect(media.createVideoElement).not.toHaveBeenCalled()
            expect(callManager.markCallConnected).not.toHaveBeenCalled()
        })

        it('mode stream : enregistre le flux sans créer de player DOM', async () => {
            ctx.session.currentType = 'stream'

            await sm.handleStreamReceived(fakeStream(), fakeConn())

            expect(ctx.media.remoteStreamsMap.has('alice-visio')).toBe(true)
            expect(media.createVideoElement).not.toHaveBeenCalled()
        })

        it('ne crée pas de player pour un objet qui n\'est pas un MediaStream', async () => {
            await sm.handleStreamReceived({ fake: true }, fakeConn())

            expect(ctx.media.remoteStreamsMap.has('alice-visio')).toBe(true)
            expect(media.createVideoElement).not.toHaveBeenCalled()
        })

        it('évince les entrées expirées (TTL) avant d\'ajouter', async () => {
            ctx.media.remoteStreamsMap.set('old-visio', {
                stream: {}, remoteSlug: 'old', remoteType: 'visio',
                createdAt: Date.now() - (STREAM_STALE_MS + 1000),
            })

            await sm.handleStreamReceived(fakeStream(), fakeConn())

            expect(ctx.media.remoteStreamsMap.has('old-visio')).toBe(false)
            expect(media.removeVideoElement).toHaveBeenCalledWith('remote-old-visio')
            expect(ctx.media.remoteStreamsMap.has('alice-visio')).toBe(true)
        })

        it('évince les plus anciennes entrées (FIFO) quand la map est pleine', async () => {
            for (let i = 0; i < MAX_REMOTE_STREAMS; i++) {
                ctx.media.remoteStreamsMap.set(`user${i}-visio`, {
                    stream: {}, remoteSlug: `user${i}`, remoteType: 'visio', createdAt: Date.now(),
                })
            }

            await sm.handleStreamReceived(fakeStream(), fakeConn())

            expect(ctx.media.remoteStreamsMap.size).toBeLessThanOrEqual(MAX_REMOTE_STREAMS)
            expect(ctx.media.remoteStreamsMap.has('user0-visio')).toBe(false)
            expect(media.removeVideoElement).toHaveBeenCalledWith('remote-user0-visio')
            expect(ctx.media.remoteStreamsMap.has('alice-visio')).toBe(true)
        })
    })

    // ── handleStreamRemoved ─────────────────────────────────────────────────

    describe('handleStreamRemoved', () => {

        beforeEach(() => {
            ctx.addCurrentCallUser('alice', 'visio')
            ctx.media.remoteStreamsMap.set('alice-visio', {
                stream: {}, metadata: { from: 'alice' }, remoteSlug: 'alice', remoteType: 'visio',
                createdAt: Date.now(),
            })
            ctx.session.currentType = 'visio'
        })

        it('ne fait rien si le contexte local n\'est pas prêt', async () => {
            ctx.waitForMeReady.mockResolvedValue(false)

            await sm.handleStreamRemoved(fakeConn())

            expect(media.removeVideoElement).not.toHaveBeenCalled()
            expect(ctx.media.remoteStreamsMap.size).toBe(1)
        })

        it('retire le player, l\'entrée du registre et le participant', async () => {
            await sm.handleStreamRemoved(fakeConn())

            expect(media.removeVideoElement).toHaveBeenCalledWith('remote-alice-visio')
            expect(ctx.media.remoteStreamsMap.has('alice-visio')).toBe(false)
            expect(ctx.session.currentCallUsers).toEqual([])
        })

        it('émet close-call pour le pair parti', async () => {
            await sm.handleStreamRemoved(fakeConn())

            expect(ctx.eventBus.$emit).toHaveBeenCalledWith('close-call', [
                { userSlug: 'alice', type: 'visio' },
            ])
        })

        it('ferme tout l\'appel quand le dernier participant part', async () => {
            await sm.handleStreamRemoved(fakeConn())

            expect(callManager.stopCallWithPeers).toHaveBeenCalledWith([], false, {
                mode: 'full',
                roomId: 'call-room-1',
            })
        })

        it('ne ferme pas l\'appel s\'il reste des participants', async () => {
            ctx.addCurrentCallUser('bob', 'visio')

            await sm.handleStreamRemoved(fakeConn())

            expect(callManager.stopCallWithPeers).not.toHaveBeenCalled()
        })

        it('mode stream : le départ d\'un pair n\'arrête jamais le broadcast local', async () => {
            ctx.session.currentType = 'stream'

            await sm.handleStreamRemoved(fakeConn())

            expect(ctx.media.remoteStreamsMap.has('alice-visio')).toBe(false)
            expect(callManager.stopCallWithPeers).not.toHaveBeenCalled()
        })

        it('encadre le traitement par la garde du CallManager', async () => {
            await sm.handleStreamRemoved(fakeConn())

            expect(callManager.beginRemoteClosing).toHaveBeenCalledWith('alice')
            expect(callManager.endRemoteClosing).toHaveBeenCalledWith('alice')
            expect(closingUsers.has('alice')).toBe(false)
        })

        it('ignore un départ déjà en cours de traitement', async () => {
            closingUsers.add('alice')

            await sm.handleStreamRemoved(fakeConn())

            expect(media.removeVideoElement).not.toHaveBeenCalled()
            expect(callManager.beginRemoteClosing).not.toHaveBeenCalled()
        })

        it('dédoublonne deux fermetures concurrentes du même pair', async () => {
            const first = sm.handleStreamRemoved(fakeConn())
            const second = sm.handleStreamRemoved(fakeConn())
            await Promise.all([first, second])

            const closeCallEmissions = ctx.eventBus.$emit.mock.calls
                .filter(([event]) => event === 'close-call')
            expect(closeCallEmissions).toHaveLength(1)
        })

        it('ignore une connexion dont l\'émetteur est indistinguable de moi', async () => {
            await sm.handleStreamRemoved(fakeConn({ metadata: { from: 'me' } }))

            expect(callManager.beginRemoteClosing).not.toHaveBeenCalled()
            expect(ctx.media.remoteStreamsMap.size).toBe(1)
        })

        it('libère la garde même si le nettoyage échoue', async () => {
            media.removeVideoElement.mockImplementation(() => {
                throw new Error('DOM cassé')
            })
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

            await sm.handleStreamRemoved(fakeConn())

            expect(callManager.endRemoteClosing).toHaveBeenCalledWith('alice')
            expect(closingUsers.has('alice')).toBe(false)
            expect(consoleError).toHaveBeenCalled()
            consoleError.mockRestore()
        })

        it('retombe sur la room d\'appel courante quand les métadonnées n\'en portent pas', async () => {
            ctx.session.currentCallRoomId = 'fallback-room'

            await sm.handleStreamRemoved({ metadata: { from: 'alice', type: 'visio' } })

            expect(callManager.stopCallWithPeers).toHaveBeenCalledWith([], false, {
                mode: 'full',
                roomId: 'fallback-room',
            })
        })
    })
})
