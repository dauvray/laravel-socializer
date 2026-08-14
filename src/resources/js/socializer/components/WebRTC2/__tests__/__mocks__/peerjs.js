/**
 * __mocks__/peerjs.js — Mock de la classe Peer de PeerJS
 *
 * PeerJS nécessite un vrai navigateur WebRTC. Ce mock expose
 * la même interface que la vraie classe Peer, mais sans aucune
 * dépendance réseau/WebRTC.
 *
 * Résolution automatique via vitest.config.js :
 *   alias: { peerjs: './__mocks__/peerjs.js' }
 *
 * ── Deux modes ────────────────────────────────────────────────────────────────
 *
 * 1. **Isolé** (défaut, historique) — `peer.connect()` / `peer.call()` retournent une
 *    connexion factice ORPHELINE : elle n'atteint aucun autre pair. Suffisant pour
 *    tester une couche seule, et c'est le mode de tous les tests unitaires existants.
 *
 *      import { Peer, getLastPeerInstance, resetPeerMock } from '../__mocks__/peerjs.js'
 *      resetPeerMock()  // dans beforeEach
 *      const instance = getLastPeerInstance()
 *      instance._triggerEvent('open', 'fake-peer-id')
 *
 * 2. **Bus** (opt-in, `createPeerBus()`) — les instances `Peer` sont reliées entre elles :
 *    `peer.connect(id)` livre réellement une connexion à la cible via `on('connection')`,
 *    `conn.send()` traverse, `peer.call()` déclenche `on('call')` et `answer()` fait
 *    circuler les flux dans les deux sens. C'est ce qui rend testable le seul symptôme
 *    qui casse en production — « A diffuse, B arrive, B ne voit rien » — impossible à
 *    observer avec des connexions orphelines.
 *
 *      const bus = createPeerBus()   // dans beforeEach
 *      ...
 *      bus.destroy()                 // dans afterEach
 *
 * ⚠️ Le bus vit sur `globalThis` (et non dans une variable de module) parce que le
 * harnais multi-pairs appelle `vi.resetModules()` entre deux pairs : chaque pair charge
 * sa propre copie des composables WebRTC2 (usePeerTransport porte son registre de
 * contextes au niveau du module, donc un singleton par module), mais tous doivent
 * partager LE MÊME bus.
 *
 * ⚠️ Toute livraison est asynchrone (`queueMicrotask`), jamais synchrone : le code de
 * production branche ses handlers APRÈS l'appel (`call.answer(...)` puis
 * `setUpConnectionListeners(call)`). Une livraison synchrone les manquerait tous et
 * donnerait des tests faussement rouges.
 */
import { vi } from 'vitest'

// Référence vers la dernière instance créée (utile pour les assertions)
let _lastInstance = null

export function getLastPeerInstance() {
    return _lastInstance
}

export function resetPeerMock() {
    _lastInstance = null
}

// ─── Bus in-memory (opt-in) ───────────────────────────────────────────────────
// Clé partagée entre toutes les copies du module (cf. vi.resetModules ci-dessus).
const BUS_KEY = Symbol.for('webrtc2.test.peerBus')

const _getBus = () => globalThis[BUS_KEY] ?? null

/**
 * Active le bus : à partir de cet appel, les instances Peer se voient et les
 * connexions sont réellement acheminées. Sans cet appel, comportement isolé.
 *
 * @returns {{peers: Map, reset: Function, destroy: Function, flush: Function}}
 */
export function createPeerBus() {
    const bus = { peers: new Map() }
    globalThis[BUS_KEY] = bus

    return {
        peers: bus.peers,
        /** Vide le registre sans désactiver le bus. */
        reset: () => bus.peers.clear(),
        /** Désactive le bus — retour au mode isolé. */
        destroy: () => { delete globalThis[BUS_KEY] },
        /** Laisse les livraisons en vol se terminer. */
        flush: flushBus,
    }
}

/** Désactive le bus s'il existe (sûr à appeler sans bus actif). */
export function resetPeerBus() {
    delete globalThis[BUS_KEY]
}

/**
 * Draine les livraisons en attente. Une poignée de tours de microtâches suffit :
 * chaque étape d'un établissement (connection → open → data) en consomme une.
 */
export async function flushBus(turns = 8) {
    for (let i = 0; i < turns; i += 1) await Promise.resolve()
}

const _deliver = (fn) => queueMicrotask(fn)

const _randomId = (prefix) => `${prefix}-${Math.random().toString(36).slice(2)}`

/**
 * Signale à l'appelant que le peerId visé n'existe pas — l'erreur exacte que PeerJS
 * émet sur un peerId périmé (`_destroyPeerSingleton` détruit le peer d'un onglet
 * inactif au bout de PEER_DESTROY_DELAY_MS). C'est ce qui rend le chemin de recovery
 * `peer-unavailable` observable en test.
 */
