/**
 * createVirtualPeer.js — Un participant complet, dans le process de test
 *
 * Monte un `usePeerOrchestrator` **réel** (aucune couche mockée : seuls PeerJS et le
 * backend de signalisation le sont) et le relie au bus PeerJS + au faux serveur de
 * signalisation. Deux pairs virtuels dans un même test se parlent donc pour de vrai.
 *
 * C'est ce qui permet d'asserter sur le fait métier — « B a reçu le flux de A » — au
 * lieu d'asserter sur des appels de fonctions internes. Tous les incendies du package
 * ont ce fait pour symptôme, et aucun test de couche isolée ne peut l'observer.
 *
 * ── Pourquoi vi.resetModules() par pair ───────────────────────────────────────
 *
 * `usePeerTransport` porte 8 variables **module-level** (`contextRegistry`,
 * `_peerInitPromise`, `_peerConsumerCount`, `_reconnectAttempts`, `_peerDestroyTimer`,
 * `_hubRateLimiter`…) : c'est un singleton par module ES. Sans reset, deux pairs du même
 * process partageraient le même Peer et le même registre de contextes — ils seraient un
 * seul participant. Chaque pair charge donc sa propre copie du graphe de modules ; le
 * bus PeerJS et le serveur de signalisation vivent sur `globalThis` précisément pour
 * survivre à ces resets et rester partagés.
 *
 * ⚠️ Corollaire : monter les pairs **séquentiellement** (`await` l'un après l'autre).
 * Deux `createVirtualPeer()` concurrents se voleraient le registre de modules.
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *
 *     const bus = createPeerBus()
 *     const server = createFakeSignalingServer()
 *     const alice = await createVirtualPeer({ slug: 'alice', room, type: 'stream', server })
 *     const bob   = await createVirtualPeer({ slug: 'bob',   room, type: 'stream', server })
 *     await connectRoom([alice, bob])   // les deux se voient dans la room
 */
import { vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { withSetup } from './withSetup.js'
import { mockEventBus } from './mockEventBus.js'
import { flushBus } from '../__mocks__/peerjs.js'

/**
 * Laisse le système se stabiliser : signalisation, établissement, réception des flux.
 *
 * Draine à la fois les **microtâches** (livraisons du bus PeerJS, flush des `watch`) et
 * les **tâches** (chaque signal serveur est livré dans sa propre tâche, cf.
 * fakeSignalingServer). Un `await Promise.resolve()` seul ne verrait jamais arriver un
 * signal, et un `setTimeout` seul laisserait des livraisons du bus en vol.
 */
export async function settle(rounds = 6) {
    for (let i = 0; i < rounds; i += 1) {
        await flushBus()
        await new Promise((resolve) => setTimeout(resolve, 0))
    }
}

/**
 * Monte un participant complet.
 *
 * @param {Object}   config
 * @param {string}   config.slug      Identité du participant (unique par test)
 * @param {Object}   config.server    Instance de createFakeSignalingServer()
 * @param {string}   [config.room]    Room WebRTC
 * @param {string}   [config.type]    Mode du contexte ('stream', 'data', 'visio'…)
 * @param {string}   [config.peerId]  PeerId PeerJS (déterministe par défaut)
 * @param {Object}   [config.options] Options passées à l'orchestrateur (topology, hubSlug…)
 * @param {Object}   [config.callbacks] Callbacks applicatifs (onDataReceived…)
 * @returns {Promise<Object>} Le pair virtuel
 */
export async function createVirtualPeer({
    slug,
    server,
    room = 'room-test',
    type = 'stream',
    peerId = `peer-${slug}`,
    options = {},
    callbacks = {},
}) {
    // Copie neuve du graphe de modules pour ce pair (cf. en-tête).
    vi.resetModules()

    const pinia = createPinia()
    setActivePinia(pinia)

    const [
        { usePeerOrchestrator },
        { useMeStore },
        { usePeer2Store },
        { getLastPeerInstance, resetPeerMock },
    ] = await Promise.all([
        import('~socializer/components/WebRTC2/Composables/usePeerOrchestrator.js'),
        import('~estarter/stores/me.js'),
        import('~socializer/stores/peers2.js'),
        // Même copie du module que celle utilisée par l'orchestrateur : chargée après
        // le même resetModules, donc résolue depuis le même registre.
        import('peerjs'),
    ])

    const meStore = useMeStore()
    meStore.user = { slug, name: slug }

    const peerStore = usePeer2Store()
    const eventBus = mockEventBus()

    // On repart d'une ardoise vierge pour que getLastPeerInstance() ne puisse pas
    // renvoyer le Peer d'un pair monté précédemment.
    resetPeerMock()

    const [api, app] = withSetup(
        () => usePeerOrchestrator(type, room, options),
        { provides: { eventBus }, plugins: [pinia] }
    )

    // Le client Ajax a été créé pendant createPeerContext : on l'attribue à ce pair.
    server.bindLastClientTo(slug)
    server.registerPeer(slug, { peerStore, contextId: api.contextId })

    // Crée le Peer PeerJS (via transport.setLocalPeer) et branche les callbacks.
    api.initializePeerConnection(callbacks)

    await vi.waitFor(() => {
        const instance = getLastPeerInstance()
        if (!instance) throw new Error(`Peer non créé pour "${slug}"`)
        return instance
    })

    const peerInstance = getLastPeerInstance()

    // Le serveur PeerJS attribue le peerId : c'est cet événement qui rend le pair
    // joignable (et qui l'inscrit au bus).
    peerInstance._triggerEvent('open', peerId)
    await settle(1)

    return {
        slug,
        peerId,
        room,
        type,
        api,
        app,
        peerStore,
        meStore,
        eventBus,
        peerInstance,

        // ⚠️ `remoteStreams` EXCLUT les partages d'écran et `remoteScreens` ne contient
        // qu'eux (cf. createPeerContext:201-202) : asserter sur `remoteStreams` seul
        // laisserait passer toute régression d'écran — c'est précisément la famille de
        // bugs qu'on verrouille ici.

        /** Slugs des pairs dont un flux caméra/micro est reçu. */
        receivedStreamsFrom() {
            return api.remoteStreams.value.map((entry) => entry.remoteSlug)
        },
        /** Slugs des pairs dont un partage d'écran est reçu. */
        receivedScreensFrom() {
            return api.remoteScreens.value.map((entry) => entry.remoteSlug)
        },
        /** Toutes les entrées reçues, écrans compris. */
        allReceived() {
            return [...api.remoteStreams.value, ...api.remoteScreens.value]
        },

        /** Démonte proprement le pair (teardown terminal + unmount Vue). */
        destroy() {
            try { api.cleanupPeerConnection() } catch { /* teardown best-effort */ }
            app.unmount()
        },
    }
}

/**
 * Déclare la composition de la room à tous les pairs et laisse les connexions
 * s'établir — c'est le rôle du canal de présence Reverb en production.
 *
 * Le va-et-vient de signalisation (ask → response → connect) traverse plusieurs tours
 * de microtâches ; `rounds` laisse aux retries le temps de conclure.
 */
export async function connectRoom(peers, { rounds = 4 } = {}) {
    const users = peers.map((peer) => ({ slug: peer.slug }))

    // ⚠️ Concurrent, jamais séquentiel. En production, la présence Reverb livre la
    // composition de la room à tous les clients quasi simultanément, AVANT que le P2P
    // démarre. Enchaîner les `syncUsersConnections` un par un laisse le premier pair
    // ouvrir sa connexion alors que le second n'a pas encore peuplé son `usersInRoom` :
    // `_isAuthorizedIncomingPeer` la refuse (« émetteur ni membre de la room ni
    // interlocuteur autorisé »), et le test échoue pour une raison de harnais.
    await Promise.all(peers.map((peer) => peer.api.syncUsersConnections(users)))

    await settle(rounds)
}

/**
 * Fait entrer un pair dans une room déjà active : il annonce la room à tout le monde,
 * les pairs déjà présents découvrent l'arrivant. C'est le scénario « arrivant tardif »,
 * celui qui casse en production.
 */
export async function joinRoom(newcomer, existingPeers, { rounds = 6 } = {}) {
    const all = [...existingPeers, newcomer]
    await connectRoom(all, { rounds })
}
