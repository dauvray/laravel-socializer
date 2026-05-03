/**
 * 🎬 useMediaBroadcast (Feature Layer - métier)
 *
 * 👉 gère :
 * - logique fonctionnelle de broadcast (stream, screen, audio/video call)
 * - états UI métier (isMuted, isVideoEnabled, etc.)
 * - orchestration des actions utilisateur (start/stop/toggle)
 * - synchronisation des utilisateurs (join → connexions)
 *
 * 👉 utilise :
 * - usePeerOrchestrator (API technique)
 *
 * 👉 ne connaît PAS :
 * - détails internes de WebRTC / PeerJS
 * - structure du peerStore
 *
 * 👉 rôle :
 * - transformer des intentions utilisateur en actions techniques
 * - rester découplé de l’infrastructure
 */

import { usePeerOrchestrator } from '~socializer/components/WebRTC2/Composables/usePeerOrchestrator.js'

export function useMediaBroadcast(type = 'data', room = 'app') {

    const {
        initializePeerConnection,
        syncUsersConnections,
        currentMode, // type de broadcast (stream, screen, audio/video call)
        currentRoom, // room "logique" (peut différer de onAirRoom si on gère plusieurs rooms)
        onAirRoom, // room dans laquelle le peer est actif (peut différer de currentRoom si on gère plusieurs rooms)
    } = usePeerOrchestrator( type, room)

    /*---------------------
        * Logique métier
    ----------------------*/

    function initialize(callbacks) {
        initializePeerConnection(callbacks)
    }
    // watch users list to sync connections when new user join the room
    function watchUsers(newVal) {
        try {
            if(newVal && newVal.length === 0) {
                return
            }

            syncUsersConnections(newVal)

            // TODO : a faire si un broadcast est en cours (isStreaming || isCapturing) → syncJoingingUsers(newVal)
            // if (isStreaming.value || isCapturing.value) {
            //     syncJoingingUsers(newVal)
            // }
        } catch (e) {
            console.error(e)
        }
    }

    return {
        // system
         initialize,
         watchUsers,

        // // stream


        // // screen


        // Context
        currentMode,
        currentRoom,
        onAirRoom,
    }
}