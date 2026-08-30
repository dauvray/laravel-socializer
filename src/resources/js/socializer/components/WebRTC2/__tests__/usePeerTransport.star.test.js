/**
 * usePeerTransport.star.test.js
 * Périmètre : `sendData` en topologie STAR — l'ÉMISSION, des deux côtés.
 *
 * Le chemin récepteur du hub (`forwardStarMessage`) est dans
 * `usePeerTransport.forwardStar.test.js` ; la topologie mesh dans `usePeerTransport.mesh.test.js`.
 *
 * L'asymétrie qui fait tout l'intérêt du fichier : **le hub envoie en direct, le client
 * emballe**. C'est le client qui construit l'enveloppe `__starRoute` et l'adresse au hub
 * seul ; le hub, lui, a une connexion vers tout le monde et envoie les données nues. La
 * formulation inverse (« le hub construit l'enveloppe ») a circulé dans le plan de tests
 * jusqu'au 27/05 — d'où ce fichier, qui la fige dans le bon sens.
 *
 * ── DEUX FAITS ÉPINGLÉS, pas des bugs à corriger ici ─────────────────────────
 *
 * 1. **`destUserSlugs = []` veut dire « personne », pas « tout le monde ».** `[]` est
 *    *truthy* en JS, donc `destUserSlugs || null` rend `[]` et non `null`. Côté hub,
 *    `forwardStarMessage` filtre alors sur une liste vide et sort en silence. C'est
 *    atteignable en production via `usePeerOrchestrator.sendDataToPeer(data, [])`, et le
 *    correctif tentant (`destUserSlugs?.length ? … : null`) INVERSERAIT la sémantique sans
 *    lever : « je ne veux l'envoyer à personne » deviendrait une diffusion générale.
 *
 * 2. **Les deux branches star ne contrôlent PAS `MAX_PAYLOAD_BYTES`**, là où le mesh le
 *    fait avant sa boucle. Ce n'est pas une faille : `[Recv]` (createPeerContext) mesure
 *    chaque trame entrante AVANT que l'orchestrateur ne déballe l'enveloppe, donc un
 *    payload hors limite est jeté à l'arrivée. Le coût réel est un envoi de canal gaspillé,
 *    pas une amplification. Les deux cas de la dernière section épinglent l'état actuel.
 *    ⚠️ Ils ROUGIRONT le jour où l'asymétrie sera comblée — c'est le signal voulu : les
 *    mettre à jour, jamais les supprimer. Suivi : `work/webrtc2-todo.md`, section
 *    `usePeerTransport`.
 *
 * ℹ️ Corollaire hors périmètre, noté pour `createPeerContext.test.js` : `[Recv]` mesure
 * l'enveloppe ENTIÈRE, donc un payload pile à `MAX_PAYLOAD_BYTES` passe en mesh et se fait
 * rejeter en star, par le surcoût des trois champs de routage.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockContext } from './helpers/createMockContext.js'
import { withSetup } from './helpers/withSetup.js'
import { usePeerTransport } from '~socializer/components/WebRTC2/Composables/usePeerTransport.js'
import { MAX_PAYLOAD_BYTES } from '~socializer/components/WebRTC2/webrtc2.config.js'

describe('usePeerTransport — sendData en topologie star', () => {
    let app
    let sendSpies
    let conns
    let warnSpy

    const ROOM = 'app'
    const TYPE = 'data'
    const HUB = 'hub-alice'
    const ME = 'bob'

    // Une connexion data ouverte pour `slug`. `open` ET `chunker` sont tous deux exigés par
    // `_getOpenDataConnection` : un double qui n'aurait que `open` ne serait jamais trouvé.
    const addOpenConn = (slug) => {
        const send = vi.fn()
        if (!conns[ROOM]) conns[ROOM] = {}
        if (!conns[ROOM][slug]) conns[ROOM][slug] = {}
        if (!conns[ROOM][slug][TYPE]) conns[ROOM][slug][TYPE] = []
        conns[ROOM][slug][TYPE].push({ open: true, chunker: {}, send })
        sendSpies[slug] = send
        return send
    }

    /**
     * Monte le transport sur une session star.
     *
     * ⚠️ `connection.remotePeers` est extrait des overrides AVANT le spread par
     * `createMockContext` (garde structurel) : il se passe en clé propre, et toute
     * modification en cours de test est une RÉAFFECTATION, jamais un `push`.
     */
    const mountStar = ({ isHub = false, hubSlug = HUB, mySlug = ME, remotePeers }) => {
        const ctx = createMockContext({
            session: { topology: 'star', hubSlug, isHub, currentType: TYPE, onAirRoom: ROOM },
            connection: { remotePeers },
            meStore: { getMe: { slug: mySlug, name: mySlug } },
            peerStore: { getConnections: conns },
        })
        const [transport, mounted] = withSetup(() => usePeerTransport(ctx))
        app = mounted
        return [transport, ctx]
    }

    beforeEach(() => {
        sendSpies = {}
        conns = {}
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
        app?.unmount()
        app = null
        vi.restoreAllMocks()
    })

    // ── CLIENT : j'emballe, et pour le hub seul ──────────────────────────────────

    describe('client (je ne suis pas le hub)', () => {

        it('emballe le message dans une enveloppe `__starRoute` adressée au hub', () => {
            const hubSend = addOpenConn(HUB)
            const [transport] = mountStar({ isHub: false, remotePeers: [HUB, 'carol'] })

            transport.sendData('hello')

            // L'objet ENTIER, pas un `objectContaining` : c'est la forme du contrat que le
            // hub déballe, et un champ en trop y serait aussi anormal qu'un champ manquant.
            expect(hubSend).toHaveBeenCalledWith({
                __starRoute: true,
                to: null,
                from: ME,
                payload: 'hello',
            })
        })

        it('n\'envoie qu\'au hub, jamais en direct à un membre pourtant joignable', () => {
            const hubSend = addOpenConn(HUB)
            const carolSend = addOpenConn('carol')
            const [transport] = mountStar({ isHub: false, remotePeers: [HUB, 'carol'] })

            transport.sendData('hello', ['carol'])

            expect(carolSend).not.toHaveBeenCalled()
            expect(hubSend).toHaveBeenCalledWith(
                expect.objectContaining({ __starRoute: true, to: ['carol'] })
            )
        })

        it('reporte MON slug dans `from`, jamais celui du hub', () => {
            const hubSend = addOpenConn(HUB)
            const [transport] = mountStar({ isHub: false, remotePeers: [HUB] })

            transport.sendData('hello')

            // Le hub s'en sert pour m'exclure de sa retransmission — et pour rien d'autre :
            // côté hub, l'identité de l'expéditeur est résolue depuis `conn.peer`, jamais
            // lue ici (cf. forwardStar.test.js).
            expect(hubSend.mock.calls[0][0].from).toBe(ME)
        })

        // ⭐ Fait épinglé n° 1 — cf. l'en-tête.
        it('[épinglé] une liste de destinataires VIDE reste `[]` — ce n\'est pas une diffusion', () => {
            const hubSend = addOpenConn(HUB)
            const [transport] = mountStar({ isHub: false, remotePeers: [HUB, 'carol'] })

            transport.sendData('hello', [])

            expect(hubSend.mock.calls[0][0].to).toEqual([])
        })

        it('avertit et n\'envoie rien quand la connexion au hub est absente', () => {
            // Un membre joignable, mais pas le hub : le message ne doit PAS se rabattre
            // sur un envoi direct.
            const carolSend = addOpenConn('carol')
            const [transport] = mountStar({ isHub: false, remotePeers: [HUB, 'carol'] })

            transport.sendData('hello')

            expect(carolSend).not.toHaveBeenCalled()
            expect(warnSpy).toHaveBeenCalledWith(
                '[Client] Envoi ignoré: connexion hub indisponible', HUB
            )
        })
    })

    // ── HUB : j'envoie en direct, et sans enveloppe ──────────────────────────────

    describe('hub (je suis le hub)', () => {

        it('envoie les données NUES à chaque membre, sans enveloppe', () => {
            const bobSend = addOpenConn('bob')
            const carolSend = addOpenConn('carol')
            const [transport] = mountStar({ isHub: true, mySlug: HUB, remotePeers: ['bob', 'carol'] })

            transport.sendData('hello')

            expect(bobSend).toHaveBeenCalledWith('hello')
            expect(carolSend).toHaveBeenCalledWith('hello')
            // L'assertion négative porte le fait : le hub ne s'emballe jamais lui-même,
            // sans quoi ses clients recevraient une enveloppe à déballer une seconde fois.
            expect(bobSend).not.toHaveBeenCalledWith(
                expect.objectContaining({ __starRoute: true })
            )
        })

        it('restreint l\'envoi aux destinataires explicites', () => {
            const bobSend = addOpenConn('bob')
            const carolSend = addOpenConn('carol')
            const [transport] = mountStar({ isHub: true, mySlug: HUB, remotePeers: ['bob', 'carol'] })

            transport.sendData('hello', ['carol'])

            expect(carolSend).toHaveBeenCalledWith('hello')
            expect(bobSend).not.toHaveBeenCalled()
        })

        it('retombe sur la composition de la room quand aucun destinataire n\'est fourni', () => {
            const bobSend = addOpenConn('bob')
            const carolSend = addOpenConn('carol')
            const [transport] = mountStar({ isHub: true, mySlug: HUB, remotePeers: ['bob', 'carol'] })

            transport.sendData('hello', null)

            expect(bobSend).toHaveBeenCalledOnce()
            expect(carolSend).toHaveBeenCalledOnce()
        })

        // ⭐ Jumeau du fait épinglé n° 1, côté hub — et ici il n'y a même pas de hub pour
        // rattraper : le repli sur `remotePeers` ne joue pas, personne n'est servi.
        it('[épinglé] un `destUserSlugs` vide n\'envoie à personne', () => {
            const bobSend = addOpenConn('bob')
            const carolSend = addOpenConn('carol')
            const [transport] = mountStar({ isHub: true, mySlug: HUB, remotePeers: ['bob', 'carol'] })

            transport.sendData('hello', [])

            expect(bobSend).not.toHaveBeenCalled()
            expect(carolSend).not.toHaveBeenCalled()
        })

        it('avertit par destinataire injoignable sans interrompre les envois suivants', () => {
            // `dave` est au milieu de la liste : une boucle qui sortirait sur le premier
            // trou priverait `carol` de son message.
            const bobSend = addOpenConn('bob')
            const carolSend = addOpenConn('carol')
            const [transport] = mountStar({
                isHub: true, mySlug: HUB, remotePeers: ['bob', 'dave', 'carol'],
            })

            transport.sendData('hello')

            expect(warnSpy).toHaveBeenCalledWith(
                '[Hub] Envoi ignoré: connexion indisponible pour', 'dave'
            )
            expect(bobSend).toHaveBeenCalledWith('hello')
            expect(carolSend).toHaveBeenCalledWith('hello')
        })
    })

    // ── hubSlug absent : la sortie muette ────────────────────────────────────────

    describe('`hubSlug` absent', () => {
        // La branche star est gardée par `topology === 'star' && hubSlug`. Sans hub désigné,
        // `sendData` ne fait RIEN — pas d'envoi, et pas même un avertissement. C'est aussi
        // le meilleur contrôle du fichier : neutraliser le conjoint `&& ctx.hubSlug.value`
        // fait entrer dans la branche client, qui cherche une connexion vers `null`, n'en
        // trouve pas, et loggue — les deux cas rougissent alors sur « aucun warn ».
        //
        // ⚠️ Ces deux cas n'épinglent PAS un état atteignable en production : depuis le
        // 30/08/2026, `createPeerContext` lève sur `star` sans `hubSlug` — le contexte
        // était mort-né (les prédicats de `_doSyncUsersConnections` et de `sendData` sont
        // composés, donc faux pour toujours) et il produisait ce silence-là, sans un log.
        // Ce qu'ils gardent, c'est le CONJOINT du prédicat de cette couche, qu'un double
        // peut encore mettre en défaut ; la porte, elle, est fermée à la construction —
        // `createPeerContext.test.js`, « topologie refusée à la construction ».
        //
        // ⚠️ Et surtout : à ne pas confondre avec un `hubSlug` FOURNI dont le hub est
        // absent de la room, qui est un état transitoire parfaitement légitime — voir
        // `useConnectionPool.test.js`, « un client ne compose pas un hub absent ».

        it('sort en silence côté client — aucun envoi, aucun avertissement', () => {
            const carolSend = addOpenConn('carol')
            const [transport] = mountStar({ isHub: false, hubSlug: null, remotePeers: ['carol'] })

            transport.sendData('hello')

            expect(carolSend).not.toHaveBeenCalled()
            expect(warnSpy).not.toHaveBeenCalled()
        })

        it('sort en silence même en tant que hub', () => {
            const carolSend = addOpenConn('carol')
            const [transport] = mountStar({
                isHub: true, hubSlug: null, mySlug: HUB, remotePeers: ['carol'],
            })

            transport.sendData('hello')

            expect(carolSend).not.toHaveBeenCalled()
            expect(warnSpy).not.toHaveBeenCalled()
        })
    })

    // ── Asymétrie de taille : ÉPINGLÉE, pas souhaitée ────────────────────────────

    describe('limite de taille : absente des deux branches star (fait épinglé)', () => {
        // ⚠️ Contrôle négatif INVERSÉ : la propriété est une ABSENCE, il n'y a aucune ligne
        // à neutraliser. Le contrôle consiste à AJOUTER `isPayloadWithinLimit(data, '[Star]')`
        // en tête de la branche star — les deux cas rougissent alors, et `mesh.test.js`
        // reste vert. Mesuré le 2026-08-29.
        const huge = 'x'.repeat(MAX_PAYLOAD_BYTES + 1)

        it('[épinglé] le client emballe et transmet un payload hors limite', () => {
            const hubSend = addOpenConn(HUB)
            const [transport] = mountStar({ isHub: false, remotePeers: [HUB] })

            transport.sendData(huge)

            expect(hubSend).toHaveBeenCalledOnce()
            expect(hubSend.mock.calls[0][0].payload).toBe(huge)
            expect(warnSpy).not.toHaveBeenCalled()
        })

        it('[épinglé] le hub relaie en direct un payload hors limite', () => {
            const bobSend = addOpenConn('bob')
            const [transport] = mountStar({ isHub: true, mySlug: HUB, remotePeers: ['bob'] })

            transport.sendData(huge)

            expect(bobSend).toHaveBeenCalledWith(huge)
            expect(warnSpy).not.toHaveBeenCalled()
        })
    })
})
