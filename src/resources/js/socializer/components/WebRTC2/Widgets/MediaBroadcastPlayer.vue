<template>
    <div class="draggable-video" 
        v-resize="resizeOptions"
        v-draggable="draggableOptions"
        >
        <slot v-if="videoActive" name="video" :streamData="props.streamData">
            <VideoPlayer
                ref="player"
                :controls="false"
                :autoplay="true"
                :loop="false"
                :muted="props.streamData.metadata?.isMe || false"
                :playsinline="true"
            ></VideoPlayer>
        </slot>
        <slot v-else name="audio" :streams="[props.streamData.stream]">
            <audio 
                ref="player"
                :controls="true"
                :autoplay="true"
                :loop="false"
                :muted="props.streamData.metadata?.isMe || false"
            ></audio>
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

    import { ref, watch, onBeforeUnmount, defineAsyncComponent, computed, onUnmounted } from 'vue'
    import { usePeer2Store } from '~socializer/stores/peers2.js'
    import resizeDirective from '~socializer/directives/resizable.js'
    import draggableDirective from '~socializer/directives/draggable.js'
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import VideoPlayer from '~estarter/components/widgets/VideoPlayer.vue'

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
        videoEnabled: {
            type: Boolean,
            required: false,
            default: true,
        },

    })
    
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
    const muted = ref(false)
    const videoActive = ref(props.videoEnabled)



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

    watch(
        // on regarde à la fois la source du flux vidéo et l'élément vidéo lui même, 
        // car il se peut que l'un des deux ne soit pas encore prêt au moment où l'autre change
        [() => props.streamData, player],
        async ([streamData, playerComponent]) => {
            if (!streamData || !playerComponent || !playerComponent.nativeVideo) return
            if (playerComponent.nativeVideo.srcObject === streamData.stream) return
            playerComponent.nativeVideo.srcObject = streamData.stream

            const playVideo = async () => {
                try {
                    await playerComponent.nativeVideo.play()
                }
                catch (e) {
                    console.error(e)
                }
            }

            if (playerComponent.nativeVideo.readyState >= 1) {
                await playVideo()
                return
            }

            playerComponent.nativeVideo.addEventListener(
                'loadedmetadata',
                playVideo,
                { once: true }
            )
        },
        {
            immediate: true,
            flush: 'post',
        }
    )
    // fais watch sur props.videoEnabled pour activer/désactiver la vidéo en fonction de cette prop (utile pour les toggles de caméra dans le StreamSimpleUI)
    watch(() => props.videoEnabled, (newVal) => {
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