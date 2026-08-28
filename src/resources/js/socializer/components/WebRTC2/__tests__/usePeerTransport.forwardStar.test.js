/**
 * usePeerTransport.forwardStar.test.js
 * Périmètre : forwardStarMessage (hub topologie star) — validation de envelope.to,
 * et budget d'octets agrégé (anti-amplification).
 *
 * Faille couverte : [HAUTE] envelope.to non validé ni restreint aux membres de la room.
 * Le hub ne doit retransmettre qu'aux slugs (a) au format valide ET (b) réellement
 * présents dans remotePeers, l'expéditeur étant toujours exclu.
 *
 * Faille couverte (E1) : les deux gardes du hub sont par expéditeur (20 msg/fenêtre) et
 * par message (64 Ko) ; leur PRODUIT par le fan-out ne l'était pas. Le coût réel d'une
 * retransmission est `octets × destinataires`, et c'est lui que `HUB_MAX_BYTES_PER_WINDOW`
 * plafonne.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockContext } from './helpers/createMockContext.js'
import { withSetup } from './helpers/withSetup.js'
import { usePeerTransport } from '~socializer/components/WebRTC2/Composables/usePeerTransport.js'
import { HUB_MAX_BYTES_PER_WINDOW, HUB_RATE_WINDOW_MS } from '~socializer/components/WebRTC2/webrtc2.config.js'

describe('usePeerTransport — forwardStarMessage (validation envelope.to)', () => {
    let ctx
    let app
    let transport
    let sendSpies
    let conns

    const ROOM = 'app'
    const TYPE = 'data'
    const SENDER = 'alice'
    // peerId unique par test : le rate-limiting hub est un état module-level
    // (_hubRateLimiter) partagé entre contextes et clé sur l'identité PeerJS réelle.
    let SENDER_PEER_ID
    let _peerSeq = 0

    // Ajoute une connexion data ouverte pour `slug` et retourne son spy `send`.
    // Le registre `conns` est un objet brut (comme le getter Pinia réel), contrairement
    // au mock par défaut qui enveloppe getConnections dans un computed Vue.
    const addOpenConn = (slug) => {
        const send = vi.fn()
        if (!conns[ROOM]) conns[ROOM] = {}
        if (!conns[ROOM][slug]) conns[ROOM][slug] = {}
        if (!conns[ROOM][slug][TYPE]) conns[ROOM][slug][TYPE] = []
        conns[ROOM][slug][TYPE].push({ open: true, chunker: {}, send })
        sendSpies[slug] = send
        return send
    }

    beforeEach(() => {
        sendSpies = {}
        conns = {}
        SENDER_PEER_ID = `peer-alice-${_peerSeq++}`
        ctx = createMockContext({
            session: { topology: 'star', hubSlug: 'alice', isHub: true },
            connection: { remotePeers: [SENDER, 'bob', 'carol'] },
            peerStore: { getConnections: conns },
        })

        // Identité PeerJS réelle de l'expéditeur (résolue via getRemotePeerId).
        ctx.peerStore.addRemotePeerId(SENDER, SENDER_PEER_ID)

        // Connexions ouvertes vers les destinataires légitimes.
        addOpenConn('bob')
        addOpenConn('carol')

        ;[transport, app] = withSetup(() => usePeerTransport(ctx))
    })

    afterEach(() => {
        app.unmount()
        vi.restoreAllMocks()
    })

    const sourceConn = () => ({ peer: SENDER_PEER_ID })

    it('retransmet uniquement aux membres ciblés présents dans la room', () => {
        transport.forwardStarMessage(
            { __starRoute: true, to: ['bob'], from: SENDER, payload: 'hi' },
            sourceConn()
        )

        expect(sendSpies.bob).toHaveBeenCalledWith('hi')
        expect(sendSpies.carol).not.toHaveBeenCalled()
    })

    it('ignore les slugs ciblés absents de la room (ciblage arbitraire)', () => {
        transport.forwardStarMessage(
            { __starRoute: true, to: ['bob', 'mallory'], from: SENDER, payload: 'x' },
            sourceConn()
        )

        expect(sendSpies.bob).toHaveBeenCalledWith('x')
        // mallory n'est pas dans remotePeers → aucune connexion, aucun envoi.
        expect(Object.keys(sendSpies)).not.toContain('mallory')
    })

    it('ignore les slugs au format invalide même si la connexion existe', () => {
        const evil = 'bob; rm -rf /'
        // Une connexion existe malgré un slug malformé : le filtre _isValidSlug doit primer.
        const evilSend = addOpenConn(evil)
        ctx.connection.remotePeers.push(evil)

        transport.forwardStarMessage(
            { __starRoute: true, to: [evil], from: SENDER, payload: 'x' },
            sourceConn()
        )

        expect(evilSend).not.toHaveBeenCalled()
    })

    it('exclut toujours l\'expéditeur même s\'il est explicitement ciblé', () => {
        const senderSend = addOpenConn(SENDER)

        transport.forwardStarMessage(
            { __starRoute: true, to: [SENDER, 'bob'], from: SENDER, payload: 'x' },
            sourceConn()
        )

        expect(senderSend).not.toHaveBeenCalled()
        expect(sendSpies.bob).toHaveBeenCalledWith('x')
    })

    it('diffuse à tous les membres (sauf expéditeur) quand `to` est absent', () => {
        transport.forwardStarMessage(
            { __starRoute: true, to: null, from: SENDER, payload: 'broadcast' },
            sourceConn()
        )

        expect(sendSpies.bob).toHaveBeenCalledWith('broadcast')
        expect(sendSpies.carol).toHaveBeenCalledWith('broadcast')
    })

    /*
    |--------------------------------------------------------------------------
    | Budget d'octets agrégé (E1) — l'amplification, pas la taille d'un message
    |--------------------------------------------------------------------------
    |
    | Ce que ces tests épinglent n'est PAS « un gros message est refusé » (c'est
    | MAX_PAYLOAD_BYTES, déjà couvert) mais « une rafale dont le coût × fan-out
    | dépasse le budget est coupée ». D'où des payloads qui passent le contrôle de
    | taille individuel et ne saturent qu'en s'additionnant.
    */

    describe('budget d\'octets agrégé', () => {
        // 32 Ko : sous MAX_PAYLOAD_BYTES (64 Ko), donc chaque message passe le contrôle
        // de taille individuel. Avec 2 destinataires, il coûte 64 Ko de retransmission.
        const CHUNK = 'x'.repeat(32 * 1024)

        // Nombre d'envois nécessaires pour épuiser le budget avec 2 destinataires.
        const SENDS_TO_EXHAUST = Math.ceil(HUB_MAX_BYTES_PER_WINDOW / (CHUNK.length * 2))

        beforeEach(() => {
            vi.spyOn(console, 'warn').mockImplementation(() => {})
        })

        it('coupe la retransmission quand le coût agrégé dépasse le budget', () => {
            // Le plafond de messages (20/fenêtre) ne doit pas être ce qui coupe : on
            // vérifie que le budget mord avant lui.
            expect(SENDS_TO_EXHAUST).toBeLessThan(20)

            for (let i = 0; i < SENDS_TO_EXHAUST; i++) {
                transport.forwardStarMessage(
                    { __starRoute: true, to: null, from: SENDER, payload: CHUNK },
                    sourceConn()
                )
            }

            const sentBefore = sendSpies.bob.mock.calls.length

            transport.forwardStarMessage(
                { __starRoute: true, to: null, from: SENDER, payload: CHUNK },
                sourceConn()
            )

            expect(sendSpies.bob.mock.calls.length).toBe(sentBefore)
            expect(sendSpies.carol.mock.calls.length).toBe(sentBefore)
        })

        it('ne se déclenche pas sur un trafic nominal', () => {
            // 20 messages de 1 Ko à 2 destinataires = 40 Ko, très loin du budget : le
            // plafond de messages doit rester le seul garde qui puisse mordre ici.
            for (let i = 0; i < 20; i++) {
                transport.forwardStarMessage(
                    { __starRoute: true, to: null, from: SENDER, payload: 'y'.repeat(1024) },
                    sourceConn()
                )
            }

            expect(sendSpies.bob).toHaveBeenCalledTimes(20)
            expect(sendSpies.carol).toHaveBeenCalledTimes(20)
        })

        /**
         * La sémantique choisie, épinglée : le contrôle porte sur le total DÉJÀ dépensé.
         * Un fan-out isolé dont le coût dépasse à lui seul le budget passe donc — sans
         * quoi le premier message d'une grande room serait refusé au lieu du centième.
         */
        it('laisse passer un premier fan-out dont le coût dépasse à lui seul le budget', () => {
            const members = Array.from({ length: 60 }, (_, i) => `member${i}`)
            members.forEach(slug => {
                ctx.connection.remotePeers.push(slug)
                addOpenConn(slug)
            })

            // 32 Ko × 60 destinataires ≈ 1,9 Mio, au-delà du budget d'une fenêtre.
            expect(CHUNK.length * members.length).toBeGreaterThan(HUB_MAX_BYTES_PER_WINDOW)

            transport.forwardStarMessage(
                { __starRoute: true, to: null, from: SENDER, payload: CHUNK },
                sourceConn()
            )

            expect(sendSpies[members[0]]).toHaveBeenCalledWith(CHUNK)
            expect(sendSpies[members[59]]).toHaveBeenCalledWith(CHUNK)

            // …et il a consommé la fenêtre entière : le suivant est coupé.
            transport.forwardStarMessage(
                { __starRoute: true, to: null, from: SENDER, payload: 'z' },
                sourceConn()
            )

            expect(sendSpies.bob).toHaveBeenCalledTimes(1)
        })

        it('libère le budget une fois la fenêtre écoulée', () => {
            vi.useFakeTimers()

            try {
                for (let i = 0; i < SENDS_TO_EXHAUST; i++) {
                    transport.forwardStarMessage(
                        { __starRoute: true, to: null, from: SENDER, payload: CHUNK },
                        sourceConn()
                    )
                }

                const sentBefore = sendSpies.bob.mock.calls.length

                vi.advanceTimersByTime(HUB_RATE_WINDOW_MS + 1)

                transport.forwardStarMessage(
                    { __starRoute: true, to: null, from: SENDER, payload: CHUNK },
                    sourceConn()
                )

                expect(sendSpies.bob.mock.calls.length).toBe(sentBefore + 1)
            } finally {
                vi.useRealTimers()
            }
        })

        it('le budget est par expéditeur : un émetteur saturé n\'affecte pas les autres', () => {
            for (let i = 0; i <= SENDS_TO_EXHAUST; i++) {
                transport.forwardStarMessage(
                    { __starRoute: true, to: null, from: SENDER, payload: CHUNK },
                    sourceConn()
                )
            }

            const sentBefore = sendSpies.carol.mock.calls.length

            // Bob émet à son tour : sa propre fenêtre est vierge.
            const bobPeerId = `peer-bob-${_peerSeq++}`
            ctx.peerStore.addRemotePeerId('bob', bobPeerId)

            transport.forwardStarMessage(
                { __starRoute: true, to: ['carol'], from: 'bob', payload: CHUNK },
                { peer: bobPeerId }
            )

            expect(sendSpies.carol.mock.calls.length).toBe(sentBefore + 1)
        })
    })
})
