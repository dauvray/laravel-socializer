<template>
    <button
        type="button"
        class="btn btn-primary shadow-sm"
        title="Configurer le questionnaire"
        @click="onShowModal"
        ><IconWidget icon='paper-plane'></IconWidget> Publier
    </button>
    <ModalWidget
        v-if="showModal"
        target="publishPostModal"
        :showBtn="false"
        :canValidate="canValidate"
        :trigger="showModal"
        @hidden="showModal = false"
        @saveModalChanges="onValidPost"
        >
        <template #body>
            <questionnaire-component
                ref="postForm"
                :questionnaireid="feedFormId"
                :isstandalone="true"
                :payload="{
                'feed_id': feedId, 
                'history': null,
                }"
                :deportSending="true"
                deportvalidation="true"
                @deport-sending="onSendPost"
                @deported-validation="onIsValidPost"
            ></questionnaire-component>
        </template>
    </ModalWidget>
</template>

<script>
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import { useFeedStore } from '~socializer/stores/feed.js'
    import { mapActions } from 'pinia'
    import { defineAsyncComponent } from 'vue'

    export default {
        name: 'PublishButton',
        components: {
            IconWidget,
            ModalWidget: defineAsyncComponent(() => import('~estarter/components/widgets/Modal.vue')),
        },
        props: {
            feedFormId: {
                type: Number,
                required: true
            },
            feedId: {
                type: Number,
                required: true
            },
        },
        data() {
            return {
                showModal: false,
                canValidate: false,
            }
        },
        methods: {
            ...mapActions(useFeedStore, [
                'sendFeedPost',
                'insertPost',
            ]),
            onShowModal() {
                this.showModal = true
            },
            onValidPost() {
                this.$refs.postForm.onValidQuestionnaire() 
            },
            onIsValidPost(isValid) {
                this.canValidate = isValid
            },
            async onSendPost(formData) {
                const post = await this.sendFeedPost(formData)
                this.$refs.postForm.afterValidation(post)
                this.insertPost(post)
            },
        }
    }
</script>