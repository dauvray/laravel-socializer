<template>
    <div class="chat-wrapper">
        <DataUserPeerConnection 
            v-if="chatters && currentConversation"
            :users="chatters"
            :roomId="currentConversationId"
            :callback-connection="connectionDataCallback"
        ></DataUserPeerConnection>
        <div class="chat-header" v-if="displayHeader">
            <RoomUsersList :users="chatters"></RoomUsersList>
            <ChatContactsButtons
                v-if="currentConversation"
                class="chat-tools"
                :conversation="currentConversation.general"
                @add-contact="onAddContact"
                @quit-chat="onQuitChat"
            ></ChatContactsButtons>
        </div>
        <div class="chat-messages-wrapper">
            <div class="chat-messages" ref="messageContainer">
                <div class="chat-messages-inner" ref="messageContainerInner">
                    <IntersectionObserver
                        v-if="intersectionObserver"
                        @trigger-intersected="onTriggerObserver"
                    ></IntersectionObserver>
                    <MessageWidget 
                        v-for="(item,idx) in messages"
                        :key="idx"
                        :item="item"
                        @selected-emoji="onSelectedEmoji"
                        @delete-message="onDeleteMessage"
                    ></MessageWidget>
                </div>
            </div>

            <div class="chat-messenger">
                <div v-if="actors.length" 
                    class="chat-messenger-writting">
                    <SpinnerTextWriting></SpinnerTextWriting>
                    <ul>
                        <li v-for="name in actors" 
                            :key="name"
                            class="d-flex align-items-center">
                            {{ name }} écrit ...
                        </li>
                    </ul>
                </div>
                 <TextareaMessage
                    @start-writting="onStartWritting"
                    @stop-writting="onStopWritting"
                    @send-message="onSendMessage"
                 ></TextareaMessage>
            </div>
        </div>
    </div>
  
</template>

