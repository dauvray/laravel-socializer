/**
 * usePeerTransport.sendDataOnConnection.test.js
 * Périmètre : `sendDataOnConnection` — répondre SUR une connexion reçue.
 *
 * ── Le défaut couvert ─────────────────────────────────────────────────────────
 *
 * `sendData` résout sa connexion PAR SLUG dans `peerStore.connections`, et cette map ne
 * contient QUE les connexions sortantes : `storePeerConnection` n'a qu'un appelant,
 * `_saveRoomConnection`, et tous ses sites sont dans `connectToPeer` ; le dispatcher
 * entrant appelle `setUpConnectionListeners(conn)` et rien d'autre. Une connexion reçue en
 * `onConnectionOpen` est donc INTROUVABLE par slug, et un consommateur qui répond à un
 * arrivant par `sendData` dépendait en réalité de sa propre sortante inverse — plus lente
 * (le mapping `slug → peerId` du récepteur est structurellement absent quand l'entrante
 * arrive la première, cf. `scenarios/incomingMappingInvariant.test.js`). Sa réponse tombait
 * dans un `console.warn`, sans réessai : c'est ce qui vidait le tableau d'un arrivant du
 * Whiteboard.
 *
 * ── Ce que la suite épingle, et ce qu'elle ne peut pas voir ───────────────────
 *
 * Le premier cas est LE cas de régression : le store est laissé **vide**, donc `sendData`
 * n'aurait rien émis, et l'émission a lieu quand même. Les cas de taille sont le second
 * contrat du verbe — c'est la seule raison de passer par le transport plutôt que d'appeler
 * `conn.send` depuis un composant, et un jour où ce garde sauterait, rien d'autre ne le
 * dirait.
 *
 * ⚠️ Même limite de harnais que `usePeerTransport.mesh.test.js` : `conn.send` est un
 * `vi.fn()`, il accepte tout. Aucun test d'ici ne peut voir un throw de sérialisation
 * BinaryPack.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockContext } from './helpers/createMockContext.js'
import { withSetup } from './helpers/withSetup.js'
import { usePeerTransport } from '~socializer/components/WebRTC2/Composables/usePeerTransport.js'
import { MAX_PAYLOAD_BYTES } from '~socializer/components/WebRTC2/webrtc2.config.js'

describe('usePeerTransport — sendDataOnConnection (réponse sur une connexion reçue)', () => {
    let ctx
    let app
    let transport
    let incoming
    let otherPeerSend

    // Une connexion reçue : ouverte, émettrice, et ABSENTE du store — comme en production.
    const makeIncomingConn = ({ open = true } = {}) => ({
        open,
        chunker: {},
        send: vi.fn(),
        metadata: { from: 'bob', slug: 'alice', type: 'data', room: 'app' },
    })

    beforeEach(() => {
        // Store de connexions VIDE : c'est l'état réel d'un pair qui n'a reçu qu'une
        // entrante. `sendData` ne trouverait personne ici.
        ctx = createMockContext({
            connection: { remotePeers: ['bob'] },
            peerStore: { getConnections: {} },
        })

        incoming = makeIncomingConn()
        otherPeerSend = vi.fn()

        ;[transport, app] = withSetup(() => usePeerTransport(ctx))

        vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
        app.unmount()
        vi.restoreAllMocks()
    })

    /**
     * ⭐ LE cas de régression. Le store est vide, donc la contre-épreuve est dans le même
     * test : `sendData` n'émet rien sur le même contexte, `sendDataOnConnection` émet.
     */
    it('émet sur la connexion donnée alors que le store de connexions est VIDE', () => {
        const payload = { action: 'update_scene', details: { elements: [{ id: 'a' }], files: {} } }

        transport.sendData(payload)
        expect(incoming.send).not.toHaveBeenCalled()

        transport.sendDataOnConnection(incoming, payload)

        expect(incoming.send).toHaveBeenCalledTimes(1)
        expect(incoming.send).toHaveBeenCalledWith(payload)
    })

    /**
     * Le verbe est point à point : il ne consulte ni `remotePeers` ni le store, donc un
     * pair joignable par ailleurs ne doit RIEN recevoir. C'est ce qui distingue le renvoi
     * ciblé à un arrivant de l'ancienne diffusion — laquelle faisait pousser N scènes
     * entières à tout le monde, alors qu'`updateScene` remplace la scène du récepteur.
     */
    it("ne touche aucune autre connexion, même joignable dans le store", () => {
        ctx.peerStore.getConnections.app = {
            carol: { data: [{ open: true, chunker: {}, send: otherPeerSend }] },
        }
        ctx.connection.remotePeers = ['bob', 'carol']

        transport.sendDataOnConnection(incoming, 'hello')

        expect(incoming.send).toHaveBeenCalledWith('hello')
        expect(otherPeerSend).not.toHaveBeenCalled()
    })

    it('transmet le payload SANS transformation ni enveloppe (identité référentielle)', () => {
        const payload = { action: 'update_scene', details: { elements: [], files: {} } }

        transport.sendDataOnConnection(incoming, payload)

        expect(incoming.send.mock.calls[0][0]).toBe(payload)
    })

    it('rejette un payload dépassant MAX_PAYLOAD_BYTES (aucun envoi)', () => {
        transport.sendDataOnConnection(incoming, 'x'.repeat(MAX_PAYLOAD_BYTES + 1))

        expect(incoming.send).not.toHaveBeenCalled()
    })

    it('rejette un payload binaire dépassant la limite (ArrayBuffer)', () => {
        transport.sendDataOnConnection(incoming, new ArrayBuffer(MAX_PAYLOAD_BYTES + 1))

        expect(incoming.send).not.toHaveBeenCalled()
    })

    it('accepte un payload binaire pile à la limite', () => {
        const atLimit = new ArrayBuffer(MAX_PAYLOAD_BYTES)

        transport.sendDataOnConnection(incoming, atLimit)

        expect(incoming.send).toHaveBeenCalledWith(atLimit)
    })

    it("rejette un payload non sérialisable (annule l'envoi)", () => {
        transport.sendDataOnConnection(incoming, () => {})

        expect(incoming.send).not.toHaveBeenCalled()
    })

    /**
     * Une connexion fermée entre l'ouverture et l'échéance du renvoi n'est pas une anomalie
     * de programmation : le Whiteboard attend une seconde avant de répondre, et l'arrivant
     * peut avoir refermé l'onglet entre-temps. Ce chemin doit se taire, pas lever — une
     * levée ici remonterait dans un `setTimeout`, donc invisible autrement qu'en
     * `unhandled`.
     */
    it('refuse une connexion fermée sans lever', () => {
        const closed = makeIncomingConn({ open: false })

        expect(() => transport.sendDataOnConnection(closed, 'hello')).not.toThrow()
        expect(closed.send).not.toHaveBeenCalled()
    })

    it('refuse une connexion absente ou sans send() sans lever', () => {
        expect(() => transport.sendDataOnConnection(null, 'hello')).not.toThrow()
        expect(() => transport.sendDataOnConnection({ open: true }, 'hello')).not.toThrow()
    })
})
