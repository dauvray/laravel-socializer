<template>
    <MediaBroadcastPlayer
        :streamData="props.streamData"
        :muted="muted"
        :videoActive="videoActive">
        <template v-for="(_, name) in $slots" #[name]="slotData">
            <slot :name="name" v-bind="slotData ?? {}" />
        </template>
    </MediaBroadcastPlayer>
</template>

<script setup>
import { computed } from 'vue'
import MediaBroadcastPlayer from '~socializer/components/WebRTC2/Widgets/Mediaplayer/MediaBroadcastPlayer.vue'
import { useRemotePeerState } from '~socializer/components/WebRTC2/Widgets/Mediaplayer/Composables/useRemotePeerState.js'

/*
 * Pas de `v-bind="$attrs"` sur `<MediaBroadcastPlayer>` : la racine est un composant unique, donc
 * Vue applique déjà les attributs de fallthrough sur lui — et les résout en props s'ils en portent
 * le nom. Le `v-bind` explicite qui vivait là les appliquait une SECONDE fois, ce qui était
 * idempotent et donc invisible ; il a été retiré après mesure (0 cas rougis, trois passes).
 *
 * ⚠️ Deux gestes anodins casseraient cette transparence, et ce commentaire est dans le SCRIPT
 * pour cette raison : `inheritAttrs: false`, et **un commentaire HTML placé dans le `<template>`
 * avant la racine** — le composant devient alors multi-racine et Vue cesse de faire descendre les
 * attributs. Mesuré : les deux rougissent le cas « un attribut du consommateur atteint la racine
 * du player » de `RemoteMediaPlayer.test.js`. Le jumeau `LocalMediaPlayer.vue` porte encore le
 * `v-bind` redondant ; il n'est couvert par aucun test, il se traitera avec lui.
 */
const props = defineProps({
    streamData: { type: Object, required: true },
})

const peerId = computed(() => props.streamData.metadata?.peerId)
const { muted, videoActive } = useRemotePeerState(peerId)
</script>