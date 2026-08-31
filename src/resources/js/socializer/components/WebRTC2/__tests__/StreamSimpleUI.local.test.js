/**
 * StreamSimpleUI.local.test.js — le JOINT de l'exception du partage d'écran
 *
 * `LocalMediaPlayer` distingue ma webcam de mon partage d'écran par **identité de référence** :
 *
 *     isScreenStream = !!streamData.stream && streamData.stream === api.screenStream.value
 *
 * Ce prédicat a donc deux bouts, et `LocalMediaPlayer.test.js` n'en tient qu'un — il fabrique
 * lui-même les deux côtés de l'égalité. L'autre bout est ici : **ce que `StreamSimpleUI` compose
 * réellement**, `screenStreamData.stream = props.api.screenStream.value`
 * (`StreamSimpleUI.vue:176`). Reconstruire ce flux — un spread, un `{ ...stream }`, une
 * normalisation — casserait l'exception sans rougir un seul cas ailleurs : mon écran partagé
 * disparaîtrait à l'instant où je coupe ma caméra. C'est le même mode de panne que le joint
 * `conn.peer` du lot C, dans l'autre sens (local au lieu de distant).
 *
 * ⚠️ **Aucun test ne pouvait monter ce chemin avant celui-ci.** Les deux fichiers
 * `StreamSimpleUI.*` sèment `currentStream` et `screenStream` à `null`, donc les deux `v-if`
 * sont faux et aucun `LocalMediaPlayer` ne se monte — il aurait levé, faute de provider. Ce
 * fichier est le premier à fournir `WEBRTC_API_KEY`.
 *
 * ── Choix d'infra ─────────────────────────────────────────────────────────────
 *
 * ⚠️ **Le double est le MÊME objet en prop et en provide**, et c'est la fidélité qui porte tout
 * le fichier : en production, `StreamSimpleUI` reçoit l'api par prop (`v-bind="webrtc"`) et
 * `LocalMediaPlayer` l'`inject`e — deux chemins, une seule instance, celle du provider. Deux
 * doubles distincts feraient échouer la comparaison d'identité sur du code correct, et l'on
 * conclurait à un défaut de production.
 *
 * ── Non-duplication déclarée ──────────────────────────────────────────────────
 *
 * « `isMe` mute le vrai `<video>` et retire le bouton Mute » vit à
 * `MediaBroadcastPlayer.controls.test.js`, sur le lecteur réel. Ce fichier n'assert que
 * l'**origine** du drapeau — que `localStreamData` le pose —, ce qu'aucun test recevant
 * `streamData` en prop ne peut voir. D'où l'assertion sur la prop du lecteur, et non sur
 * `element.muted` : la moitié DOM est déjà tenue.
 *
 * ── CONTRÔLES DE HARNAIS (convention du paquet), mesurés le 2026-08-31 ────────
 *
 * Référence relue verte avant chaque mutation : 79 fichiers, 1417 cas.
 *
 *    1. `screenStreamData.stream` reconstruit en copie ..... 1 cas  (0 AILLEURS)
 *    2. `isMe: true` retiré de `localStreamData` ........... 1 cas
 *    3. `isMe: true` retiré de `screenStreamData` .......... 1 cas
 *    4. le `v-if` du second player retiré ................. 12 cas (1 ici, 6 + 5 ailleurs)
 *
 * ⭐ **Le n° 1 est ce qui justifie ce fichier : 1 cas ici, 0 dans `LocalMediaPlayer.test.js` et
 * 0 dans `MediaBroadcastProvider.test.js`.** L'exception d'écran peut être entièrement cassée
 * — mon écran partagé disparaissant dès que je coupe ma caméra — pendant que l'étage adaptateur
 * reste vert, puisqu'il fabrique lui-même les deux côtés de l'égalité.
 *
 * ⚠️ **Le n° 4 n'isole rien, et c'est instructif.** Les 11 cas de trop sont dans
 * `StreamSimpleUI.awaited.test.js` (6) et `.toggles.test.js` (5) : sans le `v-if`, un
 * `LocalMediaPlayer` se monte dans ces fichiers, qui ne fournissent aucune api — et il lève.
 * Ces deux fichiers ne sont donc protégés du player local que par ce `v-if`. Ce n'est pas un
 * défaut, c'est un couplage à connaître avant de toucher au template : le contrôle mesure « le
 * player ne monte pas sans flux », pas « le second `v-if` garde le bon flux ».
 */
