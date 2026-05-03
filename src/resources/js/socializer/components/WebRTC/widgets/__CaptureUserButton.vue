<template>
    <button v-if="!isCapturing" 
        type="button" 
        class="btn btn-sm btn-primary"
        @click="onBrodcastScreen">
        <IconWidget icon="tv"></IconWidget> Partage
    </button>
    <button v-else
        type="button" 
        class="btn btn-sm btn-danger"
        @click="onStopBrodcastScreen">
        <IconWidget icon="window-close"></IconWidget> Arrêter partage
    </button>
</template>

<script>
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import { usePeers } from '~socializer/components/WebRTC/composables/usePeers.js'
    import { useMeStore } from '~estarter/stores/me.js'
    import { mapState } from 'pinia'
    import { ref } from 'vue'
    import screenPeerCallback from '~socializer/callbacks/screenPlayerCallback.js'

    export default {
        name: 'CaptureUserButton',
        emits: [
            'stoped-stream',
            'started-stream',
        ],
        components: {
            IconWidget,
        },
        props: {
            room: {
                type: String,
                required: false,
                default: null,
            },
            users: {
                type: Array,
                required: true
            },
        },
        setup( props ) {
            const {
                isCapturing,
                startScreenCapture,
                stopVideoStream,
                currentStream,
                setLocalVideoPeer,
                syncUsersConnections,
                syncJoingingUsers,
                createVideoElement,
                removeVideoElement,
                deleteRemoteOpenedConnections,
            } = usePeers(props, 'screen', props.room)

            const localScreenPlayer = `local-screen`

            return {
                isCapturing,
                startScreenCapture,
                stopVideoStream,
                currentStream,
                setLocalVideoPeer,
                localScreenPlayer,
                syncUsersConnections,
                syncJoingingUsers,
                createVideoElement,
                removeVideoElement,
                deleteRemoteOpenedConnections,
            }
        },
        created() {
           this.setLocalVideoPeer(this, screenPeerCallback.default)
        },

        // todo voir si on peut garder un watch que sur les users du StreamUserButton
        // pour ne pas avoir de doublon
        watch: {
            users : {
                handler(newVal) {
                    if(this.isCapturing) {
                        this.syncJoingingUsers(newVal)
                    }
                },
                immediate: true,
                deep: true, // keep this
            }
        },
        computed: {
            ...mapState(useMeStore, {
                me: 'getMe',
            }),
        },
        methods: {
            onBrodcastScreen() {
                this.startScreenCapture()
                .then(async () => {
                   this.syncUsersConnections(this.users)
                   if(!document.getElementById(this.localScreenPlayer)) {
                        await this.createVideoElement(
                            {
                                videoId: this.localScreenPlayer,
                                nickname: this.me.slug
                            },
                            this.currentStream
                        )
                        this.$emit('started-stream', 'screen')
                    }
                })
            },
            onStopBrodcastScreen() {
                this.stopVideoStream('screen')
                this.removeVideoElement(this.localScreenPlayer)
                this.$emit('stoped-stream', 'screen', this.localScreenPlayer)
            },
        },
    }
</script>