<template>
    <div class="conversations-wrapper">
        <div class="conversations-list-wrapper"
            v-resizable="{
                min: initialSidebarWidth,
                max: 600,
                callback: updateSidebarWidth
            }">

            <ConversationCreatorButton
                @create-chat="onCreateChat"
            ></ConversationCreatorButton>

            <ul class="nav nav-underline mb-3">
                <li class="nav-item">
                    <a class="nav-link" 
                        :class="{active : isContactList }"
                        :aria-current="isContactList ? true : false" 
                        href="#"
                        @click="conversationType = 'contacts'"
                        >Contacts</a>
                </li>
                <li v-if="hasAgents" class="nav-item">
                    <a class="nav-link" 
                    :class="{active : isAgentList }"
                    :aria-current="isAgentList ? true : false" 
                    href="#"
                    @click="conversationType = 'agents'"
                    >Agent</a>
                </li>
            </ul>

            <ConversationList
                :conversations="conversations"
                @join-chat="onJoinChat"
                @create-chat="onCreateChat"
            ></ConversationList>

        </div>
        <ChatComponent 
            v-if="currentConversation"
            ref="chatWidget"
        ></ChatComponent>
    </div>
</template>

<script>
   
    import ChatComponent from '~socializer/components/Chat/ChatComponent.vue'
    import ConversationList from '~socializer/components/Chat/widgets/ConversationList.vue'
    import { mapActions, mapState } from 'pinia'
    import { useChatStore } from '~socializer/stores/chat.js'
    import { useConversationsStore } from '~socializer/stores/conversations.js'
    import resizable from "~socializer/directives/resizable_vertical.js"
    import ConversationCreatorButton from '~socializer/components/Chat/widgets/ConversationCreatorButton.vue'
    import { coreAgentSettings } from '~socializer/components/Chat/agentSettings.js'

    export default {
        name: 'Teams',
        components: {
            ConversationList,
            ConversationCreatorButton,
            ChatComponent,
        },
        directives: {
            resizable,
        },
        data() {
            return {
                initialSidebarWidth: 300,
                sidebarWidth : null,
                conversationType: 'contacts', // 'agents'
                availableAgents: coreAgentSettings.agents || [],
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
            }),
            ...mapState(useConversationsStore, {
                conversations: 'getConversations',
            }),
            isContactList: function() {
                return this.conversationType === 'contacts'
            },
            isAgentList: function() {
                return this.conversationType === 'agents'
            },
            hasAgents: function() {
                return this.availableAgents.length > 0
            }   
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
            onCreateChat() {
                if( this.conversationType === 'contacts' ) {
                    this.createConversation()
                    .then(res => {
                        this.setCurrentConversation(res)
                    })
                } else {
                     this.createConversation({
                        privacy: 1,
                        is_bot: 1,
                        url_bot: coreAgentSettings.agents[0].url,
                     })
                    .then(res => {
                        this.setCurrentConversation(res)
                    })
                }
            },
        }
    }
</script>