<template>
    <video
        :id="videoId"
        ref="video"
        class="img-thumbnail"
        autoplay
        playsinline
        controls
    ></video>
    <div class="video-tools-wrapper">
        <div class="video-tools">
            <div class="user-info-wrapper">
                <span class="user-info">
                    {{ nickname }}
                    <IconWidget  icon="eye"></IconWidget> {{ nbViewers }}
                </span>
            </div>
            <div v-if="isClosable" class="video-btns" role="group">
                <button type="button" @click="closeStream">
                    <IconWidget icon="window-close"></IconWidget>
                </button>
            </div>
        </div>
    </div>
</template>

<script>
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import { usePeerStore } from '~socializer/stores/peers.js'
    import { mapActions, mapState } from 'pinia'

    const peerStore = usePeerStore()

    export default {
        name: 'VideoComponent',
        inject: [
            "states",
            "eventBus",
        ],
        components: {
            IconWidget
        },
        props: {
            videoId: {
                type: String,
                required: true
            },
            roomId: {
                type: String,
                required: true
            },
            type: {
                type: String,
                required: true
            },
            nickname: {
                type: String,
                required: true
            },
            stream: {
                type: MediaStream,
                required: false,
                default: null,
            },
             peer: {
                type: RTCPeerConnection,
                required: false,
                default: null,
             }
        },
        data(){
            return {
                totalViewers : 0
            }
        },
        mounted() {
            if (this.stream) {
                this.$refs.video.srcObject = this.stream
                this.$refs.video.onloadedmetadata = () => {
                    this.$refs.video.play()
                    .catch((err) => console.error(`Erreur de lecture pour ${videoElementId} :`, err));
                }
            }
            this.eventBus.$on("videoPlayerEvent", this.onPlayerEvent)
        },
        watch: {
             'states.isMuted'(newValue) {
                this.stream.getAudioTracks().forEach(track => track.enabled = !newValue)
            },
            'states.isVideoEnabled'(newValue) {
                this.stream.getVideoTracks().forEach(track => track.enabled = newValue)
            },
            nbViewers(newValue) {
                // emitter only
                if(!this.peer) {
                    this.updateViewersCounter(newValue)
                }
            },
            connections:{
                handler() {
                    this.updateViewersCounter(this.nbViewers)
                },
                deep: true
            }
        },
        computed: {
            ...mapState(usePeerStore, {
                connections: 'getConnections'
            }),
            nbViewers: function() {
                if(!this.peer) {
                    return peerStore.getRoomViewers(this.roomId, this.type)
                } else {
                    return this.totalViewers
                }
            },
            isClosable: function() {
                return this.type != 'visio' ? true : false
            }
        },
        methods: {
            ...mapActions(usePeerStore, [
                'sendVideoData',
            ]),
            closeStream() {
                this.eventBus.$emit("closeStream", this.type, this.stream, this.peer)
            },
            updateViewersCounter(newValue) {
                setTimeout(() => {
                    this.sendVideoData({
                        action: 'update-total-viewers',
                        total: newValue, 
                        nickname: this.nickname, 
                        type: this.type
                    }, this.roomId, this.type)
                }, 500)
            },
            onPlayerEvent(data) {
                if(data.nickname == this.nickname) {
                    switch(data.action) {
                        case 'update-total-viewers':
                            this.totalViewers = data.total
                            break
                    }
                }
            }
        }
    }
</script>
