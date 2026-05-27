<template>
    <div class="chat-wrapper">

        <slot name="sidebar" :users="chatters">
            <RoomUsersList v-if="displayUsers"
                :users="chatters"
            ></RoomUsersList>
        </slot>

        <div class="chat-messages-wrapper">
            <div class="chat-messages" ref="messageContainer">
                <div class="chat-messages-inner" ref="messageContainerInner">
                    <IntersectionObserver
                        v-if="intersectionObserver"
                        @trigger-intersected="onTriggerObserver"
                    ></IntersectionObserver>
                    <slot name="before-messages"></slot>
                    <slot v-if="!messages.length"
                        name="empty"
                        :conversation-id="currentConversationId"
                    ></slot>
                    <template v-for="(item, idx) in messages" :key="item.id">
                        <slot name="date-separator" :date="item.created_at">
                            <DateSeparator
                                v-if="shouldShowDateSeparator(item, idx)"
                                :date="item.created_at"
                            />
                        </slot>
                        <slot name="message"
                            :item="item"
                            :index="idx"
                            :conversation-id="currentConversationId"
                            :on-selected-emoji="onSelectedEmoji"
                            :on-delete-message="onDeleteMessage"
                            :on-update-message="onUpdateMessage"
                            :on-show-file="onShowFileInModal">
                            <MessageWidget
                                :class="idx === messages.length - 1 ? 'lastMessage' : null"
                                :item="item"
                                :conversationId="currentConversationId"
                                @selected-emoji="onSelectedEmoji"
                                @delete-message="onDeleteMessage"
                                @update-message="onUpdateMessage"
                                @show-file="onShowFileInModal"
                            ></MessageWidget>
                        </slot>
                    </template>
                </div>
                <UploadFilesTable v-if="attachedFiles.length"
                    :attachedFiles="attachedFiles"
                    @remove-file="onRemoveFile"
                ></UploadFilesTable>
            </div>
            <button v-if="hasNewMessages"
                type="button"
                class="chat-new-messages-btn"
                @click="scrollToBottom">
                Nouveaux messages ↓
            </button>

            <div class="chat-messenger-sticky-wrapper">
                <div class="chat-messenger-ghost"></div>
                <div class="chat-messenger"
                    ref="messenger"
                    v-resizable="resizeOptions">
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
                    <slot name="input"
                        :start-writting="startWriting"
                        :stop-writting="stopWriting"
                        :on-send-message="onSendMessage"
                        :on-wysiwyg="onWysiwyg"
                        :update-height="updateElHeight"
                        :on-recorded="onRecorded"
                        :on-file-added="onFileAdded"
                        :remove-from-list="removeFromList">
                        <TextareaMessage
                            ref="messengerInput"
                            @start-writting="startWriting"
                            @stop-writting="stopWriting"
                            @send-message="onSendMessage"
                            @open-wysiwyg="onWysiwyg"
                            @update-height="updateElHeight"
                            @record-result="onRecorded"
                            @file-added="onFileAdded"
                            @file-removed="removeFromList"
                        ></TextareaMessage>
                    </slot>
                </div>
            </div>
        </div>

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

