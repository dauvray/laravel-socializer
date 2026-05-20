<template>
    <div class="card">
        <div class="card-body">

            <LocalStreamBtn
                :isStreaming="props.api.isStreaming.value"
                :streamStates="props.api.streamStates.value"
                @start_video="startWebcamStream"
                @start_audio="startWebcamStream"
                @stop_video="stopWebcamStream"
                @toggle_audio="onToggleAudioMute"
                @toggle_video="onToggleVideoVisibility"
            ></LocalStreamBtn>
            
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
                </div>
                <div class="col">
                    <VideoComponent v-for="(remoteStream, index) in remoteStreamsData" :key="index" :streamData="remoteStream"></VideoComponent>
                </div>
            </div>
        </div>
    </div>
   
</template>

<script setup>
    import { ref, computed } from 'vue'
    import VideoComponent from '~socializer/components/WebRTC2/Widgets/VideoComponent.vue' 
    import LocalStreamBtn from '~socializer/components/WebRTC2/Widgets/UI/Buttons/LocalStreamBtn.vue'

    const props = defineProps({
        api: Object,
    })

    const startWebcamStream = () => {
        props.api.getWebcamStream(true)
    }

    const stopWebcamStream = () => {
        props.api.stopStream()
    }

    const onToggleAudioMute = () => {
        props.api.toggleAudioMute()
    }

    const onToggleVideoVisibility = () => {
        props.api.toggleVideoVisibility()
    }

    const localStreamData = computed(() => ({ 
        stream: props.api.currentStream.value,
        metadata: {
            fromName: props.api.myName.value,
            roomId: props.api.onAirRoom.value,
            countViewers: props.api.usersInRoom.value.length,
            currentType: props.api.currentType.value,
            isMe: true,
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

</script>