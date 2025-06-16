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

    <button type="button" class="btn btn-outline-primary position-relative me-4">
        <IconWidget icon="comment-dots"></IconWidget>
        <span class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger">
            {{ totalNotification }}
            <span class="visually-hidden">Notification</span>
        </span>
    </button>
</template>

<script>

    import { mapActions, mapState } from 'pinia'
    import { ref } from 'vue'
    import { useMeStore } from '~estarter/stores/me.js'
    import { usePeers } from '~socializer/components/WebRTC/composables/usePeers.js'
    import { useConversationsStore } from '~socializer/stores/conversations.js'
    import { defineAsyncComponent } from 'vue'
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'

    const visioCallCallback = import(`~socializer/callbacks/visioPlayerCallback.js`)
    const visioPlayerDataCallback = import(`~socializer/callbacks/visioPlayerDataCallback.js`)

    export default {
        name: 'Notifications',
        components: {
            AlertComponent: defineAsyncComponent(() => import('~socializer/components/System/widgets/AlertComponent.vue')),
            CallWebUI: defineAsyncComponent(() => import('~socializer/components/System/widgets/CallWebUI.vue')),
            IconWidget,
        },
        setup() {
            const {
                sendLocalPeerId,
                closeRemotePeerId,
                putToQueuedConnections,
                sendAuthorizationRemotePeerId,
                receiveAuthorizationRemotePeerId,
                setLocalVideoPeer,
                setLocalDataPeer,
                createVideoElement,
                removeVideoElement,
                startVisioStream,
                stopUserVisioStream,
                stopAllVisioStream,
                currentStream,
                updateCurrentRoom,
                updateCurrentType,
                localPeerId,
                storeConnection,
                connections,
                onResponseCallError,
                callInprogress,
                setCallInProgress,
                setCurrentCallRoomId,

            } = usePeers()

            const totalNotification = ref(0)
            const notificationComponent = ref(null)
            const notificationComponentProps = ref(null)
        
            return {
                sendLocalPeerId,
                closeRemotePeerId,
                putToQueuedConnections,
                sendAuthorizationRemotePeerId,
                receiveAuthorizationRemotePeerId,
                totalNotification,
                notificationComponent,
                notificationComponentProps,
                setLocalVideoPeer,
                setLocalDataPeer,
                createVideoElement,
                removeVideoElement,
                startVisioStream,
                stopUserVisioStream,
                stopAllVisioStream,
                currentStream,
                updateCurrentRoom,
                updateCurrentType,
                localPeerId,
                storeConnection,
                connections,
                onResponseCallError,
                callInprogress,
                setCallInProgress,
                setCurrentCallRoomId,
            }
        },
        watch: {
            userChannel(value) {
                if(value) {
                    this.initUserChannel()
                }
            },
        },
        computed : {
            ...mapState(useMeStore, {
                me: 'getMe',
            }),
            userChannel: function() {
                if(this.me) {
                    return `App.Models.User.${this.me.id}`
                }
            }
        },
        mounted() {
            this.setLocalVideoPeer(this, visioCallCallback.default)
            this.setLocalDataPeer(this, visioPlayerDataCallback.default)
        },
        unmounted() {
            Echo.leave(this.userChannel)
        },
        methods: {
            ...mapActions(useConversationsStore, [
                'addConversation',
            ]),
            initUserChannel() {
                if(this.userChannel) {
                    Echo.leave(this.userChannel)
                    Echo.private(this.userChannel)
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
                            this.putToQueuedConnections(event.peerId, event.fromUserSlug, event.type, event.room )
                        })
                        // receive authorization to peer connection
                        .listen('.ResponseToAthorizationPeer', (event) => {
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
            onStopCall() {
                this.stopAllVisioStream('visio')
            }
        }
    }

</script>