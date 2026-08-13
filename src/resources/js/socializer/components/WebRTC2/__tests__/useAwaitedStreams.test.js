/**
 * useAwaitedStreams.test.js
 *
 * Vignette d'attente : quels pairs de la room n'ont pas encore de flux.
 *
 * Le point délicat est le caractère **borné** de l'attente. Un récepteur ne peut pas
 * savoir localement qu'un pair diffuse (cf. l'en-tête du composable), donc sans délai
 * d'abandon un membre qui ne diffuse pas laisserait un spinner tourner indéfiniment.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import { withSetup } from './helpers/withSetup.js'
import { useAwaitedStreams } from '~socializer/components/WebRTC2/Widgets/Mediaplayer/Composables/useAwaitedStreams.js'

const TIMEOUT = 5_000

describe('useAwaitedStreams', () => {
    let api
    let app

    const mount = (options = { timeoutMs: TIMEOUT }) => {
        const [result, mounted] = withSetup(() => useAwaitedStreams(api, options))
        app = mounted
        return result
    }

    /** Entrée de remoteStreamsMap telle que la produit useStreamManager. */
    const entry = (remoteSlug, remoteType = 'stream') => ({ remoteSlug, remoteType, stream: {} })

    beforeEach(() => {
        vi.useFakeTimers()
        api = {
            usersInRoom: ref([]),
            remoteStreams: ref([]),
            remoteScreens: ref([]),
        }
    })

    afterEach(() => {
        app?.unmount()
        vi.useRealTimers()
    })

    it('n\'attend personne dans une room vide', () => {
        expect(mount().awaitedPeers.value).toEqual([])
    })

    it('attend un pair présent sans flux', () => {
        api.usersInRoom.value = ['alice', 'bob']

        const { awaitedPeers, isAwaiting } = mount()

        expect(awaitedPeers.value).toEqual(['alice', 'bob'])
        expect(isAwaiting.value).toBe(true)
    })

    it('cesse d\'attendre un pair dès l\'arrivée de son flux', async () => {
        api.usersInRoom.value = ['alice', 'bob']
        const { awaitedPeers } = mount()

        api.remoteStreams.value = [entry('alice')]
        await nextTick()

        expect(awaitedPeers.value).toEqual(['bob'])
    })

    it('reconnaît un partage d\'écran comme un flux reçu', async () => {
        api.usersInRoom.value = ['alice']
        const { awaitedPeers } = mount()

        api.remoteScreens.value = [entry('alice', 'screen')]
        await nextTick()

        expect(awaitedPeers.value).toEqual([])
    })

    it('abandonne l\'attente après le délai (un non-diffuseur ne spinne pas à vie)', async () => {
        api.usersInRoom.value = ['alice']
        const { awaitedPeers, isAwaiting } = mount()
        expect(awaitedPeers.value).toEqual(['alice'])

        await vi.advanceTimersByTimeAsync(TIMEOUT + 100)

        expect(awaitedPeers.value).toEqual([])
        expect(isAwaiting.value).toBe(false)
    })

    it('n\'abandonne pas avant l\'échéance', async () => {
        api.usersInRoom.value = ['alice']
        const { awaitedPeers } = mount()

        await vi.advanceTimersByTimeAsync(TIMEOUT - 500)

        expect(awaitedPeers.value).toEqual(['alice'])
    })

    it('chaque pair a son propre délai', async () => {
        api.usersInRoom.value = ['alice']
        const { awaitedPeers } = mount()

        await vi.advanceTimersByTimeAsync(TIMEOUT - 1_000)
        api.usersInRoom.value = ['alice', 'bob']
        await nextTick()
        await vi.advanceTimersByTimeAsync(1_500)

        // alice a expiré, bob attend encore.
        expect(awaitedPeers.value).toEqual(['bob'])
    })

    it('un flux qui arrive juste avant l\'échéance annule l\'abandon', async () => {
        api.usersInRoom.value = ['alice']
        const { awaitedPeers } = mount()

        await vi.advanceTimersByTimeAsync(TIMEOUT - 500)
        api.remoteStreams.value = [entry('alice')]
        await nextTick()
        await vi.advanceTimersByTimeAsync(2_000)

        // Le flux est là : rien à attendre, et surtout pas de réapparition post-délai.
        expect(awaitedPeers.value).toEqual([])
    })

    it('ne ré-attend pas un pair dont le flux s\'arrête', async () => {
        // Symptôme rapporté : A arrête sa diffusion → sa vignette disparaît et un spinner
        // la remplace pendant 20 s, comme si le flux allait revenir. Un arrêt volontaire
        // ne doit rien afficher.
        api.usersInRoom.value = ['alice']
        api.remoteStreams.value = [entry('alice')]
        const { awaitedPeers } = mount()
        expect(awaitedPeers.value).toEqual([])

        api.remoteStreams.value = []
        await nextTick()

        expect(awaitedPeers.value).toEqual([])
    })

    it('ne ré-attend pas non plus après l\'arrêt d\'un seul de ses flux', async () => {
        api.usersInRoom.value = ['alice']
        api.remoteStreams.value = [entry('alice')]
        api.remoteScreens.value = [entry('alice', 'screen')]
        const { awaitedPeers } = mount()

        api.remoteStreams.value = []
        await nextTick()

        expect(awaitedPeers.value).toEqual([])
    })

    it('un pair qui quitte puis revient est attendu de nouveau', async () => {
        api.usersInRoom.value = ['alice']
        const { awaitedPeers } = mount()
        await vi.advanceTimersByTimeAsync(TIMEOUT + 100)
        expect(awaitedPeers.value).toEqual([])

        api.usersInRoom.value = []
        await nextTick()
        api.usersInRoom.value = ['alice']
        await nextTick()

        expect(awaitedPeers.value).toEqual(['alice'])
    })

    it('tolère une api dont les listes sont de simples tableaux', () => {
        api = { usersInRoom: ['alice'], remoteStreams: [], remoteScreens: [] }

        expect(mount().awaitedPeers.value).toEqual(['alice'])
    })
})
