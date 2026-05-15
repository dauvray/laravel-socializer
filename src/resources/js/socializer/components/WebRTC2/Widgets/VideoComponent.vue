<template>
    {{ streamData.metadata?.fromName }}
    <video 
        ref="player"
        v-resize="resizeOptions"
        :controls="false"
        :autoplay="true"
        :loop="false"
        :muted="true"
        :poster="poster"
        :playsinline="true"
    ></video>
</template>

<script setup>

import { ref, watch } from 'vue'
import resizeDirective from '~socializer/directives/resizable.js'

const props = defineProps({
    streamData: {
        type: Object,
        default: () => ({
            stream: null,
            metadata: null,
        }),
    },
    videoId: {
        type: String,
        required: false,
        default: null,
    },
    roomId: {
        type: String,
        required: false,
        default: null,
    },
    type: {
        type: String,
        required: false,
        default: null,
    },
    nickname: {
        type: String,
        required: false,
        default: null,
    },
    peer: {
        type: Object,
        required: false,
        default: null,
    },
    resizable: {
        type: Boolean,
        required: false,
        default: false,
    },
})
// fait réfence à l'élément vidéo du template
const player = ref(null)

const vResize = resizeDirective
const resizeOptions = {
    resizable: props.resizable,
    corner: 'top-right',
    wrapperId: props.videoId,
    minSize: {
        width: 200,
        height: 112
    },
    maxSize: {
        width: 800, 
        height: 450
    },
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

</script>