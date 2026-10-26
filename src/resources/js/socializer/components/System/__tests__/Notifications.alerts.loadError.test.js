/**
 * Notifications.alerts.loadError.test.js — le chunk d'`AlertComponent` ne se charge pas
 *
 * Fichier séparé parce que `vi.mock` vaut pour TOUT le fichier : ici, l'`import()` d'`AlertComponent`
 * ne réussit jamais. Il REJETTE, sauf dans le dernier cas, où `chargement.pendu` le fait PENDRE. Le
 * déclencheur réel est un onglet ouvert avant un déploiement — voir `AlertComponent.loadError.test.js`,
 * qui porte les deux mêmes pannes un niveau plus bas.
 *
 * ⚠️ **L'interrupteur tient parce que la factory est rejouée à chaque `import()`**, rien n'étant mis
 * en cache pour un module dont la factory a levé. Le cas « pendu » le prouve lui-même : si la factory
 * ne rejouait pas, il recevrait le rejet du cas précédent, et rougirait sur « pas avant ». Mais une
 * factory PENDUE, elle, laisse résoudre les imports suivants sur le vrai module : d'où sa place, en
 * dernier.
 *
 * ── CE QUE CE FICHIER A ÉPINGLÉ, le 2026-10-26 ─────────────────────────────────
 * Écrit rouge, trouvé par la relecture du lot B. Sans `errorComponent`, le wrapper en échec ne rend
 * rien et reste monté, et `notificationComponent` reste non nul : le créneau est pris pour la vie de
 * l'onglet. Avant B5, chaque appel suivant était INVISIBLE et chaque appelant attendait l'abandon de
 * son retry ; après B5 sans ce correctif, chacun était refusé avec le toast « un autre appel attend
 * votre réponse » — alors qu'aucun appel n'était à l'écran. Vue relance l'import au montage suivant
 * (`pendingRequest` remis à `null` sur l'échec) : il fallait donc d'abord que le wrapper parte.
 *
 * Depuis la décision de David du 2026-10-26, chaque refus de ce type prévient aussi l'appelé, par un
 * toast persistant qui l'invite à recharger la page. Asserté dans les trois cas.
 *
 * Le harnais est celui de `Notifications.alerts.test.js`, réduit à ce qu'exigent ces cas.
 *
 * ── CONTRÔLES, mesurés le 2026-10-26 sur les sept fichiers de `System/__tests__` ────
 * Rouges de CE fichier sous mutation ; zéro dans les six autres, sauf M3 (voir son en-tête).
 *    M11. `errorComponent` retiré du wrapper d'`AlertComponent` ..... 3
 *    M13. `AlertComponentUnavailable` émet `(false)` seul ........... 3
 *    M15. `timeout` retiré du wrapper d'`AlertComponent` ............ 1   (le cas « pendu »)
 *    H2.  le mock en mode « pendu » rejette au lieu de pendre ....... 1   (« pas avant »)
 *    M17. toast « appel manqué » retiré d'`AlertComponentUnavailable` ... 3
 *    M3.  « occupé » lu sur les props (`Notifications.alerts.test.js`) ... 1 ici aussi
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createCallPeersDouble } from './helpers/createCallPeersDouble.js'
import { ALERT_LOAD_TIMEOUT_MS, missedCallMessage } from '~socializer/components/System/system.config.js'

let reverbListeners = {}

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
    return { usePeer2Store: defineStore('peers2', { actions: { dispatchSignal() {} } }) }
})

vi.mock('~socializer/stores/conversations.js', async () => {
    const { defineStore } = await import('pinia')
    return {
        useConversationsStore: defineStore('conversations', { actions: { addConversation() {} } }),
    }
})

const chargement = vi.hoisted(() => ({ pendu: false }))

vi.mock('~socializer/components/System/widgets/AlertComponent.vue', () => {
    if (chargement.pendu) {
        return new Promise(() => {})
    }
    throw new Error('chunk AlertComponent introuvable (simulé)')
})

import Notifications from '~socializer/components/System/Notifications.vue'

// ─── Harnais ─────────────────────────────────────────────────────────────────

const eventBus = { $emit: vi.fn(), $on: vi.fn(), $off: vi.fn() }

const invitationEntrante = (type, inviteId, fromUserSlug) => ({
    fromUserSlug,
    options: {
        type,
        action: 'peer-access-permission',
        room: 'call-room-1',
        peerId: '00000000-0000-4000-8000-000000000001',
        inviteId,
    },
})

/** Reçoit l'invitation, puis laisse le chargeur rejeter et le composant d'erreur émettre. */
const recevoirLInvitation = async (type, inviteId, fromUserSlug) => {
    reverbListeners['.AlertToUser'](invitationEntrante(type, inviteId, fromUserSlug))
    await nextTick()
    await vi.dynamicImportSettled()
    await flushPromises()
    await nextTick()
}

