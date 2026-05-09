import { ref } from 'vue'
// local store pour les chats (on pourrait faire mieux avec un vrai store, mais c'est pas le sujet ici)
// la clé de la map est le nom de la room, ce qui permet d'avoir une instance de chat par room
// on stocke les messages dans une ref pour que ce soit réactif, et on expose une fonction pour ajouter un message
// on pourrait aussi stocker d'autres infos liées au chat dans la map (ex: les utilisateurs connectés, etc.)
// IMPORTANT : le fait que chats soit hors du composable permet de partager l'état entre plusieurs instances du composant ChatSimpleUI (ici et parent), 
// tant qu'elles utilisent le même nom de room pour accéder à la map
const chats = new Map()

export function useChatSimple(room = '_default_', api = {}) {

    /*----------------------
        * State
    ----------------------*/

    if (!chats.has(room)) {
        chats.set(room, {
            messages: ref([])
        })
    }
 
    const chat = chats.get(room)
    const messageToSend = ref('')

    /*----------------------
        * Logique métier
    ----------------------*/

    const addNewMessage = (msg) => {
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
    }

    return {
        messages: chat.messages,
        addNewMessage,   // toujours utile pour injecter des messages entrants
        messageToSend,
        send,
    }
}