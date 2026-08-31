/**
 * LocalMediaPlayer.test.js — l'adaptateur qui branche MON flux sur MON état de diffusion
 *
 * Le jumeau local de `RemoteMediaPlayer` : même forme (convertir, relayer), mais la source
 * n'est plus la file de signaux d'un pair — c'est l'api de diffusion, reçue par `inject`. Et
 * il porte une règle que le distant n'a pas : **un partage d'écran garde toujours sa vidéo
 * active**, même quand je coupe ma caméra. `isVideoEnabled` ne concerne que la webcam.
 *
 * Cette règle repose sur une comparaison par **identité de référence** :
 *
 *     isScreenStream = !!props.streamData.stream && props.streamData.stream === api.screenStream.value
 *
 * Elle a donc deux bouts, comme le joint du lot C. Celui-ci est ici ; l'autre — le flux que
 * `StreamSimpleUI` compose réellement — est dans `StreamSimpleUI.local.test.js`.
 *
 * ── Choix d'infra ─────────────────────────────────────────────────────────────
 *
 * **`MediaBroadcastPlayer` est monté POUR DE VRAI**, même arbitrage et mêmes bornes que
 * `RemoteMediaPlayer.test.js` : un composant qui n'existe que pour convertir et relayer ne se
 * teste pas contre un stub. Ce qui est stubé s'arrête aux trois feuilles `~estarter`
 * (`VideoPlayer`, `AudioPlayer`, `Spinner1`) ; `IconWidget` reste réel, c'est lui qui rend
 * `.la-microphone-slash`.
 *
 * **Pas de `helpers/fakeFullscreen.js` ici**, contrairement à ce que l'énoncé du lot annonçait :
 * `useMediaControls` ne touche `document` que sur une action de bascule, et aucun cas de ce
 * fichier n'en déclenche. Précédent identique chez le jumeau, qui monte le même player réel
 * sans ce helper.
 *
 * **Les flux sont des objets nus**, pas des `MediaStream` — ce fichier ne les donne qu'à des
 * stubs, et ce qu'il exerce est l'identité de référence, pas le contenu. (`helpers/fakeMedia.js`
 * n'est nécessaire qu'aux fichiers qui attachent un vrai lecteur au DOM.)
 *
 * ── Non-duplication déclarée ──────────────────────────────────────────────────
 *
 * **L'anti-écho n'est PAS réasserté ici.** « Mon propre flux est muet d'office et n'offre pas
 * de bouton Mute » vit à `MediaBroadcastPlayer.controls.test.js` (§ « mon propre flux »), sur
 * le vrai lecteur. Ce que ce fichier-là ne peut pas voir est l'origine du drapeau : `isMe` est
 * posé par `localStreamData`, donc son épinglage appartient à `StreamSimpleUI.local.test.js`.
 * `LocalMediaPlayer` ne fait que laisser passer la metadata — il n'y a rien à mesurer entre les
 * deux.
 *
 * De même, « couper la caméra bascule TOUT le player sur la branche audio » est déjà chez le
 * jumeau. Ce qui est neuf ici est l'**exception** : le flux qui ne bascule pas.
 *
 * ── CONTRÔLES DE HARNAIS (convention du paquet), mesurés le 2026-08-31 ────────
 *
 * Référence relue verte avant chaque mutation : 79 fichiers, 1417 cas.
 *
 *    1. `isScreenStream` figé à `false` ..................... 3 cas  (2 ici + 1 SSU.local)
 *    2. `!!props.streamData.stream &&` retiré du prédicat ... 1 cas
 *    3. `:muted="api.isMuted.value"` figé à `false` ......... 1 cas
 *    4. `:videoActive="videoActive"` retiré du câblage ...... 4 cas  (2 ici + 1 MBP + 1 SSU)
 *    5. garde `if (!api) throw` retirée ..................... 1 cas
 *    6. relais de slots (`<template v-for … in $slots>`) ... 1 cas
 *    7. `v-bind="slotData ?? {}"` retiré du relais .......... 1 cas
 *    8. `inheritAttrs: false` ajouté ....................... 1 cas  (0 AVANT la sortie B)
 *    9. `v-bind="$attrs"` retiré ........................... 0 cas  ⇒ sortie B, FAIT
 *
 * ⭐ **Le n° 8 est le chiffre qui vaut la sortie B**, et il ne dit pas ce qu'on attendait. Le
 * `v-bind="$attrs"` de la l. 6 ne faisait pas que doubler le fallthrough : il **désarmait le
 * contrôle du voisin**. Tant qu'il était là, ajouter `inheritAttrs: false` rougissait 0 cas —
 * le `v-bind` rendait les attributs de toute façon — contre 1 cas chez le jumeau, qui ne
 * l'avait plus. Après retrait : 1 cas ici aussi. Une ligne redondante n'est donc pas seulement
 * du bruit ; elle peut rendre un test aveugle à la régression qu'il est censé garder.
 *
 * ℹ️ **Un dixième contrôle a mesuré 0 et la ligne est CONSERVÉE** : le repli `null` d'`inject`
 * (`inject(WEBRTC_API_KEY, null)` → `inject(WEBRTC_API_KEY)`). Il n'affirme rien de faux — le
 * garde du n° 5 lève dans les deux cas — il sert à ce que la levée porte CE message plutôt
 * qu'un `injection "Symbol(webrtcApi)" not found` de Vue suivi d'un `TypeError` opaque. Même
 * arbitrage que le `if (m !== null)` d'`onToggleNativeMute` (`MediaBroadcastPlayer.controls`) :
 * la sortie B est pour une ligne qui MENT, pas pour toute ligne immesurable.
 */
