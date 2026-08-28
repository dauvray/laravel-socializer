/**
 * usePeerConnections.test.js
 *
 * Couche connexions : diff de room, état d'ouverture, ouverture/fermeture PeerJS.
 *
 * Depuis l'extraction de useSignalingQueue, ce composable n'enregistre plus AUCUN hook
 * de lifecycle Vue (cf. commentaire usePeerConnections.js:365) — il s'appelle donc
 * directement, sans `withSetup`, comme useCallManager / useStreamManager.
 *
 * ⚠️ Ces tests documentent le comportement ACTUEL. Deux asymétries connues et
 * volontairement non corrigées sont couvertes telles quelles (items ouverts de la
 * TODOLIST) : `stream`/`screen` renvoient `true` sans rien ouvrir quand le flux local
 * est absent, alors que `visio` renvoie `false` ; et `'audio'` n'appartient pas à
 * VALID_CONNECTION_TYPES.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { usePeerConnections } from '~socializer/components/WebRTC2/Composables/usePeerConnections.js'
import { MAX_PEERS_PER_ROOM } from '~socializer/components/WebRTC2/webrtc2.config.js'
import { createMockContext } from './helpers/createMockContext.js'
import { createMockDataConnection, createMockMediaConnection } from './__mocks__/peerjs.js'

const ROOM = 'room-1'
const ME = 'test-user'

/** Peer local factice : `connect` et `call` renvoient des connexions PeerJS mockées. */
const fakeLocalPeer = () => ({
    id: 'local-peer-id-mock',
    connect: vi.fn(() => createMockDataConnection()),
    call: vi.fn(() => createMockMediaConnection()),
})

/** Vrai MediaStream (le code filtre sur `instanceof`) avec au moins une piste vivante. */
const liveStream = () => {
    const stream = new MediaStream()
    stream.getTracks = () => [{ readyState: 'live', stop: vi.fn() }]
    return stream
}

/** MediaStream dont toutes les pistes sont terminées → considéré invalide par le code. */
const deadStream = () => {
    const stream = new MediaStream()
    stream.getTracks = () => [{ readyState: 'ended', stop: vi.fn() }]
    return stream
}

const makeCtx = (overrides = {}) =>
    createMockContext({
        session: { currentType: 'data', currentRoom: ROOM, ...(overrides.session ?? {}) },
        peerStore: { getLocalPeer: fakeLocalPeer(), ...(overrides.peerStore ?? {}) },
        ...overrides,
    })

