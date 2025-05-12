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
    import { mapActions } from 'pinia'
    import { useChatStore } from '~socializer/stores/chat.js'

    export default {
        name: 'ConversationAction',
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
        methods: {
            ...mapActions(useChatStore, [
                'deleteConversation',
                'quitConversation',
            ]),
            onQuitChat() {
                let onOk = () => {
                    this.quitConversation(this.conversation.chat.id)
                    .then(() => {
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
                     this.deleteConversation(this.conversation.chat.id)  
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