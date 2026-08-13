/**
 * MediaBroadcastPlayer.spinner.test.js
 *
 * Overlay d'attente d'image : un flux distant est déjà reçu mais aucune frame n'est
 * encore décodée (négociation ICE, premières images). Sans retour visuel, le cadre noir
 * du <video> se lit comme une panne.
 *
 * Aucune heuristique ici, contrairement à useAwaitedStreams : on s'appuie sur les
 * événements que VideoPlayer émet déjà (`can-play`, `playing`, `waiting`, `stalled`).
 */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import MediaBroadcastPlayer from '~socializer/components/WebRTC2/Widgets/Mediaplayer/MediaBroadcastPlayer.vue'

// Les directives v-resize / v-draggable touchent le DOM réel : neutralisées ici, elles
// ne participent pas au comportement testé.
const noopDirective = {}

// Stub de VideoPlayer : expose un moyen d'émettre les events du cycle média.
const VideoPlayerStub = {
    name: 'VideoPlayer',
    props: ['srcObject', 'controls', 'autoplay', 'muted', 'playsinline'],
    emits: ['can-play', 'playing', 'waiting', 'stalled', 'error'],
    template: '<video class="video-stub" />',
}

const streamData = (stream = { id: 's1' }) => ({
    stream,
    metadata: { fromName: 'Alice', roomId: 'room-1' },
})

const mountPlayer = (props = {}, slots = {}) =>
    mount(MediaBroadcastPlayer, {
        props: { streamData: streamData(), ...props },
        slots,
        global: {
            stubs: {
                VideoPlayer: VideoPlayerStub,
                // `props` déclarés (et non hérités) : sans ça, srcObject retomberait en
                // attribut sur un vrai <audio>, que le DOM refuse — bruit inutile.
                AudioPlayer: {
                    props: ['srcObject', 'controls', 'autoplay', 'loop', 'muted'],
                    template: '<audio class="audio-stub" />',
                },
                IconWidget: { template: '<i />' },
                Spinner1: { template: '<span class="spinner-stub" />' },
            },
            directives: { resize: noopDirective, draggable: noopDirective },
        },
    })

const spinner = (wrapper) => wrapper.find('.video-loading')

describe('MediaBroadcastPlayer — overlay d\'attente', () => {

    it('affiche l\'overlay tant que le flux n\'a pas annoncé pouvoir jouer', () => {
        expect(spinner(mountPlayer()).exists()).toBe(true)
    })

    it('masque l\'overlay dès `can-play`', async () => {
        const wrapper = mountPlayer()

        await wrapper.findComponent(VideoPlayerStub).vm.$emit('can-play')

        expect(spinner(wrapper).exists()).toBe(false)
    })

    it('masque l\'overlay dès `playing`', async () => {
        const wrapper = mountPlayer()

        await wrapper.findComponent(VideoPlayerStub).vm.$emit('playing')

        expect(spinner(wrapper).exists()).toBe(false)
    })

    it('réaffiche l\'overlay si la lecture se met en attente', async () => {
        const wrapper = mountPlayer()
        await wrapper.findComponent(VideoPlayerStub).vm.$emit('can-play')

        await wrapper.findComponent(VideoPlayerStub).vm.$emit('waiting')

        expect(spinner(wrapper).exists()).toBe(true)
    })

    it('n\'affiche pas d\'overlay en l\'absence de flux', () => {
        // L'attente « aucun flux encore arrivé » relève de useAwaitedStreams, pas d'ici.
        expect(spinner(mountPlayer({ streamData: streamData(null) })).exists()).toBe(false)
    })

    it('n\'affiche pas d\'overlay quand la vidéo est désactivée (flux audio)', () => {
        expect(spinner(mountPlayer({ videoActive: false })).exists()).toBe(false)
    })

    it('réaffiche l\'overlay au changement de flux (instance recyclée par le pool)', async () => {
        const wrapper = mountPlayer()
        await wrapper.findComponent(VideoPlayerStub).vm.$emit('can-play')
        expect(spinner(wrapper).exists()).toBe(false)

        // Le pool réattribue ce slot à un autre flux : l'attente reprend à zéro.
        await wrapper.setProps({ streamData: streamData({ id: 's2' }) })

        expect(spinner(wrapper).exists()).toBe(true)
    })

    it('n\'affiche pas d\'overlay quand le consommateur fournit son propre slot vidéo', () => {
        // Nos écouteurs `can-play` ne seraient pas branchés → spinner à vie.
        const wrapper = mountPlayer({}, { video: '<video class="custom" />' })

        expect(spinner(wrapper).exists()).toBe(false)
    })

    it('masque l\'overlay en cas d\'erreur de lecture (pas de spinner perpétuel)', async () => {
        const wrapper = mountPlayer()

        await wrapper.findComponent(VideoPlayerStub).vm.$emit('error')

        expect(spinner(wrapper).exists()).toBe(false)
    })
})