describe('usePeerConnections', () => {
    let ctx
    let connections

    beforeEach(() => {
        ctx = makeCtx()
        connections = usePeerConnections(ctx)
    })

    // ── getRoomUsersDiff ──────────────────────────────────────────────────────
    describe('getRoomUsersDiff', () => {
        it('détecte les arrivants et met à jour la liste de la room', async () => {
            const diff = await connections.getRoomUsersDiff([
                { slug: 'alice' },
                { slug: 'bob' },
            ])

            expect(diff.newUsers.map((u) => u.slug)).toEqual(['alice', 'bob'])
            expect(diff.removedUsers).toEqual([])
            expect(ctx.connection.usersInRoom).toEqual(['alice', 'bob'])
        })

        it('détecte les partants et ne les compte pas comme arrivants', async () => {
            await connections.getRoomUsersDiff([{ slug: 'alice' }, { slug: 'bob' }])

            const diff = await connections.getRoomUsersDiff([{ slug: 'alice' }])

            expect(diff.newUsers).toEqual([])
            expect(diff.removedUsers).toEqual(['bob'])
            expect(ctx.connection.usersInRoom).toEqual(['alice'])
        })

        it('exclut mon propre slug de la liste (filtrage à la source)', async () => {
            const diff = await connections.getRoomUsersDiff([{ slug: ME }, { slug: 'alice' }])

            expect(diff.newUsers.map((u) => u.slug)).toEqual(['alice'])
            expect(ctx.connection.usersInRoom).not.toContain(ME)
        })

        it('retourne un diff vide et ne touche à rien si l\'identité locale n\'est pas prête', async () => {
            ctx.waitForMeReady.mockResolvedValue(false)

            const diff = await connections.getRoomUsersDiff([{ slug: 'alice' }])

            expect(diff).toEqual({ newUsers: [], removedUsers: [] })
            expect(ctx.connection.usersInRoom).toEqual([])
        })

        it('sérialise les appels concurrents (pas de TOCTOU sur usersInRoom)', async () => {
            // Sans le mutex, les deux appels liraient le même `previousSlugs` vide et le
            // second annoncerait alice comme un arrivant une seconde fois.
            const [first, second] = await Promise.all([
                connections.getRoomUsersDiff([{ slug: 'alice' }]),
                connections.getRoomUsersDiff([{ slug: 'alice' }, { slug: 'bob' }]),
            ])

            expect(first.newUsers.map((u) => u.slug)).toEqual(['alice'])
            expect(second.newUsers.map((u) => u.slug)).toEqual(['bob'])
            expect(ctx.connection.usersInRoom).toEqual(['alice', 'bob'])
        })

        it('une erreur dans un appel ne bloque pas le verrou pour les suivants', async () => {
            ctx.waitForMeReady.mockRejectedValueOnce(new Error('boom'))

            await expect(connections.getRoomUsersDiff([{ slug: 'alice' }])).rejects.toThrow('boom')

            const diff = await connections.getRoomUsersDiff([{ slug: 'bob' }])
            expect(diff.newUsers.map((u) => u.slug)).toEqual(['bob'])
        })

        it('getNewUsersInRoom ne renvoie que les arrivants', async () => {
            const newUsers = await connections.getNewUsersInRoom([{ slug: 'alice' }])

            expect(newUsers.map((u) => u.slug)).toEqual(['alice'])
        })

        // ── Synchroniser n'est pas savoir ─────────────────────────────────────
        //
        // `usersInRoom` et `presenceSynced` ont le même écrivain — celui-ci — mais plus le
        // même rythme. Un tour sur liste vide purge (c'est le seul qui puisse rendre le
        // dernier partant) sans déclarer la présence connue : le déclarer ferait basculer
        // les gardes d'admission de « je ne sais pas encore » à « tu n'es pas membre » sur
        // une ignorance. Le contexte de test naissant `presenceSynced: true`, les cas qui
        // visent le drapeau le remettent explicitement à false.
        const unsyncedConnections = () => {
            ctx = makeCtx({ connection: { presenceSynced: false } })
            return usePeerConnections(ctx)
        }

        it('un tour vide purge la room et rend tous les membres partants', async () => {
            await connections.getRoomUsersDiff([{ slug: 'alice' }, { slug: 'bob' }])

            const diff = await connections.getRoomUsersDiff([])

            expect(diff.removedUsers).toEqual(['alice', 'bob'])
            expect(diff.newUsers).toEqual([])
            expect(ctx.connection.usersInRoom).toEqual([])
            expect(ctx.peerStore.setRoomMembers).toHaveBeenLastCalledWith(ctx.contextId, [])
        })

        it('un tour vide ne déclare PAS la présence connue', async () => {
            const unsynced = unsyncedConnections()

            await unsynced.getRoomUsersDiff([])

            expect(ctx.connection.presenceSynced).toBe(false)
        })

        it('un tour non vide déclare la présence connue', async () => {
            const unsynced = unsyncedConnections()

            await unsynced.getRoomUsersDiff([{ slug: 'alice' }])

            expect(ctx.connection.presenceSynced).toBe(true)
        })

        it('une liste réduite à mon seul slug déclare la présence connue', async () => {
            // ⭐ Le cas qui condamne le prédicat naïf : mesuré sur la liste FILTRÉE, ce tour
            // serait indistinguable d'un tour qui n'a rien reçu. Or il porte l'information
            // la plus précise qui soit — « je sais, je suis seul ».
            const unsynced = unsyncedConnections()

            await unsynced.getRoomUsersDiff([{ slug: ME }])

            expect(ctx.connection.usersInRoom).toEqual([])
            expect(ctx.connection.presenceSynced).toBe(true)
        })

        // ── L'annuaire user_id → slug ─────────────────────────────────────────
        //
        // Troisième écriture de ce même tour, et la seule qui raisonne en id. Elle sert un
        // besoin de sécurité : un client event Reverb n'est attribuable que par le
        // `user_id` que le serveur régénère, or tout le module raisonne en slugs. Sans
        // annuaire, la seule identité lisible dans un whisper serait celle que l'émetteur
        // a écrite — ce que `securite.md` interdit.
        it('traduit chaque membre de la liste brute, moi compris', async () => {
            // Moi compris : ce n'est pas une allowlist mais un dictionnaire, et
            // `markAnnouncedStream` refuse déjà mon propre slug.
            await connections.getRoomUsersDiff([
                { id: 7, slug: ME },
                { id: 11, slug: 'alice' },
            ])

            expect(ctx.connection.slugByUserId.get('11')).toBe('alice')
            expect(ctx.connection.slugByUserId.get('7')).toBe(ME)
        })

        it('indexe en CHAÎNE, parce que Reverb ne convertit pas le user_id', async () => {
            await connections.getRoomUsersDiff([{ id: 11, slug: 'alice' }])

            expect([...ctx.connection.slugByUserId.keys()]).toEqual(['11'])
        })

        it('RECONSTRUIT à chaque tour : un partant n\'est plus traduisible', async () => {
            // ⭐ Reconstruit et non fusionné : un `user_id` qui n'est plus dans la
            // composition ne doit plus pouvoir attribuer un whisper.
            await connections.getRoomUsersDiff([{ id: 11, slug: 'alice' }, { id: 12, slug: 'bob' }])

            await connections.getRoomUsersDiff([{ id: 12, slug: 'bob' }])

            expect(ctx.connection.slugByUserId.get('11')).toBeUndefined()
            expect(ctx.connection.slugByUserId.get('12')).toBe('bob')
        })

        it('un tour vide vide l\'annuaire, comme il vide la room', async () => {
            await connections.getRoomUsersDiff([{ id: 11, slug: 'alice' }])

            await connections.getRoomUsersDiff([])

            expect(ctx.connection.slugByUserId.size).toBe(0)
        })

        it('est écrit même quand la barrière `waitForMeReady` refuse le tour', async () => {
            // ⭐ La course que ça ferme : le diffuseur re-annonce dès qu'il voit l'arrivant,
            // et un client event ne se rejoue pas. Si l'annuaire attendait le peerId local,
            // le whisper arriverait avant d'être attribuable, et serait perdu pour de bon.
            ctx = makeCtx()
            ctx.waitForMeReady = vi.fn(async () => false)
            const notReady = usePeerConnections(ctx)

            const diff = await notReady.getRoomUsersDiff([{ id: 11, slug: 'alice' }])

            expect(diff.newUsers).toEqual([])
            expect(ctx.connection.usersInRoom).toEqual([])
            expect(ctx.connection.slugByUserId.get('11')).toBe('alice')
        })

        it('ignore un membre sans id — état d\'une charge utile de présence incomplète', async () => {
            await connections.getRoomUsersDiff([{ slug: 'alice' }, { id: null, slug: 'bob' }])

            expect(ctx.connection.slugByUserId.size).toBe(0)
            // Et la composition, elle, reste complète : l'annuaire est un service annexe,
            // pas une condition d'admission.
            expect(ctx.connection.usersInRoom).toEqual(['alice', 'bob'])
        })
    })

    // ── hasOpenConnection ─────────────────────────────────────────────────────
    describe('hasOpenConnection', () => {
        const register = (slug, type, conn) =>
            ctx.peerStore.addPeerConnectionInstance(ROOM, slug, type, conn)

        it('renvoie false quand aucune connexion n\'est enregistrée', () => {
            expect(connections.hasOpenConnection('alice', ROOM, 'data')).toBe(false)
        })

        it('data : suit le drapeau `open` de la DataConnection', () => {
            const conn = createMockDataConnection()
            register('alice', 'data', conn)

            expect(connections.hasOpenConnection('alice', ROOM, 'data')).toBe(false)
            conn.open = true
            expect(connections.hasOpenConnection('alice', ROOM, 'data')).toBe(true)
        })

        it('media : connectionState `connected` → ouverte', () => {
            const conn = createMockMediaConnection()
            conn.peerConnection.connectionState = 'connected'
            register('alice', 'visio', conn)

            expect(connections.hasOpenConnection('alice', ROOM, 'visio')).toBe(true)
        })

        it('media : un appel encore en vol (`connecting`) compte comme ouvert — délibérément', () => {
            // Ce prédicat répond à « dois-je m'abstenir d'en ouvrir une seconde ? ». Un
            // appel dont l'offre est partie doit donc compter, sinon chaque tour de retry
            // empilerait une MediaConnection de plus.
            //
            // ⚠️ Il ne répond PAS à « ai-je fini ? » — c'est `isConnectionEstablished`.
            // Les avoir confondus rendait définitive toute défaillance d'admission.
            register('alice', 'visio', createMockMediaConnection()) // naît en `connecting`

            expect(connections.hasOpenConnection('alice', ROOM, 'visio')).toBe(true)
        })

        it.each(['closed', 'failed', 'disconnected'])(
            'media : connectionState `%s` → fermée',
            (state) => {
                const conn = createMockMediaConnection()
                conn.peerConnection.connectionState = state
                register('alice', 'visio', conn)

                expect(connections.hasOpenConnection('alice', ROOM, 'visio')).toBe(false)
            }
        )

        it('media : retombe sur signalingState quand connectionState est absent', () => {
            const conn = createMockMediaConnection()
            conn.peerConnection = { signalingState: 'closed' }
            register('alice', 'visio', conn)

            expect(connections.hasOpenConnection('alice', ROOM, 'visio')).toBe(false)
        })

        it('media : un RTCPeerConnection illisible est traité comme fermé (lecture défensive)', () => {
            const conn = createMockMediaConnection()
            Object.defineProperty(conn, 'peerConnection', {
                get() { throw new Error('objet détruit') },
            })
            register('alice', 'visio', conn)

            expect(connections.hasOpenConnection('alice', ROOM, 'visio')).toBe(false)
        })

        it('media : sans peerConnection exploitable, la connexion est réputée active (fallback)', () => {
            const conn = createMockMediaConnection()
            conn.peerConnection = null
            register('alice', 'visio', conn)

            expect(connections.hasOpenConnection('alice', ROOM, 'visio')).toBe(true)
        })

        it('une seule connexion ouverte parmi plusieurs suffit', () => {
            const closed = createMockDataConnection()
            const open = createMockDataConnection()
            open.open = true
            register('alice', 'data', closed)
            register('alice', 'data', open)

            expect(connections.hasOpenConnection('alice', ROOM, 'data')).toBe(true)
        })

        it('sans arguments explicites, room et type viennent du contexte', () => {
            const conn = createMockDataConnection()
            conn.open = true
            register('alice', 'data', conn)

            expect(connections.hasOpenConnection('alice')).toBe(true)
        })

        it('la room d\'appel prend le pas sur la room courante', () => {
            ctx.session.currentCallRoomId = 'call-room'
            const conn = createMockDataConnection()
            conn.open = true
            ctx.peerStore.addPeerConnectionInstance('call-room', 'alice', 'data', conn)

            expect(connections.hasOpenConnection('alice')).toBe(true)
        })
    })

    // ── isConnectionEstablished ───────────────────────────────────────────────
    //
    // Le pendant STRICT de `hasOpenConnection`. Deux prédicats sur la même liste, pour
    // deux questions opposées : « ne pas ouvrir en double » (optimiste) et « ai-je
    // fini ? » (strict). Les avoir confondus laissait le moteur de retry conclure au
    // succès une seconde après un `peer.call()` que personne ne répondrait jamais.

    describe('isConnectionEstablished', () => {
        const register = (slug, type, conn) =>
            ctx.peerStore.addPeerConnectionInstance(ROOM, slug, type, conn)

        it('renvoie false quand aucune connexion n\'est enregistrée', () => {
            expect(connections.isConnectionEstablished('alice', ROOM, 'visio')).toBe(false)
        })

        it('data : établie dès que le canal est ouvert', () => {
            const conn = createMockDataConnection()
            register('alice', 'data', conn)

            expect(connections.isConnectionEstablished('alice', ROOM, 'data')).toBe(false)
            conn.open = true
            expect(connections.isConnectionEstablished('alice', ROOM, 'data')).toBe(true)
        })

        it.each(['new', 'connecting'])(
            'media : `%s` n\'est PAS établie — l\'offre est partie, la réponse n\'est pas venue',
            (state) => {
                const conn = createMockMediaConnection()
                conn.peerConnection.connectionState = state
                register('alice', 'visio', conn)

                expect(connections.isConnectionEstablished('alice', ROOM, 'visio')).toBe(false)
                // Et le prédicat optimiste, lui, dit bien « ouverte » : c'est toute la
                // différence, et c'est ce qui manquait.
                expect(connections.hasOpenConnection('alice', ROOM, 'visio')).toBe(true)
            }
        )

        it('media : `connected` est établie', () => {
            const conn = createMockMediaConnection()
            conn.peerConnection.connectionState = 'connected'
            register('alice', 'visio', conn)

            expect(connections.isConnectionEstablished('alice', ROOM, 'visio')).toBe(true)
        })

        it('media : un canal data ouvert ne vaut PAS appel média établi', () => {
            // Cas réel du contexte `stream` : `connectToPeer` ouvre un `peer.call()` ET un
            // `peer.connect()` avec la même metadata, donc stockés sous le MÊME type. Ce
            // sont deux RTCPeerConnection distincts : le canal data peut s'établir pendant
            // que l'appel reste sans réponse. Sans la distinction média/data, le data
            // channel ouvert ferait conclure « flux établi » — et le récepteur resterait
            // sur un écran noir.
            const call = createMockMediaConnection()   // `connecting` : sans réponse
            const data = createMockDataConnection()
            data.open = true
            data.peerConnection.connectionState = 'connected'  // le canal, lui, a abouti
            register('alice', 'stream', call)
            register('alice', 'stream', data)

            expect(connections.isConnectionEstablished('alice', ROOM, 'stream')).toBe(false)

            call.peerConnection.connectionState = 'connected'
            expect(connections.isConnectionEstablished('alice', ROOM, 'stream')).toBe(true)
        })

        it('media : un RTCPeerConnection illisible n\'est pas établi (lecture défensive)', () => {
            const conn = createMockMediaConnection()
            Object.defineProperty(conn, 'peerConnection', {
                get() { throw new Error('objet détruit') },
            })
            register('alice', 'visio', conn)

            expect(connections.isConnectionEstablished('alice', ROOM, 'visio')).toBe(false)
        })

        it('media : pas de fallback optimiste — sans peerConnection, rien n\'est établi', () => {
            // Contre-épreuve de `hasOpenConnection`, qui répond `true` dans ce cas.
            const conn = createMockMediaConnection()
            conn.peerConnection = null
            register('alice', 'visio', conn)

            expect(connections.isConnectionEstablished('alice', ROOM, 'visio')).toBe(false)
            expect(connections.hasOpenConnection('alice', ROOM, 'visio')).toBe(true)
        })
    })

    // ── connectToPeer ─────────────────────────────────────────────────────────
    describe('connectToPeer', () => {
        // Le garde d'autorisation sortante exige que la cible soit membre de la room ou
        // interlocuteur d'appel autorisé. On déclare donc la room ici, et pas dans
        // `makeCtx` : les tests de `getRoomUsersDiff` assertent sur le contenu exact de
        // `usersInRoom` après diff et une valeur initiale non vide les fausserait.
        beforeEach(() => {
            ctx.connection.usersInRoom = ['alice', 'bob']
        })

        it('refuse un payload sans userSlug ou sans peerId', () => {
            expect(connections.connectToPeer({ peerId: 'p1' })).toBe(false)
            expect(connections.connectToPeer({ userSlug: 'alice' })).toBe(false)
            expect(ctx.peerStore.getLocalPeer.connect).not.toHaveBeenCalled()
        })

        // ── Aucun Peer local ──────────────────────────────────────────────────
        //
        // Cinq branches de `connectToPeer` faisaient `ctx.peerStore.getLocalPeer.connect(…)`
        // ou `.call(…)` SANS test de nullité, en s'appuyant sur le fait que l'appelant a
        // *peut-être* attendu `waitForMeReady` — lequel ne lit que `lastLocalPeerId`, un fait
        // HISTORIQUE. Les deux divergent en routine : `Peer.disconnect()` met `_id` à null, et
        // le `.catch` d'init nulle `localPeer` en laissant `lastLocalPeerId` posé.

        it('ne jette pas et reporte quand il n\'y a aucun Peer local', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
            ctx.peerStore.getLocalPeer = null

            // ⭐ `false` et non `true` : `true` voudrait dire « c'est fait » et le moteur de
            // retry ne reviendrait pas — le pair resterait injoignable pour de bon. Avant le
            // garde, la TypeError tombait dans le `catch` général et sortait en « Erreur
            // pendant connectToPeer », un message qui ne nomme ni la cause ni le pair.
            expect(() => connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice' })).not.toThrow()
            expect(connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice' })).toBe(false)
            expect(warn).toHaveBeenCalledWith(
                expect.stringContaining('aucun Peer local'),
                expect.objectContaining({ userSlug: 'alice' })
            )
        })

        // ⚠️ Celui-ci reste VERT sans le garde (vérifié) : la TypeError tombait dans le
        // `catch`, dont le `finally` relâche déjà le verrou. Il n'épingle donc pas le garde
        // mais la propriété dont le garde dépend — un report doit rester réessayable. Le dire
        // plutôt que le laisser croire : un test qui passe dans les deux cas n'épingle rien.
        it('un report faute de Peer local reste réessayable (verrou relâché)', () => {
            vi.spyOn(console, 'warn').mockImplementation(() => {})
            ctx.peerStore.getLocalPeer = null

            connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice' })

            // Sans relâchement, un report gèlerait définitivement toute nouvelle tentative
            // vers ce pair : la deuxième sortirait par « déjà en vol » et le moteur de retry
            // ne rattraperait rien.
            ctx.peerStore.getLocalPeer = fakeLocalPeer()
            expect(connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice' })).toBe(true)
            expect(ctx.peerStore.getLocalPeer.connect).toHaveBeenCalled()
        })

        it('accepte `fromUserSlug` comme alias de `userSlug`', () => {
            expect(connections.connectToPeer({ fromUserSlug: 'alice', peerId: 'p-alice' })).toBe(true)
            expect(ctx.peerStore.getLocalPeer.connect).toHaveBeenCalled()
        })

        it('ne se connecte jamais à soi-même (par slug comme par peerId)', () => {
            expect(connections.connectToPeer({ userSlug: ME, peerId: 'p-other' })).toBe(true)
            expect(connections.connectToPeer({ userSlug: 'alice', peerId: 'local-peer-id-mock' })).toBe(true)
            expect(ctx.peerStore.getLocalPeer.connect).not.toHaveBeenCalled()
        })

        it('n\'ouvre pas de seconde connexion si une est déjà ouverte', () => {
            const conn = createMockDataConnection()
            conn.open = true
            ctx.peerStore.addPeerConnectionInstance(ROOM, 'alice', 'data', conn)

            expect(connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice' })).toBe(true)
            expect(ctx.peerStore.getLocalPeer.connect).not.toHaveBeenCalled()
        })

        it('refuse au-delà de MAX_PEERS_PER_ROOM pairs actifs', () => {
            for (let i = 0; i < MAX_PEERS_PER_ROOM; i++) {
                const conn = createMockDataConnection()
                conn.open = true
                ctx.peerStore.addPeerConnectionInstance(ROOM, `peer-${i}`, 'data', conn)
            }

            expect(connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice' })).toBe(false)
            expect(ctx.peerStore.getLocalPeer.connect).not.toHaveBeenCalled()
        })

        it('purge le drapeau d\'attente et mémorise le peerId distant', () => {
            ctx.peerStore.addWaitingRemotePeerId('alice', { room: ctx.session.onAirRoom, type: 'data' })

            connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice' })

            // Clé EXACTE : la demande purgée est celle de ce contexte, jamais celle
            // qu'un autre provider de la page aurait émise pour le même pair.
            expect(ctx.peerStore.removeWaitingRemotePeerId)
                .toHaveBeenCalledWith('alice', ctx.session.onAirRoom, 'data')
            expect(ctx.peerStore.getRemotePeerId('alice')).toBe('p-alice')
        })

        it('ne touche pas à la demande en vol d\'un autre contexte du même onglet', () => {
            // Configuration de production : Exemples/Home.vue monte trois providers, donc
            // trois contextes qui partagent CE store. Le contexte `stream-room-test`
            // conclut sa connexion ; celle du chat (`data-room-chat`) est encore en vol.
            ctx.peerStore.addWaitingRemotePeerId('alice', { room: 'room-chat', type: 'data' })
            ctx.peerStore.addWaitingRemotePeerId('alice', { room: ctx.session.onAirRoom, type: 'data' })

            connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice' })

            const stillPending = ctx.peerStore.getWaitingRemotePeerIds('alice')
            expect(stillPending).toHaveLength(1)
            expect(stillPending[0].room).toBe('room-chat')
        })

        it('rafraîchit un mapping périmé avec le peerId de la signalisation', () => {
            // Le payload vient de PEER_CONNECT_TO_REMOTE_PEER : c'est l'information la
            // plus fraîche qui existe. Conserver l'ancienne valeur rendait un peerId mort
            // « collant » — le pair devenait définitivement injoignable (bug du 2026-08-13).
            ctx.peerStore.addRemotePeerId('alice', 'p-perime')

            connections.connectToPeer({ userSlug: 'alice', peerId: 'p-frais' })

            expect(ctx.peerStore.getRemotePeerId('alice')).toBe('p-frais')
            expect(ctx.peerStore.getLocalPeer.connect).toHaveBeenCalledWith(
                'p-frais',
                expect.anything()
            )
        })

        it('rafraîchit le peerId même quand une connexion périmée passe encore pour ouverte', () => {
            // Le cas de production, et celui que le test précédent ne couvre PAS : le pair
            // a rechargé sa page, mais sa connexion figure encore comme ouverte
            // (`open === true` pour une DataConnection, fallback `return true` pour une
            // MediaConnection dont le RTCPeerConnection n'est plus lisible). On sort donc
            // par la garde « déjà connecté » — et si l'enregistrement du peerId vit après
            // cette garde, le frais est perdu. Plus personne ne redemande, puisqu'on croit
            // déjà en avoir un : le pair devient définitivement injoignable.
            ctx.peerStore.addRemotePeerId('alice', 'p-perime')
            ctx.peerStore.addPeerConnectionInstance(ROOM, 'alice', 'data', { peer: 'p-perime', open: true })

            expect(connections.connectToPeer({ userSlug: 'alice', peerId: 'p-frais' })).toBe(true)

            expect(ctx.peerStore.getLocalPeer.connect).not.toHaveBeenCalled()
            expect(ctx.peerStore.getRemotePeerId('alice')).toBe('p-frais')
        })

        describe('par type de connexion', () => {
            it('data : ouvre une DataConnection fiable et l\'enregistre', () => {
                expect(connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice' })).toBe(true)

                expect(ctx.peerStore.getLocalPeer.connect).toHaveBeenCalledWith(
                    'p-alice',
                    expect.objectContaining({ reliable: true })
                )
                expect(ctx.peerStore.getLocalPeer.call).not.toHaveBeenCalled()
                expect(ctx.setUpConnectionListeners).toHaveBeenCalledTimes(1)
                expect(ctx.peerStore.storePeerConnection).toHaveBeenCalledTimes(1)
            })

            it('stream : ouvre l\'appel média ET la DataConnection associée', () => {
                ctx.session.currentType = 'stream'
                ctx.media.currentStream = liveStream()

                expect(connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice' })).toBe(true)

                expect(ctx.peerStore.getLocalPeer.call).toHaveBeenCalledTimes(1)
                expect(ctx.peerStore.getLocalPeer.connect).toHaveBeenCalledTimes(1)
                expect(ctx.peerStore.storePeerConnection).toHaveBeenCalledTimes(2)
            })

            it('screen : n\'ouvre que l\'appel média, à partir de screenStream', () => {
                ctx.session.currentType = 'screen'
                const stream = liveStream()
                ctx.media.screenStream = stream

                expect(connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice' })).toBe(true)

                expect(ctx.peerStore.getLocalPeer.call).toHaveBeenCalledWith(
                    'p-alice',
                    stream,
                    expect.anything()
                )
                expect(ctx.peerStore.getLocalPeer.connect).not.toHaveBeenCalled()
            })

            it('visio : appelle avec le flux courant', () => {
                ctx.session.currentType = 'visio'
                const stream = liveStream()
                ctx.media.currentStream = stream

                expect(connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice' })).toBe(true)
                expect(ctx.peerStore.getLocalPeer.call).toHaveBeenCalledWith(
                    'p-alice',
                    stream,
                    expect.anything()
                )
            })

            it.each(['stream', 'screen'])(
                '%s sans flux valide : renvoie true SANS rien ouvrir (asymétrie documentée)',
                (type) => {
                    ctx.session.currentType = type
                    ctx.media.currentStream = deadStream()
                    ctx.media.screenStream = deadStream()

                    // ⚠️ `true` alors qu'aucune connexion n'est ouverte : c'est ce retour qui
                    // annule le retry dans useConnectionPool (item ouvert de la TODOLIST).
                    expect(connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice' })).toBe(true)
                    expect(ctx.peerStore.getLocalPeer.call).not.toHaveBeenCalled()
                }
            )

            it('visio sans flux valide : renvoie false (seul type à signaler l\'échec)', () => {
                ctx.session.currentType = 'visio'
                ctx.media.currentStream = null

                expect(connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice' })).toBe(false)
                expect(ctx.peerStore.getLocalPeer.call).not.toHaveBeenCalled()
            })

            it('vocal : ouvre l\'appel comme visio (mêmes préconditions de flux)', () => {
                ctx.session.currentType = 'vocal'
                ctx.media.currentStream = liveStream()

                expect(connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice' })).toBe(true)
                expect(ctx.peerStore.getLocalPeer.call).toHaveBeenCalledOnce()
            })

            it('vocal : sans flux local, échoue explicitement (et laisse le retry différer)', () => {
                ctx.session.currentType = 'vocal'
                ctx.media.currentStream = null

                // `false` et non `true` : un `true` ANNULERAIT le retry, ce qui était
                // exactement le défaut de l'absence de branche.
                expect(connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice' })).toBe(false)
                expect(ctx.peerStore.getLocalPeer.call).not.toHaveBeenCalled()
            })
        })

        describe('validation de la configuration', () => {
            it('rejette un type hors VALID_CONNECTION_TYPES', () => {
                expect(connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice', type: 'inconnu' })).toBe(false)
            })

            it('rejette `audio`, désormais invalide pour les DEUX couches', () => {
                // VALID_CALL_TYPES est maintenant dérivé de VALID_CONNECTION_TYPES :
                // l'asymétrie historique (accepté à l'entrée, refusé à l'ouverture) est
                // levée — `audio` n'était émis par aucun appelant.
                expect(connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice', type: 'audio' })).toBe(false)
            })

            it('rejette une room vide', () => {
                ctx.session.currentRoom = ''
                expect(connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice' })).toBe(false)
            })

            it('rejette un contexte sans identité locale', () => {
                ctx.meStore.getMe = null
                expect(connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice' })).toBe(false)
            })

            it('renvoie false si l\'ouverture jette', () => {
                ctx.peerStore.getLocalPeer.connect.mockImplementation(() => {
                    throw new Error('peer indisponible')
                })

                expect(connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice' })).toBe(false)
            })

            it('construit des métadonnées complètes (identité, room, type, état UI)', () => {
                ctx.ui.streamStates.isMuted = true

                connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice' })

                expect(ctx.peerStore.getLocalPeer.connect).toHaveBeenCalledWith('p-alice', {
                    reliable: true,
                    metadata: {
                        slug: 'alice',
                        from: ME,
                        fromName: 'Test User',
                        type: 'data',
                        room: ROOM,
                        callbackKey: ctx.contextId,
                        isAudioMuted: true,
                        isVideoEnabled: true,
                    },
                })
            })
        })

        // ── autorisation sortante ─────────────────────────────────────────────
        //
        // Le pendant de `usePeerTransport.incomingAuth` : durcir l'entrant ne protège de
        // rien tant qu'un tiers peut obtenir de sa victime un `connectToPeer(lui)` — sur
        // un appel média, c'est l'émetteur qui livre son flux. Le payload vient de la
        // signalisation, donc de n'importe quel authentifié.
        //
        // Cas NÉGATIFS d'abord : c'est l'absence d'effet qui est le correctif.
        describe('autorisation sortante', () => {
            const INTRUS = 'mallory'

            beforeEach(() => {
                // Des flux prêts à partir : sans eux, l'absence d'émission ne prouverait
                // rien (les types porteurs de flux sortent tôt quand le flux est absent).
                ctx.media.currentStream = liveStream()
                ctx.media.screenStream = liveStream()
            })

            it("refuse un pair ni membre de la room ni interlocuteur d'appel autorisé", () => {
                expect(connections.connectToPeer({ userSlug: INTRUS, peerId: 'p-mallory' })).toBe(false)

                expect(ctx.peerStore.getLocalPeer.call).not.toHaveBeenCalled()
                expect(ctx.peerStore.getLocalPeer.connect).not.toHaveBeenCalled()
            })

            it("n'écrit pas le mapping peerId d'un pair refusé (empoisonnement de l'allowlist entrante)", () => {
                // Seconde moitié de la faille : `addRemotePeerId` inconditionnel inscrivait
                // l'intrus comme « interlocuteur d'appel vérifié » pour le chemin (b) de
                // `_isAuthorizedIncomingPeer`, sans qu'aucun appel n'ait été autorisé.
                connections.connectToPeer({ userSlug: INTRUS, peerId: 'p-mallory' })

                expect(ctx.peerStore.addRemotePeerId).not.toHaveBeenCalled()
                expect(ctx.peerStore.getRemotePeerId(INTRUS)).toBeNull()
            })

            it.each(['stream', 'screen', 'visio', 'vocal'])(
                "%s : aucun flux n'est émis vers un pair refusé",
                (type) => {
                    expect(connections.connectToPeer({
                        userSlug: INTRUS,
                        peerId: 'p-mallory',
                        type,
                    })).toBe(false)

                    expect(ctx.peerStore.getLocalPeer.call).not.toHaveBeenCalled()
                },
            )

            it('refuse un slug au format invalide, même déclaré dans la room', () => {
                ctx.connection.usersInRoom = ['pas un slug !']

                expect(connections.connectToPeer({
                    userSlug: 'pas un slug !',
                    peerId: 'p-forge',
                })).toBe(false)
                expect(ctx.peerStore.getLocalPeer.connect).not.toHaveBeenCalled()
            })

            it('renvoie false — jamais true — pour que le retry diffère au lieu de conclure', () => {
                // `true` signifie « rien à conclure » et ANNULE le retry (cf. le piège de
                // `vocal`, qui tombait sur le `return true` final). Un signal légitime reçu
                // avant que la présence n'ait peuplé `usersInRoom` doit être rattrapé.
                ctx.connection.usersInRoom = []

                expect(connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice' })).toBe(false)
            })

            it('laisse passer un membre de la room (non-régression)', () => {
                expect(connections.connectToPeer({ userSlug: 'alice', peerId: 'p-alice' })).toBe(true)
                expect(ctx.peerStore.getLocalPeer.connect).toHaveBeenCalled()
            })

            it("laisse passer un interlocuteur d'appel autorisé HORS room", () => {
                // La visio 1-à-1 n'a aucune room commune : c'est exactement le cas que le
                // correctif du sens entrant de mai avait cassé (appel bloqué en « pending »).
                // Le registre `authorizedCallPeers` (A1) existe pour lui.
                ctx.markAuthorizedCallPeer('carol')

                expect(ctx.connection.usersInRoom).not.toContain('carol')
                expect(connections.connectToPeer({
                    userSlug: 'carol',
                    peerId: 'p-carol',
                    type: 'visio',
                })).toBe(true)
                expect(ctx.peerStore.getLocalPeer.call).toHaveBeenCalledWith(
                    'p-carol',
                    ctx.media.currentStream,
                    expect.anything(),
                )
            })
        })
    })

    // ── closePeerConnection ───────────────────────────────────────────────────
    describe('closePeerConnection', () => {
        beforeEach(() => {
            ;['alice', 'bob'].forEach((slug) => {
                const conn = createMockDataConnection()
                conn.open = true
                ctx.peerStore.addPeerConnectionInstance(ROOM, slug, 'data', conn)
                ctx.peerStore.addRemotePeerId(slug, `p-${slug}`)
            })
        })

        it('ferme tous les pairs de la room par défaut', () => {
            connections.closePeerConnection()

            expect(ctx.peerStore.closePeerConnection).toHaveBeenCalledWith(ROOM, 'alice', 'data')
            expect(ctx.peerStore.closePeerConnection).toHaveBeenCalledWith(ROOM, 'bob', 'data')
            expect(ctx.peerStore.getConnections[ROOM]).toBeUndefined()
        })

        it('ne ferme que les pairs listés', () => {
            connections.closePeerConnection({ users: ['alice'] })

            expect(ctx.peerStore.closePeerConnection).toHaveBeenCalledWith(ROOM, 'alice', 'data')
            expect(ctx.peerStore.closePeerConnection).not.toHaveBeenCalledWith(ROOM, 'bob', 'data')
            expect(ctx.peerStore.getConnections[ROOM].bob).toBeDefined()
        })

        it('oublie le peerId d\'un pair dont la connexion est fermée', () => {
            connections.closePeerConnection({ users: ['alice'] })

            expect(ctx.peerStore.getRemotePeerId('alice')).toBeNull()
            expect(ctx.peerStore.getRemotePeerId('bob')).toBe('p-bob')
        })

        it('purge les demandes en vol de SA room, pas celles des autres contextes', () => {
            ctx.peerStore.addWaitingRemotePeerId('alice', { room: ROOM, type: 'data' })
            ctx.peerStore.addWaitingRemotePeerId('alice', { room: ROOM, type: 'screen' })
            ctx.peerStore.addWaitingRemotePeerId('alice', { room: 'autre-room', type: 'data' })

            connections.closePeerConnection({ users: ['alice'] })

            expect(ctx.peerStore.clearWaitingRemotePeerIds).toHaveBeenCalledWith('alice', ROOM)

            // Les deux types de MA room sont partis, celle du contexte voisin survit.
            const stillPending = ctx.peerStore.getWaitingRemotePeerIds('alice')
            expect(stillPending.map((entry) => entry.room)).toEqual(['autre-room'])
        })

        it('vide la file de signaux du contexte par défaut', () => {
            connections.closePeerConnection()

            expect(ctx.peerStore.clearSignalQueueRoom).toHaveBeenCalledWith(ctx.contextId)
        })

        it('respecte clearSignalQueue: false', () => {
            connections.closePeerConnection({ clearSignalQueue: false })

            expect(ctx.peerStore.clearSignalQueueRoom).not.toHaveBeenCalled()
        })

        it('vide quand même la file quand la room n\'a aucune connexion', () => {
            connections.closePeerConnection({ room: 'room-vide' })

            expect(ctx.peerStore.closePeerConnection).not.toHaveBeenCalled()
            expect(ctx.peerStore.clearSignalQueueRoom).toHaveBeenCalledWith(ctx.contextId)
        })
    })
})
