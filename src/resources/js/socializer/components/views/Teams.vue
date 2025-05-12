<template>
    <div class="conversations-wrapper">
        <div class="conversations-list-wrapper">
            <ConversationList
                :conversations="conversations"
                @join-chat="onJoinChat"
                @create-chat="onCreateChat"
            ></ConversationList>
        </div>
        <ChatWidget 
            v-if="currentConversation"
            ref="chatWidget"
        ></ChatWidget>
    </div>
</template>

<script>
   
    import ChatWidget from '~socializer/components/Chat/Chat.vue'
    import ConversationList from '~socializer/components/Chat/widgets/ConversationList.vue'
    import { mapActions, mapState } from 'pinia'
    import { useChatStore } from '~socializer/stores/chat.js'

    export default {
        name: 'Teams',
        components: {
            ConversationList,
            ChatWidget,
        },
        data() {
            return {
                chat: null
            }
        },
        created() {
            document.querySelector('body').classList.add("conversations-page")
            this.loadConversations()
        },
        computed: {
            ...mapState(useChatStore, {
                conversations: 'getConversations',
                currentConversation: 'getCurrentConversation',
            })
        },
        methods: {
            ...mapActions(useChatStore, [
                'loadConversations',
                'createConversation',
                'loadConversation',
                'leaveCurrentConversation',
            ]),
            onJoinChat(vertexid) {
                this.leaveCurrentConversation()
                this.loadConversation(vertexid)
                setTimeout(() => {
                    this.$refs.chatWidget.scrollView()
               }, 700)
                
            },
            onCreateChat() {
                 this.createConversation()
                .then(res => {
                    this.chat = res
                })
            },
        }
    }
</script>