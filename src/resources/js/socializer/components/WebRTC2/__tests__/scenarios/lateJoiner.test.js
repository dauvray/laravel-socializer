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

import {
    createPeerBus,
    createMockDataConnection,
    createMockMediaConnection,
} from '../__mocks__/peerjs.js'
import { createFakeSignalingServer } from '../helpers/fakeSignalingServer.js'
import { createFakePresenceChannel } from '../helpers/createFakePresenceChannel.js'
import { createVirtualPeer, connectRoom, settle } from '../helpers/createVirtualPeer.js'
import { installFakeMedia } from '../helpers/fakeMedia.js'
import { ENDPOINTS } from '~socializer/components/WebRTC2/webrtc2.config.js'

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

    it("B est averti par la seule signalisation, sans qu'aucune connexion P2P ne s'ouvre", async () => {
        // Le chemin ajouté pour fermer la fenêtre d'attente perçue : les deux routes de
        // peerId embarquent l'état de diffusion de leur émetteur. On coupe donc TOUT le
        // P2P sortant d'A — ni appel média, ni canal data — pour qu'il ne reste
        // strictement aucune autre source possible : sans ce champ, B n'a rien à afficher
        // avant le premier contact, et l'attente se lit comme une panne.
        const alice = await spawn({ slug: 'alice' })

        await connectRoom([alice])
        await alice.api.startWebcamStream()
        await settle()

        // Un appel qu'aucun pair ne reçoit (pas de livraison au bus) : c'est exactement
        // l'état d'un `peer.call` en vol jamais répondu.
        alice.peerInstance.call = vi.fn((peerId, stream, options) =>
            createMockMediaConnection(options?.metadata))
        alice.peerInstance.connect = vi.fn((peerId, options) =>
            createMockDataConnection(options?.metadata))

        const bob = await spawn({ slug: 'bob' })
        await connectRoom([alice, bob])

        expect(bob.api.announcedStreamPeers.value).toContain('alice')
        // Contre-épreuve : rien n'est arrivé par un autre chemin.
        expect(bob.receivedStreamsFrom()).not.toContain('alice')
    })

    it("un membre qui ne diffuse pas n'est jamais annoncé", async () => {
        // La contre-épreuve de tout le mécanisme, et la régression à ne pas rouvrir : la
        // vignette d'attente ne doit apparaître pour personne quand personne ne diffuse.
        // Les deux pairs échangent bien leurs peerId — donc le champ voyage — mais à
        // `false`.
        const alice = await spawn({ slug: 'alice' })
        const bob = await spawn({ slug: 'bob' })

        await connectRoom([alice, bob])

        expect(bob.api.announcedStreamPeers.value).toEqual([])
        expect(alice.api.announcedStreamPeers.value).toEqual([])
    })
})

/**
 * Le cas MAJORITAIRE à l'usage, et celui qu'aucun des trois premiers chemins d'annonce ne
 * couvre : B revient dans la room avec le peerId d'A **déjà connu sous bail**.
 *
 * `useConnectionPool.requestOrConnectPeer` ne poste sur les routes de peerId que si ce
 * peerId n'est pas déjà composable. Un retour de navigation SPA à l'intérieur de
 * `REMOTE_PEER_ID_LEASE_MS` (≈55 s) se connecte donc DIRECTEMENT, des deux côtés : aucun
 * POST ne part, donc aucun porteur pour `isBroadcasting`. Et en contexte `stream`, un
 * non-diffuseur n'ouvre pas de canal data, ce qui ferme aussi `BROADCAST_STATE`. Il ne
 * restait que le `peer.call` du diffuseur — mesuré le 28/08/2026 : vignette à 8 811 ms sur
 * un run, JAMAIS sur l'autre.
 *
 * Ces tests exercent le seul porteur qui ne dépende pas de la signalisation P2P : le
 * whisper sur le canal de présence. Ils coupent les trois autres explicitement — bail chaud
 * des deux côtés (pas de POST) et P2P sortant d'A neutralisé (ni appel, ni canal data) —
 * pour qu'un vert ne puisse venir que de lui.
 */
