<template>
    {{ users.length }}
</template>

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
            } = usePeers(props, 'data', props.roomId)

            return {
                isConnected,
                setLocalDataPeer,
                syncUsersConnections,
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
                handler(newVal, oldVal) {
                    if(newVal) {
                        this.syncUsersConnections(newVal, oldVal)
                    }
                },
                immediate: true,
                deep: true, // keep this
            },
        },
    }
</script>