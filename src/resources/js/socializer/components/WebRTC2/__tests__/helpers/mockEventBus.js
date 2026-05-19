/**
 * mockEventBus.js — EventBus factice pour les tests
 *
 * Remplace l'eventBus injecté via provide('eventBus') dans createPeerContext.
 * Toutes les méthodes sont des vi.fn() pour permettre les assertions.
 *
 * Usage :
 *   import { mockEventBus } from './mockEventBus.js'
 *   const [result] = withSetup(() => createPeerContext(...), {
 *       provides: { eventBus: mockEventBus() }
 *   })
 */
import { vi } from 'vitest'

export function mockEventBus() {
    const listeners = {}

    return {
        $emit: vi.fn((event, ...args) => {
            const handlers = listeners[event] ?? []
            handlers.forEach((fn) => fn(...args))
        }),
        $on: vi.fn((event, handler) => {
            if (!listeners[event]) listeners[event] = []
            listeners[event].push(handler)
        }),
        $off: vi.fn((event, handler) => {
            if (!listeners[event]) return
            listeners[event] = listeners[event].filter((fn) => fn !== handler)
        }),

        // Helpers pour les assertions dans les tests
        _listeners: listeners,
        _clearAll: () => { Object.keys(listeners).forEach((k) => delete listeners[k]) },
    }
}
