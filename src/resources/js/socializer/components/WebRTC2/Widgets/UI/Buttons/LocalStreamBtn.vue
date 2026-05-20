<template>
    <div class="btn-group btn-group-sm" role="group">
        <template v-if="!isStreaming">
            <button
                class="btn btn-sm btn-primary dropdown-toggle"
                type="button"
                data-bs-toggle="dropdown"
                aria-expanded="false">
                <IconWidget icon="broadcast-tower" /> Streaming
            </button>
            <ul class="dropdown-menu">
                <li>
                    <a class="dropdown-item"
                        href="#"
                        @click.prevent="onStartVideoCall">
                        <IconWidget icon="video" /> Stream vidéo
                    </a>
                </li>
                <li>
                    <a class="dropdown-item"
                        href="#"
                        @click.prevent="onStartAudioCall">
                        <IconWidget icon="phone" /> Stream audio
                    </a>
                </li>
            </ul>
        </template>
        <template v-else >
            <button
                type="button"
                id="stop-stream-btn"
                class="btn btn-sm btn-danger"
                @click="onStopBroadcastWebcam">
                <IconWidget icon="window-close" /> Stop stream
            </button>

            <button
                type="button"
                class="btn btn-sm"
                :class="[props.streamStates.isMuted ? 'btn-secondary' : 'btn-primary']"
                @click="onToggleAudio">
                <IconWidget v-if="props.streamStates.isMuted" icon="microphone" title="activer le son" />
                <IconWidget v-else icon="microphone-slash" title="couper le son" />
            </button>
            <button 
                type="button" 
                class="btn btn-sm"
                :class="[props.streamStates.isVideoEnabled ? 'btn-primary' : 'btn-secondary']"
                @click="onToggleVideo">
                <IconWidget v-if="!props.streamStates.isVideoEnabled" icon="video" title="activer la caméra"></IconWidget>
                <IconWidget v-else icon="video-slash" title="couper la caméra"></IconWidget>
            </button>
        </template>
    </div>
</template>

<script setup>
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'

    const props = defineProps({
        isStreaming: {
            type: Boolean,
            required: true,
        },
        streamStates: {
            type: Object,
            required: true,
        }
    })

    const emit = defineEmits(['start_video', 'start_audio', 'stop_video', 'toggle_audio'])

    const onStartVideoCall = () => {
        emit('start_video')
    }

    const onStartAudioCall = () => {
        emit('start_audio')
    }

    const onStopBroadcastWebcam = () => {
        emit('stop_video')
    }

    const onToggleAudio = () => {
        emit('toggle_audio')
    }

    const onToggleVideo = () => {
        emit('toggle_video')
    }

</script>