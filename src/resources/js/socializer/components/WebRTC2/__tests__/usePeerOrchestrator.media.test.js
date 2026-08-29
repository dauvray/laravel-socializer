/**
 * usePeerOrchestrator.media.test.js — flux locaux, partage d'écran et bascules
 *
 * Les sept verbes que l'orchestrateur écrit lui-même par-dessus `usePeerMedia`. Ce ne sont
 * pas des passthroughs : chacun mixe le média avec une autre couche, et c'est ce mélange
 * qui vit ici et nulle part ailleurs.
 *
 * Trois propriétés portent ce fichier :
 *
 *   1. **démarrer un flux compose la room** — sans le fan-out, un pair déjà présent ne
 *      reçoit jamais le flux qui vient de s'ouvrir ;
 *   2. **`stopWebcamStream` RELÂCHE son garde dans un `finally`** — une exception qui
 *      laisserait `shutdownCount` à 1 désactiverait le moteur de retry pour la vie du
 *      contexte, en silence (`_handleConnectionAttempt` sort par `return true`, donc
 *      ANNULE les tentatives au lieu de les différer) ;
 *   3. **l'arrêt natif du navigateur** (« Arrêter le partage ») doit produire le même
 *      nettoyage que le bouton de l'UI — c'est le seul chemin qui ne passe par aucun
 *      composant.
 *
 * Deux asymétries volontaires y sont épinglées, pas corrigées : `stopScreenCapture` ferme
 * le type `'screen'` EN DUR et garde la file de signaux (le flux webcam en a encore
 * besoin), là où `stopWebcamStream` la vide — sauf pendant un partage d'écran.
 *
 * ── Choix d'infra ─────────────────────────────────────────────────────────────
 *
 * Contexte, stores et couches RÉELS ; seul PeerJS est mocké (alias de `vitest.config.js`).
 * `installFakeMedia()` en `beforeEach` est OBLIGATOIRE : le flux du `setup.js` global est un
 * objet nu, or `connectToPeer` filtre sur `stream instanceof MediaStream` ET sur une piste
 * `readyState === 'live'` — sans lui, aucune connexion média ne s'ouvre et les cas de
 * fan-out seraient verts en ne prouvant rien. `vi.restoreAllMocks()` vidant l'implémentation
 * du `vi.fn()` global, la pose est refaite à chaque test.
 *
 * ⚠️ Le peerId d'alice est semé AVANT toute composition : `requestOrConnectPeer` prend
 * alors la branche `connectToPeer` et non `/ask-to-peer-id`, dont le limiteur est un état
 * de MODULE que ce fichier ne peut pas réinitialiser (il n'est exposé ni par la façade ni
 * par `usePeerCore`).
 *
 * ── CONTRÔLES DE HARNAIS (convention du paquet), mesurés le 2026-08-29 ────────
 *
 *    1. le fan-out de `startWebcamStream` retiré .......................... 2 cas
 *    2. le fan-out de `startAudioStream` retiré ........................... 1 cas
 *    3. le type `'screen'` du fan-out de `startScreenCapture` retiré ...... 1 cas
 *    4. l'écouteur `'ended'` de la piste d'écran retiré ................... 1 cas
 *    5. la garde `isCapturing` de cet écouteur retirée .................... 1 cas
 *    6. le `finally { endShutdown() }` de `stopWebcamStream` retiré ....... 2 cas
 *    7. `clearSignalQueue: !isCapturing` forcé à `true` ................... 1 cas
 *    8. `clearSignalQueue: false` de `stopScreenCapture` forcé à `true` ... 1 cas
 *    9. le type `'screen'` en dur remplacé par celui du contexte .......... 1 cas
 *   10. l'application de `track.enabled` de `toggleAudioState` retirée .... 2 cas
 *   11. l'application de `track.enabled` de `toggleVideoState` retirée .... 1 cas
 *   12. le corps de `stopAudioStream` vidé ............................... 1 cas
 *   13. `destUserSlugs` non transmis à `transport.sendData` .............. 1 cas
 *
 * ⚠️ **Trois de ces contrôles — 5, 9 et 13 — ont d'abord rougi ZÉRO cas, et chaque fois
 * l'erreur était dans le test, pas dans le code.** Les trois cas concernés étaient verts
 * pour une raison qui n'était pas la leur, et un seul pair / une seule connexion suffisait
 * à les rendre aveugles :
 *
 *   - n° 5 — sans une connexion webcam ouverte À CÔTÉ de celle d'écran, la première
 *     fermeture vide la room et le second passage sort par l'early-return de
 *     `closePeerConnection` : le garde n'avait rien à garder ;
 *   - n° 9 — sans connexion `stream` survivante, rien ne distingue « ferme `screen` » de
 *     « ferme le type du contexte » ;
 *   - n° 13 — avec un seul pair, un `sendData` sans destinataires diffuse à toute la room,
 *     c'est-à-dire à lui : la liste perdue reste indétectable.
 *
 * Chacun des trois cas porte désormais en commentaire la raison de son second pair ou de sa
 * seconde connexion. Les retirer « pour simplifier » remettrait le trou en place.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { withSetup } from './helpers/withSetup.js'
import { mockEventBus } from './helpers/mockEventBus.js'
import { bootLocalPeer } from './helpers/bootLocalPeer.js'
import { installFakeMedia } from './helpers/fakeMedia.js'
import { resetPeerMock } from './__mocks__/peerjs.js'
import { usePeerOrchestrator } from '~socializer/components/WebRTC2/Composables/usePeerOrchestrator.js'
import { usePeer2Store } from '~socializer/stores/peers2.js'
import { useMeStore } from '~estarter/stores/me.js'

const MY_SLUG = 'me'
const REMOTE_SLUG = 'alice'
const REMOTE_PEER_ID = 'peer-alice'
const CTX_ID = 'stream-app'

/** Rend la main jusqu'à la vidange COMPLÈTE de la file de microtâches. */
const settleTasks = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('usePeerOrchestrator — flux locaux et bascules', () => {
    let apps
    let api
    let peerStore
    let meStore
    let peerInstance

    const mount = (type = 'stream', room = 'app') => {
        const [instance, app] = withSetup(
            () => usePeerOrchestrator(type, room),
            { provides: { eventBus: mockEventBus() } }
        )
        apps.push(app)
        return instance
    }

    const initialize = async () => {
        peerInstance = await bootLocalPeer(
            () => api.initializePeerConnection({}),
            { peerId: 'my-peer-id' }
        )
    }

    /** Alice est membre observé de la room et son peerId est connu. */
    const seedRemote = () => {
        peerStore.setRoomMembers(CTX_ID, [REMOTE_SLUG])
        peerStore.addRemotePeerId(REMOTE_SLUG, REMOTE_PEER_ID)
    }

    /** Les métadonnées des `peer.call()` émis, dans l'ordre. */
    const emittedCallTypes = () =>
        peerInstance.call.mock.calls.map(([, , options]) => options?.metadata?.type)

    beforeEach(async () => {
        apps = []
        resetPeerMock()
        installFakeMedia()

        peerStore = usePeer2Store()
        meStore = useMeStore()
        meStore.user = { slug: MY_SLUG, name: 'Me' }
        peerStore.lastLocalPeerId = 'my-peer-id'

        vi.spyOn(console, 'log').mockImplementation(() => {})
        vi.spyOn(console, 'info').mockImplementation(() => {})
        vi.spyOn(console, 'debug').mockImplementation(() => {})
        vi.spyOn(console, 'warn').mockImplementation(() => {})

        api = mount()
        await initialize()
    })

    afterEach(() => {
        apps.forEach((app) => { try { app.unmount() } catch { /* déjà démontée */ } })
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    // ── Démarrage des flux : le fan-out ───────────────────────────────────────

    describe('démarrage des flux', () => {
        it('la webcam ouvre le flux local puis compose chaque membre de la room', async () => {
            seedRemote()

            await api.startWebcamStream()
            await settleTasks()

            expect(api.isStreaming.value).toBe(true)
            expect(emittedCallTypes()).toEqual(['stream'])
            expect(peerInstance.call).toHaveBeenCalledWith(
                REMOTE_PEER_ID,
                api.currentStream.value,
                expect.anything()
            )
        })

        it('le flux audio compose la room de la même façon', async () => {
            seedRemote()

            await api.startAudioStream()
            await settleTasks()

            expect(api.isAudioStream.value).toBe(true)
            expect(emittedCallTypes()).toEqual(['stream'])
        })

        it('le partage d\'écran compose avec le type `screen`, pas celui du contexte', async () => {
            seedRemote()

            await api.startScreenCapture()
            await settleTasks()

            expect(api.isCapturing.value).toBe(true)
            expect(emittedCallTypes()).toEqual(['screen'])
        })

        it('ne compose personne quand la room est vide', async () => {
            await api.startWebcamStream()
            await settleTasks()

            expect(api.isStreaming.value).toBe(true)
            expect(peerInstance.call).not.toHaveBeenCalled()
        })
    })

    // ── Arrêt natif du partage d'écran ────────────────────────────────────────

    describe('arrêt natif du partage d\'écran', () => {
        /** La piste vidéo de l'écran, celle qui porte l'événement `ended` du navigateur. */
        const screenVideoTrack = () => api.screenStream.value.getVideoTracks()[0]

        it('⭐ « Arrêter le partage » du navigateur produit le même nettoyage que le bouton', async () => {
            // Le seul chemin d'arrêt qui ne passe par aucun composant : sans cet écouteur,
            // l'UI reste persuadée qu'on partage, et la connexion `screen` reste ouverte.
            await api.startScreenCapture()
            const track = screenVideoTrack()

            track._emit('ended')

            expect(api.isCapturing.value).toBe(false)
            expect(api.screenStream.value).toBeNull()
            expect(track.stop).toHaveBeenCalledTimes(1)
        })

        it('⭐ un `ended` reçu APRÈS un arrêt manuel ne reboucle pas', async () => {
            // Garde `isCapturing` : le bouton de l'UI a déjà tout nettoyé, l'événement natif
            // arrive derrière.
            //
            // ⚠️ **Ce cas exige une connexion webcam ouverte À CÔTÉ de celle d'écran**, et ce
            // n'est pas décoratif : sans elle, la première fermeture vide la room, le second
            // passage sort par l'early-return de `closePeerConnection` et le cas resterait
            // VERT même sans le garde (mesuré — cf. contrôle n° 5 de l'en-tête). C'est la
            // connexion `stream` survivante qui garde la room en vie et rend le second
            // passage observable.
            seedRemote()
            await api.startWebcamStream()
            await api.startScreenCapture()
            await settleTasks()
            const track = screenVideoTrack()
            const closeSpy = vi.spyOn(peerStore, 'closePeerConnection')

            api.stopScreenCapture()
            expect(closeSpy).toHaveBeenCalledTimes(1)
            expect(track.stop).toHaveBeenCalledTimes(1)

            track._emit('ended')

            expect(closeSpy).toHaveBeenCalledTimes(1)
            expect(track.stop).toHaveBeenCalledTimes(1)
        })
    })

    // ── Arrêt des flux ────────────────────────────────────────────────────────

    describe('arrêt des flux', () => {
        /** Sème un signal dans la file de CE contexte et confirme qu'il y est. */
        const seedSignalQueue = () => {
            peerStore.dispatchSignal({ roomId: CTX_ID, type: 'PEER_CONNECTION_REQUEST', payload: {} })
            expect(peerStore.getQueueForRoom(CTX_ID)).not.toBeNull()
        }

        it('la webcam s\'arrête et remet l\'état d\'UI à son repos', async () => {
            await api.startWebcamStream()
            api.setCurrentCallRoomId('call-42')
            api.toggleAudioState()
            api.toggleVideoState()

            api.stopWebcamStream()

            expect(api.isStreaming.value).toBe(false)
            expect(api.currentStream.value).toBeNull()
            expect(api.currentCallRoomId.value).toBeNull()
            expect(api.isVideoEnabled.value).toBe(true)
            expect(api.isMuted.value).toBe(false)
        })

        it('⭐ le garde de teardown est RENDU en sortie', async () => {
            await api.startWebcamStream()

            api.stopWebcamStream()

            expect(api.isShuttingDown.value).toBe(false)
        })

        it('⭐ …et il l\'est même quand une étape LÈVE', async () => {
            // Sans le `try/finally`, `shutdownCount` resterait à 1 pour la vie du contexte :
            // le moteur de retry sortirait alors par `return true`, ce qui ANNULE les
            // tentatives au lieu de les différer. Panne silencieuse, sans une seule erreur.
            await api.startWebcamStream()
            vi.spyOn(peerStore, 'clearSignalQueueRoom').mockImplementation(() => {
                throw new Error('panne pendant la fermeture')
            })

            expect(() => api.stopWebcamStream()).toThrow('panne pendant la fermeture')

            expect(api.isShuttingDown.value).toBe(false)
        })

        it('vide la file de signaux quand on ne partage pas l\'écran', async () => {
            await api.startWebcamStream()
            seedSignalQueue()

            api.stopWebcamStream()

            expect(peerStore.getQueueForRoom(CTX_ID)).toBeNull()
        })

        it('⭐ mais la GARDE pendant un partage d\'écran', async () => {
            // Symétrique de `stopScreenCapture` : couper la webcam pendant un partage ne
            // doit pas vider la file dont la connexion d'écran a encore besoin — elle n'est
            // ouverte que par le moteur de retry.
            await api.startWebcamStream()
            await api.startScreenCapture()
            seedSignalQueue()

            api.stopWebcamStream()

            expect(peerStore.getQueueForRoom(CTX_ID)).not.toBeNull()
        })

        it('l\'arrêt du flux audio est celui de la webcam', async () => {
            await api.startAudioStream()

            api.stopAudioStream()

            expect(api.isStreaming.value).toBe(false)
            expect(api.isAudioStream.value).toBe(false)
            expect(api.currentStream.value).toBeNull()
        })

        it('⭐ `stopScreenCapture` ne ferme QUE `screen`, et garde la file de signaux', async () => {
            // Le type est écrit en dur, jamais lu sur le contexte : le lire fermerait la
            // connexion `stream` de la webcam, qui n'a rien demandé. Et la file reste — le
            // flux webcam actif en a encore besoin.
            seedRemote()
            await api.startWebcamStream()
            await api.startScreenCapture()
            await settleTasks()
            seedSignalQueue()
            expect(Object.keys(peerStore.getConnections.app[REMOTE_SLUG])).toEqual(
                expect.arrayContaining(['stream', 'screen'])
            )

            api.stopScreenCapture()

            expect(api.isCapturing.value).toBe(false)
            expect(api.isStreaming.value).toBe(true)
            expect(Object.keys(peerStore.getConnections.app[REMOTE_SLUG])).toEqual(['stream'])
            expect(peerStore.getQueueForRoom(CTX_ID)).not.toBeNull()
        })
    })

    // ── Bascules ──────────────────────────────────────────────────────────────

    describe('bascules audio et vidéo', () => {
        it('couper le micro bascule le drapeau ET les pistes audio', async () => {
            await api.startWebcamStream()
            const [audio] = api.currentStream.value.getAudioTracks()

            api.toggleAudioState()

            expect(api.isMuted.value).toBe(true)
            expect(audio.enabled).toBe(false)

            api.toggleAudioState()

            expect(api.isMuted.value).toBe(false)
            expect(audio.enabled).toBe(true)
        })

        it('couper la caméra bascule le drapeau ET les pistes vidéo, dans le sens direct', async () => {
            await api.startWebcamStream()
            const [video] = api.currentStream.value.getVideoTracks()

            api.toggleVideoState()

            expect(api.isVideoEnabled.value).toBe(false)
            expect(video.enabled).toBe(false)

            api.toggleVideoState()

            expect(api.isVideoEnabled.value).toBe(true)
            expect(video.enabled).toBe(true)
        })

        it('une bascule ne touche QUE les pistes de son propre média', async () => {
            await api.startWebcamStream()
            const [audio] = api.currentStream.value.getAudioTracks()
            const [video] = api.currentStream.value.getVideoTracks()

            api.toggleAudioState()

            expect(audio.enabled).toBe(false)
            expect(video.enabled).toBe(true)
        })

        it('les bascules ne lèvent pas sans flux courant', () => {
            expect(api.currentStream.value).toBeNull()

            expect(() => api.toggleAudioState()).not.toThrow()
            expect(() => api.toggleVideoState()).not.toThrow()

            expect(api.isMuted.value).toBe(true)
            expect(api.isVideoEnabled.value).toBe(false)
        })
    })

    // ── Envoi de données ──────────────────────────────────────────────────────

    it('sendDataToPeer transmet le payload ET ses destinataires au transport', async () => {
        // ⚠️ **Deux pairs sont indispensables** : avec un seul, un `sendData(data)` sans
        // destinataires diffuse à toute la room — c'est-à-dire à lui — et le cas resterait
        // vert alors que la liste aurait été perdue (mesuré, contrôle n° 13).
        peerStore.setRoomMembers(CTX_ID, [REMOTE_SLUG, 'bob'])
        peerStore.addRemotePeerId(REMOTE_SLUG, REMOTE_PEER_ID)
        peerStore.addRemotePeerId('bob', 'peer-bob')

        await api.startWebcamStream()
        await settleTasks()

        const [versAlice, versBob] = peerInstance.connect.mock.results.map((r) => r.value)
        ;[versAlice, versBob].forEach((conn) => {
            conn.open = true
            conn.chunker = {}
        })

        api.sendDataToPeer({ message: 'coucou' }, [REMOTE_SLUG])

        expect(versAlice.send).toHaveBeenCalledWith({ message: 'coucou' })
        expect(versBob.send).not.toHaveBeenCalled()
    })
})
