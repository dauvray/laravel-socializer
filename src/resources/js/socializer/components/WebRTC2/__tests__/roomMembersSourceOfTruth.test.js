/**
 * roomMembersSourceOfTruth.test.js — la composition n'a qu'un domicile, et une seule porte
 * d'écriture.
 *
 * `ctx.connection.remotePeers` a été un champ, doublé d'une projection dans le store écrite
 * au statement suivant. C'est aujourd'hui un ACCESSEUR au-dessus de
 * `peerStore.roomMembers[contextId]`, et l'unique écrivain de production est
 * `peerStore.computeRoomDiff`. Ce fichier fige cet état de fait, parce qu'aucune assertion
 * de VALEUR ne peut le voir : un mirroir ressuscité rendrait les mêmes valeurs, et la
 * composition cesserait simplement d'être visible au store.
 *
 * Le mode de panne visé n'est pas hypothétique, il est daté deux fois :
 *
 *   - la passe de renommage `usersInRoom` → `remotePeers` a dû se doter d'un accesseur
 *     jetant temporairement, parce que `connection` est un `reactive` à spread d'overrides
 *     et que les deux gardes d'autorisation lisent `Array.isArray(…) ? … : []` : un site
 *     manqué n'échoue pas, il écrit une propriété orpheline, la garde lit `[]`, et le
 *     verdict bascule vers « refusé » — ce que la moitié des tests d'autorisation attend
 *     déjà. Ce fichier remplace cette parade jetable par un invariant permanent ;
 *   - `peerjsMockFidelity.descriptors.test.js` existe parce que `Peer.id` est un accesseur
 *     en lecture seule dans la vraie librairie et une propriété nue dans le double : le
 *     code de production levait en mode strict, pendant des mois, suite verte. C'est
 *     exactement la forme du risque que prend le choix conservé ici — un setter dans le
 *     double, aucun en production. D'où la troisième section, qui est celle qui ferme le
 *     risque : le double ne peut pas cacher une écriture de PRODUCTION, puisqu'on vérifie
 *     mécaniquement qu'il n'y en a aucune.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { toRaw, computed, effect } from 'vue'
import { createPeerContext } from '~socializer/components/WebRTC2/Composables/createPeerContext.js'
import { usePeer2Store } from '~socializer/stores/peers2.js'
import { useMeStore } from '~estarter/stores/me.js'
import { EMPTY_MEMBERS } from '~socializer/stores/peers2/roomDiff.js'
import { withSetup } from './helpers/withSetup.js'
import { mockEventBus } from './helpers/mockEventBus.js'
import { createMockContext } from './helpers/createMockContext.js'

// Sources de production du module — jamais les tests ni les helpers. Même périmètre que
// `mockFidelity.test.js`, dont ce fichier est le voisin de méthode.
const SOURCES = import.meta.glob(
    ['../Composables/**/*.js', '../Widgets/**/*.js', '../Widgets/**/*.vue', '../Exemples/**/*.vue'],
    { query: '?raw', import: 'default', eager: true }
)

const descriptorOf = (connection) => Object.getOwnPropertyDescriptor(toRaw(connection), 'remotePeers')

