/**
 * incomingMappingInvariant.test.js — le mapping peerId précède-t-il l'admission ?
 *
 * Tâche B0 du plan de sécurité. Ce fichier ne corrige rien : il **caractérise** un
 * invariant dont dépend la forme de B1 (anti-usurpation inconditionnelle).
 *
 * ── La question ───────────────────────────────────────────────────────────────
 *
 * `_isAuthorizedIncomingPeer` a deux chemins d'admission. Le chemin (a), présence,
 * n'exige qu'un `metadata.from` déclaré présent dans `usersInRoom` ; son anti-usurpation
 * (règle 3) ne se déclenche que **si** le peerId entrant se résout à un slug connu. Un
 * membre de la room qui ouvre un second `new Peer()` — UUID neuf, donc non mappé —
 * échappe donc à la règle et parle sous l'identité de n'importe quel autre membre.
 *
 * Le corriger consiste à exiger `peerStore.getRemotePeerId(metadata.from) === conn.peer`
 * de façon inconditionnelle. Mais si le mapping n'est pas encore posé au moment où la
 * connexion arrive, ce durcissement casse l'admission **légitime**. D'où cette mesure,
 * faite avant d'écrire le correctif plutôt que découverte en régression.
 *
 * ── Le verdict ────────────────────────────────────────────────────────────────
 *
 * Mesuré sur les trois chemins d'admission de la production :
 *
 *   | chemin                    | mapping posé à l'admission ? |
 *   |---------------------------|------------------------------|
 *   | arrivant tardif (stream)  | ❌ NON                        |
 *   | partage d'écran           | ❌ NON                        |
 *   | appel direct accepté      | ✅ OUI, et concordant         |
 *
 * Le mapping du récepteur est écrit par **sa propre** `connectToPeer` — c'est-à-dire
 * quand c'est LUI qui ouvre. Sur le chemin présence, le premier contact est l'appel
 * ENTRANT de l'autre, qui arrive donc avant. Sur l'appel direct, `acceptCallFromPeer`
 * écrit le mapping avant même de répondre à l'invitation, et l'appel entrant vient
 * après. Les deux chemins sont donc structurellement opposés.
 *
 * **Conséquence pour B1 :** la fusion des chemins (a) et (b) est exclue — elle
 * fermerait toute diffusion en room. B1 prend donc sa seconde forme : conserver deux
 * chemins, et exiger sur (a) que le peerId entrant ne soit résolu à AUCUN autre slug.
 *
 * ── Le probe ──────────────────────────────────────────────────────────────────
 *
 * Les assertions portent ici sur un état interne, et c'est assumé : l'objet de la tâche
 * est précisément de mesurer cet état-là. Le seul point d'observation valable est
 * l'instant où PeerJS livre la connexion, avant que le garde ne décide — cf.
 * `probeAdmissions`.
 *
 * ── Contrôles de harnais ──────────────────────────────────────────────────────
 *
 * Un test qui asserte « absent » est vert dès qu'il ne mesure rien. Chaque verdict est
 * donc contre-vérifié :
 *
 * - **Chemin présence** : le troisième cas prouve que le mapping EST écrit, un peu plus
 *   tard. Un probe branché au mauvais endroit rendrait ce cas rouge.
 * - **Appel direct** : en neutralisant l'`addRemotePeerId` de `acceptCallFromPeer`
 *   (`useCallManager.js`), le cas passe au rouge sur le **fait métier** — bob ne reçoit
 *   plus le flux, parce que son garde entrant refuse alors l'appel. Vérifié le
 *   15/08/2026 : c'est bien ce mapping-là qui porte l'admission sur ce chemin.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('~estarter/services/AjaxService.js', () => ({
    useAjaxService: () => globalThis[Symbol.for('webrtc2.test.signalingServer')].createClient(),
}))

import { createPeerBus } from '../__mocks__/peerjs.js'
import { createFakeSignalingServer } from '../helpers/fakeSignalingServer.js'
import { createVirtualPeer, connectRoom, settle } from '../helpers/createVirtualPeer.js'
import { installFakeMedia } from '../helpers/fakeMedia.js'

/**
 * Enregistre, pour chaque connexion entrante livrée à ce pair, l'état du mapping
 * slug→peerId **au moment de la livraison**.
 *
 * ⚠️ Le probe est inséré EN TÊTE de `_handlers`, pas via `peer.on()`. Le mock appelle
 * ses handlers dans l'ordre d'enregistrement, et celui de la production est déjà branché
 * (`createVirtualPeer` a appelé `initializePeerConnection`) : un `on()` passerait donc
 * APRÈS `_isAuthorizedIncomingPeer` et `setUpConnectionListeners`. On mesurerait l'état
 * d'après l'admission, pas celui sur lequel le garde a décidé — exactement l'inverse de
 * la question posée.
 *
 * @param {Object} peer  Pair virtuel (createVirtualPeer)
 * @returns {Array<{event: string, from: string|null, type: string|null,
 *                  connPeer: string|null, mappedPeerId: string|null}>}
 */
