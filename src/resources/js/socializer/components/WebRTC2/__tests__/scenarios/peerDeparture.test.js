/**
 * peerDeparture.test.js — Départs et peerId périmés
 *
 * Deux incendies 🔥 de la TODOLIST :
 *
 * 1. **Coupure brutale** (onglet fermé, donc SANS signal serveur `CloseConnectionToPeerID`).
 *    `handleStreamRemoved` ne coupait ni les retries ni les connexions du pair parti :
 *    son `remotePeerId` restait enregistré et le moteur de retry reconnectait
 *    indéfiniment un pair déjà parti. Les deux transports de la nouvelle
 *    (signal serveur / fermeture PeerJS) doivent converger vers `handleRemoteDeparture`.
 *
 * 2. **peerId périmé « collant »**. Qu'un peerId devienne périmé est normal (chaque
 *    `new Peer()` reçoit un UUID neuf, et le peer d'un onglet inactif est détruit au bout
 *    de `PEER_DESTROY_DELAY_MS`). Le bug était que plus rien ne pouvait l'invalider :
 *    impasse permanente, pas dégradation temporaire.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('~estarter/services/AjaxService.js', () => ({
    useAjaxService: () => globalThis[Symbol.for('webrtc2.test.signalingServer')].createClient(),
}))

import { createPeerBus } from '../__mocks__/peerjs.js'
import { createFakeSignalingServer } from '../helpers/fakeSignalingServer.js'
import { createVirtualPeer, connectRoom, settle } from '../helpers/createVirtualPeer.js'
import { installFakeMedia } from '../helpers/fakeMedia.js'

describe("départ d'un pair", () => {
    let bus
    let server
    const peers = []
    const ROOM = 'room-departure'

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

    it("coupure brutale d'A : B retire son flux sans signal serveur", async () => {
        const alice = await spawn({ slug: 'alice' })
        const bob = await spawn({ slug: 'bob' })

        await connectRoom([alice, bob])
        await alice.api.startWebcamStream()
        await connectRoom([alice, bob])
        expect(bob.receivedStreamsFrom()).toContain('alice')

        // Onglet fermé : le pair disparaît du bus PeerJS et n'émet plus aucun signal.
        // Seule la fermeture des connexions informe B — c'est le chemin qui oubliait
        // de couper les retries.
        server.goOffline('alice')
        alice.peerInstance.destroy()
        await settle()

        expect(bob.receivedStreamsFrom()).not.toContain('alice')
    })

    it("B ne garde pas le peerId d'un pair qui a quitté la room", async () => {
        const alice = await spawn({ slug: 'alice' })
        const bob = await spawn({ slug: 'bob' })

        await connectRoom([alice, bob])
        expect(bob.peerStore.getRemotePeerId('alice')).toBe(alice.peerId)

        // La room ne contient plus qu'un membre : alice est partie.
        await bob.api.syncUsersConnections([{ slug: 'bob' }])
        await settle()

        expect(bob.api.usersInRoom.value).not.toContain('alice')
        expect(bob.peerStore.getRemotePeerId('alice')).toBeFalsy()
    })

    it('A revient avec un nouveau peerId : B invalide le périmé et reçoit son flux', async () => {
        const aliceV1 = await spawn({ slug: 'alice', peerId: 'peer-alice-v1' })
        const bob = await spawn({ slug: 'bob' })

        await connectRoom([aliceV1, bob])
        expect(bob.peerStore.getRemotePeerId('alice')).toBe('peer-alice-v1')

        // L'onglet d'alice se ferme : son Peer est détruit (il disparaît du serveur de
        // signalisation PeerJS) et ses connexions tombent. B conserve le mapping.
        server.goOffline('alice')
        // `destroy()` ferme aussi les connexions du pair, des DEUX côtés — c'est ce que
        // fait PeerJS, et c'est la seule information dont B dispose ici.
        aliceV1.peerInstance.destroy()
        await settle()

        // Alice rouvre l'application : nouvel onglet, nouveau peerId. Rien côté B ne
        // sait que l'ancien est mort — c'est le cas où le mapping devenait « collant »
        // et le pair définitivement injoignable.
        server.goOnline('alice')
        const aliceV2 = await spawn({ slug: 'alice', peerId: 'peer-alice-v2' })
        await connectRoom([aliceV2, bob])
        await aliceV2.api.startWebcamStream()
        await connectRoom([aliceV2, bob])

        // Le fait métier, et le seul qui compte : B voit la diffusion d'alice.
        //
        // ⚠️ Ne PAS asserter ici `getRemotePeerId('alice') === 'peer-alice-v2'`. En mode
        // stream c'est A qui appelle B (B, sans flux local, n'ouvre rien), donc B n'a
        // aucune raison de retenter le peerId mort : son mapping peut rester périmé sans
        // aucune conséquence tant que la connexion entrante vit. Asserter dessus
        // testerait un détail d'implémentation et échouerait sur un système sain.
        // Le rafraîchissement du mapping est couvert par le test suivant, où B est
        // l'initiateur — c'est-à-dire dans le seul cas où il compte vraiment.
        expect(bob.receivedStreamsFrom()).toContain('alice')
    })

    it("B, initiateur, sort d'un peerId mort et rouvre le canal (mode data)", async () => {
        // Mode data : les deux pairs se connectent mutuellement, donc B initie vraiment.
        // C'est la configuration où un peerId périmé devenait une impasse PERMANENTE —
        // `requestOrConnectPeer` ne redemandait un peerId que s'il n'en avait aucun.
        const received = []
        const aliceV1 = await spawn({ slug: 'alice', type: 'data', peerId: 'peer-alice-v1' })
        const bob = await spawn({
            slug: 'bob',
            type: 'data',
            callbacks: { onDataReceived: (data) => received.push(data) },
        })

        await connectRoom([aliceV1, bob])
        expect(bob.peerStore.getRemotePeerId('alice')).toBe('peer-alice-v1')

        // L'onglet d'alice se ferme et la présence l'annonce partie.
        server.goOffline('alice')
        aliceV1.peerInstance.destroy()
        await bob.api.syncUsersConnections([{ slug: 'bob' }])
        await settle()

        // Reproduction du mode de défaillance documenté : l'invalidation du peerId est
        // *annulée* parce qu'un AUTRE contexte partageant le même store Pinia référence
        // encore le pair (`System/Notifications.vue` monte en permanence un contexte
        // `data-app`). `removeRemotePeerId` étant conditionnel, le mapping mort survit
        // au départ. On en reproduit ici l'effet exact, sans monter le second contexte.
        bob.peerStore.addRemotePeerId('alice', 'peer-alice-v1')

        // Alice rouvre l'application : nouvel onglet, nouveau peerId. Elle est « nouvelle »
        // pour B, qui initie donc la connexion — avec un peerId mort en poche.
        server.goOnline('alice')
        const aliceV2 = await spawn({ slug: 'alice', type: 'data', peerId: 'peer-alice-v2' })
        await connectRoom([aliceV2, bob])

        // Le mapping mort a été invalidé puis remplacé par le frais : sans ça, B
        // rappellerait `peer-alice-v1` indéfiniment — impasse permanente, pas
        // dégradation temporaire.
        expect(bob.peerStore.getRemotePeerId('alice')).toBe('peer-alice-v2')

        // Et le canal fonctionne réellement.
        aliceV2.api.sendDataToPeer({ message: 'me revoilà' })
        await settle()
        expect(received).toContainEqual({ message: 'me revoilà' })
    })
})
