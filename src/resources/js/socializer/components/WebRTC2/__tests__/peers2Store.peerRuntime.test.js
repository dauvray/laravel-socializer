/**
 * peers2Store.peerRuntime.test.js — Runtime du Peer singleton dans le store
 *
 * Ref-counting, garde d'init, compteur de reconnexion et handles des deux timers vivaient
 * au niveau du module ES de `usePeerTransport`. Le module et le store n'ayant pas la même
 * durée de vie (HMR : module rechargé, store conservé), les compteurs se désynchronisaient
 * de l'état réel du peer — un peer encore utilisé finissait détruit.
 *
 * Deux contrats sont figés ici parce qu'ils sont invisibles à la lecture :
 *
 * 1. **`resetPeerState({ keepConsumerCount: true })`** — la destruction survenant alors que
 *    `localPeer` est déjà absent (échec d'init) ne doit PAS remettre le compteur à zéro :
 *    les consommateurs encore montés décrémentent normalement jusqu'à 0, sinon un retry
 *    repartirait d'un compte faux et pourrait détruire un peer valide.
 * 2. **une `Promise` traverse le state réactif sans être enveloppée** — Vue ne proxifie que
 *    les objets nus et les collections. Si ce n'était pas le cas, la garde d'init comparerait
 *    des identités différentes et `await` casserait.
 * 3. **une fonction non plus** — la closure de détachement des listeners du Peer doit garder
 *    son identité, et surtout ne jamais être nullée sans avoir été exécutée : elle est la
 *    seule référence vers les handlers d'un peer qu'on s'apprête à rendre inatteignable.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { usePeer2Store } from '~socializer/stores/peers2.js'

describe('peers2 — runtime du Peer singleton', () => {
    let store

    beforeEach(() => {
        store = usePeer2Store()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    describe('ref-counting des consommateurs', () => {
        it('compte les consommateurs et retourne le nouveau total', () => {
            expect(store.addPeerConsumer()).toBe(1)
            expect(store.addPeerConsumer()).toBe(2)
            expect(store.removePeerConsumer()).toBe(1)
            expect(store.peerConsumerCount).toBe(1)
        })

        it('ne descend jamais sous zéro', () => {
            // Un décrément orphelin (démontage sans enregistrement) ne doit pas rendre le
            // compteur négatif : la destruction du peer ne serait plus planifiée au bon
            // moment pour les consommateurs suivants.
            expect(store.removePeerConsumer()).toBe(0)
            expect(store.removePeerConsumer()).toBe(0)

            expect(store.addPeerConsumer()).toBe(1)
        })
    })

    describe('garde d\'initialisation', () => {
        it('conserve la promesse telle quelle (ni proxy réactif, ni copie)', async () => {
            const promise = Promise.resolve('ok')

            store.setPeerInitPromise(promise)

            // Identité stricte : c'est ce dont dépend le `finally` du transport, qui ne
            // nettoie la garde que si elle est toujours la sienne.
            expect(store.peerInitPromise).toBe(promise)
            await expect(store.peerInitPromise).resolves.toBe('ok')
        })

        it('se libère avec un argument vide', () => {
            store.setPeerInitPromise(Promise.resolve())
            store.setPeerInitPromise()

            expect(store.peerInitPromise).toBeNull()
        })
    })

    describe('compteur de reconnexion', () => {
        it('incrémente en retournant le numéro de tentative, et se remet à zéro', () => {
            expect(store.incrementReconnectAttempts()).toBe(1)
            expect(store.incrementReconnectAttempts()).toBe(2)

            store.resetReconnectAttempts()

            expect(store.peerReconnectAttempts).toBe(0)
        })
    })

    describe('annulation des timers', () => {
        it('annule réellement la destruction différée et signale l\'annulation', () => {
            vi.useFakeTimers()
            const onFire = vi.fn()
            store.peerDestroyTimer = setTimeout(onFire, 1000)

            expect(store.clearPeerDestroyTimer()).toBe(true)
            vi.advanceTimersByTime(5000)

            expect(onFire).not.toHaveBeenCalled()
            expect(store.peerDestroyTimer).toBeNull()
        })

        it('annule réellement le backoff de reconnexion', () => {
            vi.useFakeTimers()
            const onFire = vi.fn()
            store.peerReconnectTimer = setTimeout(onFire, 1000)

            expect(store.clearReconnectTimer()).toBe(true)
            vi.advanceTimersByTime(5000)

            expect(onFire).not.toHaveBeenCalled()
            expect(store.peerReconnectTimer).toBeNull()
        })

        it('retourne false quand aucun timer n\'était armé', () => {
            // Le transport conditionne son log « destruction annulée » à ce retour : un
            // `true` complaisant annoncerait des annulations qui n'ont pas eu lieu.
            expect(store.clearPeerDestroyTimer()).toBe(false)
            expect(store.clearReconnectTimer()).toBe(false)
        })
    })

    describe('détachement des listeners du Peer', () => {
        it('conserve la closure telle quelle (une fonction n\'est jamais proxifiée)', () => {
            const detach = () => {}

            store.setPeerListenersDetach(detach)

            // 3e colonne du tableau maison : la `Promise` traverse le state sans `markRaw`
            // (ci-dessus), un handle de timer est un objet côté Node donc annulé via `toRaw`,
            // et une **fonction** n'est pas proxifiée non plus (`isObject` de `@vue/shared`
            // exige `typeof === 'object'`). C'est ce qui permet à `peer.off(event, handler)`
            // de retrouver ses handlers par identité — sinon le détachement serait inerte.
            expect(store.peerListenersDetach).toBe(detach)
        })

        it('exécute puis oublie la closure', () => {
            const detach = vi.fn()
            store.setPeerListenersDetach(detach)

            expect(store.detachPeerListeners()).toBe(true)
            // Idempotent : une destruction différée suivie d'un reset ne doit pas rejouer les
            // `off` sur une instance déjà détruite.
            expect(store.detachPeerListeners()).toBe(false)

            expect(detach).toHaveBeenCalledOnce()
            expect(store.peerListenersDetach).toBeNull()
        })

        it('exécute la closure en place avant de la remplacer', () => {
            const first = vi.fn()
            const second = vi.fn()

            store.setPeerListenersDetach(first)
            store.setPeerListenersDetach(second)

            // Sans ça, une init repartant derrière un Peer orphelin (un `destroy()` qui a
            // jeté laisse `destroyed === false`) jetterait le seul moyen de débrancher ses
            // listeners : ils écriraient à vie dans un store décrivant un AUTRE peer.
            expect(first).toHaveBeenCalledOnce()
            expect(second).not.toHaveBeenCalled()
            expect(store.peerListenersDetach).toBe(second)
        })

        it('une closure qui jette n\'interrompt pas le reset', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
            store.setPeerListenersDetach(() => { throw new Error('off a jeté') })
            store.localPeer = { id: 'peer-alice' }
            store.localPeerReady = true

            expect(() => store.resetPeerState()).not.toThrow()

            // Le try/catch vit dans l'action précisément pour ça : un `off()` qui jette ne
            // doit pas laisser le reset à mi-course — peer nullé mais drapeaux encore vrais
            // serait l'état impossible qui gèle `setLocalPeer` à vie.
            expect(store.localPeer).toBeNull()
            expect(store.localPeerReady).toBe(false)
            expect(store.peerListenersDetach).toBeNull()
            expect(warn).toHaveBeenCalled()
            warn.mockRestore()
        })
    })

    describe('resetPeerState', () => {
        /** État d'un peer vivant, avec deux timers armés et ses listeners branchés. */
        const armLiveState = (onDestroyFire, onReconnectFire, onDetach = vi.fn()) => {
            store.setPeerListenersDetach(onDetach)
            store.localPeer = { id: 'peer-alice' }
            store.localPeerReady = true
            store.lastLocalPeerId = 'peer-alice'
            store.setPeerInitPromise(Promise.resolve())
            store.incrementReconnectAttempts()
            store.addPeerConsumer()
            store.addPeerConsumer()
            store.peerDestroyTimer = setTimeout(onDestroyFire, 1000)
            store.peerReconnectTimer = setTimeout(onReconnectFire, 1000)
        }

        it('remet tout à zéro et annule les deux timers', () => {
            vi.useFakeTimers()
            const onDestroyFire = vi.fn()
            const onReconnectFire = vi.fn()
            armLiveState(onDestroyFire, onReconnectFire)

            store.resetPeerState()

            expect(store.localPeer).toBeNull()
            expect(store.localPeerReady).toBe(false)
            expect(store.lastLocalPeerId).toBeNull()
            expect(store.peerInitPromise).toBeNull()
            expect(store.peerReconnectAttempts).toBe(0)
            expect(store.peerConsumerCount).toBe(0)

            vi.advanceTimersByTime(5000)
            expect(onDestroyFire).not.toHaveBeenCalled()
            expect(onReconnectFire).not.toHaveBeenCalled()
        })

        it('préserve le compteur de consommateurs avec keepConsumerCount', () => {
            vi.useFakeTimers()
            armLiveState(vi.fn(), vi.fn())

            store.resetPeerState({ keepConsumerCount: true })

            // ⚠️ Le cœur de la contrainte : les deux consommateurs sont toujours montés,
            // leurs onUnmounted doivent pouvoir décrémenter jusqu'à 0 pour qu'un retry
            // reparte d'un compte juste. Le reste de l'état, lui, est bien purgé.
            expect(store.peerConsumerCount).toBe(2)
            expect(store.peerInitPromise).toBeNull()
            expect(store.peerReconnectAttempts).toBe(0)
            expect(store.peerDestroyTimer).toBeNull()
            expect(store.peerReconnectTimer).toBeNull()

            expect(store.removePeerConsumer()).toBe(1)
            expect(store.removePeerConsumer()).toBe(0)
        })

        it('détache les listeners du Peer, y compris avec keepConsumerCount', () => {
            vi.useFakeTimers()
            const onDetach = vi.fn()
            armLiveState(vi.fn(), vi.fn(), onDetach)

            store.resetPeerState({ keepConsumerCount: true })

            // Ce chemin est celui de l'early-return de `_destroyPeerSingleton` (peer déjà
            // absent après un échec d'init) : rien d'autre n'exécute la closure là-bas, et
            // sans elle les listeners resteraient branchés sur un Peer orphelin devenu
            // inatteignable — plus aucune référence pour les `off`.
            expect(onDetach).toHaveBeenCalledOnce()
            expect(store.peerListenersDetach).toBeNull()
        })
    })
})
