import { ref, computed, watch, onUnmounted, unref } from 'vue'
import { usePeer2Store } from '~socializer/stores/peers2.js'

/**
 * Écoute les signaux d'un peer distant (mute/vidéo) via peerStore
 * et expose l'état correspondant en réactif.
 * @param {Ref<string>|string} peerIdSource - peerId (ref ou valeur)
 */
export function useRemotePeerState(peerIdSource) {
    const peerStore = usePeer2Store()
    const muted = ref(false)
    const videoActive = ref(true)

    const lastSignal = computed(() =>
        peerStore.getLastRoomSignal(unref(peerIdSource))
    )

    const stop = watch(lastSignal, (signal) => {
        const peerId = unref(peerIdSource)
        if (!signal || signal.roomId !== peerId) return

        switch (signal.payload?.type) {
            case 'AUDIO_MUTE_TOGGLE':
                muted.value = !!signal.payload.isMuted
                break
            case 'VIDEO_ACTIVE_TOGGLE':
                videoActive.value = !!signal.payload.isActive
                break
        }
    })

    onUnmounted(stop)

    return { 
        muted, 
        videoActive 
    }
}