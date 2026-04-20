<template>
    <div class="chat-wrapper">
        <Teleport to="#room-header-tools">
            <StreamUserButton 
                ref="webcamBtn"
                :users="chatters"
                :room="currentConversationId"
            ></StreamUserButton>
            <CaptureUserButton
                ref="screenBtn"
                :users="chatters"
                :room="currentConversationId"
            ></CaptureUserButton>
            <ChatContactsButton
                v-if="isContactBtnVisible"
                :conversation="currentConversation.general"
                @add-contact="onAddContact"
                @quit-chat="onQuitChat"
            ></ChatContactsButton>
        </Teleport>

        <RoomUsersList v-if="displayUsers" 
            :users="chatters"
        ></RoomUsersList>

        <div class="chat-messages-wrapper">
            <div class="chat-messages" ref="messageContainer">
                <div class="chat-messages-inner" ref="messageContainerInner">
                    <IntersectionObserver
                        v-if="intersectionObserver"
                        @trigger-intersected="onTriggerObserver"
                    ></IntersectionObserver>
                    <template v-for="(item, idx) in messages" :key="idx">
                        <DateSeparator 
                            v-if="shouldShowDateSeparator(item, idx)"
                            :date="item.created_at"
                        />
                        <MessageWidget 
                            :class="idx === messages.length - 1 ? 'lastMessage' : null"
                            :item="item"
                            :conversationId="currentConversationId"
                            @selected-emoji="onSelectedEmoji"
                            @delete-message="onDeleteMessage"
                            @update-message="onUpdateMessage"
                            @show-file="onShowFileInModal"
                        ></MessageWidget>
                    </template>
                </div>
                <UploadFilesTable v-if="attachedFiles.length"
                    :attachedFiles="attachedFiles"
                    @remove-file="onRemoveFile"
                ></UploadFilesTable>
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
                        ref="messengerInput"
                        @start-writting="onStartWritting"
                        @stop-writting="onStopWritting"
                        @send-message="onSendMessage"
                        @open-wysiwyg="onWysiwyg"
                        @update-height="updateElHeight"
                        @record-result="onRecorded"
                        @file-added="onFileAdded"
                        @file-removed="onRemovedFile"
                    ></TextareaMessage>
                </div>
            </div>
        </div>

        <DataUserPeerConnection 
            v-if="chatters && currentConversation"
            :users="chatters"
            :roomId="currentConversationId"
            :callback-connection="connectionDataCallback"
        ></DataUserPeerConnection>
        <ModalWidget
            v-if="showModal"
            target="ModalChat"
            :trigger="showModal"
            modalClasses="modal-fullscreen"
            bodyClasses="d-flex justify-content-center"
            :showBtn="false"
            @hidden="onHideModal">
            <template #header> </template>
            <template #body>
                <img :src="fileUrl"  /> 
            </template>
        </ModalWidget>
    </div>
</template>

