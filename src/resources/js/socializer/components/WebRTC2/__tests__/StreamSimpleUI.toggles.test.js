/**
 * StreamSimpleUI.toggles.test.js — le JOINT de la boucle des toggles
 *
 * Un pair coupe son micro. L'annonce part (`GroupLocalStreamBtn.test.js`), traverse le
 * datachannel (`usePeerTransport.*`), et arrive ici, dans le seul consommateur de production de
 * `RemoteMediaPlayer`. Ce qui fait tenir toute la chaîne est **une seule valeur employée deux
 * fois** :
 *
 *   écriture — `handleStreamData(data, conn)` → `dispatchSignal({ roomId: conn.peer, payload })`
 *   lecture  — `metadata.peerId` (posé par `useStreamManager` à partir de ce même `conn.peer`)
 *              → `useRemotePeerState(peerId)` → l'icône, ou la bascule de branche.
 *
 * Trois fichiers, deux directions, et **aucune assertion nulle part** avant celui-ci. Les deux
 * bouts peuvent diverger sans qu'aucun test d'étage ne bouge : c'est exactement le profil du
 * dernier 🔴 du module, resté vivant des semaines avec la suite au vert.
 *
 * ── Ce que ce fichier NE teste PAS, et pourquoi ───────────────────────────────
 *
 * Il n'appelle jamais `api.sendData` et ne clique aucun bouton (l'émission est couverte), et il
 * n'ouvre aucune connexion PeerJS : il entre par le callback `onDataReceived` **capturé au
 * montage**, exactement là où l'orchestrateur le rend à l'app. Le rendu de branche en lui-même
 * est déjà couvert par `MediaBroadcastPlayer.spinner.test.js`, et l'abonnement d'un player à
 * son pair par `RemoteMediaPlayer.test.js`. Ce qui reste — et qui n'est qu'ici — est le joint.
 *
 * ⚠️ `Exemples/` est de la **PRODUCTION** : l'hôte importe ce composant
 * (`resources/js/estarter_custom_elements/views/Home.vue:6`). Le nom du dossier ment.
 *
 * ── CONTRÔLES DE HARNAIS (convention du paquet), mesurés le 2026-08-31 ────────
 *
 *    1. `roomId: conn?.peer` → `conn?.metadata?.from` (bout ÉCRITURE) .......... 3 cas
 *    2. `peerId: rs.peerId || rs.metadata?.peerId || null` → `null` (LECTURE) .. 2 cas
 *    3. `dispatchSignal` retiré de `handleStreamData` ......................... 3 cas
 *    4. `createSignalQueueRoom` transformé en vidage de file .................. 1 cas
 *    5. `{ immediate: true }` retiré de `useRemotePeerState` .................. 1 cas
 *
 * ⭐ **Le contrôle qui compte est le CINQUIÈME, et son résultat attendu est 0** : les mutations
 * 1 et 2 rejouées sur `useRemotePeerState.test.js` et `RemoteMediaPlayer.test.js` rougissent
 * **0 cas**, mesuré trois fois chacune. C'est ce qui prouve que ce fichier n'est le doublon
 * d'aucun autre : casser le joint ne se voit QU'ICI. Les deux étages en dessous restent verts
 * pendant que la boucle est morte — c'est précisément le mode de panne que ce fichier ferme.
 */
