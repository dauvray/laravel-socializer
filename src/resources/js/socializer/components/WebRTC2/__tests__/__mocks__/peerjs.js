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
 *
 * ⚠️ **Une connexion refusée ne revient JAMAIS à son émetteur.** C'est l'asymétrie la
 * plus coûteuse de PeerJS, et le mock la reproduit désormais :
 *   - une MediaConnection naît en `connecting` et ne passe à `connected` qu'au `answer()`
 *     du récepteur — un appel non répondu reste `connecting` pour toujours ;
 *   - `close()` ne se propage à l'autre extrémité que si la paire a été ouverte
 *     (`__everOpened`) : refuser à l'admission laisse l'émetteur dans le noir.
 * Le mock affirmait l'inverse sur les deux points (naissance `connected`, propagation
 * inconditionnelle), ce qui rendait structurellement invisible la panne « A diffuse, B ne
 * voit rien » dans sa forme définitive.
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
                // ⚠️ Et il porte le peerId VISÉ. C'est par ce champ que la recovery
                // `peer-unavailable` retrouve la connexion morte pour la purger du store ;
                // sans lui, elle restait indéfiniment « en vol » et `hasOpenConnection`
                // empêchait toute re-demande — un blocage que seul le mock fabriquait.
                return _orphanTo(createMockDataConnection(options?.metadata), peerId)
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
                return _orphanTo(createMockMediaConnection(options?.metadata), peerId)
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
            if (this.destroyed) return

            // ⚠️ ORDRE FIDÈLE à peerjs 1.5.4 (`dist/bundler.mjs:1776-1783`), et c'est tout
            // l'intérêt de ce bloc : `destroy()` appelle `disconnect()` — qui **émet
            // `disconnected`** (l.1810) — puis `_cleanup()`, et ne pose son drapeau
            // `_destroyed` qu'ENSUITE (l.1781), avant d'émettre `close`. Un handler encore
            // branché voit donc `peer.destroyed === false` pendant sa propre destruction.
            // Le mock posait auparavant `destroyed = true` en premier et n'émettait jamais
            // `disconnected` : le fait qu'une destruction volontaire soit prise pour une
            // coupure réseau était invisible en test.
            const bus = _getBus()
            if (bus && bus.peers.get(this.id) === this) bus.peers.delete(this.id)

            this.disconnect()

            // PeerJS ferme TOUTES les connexions du peer à sa destruction, et le pair
            // d'en face reçoit bien un `close`. Sans ça, un onglet fermé laisserait chez
            // les autres des connexions éternellement « ouvertes » : `hasOpenConnection`
            // resterait vrai, le moteur de retry ne repartirait jamais, et le scénario
            // « A revient avec un nouveau peerId » serait vert sans rien prouver.
            this._connections.forEach((conn) => {
                try { conn.close() } catch { /* déjà fermée */ }
            })
            this._connections.clear()

            this.destroyed = true
            this._triggerEvent('close')

            // ⚠️ `_handlers` n'est PAS vidé, et ce n'est pas un oubli : le vrai `_cleanup()`
            // ne fait `removeAllListeners()` que sur son SOCKET interne (l.1789), jamais sur
            // le `Peer`. Les handlers posés par `usePeerTransport` survivent donc bel et bien
            // à `destroy()` — c'est précisément ce que la production ne doit pas déléguer à
            // PeerJS. Les vider ici serait le mode de panne nº2 de `mockFidelity.test.js` :
            // rendre vert un correctif inerte.
        })

        // Fidèle à `bundler.mjs:1801-1811` : ferme le socket, mémorise l'id dans
        // `_lastServerId`, puis **émet `disconnected`**.
        //
        // Écart assumé : le vrai met aussi `_id = null` (l.1809). On ne le reproduit pas —
        // le registre du bus est keyé sur `id` et trois scénarios appellent `destroy()`
        // directement. À traiter comme un item de fidélité distinct.
        this.disconnect = vi.fn(() => {
            if (this.disconnected) return
            this.disconnected = true
            this.open = false
            this._lastServerId = this.id
            this._triggerEvent('disconnected', this.id)
        })
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
    // `connection.type` est l'API PeerJS ('data' | 'media'). C'est ce qui permet de
    // distinguer les deux quand elles sont stockées sous la même clé — le cas du
    // contexte `stream`, qui ouvre un appel ET un canal data avec la même metadata.
    conn.type = 'data'
    // Une vraie `DataConnection` PeerJS porte un `chunker`, et le code de production
    // s'en sert comme preuve que le datachannel est réellement utilisable
    // (`_getOpenDataConnection` : `conn?.open && conn?.chunker`). Sans lui, toute
    // connexion du bus est jugée indisponible et `sendData` n'envoie jamais rien.
    conn.chunker = {}
    // Une DataConnection a SON PROPRE RTCPeerConnection (un négociateur par connexion),
    // au même titre qu'un appel média. L'omettre laissait croire qu'un canal data ne
    // pouvait jamais être pris pour un appel établi — ce qui est faux en production.
    conn.peerConnection = {
        connectionState: 'connecting',
        signalingState: 'stable',
    }
    return conn
}

