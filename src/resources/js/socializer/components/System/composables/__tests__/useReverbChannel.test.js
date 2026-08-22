/**
 * useReverbChannel.test.js
 *
 * Périmètre : la liste `users` d'un canal de PRÉSENCE. C'est elle qui alimente les
 * compteurs de membres connectés (`ServerParamsButton`, `RoomUsersList`, le chat), et
 * elle avait un doublon possible.
 *
 * Choix d'infrastructure : `Echo` est une global posée par le projet hôte, jamais
 * importée par le paquet — on la remplace donc par une doublure plutôt que par
 * `vi.mock`. La doublure n'imite QUE le contrat réellement consommé par le composable
 * (`here/joining/leaving` chaînables, `listen`, `listenForWhisper`, `error`) et expose
 * des déclencheurs pour rejouer ce que pusher-js émet.
 *
 * `withSetup` est obligatoire : le composable enregistre `onBeforeUnmount` et un
 * `watch` immédiat, donc il exige une vraie instance de composant.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useReverbChannel } from '~socializer/components/System/composables/useReverbChannel.js'
import { withSetup } from '~socializer/components/WebRTC2/__tests__/helpers/withSetup.js'

const ALICE = { id: 1, name: 'Alice' }
const BOB = { id: 2, name: 'Bob' }

/**
 * Doublure du canal de présence Echo. `here/joining/leaving` sont chaînables comme
 * chez Echo, et les `emit*` rejouent les événements pusher-js correspondants.
 */
const createFakePresenceChannel = () => {
    const callbacks = { here: [], joining: [], leaving: [] }

    return {
        here(cb) { callbacks.here.push(cb); return this },
        joining(cb) { callbacks.joining.push(cb); return this },
        leaving(cb) { callbacks.leaving.push(cb); return this },
        error: vi.fn(),
        listen: vi.fn(),
        listenForWhisper: vi.fn(),
        whisper: vi.fn(),

        emitHere(users) { callbacks.here.forEach(cb => cb(users)) },
        emitJoining(user) { callbacks.joining.forEach(cb => cb(user)) },
        emitLeaving(user) { callbacks.leaving.forEach(cb => cb(user)) },
    }
}

describe('useReverbChannel — liste de présence', () => {
    let channel
    let apps

    const mountPresence = (options = {}) => {
        const [api, app] = withSetup(() => useReverbChannel('server.42', {
            type: 'presence',
            ...options,
        }))
        apps.push(app)
        return api
    }

    beforeEach(() => {
        channel = createFakePresenceChannel()
        apps = []

        globalThis.Echo = {
            join: vi.fn(() => channel),
            channel: vi.fn(() => channel),
            private: vi.fn(() => channel),
            encryptedPrivate: vi.fn(() => channel),
            leave: vi.fn(),
        }
    })

    afterEach(() => {
        apps.forEach(app => app.unmount())
        delete globalThis.Echo
    })

    it('remplit `users` avec la liste initiale de `here`', () => {
        const { users, isConnected } = mountPresence()

        channel.emitHere([ALICE])

        expect(users.value).toEqual([ALICE])
        expect(isConnected.value).toBe(true)
    })

    it('ajoute un membre distinct qui rejoint', () => {
        const { users } = mountPresence()

        channel.emitHere([ALICE])
        channel.emitJoining(BOB)

        expect(users.value).toEqual([ALICE, BOB])
    })

    /**
     * LE test du correctif. pusher-js émet `pusher:member_added` sans dédoublonner :
     * son `addMember()` protège son propre hash, pas l'`emit`. Sans garde, la même
     * personne était comptée deux fois — c'est le « 2 alors que je suis seul ».
     */
    it("ne compte pas deux fois un membre déjà présent dans `here`", () => {
        const { users } = mountPresence()

        channel.emitHere([ALICE])
        channel.emitJoining(ALICE)

        expect(users.value).toEqual([ALICE])
    })

    it("ne compte pas deux fois un `member_added` répété", () => {
        const { users } = mountPresence()

        channel.emitHere([])
        channel.emitJoining(BOB)
        channel.emitJoining(BOB)

        expect(users.value).toEqual([BOB])
    })

    /**
     * Décision assumée : on dédoublonne la LISTE, pas le SIGNAL. Le chemin présence de
     * WebRTC2 se sert de `onJoining` pour l'admission des pairs — l'étouffer
     * corrigerait un compteur en cassant une poignée de main.
     */
    it('appelle `onJoining` à chaque annonce, doublon compris', () => {
        const onJoining = vi.fn()
        mountPresence({ onJoining })

        channel.emitHere([ALICE])
        channel.emitJoining(ALICE)
        channel.emitJoining(ALICE)

        expect(onJoining).toHaveBeenCalledTimes(2)
    })

    it('retire le membre qui part', () => {
        const { users } = mountPresence()

        channel.emitHere([ALICE, BOB])
        channel.emitLeaving(ALICE)

        expect(users.value).toEqual([BOB])
    })
})

/**
 * Second périmètre : un canal PARTAGÉ par plusieurs composants, et le contrat « `whisper` ne lève
 * jamais ». Les deux viennent du même incident : naviguer d'une room vers le feed affichait la
 * nouvelle URL sur l'ancien écran. `Notifications.vue`, `Server.vue` et `Room.vue` souscrivent tous
 * au même canal privé `me.channel` ; en se démontant, `Server.vue` (parent) appelait `Echo.leave()`
 * — qui coupe la souscription pour TOUT LE MONDE —, puis `Room.vue` (enfant, démonté juste après)
 * whisperait `leave-room` dessus. `TypeError` dans un hook de démontage, que Vue relance au milieu
 * du flush : le patch avorte et l'écran reste sur la route précédente.
 *
 * La doublure imite donc le point exact où ça casse : Echo mémoïse ses canaux par nom préfixé,
 * `Echo.leave()` retire l'objet de la table, et l'objet resté dans la closure d'un composant lève
 * sur `whisper()` — comme `PusherPrivateChannel.whisper()`, qui déréférence
 * `pusher.channels.channels[name]` sans garde.
 */
