<template>
    <div class="card">
        <div class="card-body">
            <button class="btn btn-primary" @click="startWebcamStream">Start Webcam Stream</button>
            <VideoComponent :srcObject="props.api.currentStream"></VideoComponent>
        </div>
    </div>
    {{ props.api.currentStream }}
</template>

<script setup>

    import VideoComponent from '~socializer/components/WebRTC2/Widgets/Widgets/VideoComponent.vue' 

    const props = defineProps({
        api: Object,
    })

    const startWebcamStream = () => {
        props.api.getWebcamStream()
    }

</script>