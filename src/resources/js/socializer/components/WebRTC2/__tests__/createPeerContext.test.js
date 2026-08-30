/**
 * createPeerContext.test.js
 *
 * Fabrique du contexte partagé : isolation entre instances, helpers, listeners de
 * connexion, cycle de vie.
 *
 * Choix d'infrastructure : les stores (`peers2`, `me`, `server`) sont des stores Pinia
 * d'options SANS effet de bord à l'instanciation, et setup.js pose une Pinia fraîche
 * avant chaque test — on les utilise donc POUR DE VRAI plutôt que via `vi.mock`. Les
 * tests couvrent ainsi la véritable intégration store ↔ contexte (notamment la
 * sémantique conditionnelle de `removeRemotePeerId`). `useAjaxService()` est seulement
 * instancié par la fabrique, jamais appelé : aucun mock nécessaire non plus.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPeerContext } from '~socializer/components/WebRTC2/Composables/createPeerContext.js'
import { isAuthorizedPeer } from '~socializer/components/WebRTC2/Composables/utils/isAuthorizedPeer.js'
import { usePeer2Store } from '~socializer/stores/peers2.js'
import { useMeStore } from '~estarter/stores/me.js'
import { MAX_PAYLOAD_BYTES } from '~socializer/components/WebRTC2/webrtc2.config.js'
import { withSetup } from './helpers/withSetup.js'
import { mockEventBus } from './helpers/mockEventBus.js'
import { seedReadyPeer } from './helpers/bootLocalPeer.js'
import { createMockDataConnection } from './__mocks__/peerjs.js'

const NO_BUS = Symbol('sans eventBus')

describe('createPeerContext', () => {
    let apps
    let peerStore
    let meStore

    /**
     * Monte un contexte dans un vrai composant Vue (obligatoire : onBeforeMount,
     * onUnmounted et inject). Passer `eventBus: NO_BUS` pour tester le fallback.
     */
    const mountContext = ({ type = 'data', room = 'app', options = {}, eventBus } = {}) => {
        const provides = eventBus === NO_BUS ? {} : { eventBus: eventBus ?? mockEventBus() }
        const [ctx, app] = withSetup(() => createPeerContext({ type, room, options }), { provides })
        apps.push(app)
        return ctx
    }

    beforeEach(() => {
        apps = []
        peerStore = usePeer2Store()
        meStore = useMeStore()
        meStore.user = { slug: 'test-user', name: 'Test User' }
    })

    afterEach(() => {
        apps.forEach((app) => app.unmount())
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    // ── Isolation & initialisation ────────────────────────────────────────────
    describe('isolation et initialisation', () => {
        it('dérive le contextId du type et de la room', () => {
            expect(mountContext({ type: 'visio', room: 'salon' }).contextId).toBe('visio-salon')
        })

        // Deux natures d'isolation, et depuis la migration de la composition dans le store
        // elles ne se démontrent plus de la même façon : `session` est propre à chaque
        // contexte par CONSTRUCTION (un `reactive` par appel), tandis que la composition
        // vit dans un store partagé par tout l'onglet et n'est isolée que par sa CLÉ.
        // C'est donc ici que se vérifie la règle de granularité du store — « X est présent
        // dans ma room » est un fait par contexte, `roomMembers[contextId]`. Corollaire
        // assumé, hérité de `clearSignalQueueRoom` cinq lignes plus haut dans `destroy` :
        // deux contextes vivants qui partageraient le même `type-room` partageraient aussi
        // leur composition.
        it('deux contextes ont des états indépendants', () => {
            const a = mountContext({ type: 'data', room: 'r1' })
            const b = mountContext({ type: 'visio', room: 'r2' })

            a.session.currentCallUsers = [{ userSlug: 'alice', type: 'visio' }]
            peerStore.setRoomMembers(a.contextId, ['alice'])

            expect(b.session.currentCallUsers).toEqual([])
            expect(b.connection.remotePeers).toEqual([])
            expect(a.connection.remotePeers).toEqual(['alice'])
            expect(a.contextId).not.toBe(b.contextId)
        })

        it('propage les options de session et de média', () => {
            const ctx = mountContext({
                type: 'stream',
                room: 'live',
                options: { topology: 'star', hubSlug: 'alice', videoContainer: '#custom' },
            })

            expect(ctx.topology.value).toBe('star')
            expect(ctx.hubSlug.value).toBe('alice')
            expect(ctx.media.videoContainer).toBe('#custom')
            expect(ctx.currentType.value).toBe('stream')
            expect(ctx.currentRoom.value).toBe('live')
        })

        it('retombe sur mesh et #videoContainer sans options', () => {
            const ctx = mountContext()

            expect(ctx.topology.value).toBe('mesh')
            expect(ctx.hubSlug.value).toBeNull()
            expect(ctx.media.videoContainer).toBe('#videoContainer')
        })

        // ── Topologie refusée à la construction ───────────────────────────────
        //
        // Une topologie non implémentée traversait les SEPT sites de décision du
        // module (`useConnectionPool`, `usePeerTransport`, `useBroadcastPresence`)
        // sans prendre une seule branche : aucune connexion ouverte, aucune donnée
        // envoyée, aucune ligne de log. Un intégrateur obtenait une room morte sans
        // un seul indice.
        //
        // La garde LÈVE, elle n'avertit pas : la valeur vient d'une prop
        // d'intégrateur (`MediaBroadcastProvider`, `type: Object` sans
        // `validator`), c'est donc une erreur d'intégration — même nature que les
        // deux seuls autres `throw` du module (`usePeerMedia`, conteneur DOM
        // absent ; `LocalMediaPlayer`, provider parent manquant). Les
        // `console.warn` du module sont réservés aux DONNÉES d'exécution.
        //
        // Les cas passants sont deux tests plus haut : « propage les options de
        // session et de média » (star + hubSlug) et « retombe sur mesh […] sans
        // options ». Ils ne sont pas redoublés ici.
        //
        // Contre-épreuve mesurée (30/08/2026), les DEUX gardes neutralisées
        // SÉPARÉMENT — elles sont indépendantes, les neutraliser ensemble
        // masquerait que l'une porte trois cas et l'autre un seul :
        //   • garde de topologie neutralisée  ⇒ 3 cas rougissent (sfu, inconnue, contextId)
        //   • garde star-sans-hubSlug         ⇒ 1 cas
        // Dans les deux passes, le reste de la suite (1284 cas) reste vert : aucun
        // test ne s'appuyait sur la possibilité de construire un contexte mort.
        //
        // ⚠️ Le dernier cas — « laisse passer une topologie falsy » — est vert des
        // DEUX côtés par construction, et c'est voulu : il n'épingle pas la garde,
        // il épingle l'ORDRE entre le repli et la garde. Sa contre-épreuve à lui
        // est d'inverser les deux lignes dans la fabrique, pas de les neutraliser.
        describe('topologie refusée à la construction', () => {
            it("refuse 'sfu' en la nommant RÉSERVÉE, pas inconnue", () => {
                expect(() => mountContext({ options: { topology: 'sfu' } }))
                    .toThrow(/topologie 'sfu' réservée, non implémentée/)
            })

            it('refuse une topologie inconnue en listant les valeurs acceptées', () => {
                expect(() => mountContext({ options: { topology: 'p2p' } }))
                    .toThrow(/topologie 'p2p' inconnue.*mesh, star/)
            })

            // Le message nomme le contexte : un intégrateur qui monte plusieurs
            // providers doit savoir LEQUEL a refusé.
            it('nomme le contextId dans le message', () => {
                expect(() => mountContext({ type: 'stream', room: 'live', options: { topology: 'sfu' } }))
                    .toThrow(/createPeerContext\(stream-live\)/)
            })

            // Même contexte mort, autre porte : les prédicats de
            // `_doSyncUsersConnections` et de `sendData` sont COMPOSÉS (`star` ET
            // `hubSlug`). Un star sans hub les traverse tous les deux sans rien
            // ouvrir ni rien envoyer.
            it("refuse 'star' sans hubSlug, qui produit le même contexte mort", () => {
                expect(() => mountContext({ options: { topology: 'star' } }))
                    .toThrow(/topologie 'star' sans 'hubSlug'/)
            })

            // ⚠️ Pin d'ORDRE, pas de valeur : le repli falsy `|| 'mesh'` doit être
            // évalué AVANT la garde. Inversé, il ferait lever un appel parfaitement
            // légitime — celui que l'arbitrage de l'en-tête du fichier de production
            // a justement voulu rendre possible (`options = {}` par défaut).
            it('laisse passer une topologie falsy, que le repli ramène à mesh', () => {
                expect(mountContext({ options: { topology: '' } }).topology.value).toBe('mesh')
                expect(mountContext({ options: { topology: null } }).topology.value).toBe('mesh')
            })
        })

        it('crée la file de signaux de la room au montage', () => {
            const ctx = mountContext({ type: 'data', room: 'app' })

            expect(peerStore.getQueueForRoom(ctx.contextId)).toEqual([])
        })

        it('lastRoomSignal expose le dernier signal dispatché pour ce contexte', () => {
            const ctx = mountContext({ type: 'data', room: 'app' })

            peerStore.dispatchSignal({ roomId: ctx.contextId, type: 'PEER_CONNECTION_REQUEST' })
            peerStore.dispatchSignal({ roomId: ctx.contextId, type: 'CALL_INVITE' })
            peerStore.dispatchSignal({ roomId: 'autre-contexte', type: 'BRUIT' })

            expect(ctx.lastRoomSignal.value.type).toBe('CALL_INVITE')
        })
    })

    // ── waitForMeReady ────────────────────────────────────────────────────────
    describe('waitForMeReady', () => {
        it('résout immédiatement quand slug et peerId local sont disponibles', async () => {
            seedReadyPeer(peerStore, 'peer-local')
            const ctx = mountContext()

            await expect(ctx.waitForMeReady()).resolves.toBe(true)
        })

        it('attend que le peerId local arrive', async () => {
            const ctx = mountContext()
            let settled = false
            const pending = ctx.waitForMeReady().then((v) => { settled = true; return v })

            await nextTick()
            expect(settled).toBe(false)

            seedReadyPeer(peerStore, 'peer-local')

            await expect(pending).resolves.toBe(true)
        })

        it('positionne isHub quand mon slug est celui du hub', async () => {
            seedReadyPeer(peerStore, 'peer-local')
            const ctx = mountContext({ options: { topology: 'star', hubSlug: 'test-user' } })

            await ctx.waitForMeReady()

            expect(ctx.isHub.value).toBe(true)
        })

        it('résout false à l\'expiration du délai', async () => {
            vi.useFakeTimers()
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
            const ctx = mountContext({ options: { meReadyTimeoutMs: 50 } })

            const pending = ctx.waitForMeReady()
            await vi.advanceTimersByTimeAsync(50)

            await expect(pending).resolves.toBe(false)
            expect(warn).toHaveBeenCalledWith('waitForMeReady a expiré après', 50, 'ms')
        })

        it('n\'émet aucun faux « a expiré » quand l\'identité était déjà prête (non-régression)', async () => {
            vi.useFakeTimers()
            seedReadyPeer(peerStore, 'peer-local')
            const ctx = mountContext()
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

            await expect(ctx.waitForMeReady()).resolves.toBe(true)
            // Le timer de secours doit avoir été annulé : il était armé AVANT scope.run().
            await vi.advanceTimersByTimeAsync(30_000)

            expect(warn).not.toHaveBeenCalled()
        })

        // ── L'identité COURANTE, jamais l'historique ──────────────────────────
        //
        // La barrière ne consultait que `lastLocalPeerId`, un fait HISTORIQUE que rien ne
        // retire tant que le Peer n'est pas détruit — `_destroyPeerSingleton` seul le
        // nulle, et le `.catch` d'init le laisse SCIEMMENT posé. Elle répondait donc
        // « prêt » sur un peer qui ne l'est plus, et tout ce qui reprend derrière elle
        // publiait ou attendait un peerId que le serveur PeerJS ne connaît plus : en face,
        // « Could not connect to peer <uuid> », et l'arrivant ne voit rien. C'est la panne
        // la plus silencieuse du module, et `peerStateViolations` la nomme déjà
        // (`id-historique-sur-peer-inutilisable`).
        //
        // Les trois cas ci-dessous couvrent les trois façons dont un peer cesse d'être
        // utilisable sans que l'id historique bouge. Aucun n'attend `false` par principe :
        // ce qu'ils exigent, c'est que la barrière ne dise pas OUI — le `false` vient du
        // timeout, qui est le filet.

        it('ne répond pas prêt sur un peer détruit', async () => {
            vi.useFakeTimers()
            vi.spyOn(console, 'warn').mockImplementation(() => {})
            // Rien ne remet `localPeerReady` à false quand le Peer est détruit ailleurs que
            // par `_destroyPeerSingleton` : la contradiction est celle que l'audit appelle
            // `pret-mais-detruit`.
            const peer = seedReadyPeer(peerStore, 'peer-local')
            peer.destroyed = true

            const ctx = mountContext({ options: { meReadyTimeoutMs: 50 } })
            const pending = ctx.waitForMeReady()
            await vi.advanceTimersByTimeAsync(50)

            await expect(pending).resolves.toBe(false)
        })

        it('ne répond pas prêt sur un peer déconnecté sans reconnexion en vol', async () => {
            vi.useFakeTimers()
            vi.spyOn(console, 'warn').mockImplementation(() => {})
            // Plafond de tentatives atteint : plus aucun backoff armé, donc plus aucun
            // recours. Semé comme le handler `'disconnected'` le laisse — phase
            // `disconnected`, aucun timer — alors que `lastLocalPeerId` reste posé : c'est
            // la seule chose qui subsiste, et c'est la seule que la barrière consultait.
            const peer = seedReadyPeer(peerStore, 'peer-local')
            peer.disconnected = true
            peerStore.markPeerDisconnected()
            peerStore.peerReconnectTimer = null

            const ctx = mountContext({ options: { meReadyTimeoutMs: 50 } })
            const pending = ctx.waitForMeReady()
            await vi.advanceTimersByTimeAsync(50)

            await expect(pending).resolves.toBe(false)
        })

        it('attend la fin d\'un backoff de reconnexion, puis répond prêt', async () => {
            // Une coupure transitoire n'est pas un état terminal : un backoff en vol veut
            // dire qu'une reconnexion est attendue, et l'id historique est exactement ce
            // dont `reconnect()` repart. La barrière n'y répond pas non plus — mais elle
            // ATTEND, et le fait de ne pas abandonner est la moitié qui compte.
            const peer = seedReadyPeer(peerStore, 'peer-local')
            peer.disconnected = true
            peerStore.markPeerDisconnected()
            peerStore.peerReconnectTimer = setTimeout(() => {}, 10_000)

            const ctx = mountContext()
            let settled = false
            const pending = ctx.waitForMeReady().then((v) => { settled = true; return v })

            await nextTick()
            expect(settled).toBe(false)

            // La reconnexion aboutit : le handler `'open'` repasse le peer à prêt.
            clearTimeout(peerStore.peerReconnectTimer)
            peerStore.peerReconnectTimer = null
            peer.disconnected = false
            peerStore.markPeerOpen('peer-local')

            await expect(pending).resolves.toBe(true)
        })
    })

    // ── eventBus ──────────────────────────────────────────────────────────────
    describe('eventBus', () => {
        it('expose le bus injecté', () => {
            const bus = mockEventBus()
            expect(mountContext({ eventBus: bus }).eventBus).toBe(bus)
        })

        it('retombe sur des no-op sans bus valide, sans jamais crasher', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
            const ctx = mountContext({ eventBus: NO_BUS })

            expect(warn).toHaveBeenCalledWith(expect.stringContaining('eventBus non fourni ou invalide'))
            expect(() => {
                ctx.eventBus.$emit('close-call', {})
                ctx.eventBus.$on('close-call', () => {})
                ctx.eventBus.$off('close-call', () => {})
            }).not.toThrow()
        })

        it('rejette un bus incomplet (interface partielle)', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
            const partial = { $emit: vi.fn() }

            const ctx = mountContext({ eventBus: partial })

            expect(warn).toHaveBeenCalled()
            expect(ctx.eventBus).not.toBe(partial)
        })
    })

    // ── setUpConnectionListeners ──────────────────────────────────────────────
    describe('setUpConnectionListeners', () => {
        const connFor = (metadata) => createMockDataConnection(metadata)

        it('renvoie un no-op pour une connexion invalide', () => {
            const ctx = mountContext()

            expect(() => ctx.setUpConnectionListeners(null)()).not.toThrow()
            expect(() => ctx.setUpConnectionListeners({})()).not.toThrow()
        })

        it('branche les événements de base', () => {
            const ctx = mountContext()
            const conn = connFor()

            ctx.setUpConnectionListeners(conn)

            expect(conn.on).toHaveBeenCalledWith('open', expect.any(Function))
            expect(conn.on).toHaveBeenCalledWith('close', expect.any(Function))
        })

        it('ne rebranche pas deux fois la même connexion (WeakSet)', () => {
            const ctx = mountContext()
            const conn = connFor()

            ctx.setUpConnectionListeners(conn)
            const callsAfterFirst = conn.on.mock.calls.length
            ctx.setUpConnectionListeners(conn)

            expect(conn.on.mock.calls.length).toBe(callsAfterFirst)
        })

        it('le cleanup retourné désinscrit les handlers et autorise un rebranchement', () => {
            const ctx = mountContext()
            const conn = connFor()

            const cleanup = ctx.setUpConnectionListeners(conn)
            cleanup()

            expect(conn.off).toHaveBeenCalledWith('open', expect.any(Function))
            expect(conn.off).toHaveBeenCalledWith('close', expect.any(Function))

            conn.on.mockClear()
            ctx.setUpConnectionListeners(conn)
            expect(conn.on).toHaveBeenCalled()
        })

        it('ne branche que les callbacks métier actifs', () => {
            const ctx = mountContext()
            ctx.storeConnectionEventCallbacks({ onDataReceived: vi.fn() })
            const conn = connFor()

            ctx.setUpConnectionListeners(conn)

            const events = conn.on.mock.calls.map(([event]) => event)
            expect(events).toContain('data')
            expect(events).not.toContain('stream')
            expect(events).not.toContain('error')
        })

        describe('réception de données', () => {
            it('transmet le payload, la connexion et ses métadonnées', () => {
                const ctx = mountContext()
                const onDataReceived = vi.fn()
                ctx.storeConnectionEventCallbacks({ onDataReceived })
                const conn = connFor({ type: 'data', room: 'app', from: 'alice' })
                ctx.setUpConnectionListeners(conn)

                conn._triggerEvent('data', { hello: 'world' })

                expect(onDataReceived).toHaveBeenCalledWith({ hello: 'world' }, conn, conn.metadata)
            })

            it('abandonne silencieusement un payload au-dessus de MAX_PAYLOAD_BYTES', () => {
                vi.spyOn(console, 'warn').mockImplementation(() => {})
                const ctx = mountContext()
                const onDataReceived = vi.fn()
                ctx.storeConnectionEventCallbacks({ onDataReceived })
                const conn = connFor()
                ctx.setUpConnectionListeners(conn)

                conn._triggerEvent('data', 'x'.repeat(MAX_PAYLOAD_BYTES + 1))

                expect(onDataReceived).not.toHaveBeenCalled()
            })
        })

        it('remonte les flux entrants au callback métier', () => {
            const ctx = mountContext()
            const onStreamReceived = vi.fn()
            ctx.storeConnectionEventCallbacks({ onStreamReceived })
            const conn = connFor({ type: 'visio' })
            ctx.setUpConnectionListeners(conn)

            const stream = new MediaStream()
            conn._triggerEvent('stream', stream)

            expect(onStreamReceived).toHaveBeenCalledWith(stream, conn, conn.metadata)
        })

        it('n\'émet le close métier qu\'une seule fois', () => {
            const ctx = mountContext()
            const onConnectionClose = vi.fn()
            ctx.storeConnectionEventCallbacks({ onConnectionClose })
            const conn = connFor({ type: 'data', room: 'app', slug: 'alice', from: 'alice' })
            ctx.setUpConnectionListeners(conn)

            conn._triggerEvent('close')
            conn._triggerEvent('close')

            expect(onConnectionClose).toHaveBeenCalledTimes(1)
        })

        describe('fermeture de connexion', () => {
            const closeWith = (ctx, metadata) => {
                const conn = connFor(metadata)
                ctx.setUpConnectionListeners(conn)
                conn._triggerEvent('close')
                return conn
            }

            it('retire l\'instance du store', () => {
                const ctx = mountContext()
                const spy = vi.spyOn(peerStore, 'removePeerConnectionInstance')

                const conn = closeWith(ctx, { type: 'data', room: 'app', slug: 'alice', from: 'alice' })

                expect(spy).toHaveBeenCalledWith('app', 'alice', 'data', conn)
            })

            it('oublie le peerId d\'un pair qui a quitté la room', () => {
                const ctx = mountContext()
                peerStore.addRemotePeerId('alice', 'p-alice')

                closeWith(ctx, { type: 'data', room: 'app', slug: 'alice', from: 'alice' })

                expect(peerStore.hasRemotePeerId('alice')).toBe(false)
            })

            it('conserve le peerId d\'un pair toujours en room', () => {
                const ctx = mountContext()
                peerStore.addRemotePeerId('alice', 'p-alice')
                // La présence se déclare dans le STORE, et il n'y a plus d'autre endroit où
                // la déclarer : `ctx.connection.remotePeers` n'est qu'un accesseur au-dessus
                // de cette entrée. Ce cas posait les deux, du temps où il y en avait deux.
                peerStore.setRoomMembers(ctx.contextId, ['alice'])

                closeWith(ctx, { type: 'data', room: 'app', slug: 'alice', from: 'alice' })

                expect(peerStore.hasRemotePeerId('alice')).toBe(true)
            })

            it('conserve le peerId d\'un pair encore présent dans UN AUTRE contexte', () => {
                // Le cas de production : Notifications.vue monte `data-app` en permanence
                // et Home.vue trois providers. Ma connexion se ferme, mais le pair est
                // toujours dans la room du voisin — son peerId lui reste nécessaire.
                const ctx = mountContext()
                peerStore.addRemotePeerId('alice', 'p-alice')
                peerStore.setRoomMembers('stream-room-test', ['alice'])

                closeWith(ctx, { type: 'data', room: 'app', slug: 'alice', from: 'alice' })

                expect(peerStore.hasRemotePeerId('alice')).toBe(true)
            })

            it('ne confond jamais mon propre slug avec le pair distant', () => {
                const ctx = mountContext()
                peerStore.addRemotePeerId('test-user', 'p-me')

                // `from` porte mon slug (connexion sortante) : le pair distant est `slug`.
                closeWith(ctx, { type: 'data', room: 'app', slug: 'alice', from: 'test-user' })

                expect(peerStore.hasRemotePeerId('test-user')).toBe(true)
            })

            it('neutralise un type forgé par le pair distant', () => {
                const ctx = mountContext()
                const spy = vi.spyOn(peerStore, 'removePeerConnectionInstance')

                closeWith(ctx, { type: '__proto__', room: 'app', slug: 'alice', from: 'alice' })

                expect(spy).toHaveBeenCalledWith('app', 'alice', null, expect.anything())
            })

            it('ne traite le cleanup qu\'une fois même sur close répété', () => {
                const ctx = mountContext()
                const spy = vi.spyOn(peerStore, 'removePeerConnectionInstance')
                const conn = connFor({ type: 'data', room: 'app', slug: 'alice', from: 'alice' })
                ctx.setUpConnectionListeners(conn)

                conn._triggerEvent('close')
                conn._triggerEvent('close')

                expect(spy).toHaveBeenCalledTimes(1)
            })

            // ── Publication de la perte ───────────────────────────────────────
            //
            // `handleClose` est le seul point d'entrée d'une fermeture, tous types et
            // les DEUX sens confondus — la séquence de départ, elle, ne voit jamais une
            // fermeture sortante. C'est donc ici que la perte se publie, à charge pour
            // useConnectionPool de décider s'il y a lieu de re-composer.
            it('publie le slug du pair dont la connexion vient de tomber', () => {
                const ctx = mountContext()

                closeWith(ctx, { type: 'data', room: 'app', slug: 'alice', from: 'alice' })

                expect(ctx.connectionLostSignal.value).toBe('alice')
            })

            it('publie aussi la perte d\'une connexion SORTANTE', () => {
                // Le cas qui motive tout le mécanisme : quand un pair recharge, ce qui
                // tombe chez le diffuseur est sa connexion sortante — `metadata.from`
                // porte MON slug. Aucun chemin ne l'observait.
                const ctx = mountContext()

                closeWith(ctx, { type: 'stream', room: 'app', slug: 'alice', from: 'test-user' })

                expect(ctx.connectionLostSignal.value).toBe('alice')
            })

            it('ne publie jamais mon propre slug', () => {
                const ctx = mountContext()

                // Ni `from` ni `slug` ne désignent un distant : rien à recomposer.
                closeWith(ctx, { type: 'data', room: 'app', slug: 'test-user', from: 'test-user' })

                expect(ctx.connectionLostSignal.value).toBe(null)
            })

            it('ne publie rien pendant un teardown', () => {
                // ⚠️ Le garde est lu ICI, de façon synchrone, et pas chez le lecteur :
                // `stopCallWithPeers` pose `beginShutdown()`, ferme les connexions, puis
                // relâche dans un `finally` ASYNCHRONE. Une microtâche plus tard le
                // drapeau peut être retombé, et un raccroché volontaire serait recomposé.
                const ctx = mountContext()
                ctx.beginShutdown()

                closeWith(ctx, { type: 'data', room: 'app', slug: 'alice', from: 'alice' })

                expect(ctx.connectionLostSignal.value).toBe(null)
            })
        })
    })

    // ── storeConnectionEventCallbacks ─────────────────────────────────────────
    describe('storeConnectionEventCallbacks', () => {
        it('active le callback fourni', () => {
            const ctx = mountContext()
            const onDataReceived = vi.fn()

            ctx.storeConnectionEventCallbacks({ onDataReceived })

            expect(ctx.connectionEvents.onDataReceived.isActive).toBe(true)
            expect(ctx.connectionEvents.onDataReceived.callback).toBe(onDataReceived)
        })

        it('n\'écrase pas un callback déjà actif', () => {
            const ctx = mountContext()
            const first = vi.fn()
            const second = vi.fn()

            ctx.storeConnectionEventCallbacks({ onDataReceived: first })
            ctx.storeConnectionEventCallbacks({ onDataReceived: second })

            expect(ctx.connectionEvents.onDataReceived.callback).toBe(first)
        })

        it('ignore les clés inconnues, les non-fonctions et les entrées vides', () => {
            const ctx = mountContext()

            expect(() => {
                ctx.storeConnectionEventCallbacks({ nImporteQuoi: vi.fn(), onDataReceived: 'pas une fonction' })
                ctx.storeConnectionEventCallbacks(null)
                ctx.storeConnectionEventCallbacks('bruit')
            }).not.toThrow()

            expect(ctx.connectionEvents.onDataReceived.isActive).toBe(false)
            expect(ctx.connectionEvents.nImporteQuoi).toBeUndefined()
        })
    })

    // ── Garde de teardown ─────────────────────────────────────────────────────
    describe('beginShutdown / endShutdown', () => {
        it('est ré-entrant : le garde ne retombe qu\'au dernier arrêt', () => {
            const ctx = mountContext()

            ctx.beginShutdown()
            ctx.beginShutdown()
            expect(ctx.isShuttingDown.value).toBe(true)

            ctx.endShutdown()
            expect(ctx.isShuttingDown.value).toBe(true)

            ctx.endShutdown()
            expect(ctx.isShuttingDown.value).toBe(false)
        })

        it('un endShutdown orphelin ne rend pas le compteur négatif', () => {
            const ctx = mountContext()

            ctx.endShutdown()
            ctx.endShutdown()
            expect(ctx.lifecycle.shutdownCount).toBe(0)

            ctx.beginShutdown()
            expect(ctx.isShuttingDown.value).toBe(true)
        })
    })

    // ── currentCallUsers ──────────────────────────────────────────────────────
    describe('helpers currentCallUsers', () => {
        it('ajoute sans doublon sur le couple slug + type', () => {
            const ctx = mountContext()

            ctx.addCurrentCallUser('alice', 'visio')
            ctx.addCurrentCallUser('alice', 'visio')
            ctx.addCurrentCallUser('alice', 'screen')

            expect(ctx.currentCallUsers.value).toEqual([
                { userSlug: 'alice', type: 'visio' },
                { userSlug: 'alice', type: 'screen' },
            ])
        })

        it('ignore un slug vide', () => {
            const ctx = mountContext()

            ctx.addCurrentCallUser(null)

            expect(ctx.currentCallUsers.value).toEqual([])
        })

        it('retire toutes les entrées d\'un slug, quel que soit le type', () => {
            const ctx = mountContext()
            ctx.addCurrentCallUser('alice', 'visio')
            ctx.addCurrentCallUser('alice', 'screen')
            ctx.addCurrentCallUser('bob', 'visio')

            ctx.removeCurrentCallUser('alice')

            expect(ctx.currentCallUsers.value).toEqual([{ userSlug: 'bob', type: 'visio' }])
        })

        it('setCurrentCallUsers normalise une valeur non-tableau', () => {
            const ctx = mountContext()

            ctx.setCurrentCallUsers('pas un tableau')

            expect(ctx.currentCallUsers.value).toEqual([])
        })

        it('clearCurrentCallUsers vide la liste', () => {
            const ctx = mountContext()
            ctx.addCurrentCallUser('alice')

            ctx.clearCurrentCallUsers()

            expect(ctx.currentCallUsers.value).toEqual([])
        })
    })

    // ── authorizedCallPeers ───────────────────────────────────────────────────
    describe('registre des pairs d\'appel autorisés', () => {
        it('marque puis reconnaît un pair', () => {
            const ctx = mountContext()

            expect(ctx.isAuthorizedCallPeer('alice')).toBe(false)
            expect(ctx.markAuthorizedCallPeer('alice')).toBe(true)
            expect(ctx.isAuthorizedCallPeer('alice')).toBe(true)
        })

        it('refuse un slug au format invalide', () => {
            const ctx = mountContext()

            expect(ctx.markAuthorizedCallPeer('pas un slug !')).toBe(false)
            expect(ctx.markAuthorizedCallPeer(null)).toBe(false)
            expect(ctx.markAuthorizedCallPeer({ slug: 'alice' })).toBe(false)
            expect(ctx.session.authorizedCallPeers.size).toBe(0)
        })

        it('refuse de m\'autoriser moi-même', () => {
            // Une auto-autorisation n'a aucun sens (la garde anti-self de connectToPeer
            // couvre déjà ce cas) et ferait du registre une porte ouverte si un payload
            // réseau réussissait à renvoyer mon propre slug.
            const ctx = mountContext()

            expect(ctx.markAuthorizedCallPeer('test-user')).toBe(false)
            expect(ctx.isAuthorizedCallPeer('test-user')).toBe(false)
        })

        it('purge un pair sans toucher aux autres', () => {
            const ctx = mountContext()
            ctx.markAuthorizedCallPeer('alice')
            ctx.markAuthorizedCallPeer('bob')

            expect(ctx.clearAuthorizedCallPeer('alice')).toBe(true)

            expect(ctx.isAuthorizedCallPeer('alice')).toBe(false)
            expect(ctx.isAuthorizedCallPeer('bob')).toBe(true)
        })

        it('purge tout le registre d\'un coup', () => {
            const ctx = mountContext()
            ctx.markAuthorizedCallPeer('alice')
            ctx.markAuthorizedCallPeer('bob')

            ctx.clearAllAuthorizedCallPeers()

            expect(ctx.session.authorizedCallPeers.size).toBe(0)
        })

        it('est vidé par destroy()', () => {
            // Le `data-app` mis à part, un contexte détruit ne doit laisser derrière lui
            // aucune autorisation exploitable par le garde sortant.
            const ctx = mountContext()
            ctx.markAuthorizedCallPeer('alice')

            ctx.destroy()

            expect(ctx.isAuthorizedCallPeer('alice')).toBe(false)
        })
    })

    // ── Projections calculées ─────────────────────────────────────────────────
    describe('projections calculées', () => {
        it('isHubConnected suit la présence du hub dans la room', () => {
            const ctx = mountContext({ options: { topology: 'star', hubSlug: 'alice' } })

            expect(ctx.isHubConnected.value).toBe(false)
            peerStore.setRoomMembers(ctx.contextId, ['alice'])
            expect(ctx.isHubConnected.value).toBe(true)
        })

        // La seconde moitié du prédicat : `remotePeers` ne me contient JAMAIS, donc un hub
        // qui est moi passerait pour absent si l'appartenance était la seule question posée.
        // Contre-épreuve : neutraliser le terme `hubSlug === mySlug` dans createPeerContext
        // fait rougir ce cas, et lui seul.
        it("isHubConnected rend true quand le hub, c'est moi", () => {
            const ctx = mountContext({ options: { topology: 'star', hubSlug: 'test-user' } })

            expect(ctx.remotePeers.value).not.toContain('test-user')
            expect(ctx.isHubConnected.value).toBe(true)
        })

        it('sépare les flux distants des partages d\'écran', () => {
            const ctx = mountContext()

            ctx.media.remoteStreamsMap.set('alice-visio', { remoteSlug: 'alice', remoteType: 'visio' })
            ctx.media.remoteStreamsMap.set('alice-screen', { remoteSlug: 'alice', remoteType: 'screen' })

            expect(ctx.remoteStreams.value).toHaveLength(1)
            expect(ctx.remoteStreams.value[0].remoteType).toBe('visio')
            expect(ctx.remoteScreens.value).toHaveLength(1)
            expect(ctx.remoteScreens.value[0].remoteType).toBe('screen')
        })
    })

    // ── destroy / lifecycle ───────────────────────────────────────────────────
    describe('destroy', () => {
        const dirty = (ctx) => {
            ctx.media.remoteStreamsMap.set('alice-visio', { remoteSlug: 'alice' })
            ctx.media.currentStream = { id: 'stream' }
            ctx.media.isStreaming = true
            ctx.media.isCapturing = true
            peerStore.setRoomMembers(ctx.contextId, ['alice'])
            ctx.addCurrentCallUser('alice', 'visio')
            ctx.callMachine.transition('calling')
        }

        it('remet tout l\'état partagé à zéro', () => {
            const ctx = mountContext()
            dirty(ctx)

            ctx.destroy()

            expect(ctx.media.remoteStreamsMap.size).toBe(0)
            expect(ctx.media.currentStream).toBeNull()
            expect(ctx.media.isStreaming).toBe(false)
            expect(ctx.media.isCapturing).toBe(false)
            expect(ctx.connection.remotePeers).toEqual([])
            // Et l'entrée DISPARAÎT de l'index partagé — elle ne devient pas « room vide ».
            // C'est ce que lit `isUserInAnyRoom`, qui balaie tous les contextes de l'onglet :
            // un contexte démonté qui témoignerait encore d'une room vide serait inoffensif,
            // mais un qui témoignerait d'une room peuplée empêcherait à jamais d'oublier le
            // peerId de ses membres.
            expect(ctx.contextId in peerStore.roomMembers).toBe(false)
            expect(ctx.currentCallUsers.value).toEqual([])
            expect(ctx.callStatus.value).toBe('idle')
        })

        it('supprime la file de signaux du contexte', () => {
            const ctx = mountContext({ type: 'data', room: 'app' })
            expect(peerStore.getQueueForRoom(ctx.contextId)).toEqual([])

            ctx.destroy()

            expect(peerStore.getQueueForRoom(ctx.contextId)).toBeNull()
        })

        // ⭐ Les attentes en vol meurent avec le contexte.
        //
        // `waitForMeReady` et `waitForPresenceSync` sont des `effectScope` DÉTACHÉS, avec
        // chacun son alarme (15 s / 5 s). Rien ne les annulait : un contexte détruit laissait
        // donc ses attentes pendantes, et QUATRE consommateurs de production reprennent
        // derrière elles — `useConnectionPool`, `usePeerConnections`, et les deux de
        // `useStreamManager`. Ces derniers ne sont pas inertes : `handleStreamReceived`
        // repeuple `remoteStreamsMap` que `destroy()` vient de vider, et peut créer un player
        // DOM pour un contexte mort ; `handleStreamRemoved` appelle `handleRemoteDeparture`,
        // qui avale ses exceptions.
        //
        // Résoudre `false` fait sortir les quatre par leur `if (!ready) return` DÉJÀ écrit et
        // déjà testé : on ne leur ajoute aucun chemin, on éteint la source.
        //
        // ⚠️ Sans le correctif, ce cas ne rougit pas sur une assertion mais sur le
        // `testTimeout` (10 s) : la promesse reste pendante jusqu'à sa propre alarme. C'est
        // volontaire — un `race` contre une sentinelle testerait la sentinelle.
        it('résout les attentes en vol à false, au lieu de les laisser pendantes', async () => {
            const ctx = mountContext()
            const meReady = ctx.waitForMeReady()
            const presenceSync = ctx.waitForPresenceSync()

            ctx.destroy()

            await expect(meReady).resolves.toBe(false)
            await expect(presenceSync).resolves.toBe(false)
        })

        it('n\'annule pas une attente déjà résolue', async () => {
            seedReadyPeer(peerStore, 'peer-local')
            const ctx = mountContext()

            await expect(ctx.waitForMeReady()).resolves.toBe(true)

            // Le garde `resolved` du contexte doit tenir : détruire après coup ne
            // « re-résout » rien et ne lève pas.
            expect(() => ctx.destroy()).not.toThrow()
        })

        it('conserve volontairement le garde de teardown actif', () => {
            const ctx = mountContext()
            ctx.beginShutdown()

            ctx.destroy()

            // Le garde doit survivre au teardown pour bloquer tout retry résiduel.
            expect(ctx.isShuttingDown.value).toBe(true)
        })

        it('est déclenché au démontage du composant propriétaire', () => {
            const ctx = mountContext()
            dirty(ctx)

            apps.pop().unmount()

            expect(ctx.media.remoteStreamsMap.size).toBe(0)
            expect(ctx.connection.remotePeers).toEqual([])
        })

        // ⭐ Le jumeau manquant du garde de `unregisterContext`.
        //
        // Le contextId est `type-room` et le registre est last-write-wins VOLONTAIRE
        // (securite.md § contextRegistry) : deux contextes homonymes se chevauchent à
        // chaque remontage — `v-if`, transition de route, provider recréé. `unregisterContext`
        // a reçu un garde d'identité pour cette raison ; `clearRoomMembers`, appelé vingt
        // lignes plus loin dans le même teardown, n'en avait pas.
        //
        // La panne est fail-CLOSED et muette : le survivant garde `presenceSynced`
        // (monotone, seul `destroy()` le rabaisse) et va donc droit au verdict avec une
        // allowlist vide — toute connexion entrante du chemin présence est refusée, sans
        // erreur console, et un refus n'est pas rattrapable (securite.md § « Une liste vide
        // n'est pas une réponse »).
        //
        // ⚠️ CONTRÔLE DE HARNAIS À DEUX VERSANTS, mesuré dans les deux sens.
        // `helpers/createMockContext.js` réimplémente `clearRoomMembers`, garde compris.
        // Neutraliser le verbe du STORE fait rougir ce cas et celui de
        // `peers2Store.roomMembers.test.js`, et laisse vert celui du double ; neutraliser
        // celui du DOUBLE fait rougir le seul cas de `roomMembersSourceOfTruth.test.js`,
        // et laisse ces deux-ci verts. Prouver la propriété exige donc les deux — c'est la
        // règle du bail (docs/.../tests.md § « un bail a deux versants »).
        it('ne laisse pas un contexte mourant effacer la composition de son homonyme vivant', () => {
            const mourant = mountContext({ type: 'stream', room: 'salon' })
            const vivant = mountContext({ type: 'stream', room: 'salon' })
            expect(vivant.contextId).toBe(mourant.contextId)

            // L'ordre de production : chacun s'inscrit à son `setLocalPeer`, le dernier gagne.
            peerStore.registerContext(mourant)
            peerStore.registerContext(vivant)

            // C'est le VIVANT qui a écrit la composition — son tour de présence est le dernier.
            peerStore.computeRoomDiff(vivant.contextId, ['alice'])

            apps.shift().unmount()   // le mourant se démonte APRÈS

            expect(peerStore.getRoomMembers(vivant.contextId)).toEqual(['alice'])
            // Le fait métier : l'allowlist du chemin (a) survit, donc le survivant admet
            // toujours ses membres. Les deux gardes lisent la même entrée — celui-ci est
            // simplement le seul importable ici.
            expect(isAuthorizedPeer('alice', vivant)).toBe(true)
        })
    })
})
