<template>
    <ModalWidget
        data-test="fmd-modal-server"
        v-if="trigger"
        class="d-flex justify-content-end"
        modalClasses="modal-lg"
        target="server-params-modal"
        :trigger="trigger"
        :canValidate="canValidate"
        :showBtn="false"
        @hidden="onCancelEditModal"
        @saveModalChanges="onSaveUpdatedModal">
            <template #header>
                header
            </template>
            <template #body>
                <QuestionnaireComponent
                    ref="serverQuestionnaire"
                    v-if="questionnaireid"
                    :questionnaireid="questionnaireid"
                    :isstandalone="true"
                    :isnew="isNew"
                    :deportvalidation="true"
                    :loadable="false"
                    :modelPlaceholder="modelPlaceholder"
                    :customizeFields="customizeFields"
                    :deport-sending=true
                    @deport-sending="onQuestionnaireData"
                    @deported-validation="onQuestionnaireValidation"
                ></QuestionnaireComponent>
            </template>
    </ModalWidget>
</template>

<script>

    import { defineAsyncComponent } from '@vue/runtime-core'

    export default {
        name: 'CreateRoomModal',
        emits: [
            'hide-modal',
            'send-data'
        ],
        components: {
            ModalWidget: defineAsyncComponent(() => import('~estarter/components/widgets/Modal.vue')),
            QuestionnaireComponent: defineAsyncComponent(() => import('~formdesigner/application/formCreator/Questionnaire.vue')),
        },
        props: {
            questionnaireid: {
                type: Number,
                required: true,
                default: null
            },
            isNew: {
                type: Boolean,
                required: false,
                default: true,
            },
            modelPlaceholder: {
                type: Object,
                required: false,
                default: {}
            },
            customizeFields: {
                type: Array,
                required: false,
                default: []
            },
            trigger: {
                type: Boolean,
                required: true,
                default: false, 
            }
        },
        data() {
            return {
               canValidate: false,
               fieldValues: [],
            }
        },
        methods: {
            onCancelEditModal() {
                 this.$refs.serverQuestionnaire.setUnsavedStatus(false)
                 this.$emit('hide-modal')
            },
            onSaveUpdatedModal() {
                this.$refs.serverQuestionnaire.onValidQuestionnaire()
            },
            async onQuestionnaireData(formData){
                this.canValidate = false
                this.$refs.serverQuestionnaire.setUnsavedStatus(false) 
                this.$emit('send-data', formData)

            },
            onQuestionnaireValidation(isValid) {
                this.canValidate = isValid
            },
        }
    }
</script>
