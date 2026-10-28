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

    /**
     * Ce cas épinglait l'inverse — « arrête le retry quel que soit le statut », AVANT
     * `openCallBetweenPeer`. Or c'est sa garde qui décide si la réponse vaut pour l'invitation
     * en vol, et elle arrête elle-même la relance quand elle l'accepte. Arrêtée ici d'abord,
     * une réponse que la garde ignore ensuite ne laissait ni relance ni abandon : l'appelant
     * restait en `calling` pour toujours.
     */
    it('ne coupe pas la relance avant que la garde d\'openCallBetweenPeer ait décidé', async () => {
        await reverbListeners['.ResponseToAuthorizationPeer'](answer(false))
        await reverbListeners['.ResponseToAuthorizationPeer'](answer(true))

        expect(peersDouble.stopCallInviteRetry).not.toHaveBeenCalled()
        expect(peersDouble.openCallBetweenPeer).toHaveBeenCalledTimes(2)
    })

    /**
     * L'invitation sonne sur TOUS les onglets de l'appelé. Un onglet répond ; les autres sonnent
     * jusqu'à leur auto-refus, qui arrive ici avec le même `inviteId` — en pleine conversation, ou
     * après que l'appelé a annulé. La FSM l'ignore (`_consumeRefusedInvitation`) : son verdict est
     * `false`, et c'est lui seul qui dit si ce refus est à annoncer.
     */
    it('⭐ un refus que le moteur ignore ne dit rien et ne réarme pas le bouton du mur', async () => {
        peersDouble.openCallBetweenPeer.mockResolvedValueOnce(false)

        await reverbListeners['.ResponseToAuthorizationPeer'](answer(false))

        // Délégué quand même : c'est le moteur qui tranche, pas ce composant.
        expect(peersDouble.openCallBetweenPeer).toHaveBeenCalledWith(
            expect.objectContaining({ fromUserSlug: 'bob', status: false })
        )
        expect(window.AWN.info).not.toHaveBeenCalled()
        expect(eventBus.$emit).not.toHaveBeenCalledWith('close-call', expect.anything())
    })

    /**
     * Le verdict est attendu AVANT de parler : un moteur qui lève (l'arrêt complet n'a qu'un
     * `finally`, et l'écouteur Reverb aucun `catch`) sauterait donc le toast et `close-call`, et le
     * bouton du mur resterait désarmé pour la vie de la page — le défaut que le lot F a fermé. Le
     * chemin périmé rend `false` avant tout code qui agit (seules des lectures le précèdent) : ce
     * qui lève est un refus consommé.
     */
    it('⭐ un refus sur lequel le moteur lève est annoncé quand même, et réarme le bouton', async () => {
        // Restauré en `finally` : `clearAllMocks` ne rend pas l'implémentation, et les cas suivants
        // tourneraient avec `console.error` muet.
        const espionErreur = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
            peersDouble.openCallBetweenPeer.mockRejectedValueOnce(new Error('arrêt complet en échec'))

            await reverbListeners['.ResponseToAuthorizationPeer'](answer(false))

            expect(window.AWN.info).toHaveBeenCalledWith('bob est injoignable')
            expect(eventBus.$emit).toHaveBeenCalledWith('close-call', [
                { userSlug: 'bob', type: 'visio' },
            ])
        } finally {
            espionErreur.mockRestore()
        }
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

describe('Notifications — le pair d\'un appel pas encore établi s\'en va', () => {
    /**
     * Côté appelant : B a accepté, puis annulé pendant l'invite de permission. `_enterCallSession`
     * ne répond pas (le flux tardif est coupé), et l'arrêt complet de B émet
     * `.CloseConnectionToPeerID` avec la room de l'appel. Chez moi, encore en `calling`, c'est un
     * départ : `remoteStopCall` me ramène à IDLE. Côté appelé, le même signal en `receiving` : j'ai
     * accepté, l'appelant s'en va avant que son flux m'arrive. Jusqu'au 27/10/2026, sans un mot des
     * deux côtés — le spinner disparaissait. Relevé par la vérif à deux navigateurs du bouton
     * « annuler » (étape 3), et la décision est de prévenir les deux.
     *
     * Le toast ne remplace pas le départ, il le précède : c'est `remoteStopCall` qui ramène la FSM à
     * IDLE, comme `openCallBetweenPeer` pour un refus.
     */
    const depart = (fromUserSlug = 'bob', room = 'call-room-1') => ({
        fromUserSlug,
        room,
        type: 'visio',
    })

    const enAttenteDe = (userSlug = 'bob', room = 'call-room-1') => {
        peers.statutAppel.value = 'calling'
        peersDouble.currentCallRoomId.value = room
        peersDouble.currentCallUsers.value = [{ userSlug, type: 'visio' }]
    }

    it('⭐ je suis prévenu que le pair est indisponible, et le départ est transmis', async () => {
        enAttenteDe()

        await reverbListeners['.CloseConnectionToPeerID'](depart())

        expect(window.AWN.info).toHaveBeenCalledWith('bob est indisponible')
        expect(peersDouble.remoteStopCall).toHaveBeenCalledWith(depart())
    })

    it('⭐ appelé, j\'ai accepté : l\'appelant qui s\'en va avant son flux, c\'est un appel annulé', async () => {
        // L'appelant a annulé pendant mon invite de permission, ou raccroché avant que son flux
        // m'arrive : pour moi, l'appel n'a pas eu lieu. Le libellé est celui de l'alerte annulée.
        enAttenteDe()
        peers.statutAppel.value = 'receiving'

        await reverbListeners['.CloseConnectionToPeerID'](depart())

        expect(window.AWN.info).toHaveBeenCalledWith('Appel de bob annulé')
        expect(window.AWN.info).toHaveBeenCalledTimes(1)
        expect(peersDouble.remoteStopCall).toHaveBeenCalledWith(depart())
    })

    it('⭐ appelant déjà CONNECTED mais sans flux : l\'appelé qui annule est indisponible', async () => {
        // Je passe CONNECTED dès la RÉCEPTION de son acceptation, avant mon `getUserMedia` : s'il
        // annule pendant MON invite de permission, aucun flux n'est arrivé, l'appel n'a pas eu lieu.
        enAttenteDe()
        peers.statutAppel.value = 'connected'

        await reverbListeners['.CloseConnectionToPeerID'](depart())

        expect(window.AWN.info).toHaveBeenCalledWith('bob est indisponible')
        expect(peersDouble.remoteStopCall).toHaveBeenCalledWith(depart())
    })

    it('⭐ un appel ÉTABLI qui se termine ne dit pas « indisponible »', async () => {
        // Le pair a raccroché : il était disponible, il ne l'est plus. Pas le même fait. Établi =
        // un flux distant est arrivé, et non l'état `connected`, que l'appelant atteint avant.
        enAttenteDe()
        peers.statutAppel.value = 'connected'
        peers.appelEtabli.value = true

        await reverbListeners['.CloseConnectionToPeerID'](depart())

        expect(window.AWN.info).not.toHaveBeenCalled()
        expect(peersDouble.remoteStopCall).toHaveBeenCalledWith(depart())
    })

    it('⭐ le départ qui porte la room d\'un AUTRE appel ne dit rien', async () => {
        // Des raccrochés croisés suivis d'un rappel : le pair que j'appelle quitte l'appel
        // PRÉCÉDENT. Ce n'est pas une réponse à mon invitation. Qu'il soit encore appliqué à
        // l'appel en cours est l'item `handleRemoteDeparture` de work/webrtc2-todo.md — ce cas
        // n'épingle que le toast.
        enAttenteDe()

        await reverbListeners['.CloseConnectionToPeerID'](depart('bob', 'call-room-0'))

        expect(window.AWN.info).not.toHaveBeenCalled()
    })

    it('le départ d\'un pair que je n\'appelle pas ne dit rien', async () => {
        enAttenteDe('carole')

        await reverbListeners['.CloseConnectionToPeerID'](depart())

        expect(window.AWN.info).not.toHaveBeenCalled()
        expect(peersDouble.remoteStopCall).toHaveBeenCalledWith(depart())
    })
})
