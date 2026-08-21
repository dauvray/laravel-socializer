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
