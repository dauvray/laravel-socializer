/**
 * 🎥 usePeerMedia (Media Layer)
 * 
 * lifecycle des MediaStream (getUserMedia / displayMedia)
 *
 * 👉 gère :
 * - création des MediaStream (getUserMedia, getDisplayMedia)
 * - arrêt des streams
 * - état local des flux (currentStream)
 *
 * 👉 ne gère PAS :
 * - ouverture de connexions peer
 * - synchronisation entre utilisateurs
 *
 * 👉 rôle :
 * - abstraction pure des flux audio/vidéo
 * - isoler toute dépendance navigateur (MediaDevices API)
 * 
 * 
 * Fonctions concernées :
 * ----------------------
 * startWebcamStream
 * startVisioStream
 * startScreenCapture
 *
 * stopVideoStream
 * stopUserVisioStream
 * stopAllVisioStream
 *
 * stopCurrentStream
 * updateVideoProps
 *
 * resolveAnswerStream
 */
import { watch } from 'vue'

export function usePeerMedia(ctx) {

    const startWebcamStream = async (is_local = false) => {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: ctx.ui.streamStates.isVideoEnabled,
            audio: !ctx.ui.streamStates.isMuted,
        })

        stream.isLocal = is_local // to mute local sound in player

        ctx.media.currentStream = stream
       

        // ctx.peerStore.saveStream(
        //     ctx.onAirRoom.value,
        //     stream,
        //     ctx.currentType.value
        // )
    }

    const stopCurrentStream = () => {
        ctx.media.currentStream?.getTracks().forEach(t => t.stop())
        ctx.media.currentStream = null
    }

    return {
        startWebcamStream,
        stopCurrentStream,
    }
}