/**
 * usePeerTransport.incomingAuth.test.js
 * Périmètre : authentification des connexions/appels WebRTC entrants
 *             (handlers localPeer.on('connection') et localPeer.on('call')).
 *
 * Faille couverte : [HAUTE] Aucune authentification des connexions WebRTC entrantes.
 * Avant d'appeler setUpConnectionListeners (data) ou call.answer (media), l'émetteur
 * déclaré (metadata.from) doit (a) avoir un format de slug valide, (b) figurer dans
 * usersInRoom, et (c) — défense-en-profondeur — ne pas usurper le slug d'un autre
 * membre si son peerId réel est déjà résolu.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockContext } from './helpers/createMockContext.js'
import { withSetup } from './helpers/withSetup.js'
import { resetPeerMock, getLastPeerInstance } from './__mocks__/peerjs.js'
import { usePeerTransport } from '~socializer/components/WebRTC2/Composables/usePeerTransport.js'

describe('usePeerTransport — authentification des connexions entrantes', () => {
    let ctx
    let app
    let transport
    let peerInstance

    const CTX_ID = 'test-data-app'
    const ROOM = 'app'

    beforeEach(async () => {
        resetPeerMock()
        ctx = createMockContext({
            contextId: CTX_ID,
            connection: { usersInRoom: ['alice', 'bob'] },
        })

        ;[transport, app] = withSetup(() => usePeerTransport(ctx))

        // Crée le Peer singleton (mock) et enregistre les handlers on('connection'|'call').
        await transport.setLocalPeer()
        peerInstance = getLastPeerInstance()
    })

    afterEach(() => {
        app.unmount()
        vi.restoreAllMocks()
    })

    // Fabrique une DataConnection entrante factice.
    const incomingConn = (metadata, peer = 'peer-unknown') => ({
        peer,
        metadata: { type: 'data', room: ROOM, callbackKey: CTX_ID, ...metadata },
        close: vi.fn(),
        on: vi.fn(),
    })

    // Fabrique un MediaConnection entrant factice (type one-way pour rester synchrone).
    const incomingCall = (metadata, peer = 'peer-unknown') => ({
        peer,
        metadata: { type: 'stream', room: ROOM, callbackKey: CTX_ID, ...metadata },
        answer: vi.fn(),
        close: vi.fn(),
        on: vi.fn(),
    })

    // ── DataConnection ────────────────────────────────────────────────────────

    it('accepte une connexion data dont le `from` est un membre de la room', () => {
        const conn = incomingConn({ from: 'bob' })
        peerInstance._triggerEvent('connection', conn)

        expect(ctx.setUpConnectionListeners).toHaveBeenCalledWith(conn)
        expect(conn.close).not.toHaveBeenCalled()
    })

    it('rejette une connexion data dont le `from` est absent de la room', () => {
        const conn = incomingConn({ from: 'mallory' })
        peerInstance._triggerEvent('connection', conn)

        expect(ctx.setUpConnectionListeners).not.toHaveBeenCalled()
        expect(conn.close).toHaveBeenCalled()
    })

    it('rejette une connexion data sans `from`', () => {
        const conn = incomingConn({})
        peerInstance._triggerEvent('connection', conn)

        expect(ctx.setUpConnectionListeners).not.toHaveBeenCalled()
        expect(conn.close).toHaveBeenCalled()
    })

    it('rejette une connexion data dont le `from` a un format de slug invalide', () => {
        const conn = incomingConn({ from: 'bob; rm -rf /' })
        peerInstance._triggerEvent('connection', conn)

        expect(ctx.setUpConnectionListeners).not.toHaveBeenCalled()
        expect(conn.close).toHaveBeenCalled()
    })

    it('rejette une usurpation: `from` membre mais peerId réel mappé à un autre membre', () => {
        // alice est connue sous le peerId 'peer-alice'. Un attaquant connecté avec ce
        // peerId déclare from='bob' (autre membre) pour usurper son identité.
        ctx.peerStore.addRemotePeerId('alice', 'peer-alice')
        const conn = incomingConn({ from: 'bob' }, 'peer-alice')
        peerInstance._triggerEvent('connection', conn)

        expect(ctx.setUpConnectionListeners).not.toHaveBeenCalled()
        expect(conn.close).toHaveBeenCalled()
    })

    it('accepte quand le `from` déclaré correspond au peerId réel mappé', () => {
        ctx.peerStore.addRemotePeerId('bob', 'peer-bob')
        const conn = incomingConn({ from: 'bob' }, 'peer-bob')
        peerInstance._triggerEvent('connection', conn)

        expect(ctx.setUpConnectionListeners).toHaveBeenCalledWith(conn)
        expect(conn.close).not.toHaveBeenCalled()
    })

    // ── MediaConnection (call) ──────────────────────────────────────────────────

    it('répond à un appel one-way dont le `from` est un membre de la room', () => {
        const call = incomingCall({ from: 'bob' })
        peerInstance._triggerEvent('call', call)

        expect(call.answer).toHaveBeenCalled()
        expect(ctx.setUpConnectionListeners).toHaveBeenCalledWith(call)
        expect(call.close).not.toHaveBeenCalled()
    })

    it('rejette un appel dont le `from` est absent de la room (pas de stream livré)', () => {
        const call = incomingCall({ from: 'mallory' })
        peerInstance._triggerEvent('call', call)

        expect(call.answer).not.toHaveBeenCalled()
        expect(ctx.setUpConnectionListeners).not.toHaveBeenCalled()
        expect(call.close).toHaveBeenCalled()
    })

    it('rejette un appel sans `from`', () => {
        const call = incomingCall({})
        peerInstance._triggerEvent('call', call)

        expect(call.answer).not.toHaveBeenCalled()
        expect(ctx.setUpConnectionListeners).not.toHaveBeenCalled()
        expect(call.close).toHaveBeenCalled()
    })

    // ── Trace « un flux de ce pair est en route » ───────────────────────────────
    // Un appel one-way n'existe que si l'émetteur a un flux vivant, et cet événement
    // arrive dès la réception de l'offre — avant ICE, donc avant le `stream`. C'est ce
    // qui permet à l'UI d'attendre un pair déjà en train de diffuser quand on arrive
    // dans la room, sans heuristique (cf. useAwaitedStreams / useBroadcastPresence).

    it('enregistre le pair comme diffuseur dès l\'appel one-way entrant', () => {
        peerInstance._triggerEvent('call', incomingCall({ from: 'bob' }))

        expect(ctx.markAnnouncedStream).toHaveBeenCalledWith('bob', 'call')
        expect(ctx.announcedStreamPeers.value).toEqual(['bob'])
    })

    it('n\'enregistre rien pour un appel refusé', () => {
        peerInstance._triggerEvent('call', incomingCall({ from: 'mallory' }))

        expect(ctx.announcedStreamPeers.value).toEqual([])
    })

    // ── Appels DIRECTS hors room de présence (mapping peerId vérifié) ───────────
    // Un appel visio/vocal 1-à-1 est autorisé via la signalisation backend
    // (peer-access-permission → acceptCallFromPeer/openCallBetweenPeer peuple
    // peerStore.remotePeersId AVANT que la peer.call entrante n'arrive). Le garde
    // s'appuie exclusivement sur ce mapping (et NON sur currentCallUsers qui n'est
    // qu'un état UI), donc la présence du slug dans le mapping ET la correspondance
    // avec le peerId réel tiennent lieu d'autorisation ET d'anti-usurpation.

    it("accepte une connexion data d'un interlocuteur d'appel direct (mapping peerId) hors room", () => {
        // mallory n'est PAS dans usersInRoom, mais la signalisation a peuplé le mapping.
        ctx.peerStore.addRemotePeerId('mallory', 'peer-mallory')
        const conn = incomingConn({ from: 'mallory' }, 'peer-mallory')
        peerInstance._triggerEvent('connection', conn)

        expect(ctx.setUpConnectionListeners).toHaveBeenCalledWith(conn)
        expect(conn.close).not.toHaveBeenCalled()
    })

    it("répond à un appel visio d'un interlocuteur d'appel direct (mapping peerId) hors room", async () => {
        ctx.peerStore.addRemotePeerId('mallory', 'peer-mallory')
        ctx.media.currentStream = { id: 'local-stream' } // stream local présent → answer immédiat
        const call = incomingCall({ type: 'visio', from: 'mallory' }, 'peer-mallory')
        peerInstance._triggerEvent('call', call)

        await vi.waitFor(() => expect(call.answer).toHaveBeenCalled())
        expect(ctx.setUpConnectionListeners).toHaveBeenCalledWith(call)
        expect(call.close).not.toHaveBeenCalled()
    })

    it("rejette une connexion data d'un slug dans currentCallUsers mais SANS mapping peerId (l'état UI ne fait pas autorité)", () => {
        // Garantit qu'on ne regresse pas vers l'ancienne allowlist basée sur currentCallUsers.
        ctx.addCurrentCallUser('mallory', 'visio')
        // PAS d'appel à peerStore.addRemotePeerId — le mapping signalé est absent.
        const conn = incomingConn({ from: 'mallory' }, 'peer-mallory')
        peerInstance._triggerEvent('connection', conn)

        expect(ctx.setUpConnectionListeners).not.toHaveBeenCalled()
        expect(conn.close).toHaveBeenCalled()
    })

    // ── Contexte au démarrage : la présence n'est pas encore connue ─────────────
    // `usersInRoom` vide ne dit pas « personne n'est membre », il dit « je ne sais pas
    // encore ». Conclure dessus refuse le `peer.call` qui apporte son flux à un arrivant,
    // et ce refus n'est rattrapable par personne : PeerJS ne notifie pas le `close()`
    // d'un appel jamais répondu, et l'émetteur voit sa MediaConnection en `connecting`
    // (donc `hasOpenConnection` vraie, donc son moteur de retry s'arrête). La décision
    // attend donc la première synchronisation de présence — sans jamais s'assouplir.

    const unsyncedCtx = () => createMockContext({
        contextId: CTX_ID,
        connection: { usersInRoom: [], presenceSynced: false },
    })

    it('diffère la décision tant que la présence est inconnue, puis admet le membre annoncé', async () => {
        app.unmount()
        ctx = unsyncedCtx()
        ;[transport, app] = withSetup(() => usePeerTransport(ctx))
        await transport.setLocalPeer()
        peerInstance = getLastPeerInstance()

        const call = incomingCall({ from: 'alice' }, 'peer-alice')
        peerInstance._triggerEvent('call', call)

        // Rien n'est tranché : ni répondu, ni fermé.
        await Promise.resolve()
        expect(call.answer).not.toHaveBeenCalled()
        expect(call.close).not.toHaveBeenCalled()

        // La présence Reverb arrive — alice était bien membre depuis le début.
        ctx.connection.usersInRoom = ['alice']
        ctx.connection.presenceSynced = true

        await vi.waitFor(() => expect(call.answer).toHaveBeenCalled())
        expect(ctx.setUpConnectionListeners).toHaveBeenCalledWith(call)
        expect(call.close).not.toHaveBeenCalled()
    })

    it("refuse quand la présence arrive enfin et ne nomme pas l'émetteur", async () => {
        app.unmount()
        ctx = unsyncedCtx()
        ;[transport, app] = withSetup(() => usePeerTransport(ctx))
        await transport.setLocalPeer()
        peerInstance = getLastPeerInstance()

        const call = incomingCall({ from: 'mallory' }, 'peer-mallory')
        peerInstance._triggerEvent('call', call)

        ctx.connection.usersInRoom = ['alice']
        ctx.connection.presenceSynced = true

        // Attendre n'est pas admettre : la présence connue, le garde tranche comme avant.
        await vi.waitFor(() => expect(call.close).toHaveBeenCalled())
        expect(call.answer).not.toHaveBeenCalled()
        expect(ctx.setUpConnectionListeners).not.toHaveBeenCalled()
    })

    it("rejette une connexion data d'un interlocuteur d'appel direct dont le peerId réel ne correspond pas au mapping", () => {
        // mallory est mappée à 'peer-mallory' via signalisation, mais la connexion entrante
        // arrive avec un autre peerId — usurpation rejetée par le chemin appel direct.
        ctx.peerStore.addRemotePeerId('mallory', 'peer-mallory')
        const conn = incomingConn({ from: 'mallory' }, 'peer-attacker')
        peerInstance._triggerEvent('connection', conn)

        expect(ctx.setUpConnectionListeners).not.toHaveBeenCalled()
        expect(conn.close).toHaveBeenCalled()
    })
})
