<template>
    <div class="conversations-list">
        <ConversationCreatorButton
            @create-chat="onCreateChat"
        ></ConversationCreatorButton>
        <ul class="list-group list-group-flush">
            <li v-for="conversation in conversations" 
                class="list-group-item">
                <ConversationSelector
                    :conversation="conversation"
                    @join-chat="onJoinChat"
                ></ConversationSelector>
            </li>
        </ul>
    </div>
</template>

<script>

    import Gravatar from '~estarter/components/widgets/Gravatar.vue'
    import ConversationSelector from './ConversationSelector.vue'
    import ConversationCreatorButton from './ConversationCreatorButton.vue'
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'

    export default {
        name: 'ConversationList',
        emits: [
            'join-chat',
            'create-chat',
        ],
        components: {
            Gravatar,
            ConversationSelector,
            ConversationCreatorButton,
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