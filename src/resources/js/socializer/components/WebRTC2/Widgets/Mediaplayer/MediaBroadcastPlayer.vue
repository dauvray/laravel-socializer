<template>
    <div class="draggable-video"
        v-resize="resizeOptions"
        v-draggable="draggableOptions"
        @pointerdown="onBringToFront">
        <template v-if="props.videoActive">
            <slot name="video" :streamData="props.streamData">
                <VideoPlayer
                    ref="player"
                    :srcObject="props.streamData.stream"
                    :controls="false"
                    :autoplay="true"
                    :muted="isLocallyMuted"
                    :playsinline="true"
                    @can-play="isBuffering = false"
                    @playing="isBuffering = false"
                    @waiting="isBuffering = true"
                    @stalled="isBuffering = true"
                    @error="isBuffering = false"
                />
            </slot>
            <div v-if="showSpinner" class="video-loading" aria-live="polite">
                <Spinner1 color="#ffffff" />
                <span class="video-loading-label">Connexion au flux…</span>
            </div>
        </template>
        <slot v-else name="audio" :streamData="props.streamData">
            <AudioPlayer
                ref="player"
                :srcObject="props.streamData.stream"
                :controls="true"
                :autoplay="true"
                :loop="false"
                :muted="isLocallyMuted"
            ></AudioPlayer>
        </slot>

        <div class="video-tools-wrapper">
            <div class="video-tools">
                <span class="user-info">
                    {{ props.streamData.metadata?.fromName || 'Inconnu' }}
                    <!--
                        Le compteur n'a de sens qu'en DIFFUSION, où un flux a une audience.
                        Il n'appartient donc pas au player : seul le consommateur sait
                        compter son audience, et il le dit en fournissant `countViewers`.
                        Le laisser dépendre du type (`!== 'visio'`) l'affichait à 0 sur tous
                        les autres appels directs (vocal, écran), qui n'en fournissent aucun.
                    -->
                    <template v-if="showViewersCount">
                        <IconWidget icon="eye"></IconWidget>
                        {{ props.streamData.metadata.countViewers }}
                    </template>
                    <IconWidget v-if="props.muted" icon="microphone-slash"></IconWidget>
                </span>
            </div>
        </div>

        <div class="video-controls">
            <slot name="controls" :streamData="props.streamData" :controls="controls">
                <!--
                    Contrôles de la branche vidéo uniquement : useMediaControls pilote
                    l'élément exposé en `nativeVideo`, que l'AudioPlayer n'a pas — hors
                    vidéo, ces boutons seraient inertes. Le plein écran et le PIP n'ont de
                    toute façon pas de sens sur un <audio>, qui porte déjà ses propres
                    contrôles natifs (dont le mute).

                    Ce n'est pas une préférence mais une nécessité, et elle est mesurée :
                    `AudioPlayer` expose `nativeAudio` (et non `nativeVideo`), donc la
                    sentinelle `null` de `_getEl()` est STRUCTURELLE sur toute la branche
                    audio — slot fourni ou pas. Épinglé des deux côtés dans
                    `MediaBroadcastPlayer.controls.test.js`, par la paire de cas sur le
                    slot `#controls` : il coupe le son en vidéo, il ne coupe rien en audio.
                -->
                <template v-if="props.videoActive">
                    <button v-if="!props.streamData.metadata?.isMe"
                        type="button"
                        class="btn"
                        :class="{'btn-primary': !nativeMuted, 'btn-secondary': nativeMuted}"
                        @click="onToggleNativeMute">
                        {{ nativeMuted ? 'Unmute' : 'Mute' }}
                    </button>
                    <button class="btn btn-primary" @click="controls.toggleFullscreen">Fullscreen</button>
                    <button class="btn btn-primary" @click="controls.togglePip">PIP</button>
                </template>
            </slot>
        </div>
        
    </div>
</template>

<script setup>
import { ref, computed, watch, useSlots } from 'vue'
import VideoPlayer from '~estarter/components/widgets/VideoPlayer.vue'
import AudioPlayer from '~estarter/components/widgets/AudioPlayer.vue'
import IconWidget from '~estarter/components/widgets/IconWidget.vue'
import Spinner1 from '~estarter/components/widgets/Spinners/Spinner1.vue'
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
// Pas de ref sur la div englobante : les directives v-resize / v-draggable reçoivent leur
// élément par le contrat de directive et stockent leur état sur lui (`el._resizeDirective`).
// Un `ref="container"` a vécu ici, jamais lu, entretenu par un commentaire qui le disait
// nécessaire au déplacement — retiré le 31/08/2026 après 0 cas rougis.

const slots = useSlots()

const controls = useMediaControls(player)
const nativeMuted = ref(false)  // mute "côté navigateur" pour l'utilisateur local

// Attente d'image : vrai jusqu'à ce que le <video> annonce pouvoir jouer.
const isBuffering = ref(true)

// Le spinner n'a de sens que si un flux est réellement attendu sur ce slot.
// ⚠️ Neutralisé quand le consommateur fournit son propre slot `video` : nos écouteurs
// `can-play` ne seraient alors jamais branchés et le spinner tournerait à vie.
// ⚠️ Cette condition teste la FORME du slot, pas ce qui est réellement monté : Vue retombe
// sur notre repli quand le slot ne rend que des commentaires (`ensureValidVNode`), et nos
// écouteurs sont alors bien branchés — le spinner est éteint pour une raison qui a cessé
// d'exister. Sans symptôme aujourd'hui (aucun consommateur ne fournit `#video`) ; le
// correctif visé est la sentinelle elle-même, `!!player.value` — item de `work/`.
const showSpinner = computed(() =>
    isBuffering.value
    && props.videoActive
    && !!props.streamData?.stream
    && !slots.video
)

// Audience du flux : affichée seulement si le consommateur en fournit une
// (`0` reste une valeur légitime — « personne ne regarde »).
const showViewersCount = computed(() =>
    props.streamData.metadata?.countViewers != null
)

// Si c'est mon propre flux, on mute toujours localement (sinon écho).
// ⚠️ Les DEUX branches le lisent, et c'est ce qui fait survivre le mute à l'extinction de
// la caméra : le pair coupe sa vidéo, `videoActive` bascule, l'<audio> se monte — et sans
// ce partage il se montait NON muté, on réentendait le pair sans pouvoir le recouper (le
// bouton Mute n'existe pas sur cette branche, seuls les contrôles natifs de l'<audio>).
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
    // Même raison pour le spinner : sur une instance recyclée, l'ancien `can-play` avait
    // déjà éteint l'attente — sans ce reset, le flux suivant s'afficherait sans spinner.
    isBuffering.value = true
    // Et le PiP / plein écran, qui eux ne sont pas des états Vue : ils survivraient au
    // recyclage et afficheraient le flux suivant sous l'identité du précédent.
    controls.releasePresentation()
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