<template></template>

<script>

    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import { usePeers } from '~socializer/components/WebRTC/composables/usePeers.js'
    import { setContext, logError } from '~estarter/services/logger.js'

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
            setContext({ users: this.users, room: this.roomId, component: 'DataUserPeerConnection' });
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
                handler(newVal) {
                    console.log('users changed',this.roomId, newVal)
                    try {
                        if(newVal && newVal.length === 0) {
                            return
                        }
                        this.syncUsersConnections(newVal)
                    } catch (e) {
                       logError(e);
                    }
                },
                immediate: true,
                deep: true, // keep this
            },
        },
    }
</script>