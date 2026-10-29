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

export function usePeerMedia(ctx) {

    const eventBus = ctx.eventBus
    const removingVideoIds = new Set()
    const creatingVideoIds = new Set()
    const streamCleanupBound = new Set()
    const streamCleanupListeners = new Map() // videoId → [{track, handler}]

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
     * Le TYPE décide de la capture vidéo (`vocal` l'interdit, tout autre la capture), le réglage
     * `isVideoEnabled` de l'état de la PISTE : une caméra coupée est capturée, puis désactivée
     * ci-dessous, et le pair ne voit rien. ⚠️ Ne pas refaire du réglage une contrainte de capture.
     * Jusqu'au 2026-10-29, une caméra coupée reportée à l'appel suivant n'y était pas capturée :
     * « activer la caméra » ne trouvait aucune piste, et chez l'APPELANT l'offre de PeerJS ne
     * portait aucune ligne vidéo, que la réponse de l'appelé ne peut pas ajouter — la vidéo du
     * pair ne lui parvenait jamais, deux écrans noirs (mesuré dans Chromium, `flux.md`). Ce second
     * effet est désormais aussi couvert par l'offre (`connectToPeer`) ; le premier, par la seule
     * capture.
     *
     * Repli : une caméra COUPÉE qui ne peut pas être capturée (absente, prise par une autre
     * application, refusée) ne fait pas échouer la capture — le flux part en audio seul, comme
     * avant que la caméra coupée soit capturée. Ouverte, son échec remonte : l'utilisateur veut
     * être vu. La vidéo du pair, elle, arrive quand même : `connectToPeer` la demande dans l'offre.
     */
    const startCurrentStream = async (typeAppel = null) => {
        const video = typeAppel !== 'vocal'
        const audio = !ctx.ui.streamStates.isMuted
        let stream
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video, audio })
        } catch (error) {
            // L'état COURANT, comme pour les pistes ci-dessous : il a pu changer pendant l'invite.
            // Borne : le repli recapture aussi pour un appel annulé pendant l'invite — la garde de
            // room d'`_enterCallSession` coupe ensuite ce flux (mesuré, `work/webrtc2-todo.md`).
            if (!video || !audio || ctx.ui.streamStates.isVideoEnabled) throw error
            console.warn('[usePeerMedia] caméra coupée et indisponible — capture en audio seul', {
                name: error?.name ?? null,
            })
            stream = await navigator.mediaDevices.getUserMedia({ video: false, audio })
        }

        // Les pistes qui arrivent prennent l'état COURANT des drapeaux. La caméra d'abord, capturée
        // même coupée (docblock). Et les deux parce que `getUserMedia` dure autant que l'invite de
        // permission : l'appelant, déjà CONNECTED, a pu couper son micro ou sa caméra pendant ce
        // temps, sans piste à basculer — elles entraient actives sous un drapeau « coupé ».
        // `getTracks()` et non `getAudioTracks()` : un seul accesseur à doubler dans les harnais.
        stream.getTracks().forEach((track) => {
            if (track.kind === 'audio') track.enabled = !ctx.ui.streamStates.isMuted
            if (track.kind === 'video') track.enabled = ctx.ui.streamStates.isVideoEnabled
        })

        ctx.media.currentStream = markRaw(stream) // marquer le stream comme "non réactif" pour éviter les problèmes de performance liés à la réactivité de Vue sur les objets MediaStream
        ctx.media.isStreaming = true
        return stream
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
     * Lie le nettoyage d'un flux à la fin de sa durée de vie (ex: arrêt de la webcam, fin du partage d'écran)
     * @param {MediaStream} stream 
     * @param {string} videoId 
     * @returns 
     */
    const _bindStreamCleanup = (stream, videoId) => {
        if (!(stream instanceof MediaStream) || !videoId) {
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
        startAudioStream,
        startScreenCapture,
        stopScreenCapture,
        createVideoElement,
        removeVideoElement,
        cleanupCallPlayers,
        destroyPlayers,
    }
}