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
 * Côté APPELANT, une fenêtre de plus : il passe CONNECTED dès l'acceptation, avant sa propre
 * capture, et la barre d'appel offre « couper le son » / « couper la caméra » pendant l'invite de
 * permission. Les contraintes étaient lues avant le clic, et rien n'appliquait les drapeaux aux
 * pistes qui arrivaient : elles entraient actives sous un drapeau « coupé ». `startCurrentStream`
 * leur applique désormais l'état courant au retour de `getUserMedia`.
 *
 * La CAMÉRA coupée, elle, est reportée — mais elle n'était pas capturée. Deux effets : « activer
 * la caméra » ne rallumait rien, et l'APPELANT ne recevait plus la vidéo de l'appelé, son offre
 * n'ayant aucune ligne vidéo (deux écrans noirs, vu par David le 2026-10-29 ; le mécanisme SDP
 * est mesuré dans Chromium, `flux.md`). Décision du même jour : la caméra est capturée selon le
 * TYPE seul, et le réglage ne fait que désactiver sa piste.
 *
 * La relecture a mesuré ce que cela cassait : un poste SANS caméra qui l'avait coupée (le bouton
 * caméra d'un appel vocal y suffit) voyait l'appel visio suivant rejeter, alors qu'il passait en
 * audio seul. Choix de David, le même jour : capturer, se replier sur l'audio seul si la caméra
 * COUPÉE est indisponible, et faire DEMANDER la vidéo du pair par l'offre visio
 * (`offerToReceiveVideo`), pour que le repli ne rouvre pas les deux écrans noirs.
 *
 * ── Le harnais ───────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ `installFakeMedia()` rend une piste audio ET vidéo quelles que soient les contraintes : il ne
 * verrait pas le défaut. Ce fichier le remplace par un `getUserMedia` qui RESPECTE les contraintes,
 * et rejette `{ audio: false, video: false }` en `TypeError` comme l'impose la spec Media Capture —
 * simulé, pas rejoué dans un navigateur. `sansCamera` y simule un poste sans caméra : toute demande
 * vidéo rejette en `NotFoundError`, le nom que rend Chromium.
 *
 * ⚠️ Le conteneur `#videoContainer` est posé dans le DOM, et ce n'est pas décoratif.
 * `_enterCallSession` n'attend pas `media.createVideoElement`, dont la promesse REJETTE sans lui :
 * chaque capture laissait deux rejets non traités. Couper la console n'y change rien — vitest les
 * compte en erreurs, et la suite sortait en code 1 avec tous ses cas verts, ce que le hook
 * `pre-push` refuse. Mesuré par la relecture : 6 erreurs, exit 1 ; 0 erreur, exit 0 avec lui.
 *
 * ── Contre-épreuves (mesurées le 2026-10-29, suite entière, chacune exit 1) ─────────────
 *
 * Les deux premières tables sont mesurées à leur lot : elles ne listent pas les cas ajoutés depuis.
 * Les deux dernières le sont sur l'état final.
 *
 *   | Neutralisé dans le `finally` de `stopCallWithPeers`    | Rougit                       |
 *   |--------------------------------------------------------|------------------------------|
 *   | la remise à `false` de `isMuted`                       | les trois ⭐                  |
 *   | la remise dans `resetCallState` (1re version du lot)   | « un arrêt complet qui lève » |
 *   | la caméra rouverte aussi (`isVideoEnabled = true`)     | « la caméra coupée… »        |
 *   | la garde `mode !== 'partial'` retirée                  | aucun ici — un cas de        |
 *   |                                                        | `useCallManager.test.js`     |
 *
 *   | Neutralisé dans `startCurrentStream` (au retour de la capture)  | Rougit                 |
 *   |-----------------------------------------------------------------|------------------------|
 *   | l'application des drapeaux aux pistes, ou l'une de ses deux     | « ⭐ appelant… », et le |
 *   | lignes, ou la ligne audio inversée ou forcée à `true`           | ⭐ d'`usePeerMedia`     |
 *   | toute piste audio — ou vidéo — forcée à `enabled = false`       | aucun ici — le contrat |
 *   |                                                                 | « …arrivent actives »  |
 *   |                                                                 | d'`usePeerMedia`       |
 *
 * La dernière ligne est la raison d'être de ce contrat : les deux ⭐ attendent `false`, et
 * « toute piste arrive coupée » les passait — un appel où l'on se croit entendu sans l'être.
 *
 *   | Neutralisé dans `startCurrentStream` (caméra reportée)    | Rougit (suite entière)          |
 *   |-----------------------------------------------------------|---------------------------------|
 *   | la capture rendue au réglage (`&& isVideoEnabled`)        | « la caméra coupée le reste… », |
 *   |                                                           | « ⭐ …« activer la caméra »… », |
 *   |                                                           | « ⭐ appelant, caméra coupée… », |
 *   |                                                           | « ⭐ caméra coupée puis         |
 *   |                                                           | indisponible… », et 3 cas       |
 *   |                                                           | d'`usePeerMedia`                |
 *   | la ligne vidéo de l'application des drapeaux              | « ⭐ appelant, caméra coupée… », |
 *   |                                                           | « la caméra coupée le reste… », |
 *   |                                                           | « ⭐ appelant : couper… », et   |
 *   |                                                           | 2 ⭐ d'`usePeerMedia`           |
 *   | le veto vocal (`video: true`)                             | les deux ⭐ dont l'appel 2 est  |
 *   |                                                           | vocal (« …s'établit », « un     |
 *   |                                                           | arrêt complet qui lève… »), les |
 *   |                                                           | deux ⭐ « sans caméra » (l'appel |
 *   |                                                           | 1 vocal y capture la vidéo), et |
 *   |                                                           | le ⭐ vocal d'`usePeerMedia`     |
 *
 *   | Neutralisé (repli et offre, choix c)                      | Rougit (suite entière)          |
 *   |-----------------------------------------------------------|---------------------------------|
 *   | le repli audio de `startCurrentStream`                    | les deux ⭐ « sans caméra » ici, |
 *   |                                                           | et le ⭐ de repli d'`usePeerMedia` |
 *   | le repli même caméra OUVERTE                              | aucun ici — le contrat « caméra |
 *   |                                                           | OUVERTE… » d'`usePeerMedia`      |
 *   | le repli même micro coupé                                 | aucun ici — le contrat « caméra |
 *   |                                                           | ET micro coupés… » d'`usePeerMedia` |
 *   | les contraintes d'offre de la branche visio               | « ⭐ appelant sans caméra… », et |
 *   |                                                           | le ⭐ de `usePeerConnections`    |
 *   | les contraintes d'offre étendues au vocal                 | aucun ici — le contrat vocal de |
 *   |                                                           | `usePeerConnections`             |
 *
 * Les ⭐ sont nés rouges : `{ video: true, audio: false }` en visio, le `TypeError` en vocal ;
 * pour la caméra, aucune piste vidéo (`[]`), y compris dans le flux passé à `peer.call` ; pour le
 * repli, l'acceptation rejetée en `NotFoundError` ; pour l'offre, `constraints` absent.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { withSetup } from './helpers/withSetup.js'
