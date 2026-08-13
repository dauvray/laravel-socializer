/**
 * usePeerTransport.peerUnavailable.test.js
 *
 * Recovery du peerId mort : PeerJS émet `peer-unavailable` quand la cible n'est plus
 * enregistrée sur le serveur de signalisation. Le handler doit **invalider le mapping
 * slug → peerId** et émettre `peerUnavailableSignal`, sinon plus rien ne rattrape :
 * `useConnectionPool.requestOrConnectPeer` ne redemande un peerId que s'il n'en a aucun.
 *
 * Bug couvert (2026-08-13) — « userB arrive, ne voit rien, userA loggue
 * `Could not connect to peer <uuid>` » : l'invalidation passait par
 * `removeRemotePeerId`, qui ne supprime que si le slug n'apparaît dans AUCUNE room.
 * Or `System/Notifications.vue` monte en permanence un contexte `data-app` partageant
 * le même store Pinia → le slug est toujours présent dans `connections['app']` →
 * invalidation systématiquement annulée, peerId périmé « collant », impasse définitive.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockContext } from './helpers/createMockContext.js'
import { withSetup } from './helpers/withSetup.js'
import { resetPeerMock, getLastPeerInstance } from './__mocks__/peerjs.js'
import { usePeerTransport } from '~socializer/components/WebRTC2/Composables/usePeerTransport.js'

const CTX_ID = 'stream-live'
const ROOM = 'live'
const STALE_PEER_ID = '1716dce4-88fd-4ab6-9361-512d5473ab30'

/** Erreur PeerJS telle que la lib l'émet réellement. */
const peerUnavailableError = (peerId = STALE_PEER_ID) => ({
    type: 'peer-unavailable',
    message: `Could not connect to peer ${peerId}`,
})

describe('usePeerTransport — recovery peer-unavailable', () => {
    let ctx
    let app
    let peerInstance

    const mount = (context) => {
        const [, mounted] = withSetup(() => usePeerTransport(context))
        app = mounted
    }

    /** Connexion média factice pointant sur un peerId donné. */
    const connTo = (peerId) => ({ peer: peerId, close: vi.fn(), on: vi.fn(), off: vi.fn() })

    beforeEach(async () => {
        resetPeerMock()
        vi.spyOn(console, 'error').mockImplementation(() => {})

        ctx = createMockContext({
            contextId: CTX_ID,
            session: { currentType: 'stream', currentRoom: ROOM },
            connection: { usersInRoom: ['bob'] },
        })

        mount(ctx)
        const transport = withSetup(() => usePeerTransport(ctx))[0]
        await transport.setLocalPeer()
        peerInstance = getLastPeerInstance()

        // État de départ commun : A connaît un peerId de bob, désormais mort.
        ctx.peerStore.addRemotePeerId('bob', STALE_PEER_ID)
    })

    afterEach(() => {
        app.unmount()
        vi.restoreAllMocks()
    })

    it('ignore les erreurs PeerJS d\'un autre type', () => {
        peerInstance._triggerEvent('error', { type: 'network', message: 'boom' })

        expect(ctx.peerStore.getRemotePeerId('bob')).toBe(STALE_PEER_ID)
        expect(ctx.peerUnavailableSignal.value).toBeNull()
    })

    it('n\'invalide rien si le peerId en échec ne correspond à aucun slug connu', () => {
        peerInstance._triggerEvent('error', peerUnavailableError('peer-inconnu'))

        expect(ctx.peerStore.getRemotePeerId('bob')).toBe(STALE_PEER_ID)
        expect(ctx.peerUnavailableSignal.value).toBeNull()
    })

    it('retire la connexion échouée du store', () => {
        const failed = connTo(STALE_PEER_ID)
        ctx.peerStore.addPeerConnectionInstance(ROOM, 'bob', 'stream', failed)

        peerInstance._triggerEvent('error', peerUnavailableError())

        expect(ctx.peerStore.removePeerConnectionInstance).toHaveBeenCalledWith(
            ROOM, 'bob', 'stream', failed
        )
    })

    it('conserve les connexions vers un autre peerId', () => {
        const other = connTo('peer-encore-vivant')
        ctx.peerStore.addPeerConnectionInstance(ROOM, 'bob', 'stream', other)

        peerInstance._triggerEvent('error', peerUnavailableError())

        expect(ctx.peerStore.removePeerConnectionInstance).not.toHaveBeenCalled()
    })

    // ── Le cœur du bug ────────────────────────────────────────────────────────

    it('invalide le mapping même si le pair reste connecté dans une AUTRE room', () => {
        // Reproduit la configuration réelle : le contexte `data-app` des notifications
        // garde bob dans connections['app'], ce qui neutralisait removeRemotePeerId.
        ctx.peerStore.addPeerConnectionInstance('app', 'bob', 'data', connTo('peer-data-bob'))
        ctx.peerStore.addPeerConnectionInstance(ROOM, 'bob', 'stream', connTo(STALE_PEER_ID))

        peerInstance._triggerEvent('error', peerUnavailableError())

        expect(ctx.peerStore.getRemotePeerId('bob')).toBeNull()
        expect(ctx.peerUnavailableSignal.value).toBe('bob')
    })

    it('invalide même quand aucune instance de connexion n\'a été stockée', () => {
        // `peer.call()` peut échouer avant l'enregistrement, et le garde
        // `failedConns.length === 0` abandonnait alors AVANT toute invalidation.
        peerInstance._triggerEvent('error', peerUnavailableError())

        expect(ctx.peerStore.getRemotePeerId('bob')).toBeNull()
        expect(ctx.peerUnavailableSignal.value).toBe('bob')
    })

    it('trouve aussi une connexion de partage d\'écran (type `screen`)', () => {
        // Une connexion screen est stockée sous le type 'screen', jamais sous
        // session.currentType — la recherche ne la voyait pas.
        const failed = connTo(STALE_PEER_ID)
        ctx.peerStore.addPeerConnectionInstance(ROOM, 'bob', 'screen', failed)

        peerInstance._triggerEvent('error', peerUnavailableError())

        expect(ctx.peerStore.removePeerConnectionInstance).toHaveBeenCalledWith(
            ROOM, 'bob', 'screen', failed
        )
        expect(ctx.peerStore.getRemotePeerId('bob')).toBeNull()
    })

    it('purge le drapeau d\'attente pour ne pas étrangler la re-demande', () => {
        // Sans ça, requestRemotePeerConnection sortirait sur son garde d'âge
        // (SIGNALING_STALE_MS) et la recovery relancerait un cycle qui ne demande rien.
        ctx.peerStore.addWaitingRemotePeerId('bob', { room: ROOM, type: 'stream' })

        peerInstance._triggerEvent('error', peerUnavailableError())

        expect(ctx.peerStore.hasWaitingRemotePeerId('bob')).toBe(false)
    })

    it('utilise la room d\'appel quand elle est définie', () => {
        ctx.session.currentCallRoomId = 'call-42'
        const failed = connTo(STALE_PEER_ID)
        ctx.peerStore.addPeerConnectionInstance('call-42', 'bob', 'stream', failed)

        peerInstance._triggerEvent('error', peerUnavailableError())

        expect(ctx.peerStore.removePeerConnectionInstance).toHaveBeenCalledWith(
            'call-42', 'bob', 'stream', failed
        )
    })
})
