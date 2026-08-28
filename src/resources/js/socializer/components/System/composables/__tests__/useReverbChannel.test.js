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
import { createApp, defineComponent, h, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useReverbChannel } from '~socializer/components/System/composables/useReverbChannel.js'
import { withSetup } from '~socializer/components/WebRTC2/__tests__/helpers/withSetup.js'
import { createEchoDouble } from './helpers/createEchoDouble.js'

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
        apps = []
        ;({ channels, Echo: globalThis.Echo } = createEchoDouble())
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

    /**
     * Même défaut de classe que le `Echo.leave()` ci-dessus, un étage plus bas : Echo
     * mémoïse ses canaux, donc plusieurs consommateurs écoutent le MÊME nom d'événement
     * sur le MÊME objet. Un `unbind(event)` nu les emporte tous.
     *
     * La production en monte le cas : `Exemples/Home.vue` fournit un seul canal de
     * présence à trois `MediaBroadcastProvider`, dont chacun écoute l'annonce de
     * diffusion de WebRTC2. Le premier contexte démonté rendait les deux autres sourds.
     */
    it("ne désabonne que le handler nommé, pas l'événement entier", () => {
        const goneHandler = vi.fn()
        const stayingHandler = vi.fn()

        const [gone] = mountPrivate()
        const [staying] = mountPrivate()
        gone.listenForWhisper('broadcast-state', goneHandler)
        staying.listenForWhisper('broadcast-state', stayingHandler)

        gone.stopListeningForWhisper('broadcast-state', goneHandler)
        channels.get(`private-${CHANNEL}`).emitWhisper('broadcast-state', { hello: true }, { user_id: 7 })

        expect(goneHandler).not.toHaveBeenCalled()
        expect(stayingHandler).toHaveBeenCalledWith({ hello: true }, { user_id: 7 })
    })

    it("retire tout l'événement quand aucun handler n'est nommé", () => {
        // Repli historique, et le seul usage en place : `useChatSimple` appelle
        // `stopListeningForWhisper('typing')` nu, en étant seul consommateur.
        const handler = vi.fn()

        const [api] = mountPrivate()
        api.listenForWhisper('typing', handler)

        api.stopListeningForWhisper('typing')
        channels.get(`private-${CHANNEL}`).emitWhisper('typing', {})

        expect(handler).not.toHaveBeenCalled()
    })

    it('repose le handler après une reconnexion, et le désabonnement ciblé le suit', async () => {
        // ⚠️ Un rebind fabrique un NOUVEAU wrapper (nouveau jeton de vie) : si l'entrée ne
        // le note pas, un désabonnement ciblé après reconnexion défait un handler mort et
        // laisse le vivant branché.
        const handler = vi.fn()
        const name = ref('user.7')

        const [api, app] = withSetup(() => useReverbChannel(name, { type: 'private' }))
        apps.push(app)
        api.listenForWhisper('typing', handler)

        name.value = 'user.8'
        await nextTick()

        api.stopListeningForWhisper('typing', handler)
        channels.get('private-user.8').emitWhisper('typing', {})

        expect(handler).not.toHaveBeenCalled()
    })
})

/**
 * Quatre composants préviennent de leur départ par un whisper posé dans un hook de démontage :
 * `leave-server` (Server.vue), `leave-room` (Room.vue), `leave-chat` (ChatComponent.vue) et
 * `leave-feed` (Feed.vue). Côté serveur, `UserOnlineWhisperListener` en fait un
 * `removeUserItem(...)` : un whisper perdu laisse une présence fantôme que rien n'efface.
 *
 * Or ce whisper ne part que si son hook a été enregistré AVANT l'appel au composable. Vue exécute
 * les hooks `beforeUnmount` dans leur ordre d'ENREGISTREMENT, et `useReverbChannel` enregistre le
 * sien (`leave`) au moment de l'appel. Enregistré après, le hook trouve `subscriptionToken` déjà
 * révoqué et `whisper()` rend `false` — sans lever, donc sans rien signaler.
 *
 * C'est un ordre de LIGNES, qu'aucun type ni aucun lint ne protège : d'où ces tests.
 */
