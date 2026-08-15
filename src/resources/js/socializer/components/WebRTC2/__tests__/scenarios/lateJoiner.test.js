/**
 * lateJoiner.test.js — « A diffuse, B arrive, B ne voit rien »
 *
 * LE symptôme du package. Cinq incendies 🔥 de la TODOLIST en sont des instances, avec
 * cinq causes racines différentes (routage qui abandonne le signal, retry annulé trop
 * tôt, peerId périmé collant, purge élargie, `return` prématuré entre deux tentatives).
 * Aucun test de couche isolée ne peut l'observer : il ne se manifeste qu'entre deux
 * pairs réels, et il n'est vrai ou faux que vu **de B**.
 *
 * Ces tests assertent donc uniquement sur le fait métier : « B a-t-il le flux d'A ? ».
 * Peu importe par quel chemin il arrive (signalisation ou moteur de retry) — c'est
 * précisément ce qui les rend robustes aux refactos internes.
 *
 * ⚠️ L'asymétrie qui rend ce scénario piégeux : B, sans flux local, ressort de
 * `connectToPeer` par un `return true` sans rien ouvrir. C'est donc **A** qui doit
 * appeler `peer.call(B, sonFlux)`. Un signal perdu côté A = un flux jamais vu par B,
 * définitivement — `PEER_CONNECT_TO_REMOTE_PEER` n'est jamais re-livré.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('~estarter/services/AjaxService.js', () => ({
    useAjaxService: () => globalThis[Symbol.for('webrtc2.test.signalingServer')].createClient(),
}))

import { createPeerBus } from '../__mocks__/peerjs.js'
import { createFakeSignalingServer } from '../helpers/fakeSignalingServer.js'
import { createVirtualPeer, connectRoom, settle } from '../helpers/createVirtualPeer.js'
import { installFakeMedia } from '../helpers/fakeMedia.js'

describe("arrivant tardif : A diffuse déjà quand B rejoint", () => {
    let bus
    let server
    const peers = []
    const ROOM = 'room-diffusion'

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

    it('B reçoit la webcam qu\'A diffusait avant son arrivée', async () => {
        const alice = await spawn({ slug: 'alice' })

        // A diffuse, seule dans la room.
        await connectRoom([alice])
        await alice.api.startWebcamStream()
        await settle()

        // B arrive après coup.
        const bob = await spawn({ slug: 'bob' })
        await connectRoom([alice, bob])

        expect(bob.receivedStreamsFrom()).toContain('alice')
    })

    it("B reçoit le partage d'écran quand A ne partage QUE son écran", async () => {
        const alice = await spawn({ slug: 'alice' })

        await connectRoom([alice])
        // Aucun flux webcam : le type principal n'aura jamais de flux à émettre.
        // C'est le cas qui a cassé deux fois — et le trou de couverture historique,
        // aucun test n'ayant jamais eu A capturant l'écran SANS webcam active.
        await alice.api.startScreenCapture()
        await settle()

        const bob = await spawn({ slug: 'bob' })
        await connectRoom([alice, bob])

        expect(bob.receivedScreensFrom()).toContain('alice')
    })

    it("B reçoit les DEUX flux quand A diffuse webcam + écran", async () => {
        const alice = await spawn({ slug: 'alice' })

        await connectRoom([alice])
        await alice.api.startWebcamStream()
        await alice.api.startScreenCapture()
        await settle()

        const bob = await spawn({ slug: 'bob' })
        await connectRoom([alice, bob])

        expect(bob.receivedStreamsFrom()).toContain('alice')
        expect(bob.receivedScreensFrom()).toContain('alice')
    })

    it('un troisième arrivant reçoit aussi le flux (mesh, pas seulement le premier)', async () => {
        const alice = await spawn({ slug: 'alice' })

        await connectRoom([alice])
        await alice.api.startWebcamStream()
        await settle()

        const bob = await spawn({ slug: 'bob' })
        await connectRoom([alice, bob])

        const carol = await spawn({ slug: 'carol' })
        await connectRoom([alice, bob, carol])

        expect(bob.receivedStreamsFrom()).toContain('alice')
        expect(carol.receivedStreamsFrom()).toContain('alice')
    })

    it("B reçoit le flux quand la demande de peerId d'A précède sa présence", async () => {
        const alice = await spawn({ slug: 'alice' })

        await connectRoom([alice])
        await alice.api.startWebcamStream()
        await settle()

        const bob = await spawn({ slug: 'bob' })

        // ⚠️ Présence livrée à A **puis** à B, et non dans le même tick comme le fait
        // `connectRoom`. C'est l'ordre de production, et il n'est pas le fruit du hasard :
        // chez B, `syncUsersConnections` attend `waitForMeReady` — donc le peerId local —
        // AVANT d'écrire `usersInRoom`, alors que la demande d'A ne coûte qu'un
        // aller-retour HTTP + Reverb. La demande atterrit donc régulièrement dans la
        // fenêtre où B connaît son peerId mais pas encore la composition de sa room.
        //
        // Le harnais ne peut pas voir ça avec `connectRoom` (présence concurrente, cf. son
        // en-tête) : la fenêtre y est fermée avant d'être ouverte.
        const users = [{ slug: 'alice' }, { slug: 'bob' }]
        await alice.api.syncUsersConnections(users)
        await settle()
        await bob.api.syncUsersConnections(users)
        await settle()

        expect(bob.receivedStreamsFrom()).toContain('alice')
    })

    it("B est averti qu'A diffuse (annonce de présence), pas seulement servi", async () => {
        const alice = await spawn({ slug: 'alice' })

        await connectRoom([alice])
        await alice.api.startWebcamStream()
        await settle()

        const bob = await spawn({ slug: 'bob' })
        await connectRoom([alice, bob])

        // `announcedStreamPeers` pilote le spinner d'attente : un pair annoncé mais pas
        // encore servi doit afficher une vignette, un pair silencieux ne doit rien
        // afficher. C'est ce fait qui a remplacé l'heuristique « tout membre sans flux ».
        expect(bob.api.announcedStreamPeers.value).toContain('alice')
    })
})
