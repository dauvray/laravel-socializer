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
 * Il ne reste dans `usePeerTransport` qu'une seule structure **module-level** :
 * `_hubRateLimiter` (+ `_hubByteLimiter`), la fenêtre glissante du hub star. C'est
 * aujourd'hui la seule justification du reset — mais elle suffit : sans lui, les
 * retransmissions de deux pairs du même process s'imputeraient au même budget. Chaque pair
 * charge donc sa propre copie du graphe de modules ; le bus PeerJS et le serveur de
 * signalisation vivent sur `globalThis` précisément pour survivre à ces resets et rester
 * partagés.
 *
 * ⚠️ Le **registre des contextes** n'est plus module-level : il vit dans `peerStore`
 * (`peers2/state.js`), comme l'état du Peer singleton (ref-counting, garde d'init,
 * reconnexion). Ce sont donc les Pinia neuves créées ci-dessous, une par pair, qui isolent
 * réellement les participants — et c'est ce qui rend le paquet insensible au HMR : un
 * module rechargé retrouve les contextes du Peer survivant, au lieu de le laisser sourd.
 *
 * ⚠️ Corollaire : monter les pairs **séquentiellement** (`await` l'un après l'autre).
 * Deux `createVirtualPeer()` concurrents se voleraient le registre de modules.
 *
 * ── Un onglet, plusieurs contextes ───────────────────────────────────────────
 *
 * Un pair virtuel est un ONGLET, pas un contexte. La production en monte plusieurs par
 * page (`System/Notifications.vue` crée `data-app` en permanence, et chaque
 * `MediaBroadcastProvider` le sien — cf. `Exemples/Home.vue`, qui en monte trois), tous
 * partageant **un** `Peer` PeerJS et **un** store Pinia. C'est cette configuration, et
 * elle seule, qui révèle les collisions d'état entre contextes : un test à un contexte
 * par onglet ne peut structurellement pas les voir.
 *
 * `peer.mountContext({ type, room })` ajoute donc un contexte à un onglet existant, dans
 * le même registre de modules et la même Pinia.
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *
 *     const bus = createPeerBus()
 *     const server = createFakeSignalingServer()
 *     const alice = await createVirtualPeer({ slug: 'alice', room, type: 'stream', server })
 *     const bob   = await createVirtualPeer({ slug: 'bob',   room, type: 'stream', server })
 *     await connectRoom([alice, bob])   // les deux se voient dans la room
 *
 *     const chat = alice.mountContext({ type: 'data', room: 'room-chat' })
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
 * @param {number}   [config.id]      Id utilisateur, tel que le porte la liste de présence
 *        (`Http\Resources\PresenceUser` livre `id` ET `slug`). Nécessaire au seul chemin
 *        qui raisonne en id : l'attribution d'un whisper par `metadata.user_id`. Doit être
 *        LE MÊME que celui donné à `createFakePresenceChannel().subscribe()`.
 * @param {Object}   config.server    Instance de createFakeSignalingServer()
 * @param {string}   [config.room]    Room WebRTC
 * @param {string}   [config.type]    Mode du contexte ('stream', 'data', 'visio'…)
 * @param {string}   [config.peerId]  PeerId PeerJS (déterministe par défaut)
 * @param {Object}   [config.options] Options passées à l'orchestrateur (topology, hubSlug…)
 * @param {Object}   [config.callbacks] Callbacks applicatifs (onDataReceived…)
 * @param {Object}   [config.reverb]  Abonnement au canal de présence
 *        (`createFakePresenceChannel().subscribe(...)`). Un seul par ONGLET, partagé par
 *        tous ses contextes — comme en production, où la page fournit un
 *        `useReverbPresence` unique à tous ses providers. Absent = aucun whisper, ce qui
 *        est un état de production valide (hôte qui ne fournit pas son canal).
 * @returns {Promise<Object>} Le pair virtuel
 */
