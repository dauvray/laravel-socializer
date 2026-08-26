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
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'

// ─── Doubles ─────────────────────────────────────────────────────────────────

/** Écouteurs Reverb enregistrés par le composant, indexés par nom d'événement. */
let reverbListeners = {}

const peersDouble = {
    initialize: vi.fn(),
    handleStreamReceived: vi.fn(),
    handleStreamRemoved: vi.fn(),
    callStatus: vi.fn(() => 'calling'),
    isCallInProgress: vi.fn(() => true),
    isInviteDuplicate: vi.fn(() => false),
    stopCallInviteRetry: vi.fn(),
    clearAllCallInviteRetries: vi.fn(),
    clearSeenInvites: vi.fn(),
    openCallBetweenPeer: vi.fn(async () => {}),
    acceptCallFromPeer: vi.fn(async () => {}),
    startCallWithPeer: vi.fn(async () => {}),
    stopCallWithPeers: vi.fn(async () => {}),
    currentCallUsers: { value: [] },
}

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
