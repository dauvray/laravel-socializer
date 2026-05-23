<template>
    <h1><i class="lab la-vuejs text-success"></i> Webrtc</h1>

    <!--
    Exemple d'utilisation du composant de diffusion média (MediaBroadcastProvider) avec une UI de chat simple et un dashboard de rapport
    - mode data par defaut.
    - Le MediaBroadcastProvider gère la logique de connexion, de streaming et de gestion des utilisateurs dans une room WebRTC
    - Le ChatSimpleUI affiche une interface de chat basique utilisant les fonctionnalités de data channel du WebRTC pour envoyer et recevoir des messages
    - Le DashBoard affiche des informations sur les connexions, les flux, etc. en temps réel
    - les callbacks passés au MediaBroadcastProvider permettent de gérer les événements de réception de données, d'ouverture et de fermeture de connexions, etc. et d'y réagir dans l'UI (ici, on ajoute les messages reçus au chat local)
    -->
    <MediaBroadcastProvider
        class="d-flex"
        :users="chatters"
        :room="room"
        :callbacks="dataCallbacks"
        :options="{
            topology: 'star',
            hubSlug: 'admin'
        }" 
        v-slot="webrtc">
        <Debug v-bind="webrtc" class="col-md-4 m-2" />
        <ChatSimpleUI v-bind="webrtc" class="col-md-8 m-2" />
    </MediaBroadcastProvider>

    <!--
    Exemple d'utilisation du composant de diffusion média (MediaBroadcastProvider) en mode stream avec une UI de dashboard et de flux simple
    - mode stream.
    - Le MediaBroadcastProvider gère la logique de connexion, de streaming et de gestion des utilisateurs dans une room WebRTC
    - Le DashBoard affiche des informations sur les connexions, les flux, etc. en temps réel
    - Le StreamSimpleUI affiche les flux vidéo locaux et distants reçus via le WebRTC
     - les callbacks ne sont pas nécessaires ici car le StreamSimpleUI gère déjà en interne les événements de réception de flux et de données pour mettre à jour l'interface.
    -->
    <MediaBroadcastProvider
        :users="chatters"
        :room="room"
        mode="stream"
        v-slot="webrtc">
        <Debug v-bind="webrtc" />
        <StreamSimpleUI v-bind="webrtc"/>
    </MediaBroadcastProvider>

</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useBreadcrumbService } from '~estarter/services/BreadcrumbService.js'
import MediaBroadcastProvider from '~socializer/components/WebRTC2/Widgets/Mediaplayer/MediaBroadcastProvider.vue'
import ChatSimpleUI from '~socializer/components/WebRTC2/Exemples/ChatSimple/ChatSimpleUI.vue'
import { useChatSimple } from '~socializer/components/WebRTC2/Exemples/ChatSimple/useChatSimple.js'
import Debug from '~socializer/components/WebRTC2/Widgets/UI/Report/Debug.vue'

import StreamSimpleUI from '~socializer/components/WebRTC2/Exemples/StreamSimple/StreamSimpleUI.vue'

// --- State (Reactivité) ---
const room = ref('room-test')
const chatters = ref([])

// --- Hooks & Services ---
const breadcrumbService = useBreadcrumbService()
const { addNewMessage } = useChatSimple(room.value)

// --- Computed ---
const channel = computed(() => 'server.53d35c4e73c2d')
//-----------------
// Methods 
//-----------------

// data
const handleData = (data) => {
    // Ici, on reçoit une data du serveur (via Echo), et on l'ajoute au chat local
    addNewMessage(data)
}

const handleOpen = (conn) => {
    console.log('connection data chat ouverte dans chat')
}

const handleClose = (conn) => {
    console.log('connection data chat fermée dans chat')
}

const dataCallbacks = {
    onDataReceived: handleData,
    onConnectionOpen: handleOpen,
    onConnectionClose: handleClose
}

//-----------------
// Reverb
//-----------------

const initChannelEvents = () => {
    if (channel.value) {
        // On utilise Echo (assumé global ici comme dans ton exemple)
        Echo.leave(channel.value)
        Echo.join(channel.value)
            .here((users) => {
                chatters.value = users
            })
            .joining((user) => {
                chatters.value = [...chatters.value, user]
            })
            .leaving((user) => {
                chatters.value = chatters.value.filter(item => user.id !== item.id)
            })
            .error((error) => {
                console.error(error)
            })
    }
}

// --- Lifecycle Hooks ---

// Remplace 'created' : en script setup, le code s'exécute à l'initialisation
breadcrumbService.setBreadcrumb()

onMounted(() => {
    initChannelEvents()
})

onBeforeUnmount(() => {
    if (channel.value) {
        Echo.leave(channel.value)
    }
})
</script>