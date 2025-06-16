<template>
    <div class="conversations-wrapper">
        <div class="conversations-list-wrapper"
            v-resizable="{
                min: initialSidebarWidth,
                max: 600,
                callback: updateSidebarWidth
            }">
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
   
    import ChatWidget from '~socializer/components/Chat/ChatComponent.vue'
    import ConversationList from '~socializer/components/Chat/widgets/ConversationList.vue'
    import { mapActions, mapState } from 'pinia'
    import { useChatStore } from '~socializer/stores/chat.js'
    import { useConversationsStore } from '~socializer/stores/conversations.js'
    import resizable from "~socializer/directives/resizable_vertical.js"

    export default {
        name: 'Teams',
        components: {
            ConversationList,
            ChatWidget,
        },
        directives: {
            resizable,
        },
        data() {
            return {
                initialSidebarWidth: 300,
                sidebarWidth : null,
                chat: null
            }
        },
        created() {
            document.querySelector('body').classList.add("conversations-page")
            this.loadConversations()
        },
        mounted() {
            this.sidebarWidth = this.initialSidebarWidth
        },
        computed: {
            ...mapState(useChatStore, {
                currentConversation: 'getCurrentConversation',
            }),
            ...mapState(useConversationsStore, {
                conversations: 'getConversations',
            }),
        },
        methods: {
            ...mapActions(useChatStore, [
                'loadConversation',
                'leaveCurrentConversation',
            ]),
            ...mapActions(useConversationsStore, [
                'loadConversations',
                'createConversation',
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
            updateSidebarWidth(newWidth) {
                this.sidebarWidth = newWidth;
            }
        }
    }
</script>