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
import { createApp, h, inject, markRaw } from 'vue'
import Draggable from '~socializer/directives/draggable.js'

export function usePeerMedia(ctx) {

    const eventBus = inject('eventBus')
    const removingVideoIds = new Set()
    const streamCleanupBound = new Set()

    const startCurrentStream = async (is_local = false) => {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: ctx.ui.streamStates.isVideoEnabled,
            audio: !ctx.ui.streamStates.isMuted,
        })

        stream.isLocal = is_local // to mute local sound in player

        ctx.media.currentStream = markRaw(stream) // marquer le stream comme "non réactif" pour éviter les problèmes de performance liés à la réactivité de Vue sur les objets MediaStream
        return stream
    }

    const stopCurrentStream = () => {
        ctx.media.currentStream?.getTracks().forEach(t => t.stop())
        ctx.media.currentStream = null
    }

    const createVideoElement = async (options = {}, stream = null) => {
    
        const videoId = options.videoId
        if (!videoId) {
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

        const VideoComponent = await import('~socializer/components/WebRTC2/Widgets/VideoComponent.vue')
        
        // Créer un élément wrapper unique pour chaque vidéo
        const wrapper = document.createElement('div')
        wrapper.id = wrapperId
        wrapper.classList.add('draggable-video')

        const containerElement = document.querySelector(videoContainer)

        if (!containerElement) {
            console.error(`Container '${videoContainer}' not found.`)
            return
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
        
        // Stocker l'application avec ses métadonnées
        ctx.peerStore.addPlayer({ app, videoId: options.videoId, type: source })

        _bindStreamCleanup(stream, videoId)

        // Appliquer manuellement la directive `v-draggable` sur le wrapper
        const draggableDirective = Draggable.mounted // Récupérer la méthode `mounted` de la directive
        if (draggableDirective) {
            draggableDirective(wrapper) // Appliquer la directive sur l'élément wrapper
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

        stream.getTracks().forEach((track) => {
        track.addEventListener('ended', cleanup, { once: true })
        track.addEventListener('inactive', cleanup, { once: true })
        })
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
        const { app } = players[index]
        const wrapperId = `wrapper-${elementId}`
        const wrapper = document.getElementById(wrapperId)

        if (wrapper && wrapper.parentNode) {
        wrapper.parentNode.removeChild(wrapper)
        }

        ctx.peerStore.removePlayer(elementId)
        app.unmount()
        streamCleanupBound.delete(elementId)
        } finally {
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