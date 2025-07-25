<template>

    <div>
        <video
            v-resize="options"
            ref="video"
            autoplay
            playsinline
            :controls="false"
            :style="isLocalStream ? 'pointer-events: none;' : ''"
        ></video>
        <div class="video-tools-wrapper">
            <div class="video-tools">
                <div class="user-info-wrapper">
                    <span class="user-info">
                        {{ nickname }}
                        <IconWidget icon="eye"></IconWidget> {{ nbViewers }}
                    </span>
                </div>
                <div v-if="isClosable" class="video-btns" role="group">
                    <button type="button" @click="closeStream">
                        <IconWidget icon="window-close"></IconWidget>
                    </button>
                </div>
            </div>
        </div>

        <div class="video-cache" ref="video-cache"></div>

        <div
            class="video-controls">
            <button v-if="showStartButton" type="button" class="btn btn-primary" @click="startVideo">Play</button>
            <button type="button" class="btn btn-primary" @click="toggleMute">{{ muted ? 'Unmute' : 'Mute' }}</button>
            <button type="button" class="btn btn-primary" @click="toggleFullscreen">Fullscreen</button>
            <button type="button" class="btn btn-primary" @click="togglePIP">PIP</button>
        </div>
    </div>


</template>

<script>
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import { usePeerStore } from '~socializer/stores/peers.js'
    import { useServerStore } from '~socializer/stores/server.js'
    import { mapActions, mapState } from 'pinia'
    import resizeDirective from '~socializer/directives/resizable.js';    


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
        directives: {
            resize: resizeDirective
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
             },
        },
        data(){
            return {
                video: null,
                totalViewers : 0,
                intervalViewers : null,
                isLocalStream: false,
                localStream: null,
                showStartButton: false,
                muted: false,
                options: {
                    corner: 'top-right',
                    wrapperId: this.videoId,
                    minSize: {
                        width: 200,
                        height: 112
                    },
                    maxSize: {
                        width: 800, 
                        height: 450
                    },
                },
            }
        },
        mounted() {

            this.video = this.$refs.video

            if (this.stream) {
               
                if (this.stream.isLocal) {
console.log('Local stream detected')
                    this.isLocalStream = true
                    this.localStream = this.stream.clone()

                     // Supprime les pistes audio du stream local pour ne pas s'entendre
                    this.localStream.getAudioTracks().forEach(track => this.localStream.removeTrack(track))

                    this.video.srcObject = this.localStream
                    this.video.muted = true;


                } else {
console.log('Remote stream detected')
                    this.video.srcObject = this.stream

                }


                this.video.onloadedmetadata = () => {
                    this.video.play()
                    .catch((err) => {
                         console.error(`Erreur de lecture pour ${this.videoId} :`, err);
                        this.showStartButton = true;
                    })
                }
            }

            this.eventBus.$on("videoPlayerEvent", this.onPlayerEvent)

            // viewers counter
            if(!this.peer) { 
                this.intervalViewers = setInterval(() => {
                    this.updateViewersCounter()
                }, 2000)
            }
        },
        beforeUnmount() {
            this.eventBus.$off("videoPlayerEvent", this.onPlayerEvent)

            this.video.srcObject = null

            if(this.intervalViewers) {
                clearInterval(this.intervalViewers)
            }

            if (this.stream) {
                this.stream.getTracks().forEach(track => track.stop())
            }

            if(this.localStream) {
                this.localStream.getTracks().forEach(track => track.stop())
                this.localStream = null
            }

            if(this.peer) {
                this.peer.close()
            }
        },
        watch: {
            'states.isMuted'(newValue) {
                this.stream.getAudioTracks().forEach(track => track.enabled = !newValue)
            },
            'states.isVideoEnabled'(newValue) {
                this.stream.getVideoTracks().forEach(track => track.enabled = newValue)
            },
        },
        computed: {
            ...mapState(useServerStore, {
                currentRoomId: 'getCurrentRoomId',
            }),
            nbViewers: function() {
                if(!this.peer) {
                    return peerStore.getRoomViewers(this.roomId, this.type)
                } else {
                    return this.totalViewers
                }
            },
            isClosable: function() {
                return this.type != 'visio' && this.roomId != this.currentRoomId ? true : false
            }
        },
        methods: {
            ...mapActions(usePeerStore, [
                'sendVideoData',
            ]),
            closeStream() {
                this.eventBus.$emit("closeStream", this.type, this.stream, this.peer)
            },
            updateViewersCounter() {
                this.sendVideoData({
                    action: 'update-total-viewers',
                    total: this.nbViewers, 
                    nickname: this.nickname, 
                    type: this.type,
                    roomId: this.roomId,
                }, this.roomId, this.type)
            },
            onPlayerEvent(data) {
                if(data.nickname == this.nickname && data.roomId == this.roomId && data.type == this.type) {
                    switch(data.action) {
                        case 'update-total-viewers':
                            this.totalViewers = data.total
                            break
                    }
                }
            },
            handleVideoResize() {
                this.$nextTick(() => {
                    if (this.video) {
                        const cacheElement = this.$refs['video-cache'];
                        if (cacheElement) {
                            cacheElement.style.width = `${this.video.offsetWidth}px`;
                            cacheElement.style.height = `${this.video.offsetHeight}px`;
                        }
                    }
                });
            },
            startVideo() {
                this.video.play()
                    .then(() => {
                        this.showStartButton = false
                    })
                    .catch((err) => {
                        console.error(`Erreur de lecture pour ${this.videoId} :`, err);
                    });
            },
            toggleMute() {
                this.muted = !this.muted;
                this.stream.getAudioTracks().forEach(track => track.enabled = !this.muted);
            },
            toggleFullscreen() {
                 if (document.fullscreenElement) {
                    document.exitFullscreen()
                } else {
                    this.video.requestFullscreen()
                }
            },
            async togglePIP() {
                try {
                    if (document.pictureInPictureElement) {
                    await document.exitPictureInPicture()
                    } else {
                    await this.video.requestPictureInPicture()
                    }
                } catch (err) {
                    console.warn('PIP non disponible :', err)
                }
            }
        }
    }
</script>

<style scoped>
    .video-cache {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: transparent;
        z-index: 1;
    }
</style>
