/**
 * broadcastLifecycle.test.js — Arrêter UN flux ne doit pas en emporter un autre
 *
 * Incendie 🔥 de la TODOLIST : « A diffuse webcam + écran ; A stoppe sa webcam →
 * l'écran disparaissait aussi chez B, remplacé par un spinner ». `_purgePeerStreams`
 * supprimait TOUTES les entrées du pair quel que soit leur type : la fermeture de la
 * connexion webcam d'A était traitée comme « A part ».
 *
 * ⚠️ Ce scénario est celui dont le premier correctif était **inerte en production alors
 * que son test était vert** — le mock fournissait une information (`hasOpenConnection`
 * sur une connexion que `usePeerTransport` n'enregistre jamais côté récepteur) que le
 * vrai store ne peut pas donner. D'où le choix de tester ici de bout en bout, entre deux
 * pairs réels : ce que B voit ne peut pas être fabriqué par un stub.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('~estarter/services/AjaxService.js', () => ({
    useAjaxService: () => globalThis[Symbol.for('webrtc2.test.signalingServer')].createClient(),
}))

import { createPeerBus } from '../__mocks__/peerjs.js'
import { createFakeSignalingServer } from '../helpers/fakeSignalingServer.js'
import { createVirtualPeer, connectRoom, settle } from '../helpers/createVirtualPeer.js'
import { installFakeMedia } from '../helpers/fakeMedia.js'

describe('cycle de vie des diffusions', () => {
    let bus
    let server
    const peers = []
    const ROOM = 'room-lifecycle'

    const spawn = async (config) => {
        const peer = await createVirtualPeer({ room: ROOM, type: 'stream', ...config, server })
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

    it("arrêter la webcam d'A laisse son partage d'écran vivant chez B", async () => {
        const alice = await spawn({ slug: 'alice' })
        const bob = await spawn({ slug: 'bob' })

        await connectRoom([alice, bob])
        await alice.api.startWebcamStream()
        await alice.api.startScreenCapture()
        await connectRoom([alice, bob])

        // Précondition explicite : sans elle, un échec de la suite serait ambigu
        // (« l'écran a-t-il disparu, ou n'est-il jamais arrivé ? »).
        expect(bob.receivedStreamsFrom()).toContain('alice')
        expect(bob.receivedScreensFrom()).toContain('alice')

        alice.api.stopWebcamStream()
        await settle()

        // Le fait métier : l'écran d'alice est toujours affiché chez bob.
        expect(bob.receivedScreensFrom()).toContain('alice')
        expect(bob.receivedStreamsFrom()).not.toContain('alice')
    })

    it("arrêter le partage d'écran d'A laisse sa webcam vivante chez B", async () => {
        const alice = await spawn({ slug: 'alice' })
        const bob = await spawn({ slug: 'bob' })

        await connectRoom([alice, bob])
        await alice.api.startWebcamStream()
        await alice.api.startScreenCapture()
        await connectRoom([alice, bob])

        expect(bob.receivedStreamsFrom()).toContain('alice')
        expect(bob.receivedScreensFrom()).toContain('alice')

        alice.api.stopScreenCapture()
        await settle()

        // Symétrique du test précédent : `stopScreenCapture` ferme explicitement le type
        // 'screen' (jamais `currentType`) et conserve délibérément la file de signaux
        // « pour le stream webcam actif ».
        expect(bob.receivedStreamsFrom()).toContain('alice')
        expect(bob.receivedScreensFrom()).not.toContain('alice')
    })

    it("A qui relance sa diffusion réapparaît chez B", async () => {
        const alice = await spawn({ slug: 'alice' })
        const bob = await spawn({ slug: 'bob' })

        await connectRoom([alice, bob])
        await alice.api.startWebcamStream()
        await connectRoom([alice, bob])
        expect(bob.receivedStreamsFrom()).toContain('alice')

        alice.api.stopWebcamStream()
        await settle()
        expect(bob.receivedStreamsFrom()).not.toContain('alice')

        // La mémoire `served` (qui empêchait toute ré-attente) a été retirée avec le
        // passage à l'annonce protocolaire, justement pour que ce cas refonctionne.
        await alice.api.startWebcamStream()
        await connectRoom([alice, bob])

        expect(bob.receivedStreamsFrom()).toContain('alice')
    })
})
