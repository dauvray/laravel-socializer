/**
 * usePeerCore.test.js — Tâche 1 : Signaling layer
 * Périmètre : couche HTTP/Ajax pure, sans WebRTC.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockContext } from './helpers/createMockContext.js'
import { withSetup } from './helpers/withSetup.js'
import { usePeerCore } from '~socializer/components/WebRTC2/Composables/usePeerCore.js'
import { ENDPOINTS, SIGNALING_STALE_MS } from '~socializer/components/WebRTC2/webrtc2.config.js'

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
                    type: ctx.session.currentType,
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

        it('ne throw pas si le POST Ajax échoue (erreur avalée)', async () => {
            ctx.AjaxService.load.mockRejectedValue(new Error('Network error'))
            const payload = buildPayload()

            await expect(core.responseRemotePeerConnection(payload)).resolves.toBeUndefined()
        })
    })
})
