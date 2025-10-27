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
    import { usePeers } from '~socializer/components/WebRTC/composables/usePeers.js'
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

            // ne rien supprimer ici, le context est utilisé dans les callbacks de certains composants

            const {
                sendLocalPeerId,
                getAuthorizationRemotePeerId,
                closeRemotePeerId,
                sendAuthorizationRemotePeerId,
                receiveAuthorizationRemotePeerId,
                setLocalVideoPeer,
                setLocalDataPeer,
                storeConnection,
                createVideoElement,
                connectToQueuedConnections,
                removeVideoElement,
                deleteRemoteOpenedConnections,
                startVisioStream,
                stopUserVisioStream,
                stopAllVisioStream,
                currentStream,
                updateCurrentRoom,
                updateCurrentType,
                localPeerId,
                localPeer,
                connections,
                onResponseCallError,
                callInprogress,
                setCallInProgress,
                setCurrentCallRoomId,
                saveRemoteStream,
                removeRemoteStream,

            } = usePeers()

            const notificationComponent = ref(null)
            const notificationComponentProps = ref(null)
            const NewMessageNotification= ref(null)
            const queueProcesing = ref(false)
            const currentCallUsers = ref([])
        
            return {
                sendLocalPeerId,
                getAuthorizationRemotePeerId,
                closeRemotePeerId,
                sendAuthorizationRemotePeerId,
                receiveAuthorizationRemotePeerId,
                notificationComponent,
                notificationComponentProps,
                setLocalVideoPeer,
                setLocalDataPeer,
                storeConnection,
                createVideoElement,
                removeVideoElement,
                deleteRemoteOpenedConnections,
                startVisioStream,
                stopUserVisioStream,
                stopAllVisioStream,
                currentStream,
                updateCurrentRoom,
                updateCurrentType,
                localPeerId,
                localPeer,
                connections,
                onResponseCallError,
                callInprogress,
                setCallInProgress,
                setCurrentCallRoomId,
                NewMessageNotification,
                connectToQueuedConnections,
                queueProcesing,
                currentCallUsers,
                saveRemoteStream,
                removeRemoteStream,
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
            const visioCallCallback = await import(`~socializer/callbacks/visioPlayerCallback.js`)
            const visioPlayerDataCallback = await import(`~socializer/callbacks/visioPlayerDataCallback.js`)
            this.setLocalVideoPeer(this, visioCallCallback.default)
            this.setLocalDataPeer(this, visioPlayerDataCallback.default)

            this.eventBus.$on('call-user', this.onStartCall)
            
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
                            // store request connection
                            this.sendLocalPeerId(event.fromUserSlug, event.type, event.room)
                        })
                        // receive remotePeerId and connect to called user
                        .listen('.ResponseToPeerID', (event) => {
                            // store response connection
                            this.connectToQueuedConnections({
                                peerId: event.peerId, 
                                userSlug: event.fromUserSlug, 
                                type: event.type, 
                                room: event.room 
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