/** Le toast de l'appelé : persistant, puisque seul un rechargement le débloque. */
const toastAppelManque = (fromUserSlug) => [missedCallMessage(fromUserSlug), { durations: { info: 0 } }]

let wrapper
let espionWarn

beforeEach(() => {
    vi.clearAllMocks()
    reverbListeners = {}
    window.AWN = { info: vi.fn(), alert: vi.fn() }
    peers.reinitialiser()
    peers.statutAppel.value = 'idle'
    espionWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    delete window.AWN
    espionWarn.mockRestore()
    console.error.mockRestore()
    chargement.pendu = false
    vi.useRealTimers()
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Notifications — le chunk d\'AlertComponent ne se charge pas', () => {

    it('⭐ l\'invitation est refusée d\'office, et le créneau est rendu', async () => {
        wrapper = await mount(Notifications, { global: { provide: { eventBus } } })
        await vi.dynamicImportSettled()

        await recevoirLInvitation('visio', 'invite-1', 'bob')

        // Bob est fixé tout de suite, au lieu d'attendre l'abandon de son retry.
        expect(peersDouble.acceptCallFromPeer).toHaveBeenCalledWith({
            fromUserSlug: 'bob',
            options: invitationEntrante('visio', 'invite-1', 'bob').options,
            status: false,
        })
        expect(document.body.querySelector('#notification-component-wrapper')).toBeNull()
        expect(espionWarn).toHaveBeenCalled()
        expect(window.AWN.info).toHaveBeenCalledWith(...toastAppelManque('bob'))
    })

    it('⭐ l\'appelant suivant n\'est pas refusé comme « occupé » : sa propre alerte est retentée', async () => {
        wrapper = await mount(Notifications, { global: { provide: { eventBus } } })
        await vi.dynamicImportSettled()

        await recevoirLInvitation('visio', 'invite-1', 'bob')
        await recevoirLInvitation('vocal', 'invite-2', 'carole')

        // Carole est refusée aussi — le chunk reste introuvable —, mais par SA tentative de
        // chargement, pas par le garde « occupé » : aucun toast ne parle d'un appel en attente,
        // puisqu'aucun n'est à l'écran.
        expect(peersDouble.acceptCallFromPeer).toHaveBeenCalledTimes(2)
        expect(peersDouble.acceptCallFromPeer).toHaveBeenLastCalledWith({
            fromUserSlug: 'carole',
            options: invitationEntrante('vocal', 'invite-2', 'carole').options,
            status: false,
        })
        expect(window.AWN.info).not.toHaveBeenCalledWith(expect.stringContaining('arrivait déjà'))
        expect(window.AWN.info).toHaveBeenCalledWith(...toastAppelManque('carole'))
    })

    it('⭐ un chunk qui PEND est refusé au bout d\'ALERT_LOAD_TIMEOUT_MS, et le créneau est rendu', async () => {
        // ⚠️ Dernier du fichier, et pas par hasard : c'est LUI qui contamine les cas suivants. Après
        // une factory pendue, Vitest (2.1.9, mesuré par la relecture) résout les `import()` suivants
        // sur le VRAI module, sans rappeler la factory — un cas « chargement en échec » écrit plus
        // bas recevrait un `AlertComponent` qui marche. Chaque rejet, lui, est neuf. Et sans
        // `vi.dynamicImportSettled()`, qui attendrait l'import pendu pour toujours.
        chargement.pendu = true
        vi.useFakeTimers()
        wrapper = mount(Notifications, { global: { provide: { eventBus } } })
        await flushPromises()

        reverbListeners['.AlertToUser'](invitationEntrante('visio', 'invite-1', 'bob'))
        await flushPromises()

        await vi.advanceTimersByTimeAsync(ALERT_LOAD_TIMEOUT_MS - 1)
        expect(peersDouble.acceptCallFromPeer).not.toHaveBeenCalled()

        await vi.advanceTimersByTimeAsync(1)
        await nextTick()

        expect(peersDouble.acceptCallFromPeer).toHaveBeenCalledWith({
            fromUserSlug: 'bob',
            options: invitationEntrante('visio', 'invite-1', 'bob').options,
            status: false,
        })
        expect(document.body.querySelector('#notification-component-wrapper')).toBeNull()
        expect(window.AWN.info).toHaveBeenCalledWith(...toastAppelManque('bob'))
    })
})
