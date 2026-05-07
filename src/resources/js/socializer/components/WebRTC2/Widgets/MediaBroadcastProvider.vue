<template>
    <slot :api="api"></slot>
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

    // const emit = defineEmits([
    //     'stoped-stream', 
    //     'started-stream'
    // ])

    const api = useMediaBroadcast(props.mode, props.room ?? 'app')

    // exemples d’émissions d’événements vers le parent (à adapter selon les besoins)
    // les emits sont uniquement ici
    // api.onStartedStream.value = (payload) => {
    //     emit('started-stream', payload.type, payload.playerId)
    // }

    // api.onStoppedStream.value = (payload) => {
    //     emit('stoped-stream', payload.type, payload.playerId)
    // }

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
            // api.syncUsersConnections(newVal)
        },
        { immediate: true }
    )
</script>
