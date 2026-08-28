/**
 * outgoingAuth.test.js — « un tiers ne peut pas se faire pousser un flux »
 *
 * Le pendant SORTANT de `usePeerTransport.incomingAuth.test.js`. L'audit du 14/08/2026 a
 * montré que durcir le sens entrant ne protège de rien tant que le sens sortant reste
 * ouvert : c'est la victime qui appelle, donc c'est elle qui livre sa webcam.
 *
 * La chaîne d'attaque rejouée ici, telle qu'elle existe en production :
 *
 *   mallory POST /response-to-peer-id { toUserSlug: 'alice', peerId: <mallory>, … }
 *     └─► alice reçoit PEER_CONNECT_TO_REMOTE_PEER — un signal qu'elle n'a jamais demandé
 *           └─► connectToPeer() enregistre le mapping puis peer.call(mallory, sonFlux)
 *
 * Aucune appartenance à la room n'est exigée nulle part sur ce trajet. `mallory` n'est
 * donc **jamais passé à `connectRoom`** : il n'est dans le `remotePeers` de personne, et
 * son seul pouvoir est celui de n'importe quel utilisateur authentifié — POSTer.
 *
 * ── Pourquoi mallory déclare alice dans SA propre room ────────────────────────
 *
 * Écrit sans `_claimLocally`, ce fichier était **vert avant le correctif** : alice
 * poussait bien son flux, mais le garde ENTRANT de mallory le refusait — mallory se
 * protégeait tout seul, et le test ne prouvait rien. Un attaquant, lui, est maître de
 * son bundle : il supprime ce garde d'une ligne. On modélise ce pouvoir par la seule
 * chose que le harnais permette — une déclaration de présence **purement locale**, sans
 * aucune autorité (elle ne change rien à la vue qu'alice a de sa room). Sans elle, la
 * moitié des cas seraient des faux positifs.
 *
 * ⚠️ Les assertions portent sur le fait métier (« mallory a-t-il le flux d'alice ? »),
 * jamais sur un appel de fonction interne. On les double d'une assertion sur le store
 * d'alice, parce que l'écriture inconditionnelle du mapping est la **seconde moitié** de
 * la faille : elle inscrit l'attaquant comme « interlocuteur d'appel vérifié » et
 * empoisonne l'allowlist du chemin (b) de `_isAuthorizedIncomingPeer`.
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

describe("sens sortant : un pair hors room ne peut pas se faire pousser un flux", () => {
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

    /**
     * Déclare `alice` comme pair dans un contexte de mallory — affirmation locale, sans
     * autorité (cf. en-tête). Elle rend le garde entrant de mallory permissif, comme le
     * serait celui d'un bundle modifié, pour que le test observe le comportement d'ALICE.
     */
    const claimLocally = async (api) => {
        await api.syncUsersConnections([{ slug: 'alice' }, { slug: 'mallory' }])
        await settle()
    }

    /**
     * Le POST forgé, émis par le client de mallory.
     *
     * Les champs sont exactement ceux que `UserController` relaie — la liste blanche que
     * `fakeSignalingServer` reproduit. En ajouter un fabriquerait un chemin qui n'existe
     * pas en production.
     */
    const forgeResponseToPeerId = async (data) => {
        const client = server.createClient()
        server.bindLastClientTo('mallory')
        await client.load(ENDPOINTS.RESPONSE_TO_PEER_ID, 'post', data)
        await settle()
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

    it("mallory, hors room, ne reçoit pas la webcam qu'alice diffuse", async () => {
        const alice = await spawn({ slug: 'alice' })
        await connectRoom([alice])
        await alice.api.startWebcamStream()
        await settle()

        const mallory = await spawn({ slug: 'mallory' })
        await claimLocally(mallory.api)

        await forgeResponseToPeerId({
            toUserSlug: 'alice',
            peerId: mallory.peerId,
            room: ROOM,
            type: 'stream',
            connectionType: 'stream',
        })

        expect(mallory.receivedStreamsFrom()).not.toContain('alice')
        expect(alice.peerStore.getRemotePeerId('mallory')).toBeFalsy()
    })

    it("mallory, hors room, ne reçoit pas le partage d'écran d'alice", async () => {
        const alice = await spawn({ slug: 'alice' })
        await connectRoom([alice])
        await alice.api.startScreenCapture()
        await settle()

        const mallory = await spawn({ slug: 'mallory' })
        await claimLocally(mallory.api)

        // `type` route le signal vers le contexte 'stream' d'alice, `connectionType`
        // demande l'ouverture de l'écran : c'est la variante la plus payante de l'attaque.
        await forgeResponseToPeerId({
            toUserSlug: 'alice',
            peerId: mallory.peerId,
            room: ROOM,
            type: 'stream',
            connectionType: 'screen',
        })

        expect(mallory.receivedScreensFrom()).not.toContain('alice')
        expect(alice.peerStore.getRemotePeerId('mallory')).toBeFalsy()
    })

    it("mallory n'ouvre aucun canal data sur le contexte permanent, ni n'empoisonne le mapping", async () => {
        // `data-app` est monté en permanence pour tout utilisateur connecté
        // (`System/Notifications.vue`) : ce canal est disponible en continu, sans qu'aucune
        // diffusion ne soit en cours. C'est le vecteur qui inscrit l'attaquant dans le
        // mapping slug→peerId, l'allowlist du chemin (b) de l'admission entrante.
        const alice = await spawn({ slug: 'alice' })
        alice.mountContext({ type: 'data', room: DATA_ROOM })
        await connectRoom([alice])

        const mallory = await spawn({ slug: 'mallory' })
        const malloryData = mallory.mountContext({ type: 'data', room: DATA_ROOM })
        await claimLocally(malloryData.api)

        await forgeResponseToPeerId({
            toUserSlug: 'alice',
            peerId: mallory.peerId,
            room: DATA_ROOM,
            type: 'data',
            connectionType: 'data',
        })

        expect(alice.peerStore.getRemotePeerId('mallory')).toBeFalsy()
        expect(alice.peerInstance.connect).not.toHaveBeenCalledWith(
            mallory.peerId,
            expect.anything(),
        )
    })

    it('non-régression : bob, membre de la room, reçoit bien le flux', async () => {
        const alice = await spawn({ slug: 'alice' })
        await connectRoom([alice])
        await alice.api.startWebcamStream()
        await settle()

        const bob = await spawn({ slug: 'bob' })
        await connectRoom([alice, bob])

        expect(bob.receivedStreamsFrom()).toContain('alice')
    })
})
