// ~socializer/components/System/composables/useReverbChannel.js
import { ref, watch, unref, onBeforeUnmount } from 'vue'

const CHANNEL_FACTORIES = {
    public:    (name) => Echo.channel(name),
    private:   (name) => Echo.private(name),
    presence:  (name) => Echo.join(name),
    encrypted: (name) => Echo.encryptedPrivate(name),
}

/**
 * Composable générique pour gérer un canal Reverb/Echo.
 *
 * @param {string|Ref<string>} channelName
 * @param {Object} [options]
 * @param {'public'|'private'|'presence'|'encrypted'} [options.type='public']
 * @param {Object<string, Function>} [options.listeners]   - Map { '.EventName': handler }
 * @param {Object<string, Function>} [options.whispers]    - Map { 'event': handler } pour les client events
 * @param {Function} [options.onNotification]              - Notifications Laravel (private/presence)
 * @param {Function} [options.onHere]                      - Presence : connexion initiale
 * @param {Function} [options.onJoining]                   - Presence : nouvel arrivant
 * @param {Function} [options.onLeaving]                   - Presence : départ
 * @param {Function} [options.onError]
 * @param {boolean}  [options.autoJoin=true]
 */
export function useReverbChannel(channelName, options = {}) {
    const {
        type = 'public',
        listeners = {},
        whispers = {},
        onNotification = null,
        onHere = null,
        onJoining = null,
        onLeaving = null,
        onError = null,
        autoJoin = true,
    } = options

    const users = ref([])              // utile uniquement en mode presence
    const isConnected = ref(false)
    const error = ref(null)

    let currentChannel = null
    let currentName = null

    // listeners ajoutés dynamiquement après le join via la méthode `listen()`
    const dynamicListeners = new Map()
    const dynamicWhispers = new Map() 

    // --- Lifecycle ---------------------------------------------------------

    const leave = () => {
        if (currentName) {
            Echo.leave(currentName)
            currentChannel = null
            currentName = null
            isConnected.value = false
            users.value = []
        }
    }

    const applyPresenceHandlers = (ch) => {
        ch.here((presentUsers) => {
                users.value = presentUsers
                isConnected.value = true
                onHere?.(presentUsers)
            })
            .joining((user) => {
                // ⚠️ pusher-js ne dédoublonne PAS l'événement : son `addMember()` protège son
                // propre hash (`if (this.get(user_id) === null) this.count++`) mais émet
                // `pusher:member_added` dans tous les cas. Sans la garde ci-dessous, un
                // `member_added` reçu pour quelqu'un déjà présent le compte deux fois — et
                // `users.length` affiche 2 là où une seule personne est connectée.
                //
                // Deux chemins produisent ce doublon : un redémarrage de Reverb pendant qu'un
                // client se souscrit, et `REVERB_SCALING_ENABLED` avec plus d'un process, où le
                // garde anti-doublon de Reverb (`userIsSubscribed`) ne consulte que les
                // connexions de SON process.
                //
                // `onJoining` reste appelé dans les deux cas, volontairement : le chemin présence
                // de WebRTC2 s'en sert pour l'admission des pairs, et l'étouffer corrigerait un
                // compteur en cassant une poignée de main. On dédoublonne la liste, pas le signal.
                if (!users.value.some(u => u.id === user.id)) {
                    users.value = [...users.value, user]
                }
                onJoining?.(user)
            })
            .leaving((user) => {
                users.value = users.value.filter(u => u.id !== user.id)
                onLeaving?.(user)
            })
    }

    const applyCommonHandlers = (ch) => {
        // Erreurs (dispo sur presence/private)
        if (typeof ch.error === 'function') {
            ch.error((err) => {
                error.value = err
                onError?.(err)
                console.error('[useReverbChannel]', err)
            })
        }

        // Notifications Laravel (private/presence)
        if (onNotification && typeof ch.notification === 'function') {
            ch.notification(onNotification)
        }

        // Listeners passés en options
        Object.entries(listeners).forEach(([event, handler]) => {
            ch.listen(event, handler)
        })

        // Whispers (client events: typing, etc.)
        Object.entries(whispers).forEach(([event, handler]) => {
            ch.listenForWhisper(event, handler)
        })

        // Listeners ajoutés dynamiquement avant un reconnect
        for (const [event, handlers] of dynamicListeners.entries()) {
            handlers.forEach(h => ch.listen(event, h))
        }

        // Whispers dynamiques (client events) ← NOUVEAU
        for (const [event, handlers] of dynamicWhispers.entries()) {
            handlers.forEach(h => ch.listenForWhisper(event, h))
        }
    }

    const join = () => {
        const name = unref(channelName)
        if (!name || currentName === name) return

        leave()
        currentName = name

        const factory = CHANNEL_FACTORIES[type]
        if (!factory) {
            console.error(`[useReverbChannel] Type "${type}" inconnu`)
            return
        }

        currentChannel = factory(name)

        if (type === 'presence') {
            applyPresenceHandlers(currentChannel)
        } else {
            isConnected.value = true
        }
        applyCommonHandlers(currentChannel)
    }

    // --- API publique ------------------------------------------------------

    /** Ajoute dynamiquement un listener (persiste à travers les reconnexions). */
    const listen = (event, callback) => {
        if (!dynamicListeners.has(event)) dynamicListeners.set(event, [])
        dynamicListeners.get(event).push(callback)
        currentChannel?.listen(event, callback)
    }

    const stopListening = (event) => {
        currentChannel?.stopListening?.(event)
        dynamicListeners.delete(event)
    }

    /** Émet un client event (whisper) sur le canal — utile pour les indicateurs de frappe, etc. */
    const whisper = (event, payload) => {
        currentChannel?.whisper?.(event, payload)
    }

    /** Ajoute dynamiquement un whisper listener (persiste à travers les reconnexions). */
    const listenForWhisper = (event, callback) => {
        if (!dynamicWhispers.has(event)) dynamicWhispers.set(event, [])
        dynamicWhispers.get(event).push(callback)
        currentChannel?.listenForWhisper?.(event, callback)
    }

    const stopListeningForWhisper = (event) => {
        currentChannel?.stopListeningForWhisper?.(event)
        dynamicWhispers.delete(event)
    }

    // --- Auto lifecycle ----------------------------------------------------

    if (autoJoin) {
        watch(
            () => unref(channelName),
            (newName) => (newName ? join() : leave()),
            { immediate: true }
        )
    }

    onBeforeUnmount(leave)

    return {
        users,
        isConnected,
        error,
        join,
        leave,
        listen,
        stopListening,
        listenForWhisper, 
        stopListeningForWhisper, 
        whisper,
        channel: () => currentChannel,
    }
}

/** Sucre syntaxique pour les canaux de présence. */
export function useReverbPresence(channelName, options = {}) {
    return useReverbChannel(channelName, { ...options, type: 'presence' })
}