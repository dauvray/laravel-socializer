/**
 * usePeerTransport.mesh.test.js
 * Périmètre : sendData (topologie mesh) — limite de taille des payloads.
 *
 * Faille couverte : [MOYENNE] Aucune limite de taille sur les messages en mesh
 * (DoS pair-à-pair). L'envoi direct ne doit pas diffuser à tous les pairs un
 * payload dépassant MAX_PAYLOAD_BYTES ; un payload trop volumineux ou non
 * sérialisable annule entièrement l'envoi (aucun pair n'est contacté).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockContext } from './helpers/createMockContext.js'
import { withSetup } from './helpers/withSetup.js'
import { usePeerTransport } from '~socializer/components/WebRTC2/Composables/usePeerTransport.js'
import { MAX_PAYLOAD_BYTES } from '~socializer/components/WebRTC2/webrtc2.config.js'

describe('usePeerTransport — sendData mesh (limite de taille payload)', () => {
    let ctx
    let app
    let transport
    let sendSpies
    let conns

    const ROOM = 'app'
    const TYPE = 'data'

    // Ajoute une connexion data ouverte pour `slug` et retourne son spy `send`.
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
        ctx = createMockContext({
            // topology 'mesh' est la valeur par défaut du mock
            connection: { remotePeers: ['bob', 'carol'] },
            peerStore: { getConnections: conns },
        })

        addOpenConn('bob')
        addOpenConn('carol')

        ;[transport, app] = withSetup(() => usePeerTransport(ctx))

        // Silence les warnings console attendus lors des rejets
        vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
        app.unmount()
        vi.restoreAllMocks()
    })

    it('diffuse un payload dans la limite à tous les membres de la room', () => {
        transport.sendData('hello')

        expect(sendSpies.bob).toHaveBeenCalledWith('hello')
        expect(sendSpies.carol).toHaveBeenCalledWith('hello')
    })

    it('rejette un payload JSON dépassant MAX_PAYLOAD_BYTES (aucun envoi)', () => {
        // Chaîne d'octets > limite (chaque caractère ASCII = 1 octet en UTF-8)
        const huge = 'x'.repeat(MAX_PAYLOAD_BYTES + 1)

        transport.sendData(huge)

        expect(sendSpies.bob).not.toHaveBeenCalled()
        expect(sendSpies.carol).not.toHaveBeenCalled()
    })

    it('rejette un payload binaire dépassant la limite (ArrayBuffer)', () => {
        const huge = new ArrayBuffer(MAX_PAYLOAD_BYTES + 1)

        transport.sendData(huge)

        expect(sendSpies.bob).not.toHaveBeenCalled()
        expect(sendSpies.carol).not.toHaveBeenCalled()
    })

    it('accepte un payload binaire pile à la limite', () => {
        const atLimit = new ArrayBuffer(MAX_PAYLOAD_BYTES)

        transport.sendData(atLimit)

        expect(sendSpies.bob).toHaveBeenCalledWith(atLimit)
        expect(sendSpies.carol).toHaveBeenCalledWith(atLimit)
    })

    it('rejette un payload non sérialisable (annule l\'envoi)', () => {
        // Une fonction n'est ni binaire, ni sérialisable en JSON
        transport.sendData(() => {})

        expect(sendSpies.bob).not.toHaveBeenCalled()
        expect(sendSpies.carol).not.toHaveBeenCalled()
    })

    it('applique la limite aussi avec une cible explicite (destUserSlugs)', () => {
        const huge = 'x'.repeat(MAX_PAYLOAD_BYTES + 1)

        transport.sendData(huge, ['bob'])

        expect(sendSpies.bob).not.toHaveBeenCalled()
    })

    // ── getDataReachablePeers ────────────────────────────────────────────────
    // Permet aux envois opportunistes (annonce de diffusion) de se taire au lieu de
    // remplir la console d'un warn par destinataire injoignable.

    describe('getDataReachablePeers', () => {

        it('liste les membres ayant une connexion data ouverte', () => {
            expect(transport.getDataReachablePeers()).toEqual(['bob', 'carol'])
        })

        it('exclut un membre sans connexion', () => {
            ctx.connection.remotePeers = ['bob', 'carol', 'dave']

            expect(transport.getDataReachablePeers()).toEqual(['bob', 'carol'])
        })

        it('exclut une connexion fermée ou sans datachannel actif', () => {
            conns[ROOM].bob[TYPE][0].open = false
            conns[ROOM].carol[TYPE][0].chunker = null

            expect(transport.getDataReachablePeers()).toEqual([])
        })

        it('retourne une liste vide sans aucune connexion', () => {
            ctx.connection.remotePeers = []

            expect(transport.getDataReachablePeers()).toEqual([])
        })
    })
})
