<template>
    <Questionnaire
        ref="serverQuestionnaire"
        :questionnaireid="currentQuestionnaireId"
        :iseditable="editable"
        :isstandalone="isstandalone"
        :deport-sending="true"
        :urls="{
            loadAnswers: `/get-answers-server/${currentServer.id}`,
            loadQuestionaire: `/get-server-questionnaire`,
            saveQuestionnaire: `/update-server-questionnaire`,
            sendAnswers: `/send-social-answers`,
        }"
        @deport-sending="onSendAnswers"
        @saved-questionnaire="onSavedAnswers"
        @questionnaire-store-created="onQuestionnaireStoreCreated"
    ></Questionnaire>
</template>

<script>
    import { mapState } from 'pinia'
    import { useServerStore } from '~socializer/stores/server.js'
    import Questionnaire from '~formdesigner/application/formCreator/Questionnaire.vue'
    import { useDynamicQuestionnaireStore } from '~formdesigner/application/formCreator/composables/useDynamicQuestionnaireStore.js'
   
    export default {
        name: 'QuestionnaireComponent',
        components: {
            Questionnaire,
        },
        props: {
            questionnaireid: {
                type: Number,
                required: false,
                default: null,
            },
            editable: {
                type: Boolean,
                required: true
            },
            isstandalone: {
                type: Boolean,
                required: false,
                default: true
            },
            room: {
                type: Object,
                required: false,
                default: null
            }
        },
        data() {
            return {
                QStoreDyn: null,
            }
        },
        computed: {
            ...mapState(useServerStore, {
                currentServer: 'getCurrentServer',
                currentContent: 'getCurrentContent',
            }),
            currentQuestionnaireId: function() {
                return this.questionnaireid || this.currentContent.questionnaire_id
            },
            channel: function() {
                if(this.room.id) {
                    return `questionnaire.${this.room.id}`
                }
                return null
            },
        },
        mounted() {
            this.initRoomEvents()
        },
        beforeUnmount() {
            if(this.channel) {
                Echo.leave(this.channel)
            }
        },
        methods: {
            onQuestionnaireStoreCreated(dynStoreId) {
                const dynamicStore = useDynamicQuestionnaireStore(dynStoreId);
                this.QStoreDyn = dynamicStore();
            },
            initRoomEvents() {
                if(this.channel) {
                    Echo.leave(this.channel)
                    Echo.private(this.channel)
                        .listen('.questionnaireAnswers.updated', (e) => {
                            this.QStoreDyn.setAnswersModel(e.model)
                        });
                }
            },
            async onSendAnswers(formData) {
                formData.set('room_id', this.room.id)
                const resp = await this.QStoreDyn.sendAnswersQuestionnaire(formData)
                this.$refs.serverQuestionnaire.afterValidation(resp)
            },
            onSavedAnswers(resp) {
                console.log(resp)
            }
        }
    }
</script>