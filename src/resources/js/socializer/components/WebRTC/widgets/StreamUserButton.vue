<template>
    <template v-if="!isStreaming">
        <button class="btn btn-primary dropdown dropdown-toggle" 
            type="button" 
            data-bs-toggle="dropdown" 
            aria-expanded="false">
            <IconWidget icon="broadcast-tower"></IconWidget> Streaming
        </button>
        <ul class="dropdown-menu">
            <li>
                <a class="dropdown-item" 
                    href="#" 
                    @click="onVideoCall">
                    <IconWidget icon="video"></IconWidget> Stream vidéo
                </a>
            </li>
            <li>
                <a class="dropdown-item" 
                    href="#" 
                    @click="onAudioCall">
                    <IconWidget icon="phone"></IconWidget> Stream audio
                </a>
            </li>
        </ul>
    </template>

    <template v-else >
        <button 
            type="button" 
            id="stop-stream-btn"
            class="btn btn-danger"
            @click="onStopBrodcastWebcam">
            <IconWidget icon="window-close"></IconWidget> Terminer stream
        </button>
        <button 
            type="button" 
            class="btn"
            :class="[isMuted ? 'btn-secondary' : 'btn-primary']"
            >
            <IconWidget v-if="isMuted" icon="microphone" title="activer le son" @click="onManageAudio"></IconWidget>
            <IconWidget v-else icon="microphone-slash" title="couper le son" @click="onManageAudio"></IconWidget>
        </button>
        <button 
            v-if="isVideoCall"
            type="button" 
            class="btn"
            :class="[isVideoEnabled ? 'btn-primary' : 'btn-secondary']"
            >
            <IconWidget v-if="!isVideoEnabled" icon="video" title="activer la caméra" @click="onManageVideo"></IconWidget>
            <IconWidget v-else icon="video-slash" title="couper la caméra" @click="onManageVideo"></IconWidget>
        </button>
    </template>

</template>

<script>

    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import { usePeers } from '~socializer/components/WebRTC/composables/usePeers.js'
    import { useMeStore } from '~estarter/stores/me.js'
    import { mapState } from 'pinia'
    import { ref } from 'vue'
    import { setContext, logError } from '~estarter/services/logger.js'

    const streamPeerCallback = import(`~socializer/callbacks/streamPlayerCallback.js`)

    export default {
        name: 'StreamUserButton',
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
                isStreaming,
                startWebcamStream,
                stopVideoStream,
                currentStream,
                setLocalVideoPeer,
                syncUsersConnections,
                syncJoingingUsers,
                createVideoElement,
                removeVideoElement,
                updateVideoProps,
                deleteRemoteOpenedConnections,
            } = usePeers(props, 'stream', props.room)

            const localVideoPlayer = 'local-stream'
            const isMuted = ref(true)
            const isVideoEnabled = ref(false)
            const isVideoCall = ref(false)
            const isAudioCall = ref(false)

            return {
                isStreaming,
                startWebcamStream,
                syncUsersConnections,
                syncJoingingUsers,
                currentStream,
                setLocalVideoPeer,
                localVideoPlayer,
                stopVideoStream,
                createVideoElement,
                removeVideoElement,
                deleteRemoteOpenedConnections,
                isMuted,
                isVideoEnabled,
                updateVideoProps,
                isVideoCall,
                isAudioCall,
            }
        },
        mounted() {
             setContext({ users: this.users, room: this.room, component: 'StreamUserButton' });
            this.setLocalVideoPeer(this, streamPeerCallback.default)
        },
        watch: {
            users : {
                handler(newVal) {
                    try {
                        if(this.isStreaming) {
                            this.syncJoingingUsers(newVal)
                        }
                    } catch (e) {
                       logError(e);
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
            onVideoCall() {
                this.isMuted = false
                this.isVideoEnabled = true
                this.isVideoCall = true
                this.isAudioCall = false
                this.startBroadcast()
            },
            onAudioCall() {
                this.isMuted = false
                this.isVideoEnabled = false
                this.isVideoCall = false
                this.isAudioCall = true
                this.startBroadcast()
            },
            onManageAudio() {
                this.isMuted = !this.isMuted
                this.updateVideoProps({isMuted: this.isMuted})
            },
            onManageVideo() {
                this.isVideoEnabled = !this.isVideoEnabled
                this.updateVideoProps({isVideoEnabled: this.isVideoEnabled})
            },
            startBroadcast() {
               this.startWebcamStream({audio: !this.isMuted, video: this.isVideoEnabled}, true)
               .then(async () => {
                    this.syncUsersConnections(this.users)
                    if(!document.getElementById(this.localVideoPlayer)) {
                        await this.createVideoElement(
                            {
                                videoId: this.localVideoPlayer,
                                nickname: this.me.slug,
                                isMuted: this.isMuted,
                                isVideoEnabled: this.isVideoEnabled
                            },
                            this.currentStream
                        )
                        this.$emit('started-stream', 'stream', this.localVideoPlayer)
                    }
                })
            },
            onStopBrodcastWebcam(){
                this.stopVideoStream('stream')
                this.removeVideoElement(this.localVideoPlayer)
                this.$emit('stoped-stream', 'stream', this.localVideoPlayer)
            },
        },
    }
</script>