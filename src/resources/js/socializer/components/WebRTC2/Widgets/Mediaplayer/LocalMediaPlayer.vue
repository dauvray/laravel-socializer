<template>
    <MediaBroadcastPlayer
        :streamData="props.streamData"
        :muted="api.isMuted.value"
        :videoActive="videoActive"
        v-bind="$attrs">
        <!-- forward de tous les slots scopés vers le composant interne -->
        <template v-for="(_, name) in $slots" #[name]="slotData">
            <slot :name="name" v-bind="slotData ?? {}" />
        </template>
    </MediaBroadcastPlayer>
</template>

<script setup>
import { inject, computed } from 'vue'
import MediaBroadcastPlayer from '~socializer/components/WebRTC2/Widgets/Mediaplayer/MediaBroadcastPlayer.vue'
import { WEBRTC_API_KEY } from '~socializer/components/WebRTC2/webrtc2.config.js'

const props = defineProps({
    streamData: { type: Object, required: true },
})

const api = inject(WEBRTC_API_KEY, null)
if (!api) {
    throw new Error('LocalMediaPlayer requiert un MediaBroadcastProvider en parent')
}

// isVideoEnabled ne concerne que la webcam locale ; pour le partage d'écran
// (référence identique à api.screenStream), on garde toujours la vidéo active.
const isScreenStream = computed(() =>
    !!props.streamData.stream && props.streamData.stream === api.screenStream.value
)
const videoActive = computed(() =>
    isScreenStream.value ? true : api.isVideoEnabled.value
)
</script>