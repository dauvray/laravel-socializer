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
})
