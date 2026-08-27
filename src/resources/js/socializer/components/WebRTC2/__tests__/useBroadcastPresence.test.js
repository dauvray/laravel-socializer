/**
 * useBroadcastPresence.test.js
 *
 * Annonce protocolaire « je diffuse / je ne diffuse plus » sur le data channel.
 *
 * Ce qui doit tenir :
 *  - émission au bon MOMENT : à l'ouverture d'une connexion (le seul instant où l'on
 *    peut informer un arrivant de façon fiable) et au changement d'état local ;
 *  - jamais d'envoi dans le vide : `sendData` loggue par destinataire injoignable, un
 *    démarrage sans canal ouvert est un chemin NORMAL qui doit rester silencieux ;
 *  - identité en réception résolue depuis la CONNEXION, jamais depuis le payload
 *    (`data.from` serait usurpable) ;
 *  - un message d'annonce est consommé, donc jamais remonté au métier.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { withSetup } from './helpers/withSetup.js'
import { createMockContext } from './helpers/createMockContext.js'
import {
    useBroadcastPresence,
    BROADCAST_STATE,
} from '~socializer/components/WebRTC2/Composables/useBroadcastPresence.js'

const MY_SLUG = 'me'

describe('useBroadcastPresence', () => {
    let ctx
    let transport
    let app

    const mount = () => {
        const [result, mounted] = withSetup(() => useBroadcastPresence(ctx, { transport }))
        app = mounted
        return result
    }

    /** Connexion entrante ouverte par le distant : `from` = le distant. */
    const incomingConn = (from = 'alice') => ({
        open: true,
        send: vi.fn(),
        peer: `peer-${from}`,
        metadata: { from, slug: MY_SLUG, type: 'stream', room: 'app' },
    })

    /** Connexion sortante ouverte par moi : `from` = moi, `slug` = la cible. */
    const outgoingConn = (target = 'alice') => ({
        open: true,
        send: vi.fn(),
        peer: `peer-${target}`,
        metadata: { from: MY_SLUG, slug: target, type: 'stream', room: 'app' },
    })

    beforeEach(() => {
        ctx = createMockContext({
            meStore: { getMe: { slug: MY_SLUG, name: 'Me' } },
            session: { currentType: 'stream', onAirRoom: 'app' },
            connection: { usersInRoom: ['alice', 'bob'] },
        })
        transport = {
            sendData: vi.fn(),
            getDataReachablePeers: vi.fn(() => []),
        }
    })

    afterEach(() => {
        app?.unmount()
    })

    describe('émission', () => {
        it('annonce sur une connexion qui vient de s\'ouvrir quand je diffuse', () => {
            ctx.media.isStreaming = true
            const presence = mount()
            const conn = outgoingConn('alice')

            expect(presence.announceBroadcastStateTo(conn)).toBe(true)
            expect(conn.send).toHaveBeenCalledWith(
                expect.objectContaining({ type: BROADCAST_STATE, isBroadcasting: true, roomId: 'app' })
            )
        })

        it('reste muet à l\'ouverture quand je ne diffuse pas', () => {
            // L'absence d'annonce EST l'information « pas de flux en route ».
            const presence = mount()
            const conn = outgoingConn('alice')

            expect(presence.announceBroadcastStateTo(conn)).toBe(false)
            expect(conn.send).not.toHaveBeenCalled()
        })

        it('n\'annonce pas sur une connexion non ouverte ou sans canal data', () => {
            ctx.media.isCapturing = true
            const presence = mount()

            expect(presence.announceBroadcastStateTo({ open: false, send: vi.fn() })).toBe(false)
            // MediaConnection : pas de `send`
            expect(presence.announceBroadcastStateTo({ open: true })).toBe(false)
            expect(presence.announceBroadcastStateTo(null)).toBe(false)
        })

        it('diffuse l\'état aux pairs joignables au changement d\'état local', async () => {
            transport.getDataReachablePeers.mockReturnValue(['alice'])
            mount()

            ctx.media.isStreaming = true
            await nextTick()

            expect(transport.sendData).toHaveBeenCalledWith(
                expect.objectContaining({ type: BROADCAST_STATE, isBroadcasting: true }),
                ['alice']
            )
        })

        it('annonce aussi l\'arrêt (isBroadcasting: false) si un canal reste ouvert', async () => {
            transport.getDataReachablePeers.mockReturnValue(['alice'])
            ctx.media.isStreaming = true
            ctx.media.isCapturing = true
            mount()

            // Arrêt du partage d'écran : la webcam tient encore la connexion ouverte.
            ctx.media.isCapturing = false
            await nextTick()
            expect(transport.sendData).toHaveBeenLastCalledWith(
                expect.objectContaining({ isBroadcasting: true }),
                ['alice']
            )

            ctx.media.isStreaming = false
            await nextTick()
            expect(transport.sendData).toHaveBeenLastCalledWith(
                expect.objectContaining({ isBroadcasting: false }),
                ['alice']
            )
        })

        it('ne confie rien au transport si aucun pair n\'est joignable en data', async () => {
            // Chemin NORMAL au premier démarrage : le canal naît avec l'appel média.
            mount()

            ctx.media.isStreaming = true
            await nextTick()

            expect(transport.sendData).not.toHaveBeenCalled()
        })

        it('laisse le transport router en topologie star (pas de destinataires forcés)', async () => {
            ctx.session.topology = 'star'
            ctx.session.hubSlug = 'hub'
            transport.getDataReachablePeers.mockReturnValue(['hub'])
            mount()

            ctx.media.isStreaming = true
            await nextTick()

            expect(transport.sendData).toHaveBeenCalledWith(
                expect.objectContaining({ type: BROADCAST_STATE }),
                null
            )
        })

        it('n\'annonce plus après stopBroadcastPresence', async () => {
            transport.getDataReachablePeers.mockReturnValue(['alice'])
            const presence = mount()

            presence.stopBroadcastPresence()
            ctx.media.isStreaming = true
            await nextTick()

            expect(transport.sendData).not.toHaveBeenCalled()
        })
    })

    describe('réception', () => {
        it('enregistre le pair sur une connexion entrante (identité = metadata.from)', () => {
            const presence = mount()

            const handled = presence.handleBroadcastStateMessage(
                { type: BROADCAST_STATE, isBroadcasting: true },
                incomingConn('alice')
            )

            expect(handled).toBe(true)
            expect(ctx.announcedStreamPeers.value).toEqual(['alice'])
        })

        it('enregistre le pair sur ma connexion sortante (identité = metadata.slug)', () => {
            // Le distant répond sur la connexion que J'AI ouverte : `from` y porte mon slug.
            const presence = mount()

            presence.handleBroadcastStateMessage(
                { type: BROADCAST_STATE, isBroadcasting: true },
                outgoingConn('bob')
            )

            expect(ctx.announcedStreamPeers.value).toEqual(['bob'])
        })

        it('retire le pair quand il annonce ne plus diffuser', () => {
            const presence = mount()
            const conn = incomingConn('alice')
            presence.handleBroadcastStateMessage({ type: BROADCAST_STATE, isBroadcasting: true }, conn)

            presence.handleBroadcastStateMessage({ type: BROADCAST_STATE, isBroadcasting: false }, conn)

            expect(ctx.announcedStreamPeers.value).toEqual([])
        })

        it('ignore une identité déclarée dans le payload', () => {
            // Tentative d'usurpation : le payload prétend venir de bob, la connexion dit alice.
            const presence = mount()

            presence.handleBroadcastStateMessage(
                { type: BROADCAST_STATE, isBroadcasting: true, from: 'bob' },
                incomingConn('alice')
            )

            expect(ctx.announcedStreamPeers.value).toEqual(['alice'])
        })

        it('consomme l\'annonce même si le pair n\'est pas résolu (jamais remontée au métier)', () => {
            const presence = mount()

            const handled = presence.handleBroadcastStateMessage(
                { type: BROADCAST_STATE, isBroadcasting: true },
                { open: true, metadata: { from: MY_SLUG, slug: MY_SLUG } }
            )

            expect(handled).toBe(true)
            expect(ctx.announcedStreamPeers.value).toEqual([])
        })

        it('star, côté client : n\'attribue pas au hub une annonce qu\'il relaie', () => {
            // Le hub retransmet le payload nu : l'émetteur d'origine est perdu. Attribuer
            // l'annonce au hub afficherait une vignette sur un pair qui ne diffuse pas.
            ctx.session.topology = 'star'
            ctx.session.hubSlug = 'alice'
            ctx.session.isHub = false
            const presence = mount()

            const handled = presence.handleBroadcastStateMessage(
                { type: BROADCAST_STATE, isBroadcasting: true },
                incomingConn('alice')
            )

            expect(handled).toBe(true)
            expect(ctx.announcedStreamPeers.value).toEqual([])
        })

        it('star, côté hub : enregistre bien l\'annonce d\'un client', () => {
            ctx.session.topology = 'star'
            ctx.session.hubSlug = MY_SLUG
            ctx.session.isHub = true
            const presence = mount()

            presence.handleBroadcastStateMessage(
                { type: BROADCAST_STATE, isBroadcasting: true },
                incomingConn('alice')
            )

            expect(ctx.announcedStreamPeers.value).toEqual(['alice'])
        })

        it('ne consomme pas un message métier', () => {
            const presence = mount()

            expect(presence.handleBroadcastStateMessage({ message: 'coucou' }, incomingConn())).toBe(false)
            expect(presence.handleBroadcastStateMessage({ type: 'AUDIO_MUTE_TOGGLE' }, incomingConn())).toBe(false)
            expect(presence.handleBroadcastStateMessage('coucou', incomingConn())).toBe(false)
            expect(presence.handleBroadcastStateMessage(null, incomingConn())).toBe(false)
        })
    })

    describe('réception depuis la signalisation serveur', () => {
        // Troisième chemin d'annonce, et le seul qui n'exige AUCUN contact P2P : il ferme
        // la fenêtre entre l'arrivée dans la room et le premier `peer.call`, où rien
        // n'était localement observable. L'identité vient de `fromUserSlug`, que le
        // backend force à l'authentifié.
        it('enregistre le pair quand le signal annonce une diffusion', () => {
            const presence = mount()

            const noted = presence.noteBroadcastFromSignal({
                fromUserSlug: 'alice',
                room: 'app',
                type: 'stream',
                isBroadcasting: true,
            })

            expect(noted).toBe(true)
            expect(ctx.announcedStreamPeers.value).toEqual(['alice'])
        })

        it('n\'enregistre rien quand le champ est absent (client ou backend non à jour)', () => {
            const presence = mount()

            expect(presence.noteBroadcastFromSignal({ fromUserSlug: 'alice' })).toBe(false)
            expect(ctx.announcedStreamPeers.value).toEqual([])
        })

        it('n\'efface JAMAIS une annonce existante sur un signal à false', () => {
            // ⚠️ L'asymétrie avec `BROADCAST_STATE`, qui purge : celui-ci voyage sur un
            // data channel ordonné, au changement d'état. Un signal de signalisation est
            // un instantané embarqué sur un chemin HTTP + Reverb sans garantie d'ordre —
            // un `false` en retard effacerait une annonce vraie, et la vignette
            // disparaîtrait alors que le flux est en route.
            const presence = mount()
            presence.handleBroadcastStateMessage(
                { type: BROADCAST_STATE, isBroadcasting: true },
                incomingConn('alice')
            )

            presence.noteBroadcastFromSignal({ fromUserSlug: 'alice', isBroadcasting: false })

            expect(ctx.announcedStreamPeers.value).toEqual(['alice'])
        })

        it('ne s\'enregistre pas soi-même', () => {
            // Garde déjà porté par `ctx.markAnnouncedStream`, épinglé ici parce que c'est
            // la seule alimentation dont la source n'est pas une connexion distante.
            const presence = mount()

            expect(presence.noteBroadcastFromSignal({
                fromUserSlug: MY_SLUG,
                isBroadcasting: true,
            })).toBe(false)
            expect(ctx.announcedStreamPeers.value).toEqual([])
        })

        it('ignore un slug malformé', () => {
            const presence = mount()

            expect(presence.noteBroadcastFromSignal({
                fromUserSlug: 'pas un slug !',
                isBroadcasting: true,
            })).toBe(false)
            expect(ctx.announcedStreamPeers.value).toEqual([])
        })
    })

    describe('purge', () => {
        it('oublie l\'annonce d\'un pair qui quitte la room', async () => {
            const presence = mount()
            presence.handleBroadcastStateMessage(
                { type: BROADCAST_STATE, isBroadcasting: true },
                incomingConn('alice')
            )
            expect(ctx.announcedStreamPeers.value).toEqual(['alice'])

            ctx.connection.usersInRoom = ['bob']
            await nextTick()

            expect(ctx.announcedStreamPeers.value).toEqual([])
        })

        it('conserve l\'annonce des pairs toujours présents', async () => {
            const presence = mount()
            presence.handleBroadcastStateMessage(
                { type: BROADCAST_STATE, isBroadcasting: true },
                incomingConn('alice')
            )

            ctx.connection.usersInRoom = ['alice']
            await nextTick()

            expect(ctx.announcedStreamPeers.value).toEqual(['alice'])
        })
    })
})
