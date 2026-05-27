import { ref, onScopeDispose, inject } from 'vue'
import { storeToRefs } from 'pinia'
import { useTypingIndicator } from '~socializer/components/Chat/composables/useTypingIndicator.js'
import { useMeStore } from '~estarter/stores/me.js'
import { REVERB_CHANNEL } from '~socializer/components/System/system.config.js'

// local store pour les chats (on pourrait faire mieux avec un vrai store, mais c'est pas le sujet ici)
// la clé de la map est le nom de la room, ce qui permet d'avoir une instance de chat par room
// on stocke les messages dans une ref pour que ce soit réactif, et on expose une fonction pour ajouter un message
// on pourrait aussi stocker d'autres infos liées au chat dans la map (ex: les utilisateurs connectés, etc.)
// IMPORTANT : le fait que chats soit hors du composable permet de partager l'état entre plusieurs instances du composant ChatSimpleUI (ici et parent), 
// tant qu'elles utilisent le même nom de room pour accéder à la map
const chats = new Map()
const ROOM_TTL_MS = 30 * 60 * 1000 // 30 min

// retourne l'objet chat pour une room donnée, 
// en créant une nouvelle entrée si la room n'existe pas encore
function ensureRoom(room) {
    if (!chats.has(room)) {
        chats.set(room, {
            messages: ref([]),
            subscribers: 0,
            purgeTimer: null,
        })
    }

    return chats.get(room)
}

// Planifie la suppression d'une room après un délai, si personne n'est revenu d'ici là
function scheduleRoomPurge(room) {
    const chat = chats.get(room)
    if (!chat) return

    // Evite les timers dupliqués
    if (chat.purgeTimer) return

    chat.purgeTimer = setTimeout(() => {
        const latest = chats.get(room)
        if (!latest) return

        // Purge seulement si personne n'est revenu entre temps
        if (latest.subscribers === 0) {
            chats.delete(room)
        } else {
            latest.purgeTimer = null
        }
    }, ROOM_TTL_MS)
}

// Annule une purge programmée pour une room, par exemple si un nouvel abonné arrive avant l'expiration du timer
function cancelRoomPurge(chat) {
    if (!chat?.purgeTimer) return
    clearTimeout(chat.purgeTimer)
    chat.purgeTimer = null
}

export function useChatSimple(room = '_default_', api = {}) {

    /*----------------------
        * State
    ----------------------*/

    const chat = ensureRoom(room)
    // Nouvel abonné sur la room
    chat.subscribers += 1
    cancelRoomPurge(chat)

    const messageToSend = ref('')

    const meStore = useMeStore()
    const { getMe: currentUser } = storeToRefs(meStore)

    // Indicateur « écrit… » : on est passé du data channel WebRTC au whisper Reverb.
    // useTypingIndicator n'émet plus lui-même : on lui fournit `whisper` (émission)
    // et on branche `onTypingWhisper` en réception sur le canal de présence partagé,
    // injecté par le parent (Home.vue : provide(REVERB_CHANNEL, reverb)).
    const reverb = inject(REVERB_CHANNEL, null)
    const whisper = reverb ? (event, payload) => reverb.whisper(event, payload) : undefined

    const {
        actors: typingUsers, // liste de noms dédupliquée, consommée telle quelle par le template
        onTypingWhisper,
        startWriting,
        stopWriting,
    } = useTypingIndicator({ currentUser, whisper })

    // Réception des whispers 'typing' des autres clients (persiste à travers les reconnexions)
    reverb?.listenForWhisper('typing', onTypingWhisper)

    /*----------------------
        * Logique métier
    ----------------------*/

    const addNewMessage = (data) => {
        // protection mesh / star
        const msg = data?.payload ?? data
        chat.messages.value.push(msg)
    }

    const send = () => {

        if (!messageToSend.value.trim()) return

        const msg = {
            message: messageToSend.value,
            fromSlug: api.mySlug?.value,
            fromName: api.myName?.value,
            timestamp: Date.now(),
        }

        addNewMessage(msg)
        api.sendData(msg) // passé en argument, permet d'utiliser des méthodes de useMediaBroadcast (ex: sendDataToPeer) ou d'autres méthodes de transport selon les besoins
        messageToSend.value = ''
        stopWriting()
    }

    // Nettoyage auto quand le composant qui consomme ce composable est détruit
    onScopeDispose(() => {
        // On ne reste pas « écrit… » chez les autres si on disparaît en cours de frappe
        stopWriting()
        reverb?.stopListeningForWhisper('typing')

        const latest = chats.get(room)
        if (!latest) return

        latest.subscribers = Math.max(0, latest.subscribers - 1)

        if (latest.subscribers === 0) {
            scheduleRoomPurge(room)
        }
    })

    return {
        messages: chat.messages,
        addNewMessage,   // toujours utile pour injecter des messages entrants
        messageToSend,
        send,
        typingUsers,
        startWriting,    // à brancher sur @focus de l'input
        stopWriting,     // à brancher sur @blur de l'input
    }
}