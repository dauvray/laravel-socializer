<template>
    <div class="btn-group btn-group-sm" role="group">
        <LocalStreamBtn
            :isStreaming="props.api.isStreaming.value"
            :streamStates="props.api.streamStates.value"
            @start_video="startWebcamStream"
            @start_audio="startAudioStream"
            @stop_video="stopWebcamStream"
            @toggle_audio="onToggleAudioMute"
            @toggle_video="onToggleVideoVisibility"
        ></LocalStreamBtn>
        <LocalCaptureBtn
            :isCapturing="props.api.isCapturing.value"
            @start-stream="startScreenCapture"
            @stop-stream="stopScreenCapture">
        </LocalCaptureBtn>
    </div> 
</template>

<script setup>
import { inject } from 'vue'
import LocalStreamBtn from '~socializer/components/WebRTC2/Widgets/UI/Buttons/LocalStreamBtn.vue'
import LocalCaptureBtn from '~socializer/components/WebRTC2/Widgets/UI/Buttons/LocalCaptureBtn.vue'

const props = defineProps({
    api: {
        type: Object,
        // Requis, et sans défaut : le template déréférence `props.api.isStreaming.value` dès
        // le rendu, donc un défaut `null` ne protégeait rien — il remplaçait seulement
        // « Missing required prop: api » par un `Cannot read properties of null` opaque, à
        // trois composants du câblage fautif.
        required: true,
    },
})

// Optionnel par contrat, comme `inject(REVERB_CHANNEL, null)` de MediaBroadcastProvider — et
// NON comme `inject('AWN')` de CallRemotePeerBtn, qui injecte sans repli.
//
// ⚠️ Ce que le défaut `null` fait, et ce qu'il ne fait PAS (mesuré) : il n'évite aucun
// plantage — un inject nu rendrait `undefined` et le repli `?? window.AWN` marcherait pareil.
// Il évite un « injection "AWN" not found » de Vue à chaque montage sur un chemin où
// l'absence est normale : les sous-apps montées par `createApp()` dans `usePeerMedia` ne
// fournissent pas `AWN`. Épinglé par « monter sans fournisseur d'AWN n'est pas un incident ».
const AWN = inject('AWN', null)

/**
 * Prévient l'utilisateur qu'un démarrage de flux a échoué.
 *
 * C'est le DERNIER maillon : `usePeerMedia` appelle `getUserMedia`/`getDisplayMedia` nus,
 * l'orchestrateur les `await` nus, et `useMediaBroadcast` se contente de rendre la promesse.
 * Si le rejet n'est pas traité ici, il ne l'est nulle part — et il disparaît alors sans
 * aucune trace : le handler ne rendant pas la promesse, Vue lui-même ne la voit pas.
 *
 * Le nom de l'erreur est dans le message parce que deux causes fréquentes appellent des
 * gestes OPPOSÉS — ré-autoriser, ou brancher un périphérique — et parce que c'est la seule
 * prise qu'aura un ticket de support.
 *
 * @param {DOMException|Error} err
 * @param {{silenceSiRefus?: boolean}} options
 */
const signalerEchecMedia = (err, { silenceSiRefus = false } = {}) => {
    // `getDisplayMedia` rejette avec le même `NotAllowedError` que l'utilisateur refuse la
    // permission ou qu'il ferme simplement le sélecteur de partage : les deux sont
    // indiscernables. Se raviser est un geste normal — le notifier serait du bruit.
    // Décision du 2026-08-30, et le seul cas où un NotAllowedError reste silencieux.
    if (silenceSiRefus && err?.name === 'NotAllowedError') {
        return
    }

    const notifieur = AWN ?? window.AWN
    if (!notifieur) {
        return
    }

    const causes = {
        NotAllowedError: 'autorisez l’accès dans votre navigateur, puis réessayez',
        NotFoundError: 'aucun périphérique disponible',
        NotReadableError: 'le périphérique est déjà utilisé par une autre application',
    }

    notifieur.alert(`${err?.name ?? 'Erreur'} : ${causes[err?.name] ?? 'le flux n’a pas pu démarrer'}`)
}

/**
 * Methodes de contrôle des flux locaux (webcam + audio) et de partage d’écran
 */

const startWebcamStream = () => {
    props.api.getWebcamStream().catch(signalerEchecMedia)
}

const stopWebcamStream = () => {
    props.api.stopStream()
}

const startAudioStream = () => {
    props.api.getAudioStream().catch(signalerEchecMedia)
}

// Pas de `stopAudioStream` ici : `LocalStreamBtn` n'a aucun élément qui émette `stop_audio`,
// et « Stop stream » suffit — il s'affiche dès que `isStreaming` est vrai, flux audio seul
// compris, et `stopAudio` n'est de toute façon qu'un alias de `stopStream`
// (`usePeerOrchestrator.stopAudioStream` appelle `stopWebcamStream`). Épinglé par le cas
// « aucun chemin de l'interface n'atteint stopAudio ».

const startScreenCapture = () => {
    props.api.startCapture().catch((err) => signalerEchecMedia(err, { silenceSiRefus: true }))
}

const stopScreenCapture = () => {
    props.api.stopCapture()
}

const onToggleAudioMute = () => {
    props.api.toggleAudioMute()
    props.api.sendData({
        roomId: props.api.onAirRoom.value,
        type: 'AUDIO_MUTE_TOGGLE', 
        isMuted: props.api.isMuted.value,
    })
}

const onToggleVideoVisibility = () => {
    props.api.toggleVideoVisibility()
    props.api.sendData({
        roomId: props.api.onAirRoom.value,
        type: 'VIDEO_ACTIVE_TOGGLE', 
        isActive: props.api.isVideoEnabled.value,
    })
}
</script>