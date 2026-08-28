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
 * 1. **`resetPeerState` ne touche JAMAIS aux consommateurs** — un consommateur est un
 *    composant monté ; détruire le Peer n'en démonte aucun. Le reset les vidait, et comme
 *    l'ancien compteur était planché à 0, le démontage suivant d'un consommateur survivant
 *    rendait `0` : indistinguable de « le dernier vient de partir », donc une destruction
 *    était réarmée sur un Peer que d'autres utilisaient encore. D'où les jetons : le retrait
 *    d'un jeton inconnu rend `null`, et l'appelant teste `=== 0`.
 * 2. **une `Promise` traverse le state réactif sans être enveloppée** — Vue ne proxifie que
 *    les objets nus et les collections. Si ce n'était pas le cas, la garde d'init comparerait
 *    des identités différentes et `await` casserait.
 * 3. **une fonction non plus** — la closure de détachement des listeners du Peer doit garder
 *    son identité, et surtout ne jamais être nullée sans avoir été exécutée : elle est la
 *    seule référence vers les handlers d'un peer qu'on s'apprête à rendre inatteignable.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { usePeer2Store } from '~socializer/stores/peers2.js'
import { PEER_PHASES } from '~socializer/stores/peers2/phases.js'

describe('peers2 — runtime du Peer singleton', () => {
    let store

    beforeEach(() => {
        store = usePeer2Store()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    // ── La phase, et le sens de son contrôle de transitions ──────────────────────
    //
    // ⚠️ Ces trois cas épinglent une INVERSION délibérée par rapport à
    // `useCallStateMachine`, qui refuse une transition invalide et rend `false`. Là-bas, la
    // FSM arbitre des actions ; ici elle ne fait que SUIVRE le cycle de vie de PeerJS.
    // Refuser laisserait la phase décrire un peer qui n'existe plus — la divergence même
    // qu'elle supprime. Quiconque « corrigerait » ce contrôle en refus le fera rougir.
    describe('phase du Peer', () => {
        it('part de `absent`', () => {
            expect(store.peerPhase).toBe(PEER_PHASES.ABSENT)
        })

        it('enchaîne le cycle nominal sans rien journaliser', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

            store.markPeerCreating()
            store.markPeerConnecting()
            store.markPeerOpen('peer-alice')

            expect(store.peerPhase).toBe(PEER_PHASES.READY)
            // `markPeerOpen` porte les TROIS faits d'un `'open'`, pas seulement la phase.
            expect(store.lastLocalPeerId).toBe('peer-alice')
            expect(store.peerReconnectAttempts).toBe(0)
            expect(warn).not.toHaveBeenCalled()
        })

        it('APPLIQUE une transition inattendue, en la journalisant', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

            // `absent → ready` : aucun chemin du code ne le produit.
            store.markPeerOpen('peer-alice')

            expect(store.peerPhase).toBe(PEER_PHASES.READY)
            expect(warn).toHaveBeenCalledWith(expect.stringContaining('absent → ready'))
        })

        it('ne dit rien d\'une transition vers la phase courante', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
            store.markPeerCreating()

            store.markPeerCreating()

            expect(store.peerPhase).toBe(PEER_PHASES.CREATING)
            expect(warn).not.toHaveBeenCalled()
        })

        it('`reconnect()` ramène directement de `disconnected` à `ready`', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
            store.markPeerCreating()
            store.markPeerConnecting()
            store.markPeerOpen('peer-alice')

            store.markPeerDisconnected()
            store.markPeerOpen('peer-alice')

            // Le vrai `reconnect()` réutilise l'instance : il n'y a pas de retour par
            // `creating`, et le signaler ferait crier l'audit à chaque micro-coupure.
            expect(store.peerPhase).toBe(PEER_PHASES.READY)
            expect(warn).not.toHaveBeenCalled()
        })
    })

    describe('consommateurs par jeton', () => {
        it('compte les consommateurs et retourne le nouveau total', () => {
            const a = {}
            const b = {}
            expect(store.addPeerConsumer(a)).toBe(1)
            expect(store.addPeerConsumer(b)).toBe(2)
            expect(store.removePeerConsumer(a)).toBe(1)
            expect(store.peerConsumers.size).toBe(1)
        })

        it('est idempotent : le même jeton ne compte qu\'une fois', () => {
            const a = {}
            expect(store.addPeerConsumer(a)).toBe(1)
            expect(store.addPeerConsumer(a)).toBe(1)
        })

        it('rend `null` — et jamais 0 — pour un jeton inconnu', () => {
            // ⭐ LE contrat qui protège un Peer en service. `0` voudrait dire « le dernier
            // consommateur vient de partir » et l'appelant détruirait le Peer ; `null` dit
            // « ce jeton n'était pas inscrit, il n'y a rien à conclure ».
            const monté = {}
            store.addPeerConsumer(monté)

            expect(store.removePeerConsumer({})).toBeNull()
            expect(store.peerConsumers.size).toBe(1)
        })

        it('un retrait déjà effectué ne rend pas 0 une seconde fois', () => {
            const a = {}
            store.addPeerConsumer(a)
            expect(store.removePeerConsumer(a)).toBe(0)
            expect(store.removePeerConsumer(a)).toBeNull()
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

    describe('compteur de rafraîchissement ICE', () => {
        it('incrémente en retournant le numéro de tentative, et se remet à zéro', () => {
            // Compte les tentatives INFRUCTUEUSES de rafraîchissement du credential TURN. Il vit
            // ici, et pas dans une closure du transport, pour la raison de toute cette section : le
            // minuteur qu'il borne est armé pour des heures, donc il traverse des HMR.
            expect(store.incrementIceRefreshAttempts()).toBe(1)
            expect(store.incrementIceRefreshAttempts()).toBe(2)

            store.resetIceRefreshAttempts()

            expect(store.peerIceRefreshAttempts).toBe(0)
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

        it('annule réellement le rafraîchissement de la configuration ICE', () => {
            vi.useFakeTimers()
            const onFire = vi.fn()
            store.peerIceRefreshTimer = setTimeout(onFire, 1000)

            expect(store.clearIceRefreshTimer()).toBe(true)
            vi.advanceTimersByTime(5000)

            expect(onFire).not.toHaveBeenCalled()
            expect(store.peerIceRefreshTimer).toBeNull()
        })

        it('retourne false quand aucun timer n\'était armé', () => {
            // Le transport conditionne son log « destruction annulée » à ce retour : un
            // `true` complaisant annoncerait des annulations qui n'ont pas eu lieu.
            expect(store.clearPeerDestroyTimer()).toBe(false)
            expect(store.clearReconnectTimer()).toBe(false)
            expect(store.clearIceRefreshTimer()).toBe(false)
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
            store.markPeerCreating()
            store.markPeerConnecting()
            store.markPeerOpen('peer-alice')

            expect(() => store.resetPeerState()).not.toThrow()

            // Le try/catch vit dans l'action précisément pour ça : un `off()` qui jette ne
            // doit pas laisser le reset à mi-course — peer nullé mais phase encore `ready`
            // serait l'état impossible qui gèle `setLocalPeer` à vie.
            expect(store.localPeer).toBeNull()
            expect(store.peerPhase).toBe(PEER_PHASES.ABSENT)
            expect(store.peerListenersDetach).toBeNull()
            expect(warn).toHaveBeenCalled()
            warn.mockRestore()
        })
    })

    describe('resetPeerState', () => {
        /** Jetons des deux consommateurs « montés » du décor. */
        const consumerA = {}
        const consumerB = {}

        /** État d'un peer vivant, avec ses trois timers armés et ses listeners branchés. */
        const armLiveState = (onDestroyFire, onReconnectFire, onDetach = vi.fn(), onIceRefreshFire = vi.fn()) => {
            store.setPeerListenersDetach(onDetach)
            store.localPeer = { id: 'peer-alice' }
            // Le chemin complet des transitions, comme un vrai démarrage : `markPeerOpen`
            // publie aussi `lastLocalPeerId`.
            store.markPeerCreating()
            store.markPeerConnecting()
            store.markPeerOpen('peer-alice')
            store.setPeerInitPromise(Promise.resolve())
            store.incrementReconnectAttempts()
            store.incrementIceRefreshAttempts()
            store.addPeerConsumer(consumerA)
            store.addPeerConsumer(consumerB)
            store.peerDestroyTimer = setTimeout(onDestroyFire, 1000)
            store.peerReconnectTimer = setTimeout(onReconnectFire, 1000)
            store.peerIceRefreshTimer = setTimeout(onIceRefreshFire, 1000)
        }

        it('remet tout à zéro et annule les trois timers', () => {
            vi.useFakeTimers()
            const onDestroyFire = vi.fn()
            const onReconnectFire = vi.fn()
            const onIceRefreshFire = vi.fn()
            armLiveState(onDestroyFire, onReconnectFire, vi.fn(), onIceRefreshFire)

            store.resetPeerState()

            expect(store.localPeer).toBeNull()
            expect(store.peerPhase).toBe(PEER_PHASES.ABSENT)
            expect(store.lastLocalPeerId).toBeNull()
            expect(store.peerInitPromise).toBeNull()
            expect(store.peerReconnectAttempts).toBe(0)
            expect(store.peerIceRefreshAttempts).toBe(0)

            vi.advanceTimersByTime(5000)
            expect(onDestroyFire).not.toHaveBeenCalled()
            expect(onReconnectFire).not.toHaveBeenCalled()
            // ⭐ Le troisième compte autant que les deux autres, et pour une raison qui lui est
            // propre : il est armé pour des HEURES (le TTL du credential TURN, moins la marge). Un
            // minuteur de destruction oublié se réveille au bout de 10 s sur un store déjà propre ;
            // celui-ci se réveillerait le lendemain pour interroger `/get-ice-servers` au nom d'un
            // `Peer` que plus rien ne référence, sur un onglet qui n'a peut-être plus aucun
            // contexte WebRTC monté.
            expect(onIceRefreshFire).not.toHaveBeenCalled()
            expect(store.peerIceRefreshTimer).toBeNull()
        })

        it('préserve les consommateurs — INCONDITIONNELLEMENT', () => {
            vi.useFakeTimers()
            armLiveState(vi.fn(), vi.fn())

            store.resetPeerState()

            // ⭐ Le cœur de la contrainte, et il n'a plus d'option : les deux consommateurs
            // sont TOUJOURS montés — détruire un Peer ne démonte aucun composant. Le reste
            // de l'état, lui, est bien purgé.
            //
            // Quand ce reset les vidait, le démontage suivant d'un survivant rendait `0` sur
            // un compteur planché, l'appelant lisait « plus personne » et réarmait une
            // destruction sur un Peer encore utilisé par les autres.
            expect(store.peerConsumers.size).toBe(2)
            expect(store.peerInitPromise).toBeNull()
            expect(store.peerReconnectAttempts).toBe(0)
            expect(store.peerDestroyTimer).toBeNull()
            expect(store.peerReconnectTimer).toBeNull()

            expect(store.removePeerConsumer(consumerA)).toBe(1)
            expect(store.removePeerConsumer(consumerB)).toBe(0)
        })

        it('détache les listeners du Peer même quand le peer est déjà absent', () => {
            vi.useFakeTimers()
            const onDetach = vi.fn()
            armLiveState(vi.fn(), vi.fn(), onDetach)

            store.resetPeerState()

            // Ce chemin est celui de l'early-return de `_destroyPeerSingleton` (peer déjà
            // absent après un échec d'init) : rien d'autre n'exécute la closure là-bas, et
            // sans elle les listeners resteraient branchés sur un Peer orphelin devenu
            // inatteignable — plus aucune référence pour les `off`.
            expect(onDetach).toHaveBeenCalledOnce()
            expect(store.peerListenersDetach).toBeNull()
        })
    })
})
