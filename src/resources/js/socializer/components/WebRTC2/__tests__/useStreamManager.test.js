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
import { MAX_METADATA_NAME_LENGTH, MAX_REMOTE_STREAMS, STREAM_STALE_MS } from '~socializer/components/WebRTC2/webrtc2.config.js'

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
                expect.objectContaining({
                    videoId: 'remote-alice-visio',
                    type: 'visio',
                    source: 'remote',
                    roomId: 'call-room-1',
                }),
                stream
            )
        })

        /**
         * Le player du pool n'affiche QUE `streamData.metadata` : sans ces champs, la
         * vignette du pair distant reste « Inconnu ». Cf. usePeerMedia._acquireSlot.
         */
        it('transmet au player l\'identité du flux distant', async () => {
            await sm.handleStreamReceived(fakeStream(), fakeConn({
                metadata: { from: 'alice', fromName: 'Alice', type: 'visio', room: 'call-room-1' },
            }))

            const [options] = media.createVideoElement.mock.calls[0]

            expect(options.metadata).toMatchObject({
                fromName: 'Alice',
                currentType: 'visio',
                peerId: 'peer-alice',
                isMe: false,
            })
        })

        /**
         * Connexion SORTANTE (c'est moi qui ai appelé) : `fromName` porte MON nom, pas
         * celui du distant. L'afficher tel quel collerait mon pseudo sur la vignette de
         * l'autre — on retombe sur son slug, seule identité fiable dans ce sens.
         */
        it('n\'affiche pas mon propre nom sur la vignette du distant', async () => {
            await sm.handleStreamReceived(fakeStream(), fakeConn({
                metadata: { from: 'me', fromName: 'Me', slug: 'alice', type: 'visio', room: 'call-room-1' },
            }))

            const [options] = media.createVideoElement.mock.calls[0]

            expect(options.metadata.fromName).toBe('alice')
        })

        /*
        | La metadata transmise au player est une LISTE BLANCHE (E2). Elle l'était par
        | un spread `...meta`, donc toute clé du distant traversait jusqu'à l'interface :
        | `countViewers` y est rendu en texte et `roomId` devient le `wrapperId` de la
        | directive `v-resize` (MediaBroadcastPlayer). Aucun producteur local ne posait
        | ces deux clés sur ce chemin — elles ne pouvaient venir que du réseau.
        |
        | Une liste noire aurait fermé les champs connus le jour où on l'écrit ; c'est la
        | leçon d'E8/E9 côté backend, appliquée ici au front.
        */

        it('ne transmet au player aucune clé hors liste blanche', async () => {
            await sm.handleStreamReceived(fakeStream(), fakeConn({
                metadata: {
                    from: 'alice',
                    fromName: 'Alice',
                    type: 'visio',
                    room: 'call-room-1',
                    countViewers: '9999999 spectateurs',
                    injecte: 'valeur arbitraire',
                },
            }))

            const [options] = media.createVideoElement.mock.calls[0]

            expect(options.metadata).not.toHaveProperty('countViewers')
            expect(options.metadata).not.toHaveProperty('injecte')
            expect(Object.keys(options.metadata).sort()).toEqual([
                'currentType', 'fromName', 'isAudioMuted', 'isMe', 'isVideoEnabled', 'peerId', 'roomId',
            ])
        })

        /**
         * `roomId` est DÉRIVÉ de `room`, jamais repris du distant : c'est un identifiant
         * de conteneur DOM côté player, pas une donnée à relayer.
         */
        it('dérive roomId de `room` et ignore un roomId fourni par le distant', async () => {
            await sm.handleStreamReceived(fakeStream(), fakeConn({
                metadata: {
                    from: 'alice', type: 'visio', room: 'call-room-1', roomId: 'conteneur-force',
                },
            }))

            const [options] = media.createVideoElement.mock.calls[0]

            expect(options.metadata.roomId).toBe('call-room-1')
        })

        it('tronque un nom distant trop long', async () => {
            await sm.handleStreamReceived(fakeStream(), fakeConn({
                metadata: {
                    from: 'alice',
                    fromName: 'A'.repeat(MAX_METADATA_NAME_LENGTH + 200),
                    type: 'visio',
                    room: 'call-room-1',
                },
            }))

            const [options] = media.createVideoElement.mock.calls[0]

            expect(options.metadata.fromName).toHaveLength(MAX_METADATA_NAME_LENGTH)
        })

        it('retombe sur le slug quand le nom distant est vide ou n\'est pas une chaîne', async () => {
            await sm.handleStreamReceived(fakeStream(), fakeConn({
                metadata: { from: 'alice', fromName: '   ', type: 'visio', room: 'call-room-1' },
            }))

            expect(media.createVideoElement.mock.calls[0][0].metadata.fromName).toBe('alice')
        })

        it('coerce en booléens les drapeaux de flux du distant', async () => {
            await sm.handleStreamReceived(fakeStream(), fakeConn({
                metadata: {
                    from: 'alice',
                    type: 'visio',
                    room: 'call-room-1',
                    isAudioMuted: 'oui',
                    isVideoEnabled: { toString: () => 'true' },
                },
            }))

            const [options] = media.createVideoElement.mock.calls[0]

            expect(options.metadata.isAudioMuted).toBe(false)
            expect(options.metadata.isVideoEnabled).toBe(false)
        })

        /**
         * `metadata.type` sert de composante de la clé `remoteStreamsMap` et du `videoId`
         * du player : une valeur forgée s'y retrouverait telle quelle. C'était l'un des
         * deux derniers `metadata.type` lus sans passer par la sanitisation centralisée.
         */
        it('ramène un type forgé au type par défaut', async () => {
            await sm.handleStreamReceived(fakeStream(), fakeConn({
                metadata: { from: 'alice', type: '../../admin', room: 'call-room-1' },
            }))

            expect(ctx.media.remoteStreamsMap.has('alice-visio')).toBe(true)
            expect(media.createVideoElement.mock.calls[0][0].metadata.currentType).toBe('visio')
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

    // ── Nettoyage par fin de pistes ─────────────────────────────────────────

    describe('fin de vie réelle d\'un flux distant', () => {

        /** Piste factice dont on peut déclencher les événements de fin. */
        const track = () => {
            const listeners = {}
            return {
                readyState: 'live',
                addEventListener: vi.fn((event, handler) => { listeners[event] = handler }),
                removeEventListener: vi.fn(),
                _emit: (event) => listeners[event]?.(),
            }
        }

        /** Flux reconnu par `instanceof` ET exposant getTracks (happy-dom ne l'implémente pas). */
        const streamWith = (tracks) => {
            const stream = Object.create(MediaStream.prototype)
            stream.getTracks = () => tracks
            return stream
        }

        it('retire l\'entrée quand les pistes du flux se terminent', async () => {
            const t = track()
            await sm.handleStreamReceived(streamWith([t]), fakeConn())
            expect(ctx.media.remoteStreamsMap.has('alice-visio')).toBe(true)

            t._emit('ended')

            expect(ctx.media.remoteStreamsMap.has('alice-visio')).toBe(false)
            expect(media.removeVideoElement).toHaveBeenCalledWith('remote-alice-visio')
        })

        it('écoute aussi `inactive`', async () => {
            const t = track()
            await sm.handleStreamReceived(streamWith([t]), fakeConn())

            t._emit('inactive')

            expect(ctx.media.remoteStreamsMap.has('alice-visio')).toBe(false)
        })

        it('ne touche pas les autres flux du même pair', async () => {
            const webcam = track()
            const screen = track()
            await sm.handleStreamReceived(streamWith([webcam]), fakeConn())
            await sm.handleStreamReceived(
                streamWith([screen]),
                fakeConn({ metadata: { from: 'alice', type: 'screen', room: 'call-room-1' } })
            )

            webcam._emit('ended')

            expect(ctx.media.remoteStreamsMap.has('alice-visio')).toBe(false)
            expect(ctx.media.remoteStreamsMap.has('alice-screen')).toBe(true)
        })

        it('idempotent : ne supprime pas une entrée déjà remplacée par un autre flux', async () => {
            const oldTrack = track()
            await sm.handleStreamReceived(streamWith([oldTrack]), fakeConn())

            // Le pair renvoie un nouveau flux sous la même clé (reconnexion).
            const replacement = streamWith([track()])
            ctx.media.remoteStreamsMap.set('alice-visio', {
                stream: replacement, remoteSlug: 'alice', remoteType: 'visio',
            })

            oldTrack._emit('ended')

            expect(ctx.media.remoteStreamsMap.get('alice-visio')?.stream).toBe(replacement)
        })

        it('tolère un flux sans getTracks (implémentation partielle)', async () => {
            // happy-dom n'expose pas getTracks : le garde doit éviter le crash.
            await expect(
                sm.handleStreamReceived(Object.create(MediaStream.prototype), fakeConn())
            ).resolves.not.toThrow()
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
