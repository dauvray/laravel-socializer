<template>
    <EditorWidget
        v-if="editable && !editionMode"
        @edition-mode="onEditionMode"
    ></EditorWidget>

    <AdminPanel
        v-if="!editionMode"
        :questionnaireid="currentQuestionnaireId"
        getQuestionnaireUrl="/get-server-questionnaire"
        getFiltersUrl="/get-server-questionnaire-filters"
        :forceLoadAnswers="true"
        :routes="{
            list: adminListRoute,
            delete: '/delete-server-answer-questionnaire',
            edit: `/get-answers-server/${currentServer.id}`,
            store: '/send-social-answers',
            view: '/renderer-server-questionnaire',
        }"
    ></AdminPanel>

    <Questionnaire
        v-if="editionMode"
        :questionnaireid="currentQuestionnaireId"
        :iseditable="true"
        :isstandalone="true"
        :displayBuilder="true"
        :loadable="true"
        :urls="{
            loadAnswers: `/get-answers-server/${currentServer.id}`
        }"
        @editing-questionnaire="onEditionMode"
    ></Questionnaire>

</template>

<script>
    import { defineAsyncComponent } from 'vue'
    import { useServerStore } from '~socializer/stores/server.js'
    import { mapState } from 'pinia'

    export default {
        name: 'AdminComponent',
        components: {
            AdminPanel: defineAsyncComponent(() => import('~formdesigner/application/formCreator/widgets/adminpanel/AdminPanel.vue')),
            EditorWidget: defineAsyncComponent(() => import('./widgets/EditionMode.vue')),
            Questionnaire: defineAsyncComponent(() => import('~formdesigner/application/formCreator/QuestionnaireLazy.js')),
        },
        props: {
            questionnaireid: {
                type: Number,
                required: true
            },
            editable: {
                type: String,
                required: true
            },
        },
        data() {
            return {
                editionMode: false,
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
            adminListRoute: function() {
                return this.currentContent.author_only == 1 ? '/get-server-author-answers-list' : '/get-server-panel-answers-list'
            }
        },
        methods: {
            onEditionMode(value) {
             this.editionMode = value
           }
        }
    }
</script>