<template>
    <div class="d-flex align-items-end justify-content-start">
        <Gravatar
            :user="user"
            size="small"
            style="width:35px"
            image-class="img-fluid"
        ></Gravatar>
        <button class="btn flex-grow-1" 
            style="text-align:start;"
            @click="onJoinChat"
            >{{ conversationName }}
        </button>
        <div class="dropdown">
            <button class="btn" data-bs-toggle="dropdown">
                <IconWidget icon="ellipsis-h"></IconWidget>
            </button>
            <ul class="dropdown-menu">
                <ConversationActionsList
                    :conversation="conversation"
                ></ConversationActionsList>
            </ul>
        </div>
        
    </div>
</template>

<script>

    import Gravatar from '~estarter/components/widgets/Gravatar.vue'
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import ConversationActionsList from './partials/ConversationActionsList.vue'

    export default {
        name: 'ConversationSelector',
        emits: [
            'join-chat',
        ],
        components : {
            Gravatar,
            IconWidget,
            ConversationActionsList,
        },
        props: {
            conversation: {
                type: Object,
                required: true
            }
        },
        computed: {
            conversationName: function() {
                return this.conversation.name || this.conversation.id
            }
        },
        methods: {
            onJoinChat() {
                this.$emit('join-chat', this.conversation.id)
            },
        }
    }
</script>
