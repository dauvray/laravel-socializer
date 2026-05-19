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
 * Utilisation dans les tests :
 *   import { Peer, getLastPeerInstance, resetPeerMock } from '../__mocks__/peerjs.js'
 *   resetPeerMock()  // dans beforeEach
 *   const instance = getLastPeerInstance()
 *   instance._triggerEvent('open', 'fake-peer-id')  // simuler un événement PeerJS
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

export class Peer {
    constructor(id, options) {
        this.id = id || `mock-peer-${Math.random().toString(36).slice(2)}`
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
        this.connect = vi.fn((_peerId, _options) => createMockDataConnection())
        this.call = vi.fn((_peerId, _stream, _options) => createMockMediaConnection())
        this.destroy = vi.fn(() => { this.destroyed = true })
        this.disconnect = vi.fn(() => { this.disconnected = true })
        this.reconnect = vi.fn()

        _lastInstance = this
    }

    // Helper de test : déclenche un événement enregistré via .on()
    _triggerEvent(event, ...args) {
        const handlers = this._handlers[event] ?? []
        handlers.forEach((fn) => fn(...args))
    }
}

// ─── Connexions factices ──────────────────────────────────────────────────────

function createMockDataConnection(metadata = {}) {
    const handlers = {}
    const conn = {
        open: false,
        metadata: { type: 'data', room: 'test', ...metadata },
        peer: `remote-peer-${Math.random().toString(36).slice(2)}`,
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

function createMockMediaConnection(metadata = {}) {
    const handlers = {}
    const conn = {
        open: false,
        metadata: { type: 'visio', room: 'test', ...metadata },
        peer: `remote-peer-${Math.random().toString(36).slice(2)}`,
        peerConnection: {
            connectionState: 'connected',
            signalingState: 'stable',
        },
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
        answer: vi.fn(),
        close: vi.fn(),
        _handlers: handlers,
        _triggerEvent(event, ...args) {
            const list = handlers[event] ?? []
            list.forEach((fn) => fn(...args))
        },
    }
    return conn
}

export { createMockDataConnection, createMockMediaConnection }
export default { Peer }