describe('useReverbChannel — canal partagé entre composants', () => {
    const CHANNEL = 'user.7'

    let channels
    let apps

    const createFakePrivateChannel = () => ({
        subscribed: true,
        listen: vi.fn(),
        stopListening: vi.fn(),
        listenForWhisper: vi.fn(),
        stopListeningForWhisper: vi.fn(),
        error: vi.fn(),
        whisper: vi.fn(function () {
            if (!this.subscribed) {
                throw new TypeError("Cannot read properties of undefined (reading 'trigger')")
            }
        }),
    })

    /** Partie présence de la doublure : chaînable comme Echo, et sans désabonnement possible. */
    const withPresenceApi = (channel) => {
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

    const mount = (type, options = {}) => {
        const [api, app] = withSetup(() => useReverbChannel(CHANNEL, { type, ...options }))
        apps.push(app)
        return [api, app]
    }

    const mountPrivate = (options = {}) => mount('private', options)

    /** Démonte tout de suite, sans laisser l'`afterEach` démonter une seconde fois. */
    const unmountNow = (app) => {
        app.unmount()
        apps = apps.filter(other => other !== app)
    }

    beforeEach(() => {
        channels = new Map()
        apps = []

        const memoize = (prefix, decorate = (channel) => channel) => vi.fn((name) => {
            const key = `${prefix}${name}`
            if (!channels.has(key)) {
                channels.set(key, decorate(createFakePrivateChannel()))
            }
            return channels.get(key)
        })

        globalThis.Echo = {
            channel: memoize(''),
            private: memoize('private-'),
            encryptedPrivate: memoize('private-encrypted-'),
            join: memoize('presence-', withPresenceApi),
            // Echo.leave() ratisse les trois préfixes d'un nom, et la souscription pusher meurt
            // avec : l'objet canal survit dans les closures, mais son `trigger` a disparu.
            leave: vi.fn((name) => {
                ['', 'private-', 'presence-'].forEach((prefix) => {
                    const channel = channels.get(`${prefix}${name}`)
                    if (channel) {
                        channel.subscribed = false
                        channels.delete(`${prefix}${name}`)
                    }
                })
            }),
        }
    })

    afterEach(() => {
        apps.forEach(app => app.unmount())
        delete globalThis.Echo
    })

    it("ne coupe pas la souscription tant qu'un autre composant la tient", () => {
        const [, parent] = mountPrivate()
        mountPrivate()

        unmountNow(parent)

        expect(Echo.leave).not.toHaveBeenCalled()
    })

    it('libère le canal quand le dernier consommateur part', () => {
        const [, parent] = mountPrivate()
        const [, child] = mountPrivate()

        unmountNow(parent)
        unmountNow(child)

        expect(Echo.leave).toHaveBeenCalledTimes(1)
        expect(Echo.leave).toHaveBeenCalledWith(CHANNEL)
    })

    /** LE test du correctif : le `leave-room` de l'enfant doit encore partir. */
    it("laisse l'enfant whisperer après le démontage du parent", () => {
        const [, parent] = mountPrivate()
        const [child] = mountPrivate()

        unmountNow(parent)

        expect(child.whisper('leave-room', { roomId: 3 })).toBe(true)
        expect(channels.get(`private-${CHANNEL}`).whisper)
            .toHaveBeenCalledWith('leave-room', { roomId: 3 })
    })

    /**
     * Ceinture et bretelles : souscription morte pour une raison hors du composable — canal coupé
     * par un `Echo.leave()` écrit à la main, connexion tombée — un whisper ne doit toujours pas
     * faire remonter d'exception dans le flush de Vue.
     */
    it("avale l'exception d'un whisper sur une souscription morte", () => {
        const [api] = mountPrivate()
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        channels.get(`private-${CHANNEL}`).subscribed = false

        expect(() => api.whisper('leave-room', {})).not.toThrow()
        expect(api.whisper('leave-room', {})).toBe(false)
        expect(warn).toHaveBeenCalled()

        warn.mockRestore()
    })

    it('ne whispere plus rien après son propre démontage', () => {
        const [api, app] = mountPrivate()

        unmountNow(app)

        expect(api.whisper('leave-room', {})).toBe(false)
    })

    /**
     * Le canal survit au premier démontage : les handlers du partant restent branchés dessus. Ceux
     * qu'Echo sait défaire sont retirés, les autres (`here`/`joining`/`leaving`) sont neutralisés
     * par le jeton de souscription — sans quoi un composant démonté continuerait de réagir.
     */
    it('rend inertes les handlers du consommateur parti', () => {
        const goneJoining = vi.fn()
        const stayingJoining = vi.fn()

        const [, gone] = mount('presence', { onJoining: goneJoining })
        mount('presence', { onJoining: stayingJoining })

        unmountNow(gone)
        channels.get(`presence-${CHANNEL}`).emitJoining(ALICE)

        expect(goneJoining).not.toHaveBeenCalled()
        expect(stayingJoining).toHaveBeenCalledWith(ALICE)
    })

    it("retire du canal les listeners qu'Echo sait défaire", () => {
        const handler = vi.fn()

        const [, gone] = mountPrivate({ listeners: { '.MessageSent': handler } })
        mountPrivate()

        unmountNow(gone)

        expect(channels.get(`private-${CHANNEL}`).stopListening)
            .toHaveBeenCalledWith('.MessageSent', expect.any(Function))
    })
})