import { describe, it, expect, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { usePeer2Store } from '~socializer/stores/peers2.js'
import StreamSimpleUI from '~socializer/components/WebRTC2/Exemples/StreamSimple/StreamSimpleUI.vue'
import { createMediaApiDouble } from './helpers/createMediaApiDouble.js'

/**
 * La forme brute que `remoteStreamsMap` conserve, et que `remoteStreamsData` projette.
 * `peerId` y vient de `conn?.peer` (`useStreamManager.js:156`) — c'est le bout LECTURE du joint.
 */
const fluxDistant = (peerId, fromName) => ({
    stream: { id: `flux-de-${fromName}` },
    peerId,
    remoteType: 'stream',
    metadata: { fromName, room: 'room-1' },
})

const creerApi = ({ flux = [], ecrans = [] } = {}) => ({
    ...createMediaApiDouble(),

    initialize: vi.fn(),
    myName: ref('moi'),
    currentType: ref('stream'),
    currentStream: ref(null),
    screenStream: ref(null),

    remotePeers: ref([]),
    remoteStreams: ref(flux),
    remoteScreens: ref(ecrans),
    announcedStreamPeers: ref([]),
})

let api

const monter = (etat) => {
    api = creerApi(etat)

    return mount(StreamSimpleUI, {
        props: { api },
        global: {
            stubs: {
                // `IconWidget` n'est PAS stubé : c'est lui qui rend `.la-microphone-slash`, la
                // seule trace visible d'un `AUDIO_MUTE_TOGGLE` reçu.
                VideoPlayer: { props: ['srcObject', 'muted'], template: '<video class="video-stub" />' },
                AudioPlayer: { props: ['srcObject', 'muted'], template: '<audio class="audio-stub" />' },
                Spinner1: { template: '<span class="spinner-stub" />' },
            },
        },
    })
}

/** Le callback que l'app confie à l'orchestrateur au montage — le point d'entrée réel. */
const recevoirDonnee = (data, conn) =>
    api.initialize.mock.calls.at(-1)[0].onDataReceived(data, conn)

const recevoirFlux = (stream, conn) =>
    api.initialize.mock.calls.at(-1)[0].onStreamReceived(stream, conn, {})

/** Les vignettes de flux distants, dans l'ordre du `v-for`, hors vignettes d'attente. */
const vignettes = (w) => w.findAll('.draggable-video').filter((v) => !v.classes().includes('video-awaited'))

const microCoupeSur = (vignette) => vignette.find('.la-microphone-slash').exists()

describe('StreamSimpleUI — la donnée reçue atteint la bonne vignette', () => {

    it('⭐⭐ la donnée reçue sur la connexion d\'Alice ne met en sourdine QUE la vignette d\'Alice', async () => {
        // Le cas du lot. Il tombe si l'un OU l'autre bout du joint bouge : la clé d'écriture
        // (`conn.peer`) comme la clé de lecture (`metadata.peerId`). Deux flux sont nécessaires —
        // avec un seul, « la bonne vignette » et « toutes les vignettes » donnent le même vert.
        const w = monter({
            flux: [fluxDistant('peer-alice', 'Alice'), fluxDistant('peer-bob', 'Bob')],
        })
        const [alice, bob] = vignettes(w)
        expect(microCoupeSur(alice)).toBe(false)

        recevoirDonnee(
            { roomId: 'room-1', type: 'AUDIO_MUTE_TOGGLE', isMuted: true },
            { peer: 'peer-alice' },
        )
        await nextTick()

        expect(microCoupeSur(vignettes(w)[0])).toBe(true)
        expect(microCoupeSur(vignettes(w)[1])).toBe(false)
        expect(bob.exists()).toBe(true)
    })

    it('⭐ couper sa caméra bascule la vignette d\'Alice sur l\'audio, Bob reste en vidéo', async () => {
        const w = monter({
            flux: [fluxDistant('peer-alice', 'Alice'), fluxDistant('peer-bob', 'Bob')],
        })

        recevoirDonnee(
            { roomId: 'room-1', type: 'VIDEO_ACTIVE_TOGGLE', isActive: false },
            { peer: 'peer-alice' },
        )
        await nextTick()

        expect(vignettes(w)[0].find('.audio-stub').exists()).toBe(true)
        expect(vignettes(w)[0].find('.video-stub').exists()).toBe(false)
        expect(vignettes(w)[1].find('.video-stub').exists()).toBe(true)
    })

    it('⭐ une annonce arrivée AVANT le flux est reprise à l\'apparition de la vignette', async () => {
        // La séquence de production, dans cet ordre : le datachannel s'ouvre AVANT que le flux
        // média n'arrive, et le montage de la vignette EST l'arrivée du flux (aucun `v-if` sur
        // les deux `v-for`). Une annonce reçue dans cette fenêtre était en file au montage et
        // n'était jamais lue — le pair apparaissait micro ouvert alors qu'il l'avait coupé.
        // Fermé par `immediate: true` ; ce cas a été vu ROUGE avant le correctif.
        const w = monter({ flux: [] })

        recevoirDonnee(
            { roomId: 'room-1', type: 'AUDIO_MUTE_TOGGLE', isMuted: true },
            { peer: 'peer-alice' },
        )
        await nextTick()

        api.remoteStreams.value = [fluxDistant('peer-alice', 'Alice')]
        await nextTick()

        expect(vignettes(w)).toHaveLength(1)
        expect(microCoupeSur(vignettes(w)[0])).toBe(true)
    })

    it('⭐ une vignette de partage d\'écran n\'a pas de `peerId` : aucune annonce ne l\'atteint', async () => {
        // `remoteScreensData` ne pose aucun `peerId` dans sa metadata, et c'est voulu : un pair
        // qui coupe sa webcam ne doit pas faire disparaître son partage d'écran. Les deux formes
        // d'annonce sont essayées — celle qui nomme le pair, et celle sans connexion, qui
        // atterrirait sur la clé "undefined" si le composable ne s'en gardait pas.
        const w = monter({
            ecrans: [{ stream: { id: 'ecran-alice' }, remoteSlug: 'alice', metadata: { room: 'room-1' } }],
        })

        recevoirDonnee({ type: 'VIDEO_ACTIVE_TOGGLE', isActive: false }, { peer: 'peer-alice' })
        recevoirDonnee({ type: 'VIDEO_ACTIVE_TOGGLE', isActive: false }, undefined)
        await nextTick()

        expect(vignettes(w)).toHaveLength(1)
        expect(vignettes(w)[0].find('.video-stub').exists()).toBe(true)
    })

    it('l\'arrivée du flux crée la file du pair SANS écraser ce qu\'elle contient', async () => {
        // `handleStreamReceived` appelle `createSignalQueueRoom(conn.peer)` — un no-op si la file
        // existe déjà. C'est la précondition de tout rattrapage d'une annonce arrivée en avance :
        // si cet appel vidait la file, l'annonce serait détruite à l'instant même du montage.
        const peerStore = usePeer2Store()
        monter({ flux: [] })

        recevoirDonnee({ type: 'AUDIO_MUTE_TOGGLE', isMuted: true }, { peer: 'peer-alice' })
        recevoirFlux({ id: 'flux' }, { peer: 'peer-alice' })

        expect(peerStore.getLastRoomSignal('peer-alice')).toMatchObject({
            payload: { type: 'AUDIO_MUTE_TOGGLE', isMuted: true },
        })
    })
})