describe('roomMembers est la seule source de la composition', () => {
    let apps
    let peerStore

    beforeEach(() => {
        apps = []
        peerStore = usePeer2Store()
        useMeStore().me = { id: 1, slug: 'test-user', name: 'Test User' }
    })

    afterEach(() => {
        apps.forEach(app => app.unmount())
    })

    // L'eventBus s'INJECTE, il ne se passe pas en option — même geste que
    // `createPeerContext.test.js`, sans quoi la fabrique warn et pose son no-op.
    const mountContext = ({ type = 'data', room = 'app', options = {} } = {}) => {
        const [ctx, app] = withSetup(
            () => createPeerContext({ type, room, options }),
            { provides: { eventBus: mockEventBus() } }
        )
        apps.push(app)
        return ctx
    }

    // ── Production : accesseur en lecture seule ────────────────────────────────
    describe('createPeerContext', () => {
        it('expose `remotePeers` comme accesseur, sans setter', () => {
            const descriptor = descriptorOf(mountContext().connection)

            expect(typeof descriptor?.get).toBe('function')
            expect(descriptor.set).toBeUndefined()
            expect('value' in descriptor).toBe(false)
        })

        it('lève à l\'écriture au lieu de créer une seconde source', () => {
            const ctx = mountContext()

            expect(() => { ctx.connection.remotePeers = ['alice'] }).toThrow(TypeError)
            expect(ctx.connection.remotePeers).toEqual([])
        })

        // Par IDENTITÉ, pas par valeur : un `[]` neuf à chaque lecture passerait `toEqual([])`
        // tout en prouvant que la lecture ne traverse pas le store.
        it('lit à travers le store, y compris quand le contexte n\'a rien déclaré', () => {
            const ctx = mountContext()

            expect(ctx.connection.remotePeers).toBe(EMPTY_MEMBERS)

            peerStore.setRoomMembers(ctx.contextId, ['alice'])

            expect(ctx.connection.remotePeers).toBe(peerStore.roomMembers[ctx.contextId])
        })

        it('rend la composition réactive aux écritures du store', () => {
            const ctx = mountContext()

            expect(ctx.remotePeers.value).toEqual([])

            peerStore.computeRoomDiff(ctx.contextId, ['alice', 'bob'])

            expect(ctx.remotePeers.value).toEqual(['alice', 'bob'])
        })
    })

    // ── Double : accesseur AUSSI, plus un setter de semis assumé ───────────────
    describe('createMockContext', () => {
        it('expose `remotePeers` comme accesseur adossé à `roomMembers`', () => {
            const ctx = createMockContext({ contextId: 'stream-room-test' })
            const descriptor = descriptorOf(ctx.connection)

            expect(typeof descriptor?.get).toBe('function')
            expect('value' in descriptor).toBe(false)

            ctx.peerStore.setRoomMembers('stream-room-test', ['alice'])

            expect(ctx.connection.remotePeers).toEqual(['alice'])
        })

        // Le SEUL écart assumé avec la production, et sa raison : la moitié des fichiers de
        // test stube `getRoomUsersDiff`, donc sans écrivain de production la composition n'a
        // aucun moyen d'exister. La section suivante est ce qui rend cet écart sûr.
        it('garde un setter de SEMIS, qui écrit dans l\'index et nulle part ailleurs', () => {
            const ctx = createMockContext({ contextId: 'stream-room-test' })

            ctx.connection.remotePeers = ['alice']

            expect(ctx.peerStore.roomMembers['stream-room-test']).toEqual(['alice'])
        })

        // Le mode de panne silencieux de cette migration, en un cas : l'override arrivait
        // par le spread `...(overrides.connection ?? {})`, donc APRÈS l'accesseur, qu'il
        // remplaçait par une propriété nue. Rien ne levait, et la composition devenait
        // invisible au store — sur la clé qui porte l'allowlist des deux gardes.
        it('sème un override `connection.remotePeers` dans l\'index sans écraser l\'accesseur', () => {
            const ctx = createMockContext({
                contextId: 'stream-room-test',
                connection: { remotePeers: ['alice', 'bob'], presenceSynced: false },
            })

            expect(typeof descriptorOf(ctx.connection)?.get).toBe('function')
            expect(ctx.peerStore.roomMembers['stream-room-test']).toEqual(['alice', 'bob'])
            expect(ctx.connection.remotePeers).toEqual(['alice', 'bob'])
            // Et le reste de l'override passe toujours.
            expect(ctx.connection.presenceSynced).toBe(false)
        })

        // ⚠️ Ce cas est le seul qui exige `_roomMembers` RÉACTIF dans le double, et il a été
        // écrit après avoir constaté que rien ne l'exigeait : les cas existants sèment par le
        // setter, et c'est alors le proxy de `connection` qui déclenche, pas l'index. La
        // réactivité du chemin de PRODUCTION — écrire par le verbe du store, lire par
        // l'accesseur — n'était donc vérifiée nulle part, et un index nu aurait laissé le
        // double servir des valeurs justes à un lecteur qui ne se réveille jamais.
        it('rend la composition réactive aux écritures passant par le verbe du store', () => {
            const ctx = createMockContext({ contextId: 'stream-room-test' })
            let runs = 0
            const count = computed(() => ctx.connection.remotePeers.length)
            effect(() => { runs += 1; void count.value })

            expect(runs).toBe(1)

            ctx.peerStore.computeRoomDiff('stream-room-test', ['alice', 'bob'])

            expect(count.value).toBe(2)
            expect(runs).toBe(2)
        })

        it('isole deux contextes du même onglet par leur clé', () => {
            const a = createMockContext({ contextId: 'data-app' })
            const b = createMockContext({ contextId: 'stream-room-test' })

            a.connection.remotePeers = ['alice']

            expect(b.connection.remotePeers).toEqual([])
        })
    })

    // ── Ce qui ferme le risque du setter de semis ──────────────────────────────
    //
    // Sans cette section, le double serait plus permissif que la production sur un chemin
    // de sécurité : un composable qui écrirait `ctx.connection.remotePeers` serait vert en
    // test et lèverait en production. C'est mot pour mot la panne de `Peer.id`. On la ferme
    // là où elle naît — dans les sources de production — au lieu de durcir le double.
    describe('aucune écriture de production', () => {
        it('capture bien des sources (le collecteur n\'est pas inerte)', () => {
            const sources = Object.entries(SOURCES)

            expect(sources.length).toBeGreaterThan(5)
            // Contre-épreuve du collecteur : la lecture existe, elle, en quantité.
            expect(
                sources.filter(([, src]) => String(src).includes('connection.remotePeers')).length
            ).toBeGreaterThan(2)
        })

        it('n\'assigne `connection.remotePeers` dans aucune source de production', () => {
            // `=` non suivi de `=`, `>` ou `<` : une assignation, pas une comparaison ni une
            // fonction fléchée.
            const assignment = /\.remotePeers\s*=(?![=>])/g
            const offenders = Object.entries(SOURCES)
                .filter(([, source]) => assignment.test(String(source)))
                .map(([path]) => path.replace('../', ''))

            expect(offenders).toEqual([])
        })

        it('ne mute `connection.remotePeers` en place dans aucune source de production', () => {
            // Une mutation en place ne touche pas la clé `roomMembers[contextId]` : les
            // lecteurs qui la tracent — dont le computed de l'API publique — ne
            // s'invalideraient pas. Valeurs justes, écran figé.
            const mutation = /\.remotePeers\s*\.\s*(push|pop|shift|unshift|splice|sort|reverse|fill)\b/g
            const offenders = Object.entries(SOURCES)
                .filter(([, source]) => mutation.test(String(source)))
                .map(([path]) => path.replace('../', ''))

            expect(offenders).toEqual([])
        })

        it('n\'écrit la composition que par `computeRoomDiff` en production', () => {
            // La parenthèse ouvrante est obligatoire : sans elle, ce cas attrapait la
            // MENTION du verbe dans un commentaire de `createPeerContext` et désignait un
            // écrivain qui n'écrit rien. On cherche des appels.
            const writers = /peerStore\s*\.\s*(setRoomMembers|computeRoomDiff)\s*\(/g
            const found = new Map()

            for (const [path, source] of Object.entries(SOURCES)) {
                for (const match of String(source).matchAll(writers)) {
                    if (!found.has(match[1])) found.set(match[1], new Set())
                    found.get(match[1]).add(path.replace('../', ''))
                }
            }

            expect([...(found.get('computeRoomDiff') ?? [])]).toEqual(['Composables/usePeerConnections.js'])
            // `setRoomMembers` est un verbe de semis : aucun appelant de production. Le
            // teardown passe par `clearRoomMembers`, qui a une autre sémantique (l'entrée
            // disparaît, elle ne devient pas « room vide »).
            expect([...(found.get('setRoomMembers') ?? [])]).toEqual([])
        })
    })
})
