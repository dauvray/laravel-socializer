/**
 * useTypingIndicator — indicateurs « écrit… » du chat, via Reverb.
 *
 * Transport unique : le canal de présence Reverb du chat.
 *  - Utilisateurs : client events (whisper 'typing') relayés entre clients.
 *  - Agent Bot    : signal serveur (events `.botWriting` / `.receivedMsg`),
 *                   ajouté explicitement via addActorWriting / removeActorWriting.
 *
 * Le composable ne souscrit pas lui-même au canal : il fournit le handler
 * `onTypingWhisper` (à brancher sur l'option `whispers` de useReverbPresence)
 * et émet via la fonction `whisper` reçue en dépendance.
 *
 * @param {Object}   deps
 * @param {Ref|Object} deps.currentUser  - l'utilisateur courant (ref ou objet plat)
 * @param {Function} deps.whisper        - (event, payload) => void, émet un client event
 */
import { ref, computed, unref } from 'vue'

export function useTypingIndicator({ currentUser, whisper } = {}) {

    const me = () => unref(currentUser) // marche pour un ref ou un objet plat

    // Utilisateurs en train de taper, pilotés par whisper : Map<userId, name>
    const typingUsers = ref(new Map())
    // Acteurs ajoutés explicitement (Agent Bot : signal serveur, pas de whisper)
    const manualActors = ref([])

    // Liste unifiée de noms affichée dans le template, dédupliquée.
    const actors = computed(() => {
        const names = [...typingUsers.value.values(), ...manualActors.value]
        return [...new Set(names)]
    })

    const touchReactivity = () => {
        typingUsers.value = new Map(typingUsers.value)
    }

    /* ---- Réception (whisper utilisateurs) ---- */
    const onTypingWhisper = ({ userId, name, isTyping } = {}) => {
        const meId = me()?.id
        if (!userId || userId === meId) return // on ignore nos propres whispers

        if (isTyping) {
            typingUsers.value.set(userId, name)
        } else {
            typingUsers.value.delete(userId)
        }
        touchReactivity()
    }

    /* ---- Émission (whisper utilisateurs) — binaire focus/blur ---- */
    const startWriting = () => {
        const u = me()
        if (!u) return
        whisper?.('typing', { userId: u.id, name: u.name, isTyping: true })
    }

    const stopWriting = () => {
        const u = me()
        if (!u) return
        whisper?.('typing', { userId: u.id, name: u.name, isTyping: false })
    }

    // Nettoyage : un user qui quitte le canal ne doit pas rester « écrit… »
    // (filet de sécurité si son whisper `stop` a été perdu).
    const removeTypingUser = (userId) => {
        if (typingUsers.value.delete(userId)) {
            touchReactivity()
        }
    }

    /* ---- Acteurs explicites (Agent Bot) ---- */
    const addActorWriting = (name) => {
        if (!manualActors.value.includes(name)) {
            manualActors.value.push(name)
        }
    }

    const removeActorWriting = (name) => {
        manualActors.value = manualActors.value.filter(item => item !== name)
    }

    return {
        actors,
        onTypingWhisper,
        removeTypingUser,
        startWriting,
        stopWriting,
        addActorWriting,
        removeActorWriting,
    }
}