const _emitPeerUnavailable = (peer, peerId) => {
    _deliver(() => {
        const error = new Error(`Could not connect to peer ${peerId}`)
        error.type = 'peer-unavailable'
        peer._triggerEvent('error', error)
    })
}

export class Peer {
    constructor(id, options) {
        this.id = id || _randomId('mock-peer')
        this.options = options
        this.open = false
        this.destroyed = false
        this.disconnected = false

        // Stockage des handlers par événement
        this._handlers = {}

        // Expose les méthodes comme vi.fn() pour les assertions
        this.on = vi.fn((event, handler) => {
            if (!this._handlers[event]) this._handlers[event] = []
            this._handlers[event].push(handler)
            return this
        })
        this.off = vi.fn((event, handler) => {
            if (!this._handlers[event]) return this
            this._handlers[event] = this._handlers[event].filter((h) => h !== handler)
            return this
        })

        this.connect = vi.fn((peerId, options) => {
            const bus = _getBus()
            if (!bus) return createMockDataConnection()

            const target = bus.peers.get(peerId)
            if (!target || target.destroyed) {
                _emitPeerUnavailable(this, peerId)
                // PeerJS retourne bien un objet : il ne s'ouvrira simplement jamais.
                return createMockDataConnection(options?.metadata)
            }

            const { local, remote } = _createLinkedPair('data', this, target, options?.metadata)

            _deliver(() => {
                // Ordre fidèle à PeerJS : la cible reçoit d'abord la connexion (et y
                // branche ses handlers), l'ouverture n'est notifiée qu'ensuite.
                target._triggerEvent('connection', remote)
                _openLinkedPair(local, remote)
            })

            return local
        })

        this.call = vi.fn((peerId, stream, options) => {
            const bus = _getBus()
            if (!bus) return createMockMediaConnection()

            const target = bus.peers.get(peerId)
            if (!target || target.destroyed) {
                _emitPeerUnavailable(this, peerId)
                return createMockMediaConnection(options?.metadata)
            }

            const { local, remote } = _createLinkedPair('media', this, target, options?.metadata)

            // Le flux de l'appelant n'est livré qu'au moment du `answer()` du récepteur,
            // comme en vrai (il transite après négociation ICE).
            remote.__pendingInboundStream = stream ?? null

            _deliver(() => target._triggerEvent('call', remote))

            return local
        })

        // Connexions dont ce Peer est l'une des extrémités (mode bus uniquement).
        this._connections = new Set()

        this.destroy = vi.fn(() => {
            this.destroyed = true
            const bus = _getBus()
            if (bus && bus.peers.get(this.id) === this) bus.peers.delete(this.id)

            // PeerJS ferme TOUTES les connexions du peer à sa destruction, et le pair
            // d'en face reçoit bien un `close`. Sans ça, un onglet fermé laisserait chez
            // les autres des connexions éternellement « ouvertes » : `hasOpenConnection`
            // resterait vrai, le moteur de retry ne repartirait jamais, et le scénario
            // « A revient avec un nouveau peerId » serait vert sans rien prouver.
            this._connections.forEach((conn) => {
                try { conn.close() } catch { /* déjà fermée */ }
            })
            this._connections.clear()
        })
        this.disconnect = vi.fn(() => { this.disconnected = true })
        this.reconnect = vi.fn()

        _lastInstance = this
        this._registerOnBus()
    }

    /**
     * S'inscrit au registre du bus sous son id courant (no-op sans bus actif).
     *
     * ⚠️ Garde `typeof === 'string'` : le code de production appelle
     * `new Peer({ host, port, … })` — le 1er argument est l'objet d'options, pas un id.
     * `this.id` porte donc cet objet jusqu'à l'événement `open`, et l'inscrire
     * polluerait le registre avec une clé inatteignable.
     */
    _registerOnBus() {
        const bus = _getBus()
        if (bus && typeof this.id === 'string') bus.peers.set(this.id, this)
    }

    // Helper de test : déclenche un événement enregistré via .on()
    _triggerEvent(event, ...args) {
        // `open` porte le peerId attribué par le serveur PeerJS : on l'applique à
        // l'instance (comme le vrai client) et on (ré)inscrit le peer au registre,
        // sans quoi le harnais devrait connaître l'id avant qu'il existe.
        if (event === 'open' && typeof args[0] === 'string') {
            const bus = _getBus()
            if (bus && typeof this.id === 'string' && this.id !== args[0]) {
                bus.peers.delete(this.id)
            }
            this.id = args[0]
            this.open = true
            this._registerOnBus()
        }

        const handlers = this._handlers[event] ?? []
        handlers.forEach((fn) => fn(...args))
    }
}

// ─── Connexions factices ──────────────────────────────────────────────────────

/**
 * Socle commun aux connexions data et media — utilisé aussi bien pour les connexions
 * orphelines (mode isolé) que pour les paires reliées (mode bus).
 */
