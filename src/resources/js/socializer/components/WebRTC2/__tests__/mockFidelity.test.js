/**
 * mockFidelity.test.js — Le mock du store ment-il ?
 *
 * Ce package a déjà été mordu **deux fois** par un mock désynchronisé du store réel :
 *
 * 1. `createMockContext` ne fournissait pas cinq méthodes appelées par
 *    `usePeerConnections`, et enveloppait `getConnections` dans un `computed()` alors
 *    que les getters Pinia sont auto-déballés → `hasOpenConnection` renvoyait
 *    *toujours* `false`. Faux négatif silencieux.
 * 2. Un correctif **inerte en production** avait un test **vert**, parce que le mock
 *    fournissait une information que le vrai store ne peut pas donner.
 *
 * Un mock qui ment ne fait pas échouer un test : il le fait réussir pour la mauvaise
 * raison. C'est la panne la plus coûteuse du projet, parce qu'elle détruit la confiance
 * dans la totalité de la suite.
 *
 * Ce fichier vérifie mécaniquement, sans rien maintenir à la main, que :
 *   a) tout `peerStore.X` réellement appelé par le code de production existe sur le
 *      **vrai** store ET sur le **mock** ;
 *   b) le mock n'invente pas d'API absente du vrai store.
 */
import { describe, it, expect } from 'vitest'
import { usePeer2Store } from '~socializer/stores/peers2.js'
import { createMockContext } from './helpers/createMockContext.js'

// Sources de production du module (jamais les tests ni les helpers).
const SOURCES = import.meta.glob(
    ['../Composables/**/*.js', '../Widgets/**/*.js', '../Widgets/**/*.vue'],
    { query: '?raw', import: 'default', eager: true }
)

/**
 * Membres du peerStore réellement consommés par le code de production.
 * On capture `peerStore.X` et `ctx.peerStore.X` — les deux formes utilisées.
 */
const collectUsedMembers = () => {
    const used = new Map() // nom → fichiers où il apparaît
    const pattern = /\bpeerStore\s*\.\s*([A-Za-z_$][\w$]*)/g

    for (const [path, source] of Object.entries(SOURCES)) {
        for (const match of String(source).matchAll(pattern)) {
            const member = match[1]
            if (!used.has(member)) used.set(member, new Set())
            used.get(member).add(path.replace('../', ''))
        }
    }
    return used
}

describe('fidélité du mock de store', () => {
    const used = collectUsedMembers()
    const realStore = () => usePeer2Store()

    it('capture bien des usages (le collecteur lui-même n\'est pas inerte)', () => {
        // Sans cette garde, une regex cassée rendrait TOUS les tests suivants verts
        // en n'ayant rien à vérifier — exactement le mode de panne qu'on traque ici.
        expect(Object.keys(SOURCES).length).toBeGreaterThan(5)
        expect(used.size).toBeGreaterThan(10)
        expect([...used.keys()]).toContain('getConnections')
    })

    it('tout membre consommé par la production existe sur le vrai store', () => {
        const store = realStore()
        const missing = [...used.entries()]
            .filter(([member]) => !(member in store))
            .map(([member, files]) => `${member} (${[...files].join(', ')})`)

        expect(missing).toEqual([])
    })

    it('tout membre consommé par la production existe aussi sur le mock', () => {
        const mockStore = createMockContext().peerStore
        const missing = [...used.entries()]
            .filter(([member]) => !(member in mockStore))
            .map(([member, files]) => `${member} (${[...files].join(', ')})`)

        // C'est ce contrôle qui aurait attrapé les cinq méthodes manquantes
        // (hasWaitingRemotePeerId, hasRemotePeerId, prepareRoomConnection,
        // storePeerConnection, closePeerConnection) avant qu'elles ne produisent
        // un faux négatif silencieux.
        expect(missing).toEqual([])
    })

    it("le mock n'invente aucune API absente du vrai store", () => {
        const store = realStore()
        const mockStore = createMockContext().peerStore

        // Helpers de test assumés, déclarés ici pour qu'on ne les confonde jamais avec
        // l'API du store. `addPeerConnectionInstance` est un raccourci de
        // `prepareRoomConnection` + `storePeerConnection` produisant la même structure ;
        // les deux autres pilotent la file de signaux.
        const TEST_ONLY = new Set([
            'addPeerConnectionInstance',
            '_pushSignal',
            '_clearSignals',
        ])

        const invented = Object.keys(mockStore)
            .filter((key) => !TEST_ONLY.has(key) && !(key in store))

        expect(invented).toEqual([])
    })

    it('getConnections est lu sans `.value` — donc jamais enveloppé dans un computed', () => {
        const mockStore = createMockContext().peerStore

        // Les getters Pinia sont auto-déballés et le code lit
        // `ctx.peerStore.getConnections?.[room]` SANS `.value`. Enveloppé dans un
        // `computed()`, tout accès retournait `undefined` → `hasOpenConnection`
        // systématiquement false. Le piège est invisible à la lecture : on le fige.
        expect(mockStore.getConnections).toBeTypeOf('object')
        expect(mockStore.getConnections).not.toHaveProperty('value')
    })
})
