/**
 * useBroadcastPresence.test.js
 *
 * Annonce « je diffuse / je ne diffuse plus », sur ses DEUX transports : le data channel
 * (`BROADCAST_STATE`) et le canal de présence Reverb (whisper).
 *
 * Ce qui doit tenir :
 *  - émission au bon MOMENT : à l'ouverture d'une connexion (le seul instant où l'on
 *    peut informer un arrivant de façon fiable) et au changement d'état local ;
 *  - jamais d'envoi dans le vide : `sendData` loggue par destinataire injoignable, un
 *    démarrage sans canal ouvert est un chemin NORMAL qui doit rester silencieux ;
 *  - identité en réception résolue depuis le TRANSPORT — `conn.metadata` sur le data
 *    channel, `metadata.user_id` régénéré par Reverb sur le whisper — jamais depuis la
 *    charge utile, qui est déclarative ;
 *  - un message d'annonce est consommé, donc jamais remonté au métier ;
 *  - le whisper informe un arrivant SANS aucun contact P2P, et re-part à chaque arrivée
 *    (un client event ne s'historise pas).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { withSetup } from './helpers/withSetup.js'
import { createMockContext } from './helpers/createMockContext.js'
import {
    useBroadcastPresence,
    BROADCAST_STATE,
    BROADCAST_STATE_WHISPER,
} from '~socializer/components/WebRTC2/Composables/useBroadcastPresence.js'

const MY_SLUG = 'me'

describe('useBroadcastPresence', () => {
    let ctx
    let transport
    let reverb
    let app

    const mount = () => {
        const [result, mounted] = withSetup(() => useBroadcastPresence(ctx, { transport, reverb }))
        app = mounted
        return result
    }

    /** Le handler d'annonce que le composable a branché sur le canal. */
    const whisperHandler = () => reverb.listenForWhisper.mock.calls
        .find(([event]) => event === BROADCAST_STATE_WHISPER)?.[1]

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
            connection: { remotePeers: ['alice', 'bob'] },
        })
        // L'annuaire que `getRoomUsersDiff` écrit en production : sans lui, aucun
        // `user_id` de whisper n'est traduisible en slug.
        ctx.connection.slugByUserId.set('11', 'alice')
        ctx.connection.slugByUserId.set('12', 'bob')
        ctx.connection.slugByUserId.set('99', MY_SLUG)

        transport = {
            sendData: vi.fn(),
            getDataReachablePeers: vi.fn(() => []),
        }
        reverb = {
            whisper: vi.fn(() => true),
            listenForWhisper: vi.fn(),
            stopListeningForWhisper: vi.fn(),
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

    describe('whisper de présence — émission', () => {
        // Quatrième chemin d'annonce, et le seul INDÉPENDANT de la signalisation P2P :
        // les trois autres ne disent rien quand il n'y a rien à demander (peerId déjà
        // connu sous bail — cas majoritaire d'une navigation SPA).
        it('annonce sur le canal quand je commence à diffuser', async () => {
            mount()

            ctx.media.isStreaming = true
            await nextTick()

            expect(reverb.whisper).toHaveBeenCalledWith(
                BROADCAST_STATE_WHISPER,
                { roomId: 'app', isBroadcasting: true }
            )
        })

        it('annonce même si AUCUN pair n\'est joignable en data', async () => {
            // ⭐ La raison d'être du second transport : le premier n'a rien à qui parler.
            transport.getDataReachablePeers.mockReturnValue([])
            mount()

            ctx.media.isStreaming = true
            await nextTick()

            expect(transport.sendData).not.toHaveBeenCalled()
            expect(reverb.whisper).toHaveBeenCalledTimes(1)
        })

        it('re-annonce à l\'arrivée d\'un pair, parce qu\'un whisper ne s\'historise pas', async () => {
            // ⭐ LE cas qui ferme la fenêtre du peerId sous bail : l'arrivant ne peut rien
            // savoir d'un état antérieur à son arrivée, c'est au diffuseur de re-parler.
            ctx.media.isStreaming = true
            mount()
            reverb.whisper.mockClear()

            ctx.connection.remotePeers = ['alice', 'bob', 'carol']
            await nextTick()

            expect(reverb.whisper).toHaveBeenCalledTimes(1)
        })

        it('ne re-annonce pas quand la composition ne fait que PERDRE un pair', async () => {
            ctx.media.isStreaming = true
            mount()
            reverb.whisper.mockClear()

            ctx.connection.remotePeers = ['alice']
            await nextTick()

            expect(reverb.whisper).not.toHaveBeenCalled()
        })

        it('reste muet à l\'arrivée d\'un pair quand je ne diffuse pas', async () => {
            mount()

            ctx.connection.remotePeers = ['alice', 'bob', 'carol']
            await nextTick()

            expect(reverb.whisper).not.toHaveBeenCalled()
        })

        it('n\'annonce JAMAIS un arrêt de diffusion', async () => {
            // La réception ne purge pas (voir plus bas) : un `false` ne servirait personne,
            // et donnerait à un membre hostile un moyen d'éteindre une vignette vraie.
            ctx.media.isStreaming = true
            mount()
            reverb.whisper.mockClear()

            ctx.media.isStreaming = false
            await nextTick()

            expect(reverb.whisper).not.toHaveBeenCalled()
        })

        it('ne jette pas quand l\'hôte ne fournit aucun canal', async () => {
            // État de production valide : un hôte qui ne `provide` pas REVERB_CHANNEL
            // garde exactement le comportement d'avant ce transport.
            reverb = null
            const presence = mount()

            ctx.media.isStreaming = true
            await nextTick()

            expect(presence.announceBroadcastStateOnChannel()).toBe(false)
        })
    })

    describe('whisper de présence — réception', () => {
        it('enregistre le pair depuis le user_id que Reverb a posé', () => {
            const presence = mount()

            const noted = presence.handleBroadcastStateWhisper(
                { roomId: 'app', isBroadcasting: true },
                { user_id: 11 }
            )

            expect(noted).toBe(true)
            expect(ctx.announcedStreamPeers.value).toEqual(['alice'])
        })

        it('accepte un user_id numérique comme un user_id chaîne', () => {
            // Reverb repose le champ tel qu'il l'a reçu de l'auth, pusher-js ne le
            // convertit pas : comparer des types stricts échouerait en silence.
            const presence = mount()

            expect(presence.handleBroadcastStateWhisper(
                { roomId: 'app', isBroadcasting: true },
                { user_id: '11' }
            )).toBe(true)
        })

        it('ignore l\'annonce d\'une AUTRE room du même canal', () => {
            // Une page monte plusieurs contextes sur un seul canal de présence
            // (`Exemples/Home.vue` en monte trois) : sans ce filtre, chacun afficherait
            // les vignettes des autres.
            const presence = mount()

            expect(presence.handleBroadcastStateWhisper(
                { roomId: 'une-autre-room', isBroadcasting: true },
                { user_id: 11 }
            )).toBe(false)
            expect(ctx.announcedStreamPeers.value).toEqual([])
        })

        it('ignore un whisper que Reverb n\'a PAS attribué, et le dit une fois', () => {
            // ⭐ Fail-closed. Sous `accept_client_events_from: 'all'`, Reverb retransmet
            // l'événement brut : pas de contrôle d'appartenance, et un `user_id` que
            // l'émetteur a pu écrire lui-même. Un whisper non attribué n'est pas une
            // annonce sans nom, c'est une annonce dont le nom est celui de l'émetteur.
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
            const presence = mount()

            expect(presence.handleBroadcastStateWhisper({ roomId: 'app', isBroadcasting: true }, {})).toBe(false)
            expect(presence.handleBroadcastStateWhisper({ roomId: 'app', isBroadcasting: true }, undefined)).toBe(false)
            expect(ctx.announcedStreamPeers.value).toEqual([])

            expect(warn).toHaveBeenCalledTimes(1)
            expect(warn.mock.calls[0][0]).toContain('accept_client_events_from')
            warn.mockRestore()
        })

        it('ignore un user_id absent de l\'annuaire de la room', () => {
            const presence = mount()

            expect(presence.handleBroadcastStateWhisper(
                { roomId: 'app', isBroadcasting: true },
                { user_id: 4242 }
            )).toBe(false)
            expect(ctx.announcedStreamPeers.value).toEqual([])
        })

        it('n\'efface JAMAIS une annonce existante sur un whisper à false', () => {
            const presence = mount()
            presence.handleBroadcastStateWhisper({ roomId: 'app', isBroadcasting: true }, { user_id: 11 })

            presence.handleBroadcastStateWhisper({ roomId: 'app', isBroadcasting: false }, { user_id: 11 })

            expect(ctx.announcedStreamPeers.value).toEqual(['alice'])
        })

        it('ne s\'enregistre pas soi-même', () => {
            const presence = mount()

            expect(presence.handleBroadcastStateWhisper(
                { roomId: 'app', isBroadcasting: true },
                { user_id: 99 }
            )).toBe(false)
            expect(ctx.announcedStreamPeers.value).toEqual([])
        })

        it('branche son handler sur le canal dès l\'init, avant tout contact P2P', () => {
            mount()

            expect(whisperHandler()).toBeTypeOf('function')
        })

        it('se désabonne en nommant SON handler, pas l\'événement', async () => {
            // ⭐ Plusieurs contextes partagent un canal : un désabonnement nu les rendrait
            // tous sourds (cf. `useReverbChannel.removeHandler`).
            const presence = mount()
            const handler = whisperHandler()

            presence.stopBroadcastPresence()

            expect(reverb.stopListeningForWhisper).toHaveBeenCalledWith(
                BROADCAST_STATE_WHISPER,
                handler
            )
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

            ctx.connection.remotePeers = ['bob']
            await nextTick()

            expect(ctx.announcedStreamPeers.value).toEqual([])
        })

        it('conserve l\'annonce des pairs toujours présents', async () => {
            const presence = mount()
            presence.handleBroadcastStateMessage(
                { type: BROADCAST_STATE, isBroadcasting: true },
                incomingConn('alice')
            )

            ctx.connection.remotePeers = ['alice']
            await nextTick()

            expect(ctx.announcedStreamPeers.value).toEqual(['alice'])
        })
    })
})
