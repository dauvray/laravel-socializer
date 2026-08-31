import { ref, reactive, computed } from 'vue'
import { vi } from 'vitest'

/**
 * Double de l'API rendue par `useMediaBroadcast`, réduit à ce que consomment les boutons de
 * flux local (`GroupLocalStreamBtn` et ses deux enfants).
 *
 * Partagé par `GroupLocalStreamBtn.test.js` et `GroupLocalStreamBtn.permission.test.js` :
 * un seul double, donc une seule liste de fidélités à tenir. Les voici, toutes vérifiées
 * sur la production — les défaire rend des tests verts pour la mauvaise raison :
 *
 *   1. **Les trois démarrages sont `async` en amont.** `usePeerOrchestrator` les `await`
 *      (`startWebcamStream` l. 249, `startAudioStream` l. 284, `startScreenCapture` l. 295)
 *      et `useMediaBroadcast` rend leur promesse (l. 180-196). Un double synchrone ferait
 *      disparaître du harnais tout le traitement du refus de permission.
 *   2. **`isMuted` et `streamStates.isMuted` sont le MÊME fait.** En production, deux
 *      `computed` sur `context.ui.streamStates` (`createPeerContext.js:331,333`) : le
 *      contexte réel ne peut pas les faire diverger. Deux `ref` indépendantes seraient un
 *      mock qui ment, et « l'annonce porte l'état d'après » serait vert par accident.
 *   3. **Les deux bascules sont synchrones.** `usePeerOrchestrator.js:328,341` écrit
 *      `isMuted = !isMuted` sans `await`, donc le composant lit bien l'état d'APRÈS quand il
 *      compose son annonce. Le double bascule donc vraiment.
 *   4. **`currentRoom` est un leurre**, distinct d'`onAirRoom` : sans une seconde room,
 *      « l'annonce part dans la bonne room » et « l'annonce part dans une room » sont le
 *      même vert.
 *   5. **`currentStream` et `screenStream` portent les flux EUX-MÊMES, pas des copies.**
 *      `LocalMediaPlayer` distingue les deux par **identité de référence**
 *      (`props.streamData.stream === api.screenStream.value`) : un double qui rendrait un
 *      clone à chaque lecture ferait échouer la comparaison sur du code correct, et un
 *      double qui rendrait le même objet pour les deux flux la ferait réussir toujours.
 *      Les deux valent `null` par défaut — l'état hors diffusion, où les `v-if` de
 *      `StreamSimpleUI` ne montent aucun player local.
 *
 * @param {{isStreaming?: boolean, isCapturing?: boolean, isMuted?: boolean, isVideoEnabled?: boolean, currentStream?: Object, screenStream?: Object}} etatInitial
 */
export const createMediaApiDouble = ({
    isStreaming = false,
    isCapturing = false,
    currentStream = null,
    screenStream = null,
    ...etatsInit
} = {}) => {
    // Une seule source pour les deux pistes, comme `context.ui.streamStates`.
    const etats = reactive({ isMuted: false, isVideoEnabled: true, ...etatsInit })

    return {
        isStreaming: ref(isStreaming),
        isCapturing: ref(isCapturing),
        currentStream: ref(currentStream),
        screenStream: ref(screenStream),
        streamStates: computed(() => etats),
        isMuted: computed(() => etats.isMuted),
        isVideoEnabled: computed(() => etats.isVideoEnabled),

        onAirRoom: ref('room-a-l-antenne'),
        currentRoom: ref('room-logique'), // leurre : jamais celle de l'annonce

        getWebcamStream: vi.fn().mockResolvedValue({ id: 'flux-webcam' }),
        getAudioStream: vi.fn().mockResolvedValue({ id: 'flux-audio' }),
        startCapture: vi.fn().mockResolvedValue({ id: 'flux-ecran' }),
        stopStream: vi.fn(),
        stopAudio: vi.fn(),
        stopCapture: vi.fn(),
        toggleAudioMute: vi.fn(() => { etats.isMuted = !etats.isMuted }),
        toggleVideoVisibility: vi.fn(() => { etats.isVideoEnabled = !etats.isVideoEnabled }),
        sendData: vi.fn(),

        _etats: etats,
    }
}

/** Tous les verbes que l'API expose aux boutons — support de l'assertion négative. */
export const VERBES_MEDIA = [
    'getWebcamStream', 'getAudioStream', 'startCapture',
    'stopStream', 'stopAudio', 'stopCapture',
    'toggleAudioMute', 'toggleVideoVisibility',
]
