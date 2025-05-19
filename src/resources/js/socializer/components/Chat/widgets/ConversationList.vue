<template>
    <div class="conversations-list">
        <button 
            class="btn btn-primary btn-sm"
            @click="onCreateChat"
            ><IconWidget icon="plus"></IconWidget> Nouvelle conversation
        </button>
            <ul class="list-group list-group-flush">
                <li v-for="conversation in conversations" 
                    class="list-group-item">
                    <ConversationButton
                        :conversation="conversation"
                        @join-chat="onJoinChat"
                    ></ConversationButton>
                </li>
            </ul>
    </div>

</template>

<script>

    import Gravatar from '~estarter/components/widgets/Gravatar.vue'
    import ConversationButton from './ConversationButton.vue'
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'

    export default {
        name: 'ConversationList',
        emits: [
            'join-chat',
            'create-chat',
        ],
        components: {
            Gravatar,
            ConversationButton,
            IconWidget,
        },
        props: {
            conversations : {
                type: Object,
                required: true
            }
        },
        methods: {
            onJoinChat(vertexid) {
                this.$emit('join-chat', vertexid)
            },
            onCreateChat() {
                this.$emit('create-chat')
            },
        }
    }
</script>