describe("useReverbChannel — ordre du whisper de départ et du leave()", () => {
    const CHANNEL = 'user.7'
    const PAYLOAD = { chatId: 42, userId: 7 }

    let channels
    let apps
    let trace

    /** `true` → whisper parti. Tracé pour pouvoir l'ordonner avec le `Echo.leave()`. */
    const traceWhisper = (label, sent) => trace.push(`${label}:${sent ? 'parti' : 'perdu'}`)

    /** La disposition de ChatComponent.vue / Server.vue / Room.vue : le hook AVANT le composable. */
    const mountHookFirst = () => {
        const [, app] = withSetup(() => {
            // `whisperMe` est déclaré plus bas : la closure ne le lit qu'au démontage. C'est la
            // disposition exacte du code de production, et elle est volontaire.
            onBeforeUnmount(() => traceWhisper('hook', whisperMe('leave-chat', PAYLOAD)))

            const { whisper: whisperMe } = useReverbChannel(CHANNEL, { type: 'private' })
        })
        apps.push(app)
        return app
    }

    /** Le piège symétrique : le composable AVANT le hook. */
    const mountComposableFirst = () => {
        const [, app] = withSetup(() => {
            const { whisper: whisperMe } = useReverbChannel(CHANNEL, { type: 'private' })

            onBeforeUnmount(() => traceWhisper('hook', whisperMe('leave-chat', PAYLOAD)))
        })
        apps.push(app)
        return app
    }

    /**
     * La disposition d'un composant mixte : un `setup()` qui porte le câblage Reverb, et un
     * `beforeUnmount()` d'Options API dans le même composant. `applyOptions()` tourne APRÈS
     * `setup()`, donc le hook des options passe en second — trop tard pour whisperer. C'est ce qui
     * interdit de câbler Reverb dans les options d'un composant qui n'est pas encore migré.
     */
    const mountOptionsApiLeaver = () => {
        const app = createApp(defineComponent({
            setup() {
                onBeforeUnmount(() => traceWhisper('setup', whisperMe('leave-feed', PAYLOAD)))

                const { whisper: whisperMe } = useReverbChannel(CHANNEL, { type: 'private' })

                return { whisperMe }
            },
            beforeUnmount() {
                traceWhisper('options', this.whisperMe('leave-feed', PAYLOAD))
            },
            render: () => h('div'),
        }))

        app.mount(document.createElement('div'))
        apps.push(app)
        return app
    }

    const unmountNow = (app) => {
        app.unmount()
        apps = apps.filter(other => other !== app)
    }

    beforeEach(() => {
        apps = []
        trace = []

        const double = createEchoDouble()
        channels = double.channels

        // Instrumenté pour ordonner `Echo.leave()` avec les whispers dans une seule trace.
        const leave = double.Echo.leave
        globalThis.Echo = {
            ...double.Echo,
            leave: vi.fn((name) => {
                trace.push('echo.leave')
                leave(name)
            }),
        }
    })

    afterEach(() => {
        apps.forEach(app => app.unmount())
        delete globalThis.Echo
    })

    it('part avant la libération du canal, même en dernier consommateur', () => {
        const app = mountHookFirst()
        const { whisper } = channels.get(`private-${CHANNEL}`)

        unmountNow(app)

        expect(trace).toEqual(['hook:parti', 'echo.leave'])
        expect(whisper).toHaveBeenCalledWith('leave-chat', PAYLOAD)
    })

    /** LE test de l'invariant : inverser les deux lignes suffit à perdre le whisper. */
    it('serait perdu si le composable était appelé avant le hook', () => {
        const app = mountComposableFirst()
        const { whisper } = channels.get(`private-${CHANNEL}`)

        unmountNow(app)

        expect(trace).toEqual(['echo.leave', 'hook:perdu'])
        expect(whisper).not.toHaveBeenCalled()
    })

    it("part depuis setup(), jamais depuis le beforeUnmount() d'un composant Options API", () => {
        unmountNow(mountOptionsApiLeaver())

        expect(trace).toEqual(['setup:parti', 'echo.leave', 'options:perdu'])
    })
})

/**
 * Même invariant que le describe précédent, sur un autre mécanisme : non plus des hooks de
 * démontage, mais des **watchers**. Le cas vivant est `System/Notifications.vue`, qui whispere son
 * battement de présence (`ping`) depuis un `watch(me)`.
 *
 * `me` y est null au montage — `loadMe()` est asynchrone — donc la transition null → valeur a
 * toujours lieu, et le `watch` du composant comme celui du composable y réagissent dans le MÊME
 * flush, ordonnés par leur ordre de création. Le composable doit avoir joint avant que le whisper
 * ne parte, sans quoi `whisper()` rend `false` : l'utilisateur reste hors ligne jusqu'au battement
 * suivant, soit deux minutes — exactement le TTL Redis de la présence.
 */
describe('useReverbChannel — whisper émis depuis un watcher externe', () => {
    const CHANNEL = 'user.7'
    const PING = { timestamp: 0, userId: 7 }

    let apps
    let trace

    /** Le nom part à `null`, comme `userChannel` tant que le store `me` n'est pas chargé. */
    const mountPinger = ({ composableFirst }) => {
        const channelName = ref(null)

        const [, app] = withSetup(() => {
            let whisperPing

            // Le watcher du composant. `whisperPing` n'est lu qu'au flush, jamais à la création :
            // les deux branches ci-dessous ne diffèrent QUE par l'ordre des deux appels.
            const startWatching = () => watch(channelName, (value) => {
                if (value) trace.push(whisperPing('ping', PING) ? 'ping:parti' : 'ping:perdu')
            })

            const join = () => {
                ;({ whisper: whisperPing } = useReverbChannel(channelName, { type: 'private' }))
            }

            if (composableFirst) {
                join()
                startWatching()
            } else {
                startWatching()
                join()
            }
        })

        apps.push(app)
        return channelName
    }

    beforeEach(() => {
        apps = []
        trace = []

        const double = createEchoDouble()

        // `private` est instrumenté pour situer le join vis-à-vis du whisper dans une seule trace.
        globalThis.Echo = {
            ...double.Echo,
            private: vi.fn((name) => {
                trace.push('join')
                return double.Echo.private(name)
            }),
        }
    })

    afterEach(() => {
        apps.forEach(app => app.unmount())
        delete globalThis.Echo
    })

    it('part quand le watcher est créé après le composable', async () => {
        const channelName = mountPinger({ composableFirst: true })

        channelName.value = CHANNEL
        await nextTick()

        expect(trace).toEqual(['join', 'ping:parti'])
    })

    /** LE test de l'invariant : remonter le watcher au-dessus de l'appel suffit à perdre le ping. */
    it('serait perdu si le watcher était créé avant le composable', async () => {
        const channelName = mountPinger({ composableFirst: false })

        channelName.value = CHANNEL
        await nextTick()

        expect(trace).toEqual(['ping:perdu', 'join'])
    })
})
