/**
 * usePeerTransport.singleton.test.js — Cycle de vie du Peer singleton
 *
 * Un seul `Peer` PeerJS est partagé par TOUS les contextes WebRTC de l'onglet (le
 * `data-app` permanent de `System/Notifications.vue` + les contextes `stream-*` /
 * `visio-*` montés à la demande). Trois mécanismes le gouvernent :
 *
 *   1. **garde d'init** — deux contextes qui montent en même temps ne doivent créer
 *      qu'UNE instance (sinon deux peerId concurrents, dont un fantôme) ;
 *   2. **ref-counting** — le peer n'est détruit que quand le DERNIER consommateur est
 *      démonté ;
 *   3. **destruction différée** (`PEER_DESTROY_DELAY_MS`) — annulable si un composant
 *      remonte dans le délai (navigation interne, re-render).
 *
 * Aucun des trois n'était couvert (cf. TESTS_PLAN.md « Restant à couvrir »), alors que
 * leur défaillance produit le symptôme le plus coûteux du paquet : `lastLocalPeerId`
 * repasse à `null`, `waitForMeReady` attend 15 s puis abandonne, et un arrivant ne voit
 * jamais le flux (TODOLIST l.71).
 *
 * ── Pourquoi une copie neuve du module par test ───────────────────────────────
 *
 * L'état de ces trois mécanismes vit au niveau du **module ES** (`_peerConsumerCount`,
 * `_peerInitPromise`, `_reconnectAttempts`, `_peerDestroyTimer`, `_reconnectTimer`) :
 * sans `vi.resetModules()`, un test hériterait des compteurs du précédent. Le mock PeerJS
 * doit être rechargé **après le même reset**, sinon `getLastPeerInstance()` ne voit pas
 * les instances créées par la copie sous test (cf. `helpers/createVirtualPeer.js`).
 *
 * Le dernier bloc exploite précisément ce mécanisme pour reproduire le **HMR** : une copie
 * neuve du module qui coexiste avec l'ancienne, alors que le store Pinia, lui, survit.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockContext } from './helpers/createMockContext.js'
import { withSetup } from './helpers/withSetup.js'
import { usePeer2Store } from '~socializer/stores/peers2.js'
import { PEER_DESTROY_DELAY_MS } from '~socializer/components/WebRTC2/webrtc2.config.js'

const ROOM = 'live'

/**
 * Charge une copie NEUVE du composable + le mock PeerJS qui lui est associé.
 *
 * `import('peerjs')` passe par l'alias de `vitest.config.js` (→ `__mocks__/peerjs.js`) :
 * c'est donc exactement le module que la copie sous test vient d'importer.
 */
const loadTransportCopy = async () => {
    vi.resetModules()

    const [{ usePeerTransport }, peerMock] = await Promise.all([
        import('~socializer/components/WebRTC2/Composables/usePeerTransport.js'),
        import('peerjs'),
    ])

    peerMock.resetPeerMock()

    return { usePeerTransport, lastPeer: peerMock.getLastPeerInstance }
}

