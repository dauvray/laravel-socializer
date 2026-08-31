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

    // Un flux sans peerId — toutes les vignettes de partage d'écran, dont `remoteScreensData`
    // n'en pose aucun — doit rester SOURD, et pas seulement par accident : `getLastRoomSignal`
    // lirait la clé "undefined", qui est exactement celle qu'écrit `dispatchSignal` quand la
    // connexion manque. Sans ce garde, tous les écrans partagés partagent une file poubelle
    // commune. La surdité est voulue : symétrique de `LocalMediaPlayer`, où un écran garde
    // toujours sa vidéo active — un pair qui coupe sa webcam ne doit pas effacer son partage.
    const lastSignal = computed(() => {
        const peerId = unref(peerIdSource)

        return peerId ? peerStore.getLastRoomSignal(peerId) : null
    })

    // `!signal` seul : la file est vidée au départ d'un pair (`clearSignalQueueRoom`), et le
    // `computed` repasse alors à `null`. Un garde d'appartenance (`signal.roomId !== peerId`) a
    // vécu ici et a été retiré — il était structurellement inatteignable, `dispatchSignal`
    // indexant la file PAR `signal.roomId`. Ce qui protège d'une enveloppe d'une autre convention
    // posée sur la même clé est le `switch` sans `default`, épinglé par un cas dédié.
    //
    // `immediate` : le datachannel s'ouvre AVANT l'arrivée du flux média, et le montage de la
    // vignette EST cette arrivée — une annonce reçue dans cette fenêtre attend déjà en file quand
    // ce composable démarre. Sans rattrapage, le pair s'affichait micro ouvert alors qu'il l'avait
    // coupé.
    // ⚠️ Ce qui est repris est le DERNIER SIGNAL, pas l'état : un pair ayant coupé son micro PUIS
    // sa caméra avant notre arrivée ne restitue que la caméra. Reconstituer l'état complet
    // demanderait de drainer la file par type, ce que `getLastRoomSignal` ne fait pas — borne
    // assumée, épinglée par un cas de `useRemotePeerState.test.js`.
    const stop = watch(lastSignal, (signal) => {
        if (!signal) return

        switch (signal.payload?.type) {
            case 'AUDIO_MUTE_TOGGLE':
                muted.value = !!signal.payload.isMuted
                break
            case 'VIDEO_ACTIVE_TOGGLE':
                videoActive.value = !!signal.payload.isActive
                break
        }
    }, { immediate: true })

    onUnmounted(stop)

    return { 
        muted, 
        videoActive 
    }
}