import { mockEventBus } from './helpers/mockEventBus.js'
import { bootLocalPeer } from './helpers/bootLocalPeer.js'
import { installFakeMedia, fakeTrack, realStream } from './helpers/fakeMedia.js'
import { resetPeerMock, getLastPeerInstance } from './__mocks__/peerjs.js'
import { usePeerOrchestrator } from '~socializer/components/WebRTC2/Composables/usePeerOrchestrator.js'
import { usePeer2Store } from '~socializer/stores/peers2.js'
import { useMeStore } from '~estarter/stores/me.js'

// L'appelant invite (POST `/send-alert-to-user`) : une réponse vide suffit, rien n'est lu dedans.
vi.mock('~estarter/services/AjaxService.js', () => ({
    useAjaxService: () => ({ load: vi.fn(async () => ({ data: {} })) }),
}))

/** Rend la main jusqu'à la vidange COMPLÈTE de la file de microtâches. */
const settleTasks = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('usePeerOrchestrator — un appel démarre micro ouvert', () => {
    let app
    let api
    let contraintes
    /** Vrai : la prochaine capture reste suspendue — l'invite de permission est ouverte. */
    let suspendre
    /** Referme l'invite suspendue : la capture résout. */
    let livrer
    /** Vrai : le poste n'a pas de caméra — toute demande vidéo rejette, comme Chromium. */
    let sansCamera

    beforeEach(async () => {
        document.body.innerHTML = '<div id="videoContainer"></div>'
        resetPeerMock()
        installFakeMedia()
        contraintes = []
        suspendre = false
        livrer = null
        sansCamera = false
        navigator.mediaDevices.getUserMedia.mockImplementation((demande) => {
            contraintes.push({ ...demande })
            if (!demande.audio && !demande.video) {
                return Promise.reject(new TypeError('At least one of audio and video must be requested'))
            }
            if (sansCamera && demande.video) {
                return Promise.reject(Object.assign(new Error('Requested device not found'), { name: 'NotFoundError' }))
            }
            const pistes = []
            if (demande.video) pistes.push(fakeTrack('video'))
            if (demande.audio) pistes.push(fakeTrack('audio'))
            if (suspendre) {
                suspendre = false
                return new Promise((resolve) => { livrer = () => resolve(realStream(pistes)) })
            }
            return Promise.resolve(realStream(pistes))
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

    it('⭐ appelant : couper micro et caméra pendant l\'invite de permission coupe les pistes qui arrivent', async () => {
        // L'appelant passe CONNECTED dès l'acceptation, AVANT sa propre capture : la barre d'appel
        // offre ses boutons pendant que l'invite est ouverte. Avant, les drapeaux disaient
        // « coupé » sur des pistes actives — on se croyait muet, on était entendu, et vu.
        const inviteId = await api.startCallWithPeer({ toUserSlug: 'alice', type: 'visio' })
        suspendre = true
        const ouverture = api.openCallBetweenPeer({
            fromUserSlug: 'alice',
            status: true,
            options: { type: 'visio', room: api.currentCallRoomId.value, peerId: 'peer-alice', inviteId },
        })
        await settleTasks()
        expect(api.callState.value).toBe('connected')
        expect(api.currentStream.value).toBeNull()

        api.toggleAudioState()
        api.toggleVideoState()
        livrer()
        await ouverture
        await settleTasks()

        const flux = api.currentStream.value
        expect(flux.getAudioTracks().map((piste) => piste.enabled)).toEqual([false])
        expect(flux.getVideoTracks().map((piste) => piste.enabled)).toEqual([false])
    })

    it('la caméra coupée le reste à l\'appel suivant — seul le micro est rouvert', async () => {
        // Elle est capturée, mais sa piste arrive DÉSACTIVÉE : le pair ne voit rien. La remise à
        // zéro du micro ne doit pas l'emporter sur ce réglage.
        await accepter('call-1')
        api.toggleVideoState()
        await raccrocher()

        await accepter('call-2')

        expect(api.isVideoEnabled.value).toBe(false)
        expect(api.currentStream.value.getVideoTracks().map((piste) => piste.enabled)).toEqual([false])
    })

    it('⭐ caméra coupée dans l\'appel précédent : « activer la caméra » la rallume pendant l\'appel suivant', async () => {
        // Avant, la caméra reportée n'était pas capturée : « activer la caméra » passait le
        // drapeau à vrai sans aucune piste à basculer. On se croyait vu, on ne l'était pas.
        await accepter('call-1')
        api.toggleVideoState()
        await raccrocher()
        await accepter('call-2')

        api.toggleVideoState()

        expect(api.isVideoEnabled.value).toBe(true)
        expect(api.currentStream.value.getVideoTracks().map((piste) => piste.enabled)).toEqual([true])
    })

    it('⭐ appelant, caméra coupée dans l\'appel précédent : le flux qu\'il offre porte une piste vidéo', async () => {
        // Le défaut vu par David le 2026-10-29 : A coupe sa caméra, raccroche, rappelle B — et A a
        // DEUX écrans noirs. Son flux n'avait pas de piste vidéo, donc l'offre de PeerJS aucune
        // ligne vidéo, et la réponse de B ne peut pas en ajouter : la vidéo de B ne partait jamais.
        // Le mécanisme SDP a été mesuré dans Chromium (headless), pas dans ce harnais : ici, on
        // tient sa précondition — une piste vidéo, désactivée, dans le flux passé à `peer.call`.
        await accepter('call-1')
        api.toggleVideoState()
        await raccrocher()
        getLastPeerInstance().call.mockClear()

        const inviteId = await api.startCallWithPeer({ toUserSlug: 'alice', type: 'visio' })
        await api.openCallBetweenPeer({
            fromUserSlug: 'alice',
            status: true,
            options: { type: 'visio', room: api.currentCallRoomId.value, peerId: 'peer-alice', inviteId },
        })
        await settleTasks()

        const appels = getLastPeerInstance().call.mock.calls
        expect(appels.length).toBeGreaterThan(0)
        const fluxOffert = appels.at(-1)[1]
        expect(fluxOffert.getVideoTracks().map((piste) => piste.enabled)).toEqual([false])
    })

    it('⭐ caméra coupée puis indisponible : l\'appel visio suivant s\'établit, en audio seul', async () => {
        // Le chemin de la relecture du 2026-10-29 : un appel VOCAL offre « couper la caméra »
        // (item ouvert), sur un poste qui n'en a pas. Capturer la caméra même coupée faisait
        // rejeter l'acceptation de l'appel visio suivant — qui passait avant ce lot.
        sansCamera = true
        await accepter('call-1', 'vocal')
        api.toggleVideoState()
        await raccrocher()

        await expect(accepter('call-2')).resolves.toBeUndefined()

        expect(contraintes.slice(-2)).toEqual([{ video: true, audio: true }, { video: false, audio: true }])
        expect(pistesAudio()).toBe(1)
    })

    it('⭐ appelant sans caméra, caméra coupée : l\'appel part, et l\'offre demande quand même la vidéo du pair', async () => {
        // Les deux moitiés du choix du 2026-10-29 ensemble : le repli audio de la capture, et les
        // contraintes d'offre de la branche visio. Sans elles, le repli rouvrait le défaut des
        // deux cadres noirs, le flux de l'appelant n'ayant plus de piste vidéo.
        sansCamera = true
        await accepter('call-1', 'vocal')
        api.toggleVideoState()
        await raccrocher()
        getLastPeerInstance().call.mockClear()

        const inviteId = await api.startCallWithPeer({ toUserSlug: 'alice', type: 'visio' })
        await api.openCallBetweenPeer({
            fromUserSlug: 'alice',
            status: true,
            options: { type: 'visio', room: api.currentCallRoomId.value, peerId: 'peer-alice', inviteId },
        })
        await settleTasks()

        const appels = getLastPeerInstance().call.mock.calls
        expect(appels).toHaveLength(1)
        const [, fluxOffert, options] = appels[0]
        expect(fluxOffert.getVideoTracks()).toEqual([])
        expect(options.constraints).toEqual({ offerToReceiveVideo: true })
    })
})
