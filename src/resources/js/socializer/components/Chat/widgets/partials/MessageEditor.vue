<template>
    <Wysiwyg
        v-model:content="localMessage"
    ></Wysiwyg>
    <button type="button" 
        class="btn btn-primary mt-2"
        @click="onCancel">
        close
        </button>
            <button type="button" 
        class="btn btn-primary mt-2"
        @click="onSendMessage">
        valid
        </button>
</template>

<script>
    import { defineAsyncComponent } from '@vue/runtime-core'

    export default {
        name: 'MessageEditor',
        components: {
            Wysiwyg: defineAsyncComponent(() => import('~formdesigner/application/formCreator/widgets/atoms/Wysiwyg.vue')),
        },
        emits: [
            'update-message',
            'cancel',
        ],
        props: {
            message: {
                type: String,
                required: true,
            },
        },
        data() {
            return {
                localMessage: this.message,
            };
        },
        mounted() {

        },
        unmounted() {

        },
        methods: {
            onSendMessage() {
                this.$emit('update-message', this.localMessage);
            },
            onCancel() {
                this.$emit('cancel');
            }
        },
    };
</script>