/**
 * LocalCaptureBtn.test.js
 *
 * Le bouton de partage d'écran : deux états mutuellement exclusifs, un événement chacun.
 *
 * Le composant est multi-racine (deux `<button>` frères sous `v-if`/`v-else`, sans wrapper) :
 * ses classes ne sont donc pas celles d'un `wrapper.classes()` unique, et c'est le bouton
 * rendu qu'il faut interroger.
 *
 * ⚠️ **Ce bouton parle kebab-case (`start-stream`, `stop-stream`) alors que son frère
 * `LocalStreamBtn` parle snake_case (`start_video`, `toggle_audio`).** Les deux conventions
 * ne se croisent qu'à un seul endroit — `GroupLocalStreamBtn`, qui câble les deux — et c'est
 * ce qui rend l'écart supportable. Le dernier cas l'épingle littéralement : un renommage
 * « pour homogénéiser » qui n'irait pas jusqu'au parent casserait le partage d'écran en
 * silence, aucun des deux composants ne levant d'erreur sur un événement jamais écouté.
 *
 * ── CONTRÔLES DE HARNAIS (convention du paquet), mesurés le 2026-08-30 ────────
 *
 *    1. `v-if="!isCapturing"` inversé ..................................... 6 cas
 *    2. `start-stream` renommé en `startStream` ........................... 2 cas
 *    3. `stop-stream` renommé en `stopStream` ............................. 2 cas
 *
 * Les n° 2 et 3 sont mesurés séparément : un seul des deux renommages est le cas réel d'une
 * homogénéisation partielle, et c'est celui qu'un contrôle groupé masquerait.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import LocalCaptureBtn from '~socializer/components/WebRTC2/Widgets/UI/Buttons/LocalCaptureBtn.vue'

const monter = (isCapturing = false) => mount(LocalCaptureBtn, { props: { isCapturing } })

const bouton = (wrapper) => wrapper.get('button')

describe('LocalCaptureBtn — partage d\'écran', () => {

    it('hors partage, propose de partager son écran', () => {
        const wrapper = monter(false)

        expect(bouton(wrapper).classes()).toContain('btn-primary')
        expect(wrapper.find('.la-tv').exists()).toBe(true)
        expect(wrapper.text()).toContain('Partage')
    })

    it('en partage, propose d\'arrêter', () => {
        const wrapper = monter(true)

        expect(bouton(wrapper).classes()).toContain('btn-danger')
        expect(wrapper.find('.la-window-close').exists()).toBe(true)
        expect(wrapper.text()).toContain('Arrêter partage')
    })

    it('⭐ les deux états ne coexistent jamais', () => {
        // Un seul bouton dans le DOM, quel que soit l'état : c'est ce qui interdit à
        // l'utilisateur de « démarrer » un partage déjà en cours.
        expect(monter(false).findAll('button')).toHaveLength(1)
        expect(monter(true).findAll('button')).toHaveLength(1)

        expect(monter(false).find('.la-window-close').exists()).toBe(false)
        expect(monter(true).find('.la-tv').exists()).toBe(false)
    })

    it('le clic démarre le partage, et rien d\'autre', async () => {
        const wrapper = monter(false)

        await bouton(wrapper).trigger('click')

        expect(wrapper.emitted('start-stream')).toHaveLength(1)
        expect(wrapper.emitted('stop-stream')).toBeUndefined()
    })

    it('le clic arrête le partage, et rien d\'autre', async () => {
        const wrapper = monter(true)

        await bouton(wrapper).trigger('click')

        expect(wrapper.emitted('stop-stream')).toHaveLength(1)
        expect(wrapper.emitted('start-stream')).toBeUndefined()
    })

    it('⭐ ce bouton parle kebab-case, son frère LocalStreamBtn parle snake_case', async () => {
        // Épinglage littéral d'un écart assumé. `GroupLocalStreamBtn` est le SEUL endroit du
        // dépôt où les deux vocabulaires se croisent — il câble `@start-stream` ici et
        // `@start_video` là. Renommer d'un seul côté n'émet aucune erreur : Vue ne se plaint
        // pas d'un événement que personne n'écoute.
        const demarrage = monter(false)
        await bouton(demarrage).trigger('click')
        expect(Object.keys(demarrage.emitted())).toContain('start-stream')
        expect(Object.keys(demarrage.emitted())).not.toContain('start_stream')

        const arret = monter(true)
        await bouton(arret).trigger('click')
        expect(Object.keys(arret.emitted())).toContain('stop-stream')
        expect(Object.keys(arret.emitted())).not.toContain('stop_stream')
    })
})
