/**
 * useMediaBroadcast.surface.test.js — le contrat façade ↔ orchestrateur
 *
 * `useMediaBroadcast.test.js` double l'orchestrateur en entier, et ce choix a un prix précis :
 * **un double définit la surface**, donc il ne peut pas voir un renommage en amont. Or c'est
 * exactement le mode de panne de cette couche. La façade déstructure ~55 clés de
 * `usePeerOrchestrator` et les ré-expose ; une clé renommée là-haut ne lève rien, ne se
 * journalise pas, et devient un `undefined` ré-exporté qui ne se manifeste qu'au premier
 * appel d'un consommateur — donc en production. Le paquet a déjà payé ce mode de panne sur
 * `usersInRoom` → `remotePeers`, dont l'item avait gardé une parade explicite.
 *
 * Ce fichier est cette parade. Il ne teste aucun comportement : il monte l'orchestrateur
 * RÉEL et vérifie que rien de ce que la doc annonce et que les consommateurs appellent n'est
 * `undefined`, et que les états restent des refs (les déballer casserait la réactivité de
 * tous les widgets, silencieusement là encore).
 *
 * ⚠️ Les deux listes ci-dessous ne sont pas décoratives : ce sont les seules assertions du
 * fichier. Les tenir à jour quand la façade s'étend fait partie du geste, sans quoi elles
 * garderaient un contrat périmé.
 *
 * ── Choix d'infra ─────────────────────────────────────────────────────────────
 *
 * Contexte, stores et couches RÉELS ; seul PeerJS est mocké — même arbitrage que les quatre
 * fichiers de `usePeerOrchestrator` : les dix sous-modules sont des imports ESM statiques,
 * les doubler ne testerait plus que des espions, et ici cela reviendrait à écrire le contrat
 * des deux côtés. `withSetup` est obligatoire : `createPeerContext` `inject`e l'eventBus et
 * pose `onBeforeMount` / `onUnmounted`.
 *
 * Aucun `Peer` n'est démarré : lire la surface n'exige pas d'`initializePeerConnection`, et
 * une init laissée en vol emporterait un minuteur au-delà du test.
 *
 * ── CONTRÔLES DE HARNAIS (convention du paquet), mesurés le 2026-08-29 ────────
 *
 *    1. une clé renommée dans le `return` de l'orchestrateur
 *       (`remotePeers` → `peers`) ........................................ 2 cas
 *    2. un ref déballé par la façade (`remoteStreams: remoteStreams.value`) . 1 cas
 *
 * ⚠️ **Le n° 1 a été joué contre les TROIS fichiers de `useMediaBroadcast`, et il ne rougit
 * que dans celui-ci.** `useMediaBroadcast.test.js` et `.watchUsers.test.js` restent verts :
 * ils doublent l'orchestrateur, donc le renommage n'existe pas pour eux. C'est la mesure qui
 * justifie ce fichier — sans lui, la clé disparaîtrait de la façade sans qu'aucun des 1189
 * cas de la suite ne bouge.
 *
 * Le n° 2 ne rougit qu'un cas, et pas celui qu'on croit : `remoteStreams.value` est un
 * tableau, donc **défini**. Le garde générique « rien n'est `undefined` » le laisse passer,
 * et seule l'assertion `isRef` l'attrape. Retirer cette assertion en la jugeant redondante
 * rouvrirait le trou.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { isRef } from 'vue'
import { withSetup } from './helpers/withSetup.js'
import { mockEventBus } from './helpers/mockEventBus.js'
import { resetPeerMock } from './__mocks__/peerjs.js'
import { useMediaBroadcast } from '~socializer/components/WebRTC2/Composables/useMediaBroadcast.js'
import { usePeer2Store } from '~socializer/stores/peers2.js'
import { useMeStore } from '~estarter/stores/me.js'

/**
 * Les verbes annoncés par `docs/modules/webrtc2/api.md` § « Niveau 2 ».
 * Ceux marqués d'un site d'appel sont en plus exercés en production : les perdre casserait
 * ce fichier-là, et rien d'autre ne le dirait avant l'exécution.
 *
 * ⚠️ **`stopAudio` n'a plus aucun site d'appel dans le paquet** depuis le 2026-08-30. Son seul
 * câblage (`@stop_audio` de `GroupLocalStreamBtn` vers `onStopAudioCall` de `LocalStreamBtn`)
 * était mort — aucun élément du template de l'enfant ne l'émettait —, et il a été supprimé
 * (sortie B). Le verbe reste ici parce qu'il fait partie de la surface publique qu'une app
 * hôte peut appeler ; rien n'est perdu côté interface, « Stop stream » couvrant aussi le flux
 * audio seul, et `usePeerOrchestrator.stopAudioStream` n'étant qu'un alias de
 * `stopWebcamStream`. Épinglé par `GroupLocalStreamBtn.test.js` § « aucun chemin de
 * l'interface n'atteint `stopAudio` ».
 */
