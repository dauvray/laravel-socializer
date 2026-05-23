<template>
    <div class="draggable-video" 
        v-resize="resizeOptions"
        v-draggable="draggableOptions">
        
        <slot v-if="props.videoActive" name="video" :streamData="props.streamData">
            <VideoPlayer
                ref="player"
                :srcObject="props.streamData.stream"
                :controls="false"
                :autoplay="true"
                :muted="isLocallyMuted"
                :playsinline="true"
            />
        </slot>
        <slot v-else name="audio" :streamData="props.streamData">
            <AudioPlayer 
                ref="player"
                :srcObject="props.streamData.stream"
                :controls="true"
                :autoplay="true"
                :loop="false"
                :muted="props.streamData.metadata?.isMe || false"
            ></AudioPlayer>
        </slot>

        <div class="video-tools-wrapper">
            <div class="video-tools">
                <span class="user-info">
                    {{ props.streamData.metadata?.fromName || 'Inconnu' }}
                    <template v-if="props.streamData.metadata?.currentType !== 'visio'">
                        <IconWidget icon="eye"></IconWidget> 
                        {{ props.streamData.metadata?.countViewers || 0 }}
                    </template>
                    <IconWidget v-if="props.muted" icon="microphone-slash"></IconWidget>
                </span>
            </div>
        </div>

        <slot name="controls">
            <div class="video-controls">
                <button v-if="!props.streamData.metadata?.isMe" 
                    type="button" 
                    class="btn" 
                    :class="{'btn-primary': !nativeMuted, 'btn-secondary': nativeMuted}" 
                    @click="onToggleNativeMute">
                    {{ nativeMuted ? 'Unmute' : 'Mute' }}
                </button>
                <button @click="controls.toggleFullscreen">Fullscreen</button>
                <button @click="controls.togglePip">PIP</button>
            </div>
        </slot>
    </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import VideoPlayer from '~estarter/components/widgets/VideoPlayer.vue'
import AudioPlayer from '~estarter/components/widgets/AudioPlayer.vue'
import IconWidget from '~estarter/components/widgets/IconWidget.vue'
import resizeDirective from '~socializer/directives/resizable.js'
import draggableDirective from '~socializer/directives/draggable.js'
import { useMediaControls } from '~socializer/components/WebRTC2/Widgets/Mediaplayer/Composables/useMediaControls.js'

const props = defineProps({
    streamData: { type: Object, required: true },
    muted: { type: Boolean, default: false },        // état applicatif (signal/api)
    videoActive: { type: Boolean, default: true },
    resizable: { type: Boolean, default: false },
    draggable: { type: Boolean, default: false },
})

const vResize = resizeDirective
const vDraggable = draggableDirective

const player = ref(null)
const controls = useMediaControls(player)
const nativeMuted = ref(false)  // mute "côté navigateur" pour l'utilisateur local

// si c'est mon propre flux, on mute toujours localement (sinon écho)
const isLocallyMuted = computed(() => 
    props.streamData.metadata?.isMe || nativeMuted.value
)

const onToggleNativeMute = () => {
    const m = controls.toggleNativeMute()
    if (m !== null) nativeMuted.value = m
}

const resizeOptions = {
    resizable: props.resizable,
    corner: 'top-right',
    wrapperId: props.streamData?.metadata?.roomId || 'app',
    minSize: { width: 200, height: 112 },
    maxSize: { width: 800, height: 450 },
}
const draggableOptions = { draggable: props.draggable }
</script>