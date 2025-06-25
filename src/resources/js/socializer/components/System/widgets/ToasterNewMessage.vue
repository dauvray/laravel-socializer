<template>
    <div class="toast-chat-notification">
        <div ref="liveToast" class="toast" role="alert" aria-live="assertive" aria-atomic="true" data-bs-autohide="false">
            <div class="toast-header">
                <div class="toast-author">
                    <Gravatar
                        class="me-2"
                        size="small"
                        style="width: 35px;"
                        :user="event.author"
                        :showStatus="true"
                    ></Gravatar>
                    <UserWallLink :user="event.author"></UserWallLink>
                </div>
                <button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
            <div class="toast-body">
                <MessageContent
                    class="mb-2"
                    :item="event"
                    :conversationId="event.chat_id"
                    @show-file="onShowFile"
                ></MessageContent>
                <form class="row g-3">
                    <div class="input-group input-group-sm">
                        <input type="text" 
                            class="form-control" 
                            v-model="message"
                            placeholder="Réponse rapide" 
                            aria-label="Réponse rapide" 
                            aria-describedby="button-send-message">
                        <button class="btn btn-outline-secondary" 
                            type="button" 
                            id="button-send-message" 
                            @click="onSendMessage">
                            <IconWidget icon="paper-plane" />
                            <span class="visually-hidden">Envoyer</span>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    </div>
</template>

<script>
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import MessageContent from '~socializer/components/Chat/widgets/partials/MessageContent.vue'
    import Gravatar from '~estarter/components/widgets/Gravatar.vue'
    import UserWallLink from '~socializer/components/User/WallLink.vue'
    import { mapActions } from 'pinia'
    import { useChatStore } from '~socializer/stores/chat.js'

    export default {
        name: 'ToasterNewMessage',
        emits: [
            'closed',
            'send-message',
        ],
        components: {
            IconWidget,
            MessageContent,
            Gravatar,
            UserWallLink,
        },
        props: {
            event: {
                type: Object,
                required: true,
            },
        },
        data() {
            return {
                toastBootstrap: null,
                message: null,
            }
        },
        mounted() {
            this.toastBootstrap = bootstrap.Toast.getOrCreateInstance(this.$refs.liveToast)
            this.$refs.liveToast.addEventListener('hidden.bs.toast', this.onClose)
            this.toastBootstrap.show()
        },
        methods: {
            ...mapActions(useChatStore, [
                'sendMessage',
            ]),
            onSendMessage() {
                this.sendMessage(this.message, this.event.chat_id)
                this.toastBootstrap.hide()
                this.onClose()
            },
            onClose() {
                this.$emit('closed')
            },
        }
    }
</script>
