/**
 * usePeerOrchestrator.teardown.test.js — `cleanupPeerConnection`
 *
 * Le teardown terminal d'un contexte. Les verbes de toutes ses couches y sont enchaînés, et
 * l'orchestrateur est le seul endroit qui les connaît tous : chacun est couvert chez lui,
 * aucun test ne dit qu'ils sont ATTEINTS depuis ici.
 *
 * Quatre propriétés portent ce fichier :
 *
 *   1. le garde de teardown est **permanent** — aucun `endShutdown`, contrairement à
 *      `stopWebcamStream` et `stopCallWithPeers` qui l'équilibrent dans un `finally` ;
 *   2. les demandes de peerId en vol sont purgées **par contexte**, hors de
 *      `closePeerConnection` — qui sort par un early-return quand la room n'a aucune
 *      connexion, cas normal d'un provider démonté avant que la signalisation aboutisse ;
 *   3. les flux locaux (micro/caméra, écran) sont **arrêtés**, connexion `screen` comprise —
 *      le provider annonçait « arrêt des flux » à son démontage, et rien ne le faisait avant le
 *      26/10/2026 ; les flux d'un autre contexte de l'onglet, eux, sont intacts ;
 *   4. le contexte quitte le registre, sans quoi les dispatchers entrants continueraient
 *      de lui router des connexions après sa mort.
 *
 * ── Choix d'infra ─────────────────────────────────────────────────────────────
 *
 * Contexte, stores et couches RÉELS ; seul PeerJS est mocké (alias de `vitest.config.js`)
 * et `MediaBroadcastPlayer.vue` stubé — le pool de players monte une vraie app Vue, et
 * c'est son démontage qu'on observe. Même arbitrage que `createPeerContext.test.js`.
 *
 * ⚠️ **L'ORDRE du teardown n'est pas directement observable**, et on ne fabrique pas
 * d'assertion qui le prétendrait : `stopSignaling`, `stopPool` et `stopBroadcastPresence`
 * n'écrivent dans aucun état atteignable depuis la façade. On asserte leurs CONSÉQUENCES.
 * L'ordre compte quand même, et c'est écrit en production : un signal
 * `PEER_CONNECT_TO_REMOTE_PEER` arrivant pendant le cleanup rouvrirait une connexion juste
 * après `closePeerConnection()` — d'où `stopSignaling()` en tête.
 *
 * ── CONTRÔLES DE HARNAIS (convention du paquet), mesurés le 2026-08-29 ────────
 *
 * Les dix lignes de `cleanupPeerConnection`, neutralisées une à une :
 *
 *    1. `context.beginShutdown()` retiré ................................... 1 cas
 *    2. `signaling.stopSignaling()` retiré ................................. 1 cas
 *    3. `pool.stopPool()` retiré ........................................... AUCUN
 *    4. `presence.stopBroadcastPresence()` retiré .......................... 1 cas
 *    5. `clearWaitingRemotePeerIdsForContext()` retiré ..................... 2 cas
 *    6. `connections.closePeerConnection()` retiré ......................... 2 cas
 *    7. la room lue comme `currentRoom` seule .............................. 1 cas
 *    8. `clearSignalQueue: true` passé à `false` ........................... 1 cas
 *    9. `media.destroyPlayers()` retiré .................................... 1 cas
 *   10. `transport.unregisterLocalContext()` retiré ........................ 1 cas
 *
 * Mesurés le 2026-10-26, à l'ajout des deux arrêts de flux (suite complète) :
 *
 *   11. `media.stopCurrentStream()` retiré .................................. 1 cas
 *   12. `stopScreenCapture()` retiré ........................................ 2 cas
 *   13. `stopScreenCapture()` ramené à `media.stopScreenCapture()` ........... 1 cas
 *   14. (harnais) `installFakeMedia` dont `getUserMedia` rend UN flux partagé  2 cas — l'isolation,
 *       et `scenarios/broadcastLifecycle.test.js` « A qui relance sa diffusion réapparaît chez B »
 *
 * ℹ️ Le point 14 a d'abord été écrit « 1 cas » : mesuré sur CE fichier seul, alors que la mutation
 * porte sur un helper partagé. Une mutation de harnais se mesure sur la suite complète.
 *
 * ⚠️ Le point 13 est le défaut qu'une première version de ce correctif portait, trouvé par la
 * relecture : le verbe de `media` arrête les pistes mais ne ferme pas la connexion `screen`.
 *
 * ⚠️ Retirer ces lignes PAR NUMÉRO, pas par motif : `media.stopScreenCapture()` existe dans le
 * verbe `stopScreenCapture` de l'orchestrateur, à la même indentation. Une mutation par motif
 * en a retiré deux et rougi 4 cas — dont 3 de `usePeerOrchestrator.media.test.js` qui ne
 * parlent pas du teardown. Mesuré, c'est l'erreur qu'on a faite.
 *
 * ⚠️ **Le point 3 est le seul AUCUN, et il est attendu** : `beginShutdown()` est posé
 * quatre lignes plus haut et il est PERMANENT — les deux watchers du pool et
 * `_handleConnectionAttempt` sortent alors sur `isShuttingDown` avant même de regarder si
 * `stopPool` est passé. Aucun cas ne peut les distinguer depuis cet étage, et en écrire un
 * demanderait de retirer d'abord le point 1. Le contenu de `stopPool` (retries en vol,
 * observation du signal `peer-unavailable`) est couvert un étage plus bas, par
 * `useConnectionPool.test.js` § cleanup — ce n'est donc pas un trou, c'est un recouvrement.
 *
 * ℹ️ Le point 4 a d'abord été AUCUN lui aussi, et c'était un vrai trou : rien n'exerçait le
 * canal de présence au teardown. Le cas des whispers a été écrit pour ça.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { withSetup } from './helpers/withSetup.js'
import { mockEventBus } from './helpers/mockEventBus.js'
import { bootLocalPeer } from './helpers/bootLocalPeer.js'
import { installFakeMedia, realStream } from './helpers/fakeMedia.js'
import { createFakePresenceChannel } from './helpers/createFakePresenceChannel.js'
import { resetPeerMock } from './__mocks__/peerjs.js'
import { usePeerOrchestrator } from '~socializer/components/WebRTC2/Composables/usePeerOrchestrator.js'
import { BROADCAST_STATE_WHISPER } from '~socializer/components/WebRTC2/Composables/useBroadcastPresence.js'
import { usePeer2Store } from '~socializer/stores/peers2.js'
import { useMeStore } from '~estarter/stores/me.js'

// Stub du player : le pool monte une vraie app Vue par container, et c'est son
// démontage par `destroyPlayers` que ce fichier observe.
vi.mock('~socializer/components/WebRTC2/Widgets/Mediaplayer/MediaBroadcastPlayer.vue', async () => {
    const { h } = await import('vue')
    return {
        default: {
            name: 'MediaBroadcastPlayerStub',
            props: ['streamData', 'videoId', 'nickname', 'type', 'peer', 'roomId', 'resizable', 'draggable'],
            setup: (props) => () => h('div', { class: 'player-stub' }, props.videoId ?? ''),
        },
    }
})

const MY_SLUG = 'me'
const REMOTE_SLUG = 'alice'
const REMOTE_PEER_ID = 'peer-alice'
const CTX_ID = 'stream-app'

/** Rend la main jusqu'à la vidange COMPLÈTE de la file de microtâches. */
const settleTasks = () => new Promise((resolve) => setTimeout(resolve, 0))

