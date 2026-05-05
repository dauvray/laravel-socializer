<template>
    <ul>
        <li>
            Name : {{ api.myName }}
        </li>

        <li>
            Room : {{ api.onAirRoom }}
        </li>
        <li>
            Type : {{ api.currentType }}
        </li>
        <li>
            Users : {{ api.usersInRoom }}
        </li>
    </ul>

    <ul>
        <li v-for="(message, index) in messages" :key="index">
          [{{ new Date(message.timestamp).toLocaleTimeString() }}] {{ message.fromName }} : {{ message.message }}
        </li>
    </ul>

    <div class="input-group mb-3">
        <input type="text" class="form-control" placeholder="Votre message" v-model="messageToSend">
        <button type="button" class="btn btn-primary" @click="sendData">Send</button>
    </div>
</template>


<script setup>

    import { useChatSimple } from '~socializer/components/WebRTC2/Widgets/UI/ChatSimple/useChatSimple.js'
    
    const props = defineProps({
        api: Object,
    })

    // ce composable permet de partager le même état de chat entre plusieurs instances du composant ChatSimpleUI ( ici et parent), 
    // en se basant sur le nom de la room
    const { 
            messages, 
            addMessage, 
            messageToSend, 
        } = useChatSimple(props.api.currentRoom.value)
    
    const sendData = () => {

        const messageData = {
            message: messageToSend.value, 
            fromSlug: props.api.mySlug.value, 
            fromName: props.api.myName.value,
            timestamp: Date.now(),
        }

        // on ajoute le message au chat local
        addMessage(messageData)
        // on envoie la data au serveur, qui se chargera de la diffuser aux autres clients connectés à la même room
        props.api.sendData(messageData)
        // on réinitialise le champ de saisie
        messageToSend.value = ''
    }
</script>
