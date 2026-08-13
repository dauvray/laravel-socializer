/**
 * usePeerOrchestrator.broadcastPresence.test.js
 *
 * Câblage de l'annonce de diffusion, de bout en bout : orchestrateur → contexte réel →
 * listeners de connexion PeerJS. Les tests unitaires de `useBroadcastPresence` valident
 * le protocole ; ceux-ci valident qu'il est BRANCHÉ — c'est-à-dire les deux points où le
 * wiring peut casser sans qu'aucun test unitaire ne bronche :
 *
 *   1. le wrap `onDataReceived` est posé même quand l'app ne fournit pas de callback
 *      (sinon `handleData` n'est pas branché du tout et les annonces sont perdues) ;
 *   2. l'annonce part à l'ouverture d'une connexion data, ce qui suppose que
 *      `onConnectionOpen` reçoive la connexion — `conn.on('open')` n'émet aucun argument.
 *
 * Choix d'infra : contexte, stores et listeners RÉELS (seul PeerJS est mocké via alias).
 * L'autorisation de la connexion entrante passe par le chemin « appel direct » (mapping
 * peerId vérifié) pour ne pas avoir à peupler `usersInRoom`, dont la synchronisation
 * déclencherait de vraies requêtes de signalisation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { withSetup } from './helpers/withSetup.js'
import { mockEventBus } from './helpers/mockEventBus.js'
import { resetPeerMock, getLastPeerInstance, createMockDataConnection } from './__mocks__/peerjs.js'
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
        api.initializePeerConnection(callbacks)
        await vi.waitFor(() => expect(getLastPeerInstance()).not.toBeNull())
        peerInstance = getLastPeerInstance()
        peerInstance._triggerEvent('open', 'my-peer-id')
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
})
