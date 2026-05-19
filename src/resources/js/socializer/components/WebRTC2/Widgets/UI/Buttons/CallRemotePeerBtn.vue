<template>
    <button
        type="button" 
        class="btn btn-primary btn-sm" 
        :disabled="isInCall"
        :title="`Appel ${type}`"
        @click="onCallUser">
        <IconWidget :icon="callIcon"></IconWidget>
    </button>
</template>

<script setup>
    /**
     * Use the global notification component system
     */

    import { ref, computed, inject, onMounted, onBeforeUnmount } from 'vue'
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'

    const props = defineProps({
        user: {
            type: Object,
            required: true
        },
        type: {
            type: String,
            default: 'visio'
        }
    })

    const AWN = inject('AWN')
    const eventBus = inject('eventBus')

    const isInCall = ref(false)

    const callIcon = computed(() => {
        if(props.type === 'vocal') {
            return isInCall.value ? 'phone-slash' : 'phone'
        }
        return isInCall.value ? 'video-slash' : 'video'
    })

    const onCloseCall = (users) => {
        if (!Array.isArray(users) || users.length === 0) return
        const shouldReset = users.some((user) => {
            if (!user || user.userSlug !== props.user.slug) return false

            const eventType = user.type || null
            if (!eventType) return true

            return eventType === props.type
        })

        if (shouldReset) {
            isInCall.value = false
        }
    }

    const onCallUser = () => {
        eventBus.$emit('call-user', props.user.slug, props.type)
        AWN.info(`Appel ${props.user.slug}`)
        isInCall.value = true
    }

    onMounted(() => {
        eventBus.$on('close-call', onCloseCall)
    })

    onBeforeUnmount(() => {
        eventBus.$off('close-call', onCloseCall)
    })
</script>