const probeAdmissions = (peer) => {
    const admissions = []
    const instance = peer.peerInstance

    for (const event of ['connection', 'call']) {
        const record = (conn) => {
            const from = conn?.metadata?.from ?? null
            admissions.push({
                event,
                from,
                type: conn?.metadata?.type ?? null,
                connPeer: conn?.peer ?? null,
                mappedPeerId: from ? (peer.peerStore.getRemotePeerId(from) ?? null) : null,
            })
        }

        instance._handlers[event] = [record, ...(instance._handlers[event] ?? [])]
    }

    return admissions
}

/** Première admission correspondant à un émetteur et un type de connexion. */
const admissionFor = (admissions, { from, type }) =>
    admissions.find((entry) => entry.from === from && entry.type === type) ?? null

describe('B0 — présence du mapping peerId au moment de l\'admission entrante', () => {
    let bus
    let server
    const peers = []
    const ROOM = 'room-diffusion'
    const DATA_ROOM = 'app'

    const spawn = async (config) => {
        const peer = await createVirtualPeer({ room: ROOM, type: 'stream', ...config, server })
        peers.push(peer)
        return peer
    }

    beforeEach(() => {
        bus = createPeerBus()
        server = createFakeSignalingServer()
        installFakeMedia()

        // Les modes d'appel (visio, vocal) créent de vrais players DOM — `remoteStreamsMap`
        // n'est la source de vérité que pour le mode `stream`. Sans conteneur,
        // `usePeerMedia._mountHost` jette, et l'exception remonte hors du test.
        document.body.innerHTML = '<div id="videoContainer"></div>'
    })

    afterEach(() => {
        peers.splice(0).forEach((peer) => peer.destroy())
        server.destroy()
        bus.destroy()
    })

    describe('chemin présence — c\'est l\'appel entrant qui arrive en premier', () => {
        it("arrivant tardif : bob admet la webcam d'alice AVANT d'avoir mappé son peerId", async () => {
            const alice = await spawn({ slug: 'alice' })
            await connectRoom([alice])
            await alice.api.startWebcamStream()
            await settle()

            const bob = await spawn({ slug: 'bob' })
            const admissions = probeAdmissions(bob)
            await connectRoom([alice, bob])

            // Contrôle de harnais : sans flux reçu, l'absence de mapping ne prouverait
            // rien — elle dirait seulement que rien n'est jamais arrivé.
            expect(bob.receivedStreamsFrom()).toContain('alice')

            const admission = admissionFor(admissions, { from: 'alice', type: 'stream' })
            expect(admission).not.toBeNull()
            expect(admission.connPeer).toBe(alice.peerId)
            expect(admission.mappedPeerId).toBeNull()
        })

        it("partage d'écran : même verdict, le mapping n'est pas encore posé", async () => {
            const alice = await spawn({ slug: 'alice' })
            await connectRoom([alice])
            await alice.api.startScreenCapture()
            await settle()

            const bob = await spawn({ slug: 'bob' })
            const admissions = probeAdmissions(bob)
            await connectRoom([alice, bob])

            expect(bob.receivedScreensFrom()).toContain('alice')

            const admission = admissionFor(admissions, { from: 'alice', type: 'screen' })
            expect(admission).not.toBeNull()
            expect(admission.connPeer).toBe(alice.peerId)
            expect(admission.mappedPeerId).toBeNull()
        })

        it('le mapping finit bien par être posé — il est seulement EN RETARD sur l\'admission', async () => {
            // Ce que la mesure dit vraiment : pas « le mapping n'existe pas », mais
            // « il arrive après ». C'est ce décalage, et lui seul, qui interdit à B1 de
            // fusionner les deux chemins d'admission.
            const alice = await spawn({ slug: 'alice' })
            await connectRoom([alice])
            await alice.api.startWebcamStream()
            await settle()

            const bob = await spawn({ slug: 'bob' })
            const admissions = probeAdmissions(bob)
            await connectRoom([alice, bob])

            expect(admissionFor(admissions, { from: 'alice', type: 'stream' }).mappedPeerId)
                .toBeNull()
            expect(bob.peerStore.getRemotePeerId('alice')).toBe(alice.peerId)
        })
    })

    describe('chemin appel direct — le mapping précède l\'invitation acceptée', () => {
        /**
         * Tient le rôle de `System/Notifications.vue` : il écoute le canal utilisateur et
         * traduit les deux events d'invitation en verbes de l'orchestrateur.
         *
         * ⚠️ La production monte ces appels sur le contexte permanent `data-app`
         * (`Notifications.vue` appelle `useMediaBroadcast()` sans argument), pas sur le
         * contexte de diffusion — d'où l'api passée explicitement.
         */
        const wireCallSignaling = (slug, api) => {
            server.bindUserChannel(slug, async (eventName, event) => {
                if (eventName === 'AlertToUser') {
                    // La décision humaine du composant d'alerte, réduite à un accord :
                    // `onResponseAlert` ne route que l'action `peer-access-permission`.
                    if (event?.options?.action !== 'peer-access-permission') return
                    await api.acceptCallFromPeer({
                        fromUserSlug: event.fromUserSlug,
                        options: { ...event.options },
                        status: true,
                    })
                    return
                }

                if (eventName === 'ResponseToAuthorizationPeer') {
                    if (!event.status) return
                    await api.openCallBetweenPeer({ ...event, options: { ...event.options } })
                }
            })
        }

        it("bob a déjà mappé le peerId d'alice quand la visio arrive", async () => {
            const alice = await spawn({ slug: 'alice' })
            const aliceApp = alice.mountContext({ type: 'data', room: DATA_ROOM })
            wireCallSignaling('alice', aliceApp.api)

            const bob = await spawn({ slug: 'bob' })
            const bobApp = bob.mountContext({ type: 'data', room: DATA_ROOM })
            wireCallSignaling('bob', bobApp.api)

            const admissions = probeAdmissions(bob)

            // Aucune room commune n'est déclarée : seul le chemin (b) peut admettre.
            aliceApp.api.startCallWithPeer({ toUserSlug: 'bob', type: 'visio' })
            await settle(10)

            // Contrôle de harnais : l'admission a bien abouti — sans flux reçu, la
            // présence du mapping ne dirait rien de l'admission.
            expect(bobApp.receivedStreamsFrom()).toContain('alice')
            expect(bobApp.api.usersInRoom.value).not.toContain('alice')

            const admission = admissionFor(admissions, { from: 'alice', type: 'visio' })
            expect(admission).not.toBeNull()
            expect(admission.connPeer).toBe(alice.peerId)
            expect(admission.mappedPeerId).toBe(alice.peerId)
        })
    })
})
