/**
 * 🎥 usePeerMedia (Media Layer)
 * 
 * lifecycle des MediaStream (getUserMedia / displayMedia)
 *
 * 👉 gère :
 * - création des MediaStream (getUserMedia, getDisplayMedia)
 * - arrêt des streams
 * - état local des flux (currentStream)
 * - le pool de players : une app hôte par container, des instances de player
 *   recyclées d'un flux à l'autre (createVideoElement = acquire, removeVideoElement = release)
 *
 * 👉 ne gère PAS :
 * - ouverture de connexions peer
 * - synchronisation entre utilisateurs
 *
 * 👉 rôle :
 * - abstraction pure des flux audio/vidéo
 * - isoler toute dépendance navigateur (MediaDevices API)
 * - fournir des flux prêts à être utilisés par les connexions WebRTC
 * 
 * 👉 à ne pas confondre avec useMediaBroadcast qui gère la logique métier de diffusion (qui utilise usePeerMedia pour les flux)
 */
import { createApp, h, markRaw, reactive } from 'vue'
import { createPlaceholderVideoTrack } from '~socializer/components/WebRTC2/Composables/utils/createPlaceholderVideoTrack.js'

export function usePeerMedia(ctx) {

    const eventBus = ctx.eventBus
    const removingVideoIds = new Set()
    const creatingVideoIds = new Set()
    const streamCleanupBound = new Set()
    const streamCleanupListeners = new Map() // videoId → [{track, handler}]

    // ── Caméra ───────────────────────────────────────────────────────────────
    // Toute piste qui a été LA piste vidéo du flux courant : caméras et bouche-trous. Un sender
    // qui en porte une envoie ce flux — jamais un partage d'écran, dont la piste n'y entre pas.
    const localVideoTracks = new WeakSet()
    // Les bouche-trous : une piste vidéo du flux courant qui n'y est pas est une caméra.
    const placeholderTracks = new WeakSet()
    // Incrémenté à chaque `applyVideoState` : une caméra capturée pour une demande que d'autres
    // ont suivie est périmée, et arrêtée au lieu d'être posée.
    let videoStateSequence = 0

    // ── Pool de players ──────────────────────────────────────────────────────
    // Un "host" = une app Vue montée une fois par container, qui rend un v-for sur
    // ses slots. Un slot = une instance de player réutilisable : retirer un flux
    // libère le slot (videoId = null) sans démonter l'instance, qui sera recyclée
    // au flux suivant. Le nombre d'instances montées suit donc le pic de flux
    // simultanés, pas le total cumulé sur la session.
    const hosts = new Map()     // sélecteur de container → Promise<host>
    const slotIndex = new Map() // videoId → { host, slot }
    let _slotSequence = 0

    /**
     * Démarre le flux local (webcam + micro), aux contraintes dérivées des réglages.
     *
     * @param {?string} typeAppel - le type de l'appel en cours (`'visio'` | `'vocal'`), ou
     *        `null`/absent hors appel — c'est le cas de la DIFFUSION
     *        (`usePeerOrchestrator.js:250`), où aucun type d'appel n'a de sens.
     *
     * ⚠️ Ce paramètre n'existait pas, et `_enterCallSession` passait pourtant
     * `startCurrentStream(true)` : l'argument était ignoré en silence. Conséquence vécue —
     * un appel **vocal** capturait une piste vidéo, `isVideoEnabled` valant `true` par défaut
     * (`createPeerContext.js:153`), et la **transmettait** au pair, `peer.call` passant le flux
     * tel quel. La caméra s'allumait sur un appel où personne ne l'avait demandée.
     *
     * Le TYPE décide si le flux porte une piste vidéo (`vocal` l'interdit), le réglage
     * `isVideoEnabled` décide si c'est la CAMÉRA : une caméra coupée n'est pas capturée — sans
     * vidéo, le voyant reste éteint (décision du 2026-10-29) —, et un bouche-trou
     * (`createPlaceholderVideoTrack`, une piste canvas noire désactivée) tient sa place.
     *
     * ⚠️ Ne pas retirer ce bouche-trou au motif qu'il n'affiche rien : c'est lui qui donne à
     * l'offre ou à la réponse une ligne vidéo `sendrecv`. Sans piste vidéo, « activer la caméra »
     * ne pourrait plus rien envoyer de l'appel sans renégociation, et chez l'APPELANT la vidéo du
     * pair ne lui parvenait pas (deux écrans noirs ; `connectToPeer` la demande aussi par l'offre).
     * Mesuré dans Chromium : `flux.md`.
     *
     * Une caméra OUVERTE qui ne peut pas être capturée fait échouer la capture, et la suite
     * appartient à l'appelant : un APPEL repart caméra coupée, avec un toast
     * (`useCallManager._startCallStream`, décision du 2026-10-30) ; la diffusion garde l'échec, que
     * `GroupLocalStreamBtn` nomme. Coupée, elle n'est pas demandée, donc un poste sans caméra passe.
     *
     * Sans bouche-trou possible (`_createPlaceholder` rend `null`), la caméra coupée est capturée,
     * puis désactivée par `applyVideoState` : l'état d'avant le 2026-10-29, voyant allumé.
     */
    const startCurrentStream = async (typeAppel = null) => {
        const video = typeAppel !== 'vocal'
        // AVANT la capture : c'est lui qui décide si la caméra coupée est demandée ou non.
        const placeholder = (video && !ctx.ui.streamStates.isVideoEnabled) ? _createPlaceholder() : null
        const camera = video && !placeholder
        const audio = !ctx.ui.streamStates.isMuted

        // Caméra ET micro coupés : rien à demander aux périphériques, et `getUserMedia` rejetterait
        // `{ video: false, audio: false }`. Le vocal garde ce rejet : sans bouche-trou à y mettre,
        // son flux serait vide.
        let stream
        try {
            stream = (placeholder && !audio)
                ? new MediaStream()
                : await navigator.mediaDevices.getUserMedia({ video: camera, audio })
        } catch (error) {
            // Sinon il survit à la capture refusée, minuteur compris, sans référence pour l'arrêter.
            placeholder?.stop()
            throw error
        }

        // Le micro prend l'état COURANT du drapeau, parce que `getUserMedia` dure autant que
        // l'invite de permission : l'appelant, déjà CONNECTED, a pu le couper pendant ce temps,
        // sans piste à basculer — elle entrait active sous un drapeau « coupé ».
        stream.getAudioTracks().forEach((track) => {
            track.enabled = !ctx.ui.streamStates.isMuted
        })

        stream.getVideoTracks().forEach((track) => {
            localVideoTracks.add(track)
            _followCamera(track)
            // Terminée pendant l'invite de permission : son `ended` est déjà passé, et l'écouteur
            // ne le verra jamais. Elle est coupée, et l'alignement ci-dessous pose le bouche-trou.
            if (track.readyState === 'ended') ctx.ui.streamStates.isVideoEnabled = false
        })
        if (placeholder) stream.addTrack(placeholder)

        ctx.media.currentStream = markRaw(stream) // marquer le stream comme "non réactif" pour éviter les problèmes de performance liés à la réactivité de Vue sur les objets MediaStream
        ctx.media.isStreaming = true

        // La caméra aussi prend l'état COURANT, pour la même raison : coupée pendant l'invite, elle
        // est arrêtée avant que le flux serve à quoi que ce soit (synchrone jusque-là) ; rallumée
        // pendant l'invite, elle est capturée maintenant, et l'appel part sans l'attendre.
        applyVideoState()

        return stream
    }

    /**
     * Une caméra qui s'arrête d'elle-même (débranchée, permission retirée, prise par une autre
     * application) est traitée comme une caméra COUPÉE : drapeau à `false`, bouche-trou à sa place,
     * dans le flux local et sur chaque sender. Sinon l'UI disait « filmé » et le pair gardait la
     * dernière image, figée.
     *
     * `ended` n'est émis que par un arrêt venu du périphérique, jamais par un `stop()` du code : le
     * remplacement volontaire ne passe pas ici. Une caméra déjà sortie du flux courant (remplacée,
     * appel raccroché) est ignorée.
     */
    const _followCamera = (track) => {
        track.addEventListener('ended', () => {
            const stream = ctx.media.currentStream
            if (!(stream instanceof MediaStream) || !stream.getVideoTracks().includes(track)) return
            ctx.ui.streamStates.isVideoEnabled = false
            applyVideoState()
        }, { once: true })
    }

    /**
     * @returns {?MediaStreamTrack} le bouche-trou, ou `null` si ce navigateur ne sait pas en
     *          fabriquer un — l'appelant échoue alors FERMÉ (caméra désactivée, jamais montrée)
     */
    const _createPlaceholder = () => {
        try {
            const track = createPlaceholderVideoTrack()
            placeholderTracks.add(track)
            localVideoTracks.add(track)
            return track
        } catch (error) {
            console.warn('[usePeerMedia] pas de piste pour remplacer la caméra — coupée, elle reste ouverte et désactivée', {
                name: error?.name ?? null,
            })
            return null
        }
    }

    /**
     * Remplace la piste vidéo du flux local, EN PLACE, puis sur chaque sender qui portait une
     * piste vidéo de ce flux — connexions entrantes comprises (`ctx.getMediaConnections`).
     *
     * En place, parce qu'un `<video>` dont le `srcObject` est ce flux suit le remplacement, dans
     * l'ordre ci-dessous : l'aperçu local n'a rien à réassigner, et le player n'est pas recyclé.
     * Sur les senders, parce que `replaceTrack` ne renégocie pas.
     *
     * L'ancienne piste est arrêtée SANS attendre les senders : c'est ce qui éteint le voyant.
     * `stop()` n'émet pas `ended`, donc le nettoyage lié du player local ne se déclenche pas.
     *
     * ⚠️ `removeTrack` AVANT `addTrack`, et l'ordre est mesuré (aperçu local, piste livrée,
     * 2026-10-29) :
     *
     *   | Ordre              | Chromium 149                 | Firefox 151                       |
     *   |--------------------|------------------------------|-----------------------------------|
     *   | retrait puis ajout | suit ; `inactive` émis si le | suit si le flux a un micro ; sans |
     *   |                    | flux n'a pas de micro        | micro, ne suit plus (ci-dessous)  |
     *   | ajout puis retrait | suit                         | ne suit JAMAIS : l'aperçu reste   |
     *   |                    |                              | sur la première piste vidéo       |
     *
     * L'autre ordre ne se justifie que par l'`inactive` de Chromium, que personne n'écoute sur le
     * flux (`_bindStreamCleanup` et `useStreamManager` l'écoutent sur les PISTES, qui ne l'émettent
     * pas). Borne assumée : sous Firefox, sur un flux visio SANS micro, l'aperçu LOCAL ne suit plus.
     * Retirer la seule piste rend le flux inactif, et le `<video>` passe en `ended`. Né avec la
     * caméra, l'aperçu reste FIGÉ sur sa dernière image à la coupure : on se voit encore après avoir
     * coupé. Né caméra coupée, il reste noir à la réactivation. Le pair n'est pas touché : il voit
     * du noir, ses senders ne dépendent pas du flux local. Mesuré par la relecture du 2026-10-29,
     * avec une parade côté player (réassigner `srcObject` puis `play()`) : item de
     * `work/webrtc2-todo.md`. Ce flux ne naît que d'un micro coupé AVANT la capture, et aucune UI
     * du paquet ne le permet aujourd'hui (lu, non mesuré). Le micro repart ouvert à chaque fin
     * d'appel et de diffusion. L'appelant capture dans le même tour que son passage à CONNECTED
     * (`useCallManager.openCallBetweenPeer`), l'appelé capture en RECEIVING, où la barre n'a pas
     * de bascule, et les bascules de diffusion n'existent que pendant le flux.
     *
     * @returns {Promise<void>} réglée quand chaque sender porte la nouvelle piste
     */
    const _replaceVideoTrack = (stream, previous, next) => {
        stream.removeTrack(previous)
        stream.addTrack(next)
        localVideoTracks.add(next)

        // Le sender et non la piste remplacée : `sender.track` n'est mis à jour qu'à la
        // résolution de `replaceTrack`, et deux bascules rapprochées trouveraient l'ancienne.
        const replacements = ctx.getMediaConnections().flatMap((conn) =>
            (conn.peerConnection?.getSenders?.() ?? [])
                .filter((sender) => localVideoTracks.has(sender.track))
                .map((sender) => sender.replaceTrack(next).catch((error) => {
                    console.warn('[usePeerMedia] replaceTrack refusé — ce pair garde l\'ancienne image', {
                        name: error?.name ?? null,
                    })
                }))
        )

        previous.stop()
        return Promise.all(replacements).then(() => {})
    }

    /**
     * Aligne la caméra sur `isVideoEnabled`. Coupée : elle est ARRÊTÉE (voyant éteint) et un
     * bouche-trou prend sa place. Activée : elle est recapturée et remplace le bouche-trou. Dans
     * le flux local comme sur chaque connexion du flux, sans renégociation.
     *
     * Ne change jamais la FORME du flux : sans piste vidéo (appel vocal, flux audio, aucun flux),
     * il n'y a rien à aligner et le drapeau vaut pour le flux suivant.
     *
     * Sans bouche-trou possible, couper échoue FERMÉ : la caméra reste ouverte mais désactivée —
     * le pair voit du noir, jamais l'image, et seul le voyant reste allumé. L'arrêter quand même
     * laisserait chez le pair sa dernière image, figée (en-tête de `createPlaceholderVideoTrack`).
     *
     * @returns {Promise<boolean>} `false` si la caméra demandée n'a pas pu être capturée — le
     *          drapeau est alors remis à `false`, pour ne pas dire « filmé » sans l'être ; `true`
     *          sinon, y compris quand une demande plus récente a pris la main.
     */
    const applyVideoState = async () => {
        const sequence = ++videoStateSequence
        const stream = ctx.media.currentStream
        const [current] = stream instanceof MediaStream ? stream.getVideoTracks() : []
        if (!current) return true

        const isPlaceholder = placeholderTracks.has(current)

        if (!ctx.ui.streamStates.isVideoEnabled) {
            if (isPlaceholder) return true
            const placeholder = _createPlaceholder()
            if (placeholder) await _replaceVideoTrack(stream, current, placeholder)
            else current.enabled = false
            return true
        }

        // Une caméra déjà là : celle du flux, ou celle que le repli fermé a gardée désactivée. Une
        // caméra TERMINÉE ne se réactive pas : elle passe par la recapture, comme le bouche-trou.
        if (!isPlaceholder && current.readyState !== 'ended') {
            current.enabled = true
            return true
        }

        let camera
        try {
            const capture = await navigator.mediaDevices.getUserMedia({ video: true })
            camera = capture.getVideoTracks()[0]
        } catch (error) {
            if (sequence !== videoStateSequence) return true
            console.warn('[usePeerMedia] caméra indisponible — elle reste coupée', {
                name: error?.name ?? null,
            })
            ctx.ui.streamStates.isVideoEnabled = false
            return false
        }

        // Périmée : une bascule plus récente, ou le flux arrêté (raccroché) ou remplacé depuis.
        if (sequence !== videoStateSequence || ctx.media.currentStream !== stream) {
            camera.stop()
            return true
        }

        // Terminée pendant l'invite de permission : la poser dirait « filmé » sans caméra.
        if (camera.readyState === 'ended') {
            console.warn('[usePeerMedia] caméra terminée dès sa capture — elle reste coupée')
            ctx.ui.streamStates.isVideoEnabled = false
            return false
        }

        _followCamera(camera)
        await _replaceVideoTrack(stream, current, camera)
        return true
    }

    const stopCurrentStream = () => {
        ctx.media.currentStream?.getTracks().forEach(t => t.stop())
        ctx.media.currentStream = null
        ctx.media.isStreaming = false
        ctx.media.isAudioStream = false
    }

    /**
     * Un flux audio démarre micro OUVERT : la piste capturée est active, et le drapeau le dit
     * — l'UI, la metadata sortante (`isAudioMuted`) et la première bascule le lisent.
     */
    const startAudioStream = async () => {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: false,
            audio: true,
        })

        ctx.media.currentStream = markRaw(stream)
        ctx.media.isStreaming = true
        ctx.media.isAudioStream = true
        ctx.ui.streamStates.isVideoEnabled = false
        ctx.ui.streamStates.isMuted = false
        return stream
    }

    const startScreenCapture = async (includeSystemAudio = false) => {
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: includeSystemAudio,
        })
        ctx.media.screenStream = markRaw(stream)
        ctx.media.isCapturing = true
        return stream
    }

    const stopScreenCapture = () => {
        ctx.media.screenStream?.getTracks().forEach(t => t.stop())
        ctx.media.screenStream = null
        ctx.media.isCapturing = false
    }

    /**
     * Monte l'app hôte du pool dans un container, une seule fois par sélecteur.
     * @param {string} selector  Sélecteur CSS du container
     * @param {string} videoId   videoId à l'origine du montage (pour le message d'erreur)
     * @returns {Promise<{app: Object, mountEl: HTMLElement, slots: Array}>}
     */
    const _mountHost = async (selector, videoId) => {
        const containerElement = document.querySelector(selector)

        if (!containerElement) {
            throw new Error(`[usePeerMedia] Container '${selector}' introuvable — vérifiez que le sélecteur est correct et que le composant est monté. Création annulée pour '${videoId}'.`)
        }

        const PlayerHost = await import('~socializer/components/WebRTC2/Widgets/Mediaplayer/PlayerHost.vue')

        const slots = reactive([])

        // `display: contents` : le point de montage ne crée pas de boîte, les wrappers
        // de players restent donc les enfants flex directs du container (#videoContainer
        // est en `display: flex`). Évite de monter l'app sur le container lui-même,
        // ce qui en viderait le contenu (Vue reset innerHTML au mount).
        const mountEl = document.createElement('div')
        mountEl.className = 'webrtc2-player-host'
        mountEl.style.display = 'contents'
        containerElement.appendChild(mountEl)

        const app = createApp({
            render: () => h(PlayerHost.default, { slots }),
        })

        app.provide('states', ctx.ui.streamStates)
        app.provide('eventBus', eventBus)

        app.mount(mountEl)

        return { app: markRaw(app), mountEl, slots }
    }

    /**
     * Récupère (ou monte) l'hôte associé à un container.
     * La promesse est mise en cache pour que deux créations concurrentes sur le même
     * container ne montent pas deux apps.
     */
    const _ensureHost = (selector, videoId) => {
        const cached = hosts.get(selector)
        if (cached) return cached

        const pending = _mountHost(selector, videoId)
        hosts.set(selector, pending)

        // Un échec de montage (container absent) ne doit pas empoisonner les tentatives
        // suivantes : le container peut apparaître plus tard.
        pending.catch(() => {
            if (hosts.get(selector) === pending) hosts.delete(selector)
        })

        return pending
    }

    /**
     * Attribue un slot libre au flux, ou en crée un si le pool est saturé.
     * @returns {Object} le slot occupé
     */
    const _acquireSlot = (host, options, stream, source) => {
        let slot = host.slots.find((entry) => entry.videoId === null)

        if (!slot) {
            slot = reactive({
                key: `slot-${_slotSequence++}`, // identité stable : c'est la clé du v-for
                videoId: null,
                type: null,
                nickname: null,
                peer: null,
                roomId: null,
                streamData: { stream: null, metadata: {} },
            })
            host.slots.push(slot)
        }

        slot.videoId = options.videoId
        slot.type = source
        slot.nickname = options.nickname ?? null
        slot.peer = options.peer ?? null
        slot.roomId = options?.roomId || ctx.session.currentRoom
        // markRaw : même raison que ctx.media.currentStream — pas de réactivité profonde
        // sur un MediaStream.
        //
        // ⚠️ `metadata` EST l'identité du flux telle que l'affiche MediaBroadcastPlayer
        // (nom du pair, type, isMe…). Les autres props passées par PlayerHost — nickname,
        // peer, roomId — ne sont PAS déclarées par le player : elles retombent en
        // attributs et ne s'affichent nulle part. Tant que ce champ restait vide, tout
        // flux passé par le pool s'affichait « Inconnu ». Copie, et non référence :
        // le slot est recyclé d'un flux à l'autre.
        slot.streamData = {
            stream: stream ? markRaw(stream) : null,
            metadata: options.metadata ? { ...options.metadata } : {},
        }

        return slot
    }

    /**
     * Libère le slot d'un flux sans démonter son instance.
     * @returns {boolean} true si un slot a été libéré
     */
    const _releaseSlot = (videoId) => {
        const entry = slotIndex.get(videoId)
        if (!entry) return false

        const { slot } = entry
        slot.videoId = null
        slot.type = null
        slot.nickname = null
        slot.peer = null
        slot.roomId = null
        slot.streamData = { stream: null, metadata: {} }

        slotIndex.delete(videoId)
        return true
    }

    const createVideoElement = async (options = {}, stream = null) => {

        const videoId = options.videoId
        if (!videoId) {
            return
        }

        // Guard contre les créations concurrentes du même videoId
        if (creatingVideoIds.has(videoId)) {
            console.warn(`[usePeerMedia] createVideoElement: videoId '${videoId}' déjà en cours de création, appel ignoré.`)
            return
        }

        const source = options.type || ctx.session.currentType
        const videoContainer = options.videoContainer || ctx.media.videoContainer

        // Source de vérité : le registre de slots (et non plus le DOM, les wrappers
        // étant désormais produits par le v-for de l'hôte).
        if (slotIndex.has(videoId)) {
            return
        }

        const alreadyRegistered = ctx.peerStore.getPlayers.some((entry) => entry.videoId === videoId)
        if (alreadyRegistered) {
            return
        }

        // Verrouiller avant toute opération asynchrone pour éviter les race conditions
        creatingVideoIds.add(videoId)

        try {
            const host = await _ensureHost(videoContainer, videoId)

            // Re-vérification après l'await : un autre chemin a pu attribuer ce videoId
            // pendant le montage de l'hôte.
            if (slotIndex.has(videoId)) {
                return
            }

            const slot = _acquireSlot(host, options, stream, source)
            slotIndex.set(videoId, { host, slot })

            // Enregistrer le player dans le store pour pouvoir le manipuler (ex: suppression à la fin d'un appel)
            ctx.peerStore.addPlayer({ videoId: options.videoId, type: source })

            _bindStreamCleanup(stream, videoId)
        } finally {
            creatingVideoIds.delete(videoId)
        }
    }

    /**
     * Lie le nettoyage d'un flux à la fin de sa durée de vie (ex: arrêt d'un flux distant, fin du partage d'écran)
     *
     * Jamais pour le flux LOCAL (`currentStream`) : son aperçu vit le temps de l'appel, et l'arrêt
     * le retire lui-même (`removeVideoElement('local-webcam')`). Aucune de ses pistes n'y met fin.
     * La caméra est remplacée EN PLACE (caméra ↔ bouche-trou), et celle qui s'arrête d'elle-même
     * passe par `_followCamera`. Le micro intégré d'une webcam s'arrête AVEC elle quand on la
     * débranche : vu par David le 2026-10-30, sa fin retirait l'aperçu, et la caméra rebranchée
     * puis rallumée n'avait plus où s'afficher jusqu'au raccroché.
     *
     * @param {MediaStream} stream
     * @param {string} videoId
     * @returns
     */
    const _bindStreamCleanup = (stream, videoId) => {
        if (!(stream instanceof MediaStream) || !videoId) {
            return
        }

        if (stream === ctx.media.currentStream) {
            return
        }

        if (streamCleanupBound.has(videoId)) {
            return
        }

        streamCleanupBound.add(videoId)

        const cleanup = () => {
            removeVideoElement(videoId)
        }

        const entries = []
        stream.getTracks().forEach((track) => {
            track.addEventListener('ended', cleanup, { once: true })
            track.addEventListener('inactive', cleanup, { once: true })
            entries.push({ track, handler: cleanup })
        })
        streamCleanupListeners.set(videoId, entries)
    }

    /**
     * Détache les écouteurs de nettoyage d'un flux pour un videoId donné
     * @param {string} videoId 
     * @returns {void}
     */
    const _unbindStreamCleanup = (videoId) => {
        const entries = streamCleanupListeners.get(videoId)
        if (!entries) return

        entries.forEach(({ track, handler }) => {
            track.removeEventListener('ended', handler)
            track.removeEventListener('inactive', handler)
        })

        streamCleanupListeners.delete(videoId)
    }

    const removeVideoElement = (elementId) => {
        if (!elementId) {
        return
        }

        if (removingVideoIds.has(elementId)) {
        return
        }

        const players = ctx.peerStore.getPlayers
        const index = players.findIndex((entry) => entry.videoId === elementId)

        if (index === -1) {
        streamCleanupBound.delete(elementId)
        return
        }

        removingVideoIds.add(elementId)

        try {
        // 1. Libérer le slot : l'instance reste montée mais masquée, prête à être
        //    recyclée par le prochain flux. Le wrapper DOM disparaît via le v-show
        //    de l'hôte, sans démontage ni suppression de nœud.
        _releaseSlot(elementId)

        // 2. Nettoyer le store
        ctx.peerStore.removePlayer(elementId)
        } finally {
        // Toujours libérer les sets de tracking, même si une étape échoue
        _unbindStreamCleanup(elementId)
        streamCleanupBound.delete(elementId)
        removingVideoIds.delete(elementId)
        }
    }

    const cleanupCallPlayers = () => {
        const renderedPlayers = Array.isArray(ctx.peerStore.getPlayers) ? [...ctx.peerStore.getPlayers] : []
        
        renderedPlayers.forEach((player) => {
            if (!player?.videoId) return

            // Nettoie uniquement les players d'appel (local et remote)
            if (player.videoId === 'local-webcam' || player.videoId.startsWith('remote-')) {
                removeVideoElement(player.videoId)
            }
        })
    }
    
    /**
     * Teardown terminal du pool : libère les flux restants, démonte les apps hôtes
     * et retire leurs points de montage. À n'appeler que sur destruction du contexte
     * (cf. usePeerOrchestrator.cleanupPeerConnection) — après ça, une nouvelle
     * création remontera un hôte.
     */
    const destroyPlayers = async () => {
        // Libérer d'abord les slots occupés pour garder le store et les listeners
        // de tracks cohérents.
        ;[...slotIndex.keys()].forEach((videoId) => removeVideoElement(videoId))

        const pending = [...hosts.values()]
        hosts.clear()

        for (const entry of pending) {
            try {
                const host = await entry
                host.app.unmount()
                host.mountEl.remove()
            } catch {
                // Hôte jamais monté (container introuvable) : rien à démonter.
            }
        }

        slotIndex.clear()
    }

    return {
        startCurrentStream,
        stopCurrentStream,
        applyVideoState,
        startAudioStream,
        startScreenCapture,
        stopScreenCapture,
        createVideoElement,
        removeVideoElement,
        cleanupCallPlayers,
        destroyPlayers,
    }
}