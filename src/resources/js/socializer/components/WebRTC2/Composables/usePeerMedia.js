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

    const startWebcamStream = async (options) => {
        const stream = await navigator.mediaDevices.getUserMedia(options)

        ctx.currentStream.value = stream
        ctx.onAirRoom.value = ctx.currentRoom.value

        ctx.peerStore.saveStream(
            ctx.onAirRoom.value,
            stream,
            ctx.currentType.value
        )
    }

    const stopCurrentStream = () => {
        ctx.currentStream.value?.getTracks().forEach(t => t.stop())
        ctx.currentStream.value = null
    }

    return {
        startWebcamStream,
        stopCurrentStream,
    }
}