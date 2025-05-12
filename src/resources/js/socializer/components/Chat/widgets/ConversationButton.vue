<template>
    <div class="d-flex align-items-end">
        <Gravatar
            :user="user"
            size="small"
            style="width:35px"
            image-class="img-fluid"
        ></Gravatar>
        <button class="btn" 
            @click="onJoinChat"
            >{{ conversationName }}
        </button>
        <div class="dropdown">
            <button class="btn" data-bs-toggle="dropdown">
                <IconWidget icon="ellipsis-h"></IconWidget>
            </button>
            <ul class="dropdown-menu">
                <ConversationActions
                    :conversation="conversation"
                ></ConversationActions>
            </ul>
        </div>
        
    </div>
</template>

<script>

    import Gravatar from '~estarter/components/widgets/Gravatar.vue'
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import ConversationActions from './partials/ConversationActions.vue'

    export default {
        name: 'ConversationButton',
        emits: [
            'join-chat',
        ],
        components : {
            Gravatar,
            IconWidget,
            ConversationActions,
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