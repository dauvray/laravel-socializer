<template>
    <div class="card">
        <div class="card-body">
            <StartLocalStreamBtn></StartLocalStreamBtn>


            <button v-if="!isStreaming" class="btn btn-primary" @click="startWebcamStream">Start Webcam Stream</button>
            <button v-else class="btn btn-danger" @click="stopWebcamStream">Stop Webcam Stream</button>
            
            <VideoComponent v-if="props.api.currentStream.value" :streamData="localStreamData"></VideoComponent>
            
            {{ props.api.remoteStreams.value.length }} remote stream(s) received.
            <VideoComponent v-for="(remoteStream, index) in props.api.remoteStreams.value" :key="index" :streamData="remoteStream"></VideoComponent>
           
        </div>
    </div>
   
</template>

<script setup>
    import { ref, computed } from 'vue'
    import VideoComponent from '~socializer/components/WebRTC2/Widgets/VideoComponent.vue' 
    import StartLocalStreamBtn from '../Buttons/StartLocalStreamBtn.vue'

    const props = defineProps({
        api: Object,
        // remoteStreams: {
        //     type: Array,
        //     default: () => []
        // },
    })

    const isStreaming = ref(false)

    const startWebcamStream = () => {
        props.api.getWebcamStream()
        isStreaming.value = true
    }

    const stopWebcamStream = () => {
        props.api.stopStream()
        isStreaming.value = false
    }

    const localStreamData = computed(() => ({ 
        stream: props.api.currentStream.value,
        metadata: {
            fromName: 'Moi'
        }
    }))

</script>