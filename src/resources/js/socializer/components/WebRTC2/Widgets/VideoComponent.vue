<template>
    <div class="draggable-video" 
        v-draggable="draggableOptions">
        <video 
            ref="player"
            v-resize="resizeOptions"
            :controls="false"
            :autoplay="true"
            :loop="false"
            :muted="props.streamData.metadata?.isMe || false"
            :poster="poster"
            :playsinline="true"
        ></video>

        <div class="video-tools-wrapper">
            <div class="video-tools">
                <div class="user-info-wrapper">
                    <span class="user-info">
                        {{ props.streamData.metadata?.fromName || 'Unknown' }}
                        <template v-if="props.streamData.metadata.currentType !== 'visio'">
                            <IconWidget  icon="eye"></IconWidget> {{ props.streamData.metadata?.countViewers || 0 }}
                        </template>
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

        <div class="video-controls">
            <button v-if="showStartButton" type="button" class="btn btn-primary" @click="startVideo">Play</button>
            <button v-if="!props.streamData.metadata.isMe" type="button" class="btn" :class="{'btn-primary': !muted, 'btn-secondary': muted}" @click="toggleMute">{{ muted ? 'Unmute' : 'Mute' }}</button>
            <button type="button" class="btn btn-primary" @click="toggleFullscreen">Fullscreen</button>
            <button type="button" class="btn btn-primary" @click="togglePIP">PIP</button>
        </div>
    </div>

</template>

<script setup>

    import { ref, watch , onBeforeUnmount } from 'vue'
    import resizeDirective from '~socializer/directives/resizable.js'
    import draggableDirective from '~socializer/directives/draggable.js'
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'

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

    // todo
    const showStartButton = ref(false)
    const muted = ref(false)

    /*** Methodes */
    const toggleFullscreen = () => {
        if (!document.fullscreenElement) {
            player.value.requestFullscreen().catch(err => {
                console.error(`Error attempting to enable fullscreen mode: ${err.message} (${err.name})`)
            })
        } else {
            document.exitFullscreen()
        }
    }

    const toggleMute = () => {
        if (!player.value) return
        player.value.muted = !player.value.muted
        muted.value = player.value.muted
    }

    const togglePIP = () => {
        if (!player.value) return
        if (document.pictureInPictureElement) {
            document.exitPictureInPicture().catch(err => {
                console.error(`Error attempting to exit Picture-in-Picture mode: ${err.message} (${err.name})`)
            })
        } else {
            player.value.requestPictureInPicture().catch(err => {
                console.error(`Error attempting to enter Picture-in-Picture mode: ${err.message} (${err.name})`)
            })
        }
    }

    watch(
        // on regarde à la fois la source du flux vidéo et l'élément vidéo lui même, 
        // car il se peut que l'un des deux ne soit pas encore prêt au moment où l'autre change
        [() => props.streamData, player],
        async ([streamData, video]) => {
            if (!streamData || !video) return
            if (video.srcObject === streamData.stream) return
            video.srcObject = streamData.stream

            const playVideo = async () => {
                try {
                    await video.play()
                }
                catch (e) {
                    console.error(e)
                }
            }

            if (video.readyState >= 1) {
                await playVideo()
                return
            }

            video.addEventListener(
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