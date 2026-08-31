/**
 * RemoteMediaPlayer.test.js — l'adaptateur qui branche un flux distant sur l'état de son pair
 *
 * Vingt-quatre lignes qui ne font que deux choses : **convertir** (`streamData.metadata.peerId`
 * en abonnement à la file de signaux de ce pair) et **relayer** (les deux booléens en props de
 * `MediaBroadcastPlayer`, et tous les slots du consommateur). C'est l'unique endroit du dépôt où
 * un `AUDIO_MUTE_TOGGLE` reçu devient quelque chose qu'un utilisateur voit.
 *
 * ── Choix d'infra ─────────────────────────────────────────────────────────────
 *
 * **`MediaBroadcastPlayer` est monté POUR DE VRAI.** Un composant qui n'existe que pour convertir
 * et relayer ne se teste pas contre un stub : on asserterait les props de son propre double, et
 * la conversion — la seule logique du fichier — ne serait vérifiée nulle part. Ce qui est stubé
 * s'arrête aux trois feuilles `~estarter` (`VideoPlayer`, `AudioPlayer`, `Spinner1`), comme dans
 * `MediaBroadcastPlayer.spinner.test.js`.
 *
 * **`IconWidget` reste RÉEL** : il rend `<i class="las la-{icon}">`, et c'est cette valeur-là
 * qu'on asserte. Le stuber ferait asserter un `data-icon` que le stub aurait posé lui-même
 * (`docs/modules/webrtc2/tests.md`, § « Monter les enfants réels »).
 *
 * ⚠️ **Les `directives: { resize, draggable }` que passent les fichiers voisins sont INERTES, et
 * ne sont donc pas reprises ici.** `MediaBroadcastPlayer` fait `const vResize = resizeDirective`
 * dans son `<script setup>` : le compilateur résout la directive en binding de setup et n'émet
 * aucun `resolveDirective`, donc l'enregistrement global n'est jamais consulté — les VRAIES
 * directives tournent, dans ce fichier comme dans les autres. Elles sont inoffensives parce que
 * `resizable` et `draggable` valent `false` par défaut et sortent en early-return, pas parce
 * qu'on les aurait neutralisées.
 *
 * ── CONTRÔLES DE HARNAIS (convention du paquet), mesurés le 2026-08-31 ────────
 *
 *    1. `useRemotePeerState(peerId)` remplacé par deux constantes ........... 4 cas
 *    2. `:muted="muted"` retiré du câblage ................................. 3 cas
 *    3. `:videoActive="videoActive"` retiré du câblage ..................... 1 cas
 *    4. `metadata?.peerId` recâblé sur `metadata?.from` .................... 4 cas
 *    5. `isLocallyMuted` recâblé sur `props.muted` (MediaBroadcastPlayer) .. 1 cas
 *    6. relais de slots (`<template v-for="(_, name) in $slots">`) retiré ... 1 cas
 *    7. `v-bind="slotData ?? {}"` retiré du relais .......................... 1 cas
 *    8. `inheritAttrs: false` ajouté ....................................... 1 cas
 *    9. un commentaire HTML ajouté en tête de `<template>` ................. 1 cas
 *
 * ℹ️ **Un dixième contrôle a mesuré 0 trois fois, et a fait SUPPRIMER la ligne** (sortie B) :
 * `v-bind="$attrs"` sur `<MediaBroadcastPlayer>`. La racine du composant est un composant unique,
 * donc Vue applique déjà les attributs de fallthrough sur lui — le `v-bind` explicite les
 * appliquait une seconde fois, ce qui était idempotent et donc invisible.
 *
 * ⚠️ **Le n° 9 n'est pas un contrôle décoratif : il a été mesuré pour de vrai, par accident.**
 * L'explication du retrait ci-dessus avait d'abord été écrite en commentaire HTML dans le
 * `<template>`, au-dessus de la racine. Le composant devient alors **multi-racine** et Vue cesse
 * de faire descendre les attributs : le cas de transparence est passé au rouge, et le contrôle
 * n° 8 mesuré juste après a rendu « 1 » qui n'était pas le sien — c'était la régression déjà
 * là. D'où deux règles : le commentaire vit dans le `<script setup>`, et **un contrôle dont la
 * référence n'a pas été relue à 0 ne mesure rien**.
 *
 * ⚠️ Le n° 5 rougit **1 cas et pas 0**. Zéro voudrait dire que le cas « l'icône ne coupe aucun
 * son » ne distingue pas « affiché » de « coupé » — et ce serait le test qu'il faudrait réparer.
 *
 * ℹ️ Le `v-bind="$attrs"` redondant du jumeau `LocalMediaPlayer.vue` a été retiré au lot E
 * (31/08/2026), après la même mesure à 0 — voir `LocalMediaPlayer.test.js`, dont le contrôle
 * n° 8 montre que cette ligne rendait le contrôle `inheritAttrs: false` aveugle (0 au lieu
 * de 1).
 */
import { describe, it, expect } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { usePeer2Store } from '~socializer/stores/peers2.js'
import RemoteMediaPlayer from '~socializer/components/WebRTC2/Widgets/Mediaplayer/RemoteMediaPlayer.vue'

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

/** La forme exacte que `StreamSimpleUI.remoteStreamsData` rend pour un flux distant. */
const flux = (peerId = 'peer-alice', fromName = 'Alice') => ({
    stream: { id: `flux-de-${fromName}` },
    metadata: { fromName, roomId: 'room-1', peerId },
})

