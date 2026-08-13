/**
 * useAwaitedStreams.test.js
 *
 * Vignette d'attente : quels pairs ont un flux ANNONCÉ mais pas encore arrivé.
 *
 * Le point qui compte est l'absence de faux positif : la source n'est plus
 * `usersInRoom` (tous les présents, diffuseurs ou non) mais `announcedStreamPeers`,
 * alimenté par l'annonce data channel et par la trace d'un appel entrant. Un membre
 * silencieux ne doit RIEN afficher — c'était le symptôme rapporté (« le spinner
 * s'affiche même si aucun stream n'est actif, puis disparaît »).
 *
 * Le délai d'abandon reste testé, mais comme filet : annonce reçue + flux qui n'arrive
 * jamais.
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
            announcedStreamPeers: ref([]),
        }
    })

    afterEach(() => {
        app?.unmount()
        vi.useRealTimers()
    })

    it('n\'attend personne dans une room vide', () => {
        expect(mount().awaitedPeers.value).toEqual([])
    })

    it('n\'attend PAS un pair présent qui n\'a rien annoncé', () => {
        // Le symptôme rapporté : deux membres dans la room, personne ne diffuse.
        api.usersInRoom.value = ['alice', 'bob']

        const { awaitedPeers, isAwaiting } = mount()

        expect(awaitedPeers.value).toEqual([])
        expect(isAwaiting.value).toBe(false)
    })

    it('attend un pair dont le flux est annoncé', () => {
        api.usersInRoom.value = ['alice', 'bob']
        api.announcedStreamPeers.value = ['alice']

        const { awaitedPeers, isAwaiting } = mount()

        expect(awaitedPeers.value).toEqual(['alice'])
        expect(isAwaiting.value).toBe(true)
    })

    it('cesse d\'attendre un pair dès l\'arrivée de son flux', async () => {
        api.usersInRoom.value = ['alice', 'bob']
        api.announcedStreamPeers.value = ['alice', 'bob']
        const { awaitedPeers } = mount()

        api.remoteStreams.value = [entry('alice')]
        await nextTick()

        expect(awaitedPeers.value).toEqual(['bob'])
    })

    it('reconnaît un partage d\'écran comme un flux reçu', async () => {
        api.usersInRoom.value = ['alice']
        api.announcedStreamPeers.value = ['alice']
        const { awaitedPeers } = mount()

        api.remoteScreens.value = [entry('alice', 'screen')]
        await nextTick()

        expect(awaitedPeers.value).toEqual([])
    })

    it('ignore l\'annonce d\'un pair absent de la room', () => {
        // Annonce résiduelle (purge en cours, ordre non déterministe) : rien à afficher.
        api.usersInRoom.value = ['bob']
        api.announcedStreamPeers.value = ['alice']

        expect(mount().awaitedPeers.value).toEqual([])
    })

    it('abandonne l\'attente après le délai (annonce sans flux ne spinne pas à vie)', async () => {
        api.usersInRoom.value = ['alice']
        api.announcedStreamPeers.value = ['alice']
        const { awaitedPeers, isAwaiting } = mount()
        expect(awaitedPeers.value).toEqual(['alice'])

        await vi.advanceTimersByTimeAsync(TIMEOUT + 100)

        expect(awaitedPeers.value).toEqual([])
        expect(isAwaiting.value).toBe(false)
    })

    it('n\'abandonne pas avant l\'échéance', async () => {
        api.usersInRoom.value = ['alice']
        api.announcedStreamPeers.value = ['alice']
        const { awaitedPeers } = mount()

        await vi.advanceTimersByTimeAsync(TIMEOUT - 500)

        expect(awaitedPeers.value).toEqual(['alice'])
    })

    it('chaque pair a son propre délai', async () => {
        api.usersInRoom.value = ['alice', 'bob']
        api.announcedStreamPeers.value = ['alice']
        const { awaitedPeers } = mount()

        await vi.advanceTimersByTimeAsync(TIMEOUT - 1_000)
        api.announcedStreamPeers.value = ['alice', 'bob']
        await nextTick()
        await vi.advanceTimersByTimeAsync(1_500)

        // alice a expiré, bob attend encore.
        expect(awaitedPeers.value).toEqual(['bob'])
    })

    it('un flux qui arrive juste avant l\'échéance annule l\'abandon', async () => {
        api.usersInRoom.value = ['alice']
        api.announcedStreamPeers.value = ['alice']
        const { awaitedPeers } = mount()

        await vi.advanceTimersByTimeAsync(TIMEOUT - 500)
        api.remoteStreams.value = [entry('alice')]
        await nextTick()
        await vi.advanceTimersByTimeAsync(2_000)

        // Le flux est là : rien à attendre, et surtout pas de réapparition post-délai.
        expect(awaitedPeers.value).toEqual([])
    })

    it('ne ré-attend pas un pair dont le flux s\'arrête', async () => {
        // Arrêt volontaire : l'annonce est purgée avec le départ de la connexion
        // (useCallManager.handleRemoteDeparture), donc plus rien à attendre.
        api.usersInRoom.value = ['alice']
        api.announcedStreamPeers.value = ['alice']
        api.remoteStreams.value = [entry('alice')]
        const { awaitedPeers } = mount()
        expect(awaitedPeers.value).toEqual([])

        api.remoteStreams.value = []
        api.announcedStreamPeers.value = []
        await nextTick()

        expect(awaitedPeers.value).toEqual([])
    })

    it('ne ré-attend pas non plus après l\'arrêt d\'un seul de ses flux', async () => {
        api.usersInRoom.value = ['alice']
        api.announcedStreamPeers.value = ['alice']
        api.remoteStreams.value = [entry('alice')]
        api.remoteScreens.value = [entry('alice', 'screen')]
        const { awaitedPeers } = mount()

        api.remoteStreams.value = []
        await nextTick()

        // L'écran est toujours là : le pair a un flux, on ne l'attend pas.
        expect(awaitedPeers.value).toEqual([])
    })

    it('une nouvelle annonce réarme une attente abandonnée', async () => {
        // Un abandon n'est pas définitif : le pair relance sa diffusion, la vignette
        // doit revenir (l'ancienne mémoire `served` l'en empêchait pour la session).
        api.usersInRoom.value = ['alice']
        api.announcedStreamPeers.value = ['alice']
        const { awaitedPeers } = mount()
        await vi.advanceTimersByTimeAsync(TIMEOUT + 100)
        expect(awaitedPeers.value).toEqual([])

        api.announcedStreamPeers.value = []
        await nextTick()
        api.announcedStreamPeers.value = ['alice']
        await nextTick()

        expect(awaitedPeers.value).toEqual(['alice'])
    })

    it('tolère une api dont les listes sont de simples tableaux', () => {
        api = {
            usersInRoom: ['alice'],
            remoteStreams: [],
            remoteScreens: [],
            announcedStreamPeers: ['alice'],
        }

        expect(mount().awaitedPeers.value).toEqual(['alice'])
    })

    it('tolère une api sans projection d\'annonces (aucune attente)', () => {
        api = { usersInRoom: ['alice'], remoteStreams: [], remoteScreens: [] }

        expect(mount().awaitedPeers.value).toEqual([])
    })
})
