<template>
    <div class="card">
        <div class="card-body">
            <button class="btn btn-primary" @click="startWebcamStream">Start Webcam Stream</button>
            <button class="btn btn-danger" @click="stopWebcamStream">Stop Webcam Stream</button>
            
            <VideoComponent v-if="props.api.currentStream.value" :srcObject="props.api.currentStream.value"></VideoComponent>
            
             {{ props.remoteStreams.length }} remote stream(s) received.
            <VideoComponent v-for="(remoteStream, index) in props.remoteStreams" :key="index" :srcObject="remoteStream"></VideoComponent>
        </div>
    </div>
   
</template>

<script setup>

    import VideoComponent from '~socializer/components/WebRTC2/Widgets/Widgets/VideoComponent.vue' 

    const props = defineProps({
        api: Object,
        remoteStreams: {
            type: Array,
            default: () => []
        },
    })

    const startWebcamStream = () => {
        props.api.getWebcamStream()
    }

    const stopWebcamStream = () => {
        props.api.stopStream()
    }

</script>