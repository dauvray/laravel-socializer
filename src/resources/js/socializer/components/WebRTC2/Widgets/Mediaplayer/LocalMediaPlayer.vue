<template>
    <MediaBroadcastPlayer
        :streamData="props.streamData"
        :muted="api.isMuted.value"
        :videoActive="api.isVideoEnabled.value"
        v-bind="$attrs">
        <!-- forward de tous les slots scopés vers le composant interne -->
        <template v-for="(_, name) in $slots" #[name]="slotData">
            <slot :name="name" v-bind="slotData ?? {}" />
        </template>
    </MediaBroadcastPlayer>
</template>

<script setup>
import { inject } from 'vue'
import MediaBroadcastPlayer from '~socializer/components/WebRTC2/Widgets/Mediaplayer/MediaBroadcastPlayer.vue'
import { WEBRTC_API_KEY } from '~socializer/components/WebRTC2/webrtc2.config.js'

const props = defineProps({
    streamData: { type: Object, required: true },
})

const api = inject(WEBRTC_API_KEY, null)
if (!api) {
    throw new Error('LocalMediaPlayer requiert un MediaBroadcastProvider en parent')
}
</script>