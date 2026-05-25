/**
 * useTypingIndicator - Un composable pour gérer les indicateurs de saisie dans un chat.
 * 
 * Fonctionnalités :
 * - Écoute les whispers "typing" pour suivre qui est en train de taper.
 * - Permet de notifier les autres utilisateurs quand l'utilisateur actuel commence ou arrête de taper.
 * - Gère automatiquement l'expiration des indicateurs de saisie après un délai d'inactivité.
 */
import { ref, computed, inject, onMounted, onBeforeUnmount, unref } from 'vue'
import { REVERB_CHANNEL } from '~socializer/components/System/system.config.js'

export function useTypingIndicator(currentUser, options = {}) {
    
    const { idleDelay = 2000, expireDelay = 4000 } = options

    const reverb = inject(REVERB_CHANNEL, null)
    if (!reverb) {
        console.warn('[useTypingIndicator] Aucun canal Reverb fourni (provide manquant).')
    }

    const me = () => unref(currentUser) // pratique : marche pour un ref ou un objet plat

    // Map<userId, { name, expireTimer }>
    const typingMap   = ref(new Map())
    const typingUsers = computed(() =>
        [...typingMap.value.values()].map(u => u.name)
    )

    const touchReactivity = () => {
        typingMap.value = new Map(typingMap.value)
    }

    // --- Réception ---
    const onTypingWhisper = ({ userId, name, isTyping } = {}) => {
        const meId = me()?.id
        if (!userId || !meId || userId === meId) return

        const prev = typingMap.value.get(userId)
        if (prev?.expireTimer) clearTimeout(prev.expireTimer)

        if (isTyping) {
            const expireTimer = setTimeout(() => {
                typingMap.value.delete(userId)
                touchReactivity()
            }, expireDelay)
            typingMap.value.set(userId, { name, expireTimer })
            touchReactivity()
        } else {
            typingMap.value.delete(userId)
            touchReactivity()
        }
    }

    // --- Émission (avec throttle / auto-stop) ---
    let idleTimer = null
    let isCurrentlyTyping = false

    const notifyTyping = () => {
        const u = me()
        if (!u) return  // pas encore prêt → on ne whisper rien
        if (!isCurrentlyTyping) {
            isCurrentlyTyping = true
            reverb?.whisper('typing', { userId: u.id, name: u.name, isTyping: true })
        }
        clearTimeout(idleTimer)
        idleTimer = setTimeout(stopTyping, idleDelay)
    }

    const stopTyping = () => {
        if (!isCurrentlyTyping) return
        const u = me()
        isCurrentlyTyping = false
        clearTimeout(idleTimer)
        if (u) reverb?.whisper('typing', { userId: u.id, name: u.name, isTyping: false })
    }

    // --- Lifecycle ---
    onMounted(() => {
        reverb?.listenForWhisper('typing', onTypingWhisper)
    })

    onBeforeUnmount(() => {
        reverb?.stopListeningForWhisper('typing')
        clearTimeout(idleTimer)
        // purge des timers expire restants
        typingMap.value.forEach(u => clearTimeout(u.expireTimer))
        typingMap.value.clear()
    })

    return {
        typingUsers,
        notifyTyping,
        stopTyping,
    }
}