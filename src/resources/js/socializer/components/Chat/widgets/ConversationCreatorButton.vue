<template>

    <ul class="nav nav-underline mb-3">
        <li class="nav-item">
            <a class="nav-link" 
                :class="{active : isContactList }"
                :aria-current="isContactList ? true : false" 
                href="#"
                @click="onSetConversationContacts"
                >Contacts</a>
        </li>
        <li v-if="hasAgents" class="nav-item">
            <a class="nav-link" 
                :class="{active : isAgentList }"
                :aria-current="isAgentList ? true : false" 
                href="#"
                @click="onSetConversationAgent"
                >Agent</a>
        </li>
    </ul>

    <div v-if="isAgentList"
        :class="{dropdown: hasMultiAgents }">
        <button class="btn btn-primary btn-sm" 
            :class="{dropdownToggle: hasMultiAgents }"
            type="button" 
            data-bs-toggle="dropdown" 
            aria-expanded="false"
            @click="onSelectAgent(availableAgents[0].bot_id)">
            <IconWidget icon="plus"></IconWidget> Nouvelle conversation
        </button>
        <ul v-if="hasMultiAgents" class="dropdown-menu">
            <li v-for="(agent, idx) in availableAgents" :key="idx">
                <a class="dropdown-item" href="#" @click="onSelectAgent(agent.bot_id)">{{ agent.name }}</a>
            </li>
        </ul>
    </div>

    <button v-else
        class="btn btn-primary btn-sm"
        @click="onCreateChat"
        ><IconWidget icon="plus"></IconWidget> Nouvelle conversation
    </button>

</template>

<script>
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import { coreAgentSettings } from '~socializer/components/Chat/agentSettings.js'

    export default {
        name: 'ConversationCreatorButton',
        emits: [
            'create-chat',
            'set-conversation-type',
        ],
        props: {
            conversationType: {
                type: String,
                default: 'contacts',
            },
        },
        components : {
            IconWidget,
        },
        data() {
            return {
                availableAgents: coreAgentSettings.agents || [],
                selectedAgent: null,
            }
        },
        computed: {
            isContactList() {
                return this.conversationType === 'contacts'
            },
            isAgentList() {
                return this.conversationType === 'agents'
            },
            hasAgents: function() {
                return this.availableAgents.length > 0
            },
            hasMultiAgents: function() {
                return this.availableAgents.length > 1
            },
        },
        methods: {
            onCreateChat() {
                this.$emit('create-chat', this.selectedAgent)
            },
            onSetConversationAgent() {
                this.$emit('set-conversation-type', 'agents')
            },
            onSetConversationContacts() {
                this.selectedAgent = null
                this.$emit('set-conversation-type', 'contacts')
            },
            onSelectAgent(agent) {
                this.selectedAgent = agent
                this.onCreateChat
            }
        },
    }
</script>