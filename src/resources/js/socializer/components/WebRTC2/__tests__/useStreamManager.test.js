/**
 * useStreamManager.test.js — Couche streams
 *
 * Périmètre : registre des flux distants (clé canonique, TTL, éviction), players
 * DOM des flux distants, et **résolution** du pair distant d'une connexion qui se
 * ferme — la séquence de départ elle-même appartient au CallManager
 * (`handleRemoteDeparture`, testée dans useCallManager.test.js).
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

        // La séquence de départ appartient au CallManager : cette couche ne fait que
        // résoudre le pair concerné et déléguer (cf. useCallManager.test.js pour la
        // séquence elle-même).
        callManager = {
            markCallConnected: vi.fn(),
            handleRemoteDeparture: vi.fn().mockResolvedValue(true),
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

            expect(callManager.handleRemoteDeparture).not.toHaveBeenCalled()
            expect(ctx.media.remoteStreamsMap.size).toBe(1)
        })

        it('ignore une connexion dont l\'émetteur est indistinguable de moi', async () => {
            await sm.handleStreamRemoved(fakeConn({ metadata: { from: 'me' } }))

            expect(callManager.handleRemoteDeparture).not.toHaveBeenCalled()
            expect(ctx.media.remoteStreamsMap.size).toBe(1)
        })

        it('délègue le départ au CallManager avec le pair résolu depuis les métadonnées', async () => {
            await sm.handleStreamRemoved(fakeConn())

            expect(callManager.handleRemoteDeparture).toHaveBeenCalledWith({
                userSlug: 'alice',
                type: 'visio',
                roomId: 'call-room-1',
            })
        })

        it('résout le pair distant depuis metadata.slug sur une connexion sortante', async () => {
            // Connexion que J'AI ouverte : metadata.from porte mon slug, le distant
            // est dans metadata.slug.
            await sm.handleStreamRemoved(fakeConn({
                metadata: { from: 'me', slug: 'alice', type: 'visio', room: 'call-room-1' },
            }))

            expect(callManager.handleRemoteDeparture).toHaveBeenCalledWith({
                userSlug: 'alice',
                type: 'visio',
                roomId: 'call-room-1',
            })
        })

        it('retombe sur la room d\'appel courante quand les métadonnées n\'en portent pas', async () => {
            ctx.session.currentCallRoomId = 'fallback-room'

            await sm.handleStreamRemoved({ metadata: { from: 'alice', type: 'visio' } })

            expect(callManager.handleRemoteDeparture).toHaveBeenCalledWith({
                userSlug: 'alice',
                type: 'visio',
                roomId: 'fallback-room',
            })
        })

        it('ne nettoie plus rien elle-même : le registre et les players sont du ressort du CallManager', async () => {
            await sm.handleStreamRemoved(fakeConn())

            expect(media.removeVideoElement).not.toHaveBeenCalled()
            expect(ctx.media.remoteStreamsMap.has('alice-visio')).toBe(true)
            expect(ctx.eventBus.$emit).not.toHaveBeenCalled()
        })
    })
})
