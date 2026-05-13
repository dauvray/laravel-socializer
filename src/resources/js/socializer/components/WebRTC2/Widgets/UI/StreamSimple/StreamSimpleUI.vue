<template>
    <div class="card">
        <div class="card-body">
            <button v-if="!isStreaming" class="btn btn-primary" @click="startWebcamStream">Start Webcam Stream</button>
            <button v-else class="btn btn-danger" @click="stopWebcamStream">Stop Webcam Stream</button>
            
            <VideoComponent v-if="props.api.currentStream.value" :srcObject="props.api.currentStream.value"></VideoComponent>
            
            {{ props.remoteStreams.length }} remote stream(s) received.
            <VideoComponent v-for="(remoteStream, index) in props.remoteStreams" :key="index" :srcObject="remoteStream"></VideoComponent>
           
        </div>
    </div>
   
</template>

<script setup>
    import { ref } from 'vue'
    import VideoComponent from '~socializer/components/WebRTC2/Widgets/Widgets/VideoComponent.vue' 

    const props = defineProps({
        api: Object,
        remoteStreams: {
            type: Array,
            default: () => []
        },
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

</script>