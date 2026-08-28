<template>
    <div>
        <slot :api="api"></slot>
    </div>
</template>

<script setup>
    import { onBeforeUnmount, onMounted, watch, provide, inject } from 'vue'
    import { WEBRTC_API_KEY } from '~socializer/components/WebRTC2/webrtc2.config.js'
    import { REVERB_CHANNEL } from '~socializer/components/System/system.config.js'
    import { useMediaBroadcast } from '~socializer/components/WebRTC2/Composables/useMediaBroadcast.js'

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
            videoContainer: '#videoContainer', // conteneur HTML pour l'affichage des flux vidéo
        })},
    })

    // Canal de présence Reverb de la page, s'il y en a un — c'est le SEUL `inject` de la
    // chaîne WebRTC2, et il est ici parce qu'ici seulement on est dans un composant.
    //
    // Optionnel par contrat (même geste que `useChatSimple`) : sans lui, tout continue de
    // fonctionner à l'identique, seule l'annonce de diffusion par whisper est muette. Un
    // hôte qui veut cette annonce fournit son canal — `provide(REVERB_CHANNEL, reverb)`,
    // cf. `Exemples/Home.vue`, un `useReverbPresence` pour toute la page.
    const reverb = inject(REVERB_CHANNEL, null)

    // Initialisation de l'API de diffusion média avec les paramètres de room, mode et options
    const api = useMediaBroadcast(props.mode, props.room ?? 'app', props.options, { reverb })
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

    // Cleanup à la destruction du composant : fermeture des connexions, arrêt des flux, etc.
    onBeforeUnmount(() => {
        api.cleanup()
    })

    // Watcher pour mettre à jour la liste des utilisateurs dans l'api à chaque changement de props.users
    watch(
        () => props.users,
        (newVal) => {
            api.watchUsers(newVal)
        },
        { immediate: true }
    )

    // Expose de l'API de diffusion média pour le composant parent
    defineExpose({ api })
</script>