function createMockMediaConnection(metadata = {}) {
    const conn = _createBaseConnection({ type: 'visio', room: 'test' }, metadata)
    conn.type = 'media'   // API PeerJS, cf. createMockDataConnection
    // ⚠️ `connecting`, PAS `connected` — et c'est un correctif, pas un détail.
    //
    // Une MediaConnection naissait ici déjà établie. Aucun test ne pouvait donc
    // observer un `peer.call()` que personne ne répond, qui est pourtant l'état le plus
    // fréquent d'un appel en vol : tant que le récepteur n'a pas appelé `answer()`, le
    // `RTCPeerConnection` de l'appelant reste en `connecting` — et n'en sortira JAMAIS
    // tout seul, WebRTC ne le fait pas passer à `failed` faute de réponse.
    //
    // Ce mensonge a coûté une panne définitive en production : le moteur de retry lit
    // `hasOpenConnection`, qui admet `connecting`, et concluait « connexion établie » une
    // seconde après l'appel. Voir `isConnectionEstablished` dans usePeerConnections.
    conn.peerConnection = {
        connectionState: 'connecting',
        signalingState: 'stable',
    }
    conn.answer = vi.fn()
    return conn
}

/**
 * Marque une connexion orpheline comme visant un peerId précis.
 *
 * PeerJS renvoie toujours un objet, même vers un pair injoignable, et cet objet porte
 * `conn.peer = <peerId visé>`. C'est le seul lien entre la connexion morte et le pair
 * qu'elle visait — donc le seul moyen, pour la recovery `peer-unavailable`, de la
 * retrouver dans le store et de l'y retirer.
 */
function _orphanTo(conn, peerId) {
    conn.peer = String(peerId)
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

        // ⚠️ La fermeture ne se propage QUE sur une paire réellement établie.
        //
        // Refuser une connexion jamais ouverte — le récepteur ferme dans son
        // `on('connection')` / `on('call')` avant tout `answer()` — ne notifie
        // strictement RIEN à l'émetteur : il n'existe aucun canal pour porter
        // l'information (PeerJS ne signale pas le `close()` d'un appel non répondu).
        // L'émetteur reste donc sur une connexion en `connecting`, indéfiniment.
        //
        // Le mock propageait inconditionnellement : un refus rendait la connexion
        // `closed` chez l'émetteur, son retry repartait, et le harnais montrait une
        // récupération que la production n'a jamais eue.
        if (!conn.__everOpened) return

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
    // Une extrémité déjà fermée (refus à l'admission) ne s'ouvre pas rétroactivement :
    // le mock rouvrait ce que le récepteur venait de refuser.
    if (local.__closed || remote.__closed) return

    remote.open = true
    local.open = true
    // `__everOpened` ne redescend jamais : il dit « cette paire a existé », ce dont
    // dépend la propagation de la fermeture ci-dessus.
    remote.__everOpened = true
    local.__everOpened = true

    // L'établissement du transport est ce qui fait passer le RTCPeerConnection à
    // `connected` — côté média, c'est le `answer()` du récepteur qui l'appelle.
    if (local.peerConnection) local.peerConnection.connectionState = 'connected'
    if (remote.peerConnection) remote.peerConnection.connectionState = 'connected'

    remote._triggerEvent('open')
    local._triggerEvent('open')
}

export { createMockDataConnection, createMockMediaConnection }
export default { Peer }