describe('usePeerTransport — Peer singleton (garde d\'init, ref-counting, destruction différée)', () => {
    /** Apps montées pendant le test — démontées en filet par `afterEach`. */
    let apps

    beforeEach(() => {
        apps = []
        // Le transport loggue abondamment sur ces chemins (planification / annulation /
        // destruction) : on ne veut ni le bruit, ni asserter sur des logs.
        vi.spyOn(console, 'info').mockImplementation(() => {})
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        apps.forEach((app) => { try { app.unmount() } catch { /* déjà démontée */ } })
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    /**
     * Contexte de test. `sharedPeerStore` reproduit la réalité de production : tous les
     * contextes de l'onglet partagent LE MÊME store Pinia (ici le même objet mock).
     */
    const makeCtx = (contextId, sharedPeerStore = null) => {
        const ctx = createMockContext({
            contextId,
            session: { currentType: 'stream', currentRoom: ROOM },
            connection: { usersInRoom: [] },
        })
        return sharedPeerStore ? { ...ctx, peerStore: sharedPeerStore } : ctx
    }

    const mount = (usePeerTransport, ctx) => {
        const [api, app] = withSetup(() => usePeerTransport(ctx))
        apps.push(app)
        return [api, app]
    }

    // ── Garde d'init ─────────────────────────────────────────────────────────────

    it('crée le Peer et ne le déclare prêt qu\'à l\'événement `open`', async () => {
        const { usePeerTransport, lastPeer } = await loadTransportCopy()
        const ctx = makeCtx('stream-a')
        const [api] = mount(usePeerTransport, ctx)

        await api.setLocalPeer()

        const peer = lastPeer()
        expect(peer).not.toBeNull()
        expect(ctx.peerStore.localPeer).toBe(peer)
        // `localPeerReady` ne suit pas la création mais la connexion réelle au serveur.
        expect(ctx.peerStore.localPeerReady).toBe(false)

        peer._triggerEvent('open', 'peer-alice')

        expect(ctx.peerStore.localPeerReady).toBe(true)
        expect(ctx.peerStore.lastLocalPeerId).toBe('peer-alice')
    })

    it('deux contextes qui montent ensemble partagent la même init — un seul Peer', async () => {
        const { usePeerTransport, lastPeer } = await loadTransportCopy()
        const ctxA = makeCtx('stream-a')
        const ctxB = makeCtx('data-app', ctxA.peerStore)
        const [apiA] = mount(usePeerTransport, ctxA)
        const [apiB] = mount(usePeerTransport, ctxB)

        // Aucun `await` entre les deux appels : c'est la fenêtre de race réelle
        // (DataRoom + StreamRoom montés dans le même tick).
        const initA = apiA.setLocalPeer()
        const created = lastPeer()
        const initB = apiB.setLocalPeer()

        expect(created).not.toBeNull()
        expect(lastPeer()).toBe(created)

        await Promise.all([initA, initB])

        expect(ctxA.peerStore.localPeer).toBe(created)
    })

    it('ne recrée rien quand le Peer est déjà prêt', async () => {
        const { usePeerTransport, lastPeer } = await loadTransportCopy()
        const ctxA = makeCtx('stream-a')
        const [apiA] = mount(usePeerTransport, ctxA)
        await apiA.setLocalPeer()
        const peer = lastPeer()
        peer._triggerEvent('open', 'peer-alice')

        const ctxB = makeCtx('data-app', ctxA.peerStore)
        const [apiB] = mount(usePeerTransport, ctxB)
        await apiB.setLocalPeer()

        expect(lastPeer()).toBe(peer)
        expect(ctxA.peerStore.localPeer).toBe(peer)
    })

    // ── Ref-counting & destruction différée ──────────────────────────────────────

    it('diffère la destruction de PEER_DESTROY_DELAY_MS après le départ du dernier consommateur', async () => {
        const { usePeerTransport, lastPeer } = await loadTransportCopy()
        const ctx = makeCtx('stream-a')
        const [api, app] = mount(usePeerTransport, ctx)
        await api.setLocalPeer()
        const peer = lastPeer()
        peer._triggerEvent('open', 'peer-alice')

        vi.useFakeTimers()
        app.unmount()

        expect(peer.destroy).not.toHaveBeenCalled()
        vi.advanceTimersByTime(PEER_DESTROY_DELAY_MS - 1)
        expect(peer.destroy).not.toHaveBeenCalled()

        vi.advanceTimersByTime(1)

        expect(peer.destroy).toHaveBeenCalledOnce()
        expect(ctx.peerStore.localPeer).toBeNull()
        expect(ctx.peerStore.localPeerReady).toBe(false)
        expect(ctx.peerStore.lastLocalPeerId).toBeNull()
    })

    it('garde le Peer tant qu\'un autre consommateur est monté', async () => {
        const { usePeerTransport, lastPeer } = await loadTransportCopy()
        const ctxA = makeCtx('stream-a')
        const ctxB = makeCtx('data-app', ctxA.peerStore)
        const [apiA] = mount(usePeerTransport, ctxA)
        const [apiB, appB] = mount(usePeerTransport, ctxB)
        await Promise.all([apiA.setLocalPeer(), apiB.setLocalPeer()])
        const peer = lastPeer()
        peer._triggerEvent('open', 'peer-alice')

        vi.useFakeTimers()
        appB.unmount()
        vi.advanceTimersByTime(PEER_DESTROY_DELAY_MS * 2)

        expect(peer.destroy).not.toHaveBeenCalled()
        expect(ctxA.peerStore.localPeer).toBe(peer)
    })

    it('annule la destruction si un consommateur remonte pendant le délai', async () => {
        const { usePeerTransport, lastPeer } = await loadTransportCopy()
        const ctxA = makeCtx('stream-a')
        const [apiA, appA] = mount(usePeerTransport, ctxA)
        await apiA.setLocalPeer()
        const peer = lastPeer()
        peer._triggerEvent('open', 'peer-alice')

        vi.useFakeTimers()
        appA.unmount()
        vi.advanceTimersByTime(PEER_DESTROY_DELAY_MS / 2)

        const ctxB = makeCtx('stream-b', ctxA.peerStore)
        const [apiB] = mount(usePeerTransport, ctxB)
        await apiB.setLocalPeer()

        vi.advanceTimersByTime(PEER_DESTROY_DELAY_MS * 2)

        expect(peer.destroy).not.toHaveBeenCalled()
        expect(ctxA.peerStore.localPeer).toBe(peer)
        expect(ctxA.peerStore.lastLocalPeerId).toBe('peer-alice')
    })

    it('ne détruit rien et ne jette pas quand le Peer a déjà disparu (échec d\'init)', async () => {
        const { usePeerTransport, lastPeer } = await loadTransportCopy()
        const ctx = makeCtx('stream-a')
        const [api, app] = mount(usePeerTransport, ctx)
        await api.setLocalPeer()
        const peer = lastPeer()

        // État exact laissé par le `catch` de l'init : le peer a disparu du store alors
        // que le consommateur est encore monté.
        ctx.peerStore.localPeer = null
        ctx.peerStore.localPeerReady = false

        vi.useFakeTimers()
        app.unmount()

        expect(() => vi.advanceTimersByTime(PEER_DESTROY_DELAY_MS)).not.toThrow()
        expect(peer.destroy).not.toHaveBeenCalled()
    })

    // ── Intégration avec le vrai store ───────────────────────────────────────────

    it('pilote le cycle de vie complet sur le VRAI store Pinia (mock non impliqué)', async () => {
        // `mockFidelity` garantit que le mock a la même *surface* que le store, jamais la
        // même *sémantique* — et un correctif inerte avec un test vert a déjà coûté cher
        // ici. Ce test exerce donc le transport contre les vraies actions Pinia :
        // ref-counting, garde d'init et `resetPeerState`.
        const { usePeerTransport, lastPeer } = await loadTransportCopy()
        const peerStore = usePeer2Store()   // Pinia fraîche posée par setup.js
        const ctxA = { ...makeCtx('stream-a'), peerStore }
        const ctxB = { ...makeCtx('data-app'), peerStore }

        const [apiA, appA] = mount(usePeerTransport, ctxA)
        const [apiB, appB] = mount(usePeerTransport, ctxB)
        await Promise.all([apiA.setLocalPeer(), apiB.setLocalPeer()])
        const peer = lastPeer()
        peer._triggerEvent('open', 'peer-alice')

        expect(peerStore.peerConsumerCount).toBe(2)
        expect(peerStore.getLocalPeer).toBe(peer)

        vi.useFakeTimers()
        appB.unmount()
        vi.advanceTimersByTime(PEER_DESTROY_DELAY_MS * 2)

        expect(peerStore.peerConsumerCount).toBe(1)
        expect(peer.destroy).not.toHaveBeenCalled()

        appA.unmount()
        vi.advanceTimersByTime(PEER_DESTROY_DELAY_MS)

        expect(peer.destroy).toHaveBeenCalledOnce()
        expect(peerStore.peerConsumerCount).toBe(0)
        expect(peerStore.getLocalPeer).toBeNull()
        expect(peerStore.getLastLocalPeerId).toBeNull()
        expect(peerStore.peerInitPromise).toBeNull()
        expect(peerStore.peerDestroyTimer).toBeNull()
    })

    // ── Rechargement de module (HMR) ─────────────────────────────────────────────
    //
    // Le HMR remplace le module `usePeerTransport` (état module-level remis à zéro) mais
    // PAS le store Pinia (le Peer, lui, est toujours vivant). Deux copies du composable
    // coexistent donc, chacune avec ses propres compteurs — et c'est ce que reproduisent
    // les tests ci-dessous en chargeant deux copies qui partagent le même store.
    describe('rechargement du module (HMR) — même store, copie neuve du composable', () => {

        it('[harnais] une copie rechargée réagit bien au démontage (sinon les tests suivants seraient verts pour rien)', async () => {
            // Sans cette garde, « le peer n'est pas détruit » ne prouverait rien : ce
            // pourrait être un `onUnmounted` non enregistré par la seconde copie.
            await loadTransportCopy()
            const copy2 = await loadTransportCopy()

            const ctx = makeCtx('stream-solo')
            const [api, app] = mount(copy2.usePeerTransport, ctx)
            await api.setLocalPeer()
            const peer = copy2.lastPeer()
            peer._triggerEvent('open', 'peer-solo')

            vi.useFakeTimers()
            app.unmount()
            vi.advanceTimersByTime(PEER_DESTROY_DELAY_MS)

            expect(peer.destroy).toHaveBeenCalledOnce()
        })

        it('le Peer partagé survit au démontage d\'un consommateur enregistré par une AUTRE copie du module', async () => {
            const copy1 = await loadTransportCopy()
            const ctxA = makeCtx('stream-a')
            const [apiA] = mount(copy1.usePeerTransport, ctxA)
            await apiA.setLocalPeer()
            const peer = copy1.lastPeer()
            peer._triggerEvent('open', 'peer-alice')

            // 🔥 HMR : copie neuve du composable, MÊME store (Pinia n'est pas rechargée).
            const copy2 = await loadTransportCopy()
            const ctxB = makeCtx('data-app', ctxA.peerStore)
            const [apiB, appB] = mount(copy2.usePeerTransport, ctxB)
            await apiB.setLocalPeer()

            // Le peer prêt du store est réutilisé : la copie 2 n'instancie rien.
            expect(copy2.lastPeer()).toBeNull()

            vi.useFakeTimers()
            appB.unmount()
            vi.advanceTimersByTime(PEER_DESTROY_DELAY_MS)

            // ctxA est TOUJOURS monté : son transport ne doit pas disparaître sous ses pieds.
            expect(peer.destroy).not.toHaveBeenCalled()
            expect(ctxA.peerStore.localPeer).toBe(peer)
            // `lastLocalPeerId` à null = `waitForMeReady` attend 15 s puis abandonne, et
            // l'arrivant ne reçoit jamais le flux (TODOLIST l.71).
            expect(ctxA.peerStore.lastLocalPeerId).toBe('peer-alice')
        })

        it('ne crée qu\'un seul Peer quand une init est en vol au moment du rechargement', async () => {
            // Les deux copies sont chargées d'avance : la fenêtre « init en vol » ne dure
            // que quelques microtâches, un `await import()` la refermerait.
            const copy1 = await loadTransportCopy()
            const copy2 = await loadTransportCopy()

            const ctxA = makeCtx('stream-a')
            const ctxB = makeCtx('data-app', ctxA.peerStore)
            const [apiA] = mount(copy1.usePeerTransport, ctxA)
            const [apiB] = mount(copy2.usePeerTransport, ctxB)

            const inFlight = apiA.setLocalPeer()   // `open` volontairement non déclenché
            const created = copy1.lastPeer()
            expect(created).not.toBeNull()

            apiB.setLocalPeer()

            // Un second Peer ici, c'est l'ancien qui fuit avec un peerId fantôme encore
            // enregistré côté serveur PeerJS — la famille de bugs « peerId périmé collant ».
            expect(copy2.lastPeer()).toBeNull()
            expect(ctxA.peerStore.localPeer).toBe(created)

            await inFlight
        })
    })
})