describe("arrivant tardif : le peerId d'A est déjà connu sous bail", () => {
    let bus
    let server
    let presence
    const peers = []
    const ROOM = 'room-diffusion'

    // Un `id` autant qu'un `slug` : la charge utile d'un canal de présence porte les deux
    // (`Http\Resources\PresenceUser`), et c'est l'`id` qui rend un whisper attribuable.
    const ALICE = { id: 11, slug: 'alice' }
    const BOB = { id: 12, slug: 'bob' }

    const spawn = async (member, { withChannel = true } = {}) => {
        const peer = await createVirtualPeer({
            ...member,
            room: ROOM,
            type: 'stream',
            server,
            reverb: withChannel ? presence.subscribe(member) : null,
        })
        peers.push(peer)
        return peer
    }

    /**
     * L'état d'un retour de navigation SPA : le `Peer` de l'onglet a survécu (vérifié en
     * production, peerId identique avant/après), donc les deux pairs se composent
     * directement et la signalisation n'a plus rien à transporter.
     */
    const warmLeases = (a, b) => {
        a.peerStore.addRemotePeerId(b.slug, b.peerId)
        b.peerStore.addRemotePeerId(a.slug, a.peerId)
    }

    /** Coupe le P2P sortant : un appel et un canal valides, mais reliés à personne. */
    const muteOutgoingP2P = (peer) => {
        peer.peerInstance.call = vi.fn((peerId, stream, options) =>
            createMockMediaConnection(options?.metadata))
        peer.peerInstance.connect = vi.fn((peerId, options) =>
            createMockDataConnection(options?.metadata))
    }

    beforeEach(() => {
        bus = createPeerBus()
        server = createFakeSignalingServer()
        presence = createFakePresenceChannel()
        installFakeMedia()
    })

    afterEach(() => {
        peers.splice(0).forEach((peer) => peer.destroy())
        presence.destroy()
        server.destroy()
        bus.destroy()
    })

    it('B apprend quand même qu\'A diffuse, par le canal de présence', async () => {
        const alice = await spawn(ALICE)

        await connectRoom([alice])
        await alice.api.startWebcamStream()
        await settle()

        muteOutgoingP2P(alice)

        const bob = await spawn(BOB)
        warmLeases(alice, bob)
        server.requests.length = 0

        await connectRoom([alice, bob])

        // Le fait est arrivé…
        expect(bob.api.announcedStreamPeers.value).toContain('alice')
        // …et aucun des trois autres chemins ne peut l'expliquer : pas un seul POST de
        // peerId, donc pas de champ embarqué ; et rien n'a été livré en P2P.
        expect(server.requestsTo(ENDPOINTS.ASK_TO_PEER_ID)).toEqual([])
        expect(server.requestsTo(ENDPOINTS.RESPONSE_TO_PEER_ID)).toEqual([])
        expect(bob.receivedStreamsFrom()).not.toContain('alice')
    })

    it('sans canal de présence, B n\'apprend RIEN — l\'état d\'avant ce transport', async () => {
        // ⭐ La contre-épreuve, et la mesure du 28/08 sous forme de test : mêmes coupures,
        // pas de canal fourni par l'hôte. C'est aussi ce qui garantit que le test ci-dessus
        // ne verdit pas par un chemin resté ouvert.
        const alice = await spawn(ALICE, { withChannel: false })

        await connectRoom([alice])
        await alice.api.startWebcamStream()
        await settle()

        muteOutgoingP2P(alice)

        const bob = await spawn(BOB, { withChannel: false })
        warmLeases(alice, bob)

        await connectRoom([alice, bob])

        expect(bob.api.announcedStreamPeers.value).toEqual([])
    })

    it('un membre qui ne diffuse pas n\'est jamais annoncé par le canal', async () => {
        // La contre-épreuve du transport lui-même : le canal existe, la présence circule,
        // et personne ne doit voir de vignette. Un whisper émis « à vide » rouvrirait
        // exactement l'heuristique que `announcedStreamsMap` a remplacée.
        const alice = await spawn(ALICE)
        const bob = await spawn(BOB)

        warmLeases(alice, bob)
        await connectRoom([alice, bob])

        expect(bob.api.announcedStreamPeers.value).toEqual([])
        expect(alice.api.announcedStreamPeers.value).toEqual([])
    })
})
