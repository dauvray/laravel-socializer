/**
 * MediaBroadcastPlayer.identity.test.js
 *
 * Bandeau d'identité d'une vignette : nom affiché et compteur d'audience.
 *
 * Le player ne connaît QUE `streamData.metadata` — il n'interroge aucun store et ne
 * déduit rien du type d'appel. D'où les deux règles couvertes ici :
 *   - le nom vient de `metadata.fromName`, « Inconnu » n'est qu'un dernier recours ;
 *   - le compteur n'existe que si le consommateur en fournit un. Il n'a de sens qu'en
 *     diffusion : sur un appel direct (visio, vocal, écran), personne ne compte une
 *     audience, et l'ancienne règle (« afficher sauf si type === visio ») affichait
 *     donc un « 👁 0 » permanent sur les appels vocaux et les partages d'écran.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import MediaBroadcastPlayer from '~socializer/components/WebRTC2/Widgets/Mediaplayer/MediaBroadcastPlayer.vue'

const noopDirective = {}

const mountPlayer = (metadata = {}) =>
    mount(MediaBroadcastPlayer, {
        props: { streamData: { stream: { id: 's1' }, metadata } },
        global: {
            stubs: {
                VideoPlayer: { props: ['srcObject'], template: '<video />' },
                AudioPlayer: { props: ['srcObject'], template: '<audio />' },
                IconWidget: { props: ['icon'], template: '<i class="icon" :data-icon="icon" />' },
                Spinner1: { template: '<span />' },
            },
            directives: { resize: noopDirective, draggable: noopDirective },
        },
    })

const userInfo = (wrapper) => wrapper.get('.user-info').text()
const hasViewersIcon = (wrapper) =>
    wrapper.findAll('.user-info .icon').some((i) => i.attributes('data-icon') === 'eye')

describe('MediaBroadcastPlayer — bandeau d\'identité', () => {

    describe('nom du pair', () => {
        it('affiche le nom fourni par les métadonnées', () => {
            expect(userInfo(mountPlayer({ fromName: 'Alice' }))).toContain('Alice')
        })

        it('retombe sur « Inconnu » quand aucun nom n\'est fourni', () => {
            expect(userInfo(mountPlayer({}))).toContain('Inconnu')
        })
    })

    describe('compteur d\'audience', () => {
        it('affiche le compteur quand le consommateur en fournit un', () => {
            const wrapper = mountPlayer({ fromName: 'Alice', currentType: 'stream', countViewers: 3 })

            expect(hasViewersIcon(wrapper)).toBe(true)
            expect(userInfo(wrapper)).toContain('3')
        })

        it('affiche zéro quand personne ne regarde une diffusion', () => {
            const wrapper = mountPlayer({ currentType: 'stream', countViewers: 0 })

            expect(hasViewersIcon(wrapper)).toBe(true)
            expect(userInfo(wrapper)).toContain('0')
        })

        it('ne montre aucun compteur sur un appel direct', () => {
            // Appel vocal : aucun countViewers fourni. L'ancienne règle basée sur le type
            // n'excluait que 'visio' — un « 👁 0 » s'affichait ici.
            expect(hasViewersIcon(mountPlayer({ fromName: 'Alice', currentType: 'vocal' }))).toBe(false)
            expect(hasViewersIcon(mountPlayer({ fromName: 'Alice', currentType: 'visio' }))).toBe(false)
        })
    })
})
