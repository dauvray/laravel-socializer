<template>
    <MediaBroadcastPlayer
        :streamData="props.streamData"
        :muted="api.isMuted.value"
        :videoActive="videoActive">
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

/*
 * Pas de `v-bind="$attrs"` sur `<MediaBroadcastPlayer>` : la racine est un composant unique, donc
 * Vue applique déjà les attributs de fallthrough sur lui. Le `v-bind` explicite qui vivait là les
 * appliquait une SECONDE fois, ce qui était idempotent et donc invisible ; retiré le 31/08/2026
 * après 0 cas rougis, comme chez le jumeau `RemoteMediaPlayer`.
 *
 * ⚠️ Il ne faisait pas que doubler : il **masquait la sensibilité du harnais**. Mesuré ici,
 * `inheritAttrs: false` ajouté rougissait 0 cas tant que le `v-bind` était là — il rendait les
 * attributs de toute façon — contre 1 cas chez le jumeau, qui ne l'avait plus. Une ligne
 * redondante n'est donc pas seulement du bruit : elle peut désarmer le test qui garde le voisin.
 *
 * ⚠️ Deux gestes anodins casseraient cette transparence, et ce commentaire est dans le SCRIPT
 * pour cette raison : `inheritAttrs: false`, et **un commentaire HTML placé dans le `<template>`
 * avant la racine** — le composant devient alors multi-racine et Vue cesse de faire descendre les
 * attributs. Le cas qui garde les deux est « un attribut du consommateur atteint la racine du
 * player », dans `LocalMediaPlayer.test.js`.
 */

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