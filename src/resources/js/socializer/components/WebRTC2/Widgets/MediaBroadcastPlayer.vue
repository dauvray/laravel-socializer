<template>
    <div class="draggable-video" 
        v-resize="resizeOptions"
        v-draggable="draggableOptions"
        >
        <slot v-if="videoActive" name="video" :streamData="props.streamData">
            <VideoPlayer
                ref="player"
                :srcObject="props.streamData.stream"
                :controls="false"
                :autoplay="true"
                :loop="false"
                :muted="props.streamData.metadata?.isMe || false"
                :playsinline="true"
            ></VideoPlayer>
        </slot>
        <slot v-else name="audio" :streamData="props.streamData">
            <AudioPlayer 
                ref="player"
                :srcObject="props.streamData.stream"
                :controls="true"
                :autoplay="true"
                :loop="false"
                :muted="props.streamData.metadata?.isMe || false"
            ></AudioPlayer>
        </slot>

        <div class="video-tools-wrapper">
            <div class="video-tools">
                <div class="user-info-wrapper">
                    <span class="user-info">
                        {{ props.streamData.metadata?.fromName || 'Inconnu' }}
                        <template v-if="props.streamData.metadata.currentType !== 'visio'">
                            <IconWidget icon="eye"></IconWidget> {{ props.streamData.metadata?.countViewers || 0 }}
                        </template>
                        <IconWidget v-if="muted" icon="microphone-slash"></IconWidget>
                    </span>
                </div>
                <!-- <div v-if="isClosable" class="video-btns" role="group">
                    <button type="button" @click="closeStream">
                        <IconWidget icon="window-close"></IconWidget>
                    </button>
                </div> -->
            </div>
        </div>

        <div class="video-cache" ref="video-cache"></div>

        <slot name="controls">
            <div class="video-controls">
                <button v-if="showStartButton" type="button" class="btn btn-primary" @click="startVideo">Play</button>
                <button v-if="!props.streamData.metadata.isMe" 
                    type="button" 
                    class="btn" 
                    :class="{'btn-primary': !muted, 'btn-secondary': muted}" 
                    @click="toggleMute">{{ muted ? 'Unmute' : 'Mute' }}
                </button>
                <button type="button" class="btn btn-primary" @click="toggleFullscreen">Fullscreen</button>
                <button type="button" class="btn btn-primary" @click="togglePIP">PIP</button>
            </div>
        </slot>

    </div>
</template>

<script setup>
    //--------------------------------------------------------
    // dépend de MediaBroadcastProvider en parent (inject api)
    //--------------------------------------------------------

    import { ref, watch, onBeforeUnmount, defineAsyncComponent, computed, onUnmounted, inject } from 'vue'
    import { WEBRTC_API_KEY } from '~socializer/components/WebRTC2/webrtc2.config.js'
    import { usePeer2Store } from '~socializer/stores/peers2.js'
    import resizeDirective from '~socializer/directives/resizable.js'
    import draggableDirective from '~socializer/directives/draggable.js'
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import VideoPlayer from '~estarter/components/widgets/VideoPlayer.vue'
    import AudioPlayer from '~estarter/components/widgets/AudioPlayer.vue'

    const props = defineProps({
        streamData: {
            type: Object,
            default: () => ({
                stream: null,
                metadata: {
                    fromName: 'Unknown',
                    roomId: null,
                    countViewers: 0,
                    currentType: null,
                    isMe: false,
                    peerId: null,
                }
            }),
        },
        resizable: {
            type: Boolean,
            required: false,
            default: false,
        },
        draggable: {
            type: Boolean,
            required: false,
            default: false,
        },
    })

    const api = inject(WEBRTC_API_KEY, null)
    if (!api) {
        throw new Error('MediaBroadcastPlayer doit être utilisé à l\'intérieur d\'un MediaBroadcastProvider')
    }
    
    const peerStore = usePeer2Store()

    const player = ref(null) // fait réfence à l'élément vidéo du template
    const vResize = resizeDirective
    const vDraggable = draggableDirective
    const resizeOptions = {
        resizable: props.resizable,
        corner: 'top-right',
        wrapperId: props.streamData?.metadata?.roomId || 'app',
        minSize: {
            width: 200,
            height: 112
        },
        maxSize: {
            width: 800, 
            height: 450
        },
    }
    const draggableOptions = {
        draggable: props.draggable,
    }
    const muted = ref(props.streamData.metadata.isAudioMuted)
    const videoActive = ref(props.streamData.metadata.isVideoEnabled)



    // todo
    const showStartButton = ref(false)


    /*** Signaling */
    const lastRoomSignal = computed(() => {
       return peerStore.getLastRoomSignal(props.streamData.metadata?.peerId)
    })

    const stopSignalWatch = watch(lastRoomSignal, async (signal) => {
        if (!signal || signal.roomId !== props.streamData.metadata?.peerId) return

        switch (signal.payload?.type) {
            case 'AUDIO_MUTE_TOGGLE':
                muted.value = signal.payload.isMuted
                break
            case 'VIDEO_ACTIVE_TOGGLE':
                console.log('signal toggle video reçu dans player', signal)
                videoActive.value = signal.payload.isActive
                break
            default:
                break
        }
    })

    /*** Methodes */
    const toggleFullscreen = () => {
        if (!document.fullscreenElement) {
            player.value.nativeVideo.requestFullscreen().catch(err => {
                console.error(`Error attempting to enable fullscreen mode: ${err.message} (${err.name})`)
            })
        } else {
            document.exitFullscreen().catch(err => {
                console.error(`Error attempting to exit fullscreen mode: ${err.message} (${err.name})`)
            })
        }
    }

    const toggleMute = () => {
        if (!player.value) return
        player.value.nativeVideo.muted = !player.value.nativeVideo.muted
        muted.value = player.value.nativeVideo.muted
    }

    const togglePIP = () => {
        if (!player.value) return
        if (document.pictureInPictureElement) {
            document.exitPictureInPicture().catch(err => {
                console.error(`Error attempting to exit Picture-in-Picture mode: ${err.message} (${err.name})`)
            })
        } else {
            player.value.nativeVideo.requestPictureInPicture().catch(err => {
                console.error(`Error attempting to enter Picture-in-Picture mode: ${err.message} (${err.name})`)
            })
        }
    }

    // fais watch sur api.isVideoEnabled pour activer/désactiver la vidéo en fonction de cette prop (utile pour les toggles de caméra dans le StreamSimpleUI)
    watch(api.isVideoEnabled, (newVal) => {
        videoActive.value = newVal
    })

    onBeforeUnmount(() => {
        if (player.value) {
            player.value.srcObject = null
            // si picture-in-picture actif, on le quitte pour éviter les erreurs liées à un élément vidéo non attaché au DOM
            if (document.pictureInPictureElement) {
                document.exitPictureInPicture().catch(err => {
                    console.error(`Error attempting to exit Picture-in-Picture mode on component unmount: ${err.message} (${err.name})`)
                })
            }
        }
    })

    onUnmounted(() => {
        stopSignalWatch()
    })
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