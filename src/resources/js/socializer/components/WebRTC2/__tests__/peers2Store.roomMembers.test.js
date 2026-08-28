/**
 * peers2Store.roomMembers.test.js
 *
 * `roomMembers[contextId]` est LA composition des rooms de l'onglet — pas une projection.
 * `ctx.connection.remotePeers` n'est qu'un accesseur en lecture seule au-dessus d'elle,
 * ce qui fait de cette entrée deux choses à la fois :
 *
 *   - le prédicat qui autorise à oublier un peerId (`isUserInAnyRoom`, balayage de TOUS
 *     les contextes) — figé par `peers2Store.remotePeerId.test.js`, pas ici ;
 *   - l'allowlist du chemin (a) des DEUX gardes d'autorisation (lecture d'UN contexte,
 *     via `getRoomMembers`).
 *
 * Ce fichier épingle le CÔTÉ STORE, sur une vraie Pinia. C'est l'autre moitié obligatoire
 * du contrôle : `usePeerConnections.test.js` exerce le même contrat contre le double, et
 * ne prouverait donc que le double si personne ne venait vérifier l'original
 * (docs/architecture/tests.md#pièges-de-mock).
 *
 * Trois invariants tiennent tout le reste :
 *
 * 1. `computeRoomDiff` est SYNCHRONE et atomique — lire, calculer, écrire sans point de
 *    suspension. C'est ce qui a permis de retirer le mutex `_diffLock` qui sérialisait
 *    autrefois un couple lecture-puis-écriture dans `usePeerConnections`.
 * 2. Il écrit à TOUS les tours, y compris un tour vide : c'est le seul tour qui puisse
 *    rendre le dernier partant purgeable.
 * 3. Il RÉAFFECTE le tableau, il ne le mute jamais — les lecteurs tracent la clé, et une
 *    mutation en place ne l'invaliderait pas.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { effect, computed } from 'vue'
import { usePeer2Store } from '~socializer/stores/peers2.js'
import { EMPTY_MEMBERS } from '~socializer/stores/peers2/roomDiff.js'

const CTX = 'stream-room-test'
const OTHER_CTX = 'data-app'

describe('peers2 — composition des rooms', () => {
    let store

    beforeEach(() => {
        store = usePeer2Store()
    })

    describe('getRoomMembers', () => {
        it('rend la composition déclarée par CE contexte', () => {
            store.setRoomMembers(CTX, ['alice', 'bob'])

            expect(store.getRoomMembers(CTX)).toEqual(['alice', 'bob'])
        })

        // Tous les lecteurs itèrent ou filtrent le résultat sans garde : `undefined` les
        // ferait lever, et un `[]` neuf par lecture réveillerait un `watch` à chaque tour.
        it('rend une composition vide, gelée et d\'identité stable, pour un contexte muet', () => {
            expect(store.getRoomMembers('jamais-declare')).toBe(EMPTY_MEMBERS)
            expect(Object.isFrozen(store.getRoomMembers('jamais-declare'))).toBe(true)
            expect(store.getRoomMembers('jamais-declare')).toBe(store.getRoomMembers('autre-muet'))
        })

        it('rend une composition vide sans contextId, plutôt que de lever', () => {
            expect(store.getRoomMembers(undefined)).toEqual([])
            expect(store.getRoomMembers(null)).toEqual([])
        })

        // La règle de granularité du store : chaque entrée est indexée à la granularité du
        // FAIT qu'elle décrit. « X est présent dans ma room » est un fait par CONTEXTE —
        // s'en écarter ne lève pas, ça fait lire à un contexte la composition d'un autre.
        it('isole deux contextes du même onglet', () => {
            store.setRoomMembers(CTX, ['alice'])

            expect(store.getRoomMembers(OTHER_CTX)).toEqual([])
        })

        // Le store copie à l'écriture : le tableau de l'appelant ne devient pas l'état.
        it('ne partage pas le tableau de l\'appelant', () => {
            const seed = ['alice']
            store.setRoomMembers(CTX, seed)
            seed.push('mallory')

            expect(store.getRoomMembers(CTX)).toEqual(['alice'])
        })
    })

    describe('computeRoomDiff', () => {
        it('rend toute la liste comme arrivante au premier tour', () => {
            const diff = store.computeRoomDiff(CTX, ['alice', 'bob'])

            expect(diff).toEqual({ newSlugs: ['alice', 'bob'], removedSlugs: [] })
            expect(store.getRoomMembers(CTX)).toEqual(['alice', 'bob'])
        })

        it('ne rend arrivant que ce qui n\'était pas là', () => {
            store.computeRoomDiff(CTX, ['alice'])

            const diff = store.computeRoomDiff(CTX, ['alice', 'bob'])

            expect(diff).toEqual({ newSlugs: ['bob'], removedSlugs: [] })
            expect(store.getRoomMembers(CTX)).toEqual(['alice', 'bob'])
        })

        it('rend partant ce qui a disparu de la liste', () => {
            store.computeRoomDiff(CTX, ['alice', 'bob'])

            const diff = store.computeRoomDiff(CTX, ['alice'])

            expect(diff).toEqual({ newSlugs: [], removedSlugs: ['bob'] })
            expect(store.getRoomMembers(CTX)).toEqual(['alice'])
        })

        it('rend une arrivée et un départ dans le même tour', () => {
            store.computeRoomDiff(CTX, ['alice', 'bob'])

            const diff = store.computeRoomDiff(CTX, ['bob', 'carol'])

            expect(diff).toEqual({ newSlugs: ['carol'], removedSlugs: ['alice'] })
        })

        // Le tour vide n'est pas un cas dégénéré : c'est le SEUL qui puisse rendre le
        // dernier partant, donc le seul qui rende son peerId oubliable.
        it('purge la room sur un tour vide et rend tous les membres partants', () => {
            store.computeRoomDiff(CTX, ['alice', 'bob'])

            const diff = store.computeRoomDiff(CTX, [])

            expect(diff).toEqual({ newSlugs: [], removedSlugs: ['alice', 'bob'] })
            expect(store.getRoomMembers(CTX)).toEqual([])
        })

        it('ne rend rien sur un tour identique au précédent', () => {
            store.computeRoomDiff(CTX, ['alice'])

            expect(store.computeRoomDiff(CTX, ['alice'])).toEqual({ newSlugs: [], removedSlugs: [] })
        })

        it('n\'écrit rien et ne lève pas sans contextId', () => {
            expect(store.computeRoomDiff(null, ['alice'])).toEqual({ newSlugs: [], removedSlugs: [] })
            expect(store.roomMembers).toEqual({})
        })

        it('traite une liste non tableau comme une room vide', () => {
            store.computeRoomDiff(CTX, ['alice'])

            const diff = store.computeRoomDiff(CTX, undefined)

            expect(diff).toEqual({ newSlugs: [], removedSlugs: ['alice'] })
            expect(store.getRoomMembers(CTX)).toEqual([])
        })

        it('ne touche pas la composition des autres contextes', () => {
            store.setRoomMembers(OTHER_CTX, ['bob'])

            store.computeRoomDiff(CTX, ['alice'])

            expect(store.getRoomMembers(OTHER_CTX)).toEqual(['bob'])
        })

        // L'atomicité que le mutex garantissait autrefois est désormais structurelle : un
        // seul appel synchrone, donc aucune fenêtre entre la lecture et l'écriture. La
        // contre-épreuve est la séquence qui rougissait sans verrou quand les deux moitiés
        // étaient séparées — le second tour doit voir ce que le premier a écrit.
        it('sérialise deux tours consécutifs sans verrou', () => {
            const first = store.computeRoomDiff(CTX, ['alice'])
            const second = store.computeRoomDiff(CTX, ['alice', 'bob'])

            expect(first.newSlugs).toEqual(['alice'])
            expect(second.newSlugs).toEqual(['bob'])
            expect(store.getRoomMembers(CTX)).toEqual(['alice', 'bob'])
        })

        it('ne partage pas le tableau de l\'appelant', () => {
            const next = ['alice']
            store.computeRoomDiff(CTX, next)
            next.push('mallory')

            expect(store.getRoomMembers(CTX)).toEqual(['alice'])
        })
    })

    describe('clearRoomMembers', () => {
        it('rend le contexte muet, et non pas déclarant une room vide', () => {
            store.setRoomMembers(CTX, ['alice'])

            store.clearRoomMembers(CTX)

            expect(store.getRoomMembers(CTX)).toBe(EMPTY_MEMBERS)
            expect(CTX in store.roomMembers).toBe(false)
        })
    })

    // ── Réactivité ────────────────────────────────────────────────────────────────
    //
    // C'est la moitié du contrat que les assertions de valeur ne peuvent pas voir :
    // `connection.remotePeers` est un accesseur, donc TOUS ses lecteurs tracent la clé
    // `roomMembers[contextId]`. Un jour où une écriture muterait le tableau en place au
    // lieu de le réaffecter, les valeurs resteraient justes et l'écran ne bougerait plus.
    describe('réactivité de la composition', () => {
        it('invalide un lecteur à la première déclaration, clé encore absente', () => {
            let runs = 0
            const members = computed(() => store.getRoomMembers(CTX))
            effect(() => { runs += 1; void members.value })

            expect(runs).toBe(1)

            store.computeRoomDiff(CTX, ['alice'])

            expect(members.value).toEqual(['alice'])
            expect(runs).toBe(2)
        })

        it('invalide un lecteur à chaque tour qui change la composition', () => {
            store.computeRoomDiff(CTX, ['alice'])

            let runs = 0
            const count = computed(() => store.getRoomMembers(CTX).length)
            effect(() => { runs += 1; void count.value })

            store.computeRoomDiff(CTX, ['alice', 'bob'])
            expect(runs).toBe(2)

            store.computeRoomDiff(CTX, [])
            expect(runs).toBe(3)
        })

        it('invalide un lecteur à la purge du contexte', () => {
            store.setRoomMembers(CTX, ['alice'])

            let runs = 0
            const count = computed(() => store.getRoomMembers(CTX).length)
            effect(() => { runs += 1; void count.value })

            store.clearRoomMembers(CTX)

            expect(runs).toBe(2)
            expect(count.value).toBe(0)
        })
    })
})