function _createBaseConnection(defaultMetadata, metadata) {
    const handlers = {}
    const conn = {
        open: false,
        metadata: { ...defaultMetadata, ...metadata },
        peer: _randomId('remote-peer'),
        on: vi.fn((event, handler) => {
            if (!handlers[event]) handlers[event] = []
            handlers[event].push(handler)
            return conn
        }),
        off: vi.fn((event, handler) => {
            if (!handlers[event]) return conn
            handlers[event] = handlers[event].filter((h) => h !== handler)
            return conn
        }),
        send: vi.fn(),
        close: vi.fn(),
        _handlers: handlers,
        _triggerEvent(event, ...args) {
            const list = handlers[event] ?? []
            list.forEach((fn) => fn(...args))
        },
    }
    return conn
}

function createMockDataConnection(metadata = {}) {
    const conn = _createBaseConnection({ type: 'data', room: 'test' }, metadata)
    // Une vraie `DataConnection` PeerJS porte un `chunker`, et le code de production
    // s'en sert comme preuve que le datachannel est réellement utilisable
    // (`_getOpenDataConnection` : `conn?.open && conn?.chunker`). Sans lui, toute
    // connexion du bus est jugée indisponible et `sendData` n'envoie jamais rien.
    conn.chunker = {}
    return conn
}

function createMockMediaConnection(metadata = {}) {
    const conn = _createBaseConnection({ type: 'visio', room: 'test' }, metadata)
    conn.peerConnection = {
        connectionState: 'connected',
        signalingState: 'stable',
    }
    conn.answer = vi.fn()
    return conn
}

// ─── Paires reliées (mode bus) ────────────────────────────────────────────────

/**
 * Crée les deux extrémités d'une même connexion et les relie.
 *
 * Les DEUX portent la `metadata` fournie par l'appelant — c'est le comportement de
 * PeerJS, et c'est ce dont dépend toute l'identification des pairs
 * (`metadata.from` / `.type` / `.room`). Le mock historique ignorait purement et
 * simplement l'argument `options`, si bien que toute connexion arrivait avec
 * `{ type: 'data', room: 'test' }` : aucun test ne pouvait exercer la résolution
 * d'identité réelle.
 *
 * `conn.peer` porte de chaque côté le peerId d'EN FACE — c'est sur quoi repose
 * l'anti-usurpation de `_isAuthorizedIncomingPeer`.
 */
function _createLinkedPair(kind, localPeer, remotePeer, metadata = {}) {
    const make = kind === 'media' ? createMockMediaConnection : createMockDataConnection

    const local = make(metadata)
    const remote = make(metadata)

    local.peer = remotePeer.id
    remote.peer = localPeer.id

    local.__link = remote
    remote.__link = local
    local.__localPeer = localPeer
    remote.__localPeer = remotePeer

    // Chaque extrémité appartient à son Peer : c'est ce qui permet à destroy() de
    // fermer les connexions d'un onglet qui se ferme (cf. Peer.destroy).
    localPeer._connections.add(local)
    remotePeer._connections.add(remote)

    _wireSend(local)
    _wireSend(remote)
    _wireClose(local)
    _wireClose(remote)

    if (kind === 'media') {
        // Seule l'extrémité RECEVEUSE répond ; `answer()` est ce qui fait circuler les
        // flux dans les deux sens (l'appelant reçoit celui du receveur, et
        // réciproquement). Un appel one-way = `answer(undefined)` : l'appelant ne
        // reçoit rien, le receveur reçoit bien le flux — exactement le cas
        // « A diffuse vers B » de `usePeerTransport`.
        remote.answer = vi.fn((answerStream) => {
            _openLinkedPair(local, remote)

            const inbound = remote.__pendingInboundStream
            if (inbound) _deliver(() => remote._triggerEvent('stream', inbound))
            if (answerStream) _deliver(() => local._triggerEvent('stream', answerStream))
        })
    }

    return { local, remote }
}

function _wireSend(conn) {
    conn.send = vi.fn((data) => {
        const peer = conn.__link
        if (!peer || !conn.open) return
        _deliver(() => peer._triggerEvent('data', data))
    })
}

function _wireClose(conn) {
    conn.close = vi.fn(() => {
        if (conn.__closed) return
        conn.__closed = true
        conn.open = false
        if (conn.peerConnection) conn.peerConnection.connectionState = 'closed'
        _deliver(() => conn._triggerEvent('close'))

        const peer = conn.__link
        if (!peer || peer.__closed) return
        peer.__closed = true
        peer.open = false
        if (peer.peerConnection) peer.peerConnection.connectionState = 'closed'
        _deliver(() => peer._triggerEvent('close'))
    })
}

function _openLinkedPair(local, remote) {
    if (local.open && remote.open) return
    remote.open = true
    local.open = true
    remote._triggerEvent('open')
    local._triggerEvent('open')
}

export { createMockDataConnection, createMockMediaConnection }
export default { Peer }
