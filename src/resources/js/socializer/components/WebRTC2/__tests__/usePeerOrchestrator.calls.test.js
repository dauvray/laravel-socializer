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
 * Mais une caméra capturée puis désactivée garde son VOYANT allumé (vu par David, Chrome 156). Le
 * soir du même jour, deux décisions de David renversent la capture : sans vidéo, voyant éteint —
 * la caméra coupée n'est plus capturée, une piste canvas noire tient sa place (et la ligne vidéo
 * de l'offre) ; et la caméra doit toujours pouvoir être rallumée — le repli audio disparaît, la
 * bascule ARRÊTE la caméra et la RECAPTURE, puis `replaceTrack` sur chaque connexion du flux,
 * entrantes comprises. Le cas de l'APPELÉ ne se voit qu'en déclenchant un `'call'` entrant
 * (`appelEntrant`) : sa connexion n'est pas dans le store, et un remplacement qui parcourrait le
 * store laisserait tous les cas de l'appelant verts.
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
 *   | Neutralisé dans le `finally` de `stopCallWithPeers`    | Rougit                       |
 *   |--------------------------------------------------------|------------------------------|
 *   | la remise à `false` de `isMuted`                       | les trois ⭐                  |
 *   | la remise dans `resetCallState` (1re version du lot)   | « un arrêt complet qui lève » |
 *   | la caméra rouverte aussi (`isVideoEnabled = true`)     | « la caméra coupée… »        |
 *   | la garde `mode !== 'partial'` retirée                  | aucun ici — un cas de        |
 *   |                                                        | `useCallManager.test.js`     |
 *
 * Trois autres tables portaient sur la caméra capturée puis désactivée, et sur son repli audio :
 * le lot du soir a supprimé ce code, elles sont dans `git log`. La table du lot du soir, mesurée
 * sur l'état final (94 fichiers, 1645 cas) — « ici » est ce fichier, `streams` est
 * `usePeerMedia.streams`, `media` est `usePeerOrchestrator.media`, `util` est
 * `utils/createPlaceholderVideoTrack`, `callControls` est celui de `Notifications` :
 *
 *   | Neutralisé                                              | Rougit                           |
 *   |---------------------------------------------------------|----------------------------------|
 *   | caméra capturée même coupée (`camera = video`)          | 12 ici, 2 `streams`              |
 *   | coupure = `track.enabled = false` seul                  | 4 ici, 1 `streams`, 1 `media`    |
 *   | aucun sender remplacé                                   | 4 ici, 1 `media`                 |
 *   | remplacement par parcours du STORE                      | les 3 cas de l'APPELÉ seuls —    |
 *   |                                                         | appelant et diffusion restent    |
 *   |                                                         | verts (+ `mockFidelity`, fortuit)|
 *   | senders filtrés sur la piste remplacée                  | « recouper … juste après … »     |
 *   | senders filtrés sur le genre `video`                    | le cas « partage d'écran » de    |
 *   |                                                         | `media`, seul                    |
 *   | garde de séquence retirée                               | « recouper … pendant sa capture »|
 *   | garde d'identité du flux retirée                        | « raccrocher pendant la capture »|
 *   | échec sans remise du drapeau à « coupée »               | « caméra indisponible… »         |
 *   | `startCurrentStream` sans `applyVideoState`             | 3 ici, 1 `streams`               |
 *   | aucune piste vidéo au départ (caméra coupée)            | 12 ici, 3 `streams`              |
 *   | piste qui tient la place posée aussi en vocal           | « appel VOCAL… »                 |
 *   | ancienne piste non arrêtée                              | 5 ici, 1 `streams`, 1 `media`    |
 *   | `toggleVideoState` ne rend plus sa promesse             | 7 ici, 1 `media` — dont 2 pour le|
 *   |                                                         | verdict (vocal, indisponible) ;  |
 *   |                                                         | les autres n'attendent plus les  |
 *   |                                                         | `replaceTrack`                   |
 *   | caméra ET micro coupés → `getUserMedia` quand même      | 1 `streams`                      |
 *   | le toast de `Notifications.vue` retiré                  | 1 `callControls`                 |
 *   | `requestFrame` pris sur la piste seule (Chromium)       | « ⭐ Firefox… » ici, 1 `util`     |
 *   | repli : arrêter la caméra quand même                    | les 2 cas « sans piste de        |
 *   | repli : caméra laissée active                           | remplacement possible », chacun  |
 *   | repli : réactivation sans `enabled = true`              | (2 ici)                          |
 *   | `_createPlaceholder` relève au lieu de rendre `null`    | les mêmes 2                      |
 *   | bouche-trou survivant à une capture refusée             | 1 `streams`                      |
 *   | piste canvas non arrêtée quand `requestFrame` lève      | 1 `util`                         |
 *   | minuteur du canvas sans arrêt                           | 1 `util`                         |
 *   | le registre non purgé au `close`                        | AUCUN — `getMediaConnections`    |
 *   |                                                         | purge aussi à la lecture ; le    |
 *   |                                                         | retrait au `close` ne fait que   |
 *   |                                                         | lâcher la référence plus tôt     |
 *   | `addTrack` avant `removeTrack`                          | AUCUN — happy-dom ne rend rien ; |
 *   |                                                         | l'ordre est mesuré en navigateur |
 *   |                                                         | (`usePeerMedia._replaceVideoTrack`)|
 *
 * ⭐ La ligne « senders filtrés sur la piste remplacée » a d'abord SURVÉCU : le double de
 * `replaceTrack` écrivait `sender.track` à l'appel, pas à la résolution. Le double est corrigé
 * (`__mocks__/peerjs.js`, `_wireSenders`), et le cas de la course écrit derrière.
 *
 * ⭐ Et la suite était verte (1637 cas) sur un bouche-trou qui LEVAIT sous Firefox : happy-dom a la
 * forme Chromium de la capture canvas. Trouvé par la relecture, en navigateur ; `formeFirefox` le
 * double désormais.
 *
 * Les ⭐ sont nés rouges : `{ video: true, audio: false }` en visio, le `TypeError` en vocal ;
 * pour la caméra, aucune piste vidéo (`[]`), y compris dans le flux passé à `peer.call` ; pour le
 * repli, l'acceptation rejetée en `NotFoundError` ; pour l'offre, `constraints` absent. Ceux du
 * lot du soir : la caméra demandée (`{ video: true, audio: true }`) et jamais arrêtée, aucune
 * piste à sa place, aucun `replaceTrack` ; puis, après la relecture, la `TypeError` de Firefox et
 * `captureStream` qui lève. Trois sont nés verts, et la table ci-dessus les tient : le vocal, le
 * partage d'écran, la course de deux bascules.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { withSetup } from './helpers/withSetup.js'
