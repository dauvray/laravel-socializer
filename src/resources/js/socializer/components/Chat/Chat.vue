<template>
    <div class="chat-wrapper">
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
                        v-for="(item, idx) in messages"
                        :key="idx"
                        :item="item"
                        @selected-emoji="onSelectedEmoji"
                        @delete-message="onDeleteMessage"
                        @update-message="onUpdateMessage"
                    ></MessageWidget>
                </div>
            </div>

            <div class="chat-messenger-sticky-wrapper">
                <div class="chat-messenger-ghost"></div>
                <div class="chat-messenger" 
                    ref="messenger"
                    v-resizable="{
                        min: initialElHeight,
                        max: 600,
                        position: 'top',
                        cssVarName: cssVarName,
                        callback: updateElHeight
                    }">
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
                        @open-wysiwyg="onWysiwyg"
                        @update-height="updateElHeight"
                        @record-result="onRecorded"
                    ></TextareaMessage>
                </div>
            </div>

        </div>
    </div>
    <DataUserPeerConnection 
        v-if="chatters && currentConversation"
        :users="chatters"
        :roomId="currentConversationId"
        :callback-connection="connectionDataCallback"
    ></DataUserPeerConnection>
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
    import resizable from "~socializer/directives/resizable_horizontal.js"

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
        directives: {
            resizable,
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
                cssVarName: '--messenger-height',
                initialElHeight: 50,
                ElHeight: null,
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
            this.intersectionObserver = true
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
                'updateMessage',
                'updatedMessage',
                'sendAudio',
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
                            this.onDeletedMessage(event.vertexid)
                        })
                        .listen('.updatedMsg', (event) => {
                            this.onUpdatedMessage(event)
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
                this.$refs.messenger.style.setProperty(this.cssVarName, `${this.initialElHeight}px`);
            },
            onUpdateMessage(message, messageId) {
                this.updateMessage({
                    message: message,
                    messageId: messageId,
                    chatId: this.currentConversationId,
                })
            },
            onRecorded(formData) {
                formData.append('message', '')
                formData.append('room_id', this.currentConversationId)
                this.sendAudio( formData )
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
            onUpdatedMessage(payload) {
                this.updatedMessage(payload)
            },
            onReceiveMessage(event) {
                this.receiveMessage(event)
                setTimeout(() => {
                    this.scrollView()
               }, 300)
            },
            onDeletedMessage(vertexid) {
                this.deletedMessage(vertexid)
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

            /*------ RESIZER ----------*/
            updateElHeight(height) {
              this.ElHeight = height
               // Appliquer dynamiquement via variable CSS
                this.$refs.messenger.style.setProperty(this.cssVarName, `${this.ElHeight}px`)
            },
            onWysiwyg() {

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