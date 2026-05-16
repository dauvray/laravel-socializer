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

    <CallWebUI v-if="isCallInProgress()"
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

            const heartbeatIntervalId = ref(null)
            const peers = useMediaBroadcast()
        
            return {
                ...peers,
                notificationComponent,
                notificationComponentProps,
                NewMessageNotification,
                queueProcesing,
                heartbeatIntervalId,
            }
        },
        data() {
            return {
                remoteStreamsMap: new Map(),
                isStoppingCall: false,
                closingUsers: new Set(),
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
            remoteStreams() {
                return Array.from(this.remoteStreamsMap.values())
            },
        },

        async mounted() {
            this.initialize({
                onStreamReceived: this.handleStreamReceived,
                onConnectionClose: this.handleStreamClose
            })

            this.eventBus.$on('call-user', this.onStartCall)
            
            this.heartbeatIntervalId = setInterval(() => { 
                this.setOnlineStatus() 
            }, 120000) // every 2 minutes
        },

        async unmounted() {
            try {
                if (this.currentCallUsers.length > 0 || this.isCallInProgress()) {
                    await this.stopCallWithPeers([...this.currentCallUsers], false, {
                        mode: 'full',
                       roomId: this.currentCallRoomId,
                    })
                }
            } finally {
                this.cleanup()
                Echo.leave(this.userChannel)
                this.eventBus.$off('call-user', this.onStartCall)
                clearInterval(this.heartbeatIntervalId)
                this.heartbeatIntervalId = null
                this.resetCallState()
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
            addCallUser(userSlug, type = 'visio') {
                return this.addCurrentCallUser(userSlug, type)
            },
            removeCallUser(userSlug) {
                if (!userSlug) return
                this.removeCurrentCallUser(userSlug)
            },
            ensureCallRoomId(preferred = null) {
                return this.ensureCurrentCallRoomId(preferred)
            },
            resetCallState() {
                this.cleanupCallPlayers()
                this.setCallInProgress(false)
                this.clearCurrentCallUsers()
                this.setCurrentCallRoomId(null)
                this.remoteStreamsMap.clear()
                this.isStoppingCall = false
                this.closingUsers.clear()
            },
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
                                this.removeCallUser(event.fromUserSlug)

                                if (this.currentCallUsers.length === 0) {
                                    await this.stopCallWithPeers([], false, {
                                        mode: 'full',
                                         roomId: this.currentCallRoomId || event?.options?.room || null,
                                    })
                                    this.resetCallState()
                                }

                                this.eventBus.$emit('close-call', [{ userSlug: event.fromUserSlug, type: event?.options?.type || 'visio' }])
                                return
                            }

                            const roomId = this.ensureCallRoomId(event?.options?.room || null)
                            this.addCallUser(event.fromUserSlug, event.options?.type || 'visio')
                            this.setCallInProgress(true)

                            await this.openCallBetweenPeer({
                                ...event,
                                options: {
                                    ...event.options,
                                    room: roomId,
                                },
                            })
                        })
                        .listen('.CloseConnectionToPeerID', (event) => {
                           // voir utilitée
                            this.onRemoteStopCall(event)
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
                        await this.acceptCallFromPeer({
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
                if (this.isStoppingCall) return
                this.isStoppingCall = true

                const usersToStop = [...this.currentCallUsers]
                const roomId = this.currentCallRoomId

                await this.stopCallWithPeers(usersToStop, true, {
                    mode: 'full',
                    roomId,
                })

                this.eventBus.$emit('close-call', usersToStop)
                this.resetCallState()
            },
            async onStartCall(userSlug, type) {
                await this.startCallWithPeer({
                    toUserSlug: userSlug,
                    type: type || 'visio',
                })
            },            
            async onRemoteStopCall(event) {
                const remoteSlug = event?.fromUserSlug || null
                const remoteType = event?.type || 'visio'
                const roomId = event?.room || this.currentCallRoomId || null
                
                if (!remoteSlug) return
                if (this.closingUsers.has(remoteSlug)) return

                this.closingUsers.add(remoteSlug)

                await this.stopCallWithPeers([{ userSlug: remoteSlug, type: remoteType }], false, {
                    mode: 'partial',
                    roomId,
                })

                this.removeCallUser(remoteSlug)
                this.removeVideoElement(`remote-${remoteSlug}-${remoteType}`)
                this.remoteStreamsMap.forEach((value, key) => {
                    if (value?.metadata?.from === remoteSlug) {
                        this.remoteStreamsMap.delete(key)
                    }
                })

                this.eventBus.$emit('close-call', [{ userSlug: remoteSlug, type: remoteType }])

                if (this.currentCallUsers.length === 0) {
                    await this.stopCallWithPeers([], false, {
                        mode: 'full',
                        roomId,
                    })
                    this.resetCallState()
                }

                this.closingUsers.delete(remoteSlug)
            },
            cleanupCallPlayers() {
                const renderedPlayers = Array.isArray(this.players) ? [...this.players] : []

                renderedPlayers.forEach((player) => {
                    if (!player?.videoId) return

                    // Nettoie uniquement les players d'appel (local et remote)
                    if (player.videoId === 'local-webcam' || player.videoId.startsWith('remote-')) {
                        this.removeVideoElement(player.videoId)
                    }
                })
            },
            async handleStreamReceived(stream, conn, metadata) {
                const meta = metadata || conn?.metadata || {}
                const remoteSlug = this.resolveRemoteSlug(meta)
                const remoteType = meta?.type || conn?.metadata?.type || 'visio'

                if (!remoteSlug) return

                const streamKey = conn?.connectionId || `${remoteSlug}-${remoteType}`

                if (this.remoteStreamsMap.has(streamKey)) {
                return
                }

                this.remoteStreamsMap.set(streamKey, {
                stream,
                metadata: meta,
                remoteSlug,
                remoteType,
                })

                if (stream instanceof MediaStream) {
                this.createVideoElement(
                {
                videoId: `remote-${remoteSlug}-${remoteType}`,
                type: remoteType,
                source: 'remote',
                },
                stream
                )
                }
            },
            async handleStreamClose(conn) {
                const meta = conn?.metadata || {}
                const remoteSlug = this.resolveRemoteSlug(meta)
                const remoteType = meta?.type || 'visio'
                const roomId = meta?.room || this.currentCallRoomId || null

                if (!remoteSlug) return
                if (this.closingUsers.has(remoteSlug)) return

                this.closingUsers.add(remoteSlug)

                try {
                    const videoId = `remote-${remoteSlug}-${remoteType}`
                    this.removeVideoElement(videoId)

                    const streamKey = conn?.connectionId || `${remoteSlug}-${remoteType}`
                    this.remoteStreamsMap.delete(streamKey)

                    this.remoteStreamsMap.forEach((value, key) => {
                        if (
                            (value?.remoteSlug === remoteSlug && value?.remoteType === remoteType) ||
                            value?.metadata?.from === remoteSlug
                        ) {
                            this.remoteStreamsMap.delete(key)
                        }
                    })

                    this.removeCallUser(remoteSlug)
                    this.eventBus.$emit('close-call', [{ userSlug: remoteSlug, type: remoteType }])

                    if (this.currentCallUsers.length === 0) {
                        await this.stopCallWithPeers([], false, {
                            mode: 'full',
                            roomId,
                        })
                        this.resetCallState()
                    }
                } finally {
                    this.closingUsers.delete(remoteSlug)
                }
            },
            resolveRemoteSlug(metadata = {}) {
            const mySlug = this.me?.slug || null

            if (!metadata) return null

            if (metadata.from && mySlug && metadata.from !== mySlug) {
            return metadata.from
            }

            if (metadata.slug && mySlug && metadata.slug !== mySlug) {
            return metadata.slug
            }

            return metadata.from || metadata.slug || null
            },
        }
    }
</script>

