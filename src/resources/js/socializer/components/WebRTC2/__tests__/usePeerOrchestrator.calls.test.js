/**
 * usePeerOrchestrator.calls.test.js — ce qu'un appel hérite du précédent, dans le contexte d'appel
 *
 * Vraies couches (orchestrateur + call manager + media), PeerJS mocké, monté comme
 * `Notifications.vue` : contexte `data` sur la room `app`, côté appelé (`acceptCallFromPeer`).
 * Repris de la sonde de la relecture du 2026-10-29, qui a établi le défaut.
 *
 * ── Le fait ──────────────────────────────────────────────────────────────────────────────
 *
 * `startCurrentStream` demande `audio: !isMuted`, et l'arrêt complet ne remettait pas `isMuted` à
 * zéro : un micro coupé dans un appel donnait, au suivant, une capture SANS piste audio — que
 * « activer le son » ne rattrape pas, `toggleAudioState` ne basculant que les pistes existantes.
 * En vocal, `getUserMedia({ video: false, audio: false })` rejette, et l'acceptation avec lui.
 * Décision du 2026-10-29 : un appel démarre micro ouvert. La caméra, elle, garde son réglage.
 * La remise à zéro vit dans le `finally` de l'arrêt complet : elle tient aussi quand il lève.
 *
 * ── Le harnais ───────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ `installFakeMedia()` rend une piste audio ET vidéo quelles que soient les contraintes : il ne
 * verrait pas le défaut. Ce fichier le remplace par un `getUserMedia` qui RESPECTE les contraintes,
 * et rejette `{ audio: false, video: false }` en `TypeError` comme l'impose la spec Media Capture —
 * simulé, pas rejoué dans un navigateur.
 *
 * ⚠️ Le conteneur `#videoContainer` est posé dans le DOM, et ce n'est pas décoratif.
 * `_enterCallSession` n'attend pas `media.createVideoElement`, dont la promesse REJETTE sans lui :
 * chaque capture laissait deux rejets non traités. Couper la console n'y change rien — vitest les
 * compte en erreurs, et la suite sortait en code 1 avec tous ses cas verts, ce que le hook
 * `pre-push` refuse. Mesuré par la relecture : 6 erreurs, exit 1 ; 0 erreur, exit 0 avec lui.
 *
 * ── Contre-épreuves (mesurées le 2026-10-29, suite entière) ──────────────────────────────
 *
 *   | Neutralisé dans le `finally` de `stopCallWithPeers`    | Rougit                       |
 *   |--------------------------------------------------------|------------------------------|
 *   | la remise à `false` de `isMuted`                       | les trois ⭐                  |
 *   | la remise dans `resetCallState` (1re version du lot)   | « un arrêt complet qui lève » |
 *   | la caméra rouverte aussi (`isVideoEnabled = true`)     | « la caméra coupée… »        |
 *   | la garde `mode !== 'partial'` retirée                  | aucun ici — un cas de        |
 *   |                                                        | `useCallManager.test.js`     |
 *
 * Les ⭐ sont nés rouges : `{ video: true, audio: false }` en visio, le `TypeError` en vocal.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { withSetup } from './helpers/withSetup.js'
import { mockEventBus } from './helpers/mockEventBus.js'
import { bootLocalPeer } from './helpers/bootLocalPeer.js'
import { installFakeMedia, fakeTrack, realStream } from './helpers/fakeMedia.js'
import { resetPeerMock } from './__mocks__/peerjs.js'
import { usePeerOrchestrator } from '~socializer/components/WebRTC2/Composables/usePeerOrchestrator.js'
import { usePeer2Store } from '~socializer/stores/peers2.js'
import { useMeStore } from '~estarter/stores/me.js'

/** Rend la main jusqu'à la vidange COMPLÈTE de la file de microtâches. */
const settleTasks = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('usePeerOrchestrator — un appel démarre micro ouvert', () => {
    let app
    let api
    let contraintes

    beforeEach(async () => {
        document.body.innerHTML = '<div id="videoContainer"></div>'
        resetPeerMock()
        installFakeMedia()
        contraintes = []
        navigator.mediaDevices.getUserMedia.mockImplementation(async (demande) => {
            contraintes.push({ ...demande })
            if (!demande.audio && !demande.video) {
                throw new TypeError('At least one of audio and video must be requested')
            }
            const pistes = []
            if (demande.video) pistes.push(fakeTrack('video'))
            if (demande.audio) pistes.push(fakeTrack('audio'))
            return realStream(pistes)
        })

        useMeStore().user = { slug: 'me', name: 'Me' }
        usePeer2Store().lastLocalPeerId = 'my-peer-id'
        for (const niveau of ['log', 'info', 'debug', 'warn', 'error']) {
            vi.spyOn(console, niveau).mockImplementation(() => {})
        }

        ;[api, app] = withSetup(
            () => usePeerOrchestrator('data', 'app'),
            { provides: { eventBus: mockEventBus() } },
        )
        await bootLocalPeer(() => api.initializePeerConnection({}), { peerId: 'my-peer-id' })
    })

    afterEach(() => {
        try { app.unmount() } catch { /* déjà démontée */ }
        document.body.innerHTML = ''
        vi.restoreAllMocks()
    })

    const accepter = async (room, type = 'visio') => {
        await api.acceptCallFromPeer({
            fromUserSlug: 'alice',
            status: true,
            options: { type, room, peerId: 'peer-alice', inviteId: `invite-${room}`, action: 'peer-access-permission' },
        })
        await settleTasks()
    }

    /** L'arrêt de `Notifications.onStopCall`, sans signal au distant. */
    const raccrocher = () => api.stopCallWithPeers([{ userSlug: 'alice', type: 'visio' }], false, { mode: 'full' })

    const pistesAudio = () => api.currentStream.value?.getAudioTracks().length ?? 0

    it('⭐ micro coupé dans l\'appel précédent : l\'appel visio suivant capture le micro, ouvert', async () => {
        await accepter('call-1')
        api.toggleAudioState()
        expect(api.isMuted.value).toBe(true)
        await raccrocher()

        await accepter('call-2')

        expect(contraintes.at(-1)).toEqual({ video: true, audio: true })
        expect(pistesAudio()).toBe(1)
        expect(api.isMuted.value).toBe(false)
    })

    it('⭐ micro coupé dans l\'appel précédent : l\'appel VOCAL suivant s\'établit', async () => {
        await accepter('call-1')
        api.toggleAudioState()
        await raccrocher()

        await expect(accepter('call-2', 'vocal')).resolves.toBeUndefined()

        expect(contraintes.at(-1)).toEqual({ video: false, audio: true })
        expect(pistesAudio()).toBe(1)
    })

    it('⭐ un arrêt complet qui lève rouvre quand même le micro', async () => {
        // L'échec est forcé — qu'une exception réelle soit atteignable dans l'arrêt complet n'est
        // pas établi. C'est la même borne que la room laissée en place (`flux.md`), fermée ici
        // pour le micro : le `finally` remet déjà la FSM au repos, il rouvre aussi le micro.
        await accepter('call-1')
        api.toggleAudioState()
        api.currentStream.value.getTracks()[0].stop.mockImplementation(() => {
            throw new Error('piste déjà détruite')
        })

        await expect(raccrocher()).rejects.toThrow('piste déjà détruite')
        expect(api.isMuted.value).toBe(false)

        await accepter('call-2', 'vocal')

        expect(contraintes.at(-1)).toEqual({ video: false, audio: true })
    })

    it('la caméra coupée le reste à l\'appel suivant — seul le micro est rouvert', async () => {
        // « Un utilisateur qui a coupé sa caméra la verrait se rallumer à l'appel suivant » :
        // docblock de `startCurrentStream`. La remise à zéro du micro ne doit pas l'emporter.
        await accepter('call-1')
        api.toggleVideoState()
        await raccrocher()

        await accepter('call-2')

        expect(contraintes.at(-1)).toEqual({ video: false, audio: true })
        expect(api.isVideoEnabled.value).toBe(false)
    })
})
