/**
 * setup.js — Setup global Vitest pour les tests WebRTC2
 *
 * Ce fichier est exécuté AVANT chaque fichier de test.
 * Il installe les mocks navigateur nécessaires et initialise Pinia.
 */
import { beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// ─────────────────────────────────────────────────────────────────────────────
// Pinia : instance fraîche avant chaque test pour garantir l'isolation
// ─────────────────────────────────────────────────────────────────────────────
beforeEach(() => {
    setActivePinia(createPinia())
})

// ─────────────────────────────────────────────────────────────────────────────
// navigator.mediaDevices.getUserMedia
// happy-dom ne l'implémente pas → on retourne un MediaStream factice
// ─────────────────────────────────────────────────────────────────────────────
const _mockTrack = () => {
    const listeners = {}
    return {
        kind: 'video',
        enabled: true,
        readyState: 'live',
        stop: vi.fn(),
        addEventListener: vi.fn((event, handler) => {
            listeners[event] = handler
        }),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn((event) => {
            const handler = listeners[event?.type]
            if (handler) handler(event)
        }),
    }
}

const _createMockMediaStream = () => {
    const tracks = [_mockTrack()]
    return {
        id: `mock-stream-${Math.random().toString(36).slice(2)}`,
        active: true,
        isLocal: false,
        getTracks: vi.fn(() => tracks),
        getVideoTracks: vi.fn(() => tracks),
        getAudioTracks: vi.fn(() => []),
        addTrack: vi.fn(),
        removeTrack: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    }
}

Object.defineProperty(globalThis, 'navigator', {
    value: {
        ...globalThis.navigator,
        mediaDevices: {
            getUserMedia: vi.fn().mockResolvedValue(_createMockMediaStream()),
            getDisplayMedia: vi.fn().mockResolvedValue(_createMockMediaStream()),
            enumerateDevices: vi.fn().mockResolvedValue([]),
        },
    },
    writable: true,
    configurable: true,
})

// ─────────────────────────────────────────────────────────────────────────────
// crypto.randomUUID — happy-dom peut ne pas l'exposer
// ─────────────────────────────────────────────────────────────────────────────
if (!globalThis.crypto?.randomUUID) {
    let _uuidCounter = 0
    Object.defineProperty(globalThis, 'crypto', {
        value: {
            ...globalThis.crypto,
            randomUUID: vi.fn(
                () => `00000000-0000-4000-8000-${String(_uuidCounter++).padStart(12, '0')}`
            ),
        },
        writable: true,
        configurable: true,
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// RTCPeerConnection — non disponible dans happy-dom
// ─────────────────────────────────────────────────────────────────────────────
if (!globalThis.RTCPeerConnection) {
    globalThis.RTCPeerConnection = vi.fn(() => ({
        connectionState: 'connected',
        signalingState: 'stable',
        close: vi.fn(),
        createOffer: vi.fn().mockResolvedValue({}),
        createAnswer: vi.fn().mockResolvedValue({}),
        setLocalDescription: vi.fn().mockResolvedValue(undefined),
        setRemoteDescription: vi.fn().mockResolvedValue(undefined),
        addTrack: vi.fn(),
        removeTrack: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    }))
}
