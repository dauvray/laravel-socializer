<template>
    <div class="btn-group btn-group-sm" role="group">
        <LocalStreamBtn
            :isStreaming="props.api.isStreaming.value"
            :streamStates="props.api.streamStates.value"
            @start_video="startWebcamStream"
            @start_audio="startAudioStream"
            @stop_video="stopWebcamStream"
            @stop_audio="stopAudioStream"
            @toggle_audio="onToggleAudioMute"
            @toggle_video="onToggleVideoVisibility"
        ></LocalStreamBtn>
        <LocalCaptureBtn
            :isCapturing="props.api.isCapturing.value"
            @start-stream="startScreenCapture"
            @stop-stream="stopScreenCapture">
        </LocalCaptureBtn>
    </div> 
</template>

<script setup>
import LocalStreamBtn from '~socializer/components/WebRTC2/Widgets/UI/Buttons/LocalStreamBtn.vue'
import LocalCaptureBtn from '~socializer/components/WebRTC2/Widgets/UI/Buttons/LocalCaptureBtn.vue'

const props = defineProps({
    api: { 
        type: Object, 
        required: false,
        default: null
    },
})

/**
 * Methodes de contrôle des flux locaux (webcam + audio) et de partage d’écran
 */

const startWebcamStream = () => {
    props.api.getWebcamStream()
}

const stopWebcamStream = () => {
    props.api.stopStream()
}

const startAudioStream = () => {
    props.api.getAudioStream()
}

const stopAudioStream = () => {
    props.api.stopAudio()
}

const startScreenCapture = () => {
    props.api.startCapture()
}

const stopScreenCapture = () => {
    props.api.stopCapture()
}

const onToggleAudioMute = () => {
    props.api.toggleAudioMute()
    props.api.sendData({
        roomId: props.api.onAirRoom.value,
        type: 'AUDIO_MUTE_TOGGLE', 
        isMuted: props.api.isMuted.value,
    })
}

const onToggleVideoVisibility = () => {
    props.api.toggleVideoVisibility()
    props.api.sendData({
        roomId: props.api.onAirRoom.value,
        type: 'VIDEO_ACTIVE_TOGGLE', 
        isActive: props.api.isVideoEnabled.value,
    })
}
</script>