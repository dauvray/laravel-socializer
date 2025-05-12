<template>
    <button v-if="!isInCall" 
        type="button" 
        class="btn btn-primary btn-sm" 
        :disabled="isCalling"
        title="Appel visio"
        @click="onCallUser">
        <IconWidget icon="video"></IconWidget>
    </button>
    <button v-else 
        type="button"
        class="btn btn-danger btn-sm"
        title="Terminer appel visio"
        @click="onCloseCall">
        <IconWidget icon="video-slash"></IconWidget>
    </button>
</template>

<script>
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import { usePeers } from '~socializer/components/WebRTC/composables/usePeers.js'
    import { useMeStore } from '~estarter/stores/me.js'
    import { mapState } from 'pinia'
    import { ref } from 'vue'

    const videoCallCallback = import(`~socializer/callbacks/vocalPlayerCallback.js`)

    export default {
        name: 'CallVideoUserButton',
        inject: [
            "AWN",
        ],
        components: {
            IconWidget,
        },
        props: {
            user: {
                type: Object,
                required: true
            },
        },
        setup( props ) {
            const {
                setLocalVideoPeer,
                syncUsersConnections,
                getAuthorizationRemotePeerId,
                pendingRequests,
                startWebcamStream,
                stopUserVisioStream,
                connections,
                ConnectionsHasTypeInRoom,
                removeVideoElement,
                currentStream,
            } = usePeers(props, 'visio', null)

            const isInCall= ref(false)

            return {
                setLocalVideoPeer,
                syncUsersConnections,
                getAuthorizationRemotePeerId,
                pendingRequests,
                startWebcamStream,
                stopUserVisioStream,
                connections,
                removeVideoElement,
                currentStream,
                ConnectionsHasTypeInRoom,
                isInCall,
            }
        },
        created() {
            this.setLocalVideoPeer(this, videoCallCallback.default)
        },
        mounted() {
            this.checkIsInCall()
        },
        computed: {
            ...mapState(useMeStore, {
                me: 'getMe',
            }),
            isCalling: function() {
                return this.pendingRequests.hasOwnProperty(this.user.slug)
            },
        },
        watch: {
            connections: {
                handler() {
                    this.checkIsInCall()
                },
                deep: true
            },
        },
        methods: {
            onCallUser() {
                this.getAuthorizationRemotePeerId(this.user.slug, 'visio')
                this.AWN.info(`Appel ${this.user.slug}`)
            },
            onCloseCall() {
                this.stopUserVisioStream(this.user.slug, 'visio')
            },
            checkIsInCall() {
                this.isInCall = this.ConnectionsHasTypeInRoom(this.user.slug, 'visio')
            }
        }
    }
</script>