<script setup>

    import { ref, computed, inject, onMounted, onBeforeUnmount, onUnmounted, watch, defineAsyncComponent } from 'vue'
    import { useRoute } from 'vue-router'
    import { storeToRefs } from 'pinia'
    import MessageWidget from '~socializer/components/Chat/widgets/MessageWidget.vue'
    import { useChatStore } from '~socializer/stores/chat.js'
    import { useMeStore } from '~estarter/stores/me.js'
    import IntersectionObserver from '~socializer/components/widgets/IntersectionObserver.vue'
    import SpinnerTextWriting from '~estarter/components/widgets/Spinners/SpinnerTextWriting.vue'
    import TextareaMessage from './widgets/partials/TextareaMessage.vue'
    import resizable from "~socializer/directives/resizable_horizontal.js"
    import DateSeparator from './widgets/partials/DateSeparator.vue'
    import { useReverbPresence } from '~socializer/components/System/composables/useReverbChannel.js'
    import { useTypingIndicator } from './composables/useTypingIndicator.js'
    import { useChatAttachments } from './composables/useChatAttachments.js'
    import { useChatScroll } from './composables/useChatScroll.js'
    import { useResizableElement } from '~socializer/composables/useResizableElement.js'
    import { shouldShowDateSeparator as computeDateSeparator } from './utils/dateSeparator.js'

    // Composants asynchrones
    const RoomUsersList = defineAsyncComponent(() => import('~socializer/components/Server/widgets/RoomUsersList.vue'))
    const ModalWidget = defineAsyncComponent(() => import('~estarter/components/widgets/ModalLazy.js'))
    const UploadFilesTable = defineAsyncComponent(() => import('~socializer/components/Chat/widgets/partials/UploadFilesTable.vue'))

    // Directive locale (template : v-resizable)
    const vResizable = resizable

    const props = defineProps({
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
    })

    const emit = defineEmits([
        'update-chatters',
        'update-conversation-title',
    ])

    const eventBus = inject('eventBus')
    const route = useRoute()

    /*------ STORES ----------*/
    const chatStore = useChatStore()
    const {
        getCurrentConversationId: currentConversationId,
        getCurrentConversationMessages: messages,
        getCurrentConversation: currentConversation,
        getCurrentConversationNextUrl: nextPageUrl,
        getIsBot: isBot,
    } = storeToRefs(chatStore)
    const {
        loadConversation,
        resetConversation,
        sendMessage,
        receiveMessage,
        updateConversationInfos,
        sendEmoji,
        receiveEmoji,
        deleteMessage,
        deletedMessage,
        updateMessage,
        updatedMessage,
        sendAudio,
    } = chatStore

    const meStore = useMeStore()
    const { getMe: me } = storeToRefs(meStore)

    /*------ STATE ----------*/
    const currentConversationIdBackup = ref(null)
    const intersectionObserver = ref(false)
    const agentBot = ref(null)
    const initialElHeight = 50
    const showModal = ref(false)
    const fileUrl = ref(null)

    // Refs de template
    const messenger = ref(null)
    const messengerInput = ref(null)

    /*------ RESIZE HAUTEUR DU MESSENGER ----------*/
    // Comportement générique (clamp + variable CSS + reset) délégué au composable.
    // `resizeOptions` est branché tel quel sur la directive v-resizable.
    const {
        applySize: updateElHeight,
        reset: resetMessengerHeight,
        resizeOptions,
    } = useResizableElement(messenger, {
        cssVar: '--messenger-height',
        min: initialElHeight,
        max: 600,
        initial: initialElHeight,
        position: 'top',
    })

    /*------ PIÈCES JOINTES ----------*/
    const {
        attachedFiles,
        onFileAdded,
        removeFromList,
        clear: clearAttachments,
    } = useChatAttachments()

    /*------ SCROLL ----------*/
    // Refs de template `messageContainer` / `messageContainerInner` possédées par
    // le composable. Auto-scroll au montage + à chaque nouveau message, et
    // pagination infinie (watch + onMounted internes au composable).
    const {
        messageContainer,
        messageContainerInner,
        scrollToBottomIfStuck,
        scrollToBottom,
        onTriggerObserver,
        stickToBottom,
        hasNewMessages,
    } = useChatScroll({ messages, nextPageUrl, loadConversation })

    /*------ COMPUTED ----------*/
    const channel = computed(() => {
        if(currentConversation.value) {
            return `chat.${currentConversationId.value}`
        }
        return null
    })

    /*------ TYPING INDICATOR ----------*/
    // Transport unique Reverb : whisper 'typing' entre users + signal serveur bot.
    // `sendWhisper` pointe vers le canal de présence géré juste après par useReverbPresence.
    const sendWhisper = (event, payload) => channelApi?.whisper(event, payload)

    const {
        actors,
        onTypingWhisper,
        removeTypingUser,
        startWriting,
        stopWriting,
        addActorWriting,
        removeActorWriting,
    } = useTypingIndicator({ currentUser: me, whisper: sendWhisper })

    /*------ ECHO / REVERB ----------*/
    // Canal de présence du chat : join/leave auto au changement de conversation,
    // leave auto au démontage, et reconnexion des listeners gérés par le composable.
    const channelApi = useReverbPresence(channel, {
        listeners: {
            '.receivedMsg': (event) => {
                if(event.is_bot_answer) {
                    removeActorWriting('Agent Bot')
                }
                onReceiveMessage(event)
            },
            '.receivedEmoji': (event) => receiveEmoji(event),
            '.updateChatters': (event) => updateConversationInfos(event),
            '.deletedMessage': (event) => onDeletedMessage(event.vertexid),
            '.updatedMsg': (event) => onUpdatedMessage(event),
            '.updateConversationTitle': (event) => emit('update-conversation-title', event.title),
            '.botWriting': () => addActorWriting('Agent Bot'),
        },
        whispers: {
            typing: onTypingWhisper,
        },
        onLeaving: (user) => removeTypingUser(user?.id),
        onError: (error) => {
            console.error(error)
        },
    })
    const { users: presentUsers } = channelApi

    // La liste des participants = utilisateurs présents (+ l'agent bot le cas échéant).
    const chatters = computed(() => {
        if(isBot.value && agentBot.value) {
            return [...presentUsers.value, agentBot.value]
        }
        return presentUsers.value
    })

    /*------ METHODS ----------*/
    function onSendMessage(message) {

        sendMessage(message, currentConversationId.value, attachedFiles.value)

        // Envoyer son propre message réarme l'auto-scroll : on veut le voir
        // apparaître en bas même si on était remonté dans l'historique.
        stickToBottom.value = true

         // Reset
        clearAttachments()
        resetMessengerHeight();
        eventBus.$emit('sended-messenger-message');
    }

    function onUpdateMessage(message, messageId) {
        updateMessage({
            message: message,
            messageId: messageId,
            chatId: currentConversationId.value,
        })
    }

    function onRecorded(formData) {
        formData.append('message', '')
        formData.append('chat_id', currentConversationId.value)
        sendAudio( formData )
    }

    function onSelectedEmoji(emoji, message) {
        sendEmoji({
            emoji: emoji,
            messageId: message.id,
            chatId: currentConversationId.value,
            from: me.value.slug,
        })
    }

    function onDeleteMessage(messageId) {
        deleteMessage({
            messageId: messageId,
            chatId: currentConversationId.value,
            from: me.value.slug,
        })
    }

    function onUpdatedMessage(payload) {
        updatedMessage(payload)
    }

    function onReceiveMessage(event) {
        receiveMessage(event)
        setTimeout(() => {
            scrollToBottomIfStuck()
       }, 300)
    }

    function onDeletedMessage(vertexid) {
        deletedMessage(vertexid)
    }

    // Reste dans le composant : croise la ref de template `messengerInput`.
    function onRemoveFile(fileId) {
       messengerInput.value.removeFile(fileId)
    }

    /*------ RESIZER ----------*/
    function onWysiwyg(opened) {
        if(opened) {
            updateElHeight(initialElHeight + 300)
        } else {
             updateElHeight(messengerInput.value.scrollHeight)
        }
    }

    /*------  MODALE ----------*/
    function onShowFileInModal(url) {
        fileUrl.value = url
        onShowModal()
    }

    function onShowModal() {
        showModal.value = true
    }

    function onHideModal() {
        showModal.value = false
    }

    /*********** DATES *******/
    // Logique pure déléguée à utils/dateSeparator.js ; on lui passe la liste
    // réactive + les props. Wrapper conservé pour ne pas toucher au template.
    const shouldShowDateSeparator = (item, index) =>
        computeDateSeparator(messages.value, index, props.displaySeparator)

    /*------ WATCHERS ----------*/
    // Le join/leave du canal est géré par useReverbPresence (canal réactif).
    // On conserve uniquement la sauvegarde de l'id pour le démontage.
    watch(currentConversationId, (value) => {
        if(value) {
            currentConversationIdBackup.value = value
        }
    }, { immediate: true })

    watch(chatters, (newVal) => {
        emit('update-chatters', newVal)
    })

    /*------ LIFECYCLE ----------*/
    // équivalent de created() (async non bloquant)
    ;(async () => {
        if(isBot.value){
            const settings = await import('~socializer/components/Chat/agentSettings.js')
            agentBot.value = settings.coreAgentSettings.agents.find(agent => agent.bot_id == currentConversation.value.general.chat.bot_id)
        }

        if(!currentConversation.value && props.autoload) {
            loadConversation(props.vertexId || route.params.vertexId)
        }
    })()

    onMounted(() => {
        intersectionObserver.value = true
    })

    onBeforeUnmount(() => {
        // Le canal de présence du chat est quitté automatiquement par useReverbPresence.
        // On notifie le canal privé personnel de l'utilisateur de la sortie du chat.
        Echo.private(me.value.channel).whisper('leave-chat', {
            chatId: currentConversationIdBackup.value,
            userId: me.value.id,
        })
    })

    onUnmounted(() => {
        resetConversation(currentConversationIdBackup.value)
    })
</script>