import { describe, it, expect, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import LocalMediaPlayer from '~socializer/components/WebRTC2/Widgets/Mediaplayer/LocalMediaPlayer.vue'
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
    // `props` déclarés (et non hérités) : sans ça, srcObject retomberait en attribut sur un vrai
    // <audio>, que le DOM refuse — même raison que dans `MediaBroadcastPlayer.spinner.test.js`.
    props: ['srcObject', 'controls', 'autoplay', 'loop', 'muted'],
    template: '<audio class="audio-stub" />',
}

/** La forme exacte que `StreamSimpleUI.localStreamData` rend pour ma webcam. */
const fluxLocal = (stream) => ({
    stream,
    metadata: { fromName: 'Moi', roomId: 'room-1', isMe: true },
})

/** Celle de `screenStreamData` — même forme, autre flux. */
const fluxEcran = (stream) => ({
    stream,
    metadata: { fromName: 'Moi', roomId: 'room-1', isMe: true },
})

const monter = (streamData, api, options = {}) =>
    mount(LocalMediaPlayer, {
        props: { streamData },
        ...options,
        global: {
            provide: { [WEBRTC_API_KEY]: api },
            stubs: {
                VideoPlayer: VideoPlayerStub,
                AudioPlayer: AudioPlayerStub,
                Spinner1: { template: '<span class="spinner-stub" />' },
            },
        },
    })

const microCoupe = (w) => w.find('.la-microphone-slash').exists()
const surBrancheVideo = (w) => w.find('.video-stub').exists()

