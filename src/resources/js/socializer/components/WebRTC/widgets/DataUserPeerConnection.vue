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
                isConnected,
                setLocalDataPeer,
                syncUsersConnections,
                unregisterIncomingPeerCallback,
            } = usePeers(props, 'data', props.roomId)

            return {
                isConnected,
                setLocalDataPeer,
                syncUsersConnections,
                unregisterIncomingPeerCallback,
            }
        },
        async mounted() {
            await this.setLocalDataPeer(this, this.callbackConnection)
        },
        beforeUnmount() {
            this.unregisterIncomingPeerCallback()
        },
        watch: {
            isConnected(val) {
                this.$emit('connected', val)
            },
            users: {
                handler(newVal, oldVal) {

                    if(!oldVal)  oldVal = []
                    this.syncUsersConnections(newVal, oldVal)

                },
                immediate: true,
                deep: true, // keep this
            },
        },
    }
</script>