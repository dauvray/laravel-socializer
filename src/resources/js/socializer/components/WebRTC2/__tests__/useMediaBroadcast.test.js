/**
 * useMediaBroadcast.test.js — ce que la façade possède en propre
 *
 * ⚠️ **L'énoncé de la tâche 7 décrivait un fichier qui n'existe pas.** Il annonçait un test
 * « bout en bout » des flux d'appel ; or `useMediaBroadcast` n'écrit aucun de ces flux. Sur
 * ses 288 lignes, ~110 sont une déstructuration de `usePeerOrchestrator`, ~90 un `return`
 * qui la ré-expose, et 11 wrappers d'une ligne. `startCallWithPeer`, `acceptCallFromPeer`,
 * `openCallBetweenPeer`, `stopCallWithPeers`, `remoteStopCall`, `handleStreamReceived` et
 * `handleStreamRemoved` sont des passthroughs **verbatim** : les tester ici asserterait une
 * identité de référence, pas un comportement — le doublon exact que la tâche 6 a évité.
 *
 * **Où sont parties les cases qui semblent manquer ici** — huit étaient des doublons stricts de
 * cas existants, trois n'étaient couvertes que par morceaux, et une était FAUSSE :
 *   - lifecycle du data channel → `usePeerOrchestrator.callbacks` (init), `useConnectionPool`
 *     (sync), `usePeerOrchestrator.teardown` (cleanup), et les `scenarios/` pour la séquence ;
 *   - `sendDataToPeer` / `onDataReceived` → `usePeerOrchestrator.media` et `.broadcastPresence`,
 *     `usePeerTransport.mesh` et `.star`, `createPeerContext` ;
 *   - flux initiateur et récepteur complets → `useCallManager` § « le cycle complet » ;
 *   - refus d'appel (`status: false`), `remoteStopCall`, `close-call` → `useCallManager` ;
 *   - `handleStreamReceived` modes `stream` / `visio` → `useStreamManager` +
 *     `usePeerOrchestrator.callbacks` ;
 *   - `handleStreamRemoved` → `useStreamManager`, et **c'est là que l'énoncé était faux** : elle
 *     ne supprime plus le videoElement depuis l'extraction des couches, ce que
 *     `useStreamManager.test.js` épingle à l'envers. L'écrire tel qu'annoncé aurait produit un
 *     test rouge contre le code voulu — et, pire, une « correction » du code pour le faire passer.
 *
 * Trois propriétés vivent ici et nulle part ailleurs :
 *
 *   1. **la mémoire d'invitations** — `usePeerCore.requestAuthorizationRemotePeerId` renvoie
 *      le MÊME `inviteId` à chaque tentative du moteur de retry (l'objet `data` repart tel
 *      quel dans `scheduleRetry`). L'appelé reçoit donc N `.AlertToUser` identiques, et ce
 *      `Set` est la seule chose qui empêche N modales empilées (`Notifications.vue:82`) ;
 *   2. **le renommage des verbes** — la façade rebaptise 11 verbes de l'orchestrateur. Le
 *      seul défaut qu'elle peut porter seule est un câblage croisé, et il serait muet ;
 *   3. **l'attendabilité des trois démarrages de flux** — ils sont `async` en amont, donc
 *      leur promesse doit revenir à l'appelant, sinon un refus de permission caméra part en
 *      rejet non traité, sans que le bouton puisse en savoir quoi que ce soit.
 *
 * Le try/catch de `watchUsers` est couvert par `useMediaBroadcast.watchUsers.test.js` — il
 * n'est pas rejoué ici.
 *
 * ── Choix d'infra ─────────────────────────────────────────────────────────────
 *
 * Orchestrateur doublé **en entier**, même idiome que `useMediaBroadcast.watchUsers.test.js` :
 * derrière lui il n'y a que des passthroughs, et le monter réellement ferait payer le prix
 * d'un contexte complet pour observer des `vi.fn()`. Le prix de ce choix est réel et il est
 * payé ailleurs : un double définit la surface, donc il ne peut pas voir un renommage en
 * amont — c'est `useMediaBroadcast.surface.test.js` qui tient ce contrat-là.
 *
 * `useMediaBroadcast` n'enregistre aucun hook de lifecycle Vue : il s'appelle directement,
 * sans `withSetup`.
 *
 * ── CONTRÔLES DE HARNAIS (convention du paquet), mesurés le 2026-08-29 ────────
 *
 *    1. le refus du doublon court-circuité (`seenInviteIds.has`) .......... 2 cas
 *    2. la mémorisation retirée (`seenInviteIds.add`) .................... 2 cas
 *    3. le garde « invitation sans id » retiré ........................... 3 cas
 *    4. `clearSeenInvites` vidé .......................................... 1 cas
 *    5. le `Set` hissé au niveau du MODULE (partagé entre instances) ..... 1 cas
 *    6. `stopAudio` recâblé sur `stopWebcamStream` ....................... 1 cas
 *    7. le défaut `destUserSlugs = null` de `sendData` retiré ............ 1 cas
 *    8. le `return` de `getWebcamStream` retiré .......................... 2 cas
 *
 * Aucun n'a rougi zéro cas. Le n° 8 est celui qui a été vu rouge le premier, avant
 * correction : les trois `return` absents faisaient tomber 4 cas d'un coup.
 *
 * ⚠️ Le n° 6 ne rougit qu'UN cas et c'est normal, pas un trou : le croisement inverse
 * (`stopStream` recâblé sur `stopAudioStream`) est symétrique et couvert par le même
 * `it.each`. Ce qui le rend détectable est l'assertion négative sur les dix autres verbes —
 * sans elle, « arrête un flux » et « arrête LE BON flux » donnent le même vert.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useMediaBroadcast } from '~socializer/components/WebRTC2/Composables/useMediaBroadcast.js'

/**
 * Les 11 verbes de l'orchestrateur que la façade rebaptise, dans l'ordre du fichier.
 * Sert deux fois : à construire le double, et à vérifier qu'un wrapper n'en appelle
 * qu'UN — un câblage croisé (`stopAudio` → `stopWebcamStream`) est invisible autrement.
 */
