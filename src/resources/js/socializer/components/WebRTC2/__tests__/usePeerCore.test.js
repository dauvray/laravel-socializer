/**
 * usePeerCore.test.js — Tâche 1 : Signaling layer
 * Périmètre : couche HTTP/Ajax pure, sans WebRTC.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockContext } from './helpers/createMockContext.js'
import { withSetup } from './helpers/withSetup.js'
import { usePeerCore } from '~socializer/components/WebRTC2/Composables/usePeerCore.js'
import { ENDPOINTS, SIGNALING_STALE_MS, MAX_INVITE_RETRIES } from '~socializer/components/WebRTC2/webrtc2.config.js'

describe('usePeerCore', () => {
    let ctx
    let app
    let core

    beforeEach(() => {
        vi.useFakeTimers()
        ctx = createMockContext()
        ;[core, app] = withSetup(() => usePeerCore(ctx))
    })

    afterEach(() => {
        app.unmount()
        vi.useRealTimers()
    })

    // ── requestRemotePeerConnection ─────────────────────────────────────────

    describe('requestRemotePeerConnection', () => {

        it('déclenche un POST Ajax avec les bons paramètres', async () => {
            const result = await core.requestRemotePeerConnection('alice')

            expect(ctx.AjaxService.load).toHaveBeenCalledOnce()
            expect(ctx.AjaxService.load).toHaveBeenCalledWith(
                ENDPOINTS.ASK_TO_PEER_ID,
                'post',
                {
                    toUserSlug: 'alice',
                    room: ctx.session.onAirRoom,
                    // `type` = type du contexte : clé de routage du signal retour.
                    type: ctx.session.currentType,
                    // `connectionType` = connexion réellement demandée ; par défaut le
                    // type du contexte, mais c'est lui qui porte 'screen'.
                    connectionType: ctx.session.currentType,
                }
            )
            expect(result).toBe(true)
        })

        it('appelle addWaitingRemotePeerId avec le bon slug et les bonnes métadonnées après le POST', async () => {
            await core.requestRemotePeerConnection('alice')

            expect(ctx.peerStore.addWaitingRemotePeerId).toHaveBeenCalledOnce()
            expect(ctx.peerStore.addWaitingRemotePeerId).toHaveBeenCalledWith(
                'alice',
                { room: ctx.session.onAirRoom, type: ctx.session.currentType }
            )
        })

        it('ne fait PAS de requête si une entrée waiting récente existe (throttling < SIGNALING_STALE_MS)', async () => {
            // Entrée fraîche : créée il y a SIGNALING_STALE_MS / 2 ms
            ctx.peerStore.getWaitingRemotePeerId.mockReturnValue({
                room: ctx.session.onAirRoom,
                type: ctx.session.currentType,
                createdAt: Date.now() - Math.floor(SIGNALING_STALE_MS / 2),
            })

            const result = await core.requestRemotePeerConnection('alice')

            expect(ctx.AjaxService.load).not.toHaveBeenCalled()
            expect(ctx.peerStore.addWaitingRemotePeerId).not.toHaveBeenCalled()
            expect(result).toBe(false)
        })

        it('envoie la requête si l\'entrée waiting est expirée (>= SIGNALING_STALE_MS)', async () => {
            // Entrée stale : créée il y a SIGNALING_STALE_MS + 1000 ms
            ctx.peerStore.getWaitingRemotePeerId.mockReturnValue({
                room: ctx.session.onAirRoom,
                type: ctx.session.currentType,
                createdAt: Date.now() - (SIGNALING_STALE_MS + 1000),
            })

            const result = await core.requestRemotePeerConnection('alice')

            expect(ctx.AjaxService.load).toHaveBeenCalledOnce()
            expect(result).toBe(true)
        })

        it('ignore le throttling si la room ou le type diffère de l\'entrée waiting', async () => {
            // Entrée récente mais pour une room différente → ne bloque pas
            ctx.peerStore.getWaitingRemotePeerId.mockReturnValue({
                room: 'other-room',
                type: ctx.session.currentType,
                createdAt: Date.now() - Math.floor(SIGNALING_STALE_MS / 2),
            })

            const result = await core.requestRemotePeerConnection('alice')

            expect(ctx.AjaxService.load).toHaveBeenCalledOnce()
            expect(result).toBe(true)
        })

        it('retourne false sans requête si localPeerId est absent', async () => {
            ctx.peerStore.getLocalPeerId = null

            const result = await core.requestRemotePeerConnection('alice')

            expect(ctx.AjaxService.load).not.toHaveBeenCalled()
            expect(ctx.peerStore.addWaitingRemotePeerId).not.toHaveBeenCalled()
            expect(result).toBe(false)
        })

        it('retourne false sans appeler addWaitingRemotePeerId si le POST échoue', async () => {
            ctx.AjaxService.load.mockRejectedValue(new Error('Network error'))

            const result = await core.requestRemotePeerConnection('alice')

            expect(ctx.peerStore.addWaitingRemotePeerId).not.toHaveBeenCalled()
            expect(result).toBe(false)
        })
    })

    // ── responseRemotePeerConnection ────────────────────────────────────────

    describe('responseRemotePeerConnection', () => {

        const buildPayload = (overrides = {}) => ({
            fromUserSlug: 'bob',
            room: 'room-42',
            type: 'visio',
            ...overrides,
        })

        it('envoie un POST à RESPONSE_TO_PEER_ID avec le peerId local et les métadonnées du payload', async () => {
            const payload = buildPayload()

            await core.responseRemotePeerConnection(payload)

            expect(ctx.AjaxService.load).toHaveBeenCalledOnce()
            expect(ctx.AjaxService.load).toHaveBeenCalledWith(
                ENDPOINTS.RESPONSE_TO_PEER_ID,
                'post',
                {
                    peerId: ctx.peerStore.getLocalPeerId,
                    toUserSlug: 'bob',
                    room: 'room-42',
                    type: 'visio',
                    // Renvoyé tel que reçu ; retombe sur `type` quand le demandeur ne
                    // l'envoie pas (backend ou client non à jour).
                    connectionType: 'visio',
                }
            )
        })

        it('utilise bien getLocalPeerId du contexte comme peerId envoyé', async () => {
            ctx.peerStore.getLocalPeerId = 'my-real-peer-id'
            const payload = buildPayload()

            await core.responseRemotePeerConnection(payload)

            expect(ctx.AjaxService.load).toHaveBeenCalledWith(
                ENDPOINTS.RESPONSE_TO_PEER_ID,
                'post',
                expect.objectContaining({ peerId: 'my-real-peer-id' })
            )
        })

        it('ne throw pas si le POST Ajax échoue (erreur avalée) et retourne false', async () => {
            ctx.AjaxService.load.mockRejectedValue(new Error('Network error'))
            const payload = buildPayload()

            await expect(core.responseRemotePeerConnection(payload)).resolves.toBe(false)
        })

        it('ne POSTe rien et retourne false si le peer local n\'est pas encore prêt', async () => {
            // Sans peerId local, le POST enverrait `peerId: null` : le pair distant ne
            // pourrait jamais se connecter et rien ne réessaierait sur ce chemin.
            ctx.peerStore.getLocalPeerId = null
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

            const result = await core.responseRemotePeerConnection(buildPayload())

            expect(result).toBe(false)
            expect(ctx.AjaxService.load).not.toHaveBeenCalled()
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('localPeer pas encore prêt')
            )
            warnSpy.mockRestore()
        })

        it('retourne true quand le POST aboutit', async () => {
            await expect(core.responseRemotePeerConnection(buildPayload())).resolves.toBe(true)
        })
    })

    // ── requestAuthorizationRemotePeerId ────────────────────────────────────

    describe('requestAuthorizationRemotePeerId', () => {

        const buildPayload = (overrides = {}) => ({
            toUserSlug: 'alice',
            type: 'visio',
            ...overrides,
        })

        it('déclenche un POST immédiat à SEND_ALERT_TO_USER avec les bons paramètres', async () => {
            ctx.session.currentCallRoomId = 'call-room-1'
            const payload = buildPayload()

            const inviteId = await core.requestAuthorizationRemotePeerId(payload)

            expect(ctx.AjaxService.load).toHaveBeenCalledOnce()
            expect(ctx.AjaxService.load).toHaveBeenCalledWith(
                ENDPOINTS.SEND_ALERT_TO_USER,
                'post',
                {
                    toUserSlug: 'alice',
                    options: {
                        type: 'visio',
                        action: 'peer-access-permission',
                        room: 'call-room-1',
                        peerId: ctx.peerStore.getLocalPeerId,
                        inviteId,
                    },
                }
            )
        })

        it('retourne un inviteId non vide', async () => {
            const inviteId = await core.requestAuthorizationRemotePeerId(buildPayload())

            expect(inviteId).toBeDefined()
            expect(typeof inviteId).toBe('string')
            expect(inviteId.length).toBeGreaterThan(0)
        })

        it('réutilise l\'inviteId fourni dans le payload', async () => {
            const payload = buildPayload({ inviteId: 'my-custom-invite-id' })

            const inviteId = await core.requestAuthorizationRemotePeerId(payload)

            expect(inviteId).toBe('my-custom-invite-id')
            expect(ctx.AjaxService.load).toHaveBeenCalledWith(
                ENDPOINTS.SEND_ALERT_TO_USER,
                'post',
                expect.objectContaining({
                    options: expect.objectContaining({ inviteId: 'my-custom-invite-id' }),
                })
            )
        })

        it('génère deux inviteIds distincts pour deux appels différents sans inviteId fourni', async () => {
            const id1 = await core.requestAuthorizationRemotePeerId(buildPayload({ toUserSlug: 'alice' }))
            const id2 = await core.requestAuthorizationRemotePeerId(buildPayload({ toUserSlug: 'bob' }))

            expect(id1).not.toBe(id2)
        })

        it('appelle addWaitingRemotePeerId avec le bon slug et les bonnes données', async () => {
            ctx.session.currentCallRoomId = 'call-room-42'
            const payload = buildPayload()

            const inviteId = await core.requestAuthorizationRemotePeerId(payload)

            expect(ctx.peerStore.addWaitingRemotePeerId).toHaveBeenCalledWith(
                'alice',
                {
                    type: 'visio',
                    action: 'peer-access-permission',
                    room: 'call-room-42',
                    peerId: ctx.peerStore.getLocalPeerId,
                    inviteId,
                }
            )
        })

        it('planifie un retry : un second POST est envoyé après le premier délai', async () => {
            await core.requestAuthorizationRemotePeerId(buildPayload())

            // Seul l'envoi initial pour l'instant
            expect(ctx.AjaxService.load).toHaveBeenCalledOnce()

            // Avancer pour déclencher le premier retry (attempt 0 : délai max 1299ms)
            await vi.advanceTimersByTimeAsync(1300)

            expect(ctx.AjaxService.load).toHaveBeenCalledTimes(2)
        })

        it('le retry continue tant que l\'inviteId est dans la Map', async () => {
            await core.requestAuthorizationRemotePeerId(buildPayload())

            // Avancer pour déclencher attempt 0 (≤1299ms) puis attempt 1 (≤3599ms depuis start)
            await vi.advanceTimersByTimeAsync(5000)

            // Envoi initial + au moins 2 retries
            expect(ctx.AjaxService.load.mock.calls.length).toBeGreaterThanOrEqual(3)
        })

        it('le retry s\'arrête après stopCallInviteRetry', async () => {
            const inviteId = await core.requestAuthorizationRemotePeerId(buildPayload())

            core.stopCallInviteRetry(inviteId)

            await vi.advanceTimersByTimeAsync(60_000)

            // Seulement l'envoi initial, aucun retry
            expect(ctx.AjaxService.load).toHaveBeenCalledOnce()
        })

        it('ne throw pas si le POST initial échoue et planifie quand même le retry', async () => {
            ctx.AjaxService.load
                .mockRejectedValueOnce(new Error('Network error'))
                .mockResolvedValue({ data: {} })

            await expect(
                core.requestAuthorizationRemotePeerId(buildPayload())
            ).resolves.toBeDefined()

            // Avancer pour déclencher le retry
            await vi.advanceTimersByTimeAsync(1300)

            // Le retry a bien été envoyé malgré l'échec initial
            expect(ctx.AjaxService.load).toHaveBeenCalledTimes(2)
        })

        it('évince la plus ancienne entrée quand la Map atteint MAX_INVITE_RETRIES', async () => {
            // Remplir la Map jusqu'à MAX_INVITE_RETRIES
            for (let i = 0; i < MAX_INVITE_RETRIES; i++) {
                await core.requestAuthorizationRemotePeerId(buildPayload({ toUserSlug: `user-${i}` }))
            }

            // Réinitialiser le compteur pour n'observer que la suite
            ctx.AjaxService.load.mockClear()

            // 21ème entrée : déclenche l'éviction de user-0 (la plus ancienne)
            await core.requestAuthorizationRemotePeerId(buildPayload({ toUserSlug: 'new-user' }))

            // Avancer pour déclencher tous les retries attempt-0 (délai max 1299ms)
            await vi.advanceTimersByTimeAsync(1300)

            // user-0 a été évincé (son timer annulé) → son retry ne se déclenche pas
            // Attendu : 1 (initial new-user)
            //         + 19 (retries user-1..user-19)
            //         + 1  (retry new-user)
            //         = 21
            // Sans éviction ce serait 22 (+ le retry de user-0)
            expect(ctx.AjaxService.load).toHaveBeenCalledTimes(21)
        })
    })

    // ── sendAuthorizationRemotePeerId ───────────────────────────────────────

    describe('sendAuthorizationRemotePeerId', () => {

        const buildPayload = (overrides = {}) => ({
            fromUserSlug: 'bob',
            status: true,
            options: {
                type: 'visio',
                room: 'room-42',
                action: 'peer-access-permission',
            },
            ...overrides,
        })

        it('envoie un POST à RESPONSE_TO_AUTHORIZATION_PEER avec status true et les options complètes incluant le peerId local', async () => {
            ctx.peerStore.getLocalPeerId = 'local-peer-xyz'
            const payload = buildPayload()

            await core.sendAuthorizationRemotePeerId(payload)

            expect(ctx.AjaxService.load).toHaveBeenCalledOnce()
            expect(ctx.AjaxService.load).toHaveBeenCalledWith(
                ENDPOINTS.RESPONSE_TO_AUTHORIZATION_PEER,
                'post',
                {
                    toUserSlug: 'bob',
                    options: {
                        type: 'visio',
                        room: 'room-42',
                        action: 'peer-access-permission',
                        peerId: 'local-peer-xyz',
                    },
                    status: true,
                }
            )
        })

        it('injecte getLocalPeerId dans options.peerId quand status est true', async () => {
            ctx.peerStore.getLocalPeerId = 'peer-id-injected'
            const payload = buildPayload()

            await core.sendAuthorizationRemotePeerId(payload)

            const sentOptions = ctx.AjaxService.load.mock.calls[0][2].options
            expect(sentOptions.peerId).toBe('peer-id-injected')
        })

        it('envoie un POST à RESPONSE_TO_AUTHORIZATION_PEER avec status false et uniquement { type } dans options', async () => {
            const payload = buildPayload({
                status: false,
                options: {
                    type: 'visio',
                    room: 'room-42',
                    action: 'peer-access-permission',
                },
            })

            await core.sendAuthorizationRemotePeerId(payload)

            expect(ctx.AjaxService.load).toHaveBeenCalledOnce()
            expect(ctx.AjaxService.load).toHaveBeenCalledWith(
                ENDPOINTS.RESPONSE_TO_AUTHORIZATION_PEER,
                'post',
                {
                    toUserSlug: 'bob',
                    options: { type: 'visio' },
                    status: false,
                }
            )
        })

        it('n\'inclut pas peerId dans options quand status est false', async () => {
            ctx.peerStore.getLocalPeerId = 'should-not-appear'
            const payload = buildPayload({ status: false })

            await core.sendAuthorizationRemotePeerId(payload)

            const sentOptions = ctx.AjaxService.load.mock.calls[0][2].options
            expect(sentOptions).not.toHaveProperty('peerId')
        })

        it('ne throw pas si le POST Ajax échoue (erreur avalée)', async () => {
            ctx.AjaxService.load.mockRejectedValue(new Error('Network error'))
            const payload = buildPayload()

            await expect(core.sendAuthorizationRemotePeerId(payload)).resolves.toBeUndefined()
        })
    })
})
