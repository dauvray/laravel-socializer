<template>
    <div class="dropdown">
        <button class="btn" data-bs-toggle="dropdown">
            <IconWidget icon="user-friends"></IconWidget> {{ conversation.nb_contacts }}
        </button>
        <ul class="dropdown-menu">
            <li><span class="ms-3">Contacts</span>
                <ul class="list-group list-group-flush">
                    <li v-for="contact in conversation.users" 
                        class="list-group-item list-group-item-action"
                        :key="contact.id">
                        <div class="d-flex align-items-end">
                            <Gravatar 
                                :user="contact"
                                style="width:35px;"
                                :showStatus="false"
                            ></Gravatar>
                            <span class="ms-3">{{ contact.name }}</span>
                        </div>
                    </li>
                </ul>
            </li>
            <li><hr class="dropdown-divider"></li>
            <li>
                <a class="dropdown-item" href="#" @click="onShowContactModal">
                    <IconWidget icon="user-plus"></IconWidget> Inviter un contact
                </a>
            </li>
            <ConversationActions
                :conversation="conversation"
                @quit-chat="onQuitChat"
            ></ConversationActions>
        
        </ul>
    </div>

    <ModalWidget
        v-if="showModal"
        target="addContactModal"
        :showBtn="false"
        :canValidate="false"
        :trigger="showModal"
        @hidden="showModal = false"
        >
        <template #body>
        
            <div v-if="users" class="list-group list-group-flush ">
                <a v-for="user in users.data" :key="user.slug"
                    href="#"
                    class="list-group-item list-group-item-action"
                    @click="onAddContact(user.identifier)"
                >{{ user.name }}
                </a>
            </div>
        </template>
    </ModalWidget>
</template>

<script>

    import { defineAsyncComponent } from 'vue'
    import { useSocialUserStore } from '~socializer/stores/socialUser.js'
    import { mapActions, mapState } from 'pinia'
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import Gravatar from '~estarter/components/widgets/Gravatar.vue'
    import ConversationActions from './partials/ConversationActions.vue'

    export default {
        name: 'ChatContactButton',
        emits: [
            'add-contact',
            'quit-chat',
        ],
        components: {
            IconWidget,
            Gravatar,
            ModalWidget: defineAsyncComponent(() => import('~estarter/components/widgets/Modal.vue')),
            ConversationActions,
        },
        props: {
            conversation: {
                type: Object,
                required: true
            }
        },
        data() {
            return {
                showModal: false,
            }
        },
        computed: {
            ...mapState(useSocialUserStore, {
                users: 'getUsers',
            })
        },
        methods: {
            ...mapActions(useSocialUserStore, [
                'loadUsers',
            ]),
            onShowContactModal() {
                this.showModal = true
                this.loadUsers()
            },
            onAddContact(identifier) {
               this.$emit('add-contact', identifier)
            },
            onQuitChat() {
                this.$emit('quit-chat')
            },
        }
    }
</script>