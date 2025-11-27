<template>
    <div class="conversations-list">

        <ul class="list-group list-group-flush">
            <template v-for="conversation in conversations" :key="conversation.id">
                <li class="list-group-item">
                    <ConversationSelector
                        :conversation="conversation"
                        @join-chat="onJoinChat"
                    ></ConversationSelector>
                </li>
            </template>

        </ul>
    </div>
</template>

<script>

    import Gravatar from '~estarter/components/widgets/Gravatar.vue'
    import ConversationSelector from './ConversationSelector.vue'
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'

    export default {
        name: 'ConversationList',
        emits: [
            'join-chat',
        ],
        components: {
            Gravatar,
            ConversationSelector,
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
        }
    }
</script>