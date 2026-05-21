<template>
    <div class="card">
        <div class="card-body">
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
            <div class="row">
                <div class="col">
                    <h5>Local Stream</h5>
                </div>
                <div class="col">
                    <h5>Remote Streams</h5>
                </div>
            </div>
            <div class="row">
                <div class="col">
                    <VideoComponent v-if="props.api.currentStream.value" :streamData="localStreamData"></VideoComponent>
                    <VideoComponent v-if="props.api.screenStream.value" :streamData="screenStreamData"></VideoComponent>
                </div>
                <div class="col">
                    <VideoComponent v-for="(remoteStream, index) in remoteStreamsData" :key="index" :streamData="remoteStream"></VideoComponent>
                    <VideoComponent v-for="(remoteScreen, index) in remoteScreensData" :key="index" :streamData="remoteScreen"></VideoComponent>
                </div>
            </div>
        </div>
    </div>
   
</template>

<script setup>
    import { ref, computed } from 'vue'
    import VideoComponent from '~socializer/components/WebRTC2/Widgets/VideoComponent.vue' 
    import LocalStreamBtn from '~socializer/components/WebRTC2/Widgets/UI/Buttons/LocalStreamBtn.vue'
    import LocalCaptureBtn from '~socializer/components/WebRTC2/Widgets/UI/Buttons/LocalCaptureBtn.vue'

    const props = defineProps({
        api: Object,
    })

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
    }

    const onToggleVideoVisibility = () => {
        props.api.toggleVideoVisibility()
    }

   // const isAudioStream = computed(() => props.api.isAudioStream.value)

    const localStreamData = computed(() => ({ 
        stream: props.api.currentStream.value,
        metadata: {
            fromName: props.api.myName.value,
            roomId: props.api.onAirRoom.value,
            countViewers: props.api.usersInRoom.value.length,
            currentType: props.api.currentType.value,
            isMe: true,


            isAudioStream: !props.api.isVideoEnabled.value,
        }
    }))

    const screenStreamData = computed(() => ({ 
        stream: props.api.screenStream.value,
        metadata: {
            fromName: props.api.myName.value,
            roomId: props.api.onAirRoom.value,
            countViewers: props.api.usersInRoom.value.length,
            currentType: props.api.currentType.value,
            isMe: true,

            
            isAudioStream: !props.api.isVideoEnabled.value,
        }
    }))

    const remoteStreamsData = computed(() =>
        props.api.remoteStreams.value.map(rs => ({
            stream: rs.stream,
            metadata: {
                fromName: rs.metadata?.fromName || rs.remoteSlug || 'Unknown',
                roomId: rs.metadata?.room,
                countViewers: props.api.usersInRoom.value.length,
                currentType: rs.remoteType,
            }
        }))
    )

    const remoteScreensData = computed(() =>
        props.api.remoteScreens.value.map(rs => ({
            stream: rs.stream,
            metadata: {
                fromName: rs.metadata?.fromName || rs.remoteSlug || 'Unknown',
                roomId: rs.metadata?.room,
                countViewers: props.api.usersInRoom.value.length,
                currentType: 'screen',
            }
        }))
    )
</script>