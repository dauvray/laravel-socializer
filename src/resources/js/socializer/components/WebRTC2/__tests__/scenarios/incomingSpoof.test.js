/**
 * incomingSpoof.test.js — « un membre de la room ne peut pas parler sous l'identité d'un autre »
 *
 * LA FAILLE, telle qu'elle vivait dans `securite.md` sous « Faille résiduelle connue, chemin (a) ».
 * Le chemin (a) de `_isAuthorizedIncomingPeer` admet un pair parce que le slug qu'il DÉCLARE est
 * membre de la room. Un membre légitime qui ouvre un **second** `new Peer()` obtient un UUID que
 * rien ne mappe : `resolvedSlug` vaut `null`, il n'y a donc aucune contradiction à lui opposer, et
 * il est admis sous le nom de n'importe quel autre membre. Il parle ensuite sous cette
 * identité — chat, `BROADCAST_STATE` et `AUDIO_MUTE_TOGGLE` lisent tous `resolveRemoteSlug`.
 *
 * ⚠️ **C'est le SEUL étage où cette faille est visible.** Vue de l'attaquant, l'opération est un
 * `peer.connect()` ordinaire ; vue du récepteur seul, elle est indistinguable du cas nominal de la
 * présence (slug déclaré membre, peerId inconnu) — c'est écrit noir sur blanc dans `securite.md`, et
 * c'est ce qui a rendu la fermeture impossible côté client. Elle ne se voit que du pair d'en face,
 * donc ici.
 *
 * ── CE QUE MALLORY PEUT, ET CE QU'ELLE NE PEUT PAS ───────────────────────────────────────────
 *
 * Elle est membre de la room — c'est l'hypothèse, et elle est réaliste : un élève dans le cours de
 * son professeur. Elle est maîtresse de son bundle, donc elle fabrique sa `metadata` à la main :
 * c'est ce que modélise le `Peer` nu ci-dessous, ouvert hors de tout composable.
 *
 * Ce qu'elle ne peut PAS : obtenir du serveur une attestation au nom de quelqu'un d'autre. Le
 * harnais reproduit exactement cette borne — `fakeSignalingServer` signe avec le slug du client
 * AUTHENTIFIÉ (`clientOwners`), jamais avec un champ du corps, comme `Auth::user()->slug` côté PHP.
 * C'est de là, et de nulle part ailleurs, que vient la fermeture.
 *
 * ── CONTRÔLES DE HARNAIS (convention du paquet), mesurés le 2026-08-29 ───────────────────────
 *
 *   1. `getAttestedPeer` retiré de `_resolveSenderSlugFromIncomingConn` .......... 2 cas
 *   2. `_settleAdmission` rendant toujours `true` ................................ 2 cas
 *   3. `attestation` retirée de la `metadata` de `_buildPeerConnectionConfig` .... 1 cas
 *
 * Les trois découpent proprement le mécanisme, et aucun ne recouvre les autres : le premier emporte
 * l'usurpation ET l'arrivant tardif (les deux vivent de la résolution par attestation), le second
 * les deux cas de politique, le troisième le seul cas où l'attestation doit réellement VOYAGER.
 *
 * ⚠️ Le point 1 est celui qui compte le plus : sans lui, le premier cas ci-dessous verdirait sur le
 * refus d'`enforce` (« aucune attestation valable ») au lieu de verdir sur la CONTRADICTION, et
 * l'usurpation resterait ouverte partout où `enforce` est inactif — c'est-à-dire partout, pendant
 * toute la phase d'observation.
 *
 * ⚠️ Et le point 3 dit ce qu'aucun commentaire ne dirait aussi bien : dans un échange mesh
 * ORDINAIRE, l'attestation ne sert à rien — le mapping slug→peerId corrobore déjà. Un seul cas la
 * rend nécessaire, l'arrivant tardif, et c'est structurellement le seul (cf.
 * `incomingMappingInvariant.test.js`). Qui voudrait « simplifier » en retirant le transport dans la
 * `metadata` ne casserait donc que ce cas-là — et c'est précisément celui pour lequel tout ce
 * mécanisme existe.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('~estarter/services/AjaxService.js', () => ({
    useAjaxService: () => globalThis[Symbol.for('webrtc2.test.signalingServer')].createClient(),
}))

import { Peer, createPeerBus, flushBus } from '../__mocks__/peerjs.js'
import { createFakeSignalingServer } from '../helpers/fakeSignalingServer.js'
import { createVirtualPeer, connectRoom, settle } from '../helpers/createVirtualPeer.js'
import { installFakeMedia } from '../helpers/fakeMedia.js'
import { ENDPOINTS } from '~socializer/components/WebRTC2/webrtc2.config.js'

describe('chemin (a) : un membre ne peut pas parler sous l\'identité d\'un autre', () => {
    let bus
    let server
    const peers = []
    const ROOM = 'room-cours'

    /**
     * Ce qu'alice a REÇU sur son canal data.
     *
     * ⚠️ C'est le fait métier, et la seule assertion qui vaille ici. `peerStore.getConnections`
     * ne porte que les connexions qu'un pair a OUVERTES lui-même (`connectToPeer` →
     * `_saveRoomConnection`) : une connexion ENTRANTE n'y figure jamais, admise ou non — donc
     * toute assertion sur cette structure serait vide de son objet. Mesuré : la première version
     * de ce fichier passait ses trois cas de refus sans rien prouver.
     */
    let recuParAlice

    const spawn = async (config) => {
        const peer = await createVirtualPeer({ room: ROOM, type: 'data', ...config, server })
        peers.push(peer)
        return peer
    }

    /** Alice, avec son mouchard de réception. */
    const spawnAlice = () => spawn({
        slug: 'alice',
        callbacks: { onDataReceived: (data) => recuParAlice.push(data) },
    })

    /**
     * Le SECOND `Peer` de mallory : un UUID neuf, que rien ne mappe chez personne.
     *
     * Ouvert hors de tout composable — c'est ce qui modélise « l'attaquant est maître de son
     * bundle » : elle compose sa `metadata` champ par champ, et n'y met que ce qu'elle veut.
     *
     * @param {Object} metadata   Ce qu'elle déclare — `from` compris.
     * @param {string} cible      Le peerId de sa victime.
     */
    const secondPeerDeMallory = async (cible, metadata) => {
        const imposteur = new Peer('peer-mallory-second')
        imposteur._triggerEvent('open', 'peer-mallory-second')

        const conn = imposteur.connect(cible, { metadata })

        await flushBus()
        await settle()

        // Ce que l'attaque cherche à obtenir : parler. Le canal n'achemine que si la victime a
        // ADMIS la connexion — c'est `setUpConnectionListeners` qui branche `handleData`, et il
        // n'est appelé qu'après le garde.
        conn.send({ message: 'je suis bob' })

        await flushBus()
        await settle()

        return conn
    }

    /** La `metadata` d'une connexion data ordinaire, telle que `connectToPeer` la construit. */
    const metadataDe = (from, victime, extra = {}) => ({
        slug: victime.slug,
        from,
        fromName: from,
        type: 'data',
        room: ROOM,
        callbackKey: `data-${ROOM}`,
        isAudioMuted: false,
        isVideoEnabled: true,
        ...extra,
    })

    beforeEach(() => {
        bus = createPeerBus()
        server = createFakeSignalingServer()
        installFakeMedia()
        recuParAlice = []
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.spyOn(console, 'debug').mockImplementation(() => {})
    })

    afterEach(() => {
        peers.splice(0).forEach((peer) => peer.destroy())
        server.destroy()
        bus.destroy()
        vi.restoreAllMocks()
    })

    it('REFUSE le second Peer de mallory qui se déclare « bob », attestation à son nom à l\'appui', async () => {
        // ⚠️ LE CAS DE LA FAILLE. Mallory présente l'attestation que le serveur lui a délivrée —
        // la seule qu'elle puisse obtenir, et elle la nomme, ELLE. La contradiction avec le `from`
        // déclaré est ce qui refuse, et elle mord même si `enforce` est inactif : ce n'est pas la
        // politique d'observation qui joue ici, c'est l'anti-usurpation.
        const alice = await spawnAlice()
        const bob = await spawn({ slug: 'bob' })
        const mallory = await spawn({ slug: 'mallory' })

        await connectRoom([alice, bob, mallory])

        await secondPeerDeMallory(
            alice.peerId,
            metadataDe('bob', alice, { attestation: 'peer-mallory-second::mallory' }),
        )

        // Le fait métier : rien de ce que l'imposteur a émis n'atteint alice.
        expect(recuParAlice).not.toContainEqual({ message: 'je suis bob' })
        // Et rien n'a été inscrit sous le nom de bob dans l'allowlist du chemin (b).
        expect(alice.peerStore.getRemotePeerId('bob')).not.toBe('peer-mallory-second')
    })

    it('REFUSE le même second Peer quand il ne présente aucune attestation, sous `enforce`', async () => {
        // La variante évidente : ne rien présenter. C'est ce que fait aussi un onglet resté sur un
        // bundle antérieur — d'où la phase d'observation, qui sert à faire disparaître ce cas
        // AVANT de basculer.
        server.setAttestationEnforce(true)

        const alice = await spawnAlice()
        const bob = await spawn({ slug: 'bob' })
        const mallory = await spawn({ slug: 'mallory' })

        await connectRoom([alice, bob, mallory])

        await secondPeerDeMallory(alice.peerId, metadataDe('bob', alice))

        expect(recuParAlice).not.toContainEqual({ message: 'je suis bob' })
    })

    it('ADMET le même second Peer sans attestation tant qu\'`enforce` est inactif — et le COMPTE', async () => {
        // La phase d'observation, telle qu'un déploiement la vit : rien n'est cassé, et le compteur
        // dit combien de pairs seraient refusés si l'on basculait. C'est lui qu'on relit pour
        // décider — et le fait qu'il soit non nul ici est exactement ce qui interdit de basculer à
        // l'aveugle.
        const alice = await spawnAlice()
        const bob = await spawn({ slug: 'bob' })
        const mallory = await spawn({ slug: 'mallory' })

        await connectRoom([alice, bob, mallory])

        await secondPeerDeMallory(alice.peerId, metadataDe('bob', alice))

        // Admise — et c'est bien le message de l'imposteur qui arrive, sous le nom de bob. C'est
        // la faille, telle qu'elle vit encore tant qu'`enforce` n'est pas activé, et le compteur
        // est ce qui la rend mesurable avant de basculer.
        expect(recuParAlice).toContainEqual({ message: 'je suis bob' })
        expect(alice.peerStore.uncorroboratedAdmissions).toBeGreaterThan(0)
    })

    it('non-régression : bob, lui, est admis — et son admission est CORROBORÉE', async () => {
        // Le cas nominal, sous `enforce`. Sans lui, tout ce fichier serait vert avec un garde qui
        // refuse tout le monde — et c'est le mode de panne le plus coûteux du module : un refus
        // entrant n'est jamais rattrapable.
        server.setAttestationEnforce(true)

        const alice = await spawnAlice()
        const bob = await spawn({ slug: 'bob' })

        await connectRoom([alice, bob])

        bob.api.sendDataToPeer({ message: 'ici bob, le vrai' })
        await settle()

        // La connexion réelle, ouverte par le composable de bob : c'est `connectToPeer` qui a posé
        // l'attestation dans sa `metadata`, et le serveur qui l'a signée à son nom.
        expect(recuParAlice).toContainEqual({ message: 'ici bob, le vrai' })
        // Corroborée : aucune admission non corroborée n'a été comptée de tout le scénario.
        expect(alice.peerStore.uncorroboratedAdmissions).toBe(0)
    })

    it('non-régression, ARRIVANT TARDIF sous `enforce` : le flux passe, et c\'est l\'attestation qui le permet', async () => {
        // ⚠️ LE CAS QUI JUSTIFIE LE MÉCANISME, et le seul de ce fichier où l'attestation est
        // réellement NÉCESSAIRE. Dans un échange mesh ordinaire, la corroboration vient du mapping
        // slug→peerId, déjà posé — mesuré : retirer l'attestation de la `metadata` ne fait rougir
        // aucun des cas précédents.
        //
        // L'arrivant tardif est l'inverse, et c'est structurel (`incomingMappingInvariant.test.js`)
        // : le mapping du récepteur est écrit par SA PROPRE `connectToPeer`, donc quand c'est LUI
        // qui ouvre — alors que sur la présence, le premier contact est l'appel ENTRANT de l'autre.
        // À cet instant `getRemotePeerId` est vide, et il n'y a plus que l'attestation pour dire
        // qui appelle. Sans elle, `enforce` refuserait ici un flux parfaitement légitime, par un
        // refus que rien ne rattrape.
        server.setAttestationEnforce(true)
        document.body.innerHTML = '<div id="videoContainer"></div>'

        const alice = await createVirtualPeer({ room: ROOM, type: 'stream', slug: 'alice', server })
        peers.push(alice)
        await connectRoom([alice])
        await alice.api.startWebcamStream()
        await settle()

        // Bob arrive APRÈS : c'est le `peer.call` d'alice qui le contacte en premier.
        const bob = await createVirtualPeer({ room: ROOM, type: 'stream', slug: 'bob', server })
        peers.push(bob)
        await connectRoom([alice, bob])

        // ⚠️ Un tour de drain de plus que les scénarios voisins, et ce n'est pas un tâtonnement :
        // l'admission de bob passe ici par un ALLER-RETOUR de vérification, là où les autres
        // chemins tranchent sans réseau. Les 4 tours de `connectRoom` couvrent l'établissement,
        // pas la décision qui l'a précédé.
        await settle(12)

        expect(bob.receivedStreamsFrom()).toContain('alice')
        expect(bob.peerStore.uncorroboratedAdmissions).toBe(0)
        // Et la corroboration est bien venue du SERVEUR, pas du mapping : bob a interrogé la route.
        expect(server.requestsTo(ENDPOINTS.VERIFY_PEER_ATTESTATION).length).toBeGreaterThan(0)
    })
})