<script>

    import { defineAsyncComponent } from '@vue/runtime-core'
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import ChatContactsButton from './widgets/ChatContactsButton.vue'
    import MessageWidget from '~socializer/components/Chat/widgets/MessageWidget.vue'
    import { mapActions, mapState } from 'pinia'
    import { usePeerStore } from '~socializer/stores/peers.js'
    import { useChatStore } from '~socializer/stores/chat.js'
    import { useMeStore } from '~estarter/stores/me.js'
    import DataUserPeerConnection from '~socializer/components/WebRTC/widgets/DataUserPeerConnection.vue'
    import IntersectionObserver from '~socializer/components/widgets/IntersectionObserver.vue'
    import SpinnerTextWriting from '~estarter/components/widgets/Spinners/SpinnerTextWriting.vue'
    import TextareaMessage from './widgets/partials/TextareaMessage.vue'
    import resizable from "~socializer/directives/resizable_horizontal.js"
    import DateSeparator from './widgets/partials/DateSeparator.vue'

    export default {
        name: 'ChatComponent',
        inject: ["eventBus"],
        emits: [
            'update-chatters',
            'update-conversation-title',
        ],
        components: {
            IconWidget,
            ChatContactsButton,
            DataUserPeerConnection,
            StreamUserButton: defineAsyncComponent(() => import('~socializer/components/WebRTC/widgets/StreamUserButton.vue')),
            CaptureUserButton: defineAsyncComponent(() => import('~socializer/components/WebRTC/widgets/CaptureUserButton.vue')),
            IntersectionObserver,
            MessageWidget,
            SpinnerTextWriting,
            DateSeparator,
            RoomUsersList: defineAsyncComponent(() => import('~socializer/components/Server/widgets/RoomUsersList.vue')),
            ModalWidget: defineAsyncComponent(() => import('~estarter/components/widgets/ModalLazy.js')),
            TextareaMessage,
            UploadFilesTable: defineAsyncComponent(() => import('~socializer/components/Chat/widgets/partials/UploadFilesTable.vue')),
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
            displayUsers: {
                type: Boolean,
                required: false,
                default: true,
            },
            displaySeparator: {
                type: Boolean,
                required: false,
                default: true,
            },
            autoload: {
                type: Boolean,
                required: false,
                default: true,
            },
        },
        data() {
            return {
                currentConversationIdBackup: null,
                channelBackup: null,
                videoContainer: '#videoContainer',
                intersectionObserver: false,
                agentBot: null,
                actors: [],
                chatters: [],
                attachedFiles: [],
                cssVarName: '--messenger-height',
                initialElHeight: 50,
                ElHeight: null,
                showModal: false,
                fileUrl: null,
            }
        },
        computed: {
            ...mapState(useChatStore, {
                currentConversationId: 'getCurrentConversationId',
                messages:'getCurrentConversationMessages',
                currentConversation: 'getCurrentConversation',
                nextPageUrl: 'getCurrentConversationNextUrl',
                isBot: 'getIsBot',
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

            isContactBtnVisible: function() {
                return this.currentConversation && !this.currentConversation.general.chat.is_bot
            }

        },
        async created() {

            if(this.isBot){
                const settings = await import('~socializer/components/Chat/agentSettings.js')
                this.agentBot = settings.coreAgentSettings.agents.find(agent => agent.bot_id == this.currentConversation.general.chat.bot_id)
            }

            if(!this.currentConversation && this.autoload) {
                this.loadConversation(this.vertexId || this.$route.params.vertexId)
            } 
        },
        mounted() {
            setTimeout(()=> {
                this.waitImagesAndScroll()
            },1000)

            this.intersectionObserver = true
        },
        beforeUnmount() {
            Echo.leave(this.channelBackup)

            Echo.private(this.me.channel).whisper('leave-chat', {
                chatId: this.currentConversationIdBackup,
                userId: this.me.id,
            }) 
        },
        unmounted() {
            this.resetConversation(this.currentConversationIdBackup)
        },
        watch: {
            currentConversation: {
                handler(value) {
                    if(value) {
                        Echo.leave(this.channelBackup)
                        // backup pour unmount
                        this.currentConversationIdBackup = this.currentConversationId
                        this.channelBackup = this.channel
                        this.iniChatEvents()
                    }
                },
                immediate: true,
            },
            messages() {
                setTimeout(()=> {
                    this.waitImagesAndScroll(true)
                }, 1000)
            },
            chatters(newVal) {
                this.$emit('update-chatters', newVal)
            }
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

                            if(this.isBot){
                                this.chatters.push(this.agentBot)
                            }
                        })
                        .joining((user) => {
                            let index = this.chatters.findIndex((item) => item.id === user.id)
                            if (index === -1) {
                                this.chatters.push(user)
                            }
                        })
                        .leaving((user) => {
                            this.chatters = this.chatters.filter( chatter => {
                                return chatter.id != user.id
                            })
                        })
                        .listen('.receivedMsg', (event) => {
                            if(event.is_bot_answer) {
                                this.removeActorWriting('Agent Bot')
                            }
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
                        .listen('.updateConversationTitle', (event) => {
                           this.$emit('update-conversation-title', event.title)
                        })
                        .listen('.botWriting', () => {
                           this.addActorWriting('Agent Bot')
                        })
                        .error((error) => {
                            console.error(error);
                        })
                }
            },
            onSendMessage(message) {

                this.sendMessage(message, this.currentConversationId, this.attachedFiles)

                 // Reset
                this.attachedFiles = []
                this.$refs.messenger.style.setProperty(this.cssVarName, `${this.initialElHeight}px`);
                this.eventBus.$emit('sended-messenger-message');
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
                formData.append('chat_id', this.currentConversationId)
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
                const el = this.$refs.messageContainerInner
                if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'end' })
                }
            },
            waitImagesAndScroll(is_new_message = false) {
               
                const el = this.$refs.messageContainerInner
                if (!el) return

                const images = is_new_message ? el.querySelectorAll('lastMessage') : el.querySelectorAll('img')

                const total = images.length
                if (total === 0) {
                    this.scrollView()
                    return
                }

                let loaded = 0
                const checkDone = () => {
                    loaded++

                    if (loaded === total) {
                        this.scrollView()
                    }
                }

                images.forEach(img => {
                    if (img.complete) {
                        checkDone()
                    } else {
                        img.addEventListener('load', checkDone, { once: true })
                        img.addEventListener('error', checkDone, { once: true }) // au cas où une image échoue
                    }
                })
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
            onFileAdded(file) {
                 file.preview = URL.createObjectURL(file.data)
                 this.attachedFiles.push(file)
            },
            onRemoveFile(fileId) {
               this.$refs.messengerInput.removeFile(fileId)
            },
            onRemovedFile(file) {
                this.attachedFiles = this.attachedFiles.filter(f => f.id !== file.id)
            },

            /*------ RESIZER ----------*/
            updateElHeight(height) {
                if( height < this.initialElHeight) {
                    height = this.initialElHeight
                }
                this.ElHeight = height
                // Appliquer dynamiquement via variable CSS
                this.$refs.messenger.style.setProperty(this.cssVarName, `${this.ElHeight}px`)
            },
            onWysiwyg(opened) {
                if(opened) {
                    this.updateElHeight(this.initialElHeight + 300)
                } else {
                     this.updateElHeight(this.$refs.messengerInput.scrollHeight)
                } 
            },

            /*------  DATA CONNECTION ----------*/
            connectionDataCallback(conn) {

                conn.on("data", (data) => {
                    data = JSON.parse(data)

                    switch(data.action) {
                        case 'start_writing':
                            this.addActorWriting(data.from)
                            break
                        case 'stop_writing':
                            this.removeActorWriting(data.from)
                            break
                    }
                });

                conn.on("open", () => {
                    console.log('connection data chat ouverte', conn.connectionId)
                });
                conn.on("close", () => {
                    console.log('connection data chat fermée dans chat', conn.connectionId)
                });

            },
            onStartWritting() {
                this.sendData({
                    data: {
                        action: 'start_writing',
                        from: this.me.name,
                    }
                }, this.currentConversationId)
            },
            onStopWritting() {
                this.sendData({
                    data: {
                        action: 'stop_writing',
                        from: this.me.name,
                    }
                }, this.currentConversationId)
            },
            addActorWriting(name) {
                if (!this.actors.includes(name)) {
                    this.actors.push(name)
                }
            },
            removeActorWriting(name) {
                this.actors = this.actors.filter( item => {
                    return item !== name
                })
            },
            /*------  MODALE ----------*/
            onShowFileInModal(fileUrl) {
                this.fileUrl = fileUrl
                this.onShowModal()
            },
            onShowModal() {
                this.showModal = true
            },
            onHideModal() {
                this.showModal = false
            },
            /*********** DATES *******/
            shouldShowDateSeparator(currentMessage, index) {
                if(this.displaySeparator === false)  return false
                 
                // Toujours afficher le séparateur pour le premier message
                if (index === 0) return true
                
                const previousMessage = this.messages[index - 1]
                const currentDate = new Date(currentMessage.created_at).toDateString()
                const previousDate = new Date(previousMessage.created_at).toDateString()
                
                // Afficher le séparateur si le jour est différent du message précédent
                return currentDate !== previousDate
            },
        }
    }
</script>

<!-- <style>
    .thumbnail {
        width: 80px;
        height: 80px;
        object-fit: cover;
        border-radius: 4px;
    }
</style> -->