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
 * L'état de ces trois mécanismes vit dans le **store Pinia** (`peerConsumers`,
 * `peerInitPromise`, `peerReconnectAttempts`, les deux handles de timer) — et le registre
 * des contextes l'a rejoint. C'est donc la Pinia neuve posée par `setup.js` avant chaque
 * test qui isole l'état, PAS `vi.resetModules()`.
 *
 * Le reset de modules sert ici à deux autres fins : recharger le mock PeerJS **dans le même
 * graphe** que la copie sous test (sinon `getLastPeerInstance()` ne voit pas ses instances,
 * cf. `helpers/createVirtualPeer.js`), et pouvoir faire coexister deux copies du composable
 * pour reproduire un HMR — ce que fait le dernier bloc.
 *
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockContext } from './helpers/createMockContext.js'
import { withSetup } from './helpers/withSetup.js'
import { bootLocalPeer, waitForPeerInstance } from './helpers/bootLocalPeer.js'
import { usePeer2Store } from '~socializer/stores/peers2.js'
import { PEER_PHASES } from '~socializer/stores/peers2/phases.js'
import {
    ENDPOINTS,
    PEER_DESTROY_DELAY_MS,
    PEER_OPEN_TIMEOUT_MS,
    STUN_ONLY_ICE_SERVERS,
} from '~socializer/components/WebRTC2/webrtc2.config.js'

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

    // `peerCount` et non seulement `lastPeer` : depuis que la création du Peer est précédée d'un
    // aller-retour ICE, `lastPeer()` vaut `null` pendant toute la fenêtre d'init, et une
    // assertion `toBe(premierPeer)` y serait verte pour rien (`null === null`). Le compteur
    // mesure l'invariant « un seul Peer par onglet » directement — et il est aussi strictement
    // plus fort : deux constructions écraseraient `_lastInstance` ET `peerStore.localPeer`, donc
    // aucune comparaison d'identité ne peut les distinguer.
    return {
        usePeerTransport,
        lastPeer: peerMock.getLastPeerInstance,
        peerCount: peerMock.getPeerConstructionCount,
    }
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
            connection: { remotePeers: [] },
        })
        return sharedPeerStore ? { ...ctx, peerStore: sharedPeerStore } : ctx
    }

    const mount = (usePeerTransport, ctx) => {
        const [api, app] = withSetup(() => usePeerTransport(ctx))
        apps.push(app)
        return [api, app]
    }

    /**
     * Démarre le Peer jusqu'à `'open'` — lancer, attendre l'instance, ouvrir, PUIS attendre.
     *
     * ⚠️ `waitForInstance: waitForPeerInstance` partout dans ce fichier, et pas seulement là
     * où l'horloge est déjà factice : plusieurs démarrages ont lieu APRÈS un
     * `vi.useFakeTimers()` posé par le test précédent du même corps (`openThenDestroy`, le
     * bloc « id NEUF »), où `vi.waitFor` avancerait l'horloge de 50 ms par tour de sondage.
     * Un seul motif pour tout le fichier vaut mieux qu'un motif à condition.
     */
    const boot = (api, lastPeer, peerId = 'peer-alice') => bootLocalPeer(
        () => api.setLocalPeer(),
        { peerId, getPeer: lastPeer, waitForInstance: waitForPeerInstance },
    )

    /**
     * Rend la main à la boucle d'événements — un tour de TÂCHE, pas de microtâche.
     *
     * ⚠️ Répéter `await Promise.resolve()` ne suffit pas à conclure qu'une promesse n'est PAS
     * réglée : la chaîne `_doInit()` → `.catch` → `.finally` → le `.then` du test consomme
     * plusieurs tours, et en compter « assez » à la main donne un vert par budget. Une tâche
     * draine la file de microtâches ENTIÈRE : l'assertion porte alors sur un fait.
     * Mesuré : avec trois `Promise.resolve()`, le cas « ne se règle pas tant que l'`open`
     * n'est pas arrivé » passait sur le code d'AVANT le correctif.
     */
    const laisserTourner = () => new Promise((resolve) => { setTimeout(resolve, 0) })

    // ── Garde d'init ─────────────────────────────────────────────────────────────

    it('crée le Peer et ne le déclare prêt qu\'à l\'événement `open`', async () => {
        const { usePeerTransport, lastPeer } = await loadTransportCopy()
        const ctx = makeCtx('stream-a')
        const [api] = mount(usePeerTransport, ctx)

        const init = api.setLocalPeer()

        const peer = await waitForPeerInstance(lastPeer)
        expect(peer).not.toBeNull()
        expect(ctx.peerStore.localPeer).toBe(peer)
        // La phase ne suit pas la création mais la connexion réelle au serveur : le Peer
        // existe (`connecting`), il n'est pas joignable.
        expect(ctx.peerStore.peerPhase).toBe(PEER_PHASES.CONNECTING)

        peer._triggerEvent('open', 'peer-alice')
        await init

        expect(ctx.peerStore.peerPhase).toBe(PEER_PHASES.READY)
        expect(ctx.peerStore.lastLocalPeerId).toBe('peer-alice')
    })

    it('deux contextes qui montent ensemble partagent la même init — un seul Peer', async () => {
        const { usePeerTransport, lastPeer, peerCount } = await loadTransportCopy()
        const ctxA = makeCtx('stream-a')
        const ctxB = makeCtx('data-app', ctxA.peerStore)
        const [apiA] = mount(usePeerTransport, ctxA)
        const [apiB] = mount(usePeerTransport, ctxB)

        // Aucun `await` entre les deux appels : c'est la fenêtre de race réelle
        // (DataRoom + StreamRoom montés dans le même tick).
        const initA = apiA.setLocalPeer()

        // À cet instant le Peer n'existe pas encore — `_doInit` attend la configuration ICE. La
        // garde qui tient n'est donc plus l'instance, mais `peerInitPromise`, posée
        // synchroniquement par le premier appelant.
        expect(ctxA.peerStore.peerInitPromise).not.toBeNull()

        const initB = apiB.setLocalPeer()

        const created = await waitForPeerInstance(lastPeer)
        created._triggerEvent('open', 'peer-alice')
        await Promise.all([initA, initB])

        expect(created).not.toBeNull()
        expect(peerCount()).toBe(1)
        expect(ctxA.peerStore.localPeer).toBe(created)
    })

    it('ne crée pas un second Peer pendant que le premier attend son `open`', async () => {
        // 🔥 Régression du 2026-08-14 (« A diffuse, B reste sur le spinner »).
        //
        // La fenêtre existait parce que `peerInitPromise` retombait dès le `Peer` CONSTRUIT,
        // c'est-à-dire au milieu de celle qu'elle prétendait couvrir : la phase ne passe
        // `ready` qu'à la réception de `'open'`, un aller-retour réseau plus tard. Entre les
        // deux, seule la garde d'INSTANCE couvrait.
        //
        // C'est la situation NOMINALE en production : `Notifications.vue` monte le contexte
        // permanent `data-app` au tick 0, et le contexte `stream-<room>` monte après la
        // résolution de route + un import dynamique — soit bien après la récupération ICE, et
        // bien avant l'arrivée de `'open'`.
        //
        // ⚠️ Ce que ce test épingle a changé de porteur : depuis que l'init attend l'`'open'`,
        // la garde de promesse couvre la fenêtre ENTIÈRE et la garde d'instance redevient une
        // ceinture. Les deux sont vérifiées ci-dessous — l'assertion `initB === initA` est la
        // neuve, et c'est elle qui dit que la fenêtre est fermée par CONSTRUCTION.
        const { usePeerTransport, lastPeer } = await loadTransportCopy()
        const ctxA = makeCtx('data-app')
        const [apiA] = mount(usePeerTransport, ctxA)

        const initA = apiA.setLocalPeer()
        const peer1 = await waitForPeerInstance(lastPeer)

        // La fenêtre de production : le Peer existe, son `'open'` n'est pas arrivé.
        expect(ctxA.peerStore.peerInitPromise).not.toBeNull()
        expect(ctxA.peerStore.peerPhase).toBe(PEER_PHASES.CONNECTING)

        const ctxB = makeCtx('stream-live', ctxA.peerStore)
        const [apiB] = mount(usePeerTransport, ctxB)
        let bReglee = false
        const initB = apiB.setLocalPeer()
        initB.then(() => { bReglee = true })
        await laisserTourner()

        // ⭐ Le second appelant attend LA MÊME chose que le premier, au lieu de sortir sur
        // un `undefined` immédiat pendant que le pair n'est pas joignable.
        //
        // ⚠️ Ce n'est PAS `expect(initB).toBe(initA)` : `setLocalPeer` est `async`, donc son
        // `return peerStore.peerInitPromise` enveloppe la promesse du store dans une promesse
        // neuve qui l'adopte. L'identité n'est jamais observable de l'extérieur — l'observable
        // est la DATE de règlement, qui est justement le fait de cet item.
        expect(bReglee).toBe(false)

        // Un second Peer ici, c'est le premier qui reste enregistré côté serveur PeerJS
        // — débranché de surcroît, et hors d'atteinte de `_destroyPeerSingleton` qui n'agit
        // que sur `peerStore.localPeer`.
        expect(lastPeer()).toBe(peer1)
        expect(peer1.off).not.toHaveBeenCalled()

        // Le fait métier : le `open` du peer que le store publie renseigne bien l'identité
        // locale. Débranché, il ne renseigne rien — `lastLocalPeerId` reste `null`,
        // `waitForMeReady` expire au bout de 15 s et l'arrivant ne reçoit jamais le flux.
        peer1._triggerEvent('open', 'peer-alice')
        await Promise.all([initA, initB])

        expect(ctxA.peerStore.localPeer).toBe(peer1)
        expect(ctxA.peerStore.lastLocalPeerId).toBe('peer-alice')
        expect(ctxA.peerStore.peerPhase).toBe(PEER_PHASES.READY)
    })

    it('ne recrée rien quand le Peer est déjà prêt', async () => {
        const { usePeerTransport, lastPeer } = await loadTransportCopy()
        const ctxA = makeCtx('stream-a')
        const [apiA] = mount(usePeerTransport, ctxA)
        const peer = await boot(apiA, lastPeer)

        const ctxB = makeCtx('data-app', ctxA.peerStore)
        const [apiB] = mount(usePeerTransport, ctxB)
        await apiB.setLocalPeer()

        expect(lastPeer()).toBe(peer)
        expect(ctxA.peerStore.localPeer).toBe(peer)
    })

    it('n\'emporte aucun id historique quand une ré-init échoue', async () => {
        // Le `.catch` de `_doInit` n'était exercé par AUCUN test : il laissait
        // `lastLocalPeerId` posé sur un peer qu'il venait lui-même de retirer du store —
        // la contradiction que `peerStateViolations` nomme `id-historique-sans-peer`.
        //
        // ⚠️ L'enchaînement compte, et c'est le SEUL de la production qui amène là : toute
        // destruction passant par `_destroyPeerSingleton` finit sur `resetPeerState()`, qui
        // nulle déjà l'id. Il faut donc une instance abandonnée PAR PeerJS (`_abort()` →
        // `destroy()`, sans passer par nous) pour qu'une init reparte — le garde d'instance
        // ne retient que les peers vivants — avec l'identité de la vie précédente encore
        // publiée.
        const { usePeerTransport, lastPeer } = await loadTransportCopy()
        const ctx = makeCtx('stream-a')
        const [api] = mount(usePeerTransport, ctx)

        await boot(api, lastPeer)
        expect(ctx.peerStore.lastLocalPeerId).toBe('peer-alice')

        // Le champ PRIVÉ, jamais l'accesseur : `destroyed` est en lecture seule des deux
        // côtés (cf. les sept accesseurs de `__mocks__/peerjs.js`). Passer par le vrai
        // `destroy()` émettrait `disconnected` et armerait un backoff — du bruit qui ne
        // dit rien de plus ici.
        lastPeer()._destroyed = true

        // La cause exacte de l'échec est indifférente : le `.catch` est un filet générique.
        // On fait jeter le premier verbe appelé après `new Peer`, donc dans le segment
        // SYNCHRONE de `_doInit` — celui d'après la garde d'annulation, le seul où une
        // exception ne peut pas être celle d'une init supplantée.
        ctx.peerStore.markPeerConnecting.mockImplementationOnce(() => { throw new Error('boom') })

        await api.setLocalPeer()

        expect(ctx.peerStore.localPeer).toBeNull()
        expect(ctx.peerStore.peerPhase).toBe(PEER_PHASES.ABSENT)
        // Le fait de l'item : les deux moitiés de l'identité s'oublient ENSEMBLE. Un id
        // historique sans peer ne trompe plus personne aujourd'hui (la barrière lit
        // l'identité courante), mais il attend le prochain lecteur qui s'y raccrocherait.
        expect(ctx.peerStore.lastLocalPeerId).toBeNull()
        expect(ctx.peerStore.peerStateViolations()).toEqual([])
    })

    // ── L'invariant, énoncé une fois ─────────────────────────────────────────────
    //
    // Les tests ci-dessus couvrent chacun UNE fenêtre de montage ; celui-ci énonce la règle
    // dont ils sont des cas particuliers : **un onglet n'a jamais deux instances de `Peer`**,
    // quel que soit le moment où un second contexte se monte. Quatre gardes concourent à le
    // tenir (la phase, l'instance, `peerInitPromise`, et la garde d'annulation
    // post-récupération ICE) — c'est ici, et non dans chacune de leurs implémentations, qu'il
    // faut venir vérifier qu'ils tiennent encore après un remaniement.

    describe('invariant : une seule instance de Peer par onglet', () => {
        const FENÊTRES = [
            {
                label: 'même tick — aucun `await` entre les deux montages',
                ouvrir: async () => {},
            },
            {
                // Fenêtre ouverte le 2026-08-23 par le passage des credentials TURN côté
                // serveur : `_doInit` attend désormais `/get-ice-servers` avant de construire le
                // `Peer`. Pendant ce vol, `localPeer` est `null` et SEULE `peerInitPromise`
                // garde l'invariant.
                label: 'récupération ICE en vol — le Peer n\'existe pas encore',
                ouvrir: async () => { await Promise.resolve() },
            },
            {
                // ⚠️ Cette fenêtre s'observait par `await initA` tant que l'init retombait au
                // `new Peer`. Elle ne le peut plus — l'init ne se règle qu'à l'`'open'`, donc
                // l'attendre ici ferait l'inverse de ce que la fenêtre décrit. L'observable
                // est désormais l'existence de l'instance, qui est le fait qu'on visait.
                label: 'Peer construit, `open` pas encore reçu (le cas de production)',
                ouvrir: async (initA, lastPeer) => { await waitForPeerInstance(lastPeer) },
            },
            {
                label: '`open` déjà reçu',
                ouvrir: async (initA, lastPeer) => {
                    const peer = await waitForPeerInstance(lastPeer)
                    peer._triggerEvent('open', 'peer-alice')
                    await initA
                },
            },
        ]

        it.each(FENÊTRES)('un seul Peer — $label', async ({ ouvrir }) => {
            const { usePeerTransport, lastPeer, peerCount } = await loadTransportCopy()
            const ctxA = makeCtx('data-app')
            const [apiA] = mount(usePeerTransport, ctxA)

            const initA = apiA.setLocalPeer()

            // Le `Peer` n'existe pas encore à cet instant (récupération ICE en vol) : la garde
            // qui tient est `peerInitPromise`, posée synchroniquement.
            expect(ctxA.peerStore.peerInitPromise).not.toBeNull()

            await ouvrir(initA, lastPeer)

            const ctxB = makeCtx('stream-live', ctxA.peerStore)
            const [apiB] = mount(usePeerTransport, ctxB)
            const initB = apiB.setLocalPeer()

            // Amener l'unique init à son terme, quelle que soit la fenêtre. Le test de
            // `peer.open` n'est pas de la prudence : les quatre fenêtres se distinguent
            // précisément par le fait que l'`'open'` a été émis ou non avant le second
            // montage, et un second `'open'` ferait rejouer `markPeerOpen` sur un peer déjà
            // prêt — une transition que la production ne produit jamais.
            const peerUnique = await waitForPeerInstance(lastPeer)
            if (!peerUnique.open) peerUnique._triggerEvent('open', 'peer-alice')
            await Promise.all([initA, initB])

            // ⚠️ Le compteur, et pas seulement l'identité : une seconde construction écraserait
            // `_lastInstance` ET `peerStore.localPeer`, donc `toBe(premierPeer)` ne peut pas la
            // détecter. C'est l'assertion qui porte réellement l'invariant.
            expect(peerCount()).toBe(1)
            expect(peerUnique).not.toBeNull()
            expect(ctxA.peerStore.localPeer).toBe(peerUnique)
            // Un peer supplanté serait débranché de ses listeners tout en restant
            // enregistré côté serveur PeerJS, et hors d'atteinte de `_destroyPeerSingleton`.
            expect(peerUnique.off).not.toHaveBeenCalled()
        })
    })

    // ── L'init n'est finie qu'à l'`open` ─────────────────────────────────────────
    //
    // « Init terminée » signifiait « `Peer` construit », pas « pair joignable » : la promesse
    // retombait au milieu de la fenêtre qu'elle prétendait garder. Les cas ci-dessous
    // épinglent la borne réelle — l'`'open'` —, ses deux sorties en échec (erreur, délai) et
    // ce qu'elles laissent derrière elles.
    //
    // ⚠️ La sortie sur DÉLAI est la seule qui ferme un défaut de production, et il n'a rien
    // d'exotique : un `Peer` dont la socket s'ouvre sans que le serveur envoie jamais son
    // `OPEN` — et sans erreur, donc sans `_abort` — reste vivant en phase `connecting`. La
    // garde d'instance de `setLocalPeer` respecte tout `Peer` vivant : plus aucune ré-init
    // n'était possible pour la vie de l'onglet, sans un log.
    //
    // ── Contrôles de harnais, mesurés le 2026-08-29 ────────────────────────────────
    //
    //   1. l'attente de l'`'open'` retirée (`_doInit` se règle au `new Peer`) ... 4 cas + 2 retournés
    //   2. le rejet remonté au-dessus du test `err.type !== 'peer-unavailable'` .. 1 cas (« ne conclut pas »)
    //   3. `_destroyPeerSingleton` retiré du minuteur ............................ 1 cas (« abandonne ET détruit »)
    //   4. la garde d'identité du `.catch` retirée ............................... 1 cas (« supplantée »)
    //   5. la garde `localPeer === peer` du minuteur retirée ..................... 1 cas (« supplantée »)
    //   6. la résolution déplacée au-dessus de la garde d'identité de `'open'` ... AUCUN, et c'est
    //      attendu : toute supplantation détache les listeners AVANT (`setPeerListenersDetach`
    //      exécute la closure précédente, `_destroyPeerSingleton` appelle `detachPeerListeners`),
    //      donc un `'open'` ne peut pas atteindre le handler d'un peer supplanté. Une résolution
    //      posée dans cette branche serait du code qu'aucun test ne peut faire rougir.

    describe('l\'init ne se termine qu\'à l\'`open`', () => {

        it('ne se règle pas tant que l\'`open` n\'est pas arrivé', async () => {
            const { usePeerTransport, lastPeer } = await loadTransportCopy()
            const ctx = makeCtx('data-app')
            const [api] = mount(usePeerTransport, ctx)

            let reglee = false
            const init = api.setLocalPeer()
            init.then(() => { reglee = true })

            const peer = await waitForPeerInstance(lastPeer)
            // Toute sa chance à une résolution : une tâche entière, donc toute la file de
            // microtâches, après la construction du Peer.
            await laisserTourner()

            // ⭐ Le fait de l'item. `setLocalPeer` ne rend toujours rien d'exploitable — c'est
            // sa DATE qui change, et c'est ce qui rend `await setLocalPeer()` puis
            // `peerIdentity()` une séquence qui a un sens.
            expect(reglee).toBe(false)
            expect(ctx.peerStore.peerInitPromise).not.toBeNull()
            expect(ctx.peerStore.peerPhase).toBe(PEER_PHASES.CONNECTING)

            peer._triggerEvent('open', 'peer-alice')
            await init

            expect(reglee).toBe(true)
            expect(ctx.peerStore.peerIdentity()).toMatchObject({ state: 'ready', id: 'peer-alice' })
            expect(ctx.peerStore.peerInitPromise).toBeNull()
        })

        it('conclut en échec quand PeerJS émet une erreur avant l\'`open`', async () => {
            const { usePeerTransport, lastPeer } = await loadTransportCopy()
            const ctx = makeCtx('data-app')
            const [api] = mount(usePeerTransport, ctx)

            const init = api.setLocalPeer()
            const peer = await waitForPeerInstance(lastPeer)

            // ⚠️ Aucune liste d'`err.type` fatals à maintenir, et c'est vérifié dans la lib :
            // `_abort()` fait `emitError(type)` PUIS `if (!this._lastServerId) this.destroy()`
            // (peerjs 1.5.4, `dist/bundler.mjs:1761-1764`), et `_lastServerId` n'est posé qu'à
            // la réception de l'`OPEN` (`:1595`). Toute erreur fatale AVANT l'ouverture détruit
            // donc l'instance côté PeerJS : il n'y a rien à détruire de notre côté, et le
            // critère « la promesse est encore pendante » suffit.
            peer._triggerEvent('error', Object.assign(new Error('API KEY invalide'), { type: 'invalid-key' }))

            // ⭐ Ne doit pas rester pendante : sans issue sur erreur, l'init ne sortirait que
            // par son délai, huit secondes plus tard.
            await init

            expect(ctx.peerStore.localPeer).toBeNull()
            expect(ctx.peerStore.peerPhase).toBe(PEER_PHASES.ABSENT)
            expect(ctx.peerStore.lastLocalPeerId).toBeNull()
            expect(ctx.peerStore.peerInitPromise).toBeNull()
            expect(ctx.peerStore.peerStateViolations()).toEqual([])
            // PeerJS a déjà avorté l'instance : la détruire une seconde fois serait du bruit.
            expect(peer.destroy).not.toHaveBeenCalled()
        })

        it('ne conclut PAS sur un `peer-unavailable`, qui parle d\'un pair distant', async () => {
            // ⚠️ Garde de MUTATION avant tout : c'est ce cas, et lui seul, qui rougit si le
            // rejet est remonté au-dessus du test de type. `peer-unavailable` est le seul
            // événement d'erreur qui ne dise rien de NOTRE pair — il nomme un peerId distant
            // injoignable, et il tombe pendant toute la vie du Peer.
            const { usePeerTransport, lastPeer } = await loadTransportCopy()
            const ctx = makeCtx('data-app')
            const [api] = mount(usePeerTransport, ctx)

            let reglee = false
            const init = api.setLocalPeer()
            init.then(() => { reglee = true })
            const peer = await waitForPeerInstance(lastPeer)

            peer._triggerEvent(
                'error',
                Object.assign(new Error('Could not connect to peer peer-bob'), { type: 'peer-unavailable' }),
            )
            await laisserTourner()

            expect(reglee).toBe(false)                       // ⭐
            expect(ctx.peerStore.localPeer).toBe(peer)
            expect(ctx.peerStore.peerPhase).toBe(PEER_PHASES.CONNECTING)

            peer._triggerEvent('open', 'peer-alice')
            await init

            expect(ctx.peerStore.peerIdentity()).toMatchObject({ state: 'ready', id: 'peer-alice' })
        })

        it('abandonne ET DÉTRUIT le Peer qui n\'a jamais reçu son `open`', async () => {
            const { usePeerTransport, lastPeer } = await loadTransportCopy()
            const ctx = makeCtx('data-app')
            const [api] = mount(usePeerTransport, ctx)

            // Faux minuteurs AVANT le lancement, contrairement au reste du fichier : le
            // minuteur qu'on pilote est armé PENDANT `_doInit`. Jouable parce que
            // `AjaxService.load` résout par microtâche (invariant en tête de
            // `fetchIceServers.js`), donc la récupération ICE n'a besoin d'aucune horloge.
            vi.useFakeTimers()

            const init = api.setLocalPeer()
            const peer = await waitForPeerInstance(lastPeer)

            await vi.advanceTimersByTimeAsync(PEER_OPEN_TIMEOUT_MS)
            await init

            // ⭐ DÉTRUIRE, pas seulement oublier. Un `localPeer = null` sur une instance
            // VIVANTE laisserait une socket ouverte et un peerId enregistré côté serveur
            // PeerJS, hors d'atteinte de `_destroyPeerSingleton` qui n'agit que sur
            // `peerStore.localPeer` : un peerId fantôme de plus, par un chemin neuf.
            expect(peer.destroy).toHaveBeenCalledOnce()
            expect(ctx.peerStore.localPeer).toBeNull()
            expect(ctx.peerStore.peerPhase).toBe(PEER_PHASES.ABSENT)
            expect(ctx.peerStore.peerInitPromise).toBeNull()

            // Le fait métier, et la raison d'être du délai : la session REPART. Sans lui, la
            // garde d'instance respecterait le Peer bloqué en `connecting` pour la vie de
            // l'onglet et aucun contexte ne pourrait plus en obtenir un.
            const ctxB = makeCtx('stream-live', ctx.peerStore)
            const [apiB] = mount(usePeerTransport, ctxB)
            const peerB = await boot(apiB, lastPeer, 'peer-bob')

            expect(peerB).not.toBe(peer)
            expect(ctx.peerStore.peerIdentity()).toMatchObject({ state: 'ready', id: 'peer-bob' })
        })

        it('une init supplantée qui expire ne touche pas le Peer courant', async () => {
            // ⭐ Le test qui remplace une preuve tombée. Le `.catch` de l'init n'avait besoin
            // d'aucune garde d'identité tant que le seul `await` du corps était celui de l'ICE,
            // immédiatement suivi de sa garde d'annulation : tout ce qui pouvait jeter ensuite
            // était SYNCHRONE, donc l'init qui échouait ne pouvait être que la courante.
            // L'attente de l'`'open'` ajoute un second point de suspension, long, avec deux
            // sorties en échec — et sans garde, une init périmée nulle le `localPeer` d'une
            // init plus récente, sans une ligne d'erreur.
            //
            // ⚠️ Le VRAI store Pinia : ce cas porte sur ce que `resetPeerState` fait
            // réellement (nuller la promesse), pas sur la surface du double.
            const { usePeerTransport, lastPeer } = await loadTransportCopy()
            const peerStore = usePeer2Store()
            const ctxA = { ...makeCtx('stream-a'), peerStore }
            const [apiA] = mount(usePeerTransport, ctxA)

            vi.useFakeTimers()

            const initA = apiA.setLocalPeer()
            const peer1 = await waitForPeerInstance(lastPeer)

            // Ce que fait LITTÉRALEMENT une destruction du singleton : elle détache les
            // listeners de peer1 et nulle `peerInitPromise`. Plus aucun `'open'` ne viendra
            // régler cette init : il ne lui reste que son minuteur pour sortir.
            peerStore.resetPeerState()

            const ctxB = { ...makeCtx('data-app'), peerStore }
            const [apiB] = mount(usePeerTransport, ctxB)
            const initB = apiB.setLocalPeer()
            const peer2 = await waitForPeerInstance(lastPeer, { previous: peer1 })
            peer2._triggerEvent('open', 'peer-bob')
            await initB

            console.error.mockClear()

            // L'init périmée expire ICI, alors que le store décrit le Peer de B.
            await vi.advanceTimersByTimeAsync(PEER_OPEN_TIMEOUT_MS)
            await initA

            // Elle a bien expiré — sans cette assertion, tout ce qui suit serait vrai par
            // absence de mécanisme.
            expect(console.error).toHaveBeenCalled()

            expect(peerStore.localPeer).toBe(peer2)                            // ⭐ garde du `.catch`
            expect(peerStore.peerIdentity()).toMatchObject({ state: 'ready', id: 'peer-bob' })
            expect(peer2.destroy).not.toHaveBeenCalled()                       // ⭐ garde du minuteur
        })
    })

    // ── Ref-counting & destruction différée ──────────────────────────────────────

    it('diffère la destruction de PEER_DESTROY_DELAY_MS après le départ du dernier consommateur', async () => {
        const { usePeerTransport, lastPeer } = await loadTransportCopy()
        const ctx = makeCtx('stream-a')
        const [api, app] = mount(usePeerTransport, ctx)
        const peer = await boot(api, lastPeer)

        vi.useFakeTimers()
        app.unmount()

        expect(peer.destroy).not.toHaveBeenCalled()
        vi.advanceTimersByTime(PEER_DESTROY_DELAY_MS - 1)
        expect(peer.destroy).not.toHaveBeenCalled()

        vi.advanceTimersByTime(1)

        expect(peer.destroy).toHaveBeenCalledOnce()
        expect(ctx.peerStore.localPeer).toBeNull()
        expect(ctx.peerStore.peerPhase).toBe(PEER_PHASES.ABSENT)
        expect(ctx.peerStore.lastLocalPeerId).toBeNull()
    })

    it('garde le Peer tant qu\'un autre consommateur est monté', async () => {
        const { usePeerTransport, lastPeer } = await loadTransportCopy()
        const ctxA = makeCtx('stream-a')
        const ctxB = makeCtx('data-app', ctxA.peerStore)
        const [apiA] = mount(usePeerTransport, ctxA)
        const [apiB, appB] = mount(usePeerTransport, ctxB)
        const both = Promise.all([apiA.setLocalPeer(), apiB.setLocalPeer()])
        const peer = await waitForPeerInstance(lastPeer)
        peer._triggerEvent('open', 'peer-alice')
        await both

        vi.useFakeTimers()
        appB.unmount()
        vi.advanceTimersByTime(PEER_DESTROY_DELAY_MS * 2)

        expect(peer.destroy).not.toHaveBeenCalled()
        expect(ctxA.peerStore.localPeer).toBe(peer)
    })

    it('une destruction ne réarme pas une destruction sur le Peer suivant, encore consommé', async () => {
        // ⭐ Le second cycle « gratuit », et il n'était couvert par rien.
        //
        // `resetPeerState` vidait le compteur de consommateurs alors que des composants
        // étaient TOUJOURS montés. Comme le décrément était planché à 0, le démontage suivant
        // de l'un d'eux rendait `0` — indistinguable de « le dernier vient de partir » — et
        // l'appelant, qui testait `<= 0`, réarmait une destruction sur le Peer RECONSTRUIT
        // entre-temps, que les autres contextes utilisaient encore.
        // ⚠️ La reconstruction doit venir d'un consommateur DÉJÀ inscrit, et c'est tout le
        // sel du scénario : son `_isRegisteredAsConsumer` est déjà vrai, donc il ne réajoute
        // pas son jeton. Sous l'ancienne sémantique, le compteur restait donc à 0 pendant
        // qu'il reconstruisait — et le démontage suivant de son voisin rendait 0, lu comme
        // « plus personne ». Un troisième contexte neuf masquerait le bug (il réinscrirait
        // un jeton, donc le compteur ne serait plus nul).
        // ⚠️ Le VRAI store Pinia, pas le mock : ce test porte sur la SÉMANTIQUE du
        // ref-counting (que rend `removePeerConsumer`, et ce que `resetPeerState` touche).
        // `mockFidelity` ne garantit que la surface — un test contre le mock ne prouverait
        // rien du store, et c'est exactement le piège que ce fichier documente plus haut.
        const { usePeerTransport, lastPeer } = await loadTransportCopy()
        const peerStore = usePeer2Store()

        const ctxA = { ...makeCtx('stream-a'), peerStore }
        const ctxB = { ...makeCtx('data-app'), peerStore }
        const [apiA, appA] = mount(usePeerTransport, ctxA)
        const [apiB] = mount(usePeerTransport, ctxB)
        const both = Promise.all([apiA.setLocalPeer(), apiB.setLocalPeer()])
        ;(await waitForPeerInstance(lastPeer))._triggerEvent('open', 'peer-alice')
        await both

        // Une destruction complète passe par là (ce que fait `_destroyPeerSingleton`).
        peerStore.resetPeerState()

        // B, toujours monté, reconstruit le Peer. C'est CELUI-LÀ qu'il ne faut pas perdre.
        const rebuilt = await boot(apiB, lastPeer, 'peer-alice-2')

        // A se démonte. B est toujours là : rien ne doit être détruit.
        vi.useFakeTimers()
        appA.unmount()
        vi.advanceTimersByTime(PEER_DESTROY_DELAY_MS * 2)

        expect(rebuilt.destroy).not.toHaveBeenCalled()
        expect(peerStore.localPeer).toBe(rebuilt)
    })

    it('annule la destruction si un consommateur remonte pendant le délai', async () => {
        const { usePeerTransport, lastPeer } = await loadTransportCopy()
        const ctxA = makeCtx('stream-a')
        const [apiA, appA] = mount(usePeerTransport, ctxA)
        const peer = await boot(apiA, lastPeer)

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
        const peer = await boot(api, lastPeer)

        // État exact laissé par le `catch` de l'init : le peer a disparu du store alors
        // que le consommateur est encore monté.
        ctx.peerStore.localPeer = null
        ctx.peerStore.markPeerAbsent('après échec d\'init du Peer')

        vi.useFakeTimers()
        app.unmount()

        expect(() => vi.advanceTimersByTime(PEER_DESTROY_DELAY_MS)).not.toThrow()
        expect(peer.destroy).not.toHaveBeenCalled()
    })

    // ── Détachement des listeners du Peer ────────────────────────────────────────
    //
    // `peer.destroy()` ne débranche PAS nos handlers : vérifié dans peerjs 1.5.4
    // (`dist/bundler.mjs`), son `_cleanup()` ne fait `removeAllListeners()` que sur le socket
    // interne (l.1789). Le transport doit donc les retirer lui-même, sans quoi ils
    // continuent d'écrire dans un store qui ne décrit plus aucun peer.

    describe('détachement des listeners avant destruction', () => {

        /** Monte un consommateur, ouvre le peer, puis le détruit par ref-counting. */
        const openThenDestroy = async (usePeerTransport, lastPeer, ctx, peerId) => {
            const [api, app] = mount(usePeerTransport, ctx)
            const peer = await boot(api, lastPeer, peerId)

            vi.useFakeTimers()
            app.unmount()
            vi.advanceTimersByTime(PEER_DESTROY_DELAY_MS)

            return peer
        }

        it('débranche chaque listener qu\'il a branché, et tous avant `destroy()`', async () => {
            const { usePeerTransport, lastPeer } = await loadTransportCopy()
            const ctx = makeCtx('stream-a')

            const peer = await openThenDestroy(usePeerTransport, lastPeer, ctx, 'peer-alice')

            expect(peer.destroy).toHaveBeenCalledOnce()
            // Garde : sans listener branché, la boucle ci-dessous ne vérifierait rien.
            expect(peer.on.mock.calls.length).toBeGreaterThan(0)

            // Assertion structurelle assumée — « pas de fuite » n'a pas d'autre observable.
            // C'est elle qui empêche un 6e listener ajouté plus tard d'échapper au
            // détachement : il faudrait le brancher hors du helper `bind` pour la casser.
            peer.on.mock.calls.forEach(([event, handler]) => {
                expect(peer.off.mock.calls).toContainEqual([event, handler])
            })

            // Et l'ordre : détacher APRÈS `destroy()` reviendrait à dépendre de ce que
            // PeerJS fait (ou ne fait pas) de ses listeners pendant sa destruction.
            const lastOff = Math.max(...peer.off.mock.invocationCallOrder)
            expect(lastOff).toBeLessThan(peer.destroy.mock.invocationCallOrder[0])
        })

        it('un `error` livré après la destruction ne remonte plus rien', async () => {
            // Un `error` peut tomber bien après un `destroy()` : `emitError`
            // (`bundler.mjs:1761`) n'a aucun garde `destroyed`, et il est atteint par
            // plusieurs chemins asynchrones (`Socket` en cours de fermeture, `_abort`).
            //
            // ⚠️ Ce commentaire décrivait auparavant le chemin `retrieveId()` de
            // `new Peer({host,…})` — arité que la production n'utilise PLUS : elle fournit son
            // id, donc `_initialize` est synchrone. Ce chemin-là est fermé (cf. le bloc
            // « identité du Peer à la construction »), mais le détachement reste nécessaire :
            // c'est `emitError` qui est sans garde, pas seulement son appelant HTTP.
            const { usePeerTransport, lastPeer } = await loadTransportCopy()
            const ctx = makeCtx('stream-a')

            const peer = await openThenDestroy(usePeerTransport, lastPeer, ctx, 'peer-alice')
            console.error.mockClear()

            peer._triggerEvent('error', { type: 'server-error', message: 'boom' })

            expect(console.error).not.toHaveBeenCalled()
        })

        it('[invariant] un `open` tardif ne ressuscite pas un peer fantôme', async () => {
            // ⚠️ Ce n'est PAS une repro : aucun chemin PeerJS ne livre un `open` après un
            // `destroy()` (`socket._cleanup()` met `onmessage = null`, bundler.mjs:731, avant
            // tout throw possible). C'est l'invariant « un peer hors-jeu n'écrit plus dans le
            // store », et le garde contre l'état impossible « phase `ready` » avec
            // `localPeer === null` : `setLocalPeer` sortirait alors par sa garde de fraîcheur
            // et plus aucun Peer ne serait jamais recréé — impasse permanente.
            //
            // ⚠️ Il tient désormais par DEUX mécanismes indépendants — le détachement des
            // listeners, et le garde d'identité `peerStore.localPeer !== peer` en tête du
            // handler `open` (ajouté le 2026-08-14 avec le correctif de la double init).
            // Contrôle de harnais fait : neutraliser le seul détachement ne le fait plus
            // rougir. C'est voulu (ceinture et bretelles sur le chemin qui a cassé la prod),
            // mais ça veut dire que **le test qui épingle le détachement est le voisin**
            // (« débranche chaque listener qu'il a branché »), pas celui-ci.
            const { usePeerTransport, lastPeer } = await loadTransportCopy()
            const ctxA = makeCtx('stream-a')

            const peer = await openThenDestroy(usePeerTransport, lastPeer, ctxA, 'peer-alice')

            peer._triggerEvent('open', 'peer-zombie')

            expect(ctxA.peerStore.peerPhase).toBe(PEER_PHASES.ABSENT)
            expect(ctxA.peerStore.lastLocalPeerId).toBeNull()

            // Le fait métier : la room refonctionne, un nouveau contexte obtient un vrai Peer.
            const ctxB = makeCtx('stream-b', ctxA.peerStore)
            const [apiB] = mount(usePeerTransport, ctxB)
            await boot(apiB, lastPeer, 'peer-bob')

            expect(lastPeer()).not.toBe(peer)
            expect(ctxA.peerStore.localPeer).toBe(lastPeer())
        })

        it('ne détache jamais les listeners d\'un autre Peer que le sien', async () => {
            const { usePeerTransport, lastPeer } = await loadTransportCopy()
            const ctxA = makeCtx('stream-a')

            const peer1 = await openThenDestroy(usePeerTransport, lastPeer, ctxA, 'peer-alice')
            const offCallsAfterFirstDestroy = peer1.off.mock.calls.length
            expect(offCallsAfterFirstDestroy).toBe(peer1.on.mock.calls.length)

            // Second cycle complet : le store repart de zéro, un nouveau Peer est créé.
            const ctxB = makeCtx('stream-b', ctxA.peerStore)
            const peer2 = await openThenDestroy(usePeerTransport, lastPeer, ctxB, 'peer-bob')

            expect(peer2).not.toBe(peer1)
            // C'est ce test qui verrouille le choix « bindé sur la const `peer` » : une
            // closure qui relirait `peerStore.localPeer` au moment du `off` aurait détaché le
            // peer COURANT — donc le nº2 lors de la destruction du nº1, et plus personne
            // ensuite.
            expect(peer1.off.mock.calls.length).toBe(offCallsAfterFirstDestroy)
            expect(peer2.off.mock.calls.length).toBe(peer2.on.mock.calls.length)
            expect(peer2.destroy).toHaveBeenCalledOnce()
        })
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
        const both = Promise.all([apiA.setLocalPeer(), apiB.setLocalPeer()])
        const peer = await waitForPeerInstance(lastPeer)
        peer._triggerEvent('open', 'peer-alice')
        await both

        expect(peerStore.peerConsumers.size).toBe(2)
        expect(peerStore.getLocalPeer).toBe(peer)

        vi.useFakeTimers()
        appB.unmount()
        vi.advanceTimersByTime(PEER_DESTROY_DELAY_MS * 2)

        expect(peerStore.peerConsumers.size).toBe(1)
        expect(peer.destroy).not.toHaveBeenCalled()

        appA.unmount()
        vi.advanceTimersByTime(PEER_DESTROY_DELAY_MS)

        expect(peer.destroy).toHaveBeenCalledOnce()
        expect(peerStore.peerConsumers.size).toBe(0)
        expect(peerStore.getLocalPeer).toBeNull()
        // `getLastLocalPeerId` a été supprimé avec la FSM : l'identité historique ne se lit
        // plus seule (c'est elle qui faisait répondre « prêt » sur un peer mort), mais par
        // `peerIdentity().lastId`, où elle voisine avec l'état qui dit ce qu'elle vaut.
        expect(peerStore.peerIdentity()).toMatchObject({ state: 'absent', id: null, lastId: null })
        expect(peerStore.peerInitPromise).toBeNull()
        expect(peerStore.peerDestroyTimer).toBeNull()
    })

    // ── Rechargement de module (HMR) ─────────────────────────────────────────────
    //
    // Le HMR remplace le module `usePeerTransport` mais PAS le store Pinia (le Peer, lui,
    // est toujours vivant). Deux copies du composable coexistent donc, et les tests
    // ci-dessous les reproduisent en chargeant deux copies qui partagent le même store.
    //
    // ⚠️ Ce qui traverse un rechargement a changé, et c'est le sujet du dernier test de ce
    // bloc : le registre des contextes vit désormais dans le store (`peers2/state.js`), et
    // non plus au niveau du module. Quand il était module-level, la copie neuve
    // enregistrait ses contextes dans un registre que les dispatchers du Peer survivant —
    // des closures sur l'ANCIENNE copie — ne consultaient jamais : tout entrant tombait
    // sur « Aucun contexte trouvé » et était FERMÉ. Il ne reste module-level que
    // `_hubRateLimiter`, d'où le `vi.resetModules()` toujours nécessaire.
    describe('rechargement du module (HMR) — même store, copie neuve du composable', () => {

        it('[harnais] une copie rechargée réagit bien au démontage (sinon les tests suivants seraient verts pour rien)', async () => {
            // Sans cette garde, « le peer n'est pas détruit » ne prouverait rien : ce
            // pourrait être un `onUnmounted` non enregistré par la seconde copie.
            await loadTransportCopy()
            const copy2 = await loadTransportCopy()

            const ctx = makeCtx('stream-solo')
            const [api, app] = mount(copy2.usePeerTransport, ctx)
            const peer = await boot(api, copy2.lastPeer, 'peer-solo')

            vi.useFakeTimers()
            app.unmount()
            vi.advanceTimersByTime(PEER_DESTROY_DELAY_MS)

            expect(peer.destroy).toHaveBeenCalledOnce()
        })

        it('le Peer partagé survit au démontage d\'un consommateur enregistré par une AUTRE copie du module', async () => {
            const copy1 = await loadTransportCopy()
            const ctxA = makeCtx('stream-a')
            const [apiA] = mount(copy1.usePeerTransport, ctxA)
            const peer = await boot(apiA, copy1.lastPeer)

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
            // Les deux copies sont chargées d'avance : la fenêtre « init en vol » se referme
            // toute seule, un `await import()` au mauvais moment la manquerait.
            //
            // ⚠️ `copy1` et `copy2` ont chacune LEUR copie du mock (deux `vi.resetModules()`),
            // donc deux `_lastInstance` et deux compteurs distincts. On asserte séparément, on
            // ne somme jamais.
            const copy1 = await loadTransportCopy()
            const copy2 = await loadTransportCopy()

            const ctxA = makeCtx('stream-a')
            const ctxB = makeCtx('data-app', ctxA.peerStore)
            const [apiA] = mount(copy1.usePeerTransport, ctxA)
            const [apiB] = mount(copy2.usePeerTransport, ctxB)

            const inFlight = apiA.setLocalPeer()   // `open` volontairement non déclenché

            // L'init est en vol AVANT même que le Peer existe — c'est l'état que le HMR doit
            // traverser, et il dure désormais un aller-retour réseau au lieu de trois
            // microtâches. La fenêtre couverte par ce test est donc plus longue qu'avant.
            expect(ctxA.peerStore.peerInitPromise).not.toBeNull()
            expect(copy1.lastPeer()).toBeNull()

            apiB.setLocalPeer()

            // Un second Peer ici, c'est l'ancien qui fuit avec un peerId fantôme encore
            // enregistré côté serveur PeerJS — la famille de bugs « peerId périmé collant ».
            expect(copy2.lastPeer()).toBeNull()

            // L'`'open'` avant l'attente : c'est lui qui termine l'init, et le laisser de côté
            // abandonnerait un Peer que rien ne viendrait plus régler.
            ;(await waitForPeerInstance(copy1.lastPeer))._triggerEvent('open', 'peer-alice')
            await inFlight

            // Et après résolution : la copie neuve n'a toujours rien construit, l'ancienne a
            // construit exactement un Peer, et c'est lui que le store partagé publie.
            expect(copy2.lastPeer()).toBeNull()
            expect(copy1.peerCount()).toBe(1)
            expect(ctxA.peerStore.localPeer).toBe(copy1.lastPeer())
        })

        it('le Peer survivant route un entrant vers un contexte enregistré par la copie NEUVE', async () => {
            // ⭐ L'invariant que le déménagement du registre dans le store garantit, et le
            // seul de ce bloc qui touche le chemin des connexions entrantes.
            //
            // Le Peer appartient à la copie 1 : ses dispatchers `on('connection')` sont des
            // closures de CETTE copie. Le contexte destinataire, lui, est monté par la
            // copie 2 (le HMR). Tant que le registre vivait au niveau du module, la copie 1
            // ne voyait pas les contextes de la copie 2 : `resolveContextByMetadata` rendait
            // `null`, la connexion était FERMÉE, et l'utilisateur voyait « A diffuse, B
            // arrive, rien » — à chaque modification de code, sans une ligne d'erreur.
            const copy1 = await loadTransportCopy()
            const ctxA = makeCtx('stream-a')
            const [apiA] = mount(copy1.usePeerTransport, ctxA)
            const peer = await boot(apiA, copy1.lastPeer)

            // 🔥 HMR : copie neuve, MÊME store, et un contexte que seule elle connaît.
            const copy2 = await loadTransportCopy()
            const ctxB = createMockContext({
                contextId: 'data-app',
                session: { currentType: 'data', currentRoom: 'app' },
                connection: { remotePeers: ['bob'] },
            })
            ctxB.peerStore = ctxA.peerStore
            const [apiB] = mount(copy2.usePeerTransport, ctxB)
            await apiB.setLocalPeer()

            // Aucun second Peer : c'est bien celui de la copie 1 qui reçoit.
            expect(copy2.lastPeer()).toBeNull()

            const conn = {
                peer: 'peer-bob',
                metadata: { type: 'data', room: 'app', callbackKey: 'data-app', from: 'bob' },
                close: vi.fn(),
                on: vi.fn(),
            }
            peer._triggerEvent('connection', conn)

            expect(ctxB.setUpConnectionListeners).toHaveBeenCalledWith(conn)
            expect(conn.close).not.toHaveBeenCalled()
        })
    })

    // ── Registre des contextes : le câblage du transport ─────────────────────────
    //
    // La SÉMANTIQUE du registre (last-write-wins, garde d'identité au retrait, survie à
    // `resetPeerState`) est épinglée côté store par `peers2Store.contextRegistry.test.js`.
    // Ici, on n'épingle que le câblage : QUI inscrit, QUI retire, et QUAND.
    //
    // ⚠️ Décision de harnais, et elle n'est pas cosmétique : les deux cas de sémantique
    // ci-dessous tournent contre le VRAI store Pinia. Le double de `createMockContext`
    // réimplémente les deux mêmes gardes — neutraliser celui du store réel laisserait donc
    // un test écrit contre le double parfaitement vert. C'est le piège « deux versants »
    // de docs/architecture/tests.md#pièges-de-mock.

    describe('registre des contextes — câblage du transport', () => {

        it('inscrit le contexte dès `setLocalPeer`, même quand le Peer est déjà prêt', async () => {
            // Le second contexte ne construit rien (le Peer existe), mais il DOIT être
            // inscrit : c'est cette entrée, et elle seule, qui lui vaudra de recevoir les
            // connexions entrantes portant son `callbackKey`.
            const { usePeerTransport, lastPeer, peerCount } = await loadTransportCopy()
            const ctxA = makeCtx('stream-a')
            const [apiA] = mount(usePeerTransport, ctxA)
            await boot(apiA, lastPeer)

            const ctxB = makeCtx('data-app', ctxA.peerStore)
            const [apiB] = mount(usePeerTransport, ctxB)
            await apiB.setLocalPeer()

            expect(peerCount()).toBe(1)
            expect(ctxA.peerStore.getContextById('stream-a')).toBe(ctxA)
            expect(ctxA.peerStore.getContextById('data-app')).toBe(ctxB)
        })

        it('retire le contexte du registre au démontage', async () => {
            // ⚠️ Un seul des DEUX mécanismes de production est exercé ici : en régime
            // nominal, `usePeerOrchestrator.cleanupPeerConnection` appelle d'abord
            // `unregisterLocalContext` (cas suivant). Cet `onUnmounted` est le filet des
            // chemins abrupts — navigation, crash de composant.
            const { usePeerTransport, lastPeer } = await loadTransportCopy()
            const ctxA = makeCtx('stream-a')
            const [apiA, appA] = mount(usePeerTransport, ctxA)
            await boot(apiA, lastPeer)

            expect(ctxA.peerStore.getContextById('stream-a')).toBe(ctxA)

            vi.useFakeTimers()
            appA.unmount()

            expect(ctxA.peerStore.getContextById('stream-a')).toBeNull()
        })

        it('`unregisterLocalContext` retire le contexte sans attendre le démontage', async () => {
            // Le verbe que l'orchestrateur appelle dans son teardown terminal. Il ne touche
            // QUE le registre : le contexte reste consommateur, donc le Peer survit — c'est
            // ce qui distingue un teardown de contexte d'un démontage d'onglet.
            const { usePeerTransport, lastPeer } = await loadTransportCopy()
            const ctxA = makeCtx('stream-a')
            const [apiA] = mount(usePeerTransport, ctxA)
            const peer = await boot(apiA, lastPeer)

            apiA.unregisterLocalContext()

            expect(ctxA.peerStore.getContextById('stream-a')).toBeNull()
            expect(ctxA.peerStore.peerConsumers.size).toBe(1)
            expect(peer.destroy).not.toHaveBeenCalled()
        })

        it('ne laisse aucune entrée derrière lui quand tous les contextes se démontent', async () => {
            // Sur le VRAI store : le registre y survit à `resetPeerState` (c'est voulu),
            // donc rien ne le nettoie à la destruction du Peer. Une entrée oubliée ici est
            // une fuite qui retient un `ctx` complet — et ses closures — pour la vie de
            // l'onglet.
            const { usePeerTransport, lastPeer } = await loadTransportCopy()
            const peerStore = usePeer2Store()
            const contexts = ['stream-a', 'stream-b', 'data-app']
                .map((id) => ({ ...makeCtx(id), peerStore }))
            const mounted = contexts.map((ctx) => mount(usePeerTransport, ctx))

            await boot(mounted[0][0], lastPeer)
            await Promise.all(mounted.slice(1).map(([api]) => api.setLocalPeer()))

            expect(peerStore.contextRegistry.size).toBe(3)

            vi.useFakeTimers()
            mounted.forEach(([, app]) => app.unmount())

            expect(peerStore.contextRegistry.size).toBe(0)
        })

        it('un contexte remonté sous le même id garde le registre quand l\'ancien se démonte', async () => {
            // ⭐ Le versant TRANSPORT du garde d'identité — l'autre est dans
            // `peers2Store.contextRegistry.test.js`. C'est la séquence réelle d'une
            // navigation SPA : Vue monte le remplaçant AVANT de démonter le sortant, donc
            // l'`onUnmounted` de l'ancien s'exécute alors que l'entrée appartient déjà au
            // neuf. Sans le garde, le neuf serait effacé du registre sans rien émettre, et
            // ne recevrait plus aucune connexion entrante.
            const { usePeerTransport, lastPeer } = await loadTransportCopy()
            const peerStore = usePeer2Store()
            const ctxAncien = { ...makeCtx('stream-a'), peerStore }
            const ctxNeuf = { ...makeCtx('stream-a'), peerStore }

            const [apiAncien, appAncien] = mount(usePeerTransport, ctxAncien)
            await boot(apiAncien, lastPeer)

            const [apiNeuf] = mount(usePeerTransport, ctxNeuf)
            await apiNeuf.setLocalPeer()

            expect(peerStore.getContextById('stream-a')).toBe(ctxNeuf)

            vi.useFakeTimers()
            appAncien.unmount()

            expect(peerStore.getContextById('stream-a')).toBe(ctxNeuf)
        })

        it('[structurel] retire le contexte AVANT de décompter le consommateur', async () => {
            // ⚠️ Filet STRUCTUREL, pas fait métier — à lire comme « tous les `off` avant
            // `destroy()` » plus haut. Sous la configuration actuelle
            // (`PEER_DESTROY_DELAY_MS > 0`, et `resetPeerState` qui ne touche pas au
            // registre), AUCUN comportement observable ne dépend de cet ordre : son seul
            // contrôle négatif est l'inversion des deux lignes de l'`onUnmounted`.
            // Il tient parce que l'inverse serait fragile — décompter d'abord peut
            // déclencher une destruction, et un dispatcher du Peer mourant consulterait
            // alors un registre qui contient encore un contexte en cours de démontage.
            const { usePeerTransport, lastPeer } = await loadTransportCopy()
            const ctxA = makeCtx('stream-a')
            const [apiA, appA] = mount(usePeerTransport, ctxA)
            await boot(apiA, lastPeer)

            ctxA.peerStore.unregisterContext.mockClear()
            ctxA.peerStore.removePeerConsumer.mockClear()

            vi.useFakeTimers()
            appA.unmount()

            const [retrait] = ctxA.peerStore.unregisterContext.mock.invocationCallOrder
            const [decompte] = ctxA.peerStore.removePeerConsumer.mock.invocationCallOrder

            expect(retrait).toBeDefined()
            expect(decompte).toBeDefined()
            expect(retrait).toBeLessThan(decompte)
        })
    })

    // ── Configuration ICE servie par le serveur ──────────────────────────────────
    //
    // Les identifiants TURN étaient lus dans `import.meta.env.VITE_COTURN_*`, donc inlinés par
    // Vite dans le bundle public : le mot de passe du conteneur coturn était lisible en ouvrant
    // le JS. `_doInit` les récupère désormais auprès de `/get-ice-servers`.
    //
    // Contrôle de harnais : neutraliser la garde d'annulation de `_doInit` (le
    // `if (peerStore.peerInitPromise !== initPromise) return`) doit faire rougir les deux
    // derniers tests de ce bloc, et EUX SEULS. Vérifié le 2026-08-23.

    // ── L'id est fourni par NOUS, en 1er argument ─────────────────────────────────
    //
    // Rien n'épinglait cette forme, et le mock normalise les deux arités : un retour à
    // `new Peer({ host, … })` laissait toute la suite VERTE. Or ce n'est pas cosmétique.
    //
    // Sans id, peerjs résout le sien par HTTP puis fait `retrieveId().then(id =>
    // this._initialize(id))`, sans aucun garde `destroyed`. Un `destroy()` pendant cet
    // aller-retour n'empêche donc rien : `Socket.start()` ne refuse que si `!!this._socket ||
    // !this._disconnected`, et après un destroy précoce `_socket` est `undefined` et
    // `_disconnected` est `true` — les deux passent. Un vrai WebSocket s'ouvre et enregistre
    // côté serveur un peerId dont le `Peer` ne sait plus rien, ses listeners ayant été
    // retirés : le pair est ENREGISTRÉ MAIS SOURD. Mesuré en production — 6 peers simultanés
    // pour 2 navigateurs, dont trois survivants au-delà de 105 s. Un `call()` vers un tel id
    // réussit au niveau signalisation et l'offre part dans le vide : « rien ne se passe »,
    // sans une ligne d'erreur.

    describe('identité du Peer à la construction', () => {
        it('passe un id en 1er argument, et les options en 2nd', async () => {
            const { usePeerTransport, lastPeer } = await loadTransportCopy()
            const ctx = makeCtx('data-app')
            const [api] = mount(usePeerTransport, ctx)

            const init = api.setLocalPeer()

            const peer = await waitForPeerInstance(lastPeer)
            // ⭐ L'assertion qui distingue les deux arités. Avec `new Peer({ host, … })`, le mock
            // (comme le vrai client) laisse `id` porter l'OBJET d'options jusqu'à l'`open` : il
            // ne serait pas une chaîne, et `options` serait le même objet que `id`.
            expect(typeof peer.id).toBe('string')
            expect(peer.id.length).toBeGreaterThan(8)
            expect(peer.options).not.toBe(peer.id)
            expect(peer.options.host).toBeDefined()

            peer._triggerEvent('open', 'peer-alice')
            await init
        })

        it('connaît son id AVANT tout `open` — c\'est là qu\'est le fantôme', async () => {
            const { usePeerTransport, lastPeer } = await loadTransportCopy()
            const ctx = makeCtx('data-app')
            const [api] = mount(usePeerTransport, ctx)

            const init = api.setLocalPeer()

            // Les assertions AVANT tout `'open'`, à dessein : c'est précisément la fenêtre
            // pendant laquelle un Peer sans id fourni s'enregistre au serveur sous un id que
            // personne côté client ne connaît. Le nôtre est connu, donc destructible.
            //
            // ⚠️ `typeof === 'string'` et non `toBeTruthy()` : sous l'ancienne arité, `id`
            // porte l'OBJET d'options — truthy, donc une assertion de vérité serait verte sans
            // rien prouver. Vérifié en réintroduisant `new Peer({ host, … })`.
            const peer = await waitForPeerInstance(lastPeer)
            expect(typeof peer.id).toBe('string')
            expect(peer.open).toBe(false)

            // Puis régler l'init : ce test décrit une fenêtre, il ne doit pas la laisser
            // ouverte derrière lui.
            peer._triggerEvent('open', 'peer-alice')
            await init
        })

        // Celui-ci n'épingle pas l'arité mais le CHOIX de l'id : il resterait vert sous
        // l'ancienne forme, et rougirait si quelqu'un dérivait un id stable (du slug, par ex.).
        it('tire un id NEUF à chaque instance (jamais d\'id stable)', async () => {
            const { usePeerTransport, lastPeer } = await loadTransportCopy()
            vi.useFakeTimers()

            const ctxA = makeCtx('stream-a')
            const [apiA, appA] = mount(usePeerTransport, ctxA)
            const firstId = (await boot(apiA, lastPeer)).id

            // Le peer part, un autre contexte remonte derrière : deuxième construction.
            appA.unmount()
            vi.advanceTimersByTime(PEER_DESTROY_DELAY_MS)

            const ctxB = makeCtx('stream-b')
            const [apiB] = mount(usePeerTransport, ctxB)
            await boot(apiB, lastPeer, 'peer-bob')

            // Un id STABLE (dérivé du slug, par exemple) semblerait plus propre et serait un
            // piège : le serveur PeerJS répondrait `ID-TAKEN` tant que la socket précédente
            // n'est pas fauchée — jusqu'à `alive_timeout`, 60 s. On remplacerait un peer sourd
            // par un peer mort-né.
            expect(lastPeer().id).not.toBe(firstId)
        })
    })

    describe('configuration ICE', () => {
        const ICE = [
            { urls: 'stun:stun.example:19302' },
            { urls: 'turn:turn.example:3478', username: 'u-42', credential: 'c-42' },
        ]

        it('injecte dans `new Peer` les iceServers renvoyés par la route', async () => {
            const { usePeerTransport, lastPeer } = await loadTransportCopy()
            const ctx = makeCtx('data-app')
            ctx.AjaxService.load.mockResolvedValue({ iceServers: ICE })
            const [api] = mount(usePeerTransport, ctx)

            await boot(api, lastPeer)

            expect(ctx.AjaxService.load).toHaveBeenCalledWith(ENDPOINTS.ICE_SERVERS, 'get')
            expect(lastPeer().options.config.iceServers).toEqual(ICE)
        })

        it('crée quand même le Peer, en STUN seul, quand la route échoue', async () => {
            const { usePeerTransport, lastPeer } = await loadTransportCopy()
            const ctx = makeCtx('data-app')
            ctx.AjaxService.load.mockRejectedValue(new Error('500'))
            const [api] = mount(usePeerTransport, ctx)

            const init = api.setLocalPeer()

            const peer = await waitForPeerInstance(lastPeer)
            expect(peer).not.toBeNull()
            expect(peer.options.config.iceServers).toEqual(STUN_ONLY_ICE_SERVERS)

            // Le fait métier, pas seulement l'absence d'exception : la session est réellement
            // utilisable. Sans relais TURN, mais utilisable.
            peer._triggerEvent('open', 'peer-alice')
            await init
            expect(ctx.peerStore.peerPhase).toBe(PEER_PHASES.READY)
        })

        it('n\'instancie aucun Peer si le singleton a été détruit pendant la récupération ICE', async () => {
            // 🔥 Le défaut que l'aller-retour ICE a introduit, et que la garde d'annulation ferme.
            //
            // Pendant le vol, `localPeer` est `null` alors que `peerInitPromise` est posée : si le
            // timer de destruction se déclenche là, `_destroyPeerSingleton` prend sa branche
            // « peer déjà absent » et consomme le timer. Sans garde, le `new Peer` qui suit naît
            // dans un store à 0 consommateur — orphelin, jamais détruit, peerId fantôme côté
            // serveur PeerJS.
            const { usePeerTransport, lastPeer, peerCount } = await loadTransportCopy()
            const ctx = makeCtx('stream-a')

            let releaseIce
            ctx.AjaxService.load.mockReturnValue(
                new Promise((resolve) => { releaseIce = () => resolve({ iceServers: ICE }) }),
            )

            const [api, app] = mount(usePeerTransport, ctx)
            const init = api.setLocalPeer()

            expect(lastPeer()).toBeNull()
            expect(ctx.peerStore.peerInitPromise).not.toBeNull()

            // ⚠️ `useFakeTimers` APRÈS le lancement : le `setTimeout` de `fetchIceServers` a été
            // armé avec les VRAIS timers, donc `advanceTimersByTime` ne peut pas le déclencher et
            // faire sortir la récupération en repli avant la destruction. Sinon ce test ne
            // mesurerait plus rien.
            vi.useFakeTimers()
            app.unmount()
            vi.advanceTimersByTime(PEER_DESTROY_DELAY_MS)

            // `resetPeerState` a nullé la promesse : c'est le signal que lit la garde.
            expect(ctx.peerStore.peerInitPromise).toBeNull()

            releaseIce()
            await init

            expect(peerCount()).toBe(0)
            expect(ctx.peerStore.localPeer).toBeNull()
            expect(ctx.peerStore.peerPhase).toBe(PEER_PHASES.ABSENT)
        })

        it('n\'instancie qu\'un Peer quand une init plus récente supplante celle qui attend l\'ICE', async () => {
            const { usePeerTransport, lastPeer, peerCount } = await loadTransportCopy()
            const ctxA = makeCtx('stream-a')

            let releaseIce
            ctxA.AjaxService.load.mockReturnValue(
                new Promise((resolve) => { releaseIce = () => resolve({ iceServers: ICE }) }),
            )

            const [apiA, appA] = mount(usePeerTransport, ctxA)
            const initA = apiA.setLocalPeer()
            expect(lastPeer()).toBeNull()

            // Le cycle « destruction pendant le vol, puis remontage » : la garde d'entrée voit
            // `peerInitPromise` à `null` et laisse passer une seconde init, qui aboutit d'abord.
            vi.useFakeTimers()
            appA.unmount()
            vi.advanceTimersByTime(PEER_DESTROY_DELAY_MS)
            vi.useRealTimers()

            const ctxB = makeCtx('data-app', ctxA.peerStore)
            const [apiB] = mount(usePeerTransport, ctxB)
            const peerB = await boot(apiB, lastPeer, 'peer-bob')

            expect(peerB).not.toBeNull()

            // L'init périmée se réveille APRÈS : elle ne doit rien construire, et surtout pas
            // écraser le Peer courant dans le store.
            releaseIce()
            await initA

            expect(peerCount()).toBe(1)
            expect(ctxA.peerStore.localPeer).toBe(peerB)
        })
    })
})
