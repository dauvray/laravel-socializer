/**
 * 🎥 usePeerMedia (Media Layer)
 * 
 * lifecycle des MediaStream (getUserMedia / displayMedia)
 *
 * 👉 gère :
 * - création des MediaStream (getUserMedia, getDisplayMedia)
 * - arrêt des streams
 * - état local des flux (currentStream)
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
import { createApp, h, markRaw } from 'vue'
import Draggable from '~socializer/directives/draggable.js'

export function usePeerMedia(ctx) {

    const eventBus = ctx.eventBus
    const removingVideoIds = new Set()
    const creatingVideoIds = new Set()
    const streamCleanupBound = new Set()
    const streamCleanupListeners = new Map() // videoId → [{track, handler}]

    const startCurrentStream = async (is_local = false) => {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: ctx.ui.streamStates.isVideoEnabled,
            audio: !ctx.ui.streamStates.isMuted,
        })

        stream.isLocal = is_local // to mute local sound in player

        ctx.media.currentStream = markRaw(stream) // marquer le stream comme "non réactif" pour éviter les problèmes de performance liés à la réactivité de Vue sur les objets MediaStream
        ctx.media.isStreaming = true
       //todo ctx.media.isCapturing = true
        return stream
    }

    const stopCurrentStream = () => {
        ctx.media.currentStream?.getTracks().forEach(t => t.stop())
        ctx.media.currentStream = null
        ctx.media.isStreaming = false
       // todo ctx.media.isCapturing = false
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

        const wrapperId = `wrapper-${options.videoId}`
        const source = options.type || ctx.session.currentType
        const videoContainer = options.videoContainer || ctx.media.videoContainer
    
        // if exists abort
        if(document.getElementById(wrapperId)) {
            return
        }

        const alreadyRegistered = ctx.peerStore.getPlayers.some((entry) => entry.videoId === videoId)
        if (alreadyRegistered) {
            return
        }

        // Verrouiller avant toute opération asynchrone pour éviter les race conditions
        creatingVideoIds.add(videoId)

        try {
            const VideoComponent = await import('~socializer/components/WebRTC2/Widgets/VideoComponent.vue')
            
            // Créer un élément wrapper unique pour chaque vidéo
            const wrapper = document.createElement('div')
            wrapper.id = wrapperId
            wrapper.classList.add('draggable-video')

            const containerElement = document.querySelector(videoContainer)

            if (!containerElement) {
                throw new Error(`[usePeerMedia] Container '${videoContainer}' introuvable — vérifiez que le sélecteur est correct et que le composant est monté. Création annulée pour '${videoId}'.`)
            }

            containerElement.appendChild(wrapper)

            const app = createApp({
                render: () =>
                    h(VideoComponent.default, {
                        videoId: options.videoId,
                        streamData: {
                            stream, 
                            metadata: {}
                        },
                        nickname: options.nickname,
                        type: source,
                        peer: options.peer,
                        resizable: true,
                        roomId: options?.roomId || ctx.session.currentRoom,
                    }),
            });
        
            app.provide('states', ctx.ui.streamStates)
            app.provide('eventBus', eventBus)

            app.mount(wrapper)
            
            // Enregistrer le player dans le store pour pouvoir le manipuler (ex: suppression à la fin d'un appel)
            ctx.peerStore.addPlayer({ app: markRaw(app), videoId: options.videoId, type: source })

            _bindStreamCleanup(stream, videoId)

            // Appliquer manuellement la directive `v-draggable` sur le wrapper
            const draggableDirective = Draggable.mounted // Récupérer la méthode `mounted` de la directive
            if (draggableDirective) {
                draggableDirective(wrapper) // Appliquer la directive sur l'élément wrapper
            }
        } finally {
            creatingVideoIds.delete(videoId)
        }
    }

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

        const { app } = players[index]

        try {
        // 1. Unmount d'abord → déclenche les hooks Vue (onUnmounted, etc.)
        app.unmount()

        // 2. Retirer le wrapper du DOM
        const wrapperId = `wrapper-${elementId}`
        const wrapper = document.getElementById(wrapperId)
        if (wrapper && wrapper.parentNode) {
            wrapper.parentNode.removeChild(wrapper)
        }

        // 3. Nettoyer le store
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
    
    return {
        startCurrentStream,
        stopCurrentStream,
        createVideoElement,
        removeVideoElement,
        cleanupCallPlayers,
    }
}