/**
 * Notifications.test.js — câblage des signaux d'appel entrants
 *
 * Ce composant est le SEUL destinataire de `.ResponseToAuthorizationPeer` : la réponse
 * (acceptation ou refus) d'un pair invité n'arrive nulle part ailleurs. Ce qu'on garde
 * ici n'est donc pas la logique d'appel — elle vit dans `useCallManager` et y est testée
 * — mais le fait que ce composant la LAISSE s'exécuter.
 *
 * Régression couverte : un refus sortait par un `return` après le toast « injoignable »,
 * sans jamais appeler `openCallBetweenPeer`. Or sa branche `!status` est la seule qui
 * retire le participant et ramène la FSM à IDLE. L'appelant restait donc en 'calling',
 * spinner de CallManagerBtn compris, jusqu'au rechargement de la page — y compris sur
 * l'auto-refus émis par VideoCallAlert au bout de 10 s sans réponse.
 *
 * Deuxième régression, le même symptôme par l'autre bout : quand le destinataire n'a
 * AUCUN onglet ouvert, il n'y a pas de refus à recevoir. Le seul événement disponible est
 * l'abandon du moteur de retry, remonté par `ctx.inviteAbandonedSignal` — ce composant est
 * son unique consommateur, et il en rejoue le chemin du refus.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createCallPeersDouble } from './helpers/createCallPeersDouble.js'

// ─── Doubles ─────────────────────────────────────────────────────────────────

/** Écouteurs Reverb enregistrés par le composant, indexés par nom d'événement. */
let reverbListeners = {}

// Le double et ses cinq fidélités vivent dans le helper, partagé avec
// `Notifications.callControls.test.js` : une seule liste à tenir pour les deux fichiers.
const peers = createCallPeersDouble()
const peersDouble = peers.api

vi.mock('~socializer/components/WebRTC2/Composables/useMediaBroadcast.js', () => ({
    useMediaBroadcast: () => peersDouble,
}))

vi.mock('~socializer/components/System/composables/useReverbChannel.js', () => ({
    useReverbChannel: (_channel, options = {}) => {
        reverbListeners = options.listeners ?? {}
        return { whisper: vi.fn(() => true), leave: vi.fn() }
    },
}))

// Les stores sont mockés en vrais stores Pinia : `storeToRefs` n'accepte rien d'autre.
vi.mock('~estarter/stores/me.js', async () => {
    const { defineStore } = await import('pinia')
    return {
        useMeStore: defineStore('me', {
            state: () => ({ me: { id: 1, slug: 'alice', channel: 'App.Models.User.1' } }),
            getters: { getMe: (state) => state.me },
            actions: { addUnreadNotifications() {} },
        }),
    }
})

vi.mock('~socializer/stores/peers2.js', async () => {
    const { defineStore } = await import('pinia')
    return {
        usePeer2Store: defineStore('peers2', {
            actions: { dispatchSignal() {} },
        }),
    }
})

vi.mock('~socializer/stores/conversations.js', async () => {
    const { defineStore } = await import('pinia')
    return {
        useConversationsStore: defineStore('conversations', {
            actions: { addConversation() {} },
        }),
    }
})

import Notifications from '~socializer/components/System/Notifications.vue'

// ─── Harnais ─────────────────────────────────────────────────────────────────

const eventBus = { $emit: vi.fn(), $on: vi.fn(), $off: vi.fn() }

const mountNotifications = () =>
    mount(Notifications, { global: { provide: { eventBus } } })

/** Réponse à une invitation, telle que le backend la diffuse. */
const answer = (status) => ({
    fromUserSlug: 'bob',
    status,
    options: { type: 'visio', room: 'call-room-1', peerId: 'peer-bob', inviteId: 'invite-1' },
})

let wrapper

beforeEach(() => {
    vi.clearAllMocks()
    reverbListeners = {}
    window.AWN = { info: vi.fn(), alert: vi.fn() }
    // `clearAllMocks` ne touche ni un ref ni un reactive : il ne remet à zéro que des
    // compteurs d'appels. D'où `reinitialiser()`, et AVANT le montage — sinon le watcher du
    // test suivant démarrerait sur la valeur laissée par le précédent.
    peers.reinitialiser()
    wrapper = mountNotifications()
})

afterEach(() => {
    wrapper?.unmount()
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Notifications — .ResponseToAuthorizationPeer', () => {

    it('refus : délègue quand même à openCallBetweenPeer, qui seul remet la FSM à IDLE', async () => {
        await reverbListeners['.ResponseToAuthorizationPeer'](answer(false))

        expect(peersDouble.openCallBetweenPeer).toHaveBeenCalledWith(
            expect.objectContaining({ fromUserSlug: 'bob', status: false })
        )
    })

    it('refus : prévient l\'utilisateur et émet close-call', async () => {
        await reverbListeners['.ResponseToAuthorizationPeer'](answer(false))

        expect(window.AWN.info).toHaveBeenCalledWith('bob est injoignable')
        expect(eventBus.$emit).toHaveBeenCalledWith('close-call', [
            { userSlug: 'bob', type: 'visio' },
        ])
    })

    it('acceptation : ouvre l\'appel, sans toast ni close-call', async () => {
        await reverbListeners['.ResponseToAuthorizationPeer'](answer(true))

        expect(peersDouble.openCallBetweenPeer).toHaveBeenCalledWith(
            expect.objectContaining({ fromUserSlug: 'bob', status: true })
        )
        expect(window.AWN.info).not.toHaveBeenCalled()
        expect(eventBus.$emit).not.toHaveBeenCalledWith('close-call', expect.anything())
    })

    it('arrête le retry d\'invitation quel que soit le statut', async () => {
        await reverbListeners['.ResponseToAuthorizationPeer'](answer(false))
        expect(peersDouble.stopCallInviteRetry).toHaveBeenCalledWith('invite-1')

        peersDouble.stopCallInviteRetry.mockClear()

        await reverbListeners['.ResponseToAuthorizationPeer'](answer(true))
        expect(peersDouble.stopCallInviteRetry).toHaveBeenCalledWith('invite-1')
    })
})