describe('LocalMediaPlayer — mon flux et mon état de diffusion', () => {

    describe('l\'exception du partage d\'écran', () => {
        it('⭐⭐ je coupe ma caméra : ma webcam passe en audio, mon écran partagé reste en vidéo', async () => {
            // Le cas du lot. DEUX instances sont obligatoires : avec la seule vignette webcam,
            // « l'écran garde sa vidéo » et « tout garde sa vidéo » sont le même vert. C'est la
            // forme locale du piège « un seul pair, une seule connexion » de tests.md — et le
            // couple des deux vignettes est exactement ce que rend `StreamSimpleUI` quand on
            // diffuse sa webcam et son écran en même temps.
            const webcam = { id: 'flux-webcam' }
            const ecran = { id: 'flux-ecran' }
            const api = createMediaApiDouble({ currentStream: webcam, screenStream: ecran })

            const vignetteWebcam = monter(fluxLocal(webcam), api)
            const vignetteEcran = monter(fluxEcran(ecran), api)
            expect(surBrancheVideo(vignetteWebcam)).toBe(true)
            expect(surBrancheVideo(vignetteEcran)).toBe(true)

            api.toggleVideoVisibility() // le geste réel du bouton « Hide video »
            await nextTick()

            expect(vignetteWebcam.find('.audio-stub').exists()).toBe(true)
            expect(surBrancheVideo(vignetteEcran)).toBe(true)
        })

        it('⭐ un flux ABSENT n\'est pas un partage d\'écran, même quand aucun écran n\'est partagé', async () => {
            // Sans le garde `!!props.streamData.stream`, le prédicat devient `null === null`,
            // donc VRAI : la vignette se croirait un écran partagé et resterait épinglée sur la
            // branche vidéo à vie, insensible à `isVideoEnabled`.
            //
            // ⚠️ Portée bornée, et il faut le dire : les deux `v-if` de `StreamSimpleUI`
            // garantissent un flux non nul AU MONTAGE. Le chemin atteignable est une instance
            // qui perd son flux en vol, ou un consommateur qui monte le player sans `v-if` —
            // le contrat du composant ne l'interdit pas (`streamData` est requis, `stream` non).
            const api = createMediaApiDouble({ currentStream: null, screenStream: null })
            const w = monter({ stream: null, metadata: { fromName: 'Moi', isMe: true } }, api)

            api.toggleVideoVisibility()
            await nextTick()

            expect(w.find('.audio-stub').exists()).toBe(true)
            expect(surBrancheVideo(w)).toBe(false)
        })

        it('un écran partagé garde sa vidéo alors que la caméra est DÉJÀ coupée au montage', () => {
            // La variante non réactive : l'exception doit tenir au premier rendu aussi, sinon
            // couper sa caméra AVANT de partager son écran donnerait un écran sans image.
            const ecran = { id: 'flux-ecran' }
            const api = createMediaApiDouble({
                isVideoEnabled: false,
                currentStream: null,
                screenStream: ecran,
            })

            expect(surBrancheVideo(monter(fluxEcran(ecran), api))).toBe(true)
        })
    })

    describe('le relais de mon état de micro', () => {
        it('⭐ je coupe mon micro, ma vignette l\'affiche — et continue de le suivre', async () => {
            // Les deux sens : `api.isMuted` est un computed, le lire une seule fois au montage
            // donnerait un vert sur le premier état et un mensonge sur tous les suivants.
            const webcam = { id: 'flux-webcam' }
            const api = createMediaApiDouble({ currentStream: webcam })
            const w = monter(fluxLocal(webcam), api)
            expect(microCoupe(w)).toBe(false)

            api.toggleAudioMute()
            await nextTick()
            expect(microCoupe(w)).toBe(true)

            api.toggleAudioMute()
            await nextTick()
            expect(microCoupe(w)).toBe(false)
        })
    })

    describe('le contrat d\'injection', () => {
        it('⭐ monté hors d\'un MediaBroadcastProvider, il lève au lieu de rendre une vignette morte', () => {
            // Le repli `null` d'`inject` n'est pas une tolérance : il existe pour que la levée
            // porte CE message plutôt qu'un « Cannot read properties of undefined » sur
            // `api.isMuted`, et pour qu'aucun `injection not found` de Vue ne pollue les
            // montages légitimes. La panne est de développement, jamais d'exécution — un
            // consommateur mal placé ne rend rien du tout, il casse bruyamment.
            const bruit = vi.spyOn(console, 'warn').mockImplementation(() => {})

            expect(() => mount(LocalMediaPlayer, { props: { streamData: fluxLocal({ id: 'x' }) } }))
                .toThrow(/MediaBroadcastProvider/)

            bruit.mockRestore()
        })
    })

    describe('la transparence : ce que le consommateur passe traverse', () => {
        it('⭐ un slot du consommateur atteint le player interne, avec sa charge', () => {
            // Présence ET charge dans le même cas : le relais passe `slotData` explicitement, et
            // asserter la seule présence laisserait retirer ce `v-bind` sans rien rougir.
            const webcam = { id: 'flux-webcam' }
            const api = createMediaApiDouble({ currentStream: webcam })
            const w = monter(fluxLocal(webcam), api, {
                slots: {
                    video: '<span class="mon-video">{{ params.streamData.metadata.fromName }}</span>',
                },
            })

            expect(w.find('.mon-video').exists()).toBe(true)
            expect(w.find('.mon-video').text()).toBe('Moi')
        })

        it('un attribut du consommateur atteint la racine du player', () => {
            const webcam = { id: 'flux-webcam' }
            const api = createMediaApiDouble({ currentStream: webcam })
            const w = monter(fluxLocal(webcam), api, { attrs: { 'data-cadre': 'local' } })

            expect(w.attributes('data-cadre')).toBe('local')
            expect(w.classes()).toContain('draggable-video')
        })
    })
})
