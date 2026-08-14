/**
 * usePeerTransport.forwardStar.test.js
 * Périmètre : forwardStarMessage (hub topologie star) — validation de envelope.to.
 *
 * Faille couverte : [HAUTE] envelope.to non validé ni restreint aux membres de la room.
 * Le hub ne doit retransmettre qu'aux slugs (a) au format valide ET (b) réellement
 * présents dans usersInRoom, l'expéditeur étant toujours exclu.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockContext } from './helpers/createMockContext.js'
import { withSetup } from './helpers/withSetup.js'
import { usePeerTransport } from '~socializer/components/WebRTC2/Composables/usePeerTransport.js'

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
            connection: { usersInRoom: [SENDER, 'bob', 'carol'] },
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
        // mallory n'est pas dans usersInRoom → aucune connexion, aucun envoi.
        expect(Object.keys(sendSpies)).not.toContain('mallory')
    })

    it('ignore les slugs au format invalide même si la connexion existe', () => {
        const evil = 'bob; rm -rf /'
        // Une connexion existe malgré un slug malformé : le filtre _isValidSlug doit primer.
        const evilSend = addOpenConn(evil)
        ctx.connection.usersInRoom.push(evil)

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
})
