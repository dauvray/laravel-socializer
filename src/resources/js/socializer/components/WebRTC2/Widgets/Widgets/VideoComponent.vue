<template>
    <video 
        ref="player"
        :controls="false"
        :autoplay="true"
        :loop="false"
        :muted="true"
        :poster="poster"
        :playsinline="true"
    ></video>
</template>

<<script setup>

import { ref, watch } from 'vue'

const props = defineProps({
    srcObject: {
        type: MediaStream,
        default: null,
    },
})
// fait réfence à l'élément vidéo du template
const player = ref(null)

watch(
    // on regarde à la fois la source du flux vidéo et l'élément vidéo lui même, 
    // car il se peut que l'un des deux ne soit pas encore prêt au moment où l'autre change
    [() => props.srcObject, player],
    async ([stream, video]) => {

        if (!stream || !video) return

        if (video.srcObject === stream) {
            return
        }

        video.srcObject = stream

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