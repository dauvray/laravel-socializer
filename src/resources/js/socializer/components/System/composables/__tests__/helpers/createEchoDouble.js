/**
 * createEchoDouble.js — Doublure de la global `Echo`
 *
 * `Echo` est posée par le projet hôte et n'est jamais importée par le paquet : on la remplace donc
 * par une doublure (`globalThis.Echo = …`) plutôt que par `vi.mock`. Elle n'imite QUE le contrat
 * réellement consommé par `useReverbChannel` — `channel/private/join/encryptedPrivate/leave`,
 * `listen`, `stopListening`, `listenForWhisper`, `error`, `whisper`, et l'API de présence
 * chaînable — et expose des déclencheurs (`emitHere`/`emitJoining`/`emitLeaving`) pour rejouer ce
 * que pusher-js émet.
 *
 * Partagée par `useReverbChannel.test.js` et `components/Feed/__tests__/feedLifecycle.test.js` :
 * deux copies de ces semantiques divergeraient, et ce sont elles qui font la valeur des tests
 * d'ordre de démontage.
 */
import { vi } from 'vitest'

/**
 * Canal non-présence. `whisper` reproduit le comportement qui a cassé une navigation en
 * production : `PusherPrivateChannel.whisper()` déréférence `pusher.channels.channels[name]` sans
 * garde, donc une souscription révoquée fait lever un `TypeError`.
 */
export const createFakePrivateChannel = () => {
    /** event → Set<handler>, comme le `bind`/`unbind` de pusher-js sous Echo. */
    const whisperHandlers = new Map()

    return {
        subscribed: true,
        listen: vi.fn(),
        stopListening: vi.fn(),

        // ⚠️ Ces deux-là ne peuvent PAS être des `vi.fn()` nus : ce qu'on teste au-dessus
        // d'eux, c'est précisément la granularité du désabonnement (un handler, ou tous).
        // Un espion sans registre rendrait vert un `unbind(event)` qui emporte les
        // handlers des autres consommateurs du canal mémoïsé.
        listenForWhisper: vi.fn((event, handler) => {
            if (!whisperHandlers.has(event)) whisperHandlers.set(event, new Set())
            whisperHandlers.get(event).add(handler)
        }),
        /** Sans `handler`, retire tout l'événement — sémantique d'`unbind(name)`. */
        stopListeningForWhisper: vi.fn((event, handler = null) => {
            if (!handler) {
                whisperHandlers.delete(event)
                return
            }
            whisperHandlers.get(event)?.delete(handler)
        }),

        error: vi.fn(),
        whisper: vi.fn(function () {
            if (!this.subscribed) {
                throw new TypeError("Cannot read properties of undefined (reading 'trigger')")
            }
        }),

        /** Rejoue un client event entrant : charge utile, puis métadonnées du serveur. */
        emitWhisper(event, payload, metadata = {}) {
            for (const handler of whisperHandlers.get(event) ?? []) {
                handler(payload, metadata)
            }
        },
    }
}

/** Partie présence de la doublure : chaînable comme Echo, et sans désabonnement possible. */
export const withPresenceApi = (channel) => {
    const callbacks = { here: [], joining: [], leaving: [] }

    return Object.assign(channel, {
        here(cb) { callbacks.here.push(cb); return this },
        joining(cb) { callbacks.joining.push(cb); return this },
        leaving(cb) { callbacks.leaving.push(cb); return this },

        emitHere(users) { callbacks.here.forEach(cb => cb(users)) },
        emitJoining(user) { callbacks.joining.forEach(cb => cb(user)) },
        emitLeaving(user) { callbacks.leaving.forEach(cb => cb(user)) },
    })
}

/**
 * Doublure d'`Echo` fidèle sur les deux points qui comptent : elle **mémoïse** ses canaux par nom
 * préfixé (deux `Echo.private('user.7')` rendent le MÊME objet), et son `leave()` ratisse les trois
 * préfixes d'un nom — l'objet canal survit dans les closures qui le tiennent, mais sa souscription
 * est morte.
 *
 * @returns {{channels: Map<string, object>, Echo: object}} la table des canaux vivants et la doublure
 */
export const createEchoDouble = () => {
    const channels = new Map()

    const memoize = (prefix, decorate = (channel) => channel) => vi.fn((name) => {
        const key = `${prefix}${name}`
        if (!channels.has(key)) {
            channels.set(key, decorate(createFakePrivateChannel()))
        }
        return channels.get(key)
    })

    return {
        channels,
        Echo: {
            channel: memoize(''),
            private: memoize('private-'),
            encryptedPrivate: memoize('private-encrypted-'),
            join: memoize('presence-', withPresenceApi),
            leave: vi.fn((name) => {
                ['', 'private-', 'presence-'].forEach((prefix) => {
                    const channel = channels.get(`${prefix}${name}`)
                    if (channel) {
                        channel.subscribed = false
                        channels.delete(`${prefix}${name}`)
                    }
                })
            }),
        },
    }
}