const hostElements = () => document.querySelectorAll('.webrtc2-player-host')

describe('usePeerOrchestrator — cleanupPeerConnection', () => {
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

    const initialize = async (instance = api, callbacks = {}) => {
        return bootLocalPeer(
            () => instance.initializePeerConnection(callbacks),
            { peerId: 'my-peer-id' }
        )
    }

    /**
     * Ouvre une vraie connexion sortante vers alice et la range dans le store.
     * @returns {string} la room sous laquelle la connexion est enregistrée
     */
    const openConnectionToRemote = async () => {
        peerStore.setRoomMembers(api.contextId, [REMOTE_SLUG])
        peerStore.addRemotePeerId(REMOTE_SLUG, REMOTE_PEER_ID)

        await api.startWebcamStream()
        await settleTasks()

        const room = api.currentCallRoomId.value || api.currentRoom.value
        expect(peerStore.getConnections[room]?.[REMOTE_SLUG]).toBeTruthy()
        return room
    }

    beforeEach(() => {
        apps = []
        resetPeerMock()
        installFakeMedia()
        document.body.innerHTML = '<div id="videoContainer"></div>'

        peerStore = usePeer2Store()
        meStore = useMeStore()
        meStore.user = { slug: MY_SLUG, name: 'Me' }
        peerStore.lastLocalPeerId = 'my-peer-id'

        vi.spyOn(console, 'log').mockImplementation(() => {})
        vi.spyOn(console, 'info').mockImplementation(() => {})
        vi.spyOn(console, 'debug').mockImplementation(() => {})
        vi.spyOn(console, 'warn').mockImplementation(() => {})

        api = mount()
    })

    afterEach(() => {
        apps.forEach((app) => { try { app.unmount() } catch { /* déjà démontée */ } })
        document.body.innerHTML = ''
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    // ── Le garde de teardown ──────────────────────────────────────────────────

    it('⭐ le garde de teardown est PERMANENT : il n\'est jamais rendu', async () => {
        // Aucun `endShutdown` ici, à la différence de `stopWebcamStream` et
        // `stopCallWithPeers` : après un teardown terminal, tout ce qui lit
        // `isShuttingDown` doit rester définitivement muselé.
        peerInstance = await initialize()
        expect(api.isShuttingDown.value).toBe(false)

        api.cleanupPeerConnection()

        expect(api.isShuttingDown.value).toBe(true)
    })

    // ── Signalisation ─────────────────────────────────────────────────────────

    it('un signal reçu après le teardown ne rouvre plus rien', async () => {
        // La raison d'être du `stopSignaling()` en tête : sans lui, un
        // PEER_CONNECT_TO_REMOTE_PEER en vol rouvrirait une connexion juste après
        // `closePeerConnection()` — et elle survivrait au contexte.
        peerInstance = await initialize()
        await openConnectionToRemote()

        api.cleanupPeerConnection()
        peerInstance.connect.mockClear()
        peerInstance.call.mockClear()

        peerStore.dispatchSignal({
            roomId: CTX_ID,
            type: 'PEER_CONNECT_TO_REMOTE_PEER',
            payload: {
                fromUserSlug: REMOTE_SLUG,
                peerId: REMOTE_PEER_ID,
                room: 'app',
                type: 'stream',
            },
        })
        await nextTick()
        await settleTasks()

        expect(peerInstance.connect).not.toHaveBeenCalled()
        expect(peerInstance.call).not.toHaveBeenCalled()
    })

    // ── Demandes de peerId en vol ─────────────────────────────────────────────

    describe('demandes de peerId en vol', () => {
        const seedWaiting = (contextId, room) => {
            peerStore.addWaitingRemotePeerId(REMOTE_SLUG, {
                room,
                type: 'stream',
                contextId,
            })
        }

        it('⭐ purge les siennes ALORS QUE la room n\'a aucune connexion', async () => {
            // Le cas que `closePeerConnection` ne peut pas couvrir : sans connexion dans la
            // room, il sort par son early-return et sa purge par pair n'a jamais lieu. Une
            // demande orpheline serait alors relue comme la sienne par le contexte remonté
            // à ma place, qui resterait muet jusqu'à SIGNALING_STALE_MS.
            peerInstance = await initialize()
            seedWaiting(CTX_ID, 'app')
            expect(peerStore.getWaitingRemotePeerIds(REMOTE_SLUG)).toHaveLength(1)

            api.cleanupPeerConnection()

            expect(peerStore.getWaitingRemotePeerIds(REMOTE_SLUG)).toHaveLength(0)
        })

        it('ne touche pas aux demandes d\'un AUTRE contexte de l\'onglet', async () => {
            peerInstance = await initialize()
            seedWaiting(CTX_ID, 'app')
            seedWaiting('data-app', 'app-data')

            api.cleanupPeerConnection()

            const restantes = peerStore.getWaitingRemotePeerIds(REMOTE_SLUG)
            expect(restantes).toHaveLength(1)
            expect(restantes[0].contextId).toBe('data-app')
        })
    })

    // ── Fermeture des connexions ──────────────────────────────────────────────

    describe('fermeture des connexions', () => {
        it('ferme les connexions de la room et vide sa file de signaux', async () => {
            peerInstance = await initialize()
            const room = await openConnectionToRemote()
            peerStore.dispatchSignal({ roomId: CTX_ID, type: 'PEER_CONNECTION_REQUEST', payload: {} })
            expect(peerStore.getQueueForRoom(CTX_ID)).not.toBeNull()

            api.cleanupPeerConnection()

            expect(peerStore.getConnections[room]).toBeUndefined()
            expect(peerStore.getQueueForRoom(CTX_ID)).toBeNull()
        })

        it('⭐ ferme la room d\'APPEL quand il y en a une, pas la room du contexte', async () => {
            // `currentCallRoomId || currentRoom` : lire la seule room du contexte laisserait
            // les connexions d'un appel en cours ouvertes derrière le contexte mort.
            peerInstance = await initialize()
            api.setCurrentCallRoomId('call-42')
            const room = await openConnectionToRemote()
            expect(room).toBe('call-42')

            api.cleanupPeerConnection()

            expect(peerStore.getConnections['call-42']).toBeUndefined()
        })
    })

    // ── Pool de players ───────────────────────────────────────────────────────

    it('détruit le pool de players — teardown terminal', async () => {
        // Le pool garde ses instances montées entre deux flux : c'est ici, et seulement
        // ici, qu'elles sont démontées pour de bon.
        peerInstance = await initialize()
        await api.createVideoElement({ videoId: 'local-webcam', type: 'visio' }, realStream())
        await nextTick()
        expect(hostElements()).toHaveLength(1)
        expect(peerStore.getPlayers).toHaveLength(1)

        api.cleanupPeerConnection()
        await settleTasks()

        expect(peerStore.getPlayers).toHaveLength(0)
        expect(hostElements()).toHaveLength(0)
    })

    // ── Annonce de diffusion ──────────────────────────────────────────────────

    it('⭐ n\'écoute plus les whispers de présence après le teardown', async () => {
        // Le canal de présence survit au contexte : c'est un abonnement d'ONGLET, partagé.
        // Sans `stopBroadcastPresence()`, un contexte mort continuerait d'inscrire des
        // annonces dans un registre que plus personne ne purge.
        const channel = createFakePresenceChannel()
        const moi = channel.subscribe({ id: 99, slug: MY_SLUG })
        const alice = channel.subscribe({ id: 11, slug: REMOTE_SLUG })
        const bob = channel.subscribe({ id: 12, slug: 'bob' })

        const [instance, app] = withSetup(
            () => usePeerOrchestrator('stream', 'app', {}, { reverb: moi }),
            { provides: { eventBus: mockEventBus() } }
        )
        apps.push(app)
        api = instance
        peerInstance = await initialize(api)

        // L'annuaire id → slug est écrit par le seul écrivain de `remotePeers` : un
        // `user_id` absent n'est pas un membre observé et ne peut rien annoncer.
        peerStore.addRemotePeerId(REMOTE_SLUG, REMOTE_PEER_ID)
        peerStore.addRemotePeerId('bob', 'peer-bob')
        await api.syncUsersConnections([
            { slug: MY_SLUG, id: 99 },
            { slug: REMOTE_SLUG, id: 11 },
            { slug: 'bob', id: 12 },
        ])
        await settleTasks()

        // Contrôle de non-vacuité : le canal EST branché avant le teardown.
        alice.whisper(BROADCAST_STATE_WHISPER, { roomId: api.onAirRoom.value, isBroadcasting: true })
        expect(api.announcedStreamPeers.value).toEqual([REMOTE_SLUG])

        api.cleanupPeerConnection()
        bob.whisper(BROADCAST_STATE_WHISPER, { roomId: api.onAirRoom.value, isBroadcasting: true })

        expect(api.announcedStreamPeers.value).toEqual([REMOTE_SLUG])
    })

    // ── Flux locaux ───────────────────────────────────────────────────────────

    describe('flux locaux', () => {
        it('⭐ arrête les pistes du flux local : un contexte mort ne garde pas le micro', async () => {
            // Le provider appelle `cleanup()` à son démontage en promettant « arrêt des
            // flux », et rien ici n'appelait `stopCurrentStream`. Quitter un salon audio
            // laissait donc le micro capturé — voyant du navigateur allumé — sur un contexte
            // que plus rien ne peut atteindre pour l'éteindre.
            peerInstance = await initialize()
            await api.startAudioStream()
            const pistes = api.currentStream.value.getTracks()
            expect(pistes.length).toBeGreaterThan(0)

            api.cleanupPeerConnection()

            pistes.forEach((piste) => expect(piste.stop).toHaveBeenCalledTimes(1))
            expect(api.currentStream.value).toBeNull()
            expect(api.isStreaming.value).toBe(false)
        })

        it('⭐ arrête aussi le partage d\'écran', async () => {
            peerInstance = await initialize()
            await api.startScreenCapture()
            const pistes = api.screenStream.value.getTracks()
            expect(pistes.length).toBeGreaterThan(0)

            api.cleanupPeerConnection()

            pistes.forEach((piste) => expect(piste.stop).toHaveBeenCalledTimes(1))
            expect(api.screenStream.value).toBeNull()
            expect(api.isCapturing.value).toBe(false)
        })

        it('⭐ ferme aussi la connexion `screen`, qui n\'est pas du type de la session', async () => {
            // `closePeerConnection` plus haut ne ferme que `connections[room][slug][currentType]`.
            // Le partage d'écran vit sous le type `screen` : arrêter ses pistes sans fermer sa
            // MediaConnection la laissait ouverte, rangée dans le store d'un contexte mort, et
            // figeait la vignette chez le distant (piste muette mais `live`, que le TTL ne
            // ramasse plus). Trouvé par la relecture du 26/10/2026.
            peerInstance = await initialize()
            peerStore.setRoomMembers(api.contextId, [REMOTE_SLUG])
            peerStore.addRemotePeerId(REMOTE_SLUG, REMOTE_PEER_ID)
            await api.startScreenCapture()
            await settleTasks()
            const room = api.currentCallRoomId.value || api.currentRoom.value
            // Le store range un TABLEAU de connexions par type.
            const partages = [...(peerStore.getConnections[room]?.[REMOTE_SLUG]?.screen ?? [])]
            expect(partages).toHaveLength(1)

            api.cleanupPeerConnection()

            partages.forEach((partage) => expect(partage.close).toHaveBeenCalled())
            expect(peerStore.getConnections[room]?.[REMOTE_SLUG]?.screen).toBeUndefined()
        })

        it('n\'arrête pas les flux d\'un AUTRE contexte de l\'onglet', async () => {
            // Chaque contexte possède son `ctx.media`, et chaque démarrage obtient ses propres
            // pistes : le teardown d'un provider ne doit rien couper chez son voisin.
            peerInstance = await initialize()
            const voisin = mount('stream', 'autre-room')
            await api.startAudioStream()
            await voisin.startAudioStream()
            const pistesVoisin = voisin.currentStream.value.getTracks()
            expect(pistesVoisin.length).toBeGreaterThan(0)

            api.cleanupPeerConnection()

            pistesVoisin.forEach((piste) => expect(piste.stop).not.toHaveBeenCalled())
            expect(voisin.isStreaming.value).toBe(true)
        })
    })

    // ── Registre des contextes ────────────────────────────────────────────────

    it('retire le contexte du registre : plus aucune connexion ne lui est routée', async () => {
        peerInstance = await initialize()
        expect(peerStore.contextRegistry.get(CTX_ID)).toBeTruthy()

        api.cleanupPeerConnection()

        expect(peerStore.contextRegistry.get(CTX_ID)).toBeUndefined()
    })
})
