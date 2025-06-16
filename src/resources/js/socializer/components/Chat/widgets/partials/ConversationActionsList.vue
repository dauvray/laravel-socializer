<template>
    <li>
        <a class="dropdown-item" href="#" @click="onQuitChat">
            <IconWidget icon="user-times"></IconWidget> Quitter
        </a>
    </li>
    <li>
        <a class="dropdown-item" href="#" @click="onDeleteChat">
            <IconWidget icon="trash-alt"></IconWidget> Effacer
        </a>
    </li>
</template>

<script>
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import { mapActions, mapState } from 'pinia'
    import { useConversationsStore } from '~socializer/stores/conversations.js'
    import { useChatStore } from '~socializer/stores/chat.js'

    export default {
        name: 'ConversationActionsList',
        inject: ['AWN'],
        emits: [
            'quit-chat',
        ],
        components: {
            IconWidget,
        },
        props: {
            conversation: {
                type: Object,
                required: true
            }
        },
        computed: {
            ...mapState(useChatStore, {
                currentConversationId: 'getCurrentConversationId',
            }),
        },
        methods: {
            ...mapActions(useConversationsStore, [
                'deleteConversation',
                'quitConversation',
            ]),
            ...mapActions(useChatStore, [
                'leaveCurrentConversation',
            ]),
            onQuitChat() {
                let onOk = () => {
                    this.quitConversation(this.conversation.id)
                    .then(() => {
                        if (this.currentConversationId === this.conversation.id) {
                            this.leaveCurrentConversation()
                        }
                        // Emit an event to notify the parent component
                        this.$emit('quit-chat')
                    })
                }
                let onCancel = () => {}
                this.AWN.confirm(
                    'Etes-vous certain ?',
                    onOk,
                    onCancel,
                    {
                        labels : {
                            confirm: 'Quitter la conversation',
                            confirmOk: "Valider",
                            confirmCancel: "Annuler",
                        }
                    }
                )
            },
            onDeleteChat() {
                let onOk = () => {
                     this.deleteConversation(this.conversation.id)  
                }
                let onCancel = () => {}
                this.AWN.confirm(
                    'Etes-vous certain ?',
                    onOk,
                    onCancel,
                    {
                        labels : {
                            confirm: 'Supprimer la conversation',
                            confirmOk: "Valider",
                            confirmCancel: "Annuler",
                        }
                    }
                )
            },
        }
    }
</script>