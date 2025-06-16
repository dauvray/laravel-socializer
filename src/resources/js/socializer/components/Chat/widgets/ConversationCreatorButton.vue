<template>
    <button 
        class="btn btn-primary btn-sm"
        @click="onCreateChat"
        ><IconWidget icon="plus"></IconWidget> Nouvelle conversation
    </button>
</template>

<script>
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'

    export default {
        name: 'ConversationCreatorButton',
        emits: [
            'create-chat',
        ],
        components : {
            IconWidget,
        },
        methods: {
            onCreateChat() {
                this.$emit('create-chat')
            },
        },
    }
</script>