<template></template>

<script>

    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import { usePeers } from '~socializer/components/WebRTC/composables/usePeers.js'
   
    export default {
        name: 'DataUserPeerConnection',
        emits: [
            'connected',
        ],
        components: {
            IconWidget,
        },
        props: {
            callbackConnection: {
                type: Function,
                required: false
            },
            roomId: {
                type: String,
                required: false,
                default: 'default',
            },
            users: {
                type: Object,
                required: true
            }
        },
        setup( props ) {
            const {
                connectToQueuedConnections,
                isConnected,
                setLocalDataPeer,
                queuedConnections,
                syncUsersConnections,
                localPeer,
                storeConnection,
            } = usePeers(props, 'data', props.roomId)

            return {
                connectToQueuedConnections,
                isConnected,
                setLocalDataPeer,
                queuedConnections,
                syncUsersConnections,
                localPeer,
                storeConnection,
            }
        },
        async created() {
            await this.setLocalDataPeer(this, this.callbackConnection)
        },
        watch: {
            isConnected(val) {
                this.$emit('connected', val)
            },
            users: {
                handler(value) {
                    setTimeout(() => {
                        if(value) {
                            this.syncUsersConnections(value)
                        }
                    },2000)
                },
                deep: true,
                immediate: true
            },
            queuedConnections: {
                handler() {
                    this.connectToQueuedConnections()
                },
                deep: true,
                immediate: true
            }
        },
    }
</script>