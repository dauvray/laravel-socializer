/**
 * peers2Store.contextRegistry.test.js
 *
 * `contextRegistry` est la clé de routage des connexions ENTRANTES : les dispatchers du
 * Peer singleton (`bind('connection')`, `bind('call')`, `bind('error')`) sont des closures
 * qui le consultent pour retrouver le contexte destinataire. Un contexte absent du registre
 * ne reçoit rien — et la connexion est fermée, pas mise en attente.
 *
 * Ce fichier épingle le CÔTÉ STORE, sur une vraie Pinia. Le côté transport (qui inscrit,
 * qui retire, et quand) est dans `usePeerTransport.singleton.test.js` : les deux moitiés
 * sont obligatoires, parce que le double de `createMockContext` porte lui aussi les deux
 * gardes — neutraliser l'original le laisserait vert
 * (docs/architecture/tests.md#pièges-de-mock).
 *
 * Trois propriétés tiennent tout le reste, et aucune n'est intuitive :
 *
 * 1. Le registre est `markRaw`. Vue proxifie les Map : sans lui, `get()` rendrait un proxy
 *    réactif et non l'objet de contexte lui-même, ce qui casserait les DEUX comparaisons
 *    d'identité qui en dépendent (`unregisterContext` et `_isAuthorizedIncomingPeer`).
 * 2. `registerContext` est last-write-wins VOLONTAIRE, et `unregisterContext` porte le
 *    garde qui le rend vivable : un contexte qui se démonte n'efface pas l'entrée de son
 *    remplaçant.
 * 3. `resetPeerState` NE le vide PAS : détruire le Peer ne démonte aucun contexte.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { usePeer2Store } from '~socializer/stores/peers2.js'

const CTX_ID = 'stream-room-test'
const OTHER_ID = 'data-app'

// Le registre ne lit que `contextId` et l'identité de référence. Un `createMockContext()`
// complet ferait croire à une dépendance que le store n'a pas.
const fakeCtx = (contextId, tag = null) => ({ contextId, tag })

describe('peers2 — registre des contextes montés', () => {
    let store

    beforeEach(() => {
        store = usePeer2Store()
    })

    describe('inscription', () => {
        it('inscrit un contexte sous son contextId', () => {
            const ctx = fakeCtx(CTX_ID)

            store.registerContext(ctx)

            expect(store.getContextById(CTX_ID)).toBe(ctx)
            expect(store.contextRegistry.size).toBe(1)
        })

        // LE cas du fichier. `markRaw` (state.js) est ce qui fait que le registre rend
        // l'objet et non un proxy — et c'est de cette identité que dépendent le garde de
        // `unregisterContext` ci-dessous et celui d'`_isAuthorizedIncomingPeer`. Sans ce
        // cas, le `markRaw` peut sauter sans qu'aucune suite ne bouge.
        it('rend l\'objet LUI-MÊME, jamais un proxy réactif', () => {
            const ctx = fakeCtx(CTX_ID)

            store.registerContext(ctx)

            expect(store.getContextById(CTX_ID)).toBe(ctx)
            expect(store.getRegisteredContexts()[0]).toBe(ctx)
        })

        it('ignore une inscription sans contextId, plutôt que de lever', () => {
            store.registerContext(null)
            store.registerContext(undefined)
            store.registerContext({})
            store.registerContext({ contextId: '' })

            expect(store.contextRegistry.size).toBe(0)
        })

        it('rend null pour un id jamais inscrit, et sans id', () => {
            expect(store.getContextById('jamais-inscrit')).toBe(null)
            expect(store.getContextById(undefined)).toBe(null)
            expect(store.getContextById(null)).toBe(null)
        })
    })

    describe('remontage sous le même id', () => {
        // Last-write-wins volontaire : un contexte remonté (navigation SPA, HMR) reprend
        // l'id de celui qui se démonte, et c'est LUI qui doit recevoir les entrants.
        it('le dernier inscrit prend la place du précédent', () => {
            const ancien = fakeCtx(CTX_ID, 'ancien')
            const neuf = fakeCtx(CTX_ID, 'neuf')

            store.registerContext(ancien)
            store.registerContext(neuf)

            expect(store.getContextById(CTX_ID)).toBe(neuf)
            expect(store.contextRegistry.size).toBe(1)
        })

        // Le garde d'identité d'`unregisterContext`. Sans lui, l'`onUnmounted` du mourant
        // — qui s'exécute APRÈS le montage du remplaçant — effacerait l'entrée du vivant,
        // qui ne recevrait plus aucune connexion entrante. Panne silencieuse et durable :
        // rien ne lève, les entrants sont simplement fermés.
        it('le contexte qui se démonte n\'efface pas l\'entrée de son remplaçant', () => {
            const mourant = fakeCtx(CTX_ID, 'mourant')
            const vivant = fakeCtx(CTX_ID, 'vivant')

            store.registerContext(mourant)
            store.registerContext(vivant)
            store.unregisterContext(mourant)

            expect(store.getContextById(CTX_ID)).toBe(vivant)
        })

        // Contre-épreuve du cas précédent : sans elle, un garde qui ne retirerait JAMAIS
        // rien passerait les deux.
        it('retire bien l\'entrée quand elle lui appartient encore', () => {
            const ctx = fakeCtx(CTX_ID)

            store.registerContext(ctx)
            store.unregisterContext(ctx)

            expect(store.getContextById(CTX_ID)).toBe(null)
            expect(store.contextRegistry.size).toBe(0)
        })

        it('ignore un retrait sans contextId, plutôt que de lever', () => {
            store.registerContext(fakeCtx(CTX_ID))

            store.unregisterContext(null)
            store.unregisterContext({})

            expect(store.contextRegistry.size).toBe(1)
        })
    })

    describe('durée de vie', () => {
        // Un contexte monté survit à la destruction et à la recréation du Peer : détruire
        // le Peer ne démonte personne. Vider le registre ici rendrait le Peer neuf sourd à
        // tous les contextes déjà en place.
        it('survit à `resetPeerState` — détruire le Peer ne démonte aucun contexte', () => {
            const ctx = fakeCtx(CTX_ID)
            store.registerContext(ctx)

            store.resetPeerState()

            expect(store.getContextById(CTX_ID)).toBe(ctx)
        })
    })

    describe('getRegisteredContexts', () => {
        // ⚠️ Honnêteté sur le contrôle négatif : convertir ce getter curryfié en getter
        // simple fait rougir par `TypeError: not a function`, pas par une valeur périmée.
        // Le cache d'un `computed` sur une Map `markRaw` est réel (c'est la raison écrite
        // dans getters.js), mais il n'est observable qu'en adaptant aussi les appelants.
        // Ce cas vérifie donc la RELECTURE, pas le mode de panne qui l'a motivée.
        it('relit le registre à chaque appel', () => {
            store.registerContext(fakeCtx(CTX_ID))
            expect(store.getRegisteredContexts()).toHaveLength(1)

            store.registerContext(fakeCtx(OTHER_ID))
            expect(store.getRegisteredContexts()).toHaveLength(2)
        })

        // Instantané volontaire : la recovery `peer-unavailable` mute le store EN itérant
        // (invalidation d'un peerId, purge de connexions). Itérer la Map elle-même
        // exposerait ces mutations à l'itérateur.
        it('rend un instantané : muter le tableau rendu ne touche pas le registre', () => {
            const ctx = fakeCtx(CTX_ID)
            store.registerContext(ctx)

            const snapshot = store.getRegisteredContexts()
            snapshot.pop()

            expect(snapshot).toHaveLength(0)
            expect(store.getRegisteredContexts()).toHaveLength(1)
            expect(store.getContextById(CTX_ID)).toBe(ctx)
        })

        it('rend un tableau vide quand aucun contexte n\'est monté', () => {
            expect(store.getRegisteredContexts()).toEqual([])
        })
    })
})
