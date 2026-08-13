/**
 * useCallManager.test.js — Couche appels
 *
 * Périmètre : cycle de vie d'un appel (invite → accept → open → stop → reset),
 * transitions de la FSM et gardes de concurrence. Toutes les couches dont dépend
 * le CallManager sont injectées sous forme de mocks — aucune dépendance à Vue
 * (le composable n'enregistre aucun hook de lifecycle), à PeerJS ni au DOM.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createMockContext } from './helpers/createMockContext.js'
import { useCallManager } from '~socializer/components/WebRTC2/Composables/useCallManager.js'
import { CALL_STATES } from '~socializer/components/WebRTC2/Composables/utils/useCallStateMachine.js'

describe('useCallManager', () => {
    let ctx
    let cm
    let core
    let media
    let connections
    let transport
    let pool

    beforeEach(() => {
        ctx = createMockContext()

        core = {
            requestAuthorizationRemotePeerId: vi.fn().mockResolvedValue('invite-1'),
            sendAuthorizationRemotePeerId: vi.fn().mockResolvedValue(undefined),
            notifyCloseConnectionToPeer: vi.fn().mockResolvedValue(undefined),
            stopCallInviteRetry: vi.fn(),
            stopCallInviteRetryForUser: vi.fn(),
            clearAllCallInviteRetries: vi.fn(),
        }
        media = {
            startCurrentStream: vi.fn().mockResolvedValue(undefined),
            stopCurrentStream: vi.fn(),
            createVideoElement: vi.fn(),
            removeVideoElement: vi.fn(),
            cleanupCallPlayers: vi.fn(),
        }
        connections = {
            closePeerConnection: vi.fn(),
        }
        transport = {
            setLocalPeer: vi.fn(() => true),
        }
        pool = {
            requestOrConnectPeer: vi.fn(),
            clearRetry: vi.fn(),
            clearAllRetries: vi.fn(),
        }

        cm = useCallManager(ctx, { core, media, connections, transport, pool })
    })

    // ── startCallWithPeer ───────────────────────────────────────────────────

    describe('startCallWithPeer', () => {

        it('ignore un payload absent ou non-objet', () => {
            cm.startCallWithPeer(null)
            cm.startCallWithPeer('alice')

            expect(transport.setLocalPeer).not.toHaveBeenCalled()
            expect(core.requestAuthorizationRemotePeerId).not.toHaveBeenCalled()
        })

        it('ignore un slug au format invalide', () => {
            cm.startCallWithPeer({ toUserSlug: 'not a slug!' })

            expect(transport.setLocalPeer).not.toHaveBeenCalled()
            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.IDLE)
        })

        it('n\'entreprend rien si le peer local n\'est pas prêt', () => {
            transport.setLocalPeer.mockReturnValue(false)

            cm.startCallWithPeer({ toUserSlug: 'alice' })

            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.IDLE)
            expect(ctx.session.currentCallRoomId).toBe(null)
            expect(core.requestAuthorizationRemotePeerId).not.toHaveBeenCalled()
        })

        it('passe en CALLING, prépare la session et envoie l\'invitation', () => {
            cm.startCallWithPeer({ toUserSlug: 'alice', type: 'visio' })

            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.CALLING)
            expect(ctx.session.currentCallRoomId).toBeTruthy()
            expect(ctx.session.currentCallUsers).toEqual([{ userSlug: 'alice', type: 'visio' }])
            expect(ctx.session.currentType).toBe('visio')
            expect(core.requestAuthorizationRemotePeerId).toHaveBeenCalledWith({
                toUserSlug: 'alice',
                type: 'visio',
            })
        })

        it('retombe sur visio quand le type est inconnu', () => {
            cm.startCallWithPeer({ toUserSlug: 'alice', type: 'hologramme' })

            expect(ctx.session.currentType).toBe('visio')
        })

        it('conserve un type d\'appel valide', () => {
            cm.startCallWithPeer({ toUserSlug: 'alice', type: 'vocal' })

            expect(ctx.session.currentType).toBe('vocal')
            expect(core.requestAuthorizationRemotePeerId).toHaveBeenCalledWith({
                toUserSlug: 'alice',
                type: 'vocal',
            })
        })

        it('ne mute AUCUN état si un appel est déjà en cours', () => {
            ctx.callMachine.transition(CALL_STATES.CALLING)
            core.requestAuthorizationRemotePeerId.mockClear()

            cm.startCallWithPeer({ toUserSlug: 'bob', type: 'visio' })

            expect(ctx.session.currentCallRoomId).toBe(null)
            expect(ctx.session.currentCallUsers).toEqual([])
            expect(core.requestAuthorizationRemotePeerId).not.toHaveBeenCalled()
        })

        it('accepte une room imposée par l\'appelant', () => {
            cm.startCallWithPeer({ toUserSlug: 'alice', type: 'visio', room: 'cours-101' })

            expect(ctx.session.currentCallRoomId).toBe('cours-101')
        })

        it('génère une room quand celle fournie est vide', () => {
            cm.startCallWithPeer({ toUserSlug: 'alice', type: 'visio', room: '   ' })

            expect(ctx.session.currentCallRoomId).toBeTruthy()
            expect(ctx.session.currentCallRoomId).not.toBe('   ')
        })
    })

    // ── acceptCallFromPeer ──────────────────────────────────────────────────

    describe('acceptCallFromPeer', () => {

        const invitePayload = (overrides = {}) => ({
            fromUserSlug: 'alice',
            status: true,
            options: { room: 'call-room-1', type: 'visio', peerId: 'peer-alice', inviteId: 'invite-1' },
            ...overrides,
        })

        it('enregistre le mapping peerId AVANT la transition d\'état', async () => {
            const transitionSpy = vi.spyOn(ctx.callMachine, 'transition')

            await cm.acceptCallFromPeer(invitePayload())

            expect(ctx.peerStore.addRemotePeerId).toHaveBeenCalledWith('alice', 'peer-alice')
            const mappingOrder = ctx.peerStore.addRemotePeerId.mock.invocationCallOrder[0]
            const transitionOrder = transitionSpy.mock.invocationCallOrder[0]
            expect(mappingOrder).toBeLessThan(transitionOrder)
        })

        it('ouvre la session locale et passe en RECEIVING', async () => {
            await cm.acceptCallFromPeer(invitePayload())

            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.RECEIVING)
            expect(ctx.session.currentCallRoomId).toBe('call-room-1')
            expect(ctx.session.currentCallUsers).toEqual([{ userSlug: 'alice', type: 'visio' }])
            expect(media.startCurrentStream).toHaveBeenCalledWith(true)
            expect(media.createVideoElement).toHaveBeenCalledWith(
                { videoId: 'local-webcam', type: 'visio', source: 'local' },
                ctx.media.currentStream
            )
        })

        it('répond toujours à l\'initiateur, inviteId inclus', async () => {
            await cm.acceptCallFromPeer(invitePayload())

            expect(core.sendAuthorizationRemotePeerId).toHaveBeenCalledWith(
                expect.objectContaining({
                    fromUserSlug: 'alice',
                    status: true,
                    options: expect.objectContaining({ inviteId: 'invite-1' }),
                })
            )
        })

        it('refus : répond sans ouvrir de session locale', async () => {
            await cm.acceptCallFromPeer(invitePayload({ status: false }))

            expect(media.startCurrentStream).not.toHaveBeenCalled()
            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.IDLE)
            expect(core.sendAuthorizationRemotePeerId).toHaveBeenCalledWith(
                expect.objectContaining({ status: false })
            )
        })

        it('n\'entreprend rien si le peer local n\'est pas prêt', async () => {
            transport.setLocalPeer.mockReturnValue(false)

            await cm.acceptCallFromPeer(invitePayload())

            expect(core.sendAuthorizationRemotePeerId).not.toHaveBeenCalled()
            expect(media.startCurrentStream).not.toHaveBeenCalled()
        })

        it('ignore un slug invalide dans une invitation acceptée', async () => {
            await cm.acceptCallFromPeer(invitePayload({ fromUserSlug: 'not a slug!' }))

            expect(media.startCurrentStream).not.toHaveBeenCalled()
            expect(core.sendAuthorizationRemotePeerId).not.toHaveBeenCalled()
        })

        it('abandonne si la FSM refuse la transition (appel déjà connecté)', async () => {
            ctx.callMachine.transition(CALL_STATES.CALLING)
            ctx.callMachine.transition(CALL_STATES.CONNECTED)

            await cm.acceptCallFromPeer(invitePayload())

            expect(media.startCurrentStream).not.toHaveBeenCalled()
            expect(core.sendAuthorizationRemotePeerId).not.toHaveBeenCalled()
        })

        it('retombe sur visio quand le type de l\'invitation est inconnu', async () => {
            await cm.acceptCallFromPeer(invitePayload({
                options: { room: 'r', type: 'hologramme', peerId: 'peer-alice' },
            }))

            expect(ctx.session.currentType).toBe('visio')
        })
    })

    // ── openCallBetweenPeer ─────────────────────────────────────────────────

    describe('openCallBetweenPeer', () => {

        const answerPayload = (overrides = {}) => ({
            fromUserSlug: 'alice',
            status: true,
            options: { room: 'call-room-1', type: 'visio', peerId: 'peer-alice' },
            ...overrides,
        })

        beforeEach(() => {
            // L'ouverture suit toujours une invitation émise
            cm.startCallWithPeer({ toUserSlug: 'alice', type: 'visio' })
            core.requestAuthorizationRemotePeerId.mockClear()
        })

        it('arrête le retry d\'invitation quel que soit le statut', async () => {
            await cm.openCallBetweenPeer(answerPayload())
            expect(core.stopCallInviteRetryForUser).toHaveBeenCalledWith('alice')

            core.stopCallInviteRetryForUser.mockClear()
            await cm.openCallBetweenPeer(answerPayload({ status: false }))
            expect(core.stopCallInviteRetryForUser).toHaveBeenCalledWith('alice')
        })

        it('passe en CONNECTED, ouvre la session et lance la connexion', async () => {
            await cm.openCallBetweenPeer(answerPayload())

            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.CONNECTED)
            expect(ctx.peerStore.removeWaitingRemotePeerId).toHaveBeenCalledWith('alice')
            expect(ctx.peerStore.addRemotePeerId).toHaveBeenCalledWith('alice', 'peer-alice')
            expect(media.startCurrentStream).toHaveBeenCalledWith(true)
            expect(pool.requestOrConnectPeer).toHaveBeenCalledWith('alice')
        })

        it('refus du distant : retire l\'user et ferme tout s\'il était le dernier', async () => {
            await cm.openCallBetweenPeer(answerPayload({ status: false }))

            expect(ctx.session.currentCallUsers).toEqual([])
            expect(connections.closePeerConnection).toHaveBeenCalledWith(
                expect.objectContaining({ clearSignalQueue: true })
            )
            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.IDLE)
        })

        it('refus du distant : ne ferme pas l\'appel s\'il reste des participants', async () => {
            ctx.addCurrentCallUser('bob', 'visio')

            await cm.openCallBetweenPeer(answerPayload({ status: false }))

            expect(ctx.session.currentCallUsers).toEqual([{ userSlug: 'bob', type: 'visio' }])
            expect(connections.closePeerConnection).not.toHaveBeenCalled()
            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.CALLING)
        })

        it('ignore un slug invalide', async () => {
            await cm.openCallBetweenPeer(answerPayload({ fromUserSlug: 'not a slug!' }))

            expect(media.startCurrentStream).not.toHaveBeenCalled()
            expect(pool.requestOrConnectPeer).not.toHaveBeenCalled()
        })
    })

    // ── stopCallWithPeers ───────────────────────────────────────────────────

    describe('stopCallWithPeers', () => {

        beforeEach(() => {
            // Appel actif : CALLING → CONNECTED
            cm.startCallWithPeer({ toUserSlug: 'alice', type: 'visio' })
            ctx.callMachine.transition(CALL_STATES.CONNECTED)
            connections.closePeerConnection.mockClear()
        })

        it('partial : ferme le pair sans toucher à l\'état global', async () => {
            await cm.stopCallWithPeers([{ userSlug: 'alice', type: 'visio' }], false, { mode: 'partial' })

            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.CONNECTED)
            expect(pool.clearRetry).toHaveBeenCalledWith('alice')
            expect(ctx.peerStore.removeWaitingRemotePeerId).toHaveBeenCalledWith('alice')
            expect(connections.closePeerConnection).toHaveBeenCalledWith({
                room: ctx.session.currentCallRoomId,
                type: 'visio',
                users: ['alice'],
                clearSignalQueue: false,
            })
            expect(media.stopCurrentStream).not.toHaveBeenCalled()
            expect(ctx.isShuttingDown.value).toBe(false)
        })

        it('partial : notifie le pair quand notifyRemote est vrai', async () => {
            const roomId = ctx.session.currentCallRoomId

            await cm.stopCallWithPeers([{ userSlug: 'alice', type: 'visio' }], true, { mode: 'partial' })

            expect(core.notifyCloseConnectionToPeer).toHaveBeenCalledWith({
                toUserSlug: 'alice',
                type: 'visio',
                room: roomId,
            })
        })

        it('normalise les users fournis avec `slug` au lieu de `userSlug`', async () => {
            await cm.stopCallWithPeers([{ slug: 'alice' }], false, { mode: 'partial' })

            expect(connections.closePeerConnection).toHaveBeenCalledWith(
                expect.objectContaining({ users: ['alice'] })
            )
        })

        it('full : exécute le cleanup dans l\'ordre et revient à IDLE', async () => {
            await cm.stopCallWithPeers([], false)

            expect(pool.clearAllRetries).toHaveBeenCalled()
            expect(connections.closePeerConnection).toHaveBeenCalledWith({
                room: expect.any(String),
                type: 'visio',
                clearSignalQueue: true,
            })
            expect(media.stopCurrentStream).toHaveBeenCalled()
            expect(media.removeVideoElement).toHaveBeenCalledWith('local-webcam')
            expect(media.cleanupCallPlayers).toHaveBeenCalled()

            // Ordre : retries → fermeture → arrêt du stream → reset des players
            const order = [
                pool.clearAllRetries.mock.invocationCallOrder[0],
                connections.closePeerConnection.mock.invocationCallOrder[0],
                media.stopCurrentStream.mock.invocationCallOrder[0],
                media.cleanupCallPlayers.mock.invocationCallOrder[0],
            ]
            expect(order).toEqual([...order].sort((a, b) => a - b))

            expect(ctx.session.currentCallRoomId).toBe(null)
            expect(ctx.session.currentCallUsers).toEqual([])
            expect(ctx.media.remoteStreamsMap.size).toBe(0)
            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.IDLE)
            expect(ctx.isShuttingDown.value).toBe(false)
        })

        it('full : la transition CLOSING sert de mutex (un second stop est refusé)', async () => {
            await cm.stopCallWithPeers([], false)
            connections.closePeerConnection.mockClear()

            // Depuis IDLE, la FSM refuse CLOSING → aucun second cleanup
            await cm.stopCallWithPeers([], false)

            expect(connections.closePeerConnection).not.toHaveBeenCalled()
        })

        it('full : une exception ne laisse pas la FSM coincée en CLOSING', async () => {
            connections.closePeerConnection.mockImplementation(() => {
                throw new Error('close failed')
            })

            await expect(cm.stopCallWithPeers([], false)).rejects.toThrow('close failed')

            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.IDLE)
        })

        it('full : notifie tous les pairs quand notifyRemote est vrai', async () => {
            await cm.stopCallWithPeers([{ userSlug: 'alice' }, { userSlug: 'bob' }], true)

            expect(core.notifyCloseConnectionToPeer).toHaveBeenCalledTimes(2)
        })

        it('full : ne notifie personne quand notifyRemote est faux', async () => {
            await cm.stopCallWithPeers([{ userSlug: 'alice' }], false)

            expect(core.notifyCloseConnectionToPeer).not.toHaveBeenCalled()
        })
    })

    // ── remoteStopCall ──────────────────────────────────────────────────────

    describe('remoteStopCall', () => {

        const hangupPayload = (overrides = {}) => ({
            fromUserSlug: 'alice',
            type: 'visio',
            room: 'call-room-1',
            ...overrides,
        })

        beforeEach(() => {
            cm.startCallWithPeer({ toUserSlug: 'alice', type: 'visio' })
            ctx.callMachine.transition(CALL_STATES.CONNECTED)
            ctx.media.remoteStreamsMap.set('alice-visio', {
                stream: {}, metadata: { from: 'alice' }, remoteSlug: 'alice', remoteType: 'visio',
            })
            connections.closePeerConnection.mockClear()
        })

        it('ignore un payload absent ou un slug invalide', async () => {
            await cm.remoteStopCall(null)
            await cm.remoteStopCall(hangupPayload({ fromUserSlug: 'not a slug!' }))

            expect(connections.closePeerConnection).not.toHaveBeenCalled()
            expect(ctx.eventBus.$emit).not.toHaveBeenCalled()
        })

        it('ferme le pair, purge son flux et émet close-call', async () => {
            await cm.remoteStopCall(hangupPayload())

            expect(ctx.session.currentCallUsers).toEqual([])
            expect(media.removeVideoElement).toHaveBeenCalledWith('remote-alice-visio')
            expect(ctx.media.remoteStreamsMap.size).toBe(0)
            expect(ctx.eventBus.$emit).toHaveBeenCalledWith('close-call', [
                { userSlug: 'alice', type: 'visio' },
            ])
        })

        it('ferme tout l\'appel quand le dernier pair raccroche', async () => {
            await cm.remoteStopCall(hangupPayload())

            expect(media.stopCurrentStream).toHaveBeenCalled()
            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.IDLE)
        })

        it('ne ferme pas l\'appel s\'il reste des participants', async () => {
            ctx.addCurrentCallUser('bob', 'visio')

            await cm.remoteStopCall(hangupPayload())

            expect(media.stopCurrentStream).not.toHaveBeenCalled()
            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.CONNECTED)
        })

        it('dédoublonne deux raccrochés concurrents du même pair', async () => {
            const first = cm.remoteStopCall(hangupPayload())
            const second = cm.remoteStopCall(hangupPayload())
            await Promise.all([first, second])

            const closeCallEmissions = ctx.eventBus.$emit.mock.calls
                .filter(([event]) => event === 'close-call')
            expect(closeCallEmissions).toHaveLength(1)
        })

        it('libère la garde par utilisateur en fin de traitement', async () => {
            await cm.remoteStopCall(hangupPayload())

            expect(ctx.callMachine.isUserClosing('alice')).toBe(false)
        })
    })

    // ── handleRemoteDeparture ───────────────────────────────────────────────
    //
    // Séquence unique de départ d'un pair, partagée par les deux transports :
    // signal serveur (via remoteStopCall) et fermeture de connexion PeerJS (via
    // useStreamManager.handleStreamRemoved). Les cas ci-dessous couvrent ce que
    // les deux anciens chemins faisaient différemment.

    describe('handleRemoteDeparture', () => {

        const departure = (overrides = {}) => ({
            userSlug: 'alice',
            type: 'visio',
            roomId: 'call-room-1',
            ...overrides,
        })

        /** Place un appel visio connecté avec alice */
        const enterConnectedCall = () => {
            cm.startCallWithPeer({ toUserSlug: 'alice', type: 'visio' })
            ctx.callMachine.transition(CALL_STATES.CONNECTED)
            connections.closePeerConnection.mockClear()
        }

        it('ignore un slug invalide, même venu des métadonnées d\'une connexion', async () => {
            enterConnectedCall()

            expect(await cm.handleRemoteDeparture(departure({ userSlug: 'not a slug!' }))).toBe(false)
            expect(await cm.handleRemoteDeparture(departure({ userSlug: null }))).toBe(false)
            expect(connections.closePeerConnection).not.toHaveBeenCalled()
            expect(ctx.eventBus.$emit).not.toHaveBeenCalled()
        })

        it('ignore un départ déjà en cours de traitement pour ce pair', async () => {
            enterConnectedCall()
            ctx.callMachine.markUserClosing('alice')

            expect(await cm.handleRemoteDeparture(departure())).toBe(false)
            expect(connections.closePeerConnection).not.toHaveBeenCalled()
        })

        it('coupe le transport et les retries du pair parti (fuite si le départ n\'arrive que par PeerJS)', async () => {
            enterConnectedCall()
            ctx.addCurrentCallUser('bob', 'visio')  // un participant restant : isole l'arrêt partiel

            await cm.handleRemoteDeparture(departure())

            expect(pool.clearRetry).toHaveBeenCalledWith('alice')
            expect(ctx.peerStore.removeWaitingRemotePeerId).toHaveBeenCalledWith('alice')
            expect(connections.closePeerConnection).toHaveBeenCalledWith({
                room: 'call-room-1',
                type: 'visio',
                users: ['alice'],
                clearSignalQueue: false,
            })
            expect(core.notifyCloseConnectionToPeer).not.toHaveBeenCalled()
        })

        it('purge tous les flux du pair, quel que soit leur type', async () => {
            enterConnectedCall()
            ctx.addCurrentCallUser('bob', 'visio')
            ctx.media.remoteStreamsMap.set('alice-visio', {
                stream: {}, remoteSlug: 'alice', remoteType: 'visio',
            })
            ctx.media.remoteStreamsMap.set('alice-screen', {
                stream: {}, remoteSlug: 'alice', remoteType: 'screen',
            })
            ctx.media.remoteStreamsMap.set('bob-visio', {
                stream: {}, remoteSlug: 'bob', remoteType: 'visio',
            })

            await cm.handleRemoteDeparture(departure())

            expect(ctx.media.remoteStreamsMap.has('alice-visio')).toBe(false)
            expect(ctx.media.remoteStreamsMap.has('alice-screen')).toBe(false)
            expect(media.removeVideoElement).toHaveBeenCalledWith('remote-alice-screen')
            // Les flux des autres participants ne sont pas touchés
            expect(ctx.media.remoteStreamsMap.has('bob-visio')).toBe(true)
        })

        it('purge un flux reçu sur ma connexion sortante (metadata.from = mon slug)', async () => {
            enterConnectedCall()
            ctx.addCurrentCallUser('bob', 'visio')
            // Côté initiateur, le flux distant arrive sur MA connexion : metadata.from
            // porte mon slug. Seul `remoteSlug` identifie correctement le pair.
            ctx.media.remoteStreamsMap.set('alice-visio', {
                stream: {},
                metadata: { from: 'me', slug: 'alice', type: 'visio' },
                remoteSlug: 'alice',
                remoteType: 'visio',
            })

            await cm.handleRemoteDeparture(departure())

            expect(ctx.media.remoteStreamsMap.has('alice-visio')).toBe(false)
        })

        it('retire le player du type annoncé même sans entrée de registre', async () => {
            enterConnectedCall()
            ctx.addCurrentCallUser('bob', 'visio')

            await cm.handleRemoteDeparture(departure())

            expect(media.removeVideoElement).toHaveBeenCalledWith('remote-alice-visio')
        })

        it('ferme tout l\'appel quand le dernier participant part', async () => {
            enterConnectedCall()

            await cm.handleRemoteDeparture(departure())

            expect(media.stopCurrentStream).toHaveBeenCalled()
            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.IDLE)
        })

        it('émet close-call avant le full stop', async () => {
            enterConnectedCall()

            await cm.handleRemoteDeparture(departure())

            const emitOrder = ctx.eventBus.$emit.mock.invocationCallOrder[0]
            const stopOrder = media.stopCurrentStream.mock.invocationCallOrder[0]
            expect(ctx.eventBus.$emit).toHaveBeenCalledWith('close-call', [
                { userSlug: 'alice', type: 'visio' },
            ])
            expect(emitOrder).toBeLessThan(stopOrder)
        })

        it('mode stream : ni fermeture de transport ni arrêt du broadcast local', async () => {
            enterConnectedCall()
            ctx.session.currentType = 'stream'
            ctx.media.remoteStreamsMap.set('alice-stream', {
                stream: {}, remoteSlug: 'alice', remoteType: 'stream',
            })

            await cm.handleRemoteDeparture(departure({ type: 'stream' }))

            expect(connections.closePeerConnection).not.toHaveBeenCalled()
            expect(media.stopCurrentStream).not.toHaveBeenCalled()
            // …mais le pair est bien retiré et l'UI prévenue
            expect(ctx.media.remoteStreamsMap.has('alice-stream')).toBe(false)
            expect(ctx.session.currentCallUsers).toEqual([])
            expect(ctx.eventBus.$emit).toHaveBeenCalledWith('close-call', [
                { userSlug: 'alice', type: 'stream' },
            ])
        })

        it('libère la garde par utilisateur même si le nettoyage échoue', async () => {
            enterConnectedCall()
            connections.closePeerConnection.mockImplementation(() => {
                throw new Error('connexion déjà détruite')
            })
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

            await cm.handleRemoteDeparture(departure())

            expect(ctx.callMachine.isUserClosing('alice')).toBe(false)
            expect(consoleError).toHaveBeenCalled()
            consoleError.mockRestore()
        })

        it('ne tente pas de full stop depuis IDLE (pas de warn de transition invalide)', async () => {
            // Cas du second transport : le premier a déjà fait le full stop, la FSM
            // est revenue à IDLE et la liste de participants est vide.
            const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})

            await cm.handleRemoteDeparture(departure())

            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.IDLE)
            expect(media.stopCurrentStream).not.toHaveBeenCalled()
            expect(consoleWarn).not.toHaveBeenCalledWith(
                expect.stringContaining('Transition invalide')
            )
            consoleWarn.mockRestore()
        })

        it('relâche le garde de shutdown une fois tous les arrêts concurrents terminés', async () => {
            enterConnectedCall()
            ctx.addCurrentCallUser('bob', 'visio')

            await Promise.all([
                cm.handleRemoteDeparture(departure()),
                cm.handleRemoteDeparture(departure({ userSlug: 'bob' })),
            ])

            expect(ctx.isShuttingDown.value).toBe(false)
        })
    })

    // ── resetCallState ──────────────────────────────────────────────────────

    describe('resetCallState', () => {

        it('remet l\'appel à zéro', () => {
            cm.startCallWithPeer({ toUserSlug: 'alice', type: 'visio' })
            ctx.media.remoteStreamsMap.set('alice-visio', { stream: {} })

            cm.resetCallState()

            expect(media.cleanupCallPlayers).toHaveBeenCalled()
            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.IDLE)
            expect(ctx.session.currentCallUsers).toEqual([])
            expect(ctx.session.currentCallRoomId).toBe(null)
            expect(ctx.media.remoteStreamsMap.size).toBe(0)
        })
    })

    // ── Room d'appel et état ────────────────────────────────────────────────

    describe('room d\'appel', () => {

        it('setCurrentCallRoomId force ou efface la room', () => {
            expect(cm.setCurrentCallRoomId('room-1')).toBe('room-1')
            expect(cm.setCurrentCallRoomId(null)).toBe(null)
        })

        it('ensureCurrentCallRoomId privilégie la room fournie', () => {
            expect(cm.ensureCurrentCallRoomId('room-1')).toBe('room-1')
        })

        it('ensureCurrentCallRoomId conserve la room existante', () => {
            cm.setCurrentCallRoomId('room-1')

            expect(cm.ensureCurrentCallRoomId()).toBe('room-1')
        })

        it('ensureCurrentCallRoomId génère un ID quand aucune room n\'est définie', () => {
            const roomId = cm.ensureCurrentCallRoomId()

            expect(roomId).toBeTruthy()
            expect(typeof roomId).toBe('string')
        })
    })

    describe('état de l\'appel', () => {

        it('reflète l\'état de la FSM', () => {
            expect(cm.callStatus()).toBe(CALL_STATES.IDLE)
            expect(cm.isCallInProgress()).toBe(false)

            cm.startCallWithPeer({ toUserSlug: 'alice', type: 'visio' })

            expect(cm.callStatus()).toBe(CALL_STATES.CALLING)
            expect(cm.isCallInProgress()).toBe(true)
        })
    })

    // ── Verbes FSM destinés à la couche streams ─────────────────────────────

    describe('markCallConnected', () => {

        it('confirme un appel reçu quand le premier flux arrive', async () => {
            await cm.acceptCallFromPeer({
                fromUserSlug: 'alice',
                status: true,
                options: { room: 'r', type: 'visio', peerId: 'peer-alice' },
            })
            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.RECEIVING)

            expect(cm.markCallConnected()).toBe(true)
            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.CONNECTED)
        })

        it('ne touche à rien hors état RECEIVING', () => {
            cm.startCallWithPeer({ toUserSlug: 'alice', type: 'visio' })

            expect(cm.markCallConnected()).toBe(false)
            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.CALLING)
        })

        it('est sans effet à l\'état IDLE', () => {
            expect(cm.markCallConnected()).toBe(false)
            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.IDLE)
        })
    })

    describe('garde par participant', () => {

        it('marque puis libère un départ en cours', () => {
            expect(cm.isRemoteClosing('alice')).toBe(false)

            cm.beginRemoteClosing('alice')
            expect(cm.isRemoteClosing('alice')).toBe(true)

            cm.endRemoteClosing('alice')
            expect(cm.isRemoteClosing('alice')).toBe(false)
        })

        it('suit plusieurs participants indépendamment', () => {
            cm.beginRemoteClosing('alice')

            expect(cm.isRemoteClosing('alice')).toBe(true)
            expect(cm.isRemoteClosing('bob')).toBe(false)
        })
    })

    // ── Retries d'invitation ────────────────────────────────────────────────

    describe('retries d\'invitation', () => {

        it('délègue l\'annulation par inviteId', () => {
            cm.stopCallInviteRetry('invite-1')

            expect(core.stopCallInviteRetry).toHaveBeenCalledWith('invite-1')
        })

        it('ne délègue rien sans inviteId', () => {
            cm.stopCallInviteRetry(null)

            expect(core.stopCallInviteRetry).not.toHaveBeenCalled()
        })

        it('délègue l\'annulation globale', () => {
            cm.clearAllCallInviteRetries()

            expect(core.clearAllCallInviteRetries).toHaveBeenCalled()
        })
    })
})
