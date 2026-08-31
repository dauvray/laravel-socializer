import { ref, reactive, computed } from 'vue'
import { vi } from 'vitest'

/**
 * Double de l'API rendue par `useMediaBroadcast`, réduit à ce que consomme
 * `System/Notifications.vue`.
 *
 * Partagé par `Notifications.test.js` (les signaux d'appel entrants) et
 * `Notifications.callControls.test.js` (le joint avec `CallManagerBtn`) : un seul double, donc
 * **une seule liste de fidélités à tenir**. Les voici, toutes vérifiées sur la production — les
 * défaire rend des tests verts pour la mauvaise raison :
 *
 *   1. **`callStatus` doit être RÉACTIF.** Il est lu dans un `computed`
 *      (`Notifications.vue:71`), et en production `ctx.callStatus` est un `computed` ref
 *      (`createPeerContext.js:289`). Un `vi.fn(() => 'calling')` figé n'y crée aucune
 *      dépendance : le composant ne se re-rend jamais sur un changement d'état, et tout cas qui
 *      fait varier l'appel reste vert sur un rendu mort. Mesuré — c'était le cas avant le lot F.
 *   2. **`isMuted` / `isVideoEnabled` et les bascules sont le MÊME fait.** En production, deux
 *      `computed` sur `context.ui.streamStates` (`createPeerContext.js:331,333`) que le contexte
 *      réel ne peut pas faire diverger. Deux `ref` indépendantes seraient un mock qui ment, et
 *      « le bouton montre l'état d'après » serait vert par accident.
 *   3. **Les deux bascules sont SYNCHRONES.** `usePeerOrchestrator.js:328,341` écrit
 *      `isMuted = !isMuted` sans `await`, donc le rendu lit bien l'état d'APRÈS. Le double
 *      bascule donc vraiment.
 *   4. **`startCallWithPeer` RÉSOUT un inviteId.** Depuis la fermeture du cul-de-sac CALLING
 *      (lot F), elle rend `null` sur ses refus et l'appelant en déduit qu'il doit rejouer le
 *      chemin du refus. Un double qui résout `undefined` ferait passer TOUS les cas nominaux par
 *      le chemin d'échec, sans le dire.
 *   5. **`inviteAbandonedSignal` est un VRAI ref** : le composant l'observe par `watch` et c'est
 *      lui qui le remet à null.
 *
 * ⚠️ `vi.clearAllMocks()` ne touche ni un `ref` ni un `reactive` — il ne remet à zéro que des
 * compteurs d'appels. D'où `reinitialiser()`, à appeler en `beforeEach` AVANT le montage.
 */
export const createCallPeersDouble = () => {
    const statutAppel = ref('calling')
    const etatsFlux = reactive({ isMuted: false, isVideoEnabled: true })

    const api = {
        initialize: vi.fn(),
        handleStreamReceived: vi.fn(),
        handleStreamRemoved: vi.fn(),
        callStatus: vi.fn(() => statutAppel.value),
        isCallInProgress: vi.fn(() => true),
        isInviteDuplicate: vi.fn(() => false),
        stopCallInviteRetry: vi.fn(),
        clearAllCallInviteRetries: vi.fn(),
        clearSeenInvites: vi.fn(),
        openCallBetweenPeer: vi.fn(async () => {}),
        acceptCallFromPeer: vi.fn(async () => {}),
        startCallWithPeer: vi.fn(async () => 'invite-1'),
        stopCallWithPeers: vi.fn(async () => {}),
        currentCallUsers: ref([]),
        inviteAbandonedSignal: ref(null),

        // Bascules de flux local, exposées à `CallManagerBtn` pendant un appel.
        isMuted: computed(() => etatsFlux.isMuted),
        isVideoEnabled: computed(() => etatsFlux.isVideoEnabled),
        toggleAudioMute: vi.fn(() => { etatsFlux.isMuted = !etatsFlux.isMuted }),
        toggleVideoVisibility: vi.fn(() => { etatsFlux.isVideoEnabled = !etatsFlux.isVideoEnabled }),
    }

    const reinitialiser = () => {
        api.inviteAbandonedSignal.value = null
        api.currentCallUsers.value = []
        statutAppel.value = 'calling'
        etatsFlux.isMuted = false
        etatsFlux.isVideoEnabled = true
    }

    return { api, statutAppel, etatsFlux, reinitialiser }
}

/** Les verbes que `Notifications` peut appeler sur l'API — support de l'assertion négative. */
export const VERBES_APPEL = [
    'openCallBetweenPeer', 'acceptCallFromPeer', 'startCallWithPeer', 'stopCallWithPeers',
    'toggleAudioMute', 'toggleVideoVisibility',
]
