<template>
    <div class="card mb-3">
        <div class="card-body">
            <ul>
                <li v-for="(message, index) in messages" :key="index">
                [{{ new Date(message.timestamp).toLocaleTimeString() }}] {{ message.fromName }} : {{ message.message }}
                </li>
            </ul>
            <div class="input-group mb-3">
                <input type="text" 
                    class="form-control" 
                    placeholder="Votre message" 
                    v-model="messageToSend"
                    @input="onInput"
                    @keyup.enter="send">
                <button type="button" class="btn btn-primary" @click="send">Send</button>
            </div>
            <p v-if="typingUsers.length" class="text-muted small fst-italic">
                <template v-if="typingUsers.length === 1">
                    {{ typingUsers[0] }} est en train d'écrire…
                </template>
                <template v-else-if="typingUsers.length <= 3">
                    {{ typingUsers.join(', ') }} sont en train d'écrire…
                </template>
                <template v-else>
                    Plusieurs personnes sont en train d'écrire…
                </template>
            </p>
        </div>
    </div>
</template>

<script setup>
    import { useChatSimple } from '~socializer/components/WebRTC2/Exemples/ChatSimple/useChatSimple.js'

    const props = defineProps({
        api: Object,
    })

    //  En se basant sur le nom de la room, ce composable permet de partager 
    // le même état de contexte entre plusieurs composants.
    const { 
            messages, 
            addNewMessage, 
            messageToSend,
            send,
            typingUsers,
            onInput,
        } = useChatSimple(
                props.api.currentRoom.value, // état de contexte de room sélectionné
                props.api // passé en argument, permet d'utiliser des méthodes de useMediaBroadcast (ex: sendDataToPeer) ou d'autres méthodes de transport selon les besoins
            )
</script>
