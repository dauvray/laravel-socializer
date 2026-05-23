<template>
    <MediaBroadcastPlayer
        :streamData="props.streamData"
        :muted="muted"
        :videoActive="videoActive"
        v-bind="$attrs">
        <template v-for="(_, name) in $slots" #[name]="slotData">
            <slot :name="name" v-bind="slotData ?? {}" />
        </template>
    </MediaBroadcastPlayer>
</template>

<script setup>
import { computed } from 'vue'
import MediaBroadcastPlayer from '~socializer/components/WebRTC2/Widgets/Mediaplayer/MediaBroadcastPlayer.vue'
import { useRemotePeerState } from '~socializer/components/WebRTC2/Widgets/Mediaplayer/Composables/useRemotePeerState.js'

const props = defineProps({
    streamData: { type: Object, required: true },
})

const peerId = computed(() => props.streamData.metadata?.peerId)
const { muted, videoActive } = useRemotePeerState(peerId)
</script>