<template>
    <h1><i class="lab la-vuejs text-success"></i> Webrtc</h1>

    <!--
    Exemple d'utilisation du composant de diffusion média (MediaBroadcastProvider) avec une UI de chat simple et un dashboard de rapport
    - mode data par defaut.
    - Le MediaBroadcastProvider gère la logique de connexion, de streaming et de gestion des utilisateurs dans une room WebRTC
    - Le ChatSimpleUI affiche une interface de chat basique utilisant les fonctionnalités de data channel du WebRTC pour envoyer et recevoir des messages
    - Le Debug affiche des informations sur les connexions, les flux, etc. en temps réel
    - les callbacks passées au MediaBroadcastProvider permettent de gérer les événements de réception de données, d'ouverture et de fermeture de connexions, etc. et d'y réagir ICI 
    -->
    <MediaBroadcastProvider
        class="d-flex"
        :users="users"
        :room="room"
        :callbacks="chatDataCallbacks"
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
    - Le Debug affiche des informations sur les connexions, les flux, etc. en temps réel
    - Le StreamSimpleUI affiche les flux vidéo locaux et distants reçus via le WebRTC
     - les callbacks ne sont pas nécessaires ici car le StreamSimpleUI gère déjà en interne les événements de réception de flux et de données pour mettre à jour l'interface.
    -->
    <MediaBroadcastProvider
        class="d-flex"
        :users="users"
        :room="room"
        mode="stream"
        v-slot="webrtc">
        <Debug v-bind="webrtc" class="col-md-4 m-2"/>
        <StreamSimpleUI v-bind="webrtc" class="col-md-8 m-2"/>
    </MediaBroadcastProvider>
</template>

<script setup>
import { ref, computed, provide } from 'vue'
import { useBreadcrumbService } from '~estarter/services/BreadcrumbService.js'
import Debug from '~socializer/components/WebRTC2/Widgets/UI/Report/Debug.vue'

import MediaBroadcastProvider from '~socializer/components/WebRTC2/Widgets/Mediaplayer/MediaBroadcastProvider.vue'
import { useReverbPresence } from '~socializer/components/System/composables/useReverbChannel.js'
import { REVERB_CHANNEL } from '~socializer/components/System/system.config.js'

import DataSimpleUI from '~socializer/components/WebRTC2/Exemples/DataSimpleUI.vue'

import ChatSimpleUI from '~socializer/components/WebRTC2/Exemples/ChatSimple/ChatSimpleUI.vue'
import { useChatSimple } from '~socializer/components/WebRTC2/Exemples/ChatSimple/useChatSimple.js'

import StreamSimpleUI from '~socializer/components/WebRTC2/Exemples/StreamSimple/StreamSimpleUI.vue'

// --- State (Reactivité) ---
const room = ref('room-test')
const channel = computed(() => 'server.53d35c4e73c2d')

// --- Services ---
// Un seul useReverbPresence pour toute la page
const reverb = useReverbPresence(channel)
const { users } = reverb
// On met le canal à disposition de tout le sous-arbre
provide(REVERB_CHANNEL, reverb)

// Remplace 'created' : en script setup, le code s'exécute à l'initialisation
useBreadcrumbService().setBreadcrumb()

const { addNewMessage } = useChatSimple(room.value)

//-----------------
// Methods 
//-----------------

// Data Callbacks
const dataCallbacks = {
    onDataReceived: (data) => {
        console.log('Data reçue du serveur :', data)
    },
    onConnectionOpen: (conn) => {
        console.log('connection data ouverte')
    },
    onConnectionClose: (conn) => {
        console.log('connection data fermée')
    }
}

// Chat Callbacks
const handleChatData = (data) => {
    // Ici, on reçoit une data du serveur (via Echo), et on l'ajoute au chat local
    addNewMessage(data)
}

const handleChatOpen = (conn) => {
    console.log('connection data chat ouverte dans chat')
}

const handleChatClose = (conn) => {
    console.log('connection data chat fermée dans chat')
}

const chatDataCallbacks = {
    onDataReceived: handleChatData,
    onConnectionOpen: handleChatOpen,
    onConnectionClose: handleChatClose
}
</script>