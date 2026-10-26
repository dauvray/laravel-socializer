/**
 * starTopology.test.js — Le hub arrive après ses clients
 *
 * Le seul chemin de production de la topologie star qui soit silencieux PAR CONCEPTION :
 * un client dont le hub est absent ne le compose pas, sans rien tenter ni journaliser, et
 * c'est le tour de présence qui voit arriver le hub qui rétablit tout
 * (`docs/modules/webrtc2/api.md` § Topologies). Chaque moitié est épinglée en unitaire —
 * le prédicat du client (`useConnectionPool.test.js`), l'émission (`usePeerTransport.star`),
 * la retransmission (`usePeerTransport.forwardStar`). La TRANSITION ne l'était à aucun
 * étage, et elle n'est vraie ou fausse que vue d'un AUTRE client : en star, un client ne
 * parle qu'au hub.
 *
 * Le fait métier asserté est donc « le message d'alice arrive chez bob, déballé, par le
 * hub » — et chacun des trois termes a son assertion :
 *
 *   - **arrive** : la boîte de bob, ce que l'app verrait ;
 *   - **déballé** : bob reçoit le payload, pas l'enveloppe `__starRoute` — un client qui la
 *     recevrait telle quelle la passerait à l'app (`routeIncomingData` ne déballe que chez
 *     le hub) ;
 *   - **par le hub** : aucune demande de peerId n'a jamais été échangée entre les deux
 *     clients, donc aucun canal direct n'a pu s'ouvrir.
 *
 * ⚠️ Ne pas retirer la troisième comme redondante : harnais forcé en `mesh`, le message
 * ARRIVE quand même, déballé — c'est elle seule qui rougit dans les cas de relais.
 *
 * ── Contre-épreuves, mesurées le 26/10/2026 ─────────────────────────────────────
 *
 * Ces cas sont nés VERTS : ils couvrent un comportement existant, ils ne reproduisent pas
 * un bug. Leur valeur tient donc aux mutations ci-dessous, une à la fois, ce fichier seul :
 *
 *   - le client ne compose plus le hub (branche client du pool)
 *         → contrôle, transition, séquentiel
 *   - le client compose le hub même ABSENT — l'appel inconditionnel d'avant 8f34f48, à la
 *     lettre comme avec `preserveRetry` : mêmes rouges
 *         → hub absent, transition, séquentiel
 *   - le hub ne retransmet plus (`routeIncomingData`)
 *         → contrôle, transition, séquentiel
 *   - le hub retransmet l'enveloppe au lieu du payload
 *         → contrôle, transition, séquentiel (bob reçoit `{ __starRoute: true, … }`)
 *   - l'arrivant n'attend plus sa première présence avant de répondre
 *     (`usePeerCore.responseRemotePeerConnection`)
 *         → séquentiel SEUL
 *   - `isHubConnected` toujours vrai
 *         → hub absent, transition
 *   - harnais forcé en `mesh`
 *         → les quatre
 *
 * Deux lignes disent plus que leur mutation :
 *
 *   - **L'appel inconditionnel ne coûtait pas qu'un POST : il RETARDAIT la transition.** La
 *     demande partie vers le hub absent reste en attente sans réponse, et `requestOrConnectPeer`
 *     n'en repose pas tant qu'elle l'est : le tour de présence qui voit arriver le hub ne
 *     compose rien. Seul le retry la repose, une fois la demande plus vieille que
 *     `SIGNALING_STALE_MS` (branche « signalisation stale » de `_handleConnectionAttempt`) —
 *     bien après la fenêtre de ce scénario, et chaque `sendData` du client est jeté d'ici là.
 *     La durée mesurée est dans `work/webrtc2-todo.md`.
 *   - **Seul le cas séquentiel voit l'attente de l'arrivant** : `connectRoom` livre la
 *     présence à tous dans le même tick et referme la fenêtre avant de l'ouvrir.
 *
 * ── Ce que ce fichier n'asserte PAS, délibérément ───────────────────────────────
 *
 * En star, hub et client ouvrent CHACUN leur connexion sortante — deux par paire. C'est un
 * item ouvert de `work/webrtc2-todo.md` (« à décider, pas à corriger d'emblée ») : l'épingler
 * ici le trancherait par la bande, et le dédoublonner ferait rougir un scénario qui ne parle
 * pas de ça. Le fait métier ci-dessus est indifférent au nombre de connexions.
 *
 * Hors périmètre : le hub qui REPART puis revient avec un nouveau peerId (rechargement). La
 * réconciliation du pool est écrite pour lui (« la seule à rattraper un hub qui avait
 * rechargé sans que son départ soit annoncé »), mais c'est un scénario de départ, au sens de
 * `peerDeparture.test.js`, pas d'arrivée.
 *
 * ── Configuration ───────────────────────────────────────────────────────────────
 *
 * Contexte `data`, `topology: 'star'`, `hubSlug: 'admin'` : celle de `Exemples/Home.vue`,
 * seul consommateur star du paquet (le mode par défaut du provider est `data`). ⚠️ Lu, non joué :
 * `routeIncomingData` exige `isHub === true`, et `isHub` n'est posé que par `waitForMeReady`,
 * donc au premier tour de présence du hub — un hub monté mais jamais synchronisé ne retransmet
 * rien.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ⚠️ Factory inline obligatoire : `vi.mock` est hoisté au-dessus des imports.
vi.mock('~estarter/services/AjaxService.js', () => ({
    useAjaxService: () => globalThis[Symbol.for('webrtc2.test.signalingServer')].createClient(),
}))

import { createPeerBus } from '../__mocks__/peerjs.js'
import { createFakeSignalingServer } from '../helpers/fakeSignalingServer.js'
import { createVirtualPeer, connectRoom, settle } from '../helpers/createVirtualPeer.js'
import { ENDPOINTS } from '~socializer/components/WebRTC2/webrtc2.config.js'

describe('topologie star : le hub arrive après ses clients', () => {
    let bus
    let server
    const peers = []
    const ROOM = 'room-star'
    const HUB = 'admin'

    /** Ce que l'app de chaque pair a reçu, dans l'ordre. */
    let inbox

    const spawn = async (slug) => {
        inbox[slug] = []
        const peer = await createVirtualPeer({
            slug,
            room: ROOM,
            type: 'data',
            // Un objet neuf par pair : `createPeerContext` lit ses options à la construction.
            options: { topology: 'star', hubSlug: HUB },
            callbacks: { onDataReceived: (data) => inbox[slug].push(data) },
            server,
        })
        peers.push(peer)
        return peer
    }

    /** Demandes de peerId échangées entre deux pairs, dans un sens comme dans l'autre. */
    const asksBetween = (a, b) => server.requestsTo(ENDPOINTS.ASK_TO_PEER_ID).filter(
        (request) => (request.from === a && request.data.toUserSlug === b)
            || (request.from === b && request.data.toUserSlug === a)
    )

    beforeEach(() => {
        bus = createPeerBus()
        server = createFakeSignalingServer()
        inbox = {}
    })

    afterEach(() => {
        peers.splice(0).forEach((peer) => peer.destroy())
        server.destroy()
        bus.destroy()
    })

    it('contrôle de harnais : hub présent dès le départ, il relaie et il diffuse', async () => {
        // Sans ce cas, un rouge plus bas serait indistinguable d'un harnais qui ne sait pas
        // monter une étoile. L'ordre est le nominal : le hub est là avant ses clients.
        const admin = await spawn(HUB)
        const alice = await spawn('alice')
        const bob = await spawn('bob')
        await connectRoom([admin, alice, bob])

        alice.api.sendDataToPeer({ message: 'bonjour bob' })
        await settle()

        expect(inbox.bob).toEqual([{ message: 'bonjour bob' }])
        expect(asksBetween('alice', 'bob')).toEqual([])

        // CAS 1 de `sendData` : le hub émet en direct, sans enveloppe.
        admin.api.sendDataToPeer({ message: 'à tous' })
        await settle()

        expect(inbox.alice).toEqual([{ message: 'à tous' }])
        expect(inbox.bob).toEqual([{ message: 'bonjour bob' }, { message: 'à tous' }])
    })

    it("hub absent : un client ne tente rien, et ce qu'il envoie ne va nulle part", async () => {
        // L'état transitoire LÉGITIME — pas une erreur, donc rien ne le signale. C'est ce
        // silence qui rend la transition suivante impossible à surveiller autrement.
        const alice = await spawn('alice')
        const bob = await spawn('bob')
        await connectRoom([alice, bob])

        alice.api.sendDataToPeer({ message: 'personne ?' })
        await settle()

        expect(inbox.bob).toEqual([])
        // « Sans rien tenter » : aucune demande de peerId, ni vers le hub absent ni entre
        // clients. L'appel au hub a été inconditionnel, et coûtait un POST, un jeton de
        // cadence et un retry armé à chaque tour de présence.
        expect(server.requestsTo(ENDPOINTS.ASK_TO_PEER_ID)).toEqual([])
        expect(alice.api.isHubConnected.value).toBe(false)
    })

    it(
        "le tour de présence qui voit arriver le hub rétablit tout : un client parle à l'autre par lui",
        async () => {
            const alice = await spawn('alice')
            const bob = await spawn('bob')
            await connectRoom([alice, bob])

            // Précondition : on part bien de l'état transitoire, pas d'une étoile déjà montée.
            expect(alice.api.isHubConnected.value).toBe(false)

            const admin = await spawn(HUB)
            await connectRoom([alice, bob, admin])

            expect(alice.api.isHubConnected.value).toBe(true)
            expect(bob.api.isHubConnected.value).toBe(true)

            alice.api.sendDataToPeer({ message: 'bonjour bob' })
            await settle()

            // Arrivé, et déballé.
            expect(inbox.bob).toEqual([{ message: 'bonjour bob' }])
            // Le hub est aussi un récepteur — et l'expéditeur ne reçoit pas son propre message.
            expect(inbox[HUB]).toEqual([{ message: 'bonjour bob' }])
            expect(inbox.alice).toEqual([])
            // Par le hub, et par lui seul.
            expect(asksBetween('alice', 'bob')).toEqual([])
        },
    )

    it("les clients voient le hub AVANT qu'il ne voie sa room — l'ordre de production", async () => {
        // ⚠️ `connectRoom` livre la présence à tous dans le même tick, ce qui referme une
        // fenêtre avant de l'ouvrir (cf. son en-tête, et le cas séquentiel de
        // `lateJoiner.test.js`). Ici le hub est l'ARRIVANT : son `remotePeers` n'est écrit
        // qu'après `waitForMeReady`, alors que la demande d'un client ne coûte qu'un
        // aller-retour HTTP + Reverb. Les demandes des clients atterrissent donc chez un hub
        // qui ne connaît pas encore sa room — `responseRemotePeerConnection` doit attendre sa
        // première présence au lieu de refuser.
        //
        // Aucun retry n'y joue : vert retry coupé comme retry immédiat (mesuré à la relecture).
        // Le seul minuteur en jeu est le délai de `waitForPresenceSync`, dont le cas consomme
        // moins de 20 ms.
        const alice = await spawn('alice')
        const bob = await spawn('bob')
        await connectRoom([alice, bob])

        const admin = await spawn(HUB)
        const users = [{ slug: 'alice' }, { slug: 'bob' }, { slug: HUB }]

        await Promise.all([alice, bob].map((client) => client.api.syncUsersConnections(users)))
        await settle()
        await admin.api.syncUsersConnections(users)
        await settle()

        alice.api.sendDataToPeer({ message: 'bonjour bob' })
        await settle()

        expect(inbox.bob).toEqual([{ message: 'bonjour bob' }])
        expect(asksBetween('alice', 'bob')).toEqual([])
    })
})
