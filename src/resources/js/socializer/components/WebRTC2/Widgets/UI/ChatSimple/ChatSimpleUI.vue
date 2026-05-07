<template>
    <div class="card mb-3">
        <div class="card-body">
            <ul>
                <li v-for="(message, index) in messages" :key="index">
                [{{ new Date(message.timestamp).toLocaleTimeString() }}] {{ message.fromName }} : {{ message.message }}
                </li>
            </ul>
            <div class="input-group mb-3">
                <input type="text" class="form-control" placeholder="Votre message" v-model="messageToSend">
                <button type="button" class="btn btn-primary" @click="send">Send</button>
            </div>
        </div>
    </div>
</template>

<script setup>

    import { useChatSimple } from '~socializer/components/WebRTC2/Widgets/UI/ChatSimple/useChatSimple.js'
    
    const props = defineProps({
        api: Object,
    })

    //  En se basant sur le nom de la room, ce composable permet de partager 
    // le même état de chat entre plusieurs composants.
    const { 
            messages, 
            addMessage, 
            messageToSend,
            send,
        } = useChatSimple(
                props.api.currentRoom.value, // on peut aussi passer un nom de room en argument pour partager le même chat entre plusieurs composants, tant qu'elles utilisent le même nom de room pour accéder à la map
                props.api // passé en argument, permet d'utiliser des méthodes de useMediaBroadcast (ex: sendDataToPeer) ou d'autres méthodes de transport selon les besoins
            )
</script>
