import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import { shouldShowDateSeparator } from '../utils/dateSeparator.js'

// Reproduit FIDÈLEMENT la structure du <template> de ChatComponent :
//   <template v-for="(item, idx) in messages" :key="item.id">   <- fragment keyé
//       <slot name="date-separator"> <DateSeparator v-if="..."/> </slot>
//       <slot name="message">        <MessageWidget/>            </slot>
//   </template>
const Repro = defineComponent({
    props: { messages: { type: Array, required: true } },
    methods: {
        shouldShowDateSeparator(item, idx) {
            return shouldShowDateSeparator(this.messages, idx)
        },
        dayOf(item) {
            return new Date(item.created_at).toDateString()
        },
    },
    template: `
        <div class="inner">
            <template v-for="(item, idx) in messages" :key="item.id">
                <slot name="date-separator" :date="item.created_at">
                    <div v-if="shouldShowDateSeparator(item, idx)"
                         class="date-separator" :data-id="item.id">{{ dayOf(item) }}</div>
                </slot>
                <slot name="message" :item="item">
                    <div class="msg" :data-id="item.id">{{ item.id }}</div>
                </slot>
            </template>
        </div>
    `,
})

const sameDay = (id, t) => ({ id, created_at: `2026-05-27T${t}:00` })
const prevDay = (id, t) => ({ id, created_at: `2026-05-26T${t}:00` })

const sepIds = (w) => w.findAll('.date-separator').map(s => s.attributes('data-id'))

describe('rendu du séparateur de date après pagination (prepend) — template fidèle', () => {
    it('même jour préfixé : le séparateur reste dans le flux (relocalisé sur le nouveau 1er message)', async () => {
        const wrapper = mount(Repro, {
            props: { messages: [sameDay('T1', '09'), sameDay('T2', '10'), sameDay('T3', '11')] },
        })
        expect(sepIds(wrapper)).toEqual(['T1'])

        await wrapper.setProps({
            messages: [sameDay('T0a', '07'), sameDay('T0b', '08'),
                       sameDay('T1', '09'), sameDay('T2', '10'), sameDay('T3', '11')],
        })
        await nextTick()
        expect(sepIds(wrapper)).toEqual(['T0a'])  // toujours présent, jamais 0
    })

    it('jour différent préfixé : un séparateur par jour', async () => {
        const wrapper = mount(Repro, {
            props: { messages: [sameDay('T1', '09'), sameDay('T2', '10')] },
        })
        await wrapper.setProps({
            messages: [prevDay('Y1', '20'), prevDay('Y2', '21'), sameDay('T1', '09'), sameDay('T2', '10')],
        })
        await nextTick()
        expect(sepIds(wrapper)).toEqual(['Y1', 'T1'])
    })

    it('prepends successifs : jamais zéro séparateur', async () => {
        const wrapper = mount(Repro, { props: { messages: [sameDay('T1', '09')] } })
        expect(sepIds(wrapper).length).toBe(1)
        await wrapper.setProps({ messages: [sameDay('A', '07'), sameDay('T1', '09')] })
        await nextTick()
        expect(sepIds(wrapper).length).toBe(1)
        await wrapper.setProps({ messages: [sameDay('B', '05'), sameDay('A', '07'), sameDay('T1', '09')] })
        await nextTick()
        expect(sepIds(wrapper).length).toBe(1)
    })
})
