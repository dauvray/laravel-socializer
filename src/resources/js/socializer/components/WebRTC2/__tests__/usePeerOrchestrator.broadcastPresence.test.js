/**
 * usePeerOrchestrator.broadcastPresence.test.js
 *
 * Câblage de l'annonce de diffusion, de bout en bout : orchestrateur → contexte réel →
 * listeners de connexion PeerJS. Les tests unitaires de `useBroadcastPresence` valident
 * le protocole ; ceux-ci valident qu'il est BRANCHÉ — c'est-à-dire les trois points où le
 * wiring peut casser sans qu'aucun test unitaire ne bronche :
 *
 *   1. le wrap `onDataReceived` est posé même quand l'app ne fournit pas de callback
 *      (sinon `handleData` n'est pas branché du tout et les annonces sont perdues) ;
 *   2. l'annonce part à l'ouverture d'une connexion data, ce qui suppose que
 *      `onConnectionOpen` reçoive la connexion — `conn.on('open')` n'émet aucun argument ;
 *   3. la table `routes` de la couche signalisation note l'état de diffusion embarqué sur
 *      les signaux de peerId (troisième chemin d'annonce, le seul sans contact P2P).
 *
 * Choix d'infra : contexte, stores et listeners RÉELS (seul PeerJS est mocké via alias).
 * L'autorisation de la connexion entrante passe par le chemin « appel direct » (mapping
 * peerId vérifié) pour ne pas avoir à peupler `remotePeers`, dont la synchronisation
 * déclencherait de vraies requêtes de signalisation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { withSetup } from './helpers/withSetup.js'
import { mockEventBus } from './helpers/mockEventBus.js'
import { bootLocalPeer } from './helpers/bootLocalPeer.js'
import { resetPeerMock, createMockDataConnection } from './__mocks__/peerjs.js'
import { usePeerOrchestrator } from '~socializer/components/WebRTC2/Composables/usePeerOrchestrator.js'
import { BROADCAST_STATE } from '~socializer/components/WebRTC2/Composables/useBroadcastPresence.js'
import { usePeer2Store } from '~socializer/stores/peers2.js'
import { useMeStore } from '~estarter/stores/me.js'

const CTX_ID = 'stream-app'
const MY_SLUG = 'me'

describe('usePeerOrchestrator — câblage de l\'annonce de diffusion', () => {
    let api
    let app
    let peerStore
    let meStore
    let peerInstance

    /** Connexion data entrante ouverte par alice, autorisée par mapping peerId. */
    const incomingConn = () => createMockDataConnection({
        type: 'stream',
        room: 'app',
        callbackKey: CTX_ID,
        from: 'alice',
        slug: MY_SLUG,
    })

    const initialize = async (callbacks = {}) => {
        peerInstance = await bootLocalPeer(
            () => api.initializePeerConnection(callbacks),
            { peerId: 'my-peer-id' }
        )
    }

    /**
     * Démarre une diffusion locale. `getUserMedia` est re-stubbé ici plutôt que laissé
     * au setup global : `vi.restoreAllMocks()` (afterEach) vide son implémentation, et le
     * stream retomberait à undefined.
     */
    const startLocalStream = async () => {
        navigator.mediaDevices.getUserMedia = vi.fn().mockResolvedValue({
            id: 'local-stream',
            getTracks: () => [],
            getVideoTracks: () => [],
            getAudioTracks: () => [],
        })
        await api.startWebcamStream()
    }

    /** Fait entrer une connexion data d'alice et retourne l'instance branchée. */
    const acceptIncomingConn = () => {
        peerStore.addRemotePeerId('alice', 'peer-alice')
        const conn = incomingConn()
        conn.peer = 'peer-alice'
        peerInstance._triggerEvent('connection', conn)
        return conn
    }

    beforeEach(() => {
        resetPeerMock()
        peerStore = usePeer2Store()
        meStore = useMeStore()
        meStore.user = { slug: MY_SLUG, name: 'Me' }
        peerStore.lastLocalPeerId = 'my-peer-id'

        ;[api, app] = withSetup(
            () => usePeerOrchestrator('stream', 'app'),
            { provides: { eventBus: mockEventBus() } }
        )
    })

    afterEach(() => {
        app.unmount()
        vi.restoreAllMocks()
    })

    it('enregistre une annonce entrante sans aucun callback applicatif', async () => {
        // Cas limite du wiring : une app qui ne consomme pas de data (StreamSimpleUI en
        // fournit un, mais rien ne l'y oblige) ne doit pas perdre le protocole.
        await initialize({})
        const conn = acceptIncomingConn()

        conn._triggerEvent('data', { type: BROADCAST_STATE, isBroadcasting: true })

        expect(api.announcedStreamPeers.value).toEqual(['alice'])
    })

    it('ne remonte jamais une annonce au callback métier', async () => {
        const onDataReceived = vi.fn()
        await initialize({ onDataReceived })
        const conn = acceptIncomingConn()

        conn._triggerEvent('data', { type: BROADCAST_STATE, isBroadcasting: true })

        expect(onDataReceived).not.toHaveBeenCalled()
        expect(api.announcedStreamPeers.value).toEqual(['alice'])
    })

    it('remonte un message métier avec la connexion et ses métadonnées', async () => {
        // Arité préservée par le wrap : les apps scopent leurs signaux sur `conn.peer`.
        const onDataReceived = vi.fn()
        await initialize({ onDataReceived })
        const conn = acceptIncomingConn()

        conn._triggerEvent('data', { message: 'coucou' })

        expect(onDataReceived).toHaveBeenCalledWith({ message: 'coucou' }, conn, conn.metadata)
    })

    it('retire le pair quand il annonce l\'arrêt de sa diffusion', async () => {
        await initialize({})
        const conn = acceptIncomingConn()

        conn._triggerEvent('data', { type: BROADCAST_STATE, isBroadcasting: true })
        conn._triggerEvent('data', { type: BROADCAST_STATE, isBroadcasting: false })

        expect(api.announcedStreamPeers.value).toEqual([])
    })

    it('annonce ma diffusion à l\'ouverture d\'une connexion data', async () => {
        // Le chemin qui informe un arrivant : je diffuse déjà, sa connexion s'ouvre.
        const onConnectionOpen = vi.fn()
        await initialize({ onConnectionOpen })
        await startLocalStream()
        const conn = acceptIncomingConn()
        conn.open = true

        conn._triggerEvent('open')

        expect(conn.send).toHaveBeenCalledWith(
            expect.objectContaining({ type: BROADCAST_STATE, isBroadcasting: true })
        )
        // Le callback applicatif reste appelé, avec la connexion (que `conn.on('open')`
        // n'émet pas de lui-même).
        expect(onConnectionOpen).toHaveBeenCalledWith(conn)
    })

    it('n\'annonce rien à l\'ouverture quand je ne diffuse pas', async () => {
        await initialize({})
        const conn = acceptIncomingConn()
        conn.open = true

        conn._triggerEvent('open')

        expect(conn.send).not.toHaveBeenCalled()
    })

    /**
     * Troisième point où le wiring peut casser sans qu'aucun test unitaire ne bronche : la
     * table `routes` de la couche signalisation. `noteBroadcastFromSignal` y est appelé
     * AVANT de déléguer, donc l'annonce est enregistrée même quand le handler refuse
     * ensuite d'ouvrir la connexion (pair pas encore autorisé, retry à venir) — c'est
     * voulu : le registre ne pilote qu'une vignette, jamais une décision de connexion.
     *
     * On passe par `PEER_CONNECT_TO_REMOTE_PEER`, dont le handler n'émet aucune requête.
     */
    describe('câblage de la table de routage des signaux', () => {
        const dispatchPeerIdResponse = async (payload) => {
            peerStore.dispatchSignal({
                roomId: CTX_ID,
                type: 'PEER_CONNECT_TO_REMOTE_PEER',
                payload: { room: 'app', type: 'stream', ...payload },
            })
            // Le routage se fait dans le flush du watcher sur `ctx.lastRoomSignal`.
            await nextTick()
        }

        it('enregistre l\'annonce portée par une réponse de peerId', async () => {
            await initialize({})

            await dispatchPeerIdResponse({
                fromUserSlug: 'alice',
                peerId: 'peer-alice',
                isBroadcasting: true,
            })

            expect(api.announcedStreamPeers.value).toEqual(['alice'])
        })

        it('n\'enregistre rien quand le signal ne porte pas de diffusion', async () => {
            await initialize({})

            await dispatchPeerIdResponse({
                fromUserSlug: 'alice',
                peerId: 'peer-alice',
                isBroadcasting: false,
            })

            expect(api.announcedStreamPeers.value).toEqual([])
        })

        it('n\'efface pas une annonce data channel déjà posée', async () => {
            // L'arbitrage qui compte : les deux chemins écrivent dans le même registre, et
            // celui de la signalisation n'a pas de garantie d'ordre — il ne doit donc
            // jamais retirer ce que l'autre a posé.
            await initialize({})
            const conn = acceptIncomingConn()
            conn._triggerEvent('data', { type: BROADCAST_STATE, isBroadcasting: true })

            await dispatchPeerIdResponse({
                fromUserSlug: 'alice',
                peerId: 'peer-alice',
                isBroadcasting: false,
            })

            expect(api.announcedStreamPeers.value).toEqual(['alice'])
        })
    })

    it('livre telle quelle une enveloppe star reçue hors du cas hub', async () => {
        // Le contexte de ce fichier est `mesh` : `routeIncomingData` ne doit RIEN
        // intercepter, et surtout pas déballer. Sans ce cas, un routeur qui déballerait
        // sur le seul marqueur `__starRoute` (sans le prédicat de topologie) resterait vert.
        const onDataReceived = vi.fn()
        await initialize({ onDataReceived })
        const conn = acceptIncomingConn()
        const envelope = { __starRoute: true, to: null, from: 'alice', payload: { message: 'coucou' } }

        conn._triggerEvent('data', envelope)

        expect(onDataReceived).toHaveBeenCalledWith(envelope, conn, conn.metadata)
    })

    /**
     * La branche HUB du wrap — le dernier cas en attente de la tâche 6, débloqué par la
     * descente de la décision de routage dans `usePeerTransport.routeIncomingData`.
     *
     * Trois choses que le montage du `describe` parent ne donne pas, et dont chacune est
     * une raison de rougir si on l'oublie :
     *
     *   1. un contexte `star` dont le hub est MOI ;
     *   2. `isHub` RÉSOLU — il vaut `null` au montage et n'est écrit que par
     *      `waitForMeReady`, qu'un tour de synchronisation déclenche. Sur une liste VIDE
     *      ce tour n'ouvre rien (le garde du fan-out le lui interdit) et n'émet donc
     *      aucune requête de signalisation : c'est le seul moyen fidèle d'obtenir un hub
     *      sans peupler la room, ce que l'en-tête de ce fichier cherche à éviter ;
     *   3. une connexion ouverte VERS bob. Les connexions entrantes ne sont pas
     *      enregistrées dans le store — le dispatcher ne fait qu'y brancher ses listeners —
     *      donc sans ce semis le hub n'a personne à qui retransmettre et le fan-out sort
     *      en silence.
     */
    describe('branche hub du wrap onDataReceived (topologie star)', () => {
        let bobConn

        /** Remonte l'orchestrateur en hub star, initialise, et ouvre le canal vers bob. */
        const bootAsHub = async (callbacks = {}) => {
            app.unmount()
            ;[api, app] = withSetup(
                () => usePeerOrchestrator('stream', 'app', { topology: 'star', hubSlug: MY_SLUG }),
                { provides: { eventBus: mockEventBus() } }
            )

            await initialize(callbacks)
            await api.syncUsersConnections([])
            expect(api.isHub.value).toBe(true)

            peerStore.setRoomMembers(CTX_ID, ['alice', 'bob'])

            // Connexion SORTANTE vers bob : `metadata.slug` porte le destinataire, et
            // c'est cette clé que le registre du store utilise. Les deux verbes sont ceux
            // de la production (`_saveRoomConnection` : préparer la case, puis pousser).
            const bobMetadata = {
                type: 'stream',
                room: 'app',
                callbackKey: CTX_ID,
                from: MY_SLUG,
                slug: 'bob',
            }
            bobConn = createMockDataConnection(bobMetadata)
            bobConn.open = true
            peerStore.prepareRoomConnection({ options: { metadata: bobMetadata } })
            peerStore.storePeerConnection('app', 'bob', 'stream', bobConn)
        }

        it('retransmet l\'enveloppe d\'un client puis remonte son payload avec l\'arité 1', async () => {
            const onDataReceived = vi.fn()
            await bootAsHub({ onDataReceived })
            const conn = acceptIncomingConn()

            conn._triggerEvent('data', {
                __starRoute: true,
                to: ['bob'],
                from: 'alice',
                payload: { message: 'coucou' },
            })

            // Le hub retransmet le payload NU : l'enveloppe de routage ne sort jamais de lui.
            expect(bobConn.send).toHaveBeenCalledWith({ message: 'coucou' })

            // ARITÉ 1, et c'est le point : `conn` est celle de l'émetteur d'origine, pas
            // celle du message relayé. `toHaveBeenCalledWith` compare la liste ENTIÈRE des
            // arguments — un appel à trois arguments rougit ici.
            expect(onDataReceived).toHaveBeenCalledWith({ message: 'coucou' })
        })

        it('consomme une annonce de diffusion retransmise sans jamais la remonter à l\'app', async () => {
            const onDataReceived = vi.fn()
            await bootAsHub({ onDataReceived })
            const conn = acceptIncomingConn()
            const announcement = { type: BROADCAST_STATE, isBroadcasting: true }

            conn._triggerEvent('data', {
                __starRoute: true,
                to: ['bob'],
                from: 'alice',
                payload: announcement,
            })

            // Les deux moitiés : le hub relaie POUR ses clients, et consomme POUR lui.
            expect(bobConn.send).toHaveBeenCalledWith(announcement)
            expect(api.announcedStreamPeers.value).toEqual(['alice'])
            expect(onDataReceived).not.toHaveBeenCalled()
        })
    })
})
