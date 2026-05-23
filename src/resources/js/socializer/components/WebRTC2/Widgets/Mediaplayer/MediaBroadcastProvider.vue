<template>
    <div>
        <slot :api="api"></slot>
    </div>
</template>

<script setup>

    import { useMediaBroadcast } from '~socializer/components/WebRTC2/Composables/useMediaBroadcast.js'
    import { onBeforeUnmount, onMounted, watch, provide } from 'vue'
    import { WEBRTC_API_KEY } from '~socializer/components/WebRTC2/webrtc2.config.js'

    const props = defineProps({
        // identifiant de la room de diffusion
        room: { type: String, default: null },
        // liste des utilisateurs dans la room
        users: { type: Array, required: true },
        // mode de diffusion : 'stream' (webcam) ou 'screen' (partage d’écran)
        mode: { type: String, default: 'data' },
        // callback pour la gestion des événements de connexion
        callbacks: { type: Object, default: null },
        // options de configuration pour la diffusion
        options: { type: Object, default: () => ({
            topology: 'mesh', // topologie de diffusion : 'mesh' (pair à pair), 'star' (étoile) ou 'sfu' (serveur de diffusion)
            hubSlug: null, // slug du hub de diffusion (si topologie 'star', qui joue le role de centralisateur des connexions)
        })},
    })

    const api = useMediaBroadcast(props.mode, props.room ?? 'app', props.options)
    // 👇 on rend api accessible à tous les descendants
    provide(WEBRTC_API_KEY, api)

    onMounted(() => {
        // Si on veut avoir la main sur les callbacks et gerer les évenements depuis le parent
        // on initialise l'api avec les callbacks passés en props
        // sinon, on laisse l'enfant gérer les événements de connexion et de flux (ex: StreamSimpleUI) 
        // et on n'initialise pas l'api ici (car elle sera initialisée dans le composant enfant qui reçoit les flux)
       if(props.callbacks) {
            api.initialize(props.callbacks)
       }
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
