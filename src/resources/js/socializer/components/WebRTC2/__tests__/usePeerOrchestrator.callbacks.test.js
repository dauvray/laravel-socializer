/**
 * usePeerOrchestrator.callbacks.test.js — le wrapping des callbacks de connexion
 *
 * `initializePeerConnection` est le seul endroit du module où les couches se mixent : il
 * emballe les callbacks fournis par la feature (`useMediaBroadcast`) avant de les confier
 * au contexte. Trois wraps y sont posés, et chacun peut casser **sans qu'aucun test
 * unitaire ne bronche** — les couches emballées, elles, sont vertes :
 *
 *   1. `onStreamReceived` — le suivi interne (`remoteStreamsMap`) est chaîné AVANT le
 *      callback applicatif, et **attendu**. Sans le `await`, l'app est réveillée sur un
 *      registre encore vide ;
 *   2. `onConnectionClose` — posé **uniquement** en `type === 'stream'`, et gardé : une
 *      fermeture de MA connexion sortante ne doit rien purger, le distant pouvant encore
 *      diffuser par la connexion inverse ;
 *   3. le stockage lui-même — `storeConnectionEventCallbacks` est **write-once par clé**,
 *      donc une seconde initialisation sur le même contexte est silencieusement ignorée.
 *
 * Le wrap `onDataReceived` et celui d'`onConnectionOpen` sont couverts par
 * `usePeerOrchestrator.broadcastPresence.test.js`. ⏸️ Le cas star de `onDataReceived`
 * (enveloppe `__starRoute` retransmise par le hub) est **délibérément absent** : c'est le
 * seul cas de la tâche 6 que le déplacement du routage star vers `usePeerTransport`
 * réécrira — cf. `work/webrtc2-todo.md`.
 *
 * ── Choix d'infra ─────────────────────────────────────────────────────────────
 *
 * Contexte, stores et couches RÉELS ; seul PeerJS est mocké (par l'alias de
 * `vitest.config.js`). Les dix sous-modules sont des imports ESM statiques appelés dans le
 * corps du composable — les doubler demanderait dix `vi.mock` et ne testerait plus que des
 * espions. Même arbitrage que `createPeerContext.test.js` et que le sibling
 * `broadcastPresence`, contre ce que le plan de tests annonçait.
 *
 * L'autorisation des connexions entrantes passe par le chemin (b) de
 * `_isAuthorizedIncomingPeer` — mapping peerId concordant — pour ne pas avoir à peupler
 * `remotePeers`, dont la synchronisation déclencherait de vraies requêtes.
 *
 * ⚠️ En mode isolé, `peer.connect()` / `peer.call()` du mock rendent une connexion aux
 * métadonnées PAR DÉFAUT, pas celles de l'appelant. Le seul cas qui a besoin d'une
 * connexion SORTANTE réaliste les re-stube — recette documentée dans
 * `docs/modules/webrtc2/tests.md`.
 *
 * ── Ce qui n'est PAS couvert, et pourquoi (mesuré le 2026-08-29) ──────────────
 *
 * Le prédicat du wrap de fermeture est `!mySlug || !senderSlug || senderSlug !== mySlug`.
 * Ses **deux premières branches sont inatteignables**, et deux cas écrits pour elles ont
 * été retirés plutôt que contorsionnés :
 *
 *   - `!senderSlug` — une connexion entrante sans `metadata.from` est refusée en amont par
 *     `_isAuthorizedIncomingPeer` (« format de slug invalide ») : ses listeners ne sont
 *     jamais branchés, le wrap ne la voit donc jamais ;
 *   - `!mySlug` — sans identité locale, `handleStreamRemoved` suspend sur
 *     `waitForMeReady`, qui lit `meStore.getMe?.slug` et n'aboutit qu'au timeout de 15 s.
 *     Le repli mène à un verbe que l'absence d'identité bloque de toute façon.
 *
 * Ce sont des gardes défensifs, pas des chemins. Les écrire aurait demandé de casser
 * `meStore` en vol — un test du harnais, pas du code.
 *
 * ── CONTRÔLES DE HARNAIS (convention du paquet), mesurés le 2026-08-29 ────────
 *
 *   1. le `await` retiré du wrap `onStreamReceived` ......................... 1 cas
 *   2. le wrap `onStreamReceived` entier retiré ............................. 5 cas
 *   3. le prédicat `senderSlug !== mySlug` du wrap de fermeture désarmé ..... 1 cas
 *   4. la condition `if (type === 'stream')` rendue inconditionnelle ........ 2 cas
 *   5. la garde `if (!eventEntry.isActive)` de `storeConnectionEventCallbacks`
 *      retirée ............................................................. 1 cas
 *
 * ℹ️ Le point 1 ne rougit qu'un cas, et c'est exactement ce qu'on veut : sans le `await`,
 * le suivi finit par avoir lieu une microtâche plus tard, donc les autres cas survivent.
 * C'est l'ORDRE que le point 1 épingle, pas le branchement — le point 2 s'en charge. Deux
 * lignes, deux contrôles, aucun ne couvre l'autre. Le point 2 laisse `préserve l'arité`
 * vert, et c'est juste : sans wrap, le callback nu reçoit la même arité par
 * `setUpConnectionListeners`.
 *
 * ⚠️ **Le point 4 a d'abord rougi ZÉRO cas, et l'erreur était dans les tests.** Les deux
 * cas « le wrap n'est pas posé » semaient un flux de type `visio` sur une connexion de
 * type `data` : `handleRemoteDeparture` n'emporte que le type qui se ferme, donc ils
 * restaient verts **même avec le wrap posé**. Aligner le type du flux semé sur celui de la
 * connexion les rend sensibles. Sans ce contrôle, deux cas auraient prouvé le contraire de
 * ce qu'ils annonçaient.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { withSetup } from './helpers/withSetup.js'
import { mockEventBus } from './helpers/mockEventBus.js'
import { bootLocalPeer } from './helpers/bootLocalPeer.js'
import { realStream, fakeTrack } from './helpers/fakeMedia.js'
import {
    resetPeerMock,
    getPeerConstructionCount,
    createMockDataConnection,
    createMockMediaConnection,
} from './__mocks__/peerjs.js'
import { usePeerOrchestrator } from '~socializer/components/WebRTC2/Composables/usePeerOrchestrator.js'
import { usePeer2Store } from '~socializer/stores/peers2.js'
import { useMeStore } from '~estarter/stores/me.js'

const MY_SLUG = 'me'
const REMOTE_SLUG = 'alice'
const REMOTE_PEER_ID = 'peer-alice'

/** Rend la main jusqu'à la vidange COMPLÈTE de la file de microtâches. */
const settleTasks = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('usePeerOrchestrator — wraps de callbacks', () => {
    let apps
    let api
    let peerStore
    let meStore
    let peerInstance

    /** Monte un orchestrateur et retient son app pour le démontage. */
    const mount = (type = 'stream', room = 'app') => {
        const [instance, app] = withSetup(
            () => usePeerOrchestrator(type, room),
            { provides: { eventBus: mockEventBus() } }
        )
        apps.push(app)
        api = instance
        return instance
    }

    const initialize = async (callbacks = {}) => {
        peerInstance = await bootLocalPeer(
            () => api.initializePeerConnection(callbacks),
            { peerId: 'my-peer-id' }
        )
    }

    /**
     * Fait entrer une connexion d'`alice` par le dispatcher du transport et rend la
     * connexion, ses listeners branchés.
     *
     * @param {'data'|'call'} channel  `connection` (data) ou `call` (média)
     */
    const acceptIncoming = async (channel = 'data', metadataOverrides = {}) => {
        peerStore.addRemotePeerId(REMOTE_SLUG, REMOTE_PEER_ID)

        const metadata = {
            type: api.currentType.value,
            room: 'app',
            callbackKey: api.contextId,
            from: REMOTE_SLUG,
            slug: MY_SLUG,
            ...metadataOverrides,
        }

        const conn = channel === 'call'
            ? createMockMediaConnection(metadata)
            : createMockDataConnection(metadata)
        conn.peer = REMOTE_PEER_ID

        peerInstance._triggerEvent(channel === 'call' ? 'call' : 'connection', conn)
        // Le dispatcher entrant est `async` : ses gardes d'admission peuvent rendre une
        // promesse, et `setUpConnectionListeners` n'est appelé qu'après.
        await settleTasks()

        return conn
    }

    beforeEach(() => {
        apps = []
        resetPeerMock()

        // Le player n'est monté que hors contexte `stream` — un seul cas ici, mais son
        // hôte est réel : sans container, `createVideoElement` rejette hors de toute
        // chaîne `await` (rejet non traité).
        document.body.innerHTML = '<div id="videoContainer"></div>'

        peerStore = usePeer2Store()
        meStore = useMeStore()
        meStore.user = { slug: MY_SLUG, name: 'Me' }
        peerStore.lastLocalPeerId = 'my-peer-id'

        // Le transport et le contexte journalisent abondamment sur ces chemins (admission,
        // fermeture) : on ne veut ni le bruit ni asserter dessus.
        vi.spyOn(console, 'log').mockImplementation(() => {})
        vi.spyOn(console, 'info').mockImplementation(() => {})
        vi.spyOn(console, 'debug').mockImplementation(() => {})
        vi.spyOn(console, 'warn').mockImplementation(() => {})

        // ⚠️ `console.error` est espionné SANS être muselé : `handleRemoteDeparture` avale
        // ses exceptions, donc un nettoyage qui lève laisserait ces tests verts. Le laisser
        // écrire garde la trace visible, l'espionner la rend assertable (piège documenté
        // dans `docs/modules/webrtc2/tests.md`).
        vi.spyOn(console, 'error')
    })

    afterEach(() => {
        apps.forEach((app) => { try { app.unmount() } catch { /* déjà démontée */ } })
        document.body.innerHTML = ''
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    // ── Stockage des callbacks ────────────────────────────────────────────────

    describe('stockage des callbacks', () => {
        it('réclame le Peer local en fin d\'initialisation', async () => {
            mount()
            await initialize({})

            expect(getPeerConstructionCount()).toBe(1)
        })

        it('stocke les callbacks WRAPPÉS, jamais les originaux', async () => {
            // Preuve par l'effet de bord du wrap : le suivi interne a lieu alors que le
            // callback applicatif, lui, ne sait rien de `remoteStreamsMap`.
            mount()
            const onStreamReceived = vi.fn()
            await initialize({ onStreamReceived })

            const call = await acceptIncoming('call')
            call._triggerEvent('stream', realStream())
            await settleTasks()

            expect(onStreamReceived).toHaveBeenCalledTimes(1)
            expect(api.remoteStreams.value).toHaveLength(1)
        })

        it('stocke `onConnectionError` tel quel — il n\'est jamais wrappé', async () => {
            mount()
            const onConnectionError = vi.fn()
            await initialize({ onConnectionError })

            const conn = await acceptIncoming('data')
            const boom = new Error('négociation échouée')
            conn._triggerEvent('error', boom)

            expect(onConnectionError).toHaveBeenCalledWith(boom)
        })

        it('⭐ une seconde initialisation garde SILENCIEUSEMENT les premiers callbacks', async () => {
            // `storeConnectionEventCallbacks` est write-once par clé. Un provider remonté
            // sur le même contexte croit rebrancher son app et parle en fait à l'ancienne.
            mount()
            const premier = vi.fn()
            const second = vi.fn()
            await initialize({ onDataReceived: premier })

            api.initializePeerConnection({ onDataReceived: second })

            const conn = await acceptIncoming('data')
            conn._triggerEvent('data', { message: 'coucou' })

            expect(premier).toHaveBeenCalledTimes(1)
            expect(second).not.toHaveBeenCalled()
        })
    })

    // ── Wrap onStreamReceived ─────────────────────────────────────────────────

    describe('wrap onStreamReceived', () => {
        it('⭐ le suivi interne est chaîné AVANT le callback applicatif, et attendu', async () => {
            // Sans le `await`, `handleStreamReceived` suspend sur `waitForMeReady` et le
            // callback applicatif est réveillé sur un registre encore VIDE. C'est l'ordre
            // que ce cas épingle, pas le branchement (cf. contrôle n° 1 de l'en-tête).
            mount()
            let vuAuMomentDuCallback = null
            const onStreamReceived = vi.fn(() => {
                vuAuMomentDuCallback = api.remoteStreams.value.length
            })
            await initialize({ onStreamReceived })

            const call = await acceptIncoming('call')
            call._triggerEvent('stream', realStream())
            await settleTasks()

            expect(vuAuMomentDuCallback).toBe(1)
        })

        it('préserve l\'arité : flux, connexion et métadonnées', async () => {
            mount()
            const onStreamReceived = vi.fn()
            await initialize({ onStreamReceived })

            const call = await acceptIncoming('call')
            const stream = realStream()
            call._triggerEvent('stream', stream)
            await settleTasks()

            expect(onStreamReceived).toHaveBeenCalledWith(stream, call, call.metadata)
        })

        it('suit le flux même sans callback applicatif', async () => {
            // Le wrap est TOUJOURS posé : une app qui ne consomme pas les flux ne doit pas
            // priver l'UI de `remoteStreams`, qu'elle lit par le slot.
            mount()
            await initialize({})

            const call = await acceptIncoming('call')
            call._triggerEvent('stream', realStream())
            await settleTasks()

            expect(api.remoteStreams.value).toHaveLength(1)
        })
    })

    // ── Wrap onConnectionClose (type 'stream' uniquement) ─────────────────────

    describe('wrap onConnectionClose', () => {
        /** Fait recevoir un flux d'alice et rend la connexion média entrante. */
        const receiveRemoteStream = async (callbacks = {}) => {
            await initialize(callbacks)
            const call = await acceptIncoming('call')
            call._triggerEvent('stream', realStream())
            await settleTasks()
            expect(api.remoteStreams.value).toHaveLength(1)
            return call
        }

        it('purge le flux quand la connexion ENTRANTE du distant se ferme', async () => {
            mount('stream', 'app')
            const onConnectionClose = vi.fn()
            const call = await receiveRemoteStream({ onConnectionClose })

            call._triggerEvent('close')
            await settleTasks()

            expect(api.remoteStreams.value).toHaveLength(0)
            expect(onConnectionClose).toHaveBeenCalledWith(call)
            expect(console.error).not.toHaveBeenCalled()
        })

        it('⭐ ne purge RIEN quand c\'est ma connexion sortante qui se ferme', async () => {
            // Le distant peut encore diffuser par la connexion inverse (PC-2) : retirer son
            // flux ici noircirait sa vignette alors qu'il émet toujours.
            mount('stream', 'app')
            const onConnectionClose = vi.fn()
            await receiveRemoteStream({ onConnectionClose })

            const sortante = await openOutgoingConnection()
            sortante._triggerEvent('close')
            await settleTasks()

            expect(api.remoteStreams.value).toHaveLength(1)
            // …et le callback applicatif, lui, est bien appelé : c'est bien une fermeture.
            expect(onConnectionClose).toHaveBeenCalledWith(sortante)
        })

        it('⭐ hors contexte `stream`, le wrap n\'est PAS posé du tout', async () => {
            // Limité au type 'stream' pour ne pas déclencher d'effets de bord sur les
            // connexions data (stopCallWithPeers, removeCurrentCallUser…).
            mount('data', 'app')
            const onConnectionClose = vi.fn()
            await initialize({ onConnectionClose })

            const conn = await acceptIncoming('data')
            // Le flux est semé par le verbe exposé : en `data`, aucune connexion média
            // n'entre, mais `remoteStreamsMap` est le même registre.
            // ⚠️ Le type du flux semé doit être CELUI DE LA CONNEXION : `handleStreamRemoved`
            // transmet `metadata.type` à `handleRemoteDeparture`, qui n'emporte que le type
            // qui se ferme. Deux types différents rendraient ces cas verts même avec le wrap
            // posé — c'est ce que le contrôle n° 4 a montré.
            await api.handleStreamReceived(realStream(), conn, {
                from: REMOTE_SLUG,
                type: api.currentType.value,
                room: 'app',
            })
            expect(api.remoteStreams.value).toHaveLength(1)

            conn._triggerEvent('close')
            await settleTasks()

            expect(api.remoteStreams.value).toHaveLength(1)
            expect(onConnectionClose).toHaveBeenCalledWith(conn)
        })
    })

    // ── Normalisation des entrées ─────────────────────────────────────────────

    describe('normalisation des entrées', () => {
        it('retombe sur `data` quand le type n\'est pas un type d\'appel valide', () => {
            mount('téléportation', 'app')

            expect(api.currentType.value).toBe('data')
            expect(api.contextId).toBe('data-app')
        })

        it('retombe sur `app` quand la room est vide, blanche ou n\'est pas une chaîne', () => {
            expect(mount('data', '').currentRoom.value).toBe('app')
            expect(mount('data', '   ').currentRoom.value).toBe('app')
            expect(mount('data', 42).currentRoom.value).toBe('app')
        })

        it('détoure les espaces d\'une room valide', () => {
            mount('data', '  salon-42  ')

            expect(api.currentRoom.value).toBe('salon-42')
            expect(api.contextId).toBe('data-salon-42')
        })

        it('⭐ le wrap de fermeture est conditionné au type BRUT, pas au type normalisé', async () => {
            // Épinglé tel quel, pas corrigé : `'STREAM'` n'est pas un type valide, donc le
            // contexte retombe en `data` ET le wrap n'est pas posé. Les deux lectures
            // tombent du même côté — c'est ce qui rend l'asymétrie inoffensive, et c'est
            // aussi ce qui la rendrait invisible le jour où elle cesserait de l'être.
            mount('STREAM', 'app')
            expect(api.currentType.value).toBe('data')

            const onConnectionClose = vi.fn()
            await initialize({ onConnectionClose })

            const conn = await acceptIncoming('data')
            // ⚠️ Le type du flux semé doit être CELUI DE LA CONNEXION : `handleStreamRemoved`
            // transmet `metadata.type` à `handleRemoteDeparture`, qui n'emporte que le type
            // qui se ferme. Deux types différents rendraient ces cas verts même avec le wrap
            // posé — c'est ce que le contrôle n° 4 a montré.
            await api.handleStreamReceived(realStream(), conn, {
                from: REMOTE_SLUG,
                type: api.currentType.value,
                room: 'app',
            })

            conn._triggerEvent('close')
            await settleTasks()

            expect(api.remoteStreams.value).toHaveLength(1)
        })
    })

    /**
     * Ouvre une connexion SORTANTE vers alice et la rend, ses listeners branchés.
     *
     * ⚠️ Le mock isolé rend des connexions aux métadonnées par défaut : on re-stube
     * `connect`/`call` pour qu'elles portent celles de l'appelant — sans quoi
     * `metadata.from` serait absent et le cas testerait le repli permissif au lieu du
     * garde. Recette documentée dans `docs/modules/webrtc2/tests.md`.
     */
    async function openOutgoingConnection() {
        peerInstance.call = vi.fn((peerId, stream, options) =>
            createMockMediaConnection(options?.metadata))
        peerInstance.connect = vi.fn((peerId, options) =>
            createMockDataConnection(options?.metadata))

        peerStore.setRoomMembers(api.contextId, [REMOTE_SLUG])
        navigator.mediaDevices.getUserMedia = vi.fn()
            .mockResolvedValue(realStream([fakeTrack('video'), fakeTrack('audio')]))

        await api.startWebcamStream()
        await settleTasks()

        const sortante = peerInstance.call.mock.results[0]?.value
        expect(sortante?.metadata?.from).toBe(MY_SLUG)
        return sortante
    }
})
