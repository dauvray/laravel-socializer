<template>
    <slot :api="api"></slot>
</template>

<script setup>

    import { useMediaBroadcast } from '~socializer/components/WebRTC2/Composables/useMediaBroadcast.js'
    import { onMounted, watch } from 'vue'

    // 1. Définition des Props
    const props = defineProps({
        // identifiant de la room de diffusion
        room: { type: String, default: null },
        // liste des utilisateurs dans la room
        users: { type: Array, required: true },
        // mode de diffusion : 'stream' (webcam) ou 'screen' (partage d’écran)
        mode: { type: String, default: 'stream' },
        // callback pour la gestion des événements de connexion
        callbacks: { type: Object, default: null },
    })

    // 2. Définition des Emits
    const emit = defineEmits([
        'stoped-stream', 
        'started-stream'
    ])

    // 3. Logique
    const api = useMediaBroadcast(props.mode, props.room)

//             // exemples d’émissions d’événements vers le parent (à adapter selon les besoins)
//             // les emits sont uniquement ici
//             // media.onStartedStream.value = (payload) => {
//             //     emit('started-stream', payload.type, payload.playerId)
//             // }

//             // media.onStoppedStream.value = (payload) => {
//             //     emit('stoped-stream', payload.type, payload.playerId)
//             // }

    onMounted(() => {
       api.initialize(props.callbacks)
    })

    watch(
        () => props.users,
        (newVal) => {
            if(newVal && newVal.length) {
                console.log('users changed', newVal)
                api.watchUsers(newVal)
                // api.syncUsersConnections(newVal)
            }
        },
        { immediate: true }
    )

    // Pas besoin de "return", tout est exposé au template automatiquement

    /**
     * 🖼️ MediaBroadcastProvider (UI Layer)
     *
     * 👉 gère :
     * - exposition des données au template via slot
     * - binding UI (props → composable)
     * - cycle de vie Vue (mounted, watch)
     * - communication vers le parent (emit)
     *
     * 👉 ne connaît PAS :
     * - WebRTC / PeerJS
     * - logique réseau
     * - détails d’implémentation des streams
     *
     * 👉 rôle :
     * - simple adaptateur entre Vue et la logique métier (useMediaBroadcast)
     */

</script>