<script>

    import { defineAsyncComponent } from '@vue/runtime-core'
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import ChatContactsButtons from './widgets/ChatContactsButton.vue'
    import MessageWidget from './widgets/MessageWidget.vue'
    import { mapActions, mapState } from 'pinia'
    import { usePeerStore } from '~socializer/stores/peers.js'
    import { useChatStore } from '~socializer/stores/chat.js'
    import { useMeStore } from '~estarter/stores/me.js'
    import DataUserPeerConnection from '~socializer/components/WebRTC/widgets/DataUserPeerConnection.vue'
    import IntersectionObserver from '~socializer/components/widgets/IntersectionObserver.vue'
    import SpinnerTextWriting from '~estarter/components/widgets/Spinners/SpinnerTextWriting.vue'
    import TextareaMessage from './widgets/partials/TextareaMessage.vue'

    export default {
        name: 'Chat',
        components: {
            IconWidget,
            ChatContactsButtons,
            DataUserPeerConnection,
            IntersectionObserver,
            MessageWidget,
            SpinnerTextWriting,
            RoomUsersList: defineAsyncComponent(() => import('~socializer/components/Server/widgets/RoomUsersList.vue')),
            TextareaMessage,
        },
        props: {
            vertexId: {
                type: String,
                required: false,
                default: null,
            },
            displayHeader: {
                type: Boolean,
                required: false,
                default: true,
            }
        },
        data() {
            return {
                videoContainer: '#videoContainer',
                intersectionObserver: false,
                actors: [],
                chatters: [],
            }
        },
        computed: {
            ...mapState(useChatStore, {
                currentConversationId: 'getCurrentConversationId',
                messages:'getCurrentConversationMessages',
                currentConversation: 'getCurrentConversation',
                nextPageUrl: 'getCurrentConversationNextUrl',
            }),
            ...mapState(useMeStore, {
                me: 'getMe',
            }),
            channel: function() {
                if(this.currentConversation) {
                    return `chat.${this.currentConversationId}`
                }
                return null
            },
        },
        created() {
            if(!this.currentConversation) {
                this.loadConversation(this.vertexId || this.$route.params.vertexId)
                .then(() => {
                    setTimeout(() => {
                        this.scrollView()
                    }, 300)
                })
            } else {
                this.iniChatEvents()
            }
        },
        mounted() {
            setTimeout(() => {
                this.intersectionObserver = true
            },1000)
        },
        beforeUnmount() {
            Echo.leave(this.channel)
            this.resetConversation()
        },
        watch: {
            currentConversation(value) {
                if(value) {
                    this.iniChatEvents()
                }
            },
        },
        methods: {
            ...mapActions(useChatStore, [
                'addContactToConversation',
                'loadConversation',
                'resetConversation',
                'sendMessage',
                'receiveMessage',
                'leaveCurrentConversation',
                'updateConversationInfos',
                'sendEmoji',
                'receiveEmoji',
                'deleteMessage',
                'deletedMessage',
            ]),
            ...mapActions(usePeerStore, [
                'sendData',
            ]),
            iniChatEvents() {
                if(this.channel) {
                    Echo.leave(this.channel)
                    Echo.join(this.channel)
                        .here((users) => {
                            this.chatters = users
                        })
                        .joining((user) => {
                            this.chatters.push(user)
                        })
                        .leaving((user) => {
                            this.chatters = this.chatters.filter( chatter => {
                                return chatter.id != user.id
                            })
                        })
                        .listen('.receivedMsg', (event) => {
                            this.onReceiveMessage(event)
                        })
                        .listen('.receivedEmoji', (event) => {
                           this.receiveEmoji(event)
                        })
                        .listen('.updateChatters', (event) => {
                            this.updateConversationInfos(event)
                        })
                        .listen('.deletedMessage', (event) => {
                            this.onDeletedMessage(event.messageId)
                        })
                        .error((error) => {
                            console.error(error);
                        })
                }
            },
            onSendMessage(message) {
                this.sendMessage({
                    message: message,
                    chatId: this.currentConversationId,
                })
            },
            onSelectedEmoji(emoji, message) {
                this.sendEmoji({
                    emoji: emoji,
                    messageId: message.id,
                    chatId: this.currentConversationId,
                    from: this.me.slug,
                })
            },
            onDeleteMessage(messageId) {
                this.deleteMessage({
                    messageId: messageId,
                    chatId: this.currentConversationId,
                    from: this.me.slug,
                })
            },
            onReceiveMessage(event) {
                this.receiveMessage(event)
                setTimeout(() => {
                    this.scrollView()
               }, 300)
            },
            onDeletedMessage(event) {
                this.deletedMessage(event)
            },
            onAddContact(identifier) {
                this.addContactToConversation(identifier, this.currentConversationId)
            },
            scrollView() {
                this.$refs.messageContainerInner.scrollIntoView({ behavior: 'smooth', block: 'end' })
            },
            onTriggerObserver() {
                if(this.nextPageUrl) {
                    const container = this.$refs.messageContainer
                    const previousScrollHeight = container.scrollHeight

                    this.loadConversation(null, this.nextPageUrl).then(() => {
                        const newScrollHeight = container.scrollHeight
                        container.scrollTop += newScrollHeight - previousScrollHeight
                    })
                }  
            },
            onQuitChat() {
                this.leaveCurrentConversation()
                this.$router.push({ name: 'Teams'})
            },

            /*------  DATA CONNECTION ----------*/
            connectionDataCallback(conn) {
                console.log('nouvelle connexion data chat')
                conn.on("data", (data) => {
                    data = JSON.parse(data)
                    switch(data.action) {
                        case 'start_writing':
                            if (!this.actors.includes(data.from)) {
                                this.actors.push(data.from)
                                console.log(this.actors)
                            }
                            break
                        case 'stop_writing':
                        this.actors = this.actors.filter( item => {
                                return item !== data.from
                            })
                            break
                    }
                });
                conn.on("open", () => {
                    console.log('connection data chat ouverte')
                });
                conn.on("close", () => {
                    console.log('connection data chat fermée')
                });
            },
            onStartWritting() {
                this.sendData({
                    action: 'start_writing',
                    from: this.me.name,
                }, this.currentConversationId)
            },
            onStopWritting() {
                this.sendData({
                    action: 'stop_writing',
                    from: this.me.name,
                }, this.currentConversationId)
            },
        }
    }
</script>