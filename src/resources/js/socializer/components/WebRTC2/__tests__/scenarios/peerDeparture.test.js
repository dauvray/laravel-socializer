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
import { ENDPOINTS, REMOTE_PEER_ID_LEASE_MS } from '~socializer/components/WebRTC2/webrtc2.config.js'

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

        expect(bob.api.remotePeers.value).not.toContain('alice')
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

    it("A recharge sans que B voie son départ : B, diffuseur, ré-appelle et A reçoit son flux", async () => {
        // Le trou que le bail borne sans le fermer, et le seul où PERSONNE ne rattrape.
        //
        // Aucun tour de présence n'annonce le départ d'A : Reverb supprime `member_removed`
        // quand la connexion neuve précède le ramassage de l'ancienne
        // (`InteractsWithPresenceChannels::userIsSubscribed`), et une coupure de présence
        // (reconnect Echo) rejoue `here()` avec la liste complète. A est donc dans
        // `previousSlugs` ET `nextSlugs` : `newUsers` et `removedUsers` sont vides tous les
        // deux, et un fan-out fondé sur `newUsers` seul n'ouvre rien.
        //
        // ⚠️ B diffuse, PAS A — et c'est tout le test. En mode stream le flux ne part que du
        // diffuseur : A, sans flux local, n'ouvre aucun appel. Asserter sur ce qu'initie A
        // serait vert sans correctif, A étant un contexte neuf pour qui tout le monde est
        // « nouveau ». La seule direction qui puisse rougir est celle que B possède.
        const aliceV1 = await spawn({ slug: 'alice', peerId: 'peer-alice-v1' })
        const bob = await spawn({ slug: 'bob' })

        await connectRoom([aliceV1, bob])
        await bob.api.startWebcamStream()
        await connectRoom([aliceV1, bob])
        expect(aliceV1.receivedStreamsFrom()).toContain('bob')

        // L'onglet d'alice se ferme : son Peer disparaît du bus PeerJS et ses connexions
        // tombent des deux côtés. B l'apprend par la fermeture, jamais par la présence —
        // `handleRemoteDeparture` ne touche donc ni `remotePeers` ni le mapping (le veto de
        // présence de `removeRemotePeerId` s'applique : alice est encore membre).
        server.goOffline('alice')
        aliceV1.peerInstance.destroy()
        await settle()

        // ⚠️ AUCUN `syncUsersConnections` intermédiaire ici, contrairement aux deux
        // scénarios voisins : c'est cette béquille qui rend le revenant « nouveau ». Sans
        // elle, la composition vue par B ne bouge pas d'un iota entre le départ et le
        // retour — exactement le cas de production.
        server.goOnline('alice')
        const aliceV2 = await spawn({ slug: 'alice', peerId: 'peer-alice-v2' })
        // `rounds` plus large que par défaut : la chaîne est plus longue qu'un
        // établissement nominal — B compose le peerId mort, `peer-unavailable` l'invalide,
        // B redemande la signalisation, puis rappelle sur le peerId frais.
        await connectRoom([aliceV2, bob], { rounds: 8 })

        // La présence n'a rien signalé : alice n'a jamais quitté la composition de B.
        // C'est la précondition du test, pas son objet — si elle tombe, le test ne teste
        // plus le bon trou.
        expect(bob.api.remotePeers.value).toContain('alice')

        // Le fait métier : alice revenue reçoit la diffusion de bob.
        expect(aliceV2.receivedStreamsFrom()).toContain('bob')
    })

    it("⭐ A recharge en chevauchement : la PERTE de la connexion suffit à ce que B rappelle", async () => {
        // Le cas (b) que le fan-out réconciliant BORNE sans le fermer : il n'est réparé
        // qu'au PROCHAIN tour de présence, quel qu'en soit le motif. Ici il n'y en a
        // aucun — et c'est exactement la production.
        //
        // ⚠️ CE QUI SÉPARE CE TEST DU PRÉCÉDENT tient en une ligne : le voisin finit par
        // `connectRoom([aliceV2, bob])`, qui donne à B un tour de présence. C'est ce tour
        // qui déclenche la réconciliation, donc le voisin épingle la réconciliation, pas
        // le rappel. Ici B n'en reçoit JAMAIS : le seul fait qui lui parvienne est la
        // fermeture de sa propre connexion sortante. Le second mécanisme est ainsi
        // neutralisé par construction, et rien d'autre ne peut rendre ce test vert.
        //
        // ⚠️ L'ORDRE est le cas (b) lui-même : le nouvel onglet monte AVANT que l'ancien
        // soit ramassé. C'est cette superposition qui fait taire Reverb
        // (`InteractsWithPresenceChannels::userIsSubscribed` : pas de `member_removed`
        // tant qu'une autre connexion tient, pas de `member_added` sur un déjà-abonné).
        // Inverser l'ordre ne testerait plus rien : B poserait sa demande de peerId dans
        // le vide, personne n'étant en face pour y répondre.
        //
        // ⚠️ B diffuse, PAS A — même raison qu'au test précédent : en mode stream, la
        // seule direction qui puisse rougir est celle que possède le survivant.
        const aliceV1 = await spawn({ slug: 'alice', peerId: 'peer-alice-v1' })
        const bob = await spawn({ slug: 'bob' })

        await connectRoom([aliceV1, bob])
        await bob.api.startWebcamStream()
        await connectRoom([aliceV1, bob])
        expect(aliceV1.receivedStreamsFrom()).toContain('bob')

        // ⚠️ ATTENTE RÉELLE, et elle EST le sujet. Le trou ne s'ouvre qu'en régime
        // ÉTABLI : tant que le moteur de retry veille sur alice, il redemanderait de
        // lui-même et rien ne serait à réparer. Il ne s'éteint qu'à son premier réveil
        // (`_handleConnectionAttempt` → `true` sur connexion établie), planifié à
        // `1000·2^0 + jitter` ≤ 1299 ms. Sans cette attente le test serait vert AVANT le
        // correctif, par un mécanisme qui n'existe pas une seconde plus tard en
        // production. `settle()` n'y suffit pas : il draine les tâches à échéance 0, pas
        // les minuteurs. Et pas de `useFakeTimers` — il gèlerait le faux serveur.
        await new Promise((resolve) => setTimeout(resolve, 1500))

        // Alice recharge : le nouvel onglet monte et reprend la signalisation de son slug
        // pendant que l'ancien vit encore. Sa présence à ELLE est neuve (`here()` complet
        // au montage) — celle de B ne bouge pas.
        const aliceV2 = await spawn({ slug: 'alice', peerId: 'peer-alice-v2' })
        await aliceV2.api.syncUsersConnections([{ slug: 'alice' }, { slug: 'bob' }])
        await settle()

        // Rien n'est encore arrivé chez B : A n'a pas de flux local, donc elle n'ouvre
        // aucun appel (`connectToPeer` sort par `true` sans rien ouvrir), et son mapping
        // de A reste sur le peerId mort. C'est la précondition du trou.
        expect(bob.peerStore.getRemotePeerId('alice')).toBe('peer-alice-v1')

        // Ramassage de l'ancien onglet : la connexion sortante de B tombe. C'est le SEUL
        // fait qui lui parvienne — et il ne passe pas par `handleRemoteDeparture`, que le
        // wrap de l'orchestrateur réserve aux fermetures entrantes.
        aliceV1.peerInstance.destroy()
        await settle(8)

        // La présence n'a rien signalé : alice n'a jamais quitté la composition de B.
        // Précondition, pas objet du test — si elle tombe, le test ne teste plus le trou.
        expect(bob.api.remotePeers.value).toContain('alice')

        // Le fait métier : alice revenue reçoit la diffusion de bob, sans qu'aucun tour
        // de présence n'ait eu lieu chez lui.
        expect(aliceV2.receivedStreamsFrom()).toContain('bob')
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

        // On REPOSE le mapping mort à la main, pour placer le pair dans l'état que ce cas
        // veut éprouver : « B possède un peerId périmé et doit en sortir seul ».
        //
        // ⚠️ La justification d'origine était fausse et ne doit pas revenir : elle invoquait
        // le contexte `data-app` de `System/Notifications.vue` comme second déclarant qui
        // annulerait `removeRemotePeerId`. Ce contexte n'appelle JAMAIS `watchUsers`, donc
        // `roomMembers['data-app']` n'existe pas et n'a jamais pu opposer ce veto —
        // l'affirmation datait du prédicat `connections`, où elle était vraie. Le semis
        // ci-dessous est donc un ARTIFICE de mise en état, pas la reproduction d'un
        // mécanisme (cf. la décision du 29/08 dans `docs/modules/webrtc2/securite.md`).
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

    it("⭐ le bail évite l'appel mort : B redemande au lieu de composer (mode data)", async () => {
        // Même mise en place que le test précédent, à UN détail près : le mapping périmé
        // est vieux de plus d'un bail. La différence porte donc entièrement sur ce que le
        // bail change — et ce n'est pas l'issue (la recovery `peer-unavailable` guérissait
        // déjà, cf. le test précédent) mais son COÛT : un appel vers un numéro mort, une
        // erreur console, un tour de backoff, et une MediaConnection à moitié ouverte que
        // `hasOpenConnection` compte comme ouverte.
        const received = []
        const aliceV1 = await spawn({ slug: 'alice', type: 'data', peerId: 'peer-alice-v1' })
        const bob = await spawn({
            slug: 'bob',
            type: 'data',
            callbacks: { onDataReceived: (data) => received.push(data) },
        })

        await connectRoom([aliceV1, bob])
        expect(bob.peerStore.getRemotePeerId('alice')).toBe('peer-alice-v1')

        server.goOffline('alice')
        aliceV1.peerInstance.destroy()
        await bob.api.syncUsersConnections([{ slug: 'bob' }])
        await settle()

        // Le veto de présence, reproduit comme au test précédent : un autre contexte de
        // l'onglet référence encore alice, donc `removeRemotePeerId` ne fait rien et le
        // mapping mort survit au départ.
        bob.peerStore.addRemotePeerId('alice', 'peer-alice-v1')

        // ⚠️ `setSystemTime` SANS `useFakeTimers` : il ne mocke que `Date`, donc le
        // `setTimeout(…, 0)` du faux serveur et le drainage de `settle()` continuent de
        // tourner. `useFakeTimers` les gèlerait et bloquerait le scénario.
        // Deux effets de bord, tous deux dans le sens du test : la fenêtre de cadence
        // d'`/ask-to-peer-id` repart à zéro, et les demandes en vol deviennent stale —
        // c'est bien un vrai POST qu'on exige ici.
        vi.setSystemTime(Date.now() + REMOTE_PEER_ID_LEASE_MS + 1)
        bob.peerInstance.connect.mockClear()

        server.goOnline('alice')
        const aliceV2 = await spawn({ slug: 'alice', type: 'data', peerId: 'peer-alice-v2' })
        await connectRoom([aliceV2, bob])

        // ⭐ Le fait qui compte, et le seul qui rougisse sans le bail : bob n'a jamais
        // composé le numéro mort. Mesuré sur le `Peer` lui-même — un log console
        // dépendrait du texte d'un message d'erreur de PeerJS.
        const appelsMorts = bob.peerInstance.connect.mock.calls
            .filter(([peerId]) => peerId === 'peer-alice-v1')
        expect(appelsMorts).toHaveLength(0)

        // Il a redemandé la signalisation à la place.
        const demandes = server.requestsTo(ENDPOINTS.ASK_TO_PEER_ID)
            .filter((request) => request.from === 'bob' && request.data?.toUserSlug === 'alice')
        expect(demandes.length).toBeGreaterThan(0)

        // Et l'issue reste la même qu'avec la recovery : le canal vit sur le peerId frais.
        expect(bob.peerStore.getRemotePeerId('alice')).toBe('peer-alice-v2')
        aliceV2.api.sendDataToPeer({ message: 'me revoilà' })
        await settle()
        expect(received).toContainEqual({ message: 'me revoilà' })

        vi.useRealTimers()
    })
})