export async function createVirtualPeer({
    slug,
    id = null,
    server,
    room = 'room-test',
    type = 'stream',
    peerId = `peer-${slug}`,
    options = {},
    callbacks = {},
    reverb = null,
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
    meStore.user = { id, slug, name: slug }

    const peerStore = usePeer2Store()
    const eventBus = mockEventBus()

    // On repart d'une ardoise vierge pour que getLastPeerInstance() ne puisse pas
    // renvoyer le Peer d'un pair monté précédemment.
    resetPeerMock()

    // ⚠️ `reverb` passe en PARAMÈTRE, pas par `provides` : `withSetup` pose ses provides
    // avec `Object.entries`, qui ignore les clés Symbol — or `REVERB_CHANNEL` en est une.
    // C'est aussi pourquoi l'orchestrateur reçoit ses dépendances au lieu de les injecter.
    const [api, app] = withSetup(
        () => usePeerOrchestrator(type, room, options, { reverb }),
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

    // Contextes secondaires montés dans cet onglet (cf. mountContext) : démontés avec
    // lui, dans l'ordre inverse du montage.
    const extraContexts = []

    /**
     * Ajoute un contexte à CET onglet — même registre de modules, même Pinia, donc même
     * `contextRegistry`, même Peer PeerJS et même store partagé qu'en production.
     *
     * @param {Object} config
     * @param {string} [config.type]      Mode du contexte ('data', 'stream'…)
     * @param {string} [config.room]      Room WebRTC
     * @param {Object} [config.options]   Options de l'orchestrateur (topology, hubSlug…)
     * @param {Object} [config.callbacks] Callbacks applicatifs
     * @returns {Object} handle du contexte
     */
    const mountContext = ({
        type: ctxType = 'data',
        room: ctxRoom = 'app',
        options: ctxOptions = {},
        callbacks: ctxCallbacks = {},
    } = {}) => {
        // La Pinia de cet onglet doit être l'active : un autre pair a pu être monté
        // entre-temps et l'aurait supplantée.
        setActivePinia(pinia)

        const [ctxApi, ctxApp] = withSetup(
            // Le même abonnement de présence que le contexte principal : un onglet, un
            // canal. C'est la configuration qui révèle les collisions entre contextes
            // (trois providers sur un canal dans `Exemples/Home.vue`).
            () => usePeerOrchestrator(ctxType, ctxRoom, ctxOptions, { reverb }),
            { provides: { eventBus }, plugins: [pinia] }
        )

        // Chaque contexte crée son propre client Ajax dans createPeerContext : il faut le
        // rattacher à ce slug, sinon ses POST partiraient d'un émetteur inconnu.
        server.bindLastClientTo(slug)

        // Le Peer singleton existe déjà : setLocalPeer se contente d'enregistrer ce
        // contexte dans le contextRegistry et d'incrémenter le ref-counting.
        ctxApi.initializePeerConnection(ctxCallbacks)

        const handle = {
            slug,
            type: ctxType,
            room: ctxRoom,
            api: ctxApi,
            app: ctxApp,
            contextId: ctxApi.contextId,
            receivedStreamsFrom() {
                return ctxApi.remoteStreams.value.map((entry) => entry.remoteSlug)
            },
            receivedScreensFrom() {
                return ctxApi.remoteScreens.value.map((entry) => entry.remoteSlug)
            },
        }

        extraContexts.push(handle)
        return handle
    }

    return {
        slug,
        id,
        peerId,
        room,
        type,
        api,
        app,
        peerStore,
        meStore,
        eventBus,
        peerInstance,
        mountContext,
        extraContexts,

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

        /** Démonte proprement l'onglet : contextes secondaires d'abord, puis le principal. */
        destroy() {
            for (const extra of [...extraContexts].reverse()) {
                try { extra.api.cleanupPeerConnection() } catch { /* teardown best-effort */ }
                extra.app.unmount()
            }
            extraContexts.length = 0

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
    // `id` autant que `slug` : la charge utile d'un canal de présence porte les deux
    // (`PresenceUser`), et c'est l'`id` qui rend un whisper attribuable. Un pair monté
    // sans `id` le laisse à `null`, ce que l'annuaire ignore — état de production valide
    // pour tout scénario qui n'exerce pas les whispers.
    const users = peers.map((peer) => ({ id: peer.id ?? null, slug: peer.slug }))

    // Tous les contextes de chaque onglet reçoivent la composition : en production, un
    // seul canal de présence Reverb alimente le `users` de TOUS les providers de la page
    // (cf. Exemples/Home.vue, un `useReverbPresence` pour trois MediaBroadcastProvider).
    const contexts = peers.flatMap((peer) => [
        peer.api,
        ...(peer.extraContexts ?? []).map((extra) => extra.api),
    ])

    // ⚠️ Concurrent, jamais séquentiel. En production, la présence Reverb livre la
    // composition de la room à tous les clients quasi simultanément, AVANT que le P2P
    // démarre. Enchaîner les `syncUsersConnections` un par un laisse le premier pair
    // ouvrir sa connexion alors que le second n'a pas encore peuplé son `remotePeers` :
    // `_isAuthorizedIncomingPeer` la refuse (« émetteur ni membre de la room ni
    // interlocuteur autorisé »), et le test échoue pour une raison de harnais.
    //
    // ⚠️ ANGLE MORT ASSUMÉ, et il a coûté une régression. « Quasi simultanément » n'est
    // pas « dans le même tick » : chez l'arrivant, `remotePeers` n'est écrit qu'après
    // `waitForMeReady` — donc après le peerId local — alors que la demande du diffuseur
    // ne coûte qu'un aller-retour HTTP + Reverb. La fenêtre « je connais mon peerId, pas
    // encore ma room » existe donc bel et bien, et ce helper la referme avant de
    // l'ouvrir. Le scénario qui la vise livre la présence explicitement, un pair après
    // l'autre — cf. `lateJoiner.test.js`, cas « la demande de peerId d'A précède sa
    // présence ».
    await Promise.all(contexts.map((api) => api.syncUsersConnections(users)))

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
