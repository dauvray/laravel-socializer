<template>
    <div class="btn-group btn-group-sm" role="group">
        <LocalStreamBtn
            :isStreaming="props.isStreaming"
            :streamStates="props.streamStates"
            @start_video="emit('start_video')"
            @start_audio="emit('start_audio')"
            @stop_video="emit('stop_video')"
            @stop_audio="emit('stop_audio')"
            @toggle_audio="emit('toggle_audio')"
            @toggle_video="emit('toggle_video')"
        ></LocalStreamBtn>
        <LocalCaptureBtn
            :isCapturing="props.isCapturing"
            @start-stream="emit('start-screen')"
            @stop-stream="emit('stop-screen')">
        </LocalCaptureBtn>
    </div> 
</template>

<script setup>

import LocalStreamBtn from '~socializer/components/WebRTC2/Widgets/UI/Buttons/LocalStreamBtn.vue'
import LocalCaptureBtn from '~socializer/components/WebRTC2/Widgets/UI/Buttons/LocalCaptureBtn.vue'

const emit = defineEmits([
    'start_video', 
    'start_audio', 
    'stop_video', 
    'stop_audio', 
    'toggle_audio', 
    'toggle_video', 
    'start-screen', 
    'stop-screen'
])

const props = defineProps({
    isStreaming: { type: Boolean, default: false },
    streamStates: { type: Object, default: () => ({}) },
    isCapturing: { type: Boolean, default: false },
})

</script>