const EXPECTED_VERBS = [
    'initialize',                 // Notifications.vue:226, MediaBroadcastProvider.vue:50
    'cleanup',                    // MediaBroadcastProvider.vue:56
    'watchUsers',                 // MediaBroadcastProvider.vue:63
    'sendData',                   // GroupLocalStreamBtn.vue:116, :125, useChatSimple.js:113
    'getWebcamStream',            // GroupLocalStreamBtn.vue:89
    'stopStream',                 // GroupLocalStreamBtn.vue:93
    'getAudioStream',             // GroupLocalStreamBtn.vue:97
    'stopAudio',                  // AUCUN site d'appel dans le paquet (voir ci-dessous)
    'startCapture',               // GroupLocalStreamBtn.vue:107
    'stopCapture',                // GroupLocalStreamBtn.vue:111
    'toggleAudioMute',            // GroupLocalStreamBtn.vue:115
    'toggleVideoVisibility',      // GroupLocalStreamBtn.vue:124
    'startCallWithPeer',          // Notifications.vue:221
    'acceptCallFromPeer',         // Notifications.vue:194
    'openCallBetweenPeer',        // Notifications.vue:125, :182
    'stopCallWithPeers',          // Notifications.vue:217, :242
    'remoteStopCall',             // Notifications.vue:132
    'handleStreamReceived',       // Notifications.vue:227
    'handleStreamRemoved',        // Notifications.vue:228
    'createVideoElement',
    'removeVideoElement',
    'setCurrentCallRoomId',
    'ensureCurrentCallRoomId',
    'announceBroadcastState',
    'stopCallInviteRetry',        // Notifications.vue:109
    'clearAllCallInviteRetries',  // Notifications.vue:249
    'clearSeenInvites',           // Notifications.vue:250
    'isInviteDuplicate',          // Notifications.vue:82
    'callStatus',                 // Notifications.vue:71
    'isCallInProgress',           // Notifications.vue:241
]

/** Les états annoncés par `api.md`. Tous des refs/computed du contexte. */
const EXPECTED_STATE = [
    'callState',
    'callInprogress',
    'inviteAbandonedSignal',      // Notifications.vue:168 — observé par `watch`
    'localPeerId',
    'currentType',
    'currentRoom',
    'currentCallRoomId',
    'currentCallUsers',           // Notifications.vue:214
    'onAirRoom',                  // GroupLocalStreamBtn.vue:64
    'topology',
    'hubSlug',
    'isHub',
    'isHubConnected',
    'remotePeers',
    'presenceSynced',
    'currentStream',
    'screenStream',
    'isStreaming',
    'isCapturing',
    'isAudioStream',
    'remoteStreams',
    'remoteScreens',
    'announcedStreamPeers',
    'isMuted',                    // GroupLocalStreamBtn.vue:66
    'isVideoEnabled',             // GroupLocalStreamBtn.vue:75
    'streamStates',
    'mySlug',
    'myName',
]

describe('useMediaBroadcast — contrat de surface avec l\'orchestrateur réel', () => {
    let apps
    let api

    beforeEach(() => {
        apps = []
        resetPeerMock()

        const meStore = useMeStore()
        meStore.user = { slug: 'me', name: 'Me' }
        usePeer2Store()

        vi.spyOn(console, 'log').mockImplementation(() => {})
        vi.spyOn(console, 'info').mockImplementation(() => {})
        vi.spyOn(console, 'debug').mockImplementation(() => {})
        vi.spyOn(console, 'warn').mockImplementation(() => {})

        const [instance, app] = withSetup(
            () => useMediaBroadcast('stream', 'app'),
            { provides: { eventBus: mockEventBus() } }
        )
        apps.push(app)
        api = instance
    })

    afterEach(() => {
        apps.forEach((app) => { try { app.unmount() } catch { /* déjà démontée */ } })
        vi.restoreAllMocks()
    })

    it.each(EXPECTED_VERBS)('expose le verbe %s', (verb) => {
        // `toBe('function')` et pas `toBeDefined()` : une clé renommée en amont donne
        // `undefined`, mais une clé qui deviendrait un ref donnerait un objet — les deux
        // cassent l'appelant, et seul le type les distingue.
        expect(typeof api[verb]).toBe('function')
    })

    it.each(EXPECTED_STATE)('expose l\'état %s, et le garde réactif', (key) => {
        expect(api[key]).toBeDefined()

        // Déballer un ref dans la façade (`x.value` au lieu de `x`) rendrait une valeur
        // figée : tous les widgets afficheraient l'instantané de la construction, sans
        // qu'aucune erreur ne soit levée nulle part.
        expect(isRef(api[key])).toBe(true)
    })

    it('n\'expose rien qui soit `undefined`', () => {
        // Le garde générique : il couvre aussi ce que les deux listes oublieraient.
        const undefinedKeys = Object.entries(api)
            .filter(([, value]) => value === undefined)
            .map(([key]) => key)

        expect(undefinedKeys).toEqual([])
    })
})
