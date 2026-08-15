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
import { usePeer2Store } from '~socializer/stores/peers2.js'
import { useMeStore } from '~estarter/stores/me.js'
import { MAX_PAYLOAD_BYTES } from '~socializer/components/WebRTC2/webrtc2.config.js'
import { withSetup } from './helpers/withSetup.js'
import { mockEventBus } from './helpers/mockEventBus.js'
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

        it('deux contextes ont des états indépendants', () => {
            const a = mountContext({ type: 'data', room: 'r1' })
            const b = mountContext({ type: 'visio', room: 'r2' })

            a.session.currentCallUsers = [{ userSlug: 'alice', type: 'visio' }]
            a.connection.usersInRoom = ['alice']

            expect(b.session.currentCallUsers).toEqual([])
            expect(b.connection.usersInRoom).toEqual([])
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
            peerStore.lastLocalPeerId = 'peer-local'
            const ctx = mountContext()

            await expect(ctx.waitForMeReady()).resolves.toBe(true)
        })

        it('attend que le peerId local arrive', async () => {
            const ctx = mountContext()
            let settled = false
            const pending = ctx.waitForMeReady().then((v) => { settled = true; return v })

            await nextTick()
            expect(settled).toBe(false)

            peerStore.lastLocalPeerId = 'peer-local'

            await expect(pending).resolves.toBe(true)
        })

        it('positionne isHub quand mon slug est celui du hub', async () => {
            peerStore.lastLocalPeerId = 'peer-local'
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
            peerStore.lastLocalPeerId = 'peer-local'
            const ctx = mountContext()
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

            await expect(ctx.waitForMeReady()).resolves.toBe(true)
            // Le timer de secours doit avoir été annulé : il était armé AVANT scope.run().
            await vi.advanceTimersByTimeAsync(30_000)

            expect(warn).not.toHaveBeenCalled()
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
                ctx.connection.usersInRoom = ['alice']

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
        it('allUsersInRoom ajoute mon slug sans le dupliquer', () => {
            const ctx = mountContext()

            ctx.connection.usersInRoom = ['alice']
            expect(ctx.allUsersInRoom.value).toEqual(['alice', 'test-user'])

            ctx.connection.usersInRoom = ['alice', 'test-user']
            expect(ctx.allUsersInRoom.value).toEqual(['alice', 'test-user'])
        })

        it('isHubConnected suit la présence du hub dans la room', () => {
            const ctx = mountContext({ options: { topology: 'star', hubSlug: 'alice' } })

            expect(ctx.isHubConnected.value).toBe(false)
            ctx.connection.usersInRoom = ['alice']
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
            ctx.connection.usersInRoom = ['alice']
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
            expect(ctx.connection.usersInRoom).toEqual([])
            expect(ctx.currentCallUsers.value).toEqual([])
            expect(ctx.callStatus.value).toBe('idle')
        })

        it('supprime la file de signaux du contexte', () => {
            const ctx = mountContext({ type: 'data', room: 'app' })
            expect(peerStore.getQueueForRoom(ctx.contextId)).toEqual([])

            ctx.destroy()

            expect(peerStore.getQueueForRoom(ctx.contextId)).toBeNull()
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
            expect(ctx.connection.usersInRoom).toEqual([])
        })
    })
})
