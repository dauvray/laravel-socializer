<template>
    <VideoPlayer
        ref="player"
        :autoplay="true"
        :playsinline="true"
        :controls="true"
        :srcObject="localStream"
    ></VideoPlayer>
</template>

<script setup>

    import { watch, ref, useTemplateRef } from 'vue'
    import VideoPlayer from '~estarter/components/widgets/VideoPlayer.vue'

    const props = defineProps({
        srcObject: {
            type: MediaStream,
            required: false,
            default: null,
        },
    })

    const localStream = ref(null)
    const childRef = useTemplateRef('player')

    watch(() => props.srcObject, (newVal) => {
        if(newVal) {
            console.log('new srcObject received in VideoComponent', newVal)
            localStream.value = newVal
            if (childRef.value) {
                console.log('playing video with new srcObject', newVal, childRef.value)
                childRef.value.play();
            }
        }
    })
    

</script>