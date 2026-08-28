// ~socializer/components/System/composables/useReverbChannel.js
import { ref, watch, unref, onBeforeUnmount } from 'vue'

const CHANNEL_FACTORIES = {
    public:    (name) => Echo.channel(name),
    private:   (name) => Echo.private(name),
    presence:  (name) => Echo.join(name),
    encrypted: (name) => Echo.encryptedPrivate(name),
}

/**
 * Nombre de consommateurs vivants, par nom de canal.
 *
 * Echo mémoïse ses canaux : deux `useReverbChannel('user.7', …)` partagent UN objet canal et UNE
 * souscription pusher, mais `Echo.leave()` la coupe pour TOUT LE MONDE. Sans compteur, le premier
 * composant démonté emportait le canal des autres — c'est exactement ce qui cassait la navigation
 * « room → feed » : `Server.vue` libérait le canal privé `me.channel` en se démontant, puis
 * `Room.vue` (son enfant, démonté juste après) whisperait `leave-room` dans le vide.
 *
 * La clé est le nom NU, sans préfixe de type : `Echo.leave(name)` détruit `name`, `private-name`
 * ET `presence-name` d'un seul geste — son rayon d'action est celui du nom, pas celui du type.
 */
const consumersByChannel = new Map()

const retainChannel = (name) => {
    consumersByChannel.set(name, (consumersByChannel.get(name) ?? 0) + 1)
}

