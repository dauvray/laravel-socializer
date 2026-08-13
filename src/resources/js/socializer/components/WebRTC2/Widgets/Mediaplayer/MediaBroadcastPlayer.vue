<template>
    <div class="draggable-video" 
        ref="container"
        v-resize="resizeOptions"
        v-draggable="draggableOptions"
        @pointerdown="onBringToFront">
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

        <div class="video-controls">
            <slot name="controls" :streamData="props.streamData" :controls="controls">
                <button v-if="!props.streamData.metadata?.isMe" 
                    type="button" 
                    class="btn" 
                    :class="{'btn-primary': !nativeMuted, 'btn-secondary': nativeMuted}" 
                    @click="onToggleNativeMute">
                    {{ nativeMuted ? 'Unmute' : 'Mute' }}
                </button>
                <button class="btn btn-primary" @click="controls.toggleFullscreen">Fullscreen</button>
                <button class="btn btn-primary" @click="controls.togglePip">PIP</button>
            </slot>
        </div>
        
    </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
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

const player = ref(null) // référence au composant vidéo/audio pour les contrôles (fullscreen, pip...)
const container = ref(null) // référence à la div englobante pour les fonctionnalités de déplacement/redimensionnement

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

// L'instance est recyclée d'un flux à l'autre par le pool (cf. PlayerHost) : sans ça,
// le mute natif choisi par l'utilisateur sur le flux précédent resterait actif sur le
// suivant. Repasser par le ref (et non par el.muted) laisse Vue repatcher le binding.
watch(() => props.streamData?.stream, () => {
    nativeMuted.value = false
})

const onBringToFront = (event) => {
    if (!props.draggable) return
    const el = event.currentTarget.closest('.is-draggable')
    if (!el) return
    
    const siblings = document.querySelectorAll('.is-draggable')
    let maxZ = 0
    siblings.forEach(sib => {
        const z = parseInt(window.getComputedStyle(sib).zIndex) || 0
        if (z > maxZ) maxZ = z
    })
    el.style.zIndex = maxZ + 1
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