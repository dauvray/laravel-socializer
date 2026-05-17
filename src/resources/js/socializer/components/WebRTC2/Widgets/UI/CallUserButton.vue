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
        console.log('users', users)
        if(users.find(user => user.userSlug === props.user.slug && user.type === props.type)) {
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