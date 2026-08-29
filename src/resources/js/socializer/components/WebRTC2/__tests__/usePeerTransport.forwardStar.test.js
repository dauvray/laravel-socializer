/**
 * usePeerTransport.forwardStar.test.js
 * Périmètre : la retransmission du hub en topologie star — validation de envelope.to,
 * et budget d'octets agrégé (anti-amplification).
 *
 * ⚠️ Le point d'entrée est `routeIncomingData`, pas `forwardStarMessage` : depuis que la
 * décision de topologie est descendue dans le transport, la retransmission n'est plus
 * exposée et n'est atteignable que par le routeur. Ces cas exercent donc AUSSI le
 * prédicat de topologie — le harnais monte un contexte `star` + `isHub`.
 *
 * Contre-épreuve mesurée (29/08/2026) : passer le harnais en `topology: 'mesh'` rougit
 * **15 cas sur 17**. Les deux survivants — « ignore les slugs au format invalide » et
 * « coupe la retransmission quand le coût agrégé dépasse le budget » — n'assertent QUE
 * des absences d'envoi, et une absence ne distingue pas « refusé pour la bonne raison »
 * de « jamais exécuté ». Ce n'est pas un trou de ce fichier (leur objet est ailleurs et
 * il est couvert), c'est la borne d'un cas purement négatif : ne pas conclure d'un de
 * ces deux-là que le chemin a tourné.
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
import {
    HUB_MAX_BYTES_PER_WINDOW,
    HUB_MAX_MESSAGES_PER_WINDOW,
    HUB_RATE_WINDOW_MS,
    MAX_PAYLOAD_BYTES,
} from '~socializer/components/WebRTC2/webrtc2.config.js'

describe('usePeerTransport — retransmission du hub (validation envelope.to)', () => {
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
        transport.routeIncomingData(
            { __starRoute: true, to: ['bob'], from: SENDER, payload: 'hi' },
            sourceConn()
        )

        expect(sendSpies.bob).toHaveBeenCalledWith('hi')
        expect(sendSpies.carol).not.toHaveBeenCalled()
    })

    it('ignore les slugs ciblés absents de la room (ciblage arbitraire)', () => {
        transport.routeIncomingData(
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
        // Semis par RÉAFFECTATION, jamais par `push` : la composition vit dans
        // `peerStore.roomMembers[contextId]` et ses lecteurs tracent la clé, qu'une mutation
        // en place ne touche pas. Ici la lecture est impérative et un `push` marcherait —
        // mais alors ce fichier serait le seul endroit du dépôt à muter la composition, et
        // le modèle à copier au prochain test.
        ctx.connection.remotePeers = [...ctx.connection.remotePeers, evil]

        transport.routeIncomingData(
            { __starRoute: true, to: [evil], from: SENDER, payload: 'x' },
            sourceConn()
        )

        expect(evilSend).not.toHaveBeenCalled()
    })

    it('exclut toujours l\'expéditeur même s\'il est explicitement ciblé', () => {
        const senderSend = addOpenConn(SENDER)

        transport.routeIncomingData(
            { __starRoute: true, to: [SENDER, 'bob'], from: SENDER, payload: 'x' },
            sourceConn()
        )

        expect(senderSend).not.toHaveBeenCalled()
        expect(sendSpies.bob).toHaveBeenCalledWith('x')
    })

    it('diffuse à tous les membres (sauf expéditeur) quand `to` est absent', () => {
        transport.routeIncomingData(
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
                transport.routeIncomingData(
                    { __starRoute: true, to: null, from: SENDER, payload: CHUNK },
                    sourceConn()
                )
            }

            const sentBefore = sendSpies.bob.mock.calls.length

            transport.routeIncomingData(
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
                transport.routeIncomingData(
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
            ctx.connection.remotePeers = [...ctx.connection.remotePeers, ...members]
            members.forEach(slug => addOpenConn(slug))

            // 32 Ko × 60 destinataires ≈ 1,9 Mio, au-delà du budget d'une fenêtre.
            expect(CHUNK.length * members.length).toBeGreaterThan(HUB_MAX_BYTES_PER_WINDOW)

            transport.routeIncomingData(
                { __starRoute: true, to: null, from: SENDER, payload: CHUNK },
                sourceConn()
            )

            expect(sendSpies[members[0]]).toHaveBeenCalledWith(CHUNK)
            expect(sendSpies[members[59]]).toHaveBeenCalledWith(CHUNK)

            // …et il a consommé la fenêtre entière : le suivant est coupé.
            transport.routeIncomingData(
                { __starRoute: true, to: null, from: SENDER, payload: 'z' },
                sourceConn()
            )

            expect(sendSpies.bob).toHaveBeenCalledTimes(1)
        })

        it('libère le budget une fois la fenêtre écoulée', () => {
            vi.useFakeTimers()

            try {
                for (let i = 0; i < SENDS_TO_EXHAUST; i++) {
                    transport.routeIncomingData(
                        { __starRoute: true, to: null, from: SENDER, payload: CHUNK },
                        sourceConn()
                    )
                }

                const sentBefore = sendSpies.bob.mock.calls.length

                vi.advanceTimersByTime(HUB_RATE_WINDOW_MS + 1)

                transport.routeIncomingData(
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
                transport.routeIncomingData(
                    { __starRoute: true, to: null, from: SENDER, payload: CHUNK },
                    sourceConn()
                )
            }

            const sentBefore = sendSpies.carol.mock.calls.length

            // Bob émet à son tour : sa propre fenêtre est vierge.
            const bobPeerId = `peer-bob-${_peerSeq++}`
            ctx.peerStore.addRemotePeerId('bob', bobPeerId)

            transport.routeIncomingData(
                { __starRoute: true, to: ['carol'], from: 'bob', payload: CHUNK },
                { peer: bobPeerId }
            )

            expect(sendSpies.carol.mock.calls.length).toBe(sentBefore + 1)
        })
    })

    /*--------------------------------------------------------------------------
    | Câblage du plafond de MESSAGES — la clé, pas la mécanique
    |--------------------------------------------------------------------------
    |
    | La mécanique de la fenêtre glissante (plafond, reprise, purge des expéditeurs
    | inactifs) vit dans `utils/createRateLimiter.js` et y est testée. La dupliquer ici
    | donnerait deux domiciles à une même politique — donc deux copies qui divergent.
    |
    | Ce qui manque, et que seuls ces cas peuvent dire, c'est le CÂBLAGE : le hub
    | compte par identité PeerJS réelle (`sourceConn.peer`), jamais par le `from`
    | déclaré dans l'enveloppe. Confondre les deux rendrait le plafond contournable
    | par un simple changement de nom déclaré — le champ que le hub qualifie lui-même
    | de « non fiable ».
    |
    | ⚠️ Payloads d'un octet partout ici : le budget d'octets partage la même clé, et
    | un décor plus lourd le ferait mordre à la place du plafond de messages.
    */

    describe('câblage du plafond de messages (clé = identité PeerJS)', () => {
        let warnSpy

        beforeEach(() => {
            warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        })

        /** Sature la fenêtre de messages de `conn`, sans jamais la dépasser. */
        const saturate = (conn, declaredFrom = SENDER) => {
            for (let i = 0; i < HUB_MAX_MESSAGES_PER_WINDOW; i++) {
                transport.routeIncomingData(
                    { __starRoute: true, to: null, from: declaredFrom, payload: 'x' },
                    conn
                )
            }
        }

        it('partage le quota entre deux `from` déclarés depuis la MÊME connexion', () => {
            // Une enveloppe sur deux ment sur son expéditeur. La connexion, elle, est la
            // même : c'est elle qui porte l'identité, donc un seul quota.
            for (let i = 0; i < HUB_MAX_MESSAGES_PER_WINDOW; i++) {
                transport.routeIncomingData(
                    {
                        __starRoute: true,
                        to: null,
                        from: i % 2 === 0 ? SENDER : 'mallory',
                        payload: 'x',
                    },
                    sourceConn()
                )
            }

            expect(sendSpies.bob).toHaveBeenCalledTimes(HUB_MAX_MESSAGES_PER_WINDOW)

            transport.routeIncomingData(
                { __starRoute: true, to: null, from: 'mallory', payload: 'x' },
                sourceConn()
            )

            expect(sendSpies.bob).toHaveBeenCalledTimes(HUB_MAX_MESSAGES_PER_WINDOW)
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('[Hub] Rate limit dépassé')
            )
        })

        it('ne partage RIEN entre deux connexions qui déclarent le même `from`', () => {
            // Le miroir, et le plus fort des deux : si le quota était indexé sur le nom
            // déclaré, l'expéditeur saturé pourrait faire taire un pair innocent en se
            // faisant passer pour lui.
            saturate(sourceConn())

            const sentBefore = sendSpies.carol.mock.calls.length

            const bobPeerId = `peer-bob-${_peerSeq++}`
            ctx.peerStore.addRemotePeerId('bob', bobPeerId)

            transport.routeIncomingData(
                { __starRoute: true, to: ['carol'], from: SENDER, payload: 'x' },
                { peer: bobPeerId }
            )

            expect(sendSpies.carol.mock.calls.length).toBe(sentBefore + 1)
        })

        it('un message rejeté pour sa TAILLE a quand même consommé un jeton', () => {
            // ⭐ Le seul cas dont la couleur dépend de l'ORDRE des gardes et non de leur
            // présence : le plafond de messages est évalué AVANT le contrôle de taille.
            // C'est ce qui empêche une rafale de payloads géants d'être gratuite — chaque
            // tentative a coûté au hub une résolution d'expéditeur et une sérialisation.
            const huge = 'x'.repeat(MAX_PAYLOAD_BYTES + 1)

            for (let i = 0; i < HUB_MAX_MESSAGES_PER_WINDOW; i++) {
                transport.routeIncomingData(
                    { __starRoute: true, to: null, from: SENDER, payload: huge },
                    sourceConn()
                )
            }

            expect(sendSpies.bob).not.toHaveBeenCalled()

            transport.routeIncomingData(
                { __starRoute: true, to: null, from: SENDER, payload: 'x' },
                sourceConn()
            )

            expect(sendSpies.bob).not.toHaveBeenCalled()
            // L'assertion sur le MESSAGE, et pas seulement sur l'absence d'envoi : sans
            // elle, le cas serait vert dans les deux ordres de gardes — coupé par la
            // taille ou coupé par le débit, l'effet observable est le même.
            expect(warnSpy).toHaveBeenLastCalledWith(
                expect.stringContaining('[Hub] Rate limit dépassé')
            )
        })
    })

    /*--------------------------------------------------------------------------
    | Limite de taille — le chemin HUB, qui n'est pas celui du mesh
    |--------------------------------------------------------------------------
    |
    | ⚠️ Le hub n'appelle PAS `isPayloadWithinLimit` : il refait le contrôle à la main
    | (`getPayloadSizeBytes` + deux `return`) pour pouvoir journaliser `senderSlug` et
    | `senderPeerId`. Ses messages sont donc différents de ceux du mesh, et SANS ACCENT
    | (« Enveloppe star ignoree »). Ne jamais transposer une assertion de texte de
    | `mesh.test.js` ici.
    */

    describe('limite de taille du chemin hub', () => {
        let warnSpy

        beforeEach(() => {
            warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        })

        const forward = (payload) => transport.routeIncomingData(
            { __starRoute: true, to: null, from: SENDER, payload },
            sourceConn()
        )

        it('ignore une enveloppe dont le payload JSON dépasse MAX_PAYLOAD_BYTES', () => {
            forward('x'.repeat(MAX_PAYLOAD_BYTES + 1))

            expect(sendSpies.bob).not.toHaveBeenCalled()
            expect(sendSpies.carol).not.toHaveBeenCalled()
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('payload trop volumineux'),
                expect.objectContaining({ senderSlug: SENDER })
            )
        })

        it('ignore une enveloppe dont le payload BINAIRE dépasse la limite', () => {
            forward(new ArrayBuffer(MAX_PAYLOAD_BYTES + 1))

            expect(sendSpies.bob).not.toHaveBeenCalled()
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('payload trop volumineux'),
                expect.objectContaining({ payloadKind: 'arraybuffer' })
            )
        })

        it('retransmet un payload binaire PILE à la limite', () => {
            // Comparaison stricte `>` : la limite elle-même passe. La contre-épreuve des
            // deux cas ci-dessus — sans elle, un contrôle trop strict d'un octet passerait.
            const atLimit = new ArrayBuffer(MAX_PAYLOAD_BYTES)

            forward(atLimit)

            expect(sendSpies.bob).toHaveBeenCalledWith(atLimit)
            expect(sendSpies.carol).toHaveBeenCalledWith(atLimit)
        })

        it('ignore une enveloppe SANS payload', () => {
            // La seule forme d'invalidité réellement atteignable en production : un client
            // qui pose le marqueur `__starRoute` sans rien à router. Les autres (fonction,
            // symbole, référence circulaire) ne traversent aucun data channel PeerJS.
            transport.routeIncomingData(
                { __starRoute: true, to: ['bob'], from: SENDER },
                sourceConn()
            )

            expect(sendSpies.bob).not.toHaveBeenCalled()
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('payload invalide'),
                expect.objectContaining({ senderSlug: SENDER })
            )
        })
    })
})
