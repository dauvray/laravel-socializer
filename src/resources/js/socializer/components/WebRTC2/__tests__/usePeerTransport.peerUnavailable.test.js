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
import { REMOTE_PEER_ID_LEASE_MS } from '~socializer/components/WebRTC2/webrtc2.config.js'

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

    it('⭐ retrouve le slug d\'un peerId dont le BAIL a expiré', () => {
        // La recovery résout peerId → slug par `getSlugByRemotePeerId`, qui doit être
        // aveugle au bail (REMOTE_PEER_ID_LEASE_MS) : un peerId mort est justement le cas
        // où le bail a le plus de chances d'avoir expiré. Rendre cette résolution
        // périmable ferait sortir la recovery sur `if (!targetSlug) return` — le bail
        // détruirait le filet qu'il est censé soulager, en silence.
        //
        // Ce fichier tourne en timers réels : `setSystemTime` seul avance l'horloge (il ne
        // mocke que `Date`), d'où le `useRealTimers` en fin de test.
        vi.setSystemTime(Date.now() + REMOTE_PEER_ID_LEASE_MS + 1)

        peerInstance._triggerEvent('error', peerUnavailableError())

        expect(ctx.peerStore.getRemotePeerId('bob')).toBeNull()
        expect(ctx.peerUnavailableSignal.value).toBe('bob')

        vi.useRealTimers()
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

    // ── Qui redemande ? ───────────────────────────────────────────────────────
    //
    // L'invalidation du peerId est GLOBALE (fait sur l'onglet distant, store partagé) ;
    // la relance ne l'est pas (intention d'un contexte). Sans ce filtre, chaque contexte
    // de l'onglet redemandait — dont le `data-app` de Notifications.vue, qui n'a aucun
    // canal de présence : POST inutile, et « demandeur non autorisé » chez le
    // destinataire, qui noyait les refus porteurs de sens.

    /**
     * Monte un SECOND contexte dans le même onglet — même `peerStore`, donc même mapping
     * slug → peerId — et l'inscrit réellement au `contextRegistry`.
     *
     * ⚠️ `setLocalPeer()` est indispensable : c'est LUI qui enregistre le contexte.
     * Sans lui, `contextRegistry.forEach` ne le voit pas et le test passerait sans rien
     * prouver, quel que soit le code de production.
     */
    const mountSecondContext = async (overrides = {}) => {
        const second = createMockContext({
            contextId: 'data-app',
            session: { currentType: 'data', currentRoom: 'app' },
            connection: { usersInRoom: [], presenceSynced: false },
            peerStore: ctx.peerStore,
            ...overrides,
        })
        const [secondTransport, secondApp] = withSetup(() => usePeerTransport(second))
        await secondTransport.setLocalPeer()
        return { second, secondApp }
    }

    it('ne relance pas un contexte pour qui ce pair n\'est rien', async () => {
        // Ni membre de la room, ni interlocuteur d'appel autorisé : exactement le
        // contexte permanent des notifications au repos.
        const { second, secondApp } = await mountSecondContext()

        peerInstance._triggerEvent('error', peerUnavailableError())

        // Le peerId mort est bien oublié — ça, c'est global…
        expect(ctx.peerStore.getRemotePeerId('bob')).toBeNull()
        // …mais ce contexte-là n'a rien à redemander.
        expect(second.peerUnavailableSignal.value).toBeNull()

        secondApp.unmount()
    })

    it('relance le contexte de diffusion même s\'il est inscrit APRÈS `data-app`', async () => {
        // ⭐ Le vrai visage du bug rapporté.
        //
        // La résolution peerId → slug vivait DANS la boucle sur les contextes, et chaque
        // tour invalidait le mapping — or ce mapping est partagé par l'onglet. Le premier
        // contexte itéré consommait donc le fait, et tous les suivants sortaient sur
        // `if (!targetSlug) return`. En production, `Notifications.vue` crée `data-app` au
        // tick 0 : il est premier dans le registre, il absorbait la relance, et le
        // contexte `stream` — le seul qui avait un flux à repousser — n'était jamais
        // relancé. « Could not connect to peer » une fois, puis plus rien.
        //
        // Ici `ctx` (stream-live) est enregistré en premier ; on inscrit `data-app`
        // AVANT lui pour reproduire l'ordre de production.
        const { second: dataApp, secondApp } = await mountSecondContext({
            contextId: 'data-app-first',
        })

        // Les deux ont une raison de parler à bob : seul l'ordre doit départager, et il
        // ne doit départager rien du tout.
        dataApp.markAuthorizedCallPeer('bob')

        peerInstance._triggerEvent('error', peerUnavailableError())

        expect(dataApp.peerUnavailableSignal.value).toBe('bob')
        // Celui-ci était systématiquement oublié.
        expect(ctx.peerUnavailableSignal.value).toBe('bob')

        secondApp.unmount()
    })

    it('relance un contexte hors room dès lors que l\'appel direct est autorisé', async () => {
        // Non-régression de la visio 1-à-1 : elle n'a AUCUNE room commune, son seul titre
        // à redemander est `authorizedCallPeers`. Restreindre la relance à la présence
        // seule la condamnerait au premier peerId périmé.
        const { second, secondApp } = await mountSecondContext()
        second.markAuthorizedCallPeer('bob')

        peerInstance._triggerEvent('error', peerUnavailableError())

        expect(second.peerUnavailableSignal.value).toBe('bob')

        secondApp.unmount()
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
