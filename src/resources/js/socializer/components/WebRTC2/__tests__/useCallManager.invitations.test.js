/**
 * useCallManager.invitations.test.js — la jonction call manager × VRAI usePeerCore
 *
 * `useCallManager.test.js` double le core, et `usePeerCore.test.js` n'a pas de call manager :
 * ce qui tient au JOINT entre les deux n'est vu par aucun des deux fichiers (le « 0 croisé »
 * de `docs/architecture/tests.md`). Ce fichier câble les deux vrais composables ; le reste
 * (media, connexions, transport, pool) est doublé à l'identique de `useCallManager.test.js`.
 *
 * ── Ce qui tient au joint ────────────────────────────────────────────────────────────────
 *
 * `requestAuthorizationRemotePeerId` peut voir son invitation annulée PENDANT son premier
 * envoi — un refus distant qui arrive avant la réponse HTTP (plausible quand l'appelé refuse
 * d'office, « occupé ⇒ refus » : lu, non sondé). Elle n'arme alors pas le moteur de retry,
 * mais elle rend quand même son `inviteId`, et ce retour est porteur : `startCallWithPeer`
 * lit `null` comme « rien n'est parti » et rejoue le chemin du refus. Si l'utilisateur a
 * rappelé entre-temps, ce refus rejoué frappe le SECOND appel — il retire le pair, éteint la
 * nouvelle chaîne d'invitation et ramène la FSM à IDLE.
 *
 * ── Contrôles de harnais (mesurés le 2026-10-27) ─────────────────────────────────────────
 *
 *   | Neutralisé                                                     | Rougit  |
 *   |----------------------------------------------------------------|---------|
 *   | `return inviteId` du premier envoi supplanté → `return null`   | le cas  |
 *   | garde du retour du premier envoi retirée                       | le cas  |
 *   | code d'avant le lot (usePeerCore, usePeerRetry, pool)          | le cas  |
 *
 * La première ligne n'est vue que d'ici : `usePeerCore.test.js` rend 0 cas sous cette
 * mutation (mesuré par la relecture du lot).
 *
 * ── L'arrêt complet éteint l'invitation (mesurés le 2026-10-27) ──────────────────────────
 *
 *   | Neutralisé dans `stopCallWithPeers` (full)        | Rougit                           |
 *   |---------------------------------------------------|----------------------------------|
 *   | `core.clearAllCallInviteRetries()`                | « plus aucune relance »          |
 *   | `peerStore.clearCallInvitesForContext(...)`       | les deux cas d'acceptation       |
 *   | `useCallManager.js` d'avant le lot (b08faba)      | les trois cas                    |
 *
 * ⚠️ Ces cas passent par le DOUBLE du store : le prédicat de `clearCallInvitesForContext`
 * (`inviteId`, portée `contextId`) y est recopié, et ses deux mutants laissent la suite entière
 * verte. Le vrai verbe n'est épinglé que par `peers2Store.remotePeerId.test.js` — même
 * arbitrage que `clearWaitingRemotePeerIdsForContext`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockContext } from './helpers/createMockContext.js'
import { withSetup } from './helpers/withSetup.js'
import { seedReadyPeer } from './helpers/bootLocalPeer.js'
import { usePeerCore } from '~socializer/components/WebRTC2/Composables/usePeerCore.js'
import { useCallManager } from '~socializer/components/WebRTC2/Composables/useCallManager.js'
import { CALL_STATES } from '~socializer/components/WebRTC2/Composables/utils/useCallStateMachine.js'
import { ENDPOINTS } from '~socializer/components/WebRTC2/webrtc2.config.js'

describe('useCallManager × usePeerCore — invitations', () => {
    let ctx
    let app
    let core
    let cm
    let pool

    beforeEach(() => {
        vi.useFakeTimers()
        // Jitter neutralisé : l'ordre de réveil des chaînes doit être déterministe.
        vi.spyOn(Math, 'random').mockReturnValue(0)
        vi.spyOn(console, 'warn').mockImplementation(() => {})

        ctx = createMockContext()
        seedReadyPeer(ctx.peerStore, 'local-peer-id-mock')
        // `withSetup` : le moteur de retry du core enregistre un `onUnmounted`.
        ;[core, app] = withSetup(() => usePeerCore(ctx))

        pool = { requestOrConnectPeer: vi.fn(), clearRetry: vi.fn(), clearAllRetries: vi.fn() }
        cm = useCallManager(ctx, {
            core,
            media: {
                startCurrentStream: vi.fn().mockResolvedValue(undefined),
                stopCurrentStream: vi.fn(),
                createVideoElement: vi.fn(),
                removeVideoElement: vi.fn(),
                cleanupCallPlayers: vi.fn(),
            },
            connections: { closePeerConnection: vi.fn() },
            transport: { setLocalPeer: vi.fn(async () => undefined) },
            pool,
        })
    })

    afterEach(() => {
        app.unmount()
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    /** Room d'appel de chaque POST d'invitation, dans l'ordre d'émission. */
    const roomsInvitees = () => ctx.AjaxService.load.mock.calls
        .filter(([url]) => url === ENDPOINTS.SEND_ALERT_TO_USER)
        .map(([, , data]) => data.options.room)

    it('un refus reçu pendant le premier envoi ne frappe pas le rappel qui l\'a suivi', async () => {
        let repondreEnvoi
        ctx.AjaxService.load.mockImplementationOnce(
            () => new Promise((resolve) => { repondreEnvoi = () => resolve({ data: {} }) }),
        )
        const premierAppel = cm.startCallWithPeer({ toUserSlug: 'alice', type: 'visio', room: 'call-1' })

        // Le refus d'alice arrive avant la réponse HTTP — le chemin de
        // `.ResponseToAuthorizationPeer` dans Notifications.vue.
        await cm.openCallBetweenPeer({ fromUserSlug: 'alice', status: false, options: { type: 'visio' } })
        expect(ctx.callMachine.callState.value).toBe(CALL_STATES.IDLE)

        // L'utilisateur rappelle alice, puis la réponse du premier envoi arrive enfin.
        await cm.startCallWithPeer({ toUserSlug: 'alice', type: 'visio', room: 'call-2' })
        repondreEnvoi()
        await premierAppel

        expect(ctx.callMachine.callState.value).toBe(CALL_STATES.CALLING)
        expect(ctx.session.currentCallUsers).toEqual([{ userSlug: 'alice', type: 'visio' }])

        await vi.advanceTimersByTimeAsync(30_000)

        const relances = roomsInvitees().slice(2)
        expect(relances).not.toContain('call-1')
        expect(relances.length).toBeGreaterThan(1)
    })

    describe('un arrêt complet pendant `calling` éteint l\'invitation', () => {
        /** L'arrêt de `Notifications.onStopCall` : les participants courants, signalés au distant. */
        const raccrocher = () => cm.stopCallWithPeers([...ctx.session.currentCallUsers], true, { mode: 'full' })

        it('plus aucune relance ne part, et aucun abandon ne tombe après l\'arrêt', async () => {
            await cm.startCallWithPeer({ toUserSlug: 'alice', type: 'visio', room: 'call-1' })
            expect(roomsInvitees()).toEqual(['call-1'])

            await raccrocher()
            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.IDLE)

            await vi.advanceTimersByTimeAsync(60_000)

            expect(roomsInvitees()).toEqual(['call-1'])
            expect(ctx.inviteAbandonedSignal.value).toBeNull()
        })

        it('une acceptation arrivée après l\'arrêt n\'autorise pas le pair', async () => {
            const inviteId = await cm.startCallWithPeer({ toUserSlug: 'alice', type: 'visio', room: 'call-1' })
            await raccrocher()

            // L'alerte d'alice était encore affichée : elle accepte l'invitation déjà livrée.
            await cm.openCallBetweenPeer({
                fromUserSlug: 'alice',
                status: true,
                options: { room: 'call-1', type: 'visio', peerId: 'alice-peer-id', inviteId },
            })

            expect(ctx.isAuthorizedCallPeer('alice')).toBe(false)
            expect(ctx.peerStore.hasRemotePeerId('alice')).toBe(false)
            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.IDLE)
        })

        /**
         * Le pire cas, et c'est l'enchaînement naturel d'un bouton « annuler » : on annule alice,
         * on appelle bob, et l'acceptation tardive d'alice tombe pendant que bob sonne. Avant le
         * lot, elle passait la garde et faisait entrer alice dans l'appel de bob — CONNECTED avec
         * les deux, alice autorisée, connexion lancée vers elle — avant que bob ait répondu.
         */
        it('une acceptation tardive n\'entre pas dans l\'appel suivant', async () => {
            const inviteAlice = await cm.startCallWithPeer({ toUserSlug: 'alice', type: 'visio', room: 'call-1' })
            await raccrocher()
            const inviteBob = await cm.startCallWithPeer({ toUserSlug: 'bob', type: 'visio', room: 'call-2' })

            await cm.openCallBetweenPeer({
                fromUserSlug: 'alice',
                status: true,
                options: { room: 'call-1', type: 'visio', peerId: 'alice-peer-id', inviteId: inviteAlice },
            })

            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.CALLING)
            expect(ctx.session.currentCallUsers.map((u) => u.userSlug)).toEqual(['bob'])
            expect(ctx.isAuthorizedCallPeer('alice')).toBe(false)
            expect(pool.requestOrConnectPeer).not.toHaveBeenCalledWith('alice')

            // L'appel de bob, lui, n'a rien perdu.
            await cm.openCallBetweenPeer({
                fromUserSlug: 'bob',
                status: true,
                options: { room: 'call-2', type: 'visio', peerId: 'bob-peer-id', inviteId: inviteBob },
            })

            expect(ctx.callMachine.callState.value).toBe(CALL_STATES.CONNECTED)
            expect(ctx.session.currentCallUsers.map((u) => u.userSlug)).toEqual(['bob'])
        })
    })
})
