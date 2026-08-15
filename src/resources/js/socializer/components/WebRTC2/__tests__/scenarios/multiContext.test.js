/**
 * multiContext.test.js — Plusieurs contextes dans le même onglet
 *
 * La production ne monte JAMAIS un seul contexte par page : `System/Notifications.vue`
 * crée `data-app` en permanence, et chaque `MediaBroadcastProvider` monte le sien —
 * `Exemples/Home.vue` en aligne trois (un chat `data`, un chat `data` en topologie star,
 * une diffusion `stream`). Tous partagent **un** `Peer` PeerJS et **un** store Pinia.
 *
 * Ce partage est le terrain d'une famille entière de pannes : un contexte qui écrit dans
 * le store à une granularité trop grossière confisque ou détruit l'état d'un autre. Le
 * symptôme est toujours le même côté utilisateur — « A diffuse, B arrive, B ne voit
 * rien » — et aucun test à un contexte par onglet ne peut le voir, puisqu'il faut au
 * moins deux contextes pour qu'ils se marchent dessus.
 *
 * Les deux règles vérifiées ici :
 *   1. une DEMANDE de peerId appartient à un contexte (clé slug|room|type) — sinon le
 *      premier contexte à demander fait taire tous les autres ;
 *   2. un PEERID appartient à l'onglet distant, et ne s'oublie qu'une fois le pair
 *      absent de toutes les rooms — sinon le peerId d'un onglet fermé devient
 *      « collant » et l'on rappelle indéfiniment un peer mort.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('~estarter/services/AjaxService.js', () => ({
    useAjaxService: () => globalThis[Symbol.for('webrtc2.test.signalingServer')].createClient(),
}))

import { createPeerBus } from '../__mocks__/peerjs.js'
import { createFakeSignalingServer } from '../helpers/fakeSignalingServer.js'
import { createVirtualPeer, connectRoom, settle } from '../helpers/createVirtualPeer.js'
import { installFakeMedia } from '../helpers/fakeMedia.js'
import { ENDPOINTS } from '~socializer/components/WebRTC2/webrtc2.config.js'

const STREAM_ROOM = 'room-test'
const CHAT_ROOM = 'room-custom-data'

describe('plusieurs contextes dans le même onglet (forme de Exemples/Home.vue)', () => {
    let bus
    let server
    const mounted = []

    const spawn = async (config) => {
        const peer = await createVirtualPeer({ server, ...config })
        mounted.push(peer)
        return peer
    }

    /**
     * Livre la composition de la room aux contextes d'un onglet **l'un après l'autre**.
     *
     * ⚠️ C'est le point de tout ce fichier. `connectRoom` synchronise tous les contextes
     * dans le même tick : chacun lit alors le store AVANT que le voisin n'ait enregistré
     * sa demande (`addWaitingRemotePeerId` n'a lieu qu'après le POST), et la collision
     * n'a jamais lieu — un scénario concurrent reste vert même avec l'indexation fautive.
     *
     * La production est séquentielle : dans `Exemples/Home.vue`, les providers montent
     * dans l'ordre du template et s'initialisent à des ticks différents (le parent en
     * `onMounted`, le provider `stream` depuis `StreamSimpleUI`), et le canal de présence
     * re-déclenche le watcher à chaque changement. Le contexte qui sync en second lit
     * donc un store où la demande du premier est déjà posée — et se taisait.
     *
     * Ordre : contextes secondaires d'abord (les chats de Home.vue), diffusion ensuite.
     */
    const syncSequentially = async (peer, users) => {
        const contexts = [...(peer.extraContexts ?? []).map((extra) => extra.api), peer.api]
        for (const api of contexts) {
            await api.syncUsersConnections(users)
            await settle(1)
        }
    }

    beforeEach(() => {
        bus = createPeerBus()
        server = createFakeSignalingServer()
        installFakeMedia()
    })

    afterEach(() => {
        mounted.splice(0).reverse().forEach((peer) => peer.destroy())
        server.destroy()
        bus.destroy()
    })

    it("l'arrivant reçoit la diffusion alors qu'un contexte chat partage le même onglet", async () => {
        // A : onglet complet façon Home.vue — diffusion + chat, deux rooms distinctes.
        const alice = await spawn({ slug: 'alice', type: 'stream', room: STREAM_ROOM })
        alice.mountContext({ type: 'data', room: CHAT_ROOM })

        await alice.api.startWebcamStream()

        // B arrive avec la même page : mêmes deux contextes.
        const bob = await spawn({ slug: 'bob', type: 'stream', room: STREAM_ROOM })
        bob.mountContext({ type: 'data', room: CHAT_ROOM })

        const users = [{ slug: 'alice' }, { slug: 'bob' }]
        await syncSequentially(bob, users)
        await syncSequentially(alice, users)
        await settle(4)

        // Le fait métier. Avant le correctif, le contexte `stream` d'A lisait la demande
        // de peerId de son contexte `data` (clé = slug seul), en concluait qu'une demande
        // était « déjà en vol » et n'émettait jamais la sienne : A ne connaissait donc
        // pas le peerId de B dans la room de diffusion, et n'appelait personne.
        expect(bob.receivedStreamsFrom()).toContain('alice')
    })

    it('chaque contexte émet SA demande de peerId, sans être confisqué par le voisin', async () => {
        const alice = await spawn({ slug: 'alice', type: 'stream', room: STREAM_ROOM })
        alice.mountContext({ type: 'data', room: CHAT_ROOM })

        const bob = await spawn({ slug: 'bob', type: 'stream', room: STREAM_ROOM })
        bob.mountContext({ type: 'data', room: CHAT_ROOM })

        const users = [{ slug: 'alice' }, { slug: 'bob' }]
        await syncSequentially(bob, users)
        await syncSequentially(alice, users)
        await settle(2)

        // Les deux rooms d'alice ont bien demandé le peerId de bob. Une seule ligne ici
        // = un contexte muet, et c'est exactement le symptôme rapporté en production
        // (deux réponses `room-custom-data`, aucune pour la room de diffusion).
        const asked = server
            .requestsTo(ENDPOINTS.ASK_TO_PEER_ID)
            .filter((request) => request.from === 'alice' && request.data.toUserSlug === 'bob')
            .map((request) => `${request.data.type}-${request.data.room}`)

        expect(new Set(asked)).toEqual(new Set([`stream-${STREAM_ROOM}`, `data-${CHAT_ROOM}`]))
    })

    it('un contexte qui se démonte emporte SES demandes en vol, pas celles du voisin', async () => {
        const alice = await spawn({ slug: 'alice', type: 'stream', room: STREAM_ROOM })
        const chat = alice.mountContext({ type: 'data', room: CHAT_ROOM })

        // Bob est annoncé présent mais n'a aucun onglet : les deux contextes émettent
        // leur demande de peerId et restent en attente — le vrai chemin d'émission,
        // pas une entrée fabriquée à la main.
        const users = [{ slug: 'alice' }, { slug: 'bob' }]
        await Promise.all([
            alice.api.syncUsersConnections(users),
            chat.api.syncUsersConnections(users),
        ])
        await settle(1)

        expect(alice.peerStore.getWaitingRemotePeerIds('bob').map((e) => e.room).sort())
            .toEqual([CHAT_ROOM, STREAM_ROOM].sort())

        // Le provider de chat est démonté (navigation SPA, v-if, HMR…). Sa demande
        // orpheline ne doit pas rester dans le store : le contexte remonté à sa place la
        // lirait comme la sienne et n'émettrait jamais la sienne propre.
        chat.api.cleanupPeerConnection()
        chat.app.unmount()
        alice.extraContexts.length = 0
        await settle(1)

        const stillPending = alice.peerStore.getWaitingRemotePeerIds('bob')
        expect(stillPending.map((entry) => entry.room)).toEqual([STREAM_ROOM])
    })

    it('le peerId survit au départ dans UNE room tant qu\'une autre déclare le pair', async () => {
        const alice = await spawn({ slug: 'alice', type: 'stream', room: STREAM_ROOM })
        alice.mountContext({ type: 'data', room: CHAT_ROOM })

        const bob = await spawn({ slug: 'bob', type: 'stream', room: STREAM_ROOM })
        bob.mountContext({ type: 'data', room: CHAT_ROOM })

        await connectRoom([alice, bob])
        expect(alice.peerStore.getRemotePeerId('bob')).toBe('peer-bob')

        // Bob quitte la seule room de diffusion (son contexte chat reste présent).
        await alice.api.syncUsersConnections([{ slug: 'alice' }])
        await settle(1)

        // Le contexte chat le voit encore : son peerId lui est toujours nécessaire.
        expect(alice.peerStore.getRemotePeerId('bob')).toBe('peer-bob')
    })

    it("le peerId d'un onglet fermé est oublié — il ne devient pas « collant »", async () => {
        const alice = await spawn({ slug: 'alice', type: 'stream', room: STREAM_ROOM })
        alice.mountContext({ type: 'data', room: CHAT_ROOM })

        const bob = await spawn({ slug: 'bob', type: 'stream', room: STREAM_ROOM })
        bob.mountContext({ type: 'data', room: CHAT_ROOM })

        await connectRoom([alice, bob])
        expect(alice.peerStore.getRemotePeerId('bob')).toBe('peer-bob')

        // Bob ferme son onglet : il disparaît de la présence, donc de TOUTES les rooms.
        server.goOffline('bob')
        bob.peerInstance.destroy()
        await connectRoom([alice])

        // Régression historique : le prédicat portait sur la map `connections`, où un
        // second contexte gardait toujours une trace du pair — `removeRemotePeerId`
        // devenait un no-op permanent et le peerId mort survivait. Au retour de bob avec
        // un nouveau peerId, alice rappelait l'ancien (« Could not connect to peer
        // <uuid> ») sans jamais redemander le frais, puisqu'elle croyait en avoir un.
        expect(alice.peerStore.hasRemotePeerId('bob')).toBe(false)
    })

    it('B revient avec un nouveau peerId et A le rejoint dans les deux rooms', async () => {
        const alice = await spawn({ slug: 'alice', type: 'stream', room: STREAM_ROOM })
        const aliceChat = alice.mountContext({ type: 'data', room: CHAT_ROOM })
        await alice.api.startWebcamStream()

        const bobV1 = await spawn({ slug: 'bob', type: 'stream', room: STREAM_ROOM })
        bobV1.mountContext({ type: 'data', room: CHAT_ROOM })
        await connectRoom([alice, bobV1])
        expect(bobV1.receivedStreamsFrom()).toContain('alice')

        // Bob recharge sa page : nouvel onglet, nouveau peerId.
        server.goOffline('bob')
        bobV1.peerInstance.destroy()
        await connectRoom([alice])
        await settle(2)

        server.goOnline('bob')
        const bobV2 = await spawn({ slug: 'bob', type: 'stream', room: STREAM_ROOM, peerId: 'peer-bob-v2' })
        bobV2.mountContext({ type: 'data', room: CHAT_ROOM })
        await connectRoom([alice, bobV2])
        await connectRoom([alice, bobV2])

        // Le flux repart vers le nouvel onglet, et le chat aussi : les deux contextes
        // d'alice ont bien renégocié, aucun n'est resté bloqué sur l'identité morte.
        expect(bobV2.receivedStreamsFrom()).toContain('alice')
        expect(alice.peerStore.getRemotePeerId('bob')).toBe('peer-bob-v2')
        expect(aliceChat.api.usersInRoom.value).toContain('bob')
    })
})
