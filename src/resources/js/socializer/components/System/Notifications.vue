<template>
    <Teleport to="body">
        <div id="videoContainer"></div>
        <component
            id="notification-component-wrapper"
            v-if="notificationComponent"
            :is="notificationComponent"
            v-bind="notificationComponentProps"
            @response-alert="onResponseAlert"
        ></component>
    </Teleport>

    <CallManagerBtn
        v-if="callStatus !== 'idle'"
        :status="callStatus"
        @stop-call="onStopCall"
    ></CallManagerBtn>

    <ToasterNewMessage
        v-if="NewMessageNotification"
        :event="NewMessageNotification"
        @closed="NewMessageNotification = null"
    ></ToasterNewMessage>
</template>

<script setup>
// VUE & LIBS
import { ref, computed, watch, onMounted, onUnmounted, inject, defineAsyncComponent } from 'vue'
import { storeToRefs } from 'pinia'

// STORES
import { useMeStore } from '~estarter/stores/me.js'
import { usePeer2Store } from '~socializer/stores/peers2.js'
import { useConversationsStore } from '~socializer/stores/conversations.js'

// COMPOSABLES
import { useMediaBroadcast } from '~socializer/components/WebRTC2/Composables/useMediaBroadcast.js'
import { useReverbChannel } from '~socializer/components/System/composables/useReverbChannel.js'

// COMPOSANTS ASYNCHRONES
const AlertComponent = defineAsyncComponent(() =>import('~socializer/components/System/widgets/AlertComponent.vue'))
const CallManagerBtn = defineAsyncComponent(() =>import('~socializer/components/WebRTC2/Widgets/UI/Buttons/CallManagerBtn.vue'))
const ToasterNewMessage = defineAsyncComponent(() =>import('~socializer/components/System/widgets/ToasterNewMessage.vue'))

// Inject
const eventBus = inject('eventBus')

// Stores
const meStore = useMeStore()
const peerStore = usePeer2Store()
const conversationsStore = useConversationsStore()

// On garde la réactivité des getters avec storeToRefs
const { getMe: me } = storeToRefs(meStore)
// Actions : destructuration directe (pas besoin de storeToRefs)
const { addUnreadNotifications } = meStore
const { dispatchSignal } = peerStore
const { addConversation } = conversationsStore

// Composable
const peers = useMediaBroadcast()

// State local
const notificationComponent = ref(null)
const notificationComponentProps = ref(null)
const NewMessageNotification = ref(null)
const heartbeatIntervalId = ref(null)

// Computed
const userChannel = computed(() => me.value?.channel)
const callStatus = computed(() => peers.callStatus())

const { whisper: whisperPing } = useReverbChannel(userChannel, {
    type: 'private',
    // Laravel notifications
    onNotification: () => {
        addUnreadNotifications(1)
    },
    listeners: {
        // display alerts to user
        '.AlertToUser': (event) => {
            if (peers.isInviteDuplicate(event?.options?.inviteId)) return
            notificationComponentProps.value = event
            notificationComponent.value = AlertComponent
        },

        // connect to caller user and send localPeerId
        '.AskToPeerID': (event) => {
            dispatchSignal({
                emitter: 'Notifications',
                roomId: `${event.type}-${event.room}`,
                type: 'PEER_CONNECTION_REQUEST',
                payload: event,
            })
        },

        // receive remotePeerId and connect to called user
        '.ResponseToPeerID': (event) => {
            dispatchSignal({
                emitter: 'Notifications',
                roomId: `${event.type}-${event.room}`,
                type: 'PEER_CONNECT_TO_REMOTE_PEER',
                payload: event,
            })
        },

        // receive authorization to peer connection
        '.ResponseToAuthorizationPeer': async (event) => {
            peers.stopCallInviteRetry(event?.options?.inviteId)

            if (!event.status) {
                window.AWN.info(`${event.fromUserSlug} est injoignable`)
                eventBus.$emit('close-call', [
                    { userSlug: event.fromUserSlug, type: event?.options?.type || 'visio' },
                ])
                return
            }
            await peers.openCallBetweenPeer({
                ...event,
                options: { ...event.options },
            })
        },

        '.CloseConnectionToPeerID': (event) => {
            peers.remoteStopCall(event)
        },

        '.ChatInvitation': (event) => {
            addConversation(event)
            AWN.info('Vous avez été invité dans une nouvelle conversation', {
                durations: { info: 0 },
            })
        },

        '.NewChatMessageNotification': (event) => {
            NewMessageNotification.value = event
        },

        // Eventbus for components
        '.EventBusNotification': (event) => {
            eventBus.$emit(event.type, event.payload)
        },
    },
})

// Watchers
// ⚠️ Enregistré APRÈS le composable, et c'est ce qui fait partir le ping d'ouverture de session.
// `me` est null au montage (loadMe() est asynchrone, et ce composant n'attend pas), donc la
// transition null → valeur a toujours lieu et les deux watchers y réagissent dans leur ordre de
// création. Au-dessus de l'appel, setOnlineStatus() courrait avant le join() : whisper() rendrait
// false, et l'utilisateur resterait hors ligne jusqu'au battement suivant — deux minutes, soit
// exactement le TTL Redis de la présence.
watch(me, (value) => {
    if (value) setOnlineStatus()
})

// Méthodes
async function onResponseAlert(fromUserSlug, options, status) {
    notificationComponent.value = null
    switch (options.action) {
        case 'peer-access-permission':
            await peers.acceptCallFromPeer({
                fromUserSlug,
                options: { ...options },
                status,
            })
            break
        default:
            break
    }
}

function setOnlineStatus() {
    if (!me.value) return
    whisperPing('ping', {
        timestamp: Date.now(),
        userId: me.value.id,
    })
}

async function onStopCall() {
    const currentUsers = peers.currentCallUsers?.value ?? []
    const usersToStop = [...currentUsers]
    eventBus.$emit('close-call', usersToStop)
    await peers.stopCallWithPeers(usersToStop)
}

async function onStartCall(toUserSlug, type) {
    await peers.startCallWithPeer({ toUserSlug, type })
}

// Lifecycle
onMounted(() => {
    peers.initialize({
        onStreamReceived: peers.handleStreamReceived,
        onConnectionClose: peers.handleStreamRemoved,
    })

    eventBus.$on('call-user', onStartCall)

    heartbeatIntervalId.value = setInterval(() => {
        setOnlineStatus()
    }, 120000) // toutes les 2 minutes
})

onUnmounted(async () => {
    try {
        const currentUsers = peers.currentCallUsers?.value ?? []
        if (currentUsers.length > 0 || peers.isCallInProgress()) {
            await peers.stopCallWithPeers([...currentUsers], false)
        }
    } finally {
        // Le canal privé personnel est libéré au compteur par useReverbChannel : pas d'Echo.leave()
        // ici, il couperait les autres composants qui le tiennent encore.
        eventBus.$off('call-user', onStartCall)

        peers.clearAllCallInviteRetries()
        peers.clearSeenInvites()

        clearInterval(heartbeatIntervalId.value)
        heartbeatIntervalId.value = null
    }
})
</script>
