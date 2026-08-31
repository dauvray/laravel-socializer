/**
 * usePeerMedia.streams.test.js
 *
 * Couvre la partie « flux » de usePeerMedia (cf. TODOLIST P2 — Tests unitaires) :
 * acquisition/arrêt des MediaStream locaux et nettoyage lié à la fin de vie d'un flux.
 * Le pool d'instances de players est couvert séparément dans usePeerMedia.players.test.js.
 *
 * ⚠️ `_bindStreamCleanup` filtre sur `stream instanceof MediaStream`, or le flux factice
 * de __tests__/setup.js est un objet nu. On construit donc ici de VRAIES instances
 * `MediaStream` (happy-dom en expose la classe) dont on surcharge `getTracks()` :
 * `MediaStreamTrack` a un constructeur illégal, impossible d'en instancier.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { usePeerMedia } from '~socializer/components/WebRTC2/Composables/usePeerMedia.js'
import { createMockContext } from './helpers/createMockContext.js'

// Stub léger du player : ces tests ne portent pas sur le rendu, et le vrai composant
// tire les directives v-resize / v-draggable.
vi.mock('~socializer/components/WebRTC2/Widgets/Mediaplayer/MediaBroadcastPlayer.vue', async () => {
    const { h } = await import('vue')
    return {
        default: {
            name: 'MediaBroadcastPlayerStub',
            props: ['streamData', 'videoId', 'nickname', 'type', 'peer', 'roomId', 'resizable', 'draggable'],
            setup: (props) => () => h('div', props.videoId ?? ''),
        },
    }
})

/** Piste factice : expose ce que lit le code (stop, readyState) + un vrai registre de listeners. */
const fakeTrack = (kind = 'video') => {
    const listeners = {}
    return {
        kind,
        readyState: 'live',
        stop: vi.fn(),
        addEventListener: vi.fn((event, handler) => { listeners[event] = handler }),
        removeEventListener: vi.fn(),
        _emit: (event) => listeners[event]?.(),
        _has: (event) => typeof listeners[event] === 'function',
    }
}

/** Vraie instance MediaStream (pour passer `instanceof`) dont on pilote les pistes. */
const realStream = (tracks = [fakeTrack()]) => {
    const stream = new MediaStream()
    stream.getTracks = () => tracks
    return stream
}