/** @returns {boolean} `true` si l'appelant était le dernier consommateur — à lui d'éteindre. */
const releaseChannel = (name) => {
    const remaining = (consumersByChannel.get(name) ?? 1) - 1

    if (remaining > 0) {
        consumersByChannel.set(name, remaining)
        return false
    }

    consumersByChannel.delete(name)
    return true
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

    /**
     * Jeton de vie de la souscription courante. Chaque handler posé sur le canal capture le sien
     * et redevient inerte dès que ce jeton est révoqué — seul moyen de neutraliser ceux qu'Echo
     * ne sait pas défaire (`here`/`joining`/`leaving`/`error`/`notification`) quand le canal
     * survit à ce consommateur parce qu'un autre le tient encore.
     */
    let subscriptionToken = { active: false }

    /** Désabonnements de CETTE souscription, à rejouer si le canal survit. */
    let unbinders = []

    // listeners ajoutés dynamiquement après le join via la méthode `listen()`
    const dynamicListeners = new Map()
    const dynamicWhispers = new Map()

    // --- Lifecycle ---------------------------------------------------------

    /** Rend un handler inerte dès que la souscription qui l'a posé est libérée. */
    const guard = (handler) => {
        const own = subscriptionToken

        return (...args) => {
            if (!own.active) return
            handler?.(...args)
        }
    }

    const leave = () => {
        if (!currentName) return

        const name = currentName
        const channel = currentChannel

        // Révoquer d'abord : un événement qui arriverait pendant le désabonnement ne doit plus
        // toucher à l'état d'un composant en train de mourir.
        subscriptionToken.active = false
        unbinders.forEach(undo => undo(channel))
        unbinders = []

        currentChannel = null
        currentName = null
        isConnected.value = false
        users.value = []

        if (releaseChannel(name)) {
            Echo.leave(name)
        }
    }

    const applyPresenceHandlers = (ch) => {
        ch.here(guard((presentUsers) => {
                users.value = presentUsers
                isConnected.value = true
                onHere?.(presentUsers)
            }))
            .joining(guard((user) => {
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
            }))
            .leaving(guard((user) => {
                users.value = users.value.filter(u => u.id !== user.id)
                onLeaving?.(user)
            }))
    }

    /**
     * Pose un listener et note comment le retirer si le canal survit à ce consommateur.
     *
     * @returns {Function} le handler réellement posé sur Echo (celui à passer à `unbind`)
     */
    const bindListener = (ch, event, handler) => {
        const wrapped = guard(handler)
        ch.listen(event, wrapped)
        unbinders.push(channel => channel?.stopListening?.(event, wrapped))
        return wrapped
    }

    const bindWhisperListener = (ch, event, handler) => {
        const wrapped = guard(handler)
        ch.listenForWhisper?.(event, wrapped)
        unbinders.push(channel => channel?.stopListeningForWhisper?.(event, wrapped))
        return wrapped
    }

    /**
     * Retire UN handler d'un événement, ou tous si aucun n'est nommé.
     *
     * ⚠️ Le `callback` compte, et c'est le même défaut de classe que le compteur
     * `consumersByChannel` corrige pour `Echo.leave` : Echo mémoïse ses canaux, donc
     * plusieurs consommateurs indépendants s'abonnent au MÊME événement du MÊME canal.
     * Un `unbind(event)` nu les emporte tous — le premier composant démonté rendait les
     * autres sourds. La production en monte le cas : `Exemples/Home.vue` fournit un seul
     * canal de présence à trois `MediaBroadcastProvider`, dont chacun écoute l'annonce de
     * diffusion.
     *
     * Le repli sans callback reste : `useChatSimple` appelle `stopListeningForWhisper('typing')`
     * nu, et il est alors le seul consommateur de cet événement.
     *
     * @param {Map} registry           dynamicListeners ou dynamicWhispers
     * @param {Function} unbindOnEcho  (event, wrapped|undefined) => void
     */
    const removeHandler = (registry, unbindOnEcho, event, callback) => {
        const entries = registry.get(event) ?? []

        if (!callback) {
            unbindOnEcho(event, undefined)
            registry.delete(event)
            return
        }

        const index = entries.findIndex(entry => entry.handler === callback)
        if (index === -1) return

        const [entry] = entries.splice(index, 1)
        // `wrapped` est null quand l'abonnement a été enregistré avant tout `join()` : il
        // n'y a alors rien à défaire sur Echo, seulement à oublier ici.
        if (entry.wrapped) unbindOnEcho(event, entry.wrapped)
        if (!entries.length) registry.delete(event)
    }

    const applyCommonHandlers = (ch) => {
        // Erreurs (dispo sur presence/private)
        if (typeof ch.error === 'function') {
            ch.error(guard((err) => {
                error.value = err
                onError?.(err)
                console.error('[useReverbChannel]', err)
            }))
        }

        // Notifications Laravel (private/presence)
        if (onNotification && typeof ch.notification === 'function') {
            ch.notification(guard(onNotification))
        }

        // Listeners passés en options
        Object.entries(listeners).forEach(([event, handler]) => {
            bindListener(ch, event, handler)
        })

        // Whispers (client events: typing, etc.)
        Object.entries(whispers).forEach(([event, handler]) => {
            bindWhisperListener(ch, event, handler)
        })

        // Listeners ajoutés dynamiquement avant un reconnect. Le handler REPOSÉ est un
        // nouveau `wrapped` (nouveau jeton de vie) : le noter dans l'entrée, sinon un
        // désabonnement ciblé après reconnexion défairait un handler déjà mort.
        for (const [event, entries] of dynamicListeners.entries()) {
            entries.forEach((entry) => { entry.wrapped = bindListener(ch, event, entry.handler) })
        }

        // Whispers dynamiques (client events)
        for (const [event, entries] of dynamicWhispers.entries()) {
            entries.forEach((entry) => { entry.wrapped = bindWhisperListener(ch, event, entry.handler) })
        }
    }

    const join = () => {
        const name = unref(channelName)
        if (!name || currentName === name) return

        leave()

        const factory = CHANNEL_FACTORIES[type]
        if (!factory) {
            console.error(`[useReverbChannel] Type "${type}" inconnu`)
            return
        }

        currentName = name
        subscriptionToken = { active: true }
        retainChannel(name)

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
        const entry = { handler: callback, wrapped: null }
        dynamicListeners.get(event).push(entry)

        if (currentChannel) {
            entry.wrapped = bindListener(currentChannel, event, callback)
        }
    }

    /** @param {Function} [callback] ne retirer que CE handler — cf. `removeHandler`. */
    const stopListening = (event, callback = null) => {
        removeHandler(
            dynamicListeners,
            (evt, wrapped) => currentChannel?.stopListening?.(evt, wrapped),
            event,
            callback,
        )
    }

    /**
     * Émet un client event (whisper) sur le canal — indicateur de frappe, `leave-room`, etc.
     *
     * ⚠️ **Ne lève jamais, par contrat.** `PusherPrivateChannel.whisper()` déréférence
     * `pusher.channels.channels[name]` sans garde : souscription disparue ⇒ `TypeError`. Levée
     * depuis un `onBeforeUnmount`, Vue la relance en dev **au milieu du flush du scheduler** — le
     * patch avorte, et l'utilisateur voit l'URL de la nouvelle route avec l'écran de l'ancienne.
     * Un whisper perdu est un incident bénin ; il ne doit pas coûter la navigation.
     *
     * @returns {boolean} `true` si le whisper est bien parti.
     */
    const whisper = (event, payload) => {
        if (!subscriptionToken.active || typeof currentChannel?.whisper !== 'function') {
            return false
        }

        try {
            currentChannel.whisper(event, payload)
            return true
        } catch (err) {
            console.warn(`[useReverbChannel] whisper "${event}" perdu sur "${currentName}"`, err)
            return false
        }
    }

    /** Ajoute dynamiquement un whisper listener (persiste à travers les reconnexions). */
    const listenForWhisper = (event, callback) => {
        if (!dynamicWhispers.has(event)) dynamicWhispers.set(event, [])
        const entry = { handler: callback, wrapped: null }
        dynamicWhispers.get(event).push(entry)

        if (currentChannel) {
            entry.wrapped = bindWhisperListener(currentChannel, event, callback)
        }
    }

    /** @param {Function} [callback] ne retirer que CE handler — cf. `removeHandler`. */
    const stopListeningForWhisper = (event, callback = null) => {
        removeHandler(
            dynamicWhispers,
            (evt, wrapped) => currentChannel?.stopListeningForWhisper?.(evt, wrapped),
            event,
            callback,
        )
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