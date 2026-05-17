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

    <CallWebUI v-if="peers.isCallInProgress()"
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
    import { useMediaBroadcast } from '~socializer/components/WebRTC2/Composables/useMediaBroadcast.js'
    import { useConversationsStore } from '~socializer/stores/conversations.js'
    import { defineAsyncComponent } from 'vue'

    export default {
        name: 'Notifications',
        inject: [
            "eventBus",
        ],
        components: {
            AlertComponent: defineAsyncComponent(() => import('~socializer/components/System/widgets/AlertComponent.vue')),
            CallWebUI: defineAsyncComponent(() => import('~socializer/components/System/widgets/CallWebUI.vue')),
            ToasterNewMessage: defineAsyncComponent(() => import('~socializer/components/System/widgets/ToasterNewMessage.vue')),
        },
        setup() {
            const notificationComponent = ref(null)
            const notificationComponentProps = ref(null)
            const NewMessageNotification= ref(null)
            const heartbeatIntervalId = ref(null)
            const peers = useMediaBroadcast()
        
            return {
                peers: {...peers},
                notificationComponent,
                notificationComponentProps,
                NewMessageNotification,
                heartbeatIntervalId,
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
            ...mapState(usePeer2Store, {
                players: 'getPlayers',
            }),
            userChannel: function() {
                if(this.me) {
                    return this.me.channel
                }
            },
        },

        async mounted() {
            this.peers.initialize({
                onStreamReceived: this.peers.handleStreamReceived,
                onConnectionClose: this.peers.handleStreamRemoved
            })

            this.eventBus.$on('call-user', this.onStartCall)
            
            this.heartbeatIntervalId = setInterval(() => { 
                this.setOnlineStatus() 
            }, 120000) // every 2 minutes
        },

        async unmounted() {
            try {
                const currentUsers = this.peers.currentCallUsers?.value ?? [];
                if (currentUsers.length > 0 || this.peers.isCallInProgress()) {
                    await this.peers.stopCallWithPeers([...currentUsers], false)
                }
            } finally {
                Echo.leave(this.userChannel)
                this.eventBus.$off('call-user', this.onStartCall)
                clearInterval(this.heartbeatIntervalId)
                this.heartbeatIntervalId = null
            }
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
                                payload: event
                            })
                        })
                        // receive remotePeerId and connect to called user
                        .listen('.ResponseToPeerID', (event) => {
                            this.dispatchSignal({ 
                                emitter: 'Notifications',
                                roomId: `${event.type}-${event.room}`,
                                type: 'PEER_CONNECT_TO_REMOTE_PEER', 
                                payload: event
                            })
                        })
                        // receive authorization to peer connection
                        .listen('.ResponseToAuthorizationPeer', async (event) => {
                            if (!event.status) {
                                window.AWN.info(`${event.fromUserSlug} est injoignable`)
                                this.eventBus.$emit('close-call', [{ userSlug: event.fromUserSlug, type: event?.options?.type || 'visio' }])
                                return
                            }
                            await this.peers.openCallBetweenPeer({
                                ...event,
                                options: {
                                    ...event.options,
                                },
                            })
                        })
                        .listen('.CloseConnectionToPeerID', (event) => {
                            this.peers.remoteStopCall(event)
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
            async onResponseAlert(fromUserSlug, options, status) {
                this.notificationComponent = null
                switch (options.action) {
                    case 'peer-access-permission': {
                        await this.peers.acceptCallFromPeer({
                            fromUserSlug,
                            options: {
                                ...options,
                            },
                            status,
                        })
                        break
                    }
                    default:
                        break
                }
            },
            setOnlineStatus() {
                Echo.private(this.me.channel).whisper('ping', {
                    timestamp: Date.now(),
                    userId: this.me.id,
                });
            },
            async onStopCall() {
                const currentUsers = this.peers.currentCallUsers?.value ?? [];
                const usersToStop = [...currentUsers];
                this.eventBus.$emit('close-call', usersToStop)
                await this.peers.stopCallWithPeers(usersToStop)
            },
            async onStartCall(toUserSlug, type) {
                await this.peers.startCallWithPeer({toUserSlug, type})
            },            
        }
    }
</script>

