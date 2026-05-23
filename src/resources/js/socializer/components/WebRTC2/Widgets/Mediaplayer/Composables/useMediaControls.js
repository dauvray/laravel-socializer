import { ref } from 'vue'

export function useMediaControls(videoRef) {
    const isFullscreen = ref(false)
    const isPip = ref(false)

    const _getEl = () => videoRef.value?.nativeVideo ?? null

    const toggleFullscreen = async () => {
        const el = _getEl()
        if (!el) return
        try {
            if (!document.fullscreenElement) {
                await el.requestFullscreen()
                isFullscreen.value = true
            } else {
                await document.exitFullscreen()
                isFullscreen.value = false
            }
        } catch (err) {
            console.error('Fullscreen error:', err)
        }
    }

    const togglePip = async () => {
        const el = _getEl()
        if (!el) return
        try {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture()
                isPip.value = false
            } else {
                await el.requestPictureInPicture()
                isPip.value = true
            }
        } catch (err) {
            console.error('PIP error:', err)
        }
    }

    // mute "natif" de l'élément (différent du mute applicatif lié à isMuted)
    const toggleNativeMute = () => {
        const el = _getEl()
        if (!el) return null
        el.muted = !el.muted
        return el.muted
    }

    return { 
        isFullscreen, 
        isPip, 
        toggleFullscreen, 
        togglePip, 
        toggleNativeMute 
    }
}