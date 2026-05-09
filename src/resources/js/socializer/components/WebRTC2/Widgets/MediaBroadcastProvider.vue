<template>
    <div>
        <slot :api="api"></slot>
    </div>
</template>

<script setup>

    import { useMediaBroadcast } from '~socializer/components/WebRTC2/Composables/useMediaBroadcast.js'
    import { onBeforeUnmount, onMounted, watch } from 'vue'

    const props = defineProps({
        // identifiant de la room de diffusion
        room: { type: String, default: null },
        // liste des utilisateurs dans la room
        users: { type: Array, required: true },
        // mode de diffusion : 'stream' (webcam) ou 'screen' (partage d’écran)
        mode: { type: String, default: 'data' },
        // callback pour la gestion des événements de connexion
        callbacks: { type: Object, default: null },
    })

    const api = useMediaBroadcast(props.mode, props.room ?? 'app')

    onMounted(() => {
       api.initialize(props.callbacks)
    })

    onBeforeUnmount(() => {
        api.cleanup()
    })

    watch(
        () => props.users,
        (newVal) => {
            api.watchUsers(newVal)
        },
        { immediate: true }
    )
</script>
