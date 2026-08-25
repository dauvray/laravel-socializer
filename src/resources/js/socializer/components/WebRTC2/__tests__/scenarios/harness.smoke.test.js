/**
 * harness.smoke.test.js — Le harnais multi-pairs fonctionne-t-il vraiment ?
 *
 * Ces tests ne visent aucun bug : ils vérifient que deux pairs virtuels se voient, se
 * connectent et s'échangent des données. Sans eux, un scénario rouge serait
 * indistinguable d'un harnais cassé — et un scénario vert pourrait l'être pour la
 * mauvaise raison (le package a déjà connu deux « tests verts pour la mauvaise
 * raison », cf. TODOLIST).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ⚠️ Factory inline obligatoire : `vi.mock` est hoisté au-dessus des imports, donc une
// référence importée serait dans sa TDZ au moment de l'évaluation.
vi.mock('~estarter/services/AjaxService.js', () => ({
    useAjaxService: () => globalThis[Symbol.for('webrtc2.test.signalingServer')].createClient(),
}))

import { createPeerBus } from '../__mocks__/peerjs.js'
import { createFakeSignalingServer } from '../helpers/fakeSignalingServer.js'
import { createVirtualPeer, connectRoom, settle } from '../helpers/createVirtualPeer.js'
import { installFakeMedia } from '../helpers/fakeMedia.js'
import { ENDPOINTS } from '~socializer/components/WebRTC2/webrtc2.config.js'

describe('harnais multi-pairs', () => {
    let bus
    let server
    const peers = []

    const spawn = async (config) => {
        const peer = await createVirtualPeer({ ...config, server })
        peers.push(peer)
        return peer
    }

    beforeEach(() => {
        bus = createPeerBus()
        server = createFakeSignalingServer()
        installFakeMedia()
    })

    afterEach(() => {
        peers.splice(0).forEach((peer) => peer.destroy())
        server.destroy()
        bus.destroy()
    })

    it('monte deux pairs indépendants (peerId distincts, stores séparés)', async () => {
        const alice = await spawn({ slug: 'alice', type: 'data' })
        const bob = await spawn({ slug: 'bob', type: 'data' })

        expect(alice.peerId).not.toBe(bob.peerId)
        expect(alice.peerStore).not.toBe(bob.peerStore)
        expect(alice.meStore.getMe.slug).toBe('alice')
        expect(bob.meStore.getMe.slug).toBe('bob')

        // Chaque pair a bien SON Peer. Ce n'est pas `vi.resetModules()` qui l'isole —
        // l'état du Peer vit dans Pinia depuis sa migration, et son registre de contextes
        // l'a rejoint : c'est l'assertion `peerStore` ci-dessus qui porte l'isolation.
        expect(alice.peerInstance).not.toBe(bob.peerInstance)
    })

    it('achemine la signalisation : ask-to-peer-id → response-to-peer-id', async () => {
        const alice = await spawn({ slug: 'alice', type: 'data' })
        const bob = await spawn({ slug: 'bob', type: 'data' })

        await connectRoom([alice, bob])

        // Le va-et-vient complet a bien eu lieu, dans les deux sens.
        expect(server.requestsTo(ENDPOINTS.ASK_TO_PEER_ID).length).toBeGreaterThan(0)
        expect(server.requestsTo(ENDPOINTS.RESPONSE_TO_PEER_ID).length).toBeGreaterThan(0)

        // Chacun a mémorisé le peerId de l'autre — la découverte a abouti.
        expect(alice.peerStore.getRemotePeerId('bob')).toBe(bob.peerId)
        expect(bob.peerStore.getRemotePeerId('alice')).toBe(alice.peerId)
    })

    it('ouvre un data channel réel entre les deux pairs', async () => {
        const received = []
        const alice = await spawn({ slug: 'alice', type: 'data' })
        const bob = await spawn({
            slug: 'bob',
            type: 'data',
            callbacks: { onDataReceived: (data) => received.push(data) },
        })

        await connectRoom([alice, bob])

        alice.api.sendDataToPeer({ message: 'hello bob' })
        await settle()

        expect(received).toContainEqual({ message: 'hello bob' })
    })

    it("propage les metadata de connexion — l'identité du pair en dépend", async () => {
        const alice = await spawn({ slug: 'alice', type: 'data' })
        const bob = await spawn({
            slug: 'bob',
            type: 'data',
            callbacks: { onConnectionOpen: () => {} },
        })

        await connectRoom([alice, bob])

        // Le mock historique ignorait l'argument `options` de peer.connect() : toute
        // connexion arrivait avec `{ type: 'data', room: 'test' }`, rendant intestable
        // toute la résolution d'identité (metadata.from / .type / .room).
        const bobConnections = bob.peerStore.getConnections
        const aliceConnections = alice.peerStore.getConnections

        const anyConn = Object.values(aliceConnections)
            .flatMap((room) => Object.values(room))
            .flatMap((slug) => Object.values(slug))
            .flat()[0]

        expect(anyConn).toBeDefined()
        expect(anyConn.metadata.from).toBe('alice')
        expect(anyConn.metadata.room).toBe('room-test')
        expect(bobConnections).toBeDefined()
    })

    it('signale peer-unavailable sur un peerId inconnu du bus', async () => {
        const alice = await spawn({ slug: 'alice', type: 'data' })

        // peerId périmé : le pair a été détruit (onglet inactif > PEER_DESTROY_DELAY_MS).
        alice.peerStore.addRemotePeerId('ghost', 'peer-ghost-perime')
        alice.api.syncUsersConnections([{ slug: 'alice' }, { slug: 'ghost' }])
        await settle()

        // La recovery invalide le mapping périmé (invalidateRemotePeerId) — sans quoi
        // requestOrConnectPeer rappellerait indéfiniment un peer mort.
        await vi.waitFor(() => {
            expect(alice.peerStore.getRemotePeerId('ghost')).toBeFalsy()
        })
    })
})