const RENAMED_VERBS = {
    initialize: 'initializePeerConnection',
    cleanup: 'cleanupPeerConnection',
    sendData: 'sendDataToPeer',
    getWebcamStream: 'startWebcamStream',
    stopStream: 'stopWebcamStream',
    getAudioStream: 'startAudioStream',
    stopAudio: 'stopAudioStream',
    startCapture: 'startScreenCapture',
    stopCapture: 'stopScreenCapture',
    toggleAudioMute: 'toggleAudioState',
    toggleVideoVisibility: 'toggleVideoState',
}

/** Les trois verbes `async` en amont (`usePeerOrchestrator.js`). */
const ASYNC_VERBS = ['getWebcamStream', 'getAudioStream', 'startCapture']

const orchestratorDouble = {
    syncUsersConnections: vi.fn(),
    initializePeerConnection: vi.fn(),
    cleanupPeerConnection: vi.fn(),
    sendDataToPeer: vi.fn(),
    // ⚠️ Les trois démarrages sont `async` en production. Un double synchrone ferait
    // disparaître le seul défaut que cette couche peut porter — c'est le piège
    // « un double qui normalise une valeur de retour » de docs/modules/webrtc2/tests.md.
    startWebcamStream: vi.fn(async () => 'webcam'),
    stopWebcamStream: vi.fn(),
    startAudioStream: vi.fn(async () => 'audio'),
    stopAudioStream: vi.fn(),
    startScreenCapture: vi.fn(async () => 'screen'),
    stopScreenCapture: vi.fn(),
    toggleAudioState: vi.fn(),
    toggleVideoState: vi.fn(),
}

// Le double est déréférencé à l'APPEL, pas à l'import : la fabrique de `vi.mock` est
// hoistée au-dessus des déclarations du fichier, un `() => orchestratorDouble` direct
// lèverait en TDZ. Même idiome que `useMediaBroadcast.watchUsers.test.js`.
vi.mock('~socializer/components/WebRTC2/Composables/usePeerOrchestrator.js', () => ({
    usePeerOrchestrator: () => orchestratorDouble,
}))