const monter = (streamData = flux(), options = {}) =>
    mount(RemoteMediaPlayer, {
        props: { streamData },
        ...options,
        global: {
            stubs: {
                VideoPlayer: VideoPlayerStub,
                AudioPlayer: AudioPlayerStub,
                Spinner1: { template: '<span class="spinner-stub" />' },
            },
        },
    })

const annoncerMicro = (peerStore, peerId, isMuted) =>
    peerStore.dispatchSignal({
        roomId: peerId,
        payload: { type: 'AUDIO_MUTE_TOGGLE', isMuted },
    })

const annoncerCamera = (peerStore, peerId, isActive) =>
    peerStore.dispatchSignal({
        roomId: peerId,
        payload: { type: 'VIDEO_ACTIVE_TOGGLE', isActive },
    })

const microCoupe = (w) => w.find('.la-microphone-slash').exists()

describe('RemoteMediaPlayer — le flux distant et l\'état de son pair', () => {

    describe('la conversion : quel pair ce player écoute', () => {
        it('⭐ le pair coupe son micro, la vignette l\'affiche', async () => {
            const peerStore = usePeer2Store()
            const w = monter(flux('peer-alice'))
            expect(microCoupe(w)).toBe(false)

            annoncerMicro(peerStore, 'peer-alice', true)
            await nextTick()

            expect(microCoupe(w)).toBe(true)
        })

        it('⭐ deux vignettes montées, une seule bouge', async () => {
            // La clé d'abonnement vient de `metadata.peerId`, pas du hasard du montage : sans un
            // second player, « la bonne vignette » et « toutes les vignettes » sont le même vert.
            const peerStore = usePeer2Store()
            const alice = monter(flux('peer-alice', 'Alice'))
            const bob = monter(flux('peer-bob', 'Bob'))

            annoncerMicro(peerStore, 'peer-alice', true)
            await nextTick()

            expect(microCoupe(alice)).toBe(true)
            expect(microCoupe(bob)).toBe(false)
        })

        it('⭐ un flux sans `peerId` n\'écoute rien, et ne lève pas', async () => {
            // Les vignettes de partage d'écran : `remoteScreensData` ne pose aucun `peerId`, et
            // leur surdité est voulue — un pair qui coupe sa webcam ne doit pas faire disparaître
            // son partage d'écran (règle symétrique de `LocalMediaPlayer`).
            const peerStore = usePeer2Store()
            const ecran = mount(RemoteMediaPlayer, {
                props: { streamData: { stream: { id: 'ecran' }, metadata: { fromName: 'Alice' } } },
                global: {
                    stubs: {
                        VideoPlayer: VideoPlayerStub,
                        AudioPlayer: AudioPlayerStub,
                        Spinner1: { template: '<span class="spinner-stub" />' },
                    },
                },
            })

            annoncerCamera(peerStore, undefined, false)
            annoncerCamera(peerStore, 'peer-alice', false)
            await nextTick()

            expect(ecran.find('.video-stub').exists()).toBe(true)
            expect(microCoupe(ecran)).toBe(false)
        })
    })

    describe('le relais : ce que les deux booléens changent à l\'écran', () => {
        it('⭐ couper sa caméra bascule TOUT le player sur la branche audio', async () => {
            // `videoActive` ne masque pas une image : il change de lecteur. Le `<video>` s'en va,
            // un `<audio>` le remplace, et les contrôles de la branche vidéo disparaissent avec.
            const peerStore = usePeer2Store()
            const w = monter(flux('peer-alice'))
            expect(w.find('.video-stub').exists()).toBe(true)

            annoncerCamera(peerStore, 'peer-alice', false)
            await nextTick()

            expect(w.find('.video-stub').exists()).toBe(false)
            expect(w.find('.audio-stub').exists()).toBe(true)
            expect(w.find('.video-controls').text()).toBe('')
        })

        it('⭐ l\'icône de micro coupé ne coupe AUCUN son', async () => {
            // `muted` est une information, pas une commande : le mute réel se fait chez
            // l'émetteur (`track.enabled`), et le player continue de jouer ce qu'il reçoit. Le
            // seul mute local légitime est le sien (`metadata.isMe`, ou le bouton « Mute »).
            // Sans cette assertion, recâbler le `<video>` sur `props.muted` passerait inaperçu et
            // rendrait un pair en sourdine totalement inaudible pour tout le monde.
            const peerStore = usePeer2Store()
            const w = monter(flux('peer-alice'))

            annoncerMicro(peerStore, 'peer-alice', true)
            await nextTick()

            expect(microCoupe(w)).toBe(true)
            expect(w.findComponent(VideoPlayerStub).props('muted')).toBe(false)
        })
    })

    describe('la transparence : ce que le consommateur passe traverse', () => {
        it('⭐ un slot du consommateur atteint le player interne, avec sa charge', async () => {
            // Présence ET charge dans le même cas : le relais passe `slotData` explicitement, et
            // asserter la seule présence laisserait retirer ce `v-bind` sans rien rougir.
            const w = monter(flux('peer-alice', 'Alice'), {
                slots: {
                    video: '<span class="mon-video">{{ params.streamData.metadata.fromName }}</span>',
                },
            })

            expect(w.find('.mon-video').exists()).toBe(true)
            expect(w.find('.mon-video').text()).toBe('Alice')
        })

        it('un attribut du consommateur atteint la racine du player', () => {
            const w = monter(flux('peer-alice'), { attrs: { 'data-cadre': 'principal' } })

            expect(w.attributes('data-cadre')).toBe('principal')
            expect(w.classes()).toContain('draggable-video')
        })
    })
})