describe('usePeerMedia — flux locaux', () => {
    let ctx
    let media

    beforeEach(() => {
        // setup.js installe des vi.fn() globaux qui ne sont pas réinitialisés entre les
        // tests (pas de `clearMocks` dans vitest.config.js) : on repart d'un flux neuf.
        navigator.mediaDevices.getUserMedia.mockReset().mockResolvedValue(realStream())
        navigator.mediaDevices.getDisplayMedia.mockReset().mockResolvedValue(realStream())

        document.body.innerHTML = '<div id="videoContainer"></div>'
        ctx = createMockContext({ session: { currentType: 'visio', currentRoom: 'room-1' } })
        media = usePeerMedia(ctx)
    })

    afterEach(() => {
        document.body.innerHTML = ''
    })

    // ── startCurrentStream ────────────────────────────────────────────────────
    describe('startCurrentStream', () => {
        it('demande les contraintes dérivées de streamStates (webcam + micro par défaut)', async () => {
            await media.startCurrentStream()

            expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
                video: true,
                audio: true,
            })
        })

        it('répercute isVideoEnabled/isMuted dans les contraintes', async () => {
            ctx.ui.streamStates.isVideoEnabled = false
            ctx.ui.streamStates.isMuted = true

            await media.startCurrentStream()

            expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
                video: false,
                audio: false,
            })
        })

        /**
         * ── CONTRÔLES DE HARNAIS du veto vocal, mesurés le 2026-08-31 ─────────────
         * Référence relue verte : 22 cas ici, 89 dans `useCallManager.test.js`.
         * La seconde colonne est ce fichier-là.
         *
         *    le veto vocal de `startCurrentStream` retiré ...................... 1 · 0
         *    le type non transmis par `_enterCallSession` (retour au littéral) .. 0 · 3
         *    le veto rendu ABSOLU (il écraserait un `isVideoEnabled` à false) ... 2 · —
         *
         * ⭐ **Un 0 croisé parfait : la correction a deux moitiés, et chaque fichier n'en voit
         * qu'une.** Retirer le veto ici ne rougit aucun cas de l'appelant ; faire repasser
         * l'appelant au littéral `true` ne rougit aucun cas ici. Corriger une seule des deux
         * aurait laissé la caméra s'allumer, suite verte à l'appui.
         */
        it('⭐ un appel VOCAL ne demande pas la caméra', async () => {
            // Le défaut vécu, trouvé en cadrant le lot F : `_enterCallSession` appelait
            // `startCurrentStream(true)` alors que la fonction ne prenait AUCUN paramètre.
            // L'argument était donc ignoré, et les contraintes lisaient `isVideoEnabled`, vrai
            // par défaut (`createPeerContext.js:153`). Un appel « vocal » capturait donc une
            // piste vidéo — et la transmettait, `peer.call` passant le flux tel quel.
            // La caméra s'allumait sur un appel où l'utilisateur ne l'avait pas demandée.
            await media.startCurrentStream('vocal')

            expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
                video: false,
                audio: true,
            })
        })

        it('un appel visio la demande, et respecte quand même isVideoEnabled', async () => {
            // Le type ne PRIME pas sur le réglage : `vocal` interdit la vidéo, `visio` ne
            // l'impose pas. Sans la seconde moitié de ce cas, un `video: type !== 'vocal'` seul
            // resterait vert — et rallumerait la caméra d'un utilisateur qui l'a coupée.
            await media.startCurrentStream('visio')
            expect(navigator.mediaDevices.getUserMedia).toHaveBeenLastCalledWith({
                video: true,
                audio: true,
            })

            ctx.ui.streamStates.isVideoEnabled = false
            await media.startCurrentStream('visio')
            expect(navigator.mediaDevices.getUserMedia).toHaveBeenLastCalledWith({
                video: false,
                audio: true,
            })
        })

        it('appelée sans type — le chemin de la DIFFUSION — garde son comportement', async () => {
            // `usePeerOrchestrator.js:250` l'appelle nue, hors appel : là, aucun type d'appel
            // n'a de sens et les contraintes restent celles des réglages seuls.
            await media.startCurrentStream()

            expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
                video: true,
                audio: true,
            })
        })

        it('publie le flux dans le contexte, lève isStreaming et le retourne', async () => {
            const returned = await media.startCurrentStream()

            expect(ctx.media.currentStream).toBe(returned)
            expect(ctx.media.isStreaming).toBe(true)
        })

        it('stocke le flux tel quel (markRaw) — pas de proxy réactif sur un MediaStream', async () => {
            const stream = realStream()
            navigator.mediaDevices.getUserMedia.mockResolvedValue(stream)

            await media.startCurrentStream()

            // Sans markRaw, l'affectation dans le `reactive` media renverrait un proxy
            // à la lecture, donc une identité différente.
            expect(ctx.media.currentStream).toBe(stream)
        })
    })

    // ── stopCurrentStream ─────────────────────────────────────────────────────
    describe('stopCurrentStream', () => {
        it('arrête chaque piste du flux courant', async () => {
            const tracks = [fakeTrack('video'), fakeTrack('audio')]
            navigator.mediaDevices.getUserMedia.mockResolvedValue(realStream(tracks))
            await media.startCurrentStream()

            media.stopCurrentStream()

            tracks.forEach((track) => expect(track.stop).toHaveBeenCalledTimes(1))
        })

        it('réinitialise currentStream, isStreaming et isAudioStream', async () => {
            await media.startAudioStream()
            expect(ctx.media.isAudioStream).toBe(true)

            media.stopCurrentStream()

            expect(ctx.media.currentStream).toBeNull()
            expect(ctx.media.isStreaming).toBe(false)
            expect(ctx.media.isAudioStream).toBe(false)
        })

        it('ne jette pas quand aucun flux n\'est actif', () => {
            expect(() => media.stopCurrentStream()).not.toThrow()
            expect(ctx.media.currentStream).toBeNull()
        })
    })

    // ── startAudioStream ──────────────────────────────────────────────────────
    describe('startAudioStream', () => {
        it('demande l\'audio seul', async () => {
            await media.startAudioStream()

            expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
                video: false,
                audio: true,
            })
        })

        it('marque le flux comme audio et aligne l\'UI (vidéo coupée, micro marqué muet)', async () => {
            const returned = await media.startAudioStream()

            expect(ctx.media.currentStream).toBe(returned)
            expect(ctx.media.isStreaming).toBe(true)
            expect(ctx.media.isAudioStream).toBe(true)
            expect(ctx.ui.streamStates.isVideoEnabled).toBe(false)
            expect(ctx.ui.streamStates.isMuted).toBe(true)
        })
    })

    // ── startScreenCapture / stopScreenCapture ────────────────────────────────
    describe('startScreenCapture', () => {
        it('capture l\'écran sans l\'audio système par défaut', async () => {
            await media.startScreenCapture()

            expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalledWith({
                video: true,
                audio: false,
            })
        })

        it('inclut l\'audio système quand il est demandé', async () => {
            await media.startScreenCapture(true)

            expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalledWith({
                video: true,
                audio: true,
            })
        })

        it('publie le flux dans screenStream (et pas dans currentStream) et lève isCapturing', async () => {
            const returned = await media.startScreenCapture()

            expect(ctx.media.screenStream).toBe(returned)
            expect(ctx.media.isCapturing).toBe(true)
            // Le partage d'écran est un flux distinct : il ne doit pas écraser la webcam.
            expect(ctx.media.currentStream).toBeNull()
        })
    })

    describe('stopScreenCapture', () => {
        it('arrête les pistes et réinitialise l\'état de capture', async () => {
            const tracks = [fakeTrack('video')]
            navigator.mediaDevices.getDisplayMedia.mockResolvedValue(realStream(tracks))
            await media.startScreenCapture()

            media.stopScreenCapture()

            expect(tracks[0].stop).toHaveBeenCalledTimes(1)
            expect(ctx.media.screenStream).toBeNull()
            expect(ctx.media.isCapturing).toBe(false)
        })

        it('ne jette pas quand aucune capture n\'est active', () => {
            expect(() => media.stopScreenCapture()).not.toThrow()
        })
    })

    // ── _bindStreamCleanup / _unbindStreamCleanup ─────────────────────────────
    describe('nettoyage lié à la fin de vie d\'un flux', () => {
        it('la fin d\'une piste (`ended`) retire le player correspondant', async () => {
            const track = fakeTrack()
            await media.createVideoElement({ videoId: 'remote-alice' }, realStream([track]))
            expect(ctx.peerStore.getPlayers).toHaveLength(1)

            track._emit('ended')

            expect(ctx.peerStore.getPlayers).toHaveLength(0)
            expect(ctx.peerStore.removePlayer).toHaveBeenCalledWith('remote-alice')
        })

        it('écoute aussi `inactive`', async () => {
            const track = fakeTrack()
            await media.createVideoElement({ videoId: 'remote-bob' }, realStream([track]))

            expect(track._has('ended')).toBe(true)
            expect(track._has('inactive')).toBe(true)
        })

        it('n\'installe pas deux fois les écouteurs pour un même videoId', async () => {
            const track = fakeTrack()
            const stream = realStream([track])

            await media.createVideoElement({ videoId: 'remote-carol' }, stream)
            await media.createVideoElement({ videoId: 'remote-carol' }, stream)

            // Une inscription par type d'événement, pas deux.
            expect(track.addEventListener).toHaveBeenCalledTimes(2)
        })

        it('retire les écouteurs au retrait du player', async () => {
            const track = fakeTrack()
            await media.createVideoElement({ videoId: 'remote-dave' }, realStream([track]))

            media.removeVideoElement('remote-dave')

            expect(track.removeEventListener).toHaveBeenCalledWith('ended', expect.any(Function))
            expect(track.removeEventListener).toHaveBeenCalledWith('inactive', expect.any(Function))
        })

        it('n\'installe aucun écouteur si la valeur passée n\'est pas un MediaStream', async () => {
            // Cas réel : le flux factice « objet nu » — le garde `instanceof` doit le rejeter
            // sans empêcher la création du player.
            const track = fakeTrack()
            const notAStream = { getTracks: () => [track] }

            await media.createVideoElement({ videoId: 'remote-eve' }, notAStream)

            expect(track.addEventListener).not.toHaveBeenCalled()
            expect(ctx.peerStore.getPlayers).toHaveLength(1)
        })
    })
})