describe('useMediaBroadcast — la façade', () => {
    let api

    beforeEach(() => {
        // ⚠️ On réinitialise les mocks, on ne les REMPLACE pas : `useMediaBroadcast`
        // déstructure ses verbes une fois pour toutes à la construction, et ses closures
        // garderaient l'ancienne référence. Pour changer le comportement d'un seul cas,
        // `mockImplementationOnce` / `mockRejectedValueOnce` sur ce même mock.
        vi.clearAllMocks()
        api = useMediaBroadcast('data', 'room-1')
    })

    // ── La mémoire d'invitations ──────────────────────────────────────────────

    describe('déduplication des invitations', () => {
        it('laisse passer un inviteId jamais vu', () => {
            expect(api.isInviteDuplicate('invite-1')).toBe(false)
        })

        it('⭐ refuse le même inviteId au second passage — le retry renvoie le MÊME id', () => {
            // La régression à empêcher. `requestAuthorizationRemotePeerId` construit son
            // objet `data` UNE fois puis le renvoie tel quel à chaque tentative : l'appelé
            // voit donc N `.AlertToUser` porteurs du même inviteId. Sans ce refus, N modales.
            api.isInviteDuplicate('invite-1')

            expect(api.isInviteDuplicate('invite-1')).toBe(true)
            expect(api.isInviteDuplicate('invite-1')).toBe(true)
        })

        it('garde deux invitations distinctes indépendantes', () => {
            // ⚠️ Le second id n'est pas décoratif : avec une seule invitation en mémoire,
            // « refuse ce qu'il a déjà vu » et « refuse tout après le premier appel » sont
            // indiscernables. Ne pas le retirer « pour simplifier ».
            api.isInviteDuplicate('invite-1')

            expect(api.isInviteDuplicate('invite-2')).toBe(false)
            expect(api.isInviteDuplicate('invite-1')).toBe(true)
        })

        it.each([
            ['undefined', undefined],
            ['null', null],
            ['une chaîne vide', ''],
        ])('laisse passer une invitation sans id (%s) et ne la mémorise pas', (_label, id) => {
            // Une alerte sans inviteId n'est pas une invitation d'appel (`.AlertToUser` sert
            // aussi à autre chose). La mémoriser ferait taire toutes les suivantes : le
            // second appel doit rester `false`.
            expect(api.isInviteDuplicate(id)).toBe(false)
            expect(api.isInviteDuplicate(id)).toBe(false)
        })

        it('clearSeenInvites rend un id déjà vu à nouveau neuf', () => {
            api.isInviteDuplicate('invite-1')
            api.isInviteDuplicate('invite-2')

            api.clearSeenInvites()

            // Les DEUX : un `delete` ciblé passerait un test à un seul id.
            expect(api.isInviteDuplicate('invite-1')).toBe(false)
            expect(api.isInviteDuplicate('invite-2')).toBe(false)
        })

        it('ne partage pas sa mémoire entre deux instances', () => {
            // Fait de production : `Notifications.vue` construit sa propre instance
            // (`useMediaBroadcast()` sans argument), distincte de celle du provider. Un `Set`
            // hissé au niveau du module ferait taire les invitations de l'autre instance.
            const other = useMediaBroadcast('data', 'room-2')

            api.isInviteDuplicate('invite-1')

            expect(other.isInviteDuplicate('invite-1')).toBe(false)
        })
    })

    // ── Le renommage des verbes ───────────────────────────────────────────────

    describe('wrappers', () => {
        it.each(Object.entries(RENAMED_VERBS))(
            '%s appelle %s, et lui seul',
            (facadeVerb, orchestratorVerb) => {
                api[facadeVerb]()

                expect(orchestratorDouble[orchestratorVerb]).toHaveBeenCalledTimes(1)

                // Le câblage croisé est le seul défaut que cette couche peut porter seule,
                // et il serait muet : `stopAudio` branché sur `stopWebcamStream` arrête bien
                // « un » flux. D'où l'assertion négative sur les dix autres.
                Object.values(RENAMED_VERBS)
                    .filter((verb) => verb !== orchestratorVerb)
                    .forEach((verb) => {
                        expect(orchestratorDouble[verb]).not.toHaveBeenCalled()
                    })
            }
        )

        it('initialize transmet les callbacks tels quels', () => {
            const callbacks = { onDataReceived: vi.fn(), onStreamReceived: vi.fn() }

            api.initialize(callbacks)

            expect(orchestratorDouble.initializePeerConnection).toHaveBeenCalledWith(callbacks)
        })

        it('sendData sans destinataires transmet `null` explicitement', () => {
            // Le défaut par défaut vit sur la façade (`destUserSlugs = null`), pas en amont :
            // un appel à un seul argument laisserait `undefined` remonter au transport, dont
            // le repli « toute la room » ne se lit que sur `null`.
            api.sendData({ message: 'hello' })

            expect(orchestratorDouble.sendDataToPeer).toHaveBeenCalledWith(
                { message: 'hello' },
                null
            )
        })

        it('sendData transmet la liste complète des destinataires', () => {
            // ⚠️ Deux destinataires, pas un : avec un seul, « transmet la liste » et
            // « transmet le premier » donnent le même vert.
            api.sendData({ message: 'hello' }, ['alice', 'bob'])

            expect(orchestratorDouble.sendDataToPeer).toHaveBeenCalledWith(
                { message: 'hello' },
                ['alice', 'bob']
            )
        })
    })

    // ── L'attendabilité des démarrages de flux ────────────────────────────────

    describe('démarrages de flux', () => {
        it.each(ASYNC_VERBS)('%s rend la promesse du démarrage à son appelant', async (verb) => {
            const returned = api[verb]()

            expect(returned).toBeInstanceOf(Promise)
            await expect(returned).resolves.toBeDefined()
        })

        it('⭐ un refus de permission média remonte à l\'appelant', async () => {
            // Le cas vécu de tout démarrage de flux : l'utilisateur refuse la caméra.
            // `getUserMedia` rejette, et rien ne l'attrape sur toute la chaîne
            // (`usePeerMedia.startCurrentStream` l'appelle nu). Si la façade jette la
            // promesse, ce rejet devient un « unhandled rejection » : pas de toast, pas de
            // changement d'état, un bouton qui semble mort.
            const refus = new DOMException('Permission denied', 'NotAllowedError')
            orchestratorDouble.startWebcamStream.mockRejectedValueOnce(refus)

            await expect(api.getWebcamStream()).rejects.toBe(refus)
        })
    })
})