import { describe, it, expect, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import StreamSimpleUI from '~socializer/components/WebRTC2/Exemples/StreamSimple/StreamSimpleUI.vue'
import { WEBRTC_API_KEY } from '~socializer/components/WebRTC2/webrtc2.config.js'
import { createMediaApiDouble } from './helpers/createMediaApiDouble.js'

const VideoPlayerStub = {
    name: 'VideoPlayer',
    props: ['srcObject', 'controls', 'autoplay', 'muted', 'playsinline'],
    emits: ['can-play', 'playing', 'waiting', 'stalled', 'error'],
    template: '<video class="video-stub" />',
}

const AudioPlayerStub = {
    name: 'AudioPlayer',
    props: ['srcObject', 'controls', 'autoplay', 'loop', 'muted'],
    template: '<audio class="audio-stub" />',
}

const creerApi = ({ webcam = null, ecran = null } = {}) => ({
    ...createMediaApiDouble({ currentStream: webcam, screenStream: ecran }),

    initialize: vi.fn(),
    myName: ref('Moi'),
    currentType: ref('stream'),

    remotePeers: ref([]),
    remoteStreams: ref([]),
    remoteScreens: ref([]),
    announcedStreamPeers: ref([]),
})

const monter = (etat) => {
    const api = creerApi(etat)

    const wrapper = mount(StreamSimpleUI, {
        props: { api },
        global: {
            // Le MÊME objet des deux côtés — cf. « Choix d'infra » ci-dessus.
            provide: { [WEBRTC_API_KEY]: api },
            stubs: {
                VideoPlayer: VideoPlayerStub,
                AudioPlayer: AudioPlayerStub,
                Spinner1: { template: '<span class="spinner-stub" />' },
            },
        },
    })

    return { wrapper, api }
}

/**
 * Les vignettes locales, dans l'ordre du template : webcam puis écran. Aucun flux distant
 * n'est semé dans ce fichier, donc ce sont les seules — et les vignettes d'attente sont
 * exclues comme ailleurs.
 */
const vignettes = (w) =>
    w.findAll('.draggable-video').filter((v) => !v.classes().includes('video-awaited'))

const surBrancheVideo = (vignette) => vignette.find('.video-stub').exists()

describe('StreamSimpleUI — mes deux flux locaux', () => {

    it('⭐⭐ je coupe ma caméra : ma webcam passe en audio, mon écran partagé garde son image', async () => {
        // LE JOINT. Il tombe si `screenStreamData.stream` cesse d'être la référence même
        // qu'expose l'api — et il n'y a rien d'autre, nulle part, qui le dise.
        const { wrapper, api } = monter({
            webcam: { id: 'flux-webcam' },
            ecran: { id: 'flux-ecran' },
        })

        const [webcam, ecran] = vignettes(wrapper)
        expect(surBrancheVideo(webcam)).toBe(true)
        expect(surBrancheVideo(ecran)).toBe(true)

        api.toggleVideoVisibility()
        await nextTick()

        const [webcamApres, ecranApres] = vignettes(wrapper)
        expect(webcamApres.find('.audio-stub').exists()).toBe(true)
        expect(surBrancheVideo(ecranApres)).toBe(true)
    })

    it('ne rend que les flux réellement diffusés', () => {
        // Les deux `v-if`, et il en faut trois états : sans le cas « webcam seule », un second
        // player rendu inconditionnellement passerait pour correct sur le cas d'au-dessus.
        expect(vignettes(monter().wrapper)).toHaveLength(0)
        expect(vignettes(monter({ webcam: { id: 'w' } }).wrapper)).toHaveLength(1)
        expect(vignettes(monter({ webcam: { id: 'w' }, ecran: { id: 'e' } }).wrapper)).toHaveLength(2)
    })

    it('⭐ mes deux vignettes se déclarent miennes — sans quoi je m\'entends moi-même', () => {
        // L'origine du drapeau anti-écho : `localStreamData` et `screenStreamData` posent
        // `isMe: true`. La conséquence (lecteur muet, pas de bouton Mute) est épinglée sur le
        // lecteur RÉEL par `MediaBroadcastPlayer.controls.test.js` ; ce qui n'est qu'ici, c'est
        // que les deux flux locaux le portent.
        const { wrapper } = monter({ webcam: { id: 'flux-webcam' }, ecran: { id: 'flux-ecran' } })

        const mutes = vignettes(wrapper).map((v) => v.findComponent(VideoPlayerStub).props('muted'))

        expect(mutes).toEqual([true, true])
    })
})
