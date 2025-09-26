<template>
    <div class="conversations-wrapper">
        <Teleport to="#app-header-tools">
            <div v-if="isStreamable" 
                id="room-stream-btn" 
                role="group">
                <StreamUserButton 
                    ref="webcamBtn"
                    :users="chatters"
                    :room="currentConversationId"
                    @started-stream="onStartedStream"
                    @stoped-stream="onStopedStream"
                ></StreamUserButton>
                <CaptureUserButton
                    ref="screenBtn"
                    :users="chatters"
                    :room="currentConversationId"
                    @started-stream="onStartedStream"
                    @stoped-stream="onStopedStream"
                ></CaptureUserButton>
            </div>
        </Teleport> 

        <div class="conversations-list-wrapper"
            v-resizable="{
                min: initialSidebarWidth,
                max: 600,
                callback: updateSidebarWidth
            }">

            <ConversationCreatorButton
                :conversation-type="conversationType"
                @create-chat="onCreateChat"
                @set-conversation-type="conversationType = $event"
            ></ConversationCreatorButton>

            <ConversationList
                :conversations="conversations"
                @join-chat="onJoinChat"
            ></ConversationList>

        </div>

        <ChatComponent 
            v-if="currentConversation"
            ref="chatWidget"
            :display-separator="conversationType != 'agents'"
            @update-chatters="onUpdateChatters"
            @update-conversation-title="onUpdatedConversationTitle"
        ></ChatComponent>

        <dtemplate v-else >
           <span class="p-3"> Aucune conversation sélectionnée.</span>
        </dtemplate>

    </div>
</template>

<script>

    import { defineAsyncComponent } from '@vue/runtime-core'
    import ChatComponent from '~socializer/components/Chat/ChatComponent.vue'
    import ConversationList from '~socializer/components/Chat/widgets/ConversationList.vue'
    import { mapActions, mapState } from 'pinia'
    import { useChatStore } from '~socializer/stores/chat.js'
    import { useConversationsStore } from '~socializer/stores/conversations.js'
    import resizable from "~socializer/directives/resizable_vertical.js"
    import ConversationCreatorButton from '~socializer/components/Chat/widgets/ConversationCreatorButton.vue'

    export default {
        name: 'Teams',
        components: {
            ConversationList,
            ConversationCreatorButton,
            ChatComponent,
            StreamUserButton: defineAsyncComponent(() => import('~socializer/components/WebRTC/widgets/StreamUserButton.vue')),
            CaptureUserButton: defineAsyncComponent(() => import('~socializer/components/WebRTC/widgets/CaptureUserButton.vue')),
        },
        directives: {
            resizable,
        },
        data() {
            return {
                initialSidebarWidth: 300,
                sidebarWidth : null,
                conversationType: 'contacts', // 'agents'
                chatters: [],
            }
        },
        created() {
            document.querySelector('body').classList.add("conversations-page")
            this.onLoadConversations()
        },
        mounted() {
            this.sidebarWidth = this.initialSidebarWidth
        },
        computed: {
            ...mapState(useChatStore, {
                currentConversation: 'getCurrentConversation',
                currentConversationId: 'getCurrentConversationId',
            }),
            ...mapState(useConversationsStore, {
                conversations: 'getConversations',
            }),
            isStreamable: function() {
                return this.currentConversationId && this.conversationType === 'contacts'
            },
        },
        watch: {
            conversationType(newVal) {
                 this.onLoadConversations(newVal)
            }
        },
        methods: {
            ...mapActions(useChatStore, [
                'loadConversation',
                'leaveCurrentConversation',
                'setCurrentConversation',
            ]),
            ...mapActions(useConversationsStore, [
                'loadConversations',
                'createConversation',
                'updateConversationName',
            ]),
            updateSidebarWidth(newWidth) {
                this.sidebarWidth = newWidth
            },
            onLoadConversations(conversationType) {
                this.leaveCurrentConversation()
                this.loadConversations(conversationType)
            },
            onJoinChat(vertexid) {
                this.leaveCurrentConversation()
                this.loadConversation(vertexid)
                setTimeout(() => {
                    this.$refs.chatWidget.scrollView()
               }, 700)
            },
            onCreateChat(botId = null) {
                if( this.conversationType === 'contacts' ) {
                    this.createConversation()
                    .then(res => {
                        this.setCurrentConversation(res)
                    })
                } else {
                     this.createConversation({
                        privacy: 1,
                        is_bot: 1,
                        bot_id: botId,
                     })
                    .then(res => {
                        this.setCurrentConversation(res)
                    })
                }
            },
            onUpdateChatters(chatters) {
                this.chatters = chatters
            },
            onUpdatedConversationTitle(title) {
                if(this.currentConversationId && title) {
                    this.updateConversationName(this.currentConversationId, title)
                }
            },
        }
    }
</script>