import { mockEventBus } from './helpers/mockEventBus.js'
import { bootLocalPeer } from './helpers/bootLocalPeer.js'
import { installFakeMedia, fakeTrack, realStream } from './helpers/fakeMedia.js'
import { resetPeerMock, getLastPeerInstance, createMockMediaConnection } from './__mocks__/peerjs.js'
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
    /** Toutes les pistes CAMÉRA rendues par `getUserMedia`, dans l'ordre — le voyant, c'est elles. */
    let cameras

    beforeEach(async () => {
        document.body.innerHTML = '<div id="videoContainer"></div>'
        resetPeerMock()
        installFakeMedia()
        contraintes = []
        suspendre = false
        livrer = null
        sansCamera = false
        cameras = []
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
            cameras.push(...pistes.filter((piste) => piste.kind === 'video'))
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

    /** Appelé : l'appel de l'initiateur arrive, admis par le mapping que pose l'acceptation. */
    const appelEntrant = async () => {
        const appel = createMockMediaConnection({
            from: 'alice',
            slug: 'me',
            type: 'visio',
            room: api.currentCallRoomId.value,
            callbackKey: 'data-app',
        })
        appel.peer = 'peer-alice'
        getLastPeerInstance()._triggerEvent('call', appel)
        await settleTasks()
        return appel
    }

    /** Appelant : alice accepte, et la connexion sortante part avec le flux local. */
    const appeler = async () => {
        const inviteId = await api.startCallWithPeer({ toUserSlug: 'alice', type: 'visio' })
        await api.openCallBetweenPeer({
            fromUserSlug: 'alice',
            status: true,
            options: { type: 'visio', room: api.currentCallRoomId.value, peerId: 'peer-alice', inviteId },
        })
        await settleTasks()
        return getLastPeerInstance().call.mock.results.at(-1).value
    }

    /** La piste du sender vidéo d'une connexion : ce que le pair reçoit. */
    const pisteEnvoyee = (connexion) => connexion.peerConnection.getSenders()
        .find((sender) => sender.track?.kind === 'video')?.track ?? null

    /** Un appel où l'on coupe sa caméra, puis raccroche : le suivant hérite d'une caméra coupée. */
    const couperPuisRaccrocher = async (type = 'visio') => {
        await accepter('call-1', type)
        await api.toggleVideoState()
        await raccrocher()
    }

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
        // Et la caméra capturée sous l'invite est ÉTEINTE, pas seulement désactivée : son voyant.
        expect(cameras).toHaveLength(1)
        expect(cameras[0].stop).toHaveBeenCalled()
        expect(flux.getVideoTracks()).not.toContain(cameras[0])
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
        await couperPuisRaccrocher()
        await accepter('call-2')

        await api.toggleVideoState()

        expect(api.isVideoEnabled.value).toBe(true)
        expect(api.currentStream.value.getVideoTracks()).toEqual([cameras.at(-1)])
        expect(cameras.at(-1).enabled).toBe(true)
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

    it('⭐ caméra coupée puis indisponible : l\'appel visio suivant s\'établit, sans demander la caméra', async () => {
        // Le chemin de la relecture du 2026-10-29 : un appel VOCAL offre « couper la caméra »
        // (item ouvert), sur un poste qui n'en a pas. Capturer la caméra même coupée faisait
        // rejeter l'acceptation de l'appel visio suivant ; le repli audio l'a rattrapé, et depuis
        // que la caméra coupée n'est plus capturée du tout, il n'y a plus rien à rattraper.
        sansCamera = true
        await couperPuisRaccrocher('vocal')

        await expect(accepter('call-2')).resolves.toBeUndefined()

        expect(contraintes.at(-1)).toEqual({ video: false, audio: true })
        expect(pistesAudio()).toBe(1)
    })

    it('⭐ appelant sans caméra, caméra coupée : l\'appel part, et l\'offre demande quand même la vidéo du pair', async () => {
        // Les deux moitiés du choix du 2026-10-29 ensemble : le repli audio de la capture, et les
        // contraintes d'offre de la branche visio. Sans elles, le repli rouvrait le défaut des
        // deux cadres noirs, le flux de l'appelant n'ayant plus de piste vidéo.
        sansCamera = true
        await couperPuisRaccrocher('vocal')
        getLastPeerInstance().call.mockClear()

        await appeler()

        const appels = getLastPeerInstance().call.mock.calls
        expect(appels).toHaveLength(1)
        const [, fluxOffert, options] = appels[0]
        // La piste vidéo offerte est le bouche-trou : aucune caméra n'a été demandée.
        expect(fluxOffert.getVideoTracks().map((piste) => piste.enabled)).toEqual([false])
        expect(cameras).toEqual([])
        expect(options.constraints).toEqual({ offerToReceiveVideo: true })
    })

    // ── Couper la caméra éteint la webcam ─────────────────────────────────────────────────
    //
    // Décisions de David du 2026-10-29 : sans vidéo, le voyant est éteint — une caméra coupée
    // n'est donc ni capturée ni gardée ouverte, une piste canvas noire tient sa place dans le
    // flux et dans chaque connexion ; et la caméra doit toujours pouvoir être rallumée.

    it('⭐ caméra coupée reportée : l\'appel suivant n\'OUVRE PAS la caméra', async () => {
        await couperPuisRaccrocher()
        const camerasAvant = cameras.length

        await accepter('call-2')

        expect(contraintes.at(-1)).toEqual({ video: false, audio: true })
        expect(cameras).toHaveLength(camerasAvant)
        expect(api.currentStream.value.getVideoTracks().map((piste) => piste.enabled)).toEqual([false])
    })

    it('⭐ couper la caméra pendant l\'appel l\'ARRÊTE, et le pair reçoit une piste désactivée à sa place', async () => {
        const connexion = await appeler()
        const [camera] = cameras
        expect(pisteEnvoyee(connexion)).toBe(camera)

        await api.toggleVideoState()

        expect(camera.stop).toHaveBeenCalled()
        const [remplacante] = api.currentStream.value.getVideoTracks()
        expect(remplacante).not.toBe(camera)
        expect(remplacante.enabled).toBe(false)
        expect(pisteEnvoyee(connexion)).toBe(remplacante)
    })

    it('⭐ appelé : « activer la caméra » la pose sur la connexion ENTRANTE, que le store ne range pas', async () => {
        await couperPuisRaccrocher()
        await accepter('call-2')
        const appel = await appelEntrant()
        expect(appel.answer).toHaveBeenCalledWith(api.currentStream.value)
        const bouchon = pisteEnvoyee(appel)
        expect(bouchon?.enabled).toBe(false)

        await api.toggleVideoState()

        const camera = cameras.at(-1)
        expect(contraintes.at(-1)).toEqual({ video: true })
        expect(api.currentStream.value.getVideoTracks()).toEqual([camera])
        expect(camera.enabled).toBe(true)
        expect(pisteEnvoyee(appel)).toBe(camera)
        expect(bouchon.readyState).toBe('ended')
    })

    it('⭐ caméra indisponible : « activer la caméra » échoue sans mentir, et réussit quand elle revient', async () => {
        sansCamera = true
        await couperPuisRaccrocher('vocal')
        await accepter('call-2')
        const appel = await appelEntrant()

        await expect(api.toggleVideoState()).resolves.toBe(false)

        expect(api.isVideoEnabled.value).toBe(false)
        expect(pisteEnvoyee(appel).enabled).toBe(false)

        sansCamera = false
        await expect(api.toggleVideoState()).resolves.toBe(true)

        expect(api.isVideoEnabled.value).toBe(true)
        expect(pisteEnvoyee(appel)).toBe(cameras.at(-1))
    })

    it('⭐ appelant, caméra coupée au départ et rallumée pendant l\'invite : la caméra arrive après', async () => {
        await couperPuisRaccrocher()
        const inviteId = await api.startCallWithPeer({ toUserSlug: 'alice', type: 'visio' })
        suspendre = true
        const ouverture = api.openCallBetweenPeer({
            fromUserSlug: 'alice',
            status: true,
            options: { type: 'visio', room: api.currentCallRoomId.value, peerId: 'peer-alice', inviteId },
        })
        await settleTasks()

        await api.toggleVideoState()
        livrer()
        await ouverture
        await settleTasks()

        expect(contraintes.slice(-2)).toEqual([{ video: false, audio: true }, { video: true }])
        expect(api.currentStream.value.getVideoTracks()).toEqual([cameras.at(-1)])
        const connexion = getLastPeerInstance().call.mock.results.at(-1).value
        expect(pisteEnvoyee(connexion)).toBe(cameras.at(-1))
    })

    it('⭐ recouper la caméra pendant sa capture : la caméra capturée est arrêtée, jamais envoyée', async () => {
        await couperPuisRaccrocher()
        await accepter('call-2')
        const appel = await appelEntrant()
        const bouchon = pisteEnvoyee(appel)
        suspendre = true

        const activation = api.toggleVideoState()
        await api.toggleVideoState()
        livrer()
        await activation

        expect(cameras.at(-1).stop).toHaveBeenCalled()
        expect(api.isVideoEnabled.value).toBe(false)
        expect(pisteEnvoyee(appel)).toBe(bouchon)
        expect(api.currentStream.value.getVideoTracks()).toEqual([bouchon])
    })

    it('⭐ recouper la caméra juste après l\'avoir rallumée : le pair reçoit la piste qui tient la place, pas la caméra arrêtée', async () => {
        // `sender.track` ne change qu'à la RÉSOLUTION de `replaceTrack`. Recouper avant ce moment
        // trouve sur le sender l'ancien bouche-trou, pas la caméra qu'on remplace : un filtre sur
        // « la piste remplacée » ne le voyait plus, et la chaîne d'opérations posait ensuite la
        // caméra — ARRÊTÉE. Chez le pair, une image figée de quelqu'un qui croit avoir coupé.
        await couperPuisRaccrocher()
        await accepter('call-2')
        const appel = await appelEntrant()

        const activation = api.toggleVideoState()
        await settleTasks()
        const camera = cameras.at(-1)
        expect(api.currentStream.value.getVideoTracks()).toEqual([camera])
        expect(pisteEnvoyee(appel)).not.toBe(camera)

        await api.toggleVideoState()
        await activation

        expect(camera.stop).toHaveBeenCalled()
        const [bouchon] = api.currentStream.value.getVideoTracks()
        expect(pisteEnvoyee(appel)).toBe(bouchon)
    })

    /**
     * La forme Firefox de la capture canvas : `requestFrame` est porté par le FLUX
     * (`CanvasCaptureMediaStream`), pas par la piste — mesuré dans Firefox 151 par la relecture
     * du 2026-10-29. happy-dom a la forme Chromium (sur la piste) : sans ce double, la suite
     * entière tournait sur un sosie de Chromium, et le bouche-trou levait sous Firefox.
     */
    const formeFirefox = () => {
        const capturer = HTMLCanvasElement.prototype.captureStream
        const flux = []
        vi.spyOn(HTMLCanvasElement.prototype, 'captureStream').mockImplementation(function (cadence) {
            const capture = capturer.call(this, cadence)
            capture.getVideoTracks()[0].requestFrame = undefined
            capture.requestFrame = vi.fn()
            flux.push(capture)
            return capture
        })
        return flux
    }

    it('⭐ Firefox (requestFrame sur le FLUX) : couper la caméra l\'arrête, et l\'appel suivant part caméra coupée', async () => {
        // Le défaut trouvé par la relecture : `track.requestFrame()` levait `TypeError`, la coupure
        // était rejetée APRÈS la bascule du drapeau — l'UI disait « coupée », le pair voyait
        // l'utilisateur en direct — et un appel caméra coupée ne démarrait plus, micro laissé ouvert.
        const capturesCanvas = formeFirefox()
        await accepter('call-1')
        const [camera] = cameras

        await expect(api.toggleVideoState()).resolves.toBe(true)

        expect(camera.stop).toHaveBeenCalled()
        expect(capturesCanvas.at(-1).requestFrame).toHaveBeenCalled()
        await raccrocher()

        await expect(accepter('call-2')).resolves.toBeUndefined()

        expect(contraintes.at(-1)).toEqual({ video: false, audio: true })
        expect(api.currentStream.value.getVideoTracks().map((piste) => piste.enabled)).toEqual([false])
    })

    it('⭐ sans piste de remplacement possible, couper la caméra échoue FERMÉ : désactivée, jamais montrée', async () => {
        // Un navigateur sans capture canvas utilisable. Arrêter la caméra quand même laisserait
        // chez le pair sa dernière image, figée (mesuré dans Chromium) ; la garder active le
        // montrerait. Reste l'état d'avant le lot : caméra ouverte, désactivée — le pair voit du
        // noir, seul le voyant reste allumé. Choix par défaut, révisable par David.
        vi.spyOn(HTMLCanvasElement.prototype, 'captureStream').mockImplementation(() => {
            throw new TypeError('captureStream indisponible')
        })
        const connexion = await appeler()
        const [camera] = cameras

        await expect(api.toggleVideoState()).resolves.toBe(true)

        expect(api.isVideoEnabled.value).toBe(false)
        expect(camera.enabled).toBe(false)
        expect(camera.stop).not.toHaveBeenCalled()
        expect(pisteEnvoyee(connexion)).toBe(camera)

        await expect(api.toggleVideoState()).resolves.toBe(true)

        expect(camera.enabled).toBe(true)
        expect(cameras).toHaveLength(1)
    })

    it('⭐ sans piste de remplacement possible, un appel caméra coupée capture la caméra DÉSACTIVÉE, et la rallume', async () => {
        vi.spyOn(HTMLCanvasElement.prototype, 'captureStream').mockImplementation(() => {
            throw new TypeError('captureStream indisponible')
        })
        await couperPuisRaccrocher()

        await expect(accepter('call-2')).resolves.toBeUndefined()

        expect(contraintes.at(-1)).toEqual({ video: true, audio: true })
        const camera = cameras.at(-1)
        expect(api.currentStream.value.getVideoTracks()).toEqual([camera])
        expect(camera.enabled).toBe(false)

        await api.toggleVideoState()

        expect(camera.enabled).toBe(true)
    })

    it('⭐ appel VOCAL : « activer la caméra » n\'ouvre rien — le réglage vaut pour l\'appel suivant', async () => {
        // Le veto vocal tient aussi pour la bascule : sans piste vidéo dans le flux, rallumer la
        // caméra ne peut pas en ajouter une, et ne doit pas la capturer pour rien.
        await couperPuisRaccrocher()
        await accepter('call-2', 'vocal')
        const camerasAvant = cameras.length

        await expect(api.toggleVideoState()).resolves.toBe(true)

        expect(api.isVideoEnabled.value).toBe(true)
        expect(cameras).toHaveLength(camerasAvant)
        expect(api.currentStream.value.getVideoTracks()).toEqual([])
    })

    it('⭐ raccrocher pendant la capture de la caméra : elle est arrêtée dès qu\'elle arrive', async () => {
        await couperPuisRaccrocher()
        await accepter('call-2')
        suspendre = true

        const activation = api.toggleVideoState()
        await raccrocher()
        livrer()
        await activation

        expect(cameras.at(-1).stop).toHaveBeenCalled()
        expect(api.currentStream.value).toBeNull()
    })
})