describe('Notifications — l\'invitation qui ne part pas', () => {
    /**
     * Le troisième chemin d'échec d'un appel sortant, et le seul qui n'était fermé nulle part.
     *
     * Les deux autres sont déjà couverts ci-dessus : le refus distant, et l'abandon du moteur
     * de retry. Celui-ci arrive plus tôt — `startCallWithPeer` a engagé la FSM en CALLING, puis
     * son aval a refusé d'émettre (aucun peerId local publiable). Avant le lot F la FSM restait
     * en CALLING **pour la vie de l'onglet** : spinner sans bouton raccrocher, et plus aucun
     * appel possible vers personne. Le moteur remet maintenant la FSM à IDLE et rend `null` ;
     * ce qui se joue ICI est ce que seul cet étage peut faire — le dire, et réarmer les boutons.
     */
    const demanderUnAppel = (slug = 'bob', type = 'visio') =>
        eventBus.$on.mock.calls
            .filter(([nom]) => nom === 'call-user')
            .at(-1)[1](slug, type)

    it('⭐ prévient l\'utilisateur et réarme le bouton du mur', async () => {
        peersDouble.startCallWithPeer.mockResolvedValueOnce(null)

        await demanderUnAppel()

        expect(window.AWN.info).toHaveBeenCalledWith('Appel vers bob impossible pour l\'instant')
        expect(eventBus.$emit).toHaveBeenCalledWith('close-call', [
            { userSlug: 'bob', type: 'visio' },
        ])
    })

    it('une invitation qui PART ne produit ni toast ni close-call', async () => {
        // L'assertion négative qui rend visible un chemin d'échec déclenché à tort — et c'est
        // exactement ce qu'un double résolvant `undefined` provoquerait (fidélité n° 4).
        await demanderUnAppel()

        expect(window.AWN.info).not.toHaveBeenCalled()
        expect(eventBus.$emit).not.toHaveBeenCalledWith('close-call', expect.anything())
    })

    it('⭐ mais PAS si je suis déjà en appel avec ce pair', async () => {
        // `startCallWithPeer` refuse aussi quand un appel est en cours, ce pair-là compris.
        // Émettre `close-call` sans garde réarmerait son bouton PENDANT l'appel — le bouton
        // dirait « appeler » alors que la conversation est ouverte.
        peersDouble.currentCallUsers.value = [{ userSlug: 'bob', type: 'visio' }]
        peersDouble.startCallWithPeer.mockResolvedValueOnce(null)

        await demanderUnAppel()

        expect(window.AWN.info).toHaveBeenCalled()
        expect(eventBus.$emit).not.toHaveBeenCalledWith('close-call', expect.anything())
    })

    it('un type absent retombe sur visio, comme les deux autres chemins d\'échec', async () => {
        peersDouble.startCallWithPeer.mockResolvedValueOnce(null)

        await demanderUnAppel('bob', undefined)

        expect(eventBus.$emit).toHaveBeenCalledWith('close-call', [
            { userSlug: 'bob', type: 'visio' },
        ])
    })
})

describe('Notifications — abandon du retry d\'invitation', () => {

    it('rejoue le chemin du refus : toast, close-call, puis openCallBetweenPeer', async () => {
        peersDouble.inviteAbandonedSignal.value = { userSlug: 'bob', type: 'visio' }
        await nextTick()

        // Le libellé distingue le silence du refus explicite (« est injoignable ») : sur une
        // capture d'écran, il dit lequel des deux chemins s'est produit.
        expect(window.AWN.info).toHaveBeenCalledWith('bob n\'a pas répondu')
        expect(eventBus.$emit).toHaveBeenCalledWith('close-call', [
            { userSlug: 'bob', type: 'visio' },
        ])
        // ⭐ Le fait qui compte : sans cet appel, la FSM reste en 'calling' et le spinner
        // tourne jusqu'au rechargement — exactement la régression du refus, par l'autre bout.
        expect(peersDouble.openCallBetweenPeer).toHaveBeenCalledWith({
            fromUserSlug: 'bob',
            status: false,
            options: { type: 'visio' },
        })
    })

    it('consomme le signal, donc un second abandon redéclenche', async () => {
        peersDouble.inviteAbandonedSignal.value = { userSlug: 'bob', type: 'visio' }
        await nextTick()

        expect(peersDouble.inviteAbandonedSignal.value).toBeNull()

        peersDouble.inviteAbandonedSignal.value = { userSlug: 'carol', type: 'vocal' }
        await nextTick()

        expect(peersDouble.openCallBetweenPeer).toHaveBeenLastCalledWith({
            fromUserSlug: 'carol',
            status: false,
            options: { type: 'vocal' },
        })
    })

    it('type absent : retombe sur visio, comme le chemin du refus', async () => {
        peersDouble.inviteAbandonedSignal.value = { userSlug: 'bob' }
        await nextTick()

        expect(eventBus.$emit).toHaveBeenCalledWith('close-call', [
            { userSlug: 'bob', type: 'visio' },
        ])
        expect(peersDouble.openCallBetweenPeer).toHaveBeenCalledWith({
            fromUserSlug: 'bob',
            status: false,
            options: { type: 'visio' },
        })
    })
})
