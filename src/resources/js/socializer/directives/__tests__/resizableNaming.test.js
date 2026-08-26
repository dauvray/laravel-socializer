import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import resizableHeight from '../resizable_height.js'
import resizableWidth from '../resizable_width.js'

// Ces directives sont enregistrées LOCALEMENT par chaque composant (aucun
// app.directive() dans le paquet), sous deux formes :
//   - <script setup>  : `import vResizableWidth from …`  -> liaison à la compilation
//   - Options API     : `directives: { resizableWidth }`  -> résolution AU RUNTIME,
//     Vue cherchant `resizable-width` puis son camelize `resizableWidth`.
//
// C'est cette seconde forme (ClassRoomComponent.vue, Teams.vue) qui échoue en
// SILENCE si le nom de clé et le nom de template divergent : Vue émet un
// « Failed to resolve directive » et la poignée disparaît, sans rien casser.
// D'où ces tests, qui verrouillent aussi ce que chaque suffixe promet :
// `_height` écrit une variable CSS, `_width` écrit `style.width`.

/** Simule un drag complet sur la poignée : mousedown, un mousemove, mouseup. */
const drag = (handle, from, to) => {
    handle.dispatchEvent(new MouseEvent('mousedown', { ...from, bubbles: true, cancelable: true }))
    document.dispatchEvent(new MouseEvent('mousemove', { ...to, bubbles: true }))
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
}

/** happy-dom rend des rects nuls : on les fixe pour que l'assertion soit lisible. */
const stubRect = (el, { left, right }) => {
    el.getBoundingClientRect = () => ({ left, right, top: 0, bottom: 0, width: right - left, height: 0 })
}

const handleOf = (wrapper) => wrapper.element.querySelector('div')

describe('nommage des directives de resize : le nom de template atteint la directive', () => {
    it('Options API : la clé `resizableWidth` est atteinte par `v-resizable-width` (camelize de Vue)', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const Host = defineComponent({
            directives: { resizableWidth },
            data: () => ({ lastWidth: null }),
            methods: {
                remember(width) {
                    this.lastWidth = width
                },
            },
            template: `<div class="sidebar"
                            v-resizable-width="{ min: 100, max: 600, callback: remember }"></div>`,
        })

        const wrapper = mount(Host)
        const handle = handleOf(wrapper)

        // La poignée existe = la directive a été résolue et montée.
        expect(handle).not.toBeNull()
        expect(handle.style.cursor).toBe('ew-resize')
        expect(warn.mock.calls.flat().join(' ')).not.toContain('Failed to resolve directive')

        stubRect(wrapper.element, { left: 0, right: 500 })
        drag(handle, { clientX: 500 }, { clientX: 300 })

        expect(wrapper.element.style.width).toBe('300px')
        expect(wrapper.vm.lastWidth).toBe(300)

        warn.mockRestore()
    })

    it('Options API : la clé `resizableHeight` est atteinte par `v-resizable-height`', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const Host = defineComponent({
            directives: { resizableHeight },
            template: `<div class="messenger"
                            v-resizable-height="{ min: 100, max: 600, position: 'top',
                                                  cssVarName: '--messenger-height' }"></div>`,
        })

        const wrapper = mount(Host)
        const handle = handleOf(wrapper)

        expect(handle).not.toBeNull()
        expect(handle.style.cursor).toBe('ns-resize')
        expect(warn.mock.calls.flat().join(' ')).not.toContain('Failed to resolve directive')

        warn.mockRestore()
    })
})

describe('chaque suffixe écrit bien l’axe qu’il annonce', () => {
    it('`_height` écrit la variable CSS, jamais `style.height`', () => {
        const Host = defineComponent({
            directives: { resizableHeight },
            template: `<div v-resizable-height="{ min: 100, max: 600, position: 'top',
                                                  cssVarName: '--messenger-height' }"></div>`,
        })

        const wrapper = mount(Host)
        Object.defineProperty(wrapper.element, 'offsetHeight', { value: 300, configurable: true })

        // Poignée en haut : tirer vers le haut (clientY décroissant) agrandit.
        drag(handleOf(wrapper), { clientY: 200 }, { clientY: 150 })

        expect(wrapper.element.style.getPropertyValue('--messenger-height')).toBe('350px')
        expect(wrapper.element.style.height).toBe('')
    })

    it('`_width` écrit `style.width`, pas de variable CSS, et honore `handle: left`', () => {
        const Host = defineComponent({
            directives: { resizableWidth },
            template: `<div v-resizable-width="{ min: 100, max: 600, handle: 'left' }"></div>`,
        })

        const wrapper = mount(Host)
        const handle = handleOf(wrapper)

        // Poignée à gauche : la largeur se mesure depuis le bord DROIT.
        expect(handle.style.left).toBe('0px')
        stubRect(wrapper.element, { left: 0, right: 500 })
        drag(handle, { clientX: 0 }, { clientX: 200 })

        expect(wrapper.element.style.width).toBe('300px')
        expect(wrapper.element.style.getPropertyValue('--resizable-height')).toBe('')
    })
})
