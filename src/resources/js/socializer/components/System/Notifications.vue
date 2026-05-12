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

    <CallWebUI v-if="callInprogress"
        @stop-call="onStopCall"
    ></CallWebUI>

    <ToasterNewMessage 
        v-if="NewMessageNotification"
        :event="NewMessageNotification"
        @closed="NewMessageNotification = null"
    ></ToasterNewMessage>

</template>

<script>

    import { mapActions, mapState } from 'pinia'
    import { ref } from 'vue'
    import { useMeStore } from '~estarter/stores/me.js'
    import { usePeer2Store } from '~socializer/stores/peers2.js'
 //   import { usePeers } from '~socializer/components/WebRTC/composables/usePeers.js'
    import { useMediaBroadcast } from '~socializer/components/WebRTC2/Composables/useMediaBroadcast.js'
    import { useConversationsStore } from '~socializer/stores/conversations.js'
    import { defineAsyncComponent } from 'vue'
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'

    export default {
        name: 'Notifications',
        inject: [
            "eventBus",
        ],
        components: {
            AlertComponent: defineAsyncComponent(() => import('~socializer/components/System/widgets/AlertComponent.vue')),
            CallWebUI: defineAsyncComponent(() => import('~socializer/components/System/widgets/CallWebUI.vue')),
            ToasterNewMessage: defineAsyncComponent(() => import('~socializer/components/System/widgets/ToasterNewMessage.vue')),
            IconWidget,
        },
        setup() {

            const notificationComponent = ref(null)
            const notificationComponentProps = ref(null)
            const NewMessageNotification= ref(null)
            const queueProcesing = ref(false)
            const currentCallUsers = ref([])

            // bientot inutile
            const peers = useMediaBroadcast()
        
            return {
                ...peers,

                notificationComponent,
                notificationComponentProps,
                NewMessageNotification,
                queueProcesing,
                currentCallUsers,
            }
        },
        watch: {
            userChannel(value) {
                if(value) {
                    this.initUserChannel()
                }
            },
            me(value) {
                if(value) {
                    this.setOnlineStatus() 
                }
            },
        },
        computed : {
            ...mapState(useMeStore, {
                me: 'getMe',
            }),
            userChannel: function() {
                if(this.me) {
                    return this.me.channel
                }
            }
        },
        async mounted() {
            // TODO : revoir toute la logique de ce composant, elle est devenue un peu le fourre-tout de tout ce qui concerne les notifications et la communication avec les autres composants (via eventBus) et les autres utilisateurs (via Echo), il faudrait peut-être la scinder en plusieurs composants plus spécialisés
            // const visioCallCallback = await import(`~socializer/callbacks/visioPlayerCallback.js`)
            // const visioPlayerDataCallback = await import(`~socializer/callbacks/visioPlayerDataCallback.js`)
            // this.setLocalVideoPeer(this, visioCallCallback.default)
            // this.setLocalDataPeer(this, visioPlayerDataCallback.default)

            // this.eventBus.$on('call-user', this.onStartCall)
            
            setInterval(() => { 
                this.setOnlineStatus() 
            }, 120000) // every 2 minutes
        },
        unmounted() {
            Echo.leave(this.userChannel)
            this.eventBus.$off('call-user', this.onStartCall)
        },
        methods: {
            ...mapActions(useConversationsStore, [
                'addConversation',
            ]),
            ...mapActions(useMeStore, [
                'addUnreadNotifications',
            ]),
            ...mapActions(usePeer2Store, [
                'dispatchSignal',
            ]),
            initUserChannel() {
                if(this.userChannel) {
                    Echo.leave(this.userChannel)
                    Echo.private(this.userChannel)
                        // laravel notifications
                        .notification((evt) => {
                           this.addUnreadNotifications(1)
                        })
                        // display alerts to user
                        .listen('.AlertToUser', (event) => {
                            this.notificationComponentProps = event
                            this.notificationComponent = 'AlertComponent'
                        })
                        // connect to caller user and send localPeerId
                        .listen('.AskToPeerID', (event) => { 
                            this.dispatchSignal({ 
                                emitter: 'Notifications',
                                roomId: `${event.type}-${event.room}`,
                                type: 'PEER_CONNECTION_REQUEST', 
                                payload: { fromUserSlug: event.fromUserSlug, type: event.type, room: event.room }
                            })
                        })
                        // receive remotePeerId and connect to called user
                        .listen('.ResponseToPeerID', (event) => {
                            this.dispatchSignal({ 
                                emitter: 'Notifications',
                                roomId: `${event.type}-${event.room}`,
                                type: 'PEER_CONNECT_TO_REMOTE_PEER', 
                                payload: { peerId: event.peerId, userSlug: event.fromUserSlug, type: event.type, room: event.room }
                            })
                        })
                        // receive authorization to peer connection
                        .listen('.ResponseToAuthorizationPeer', (event) => {
                            // store response connection
                            this.updateCurrentRoom(event.options.room)
                            this.updateCurrentType(event.options.type)
                            this.receiveAuthorizationRemotePeerId(event)
                        })
                        .listen('.CloseConnectionToPeerID', (event) => {
                            this.closeRemotePeerId(event.fromUserSlug, event.type, event.room)
                        })
                        .listen('.ChatInvitation', (event) => {
                            this.addConversation(event)
                            AWN.info('Vous avez été invité dans une nouvelle conversation', {durations: {info: 0}})
                        })
                        .listen('.NewChatMessageNotification', (event) => {
                            this.NewMessageNotification = event
                        })
                        // Eventbus for components
                        .listen('.EventBusNotification', (event) => {
                            this.eventBus.$emit(event.type, event.payload)
                        });
                }
            },
            onResponseAlert(fromUserSlug, options, status) {

                this.notificationComponent = null

                if(status) {
                    this.updateCurrentRoom(options.room)
                    this.updateCurrentType(options.type)
                   
                    setTimeout(() => {
                        this.sendAuthorizationRemotePeerId(
                            fromUserSlug, 
                            {
                                ...options, 
                                peerId : this.localPeerId
                            },
                            true
                        )
                    }, 300)

                } else {
                    this.sendAuthorizationRemotePeerId(
                        fromUserSlug, 
                        {},
                        false
                    )
                }
            },
            setOnlineStatus() {
                Echo.private(this.me.channel).whisper('ping', {
                    timestamp: Date.now(),
                    userId: this.me.id,
                });
            },
            // ne doit pas etre ici.
            onStopCall() {
                this.stopAllVisioStream('visio')
                this.eventBus.$emit('close-call', this.currentCallUsers)
            },
            onStartCall(userSlug, type) {
                this.currentCallUsers.push({
                    userSlug: userSlug,
                    type: type,
                })
                this.getAuthorizationRemotePeerId(userSlug, type)
            },
        }
    }
</script>

