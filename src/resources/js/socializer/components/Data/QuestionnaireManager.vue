<template>
    <Teleport to="#room-header-inner">
        <h2>Gestion des questionnaires</h2>
    </Teleport>
<div class="m-3">
    <div class="d-grid gap-2 d-md-block">
        <button 
            v-if="!startQuestionnaireCreation"
            type="button" 
            class="btn btn-primary"
            @click="onCreateQuestionnaire">Créer un questionnaire
        </button>
    </div>
    <TableWidget
        :buttons="buttons"
        :columns="columns"
        :dataValues="dataValues"
        :showCaption="false"
        :sortable="true"
        :payload="{
            server_id: currentServer.id
        }"
        @btn-action="onTableBtnAction"
    ></TableWidget>
</div>
    <ModalWidget
        v-if="showModal"
        modalClasses="modal-fullscreen"
        :trigger="showModal"
        :canValidate="validModal"
        :show-btn="false"
        :closebutton="false"
        @hidden="onResetModal"
        @shown="checkQuestionnaireInfo"
        @saveModalChanges="onSaveQuestionnaireSettings">
        <template #header>
            <div class="d-flex justify-content-between">
                <h1>Questionnaire</h1>
                <button type="button" class="btn btn btn-outline-auto" @click="onShowModalIA">
                    <IconWidget icon="robot"></IconWidget> IA
                </button>
            </div>
        </template>
        <template #body>
            <div class="row">
                <form class="col-md-2" >
                    <div class="mb-3">
                        <label for="nameInput" class="form-label">Titre</label>
                        <input type="text" class="form-control" v-model="questionnaireTitle" id="nameInput">
                        <div class="invalid-feedback">
                            Le questionnaire doit avoir un titre valide.
                        </div>
                    </div>
                </form>
                <div class="col-md-10">
                    <questionnaire-component
                        ref="adminpanelQuestionnaire"
                        :loadable="false"
                        :isstandalone="true"
                        :iseditable="true"
                        :isbackend="true"
                        :isai="aiEnhancement"
                        :urls="{
                            aiCreateQuestionnaire: '/create-ia-questionnaire'
                        }"
                        :display-builder="true"
                        :deport-saving="true"
                        :questionnaireid="selectedQuestionnaire"
                        @deport-saving="onUpdateQuestionnaireSettings"
                        @questionnaire-store-created="onQuestionnaireStoreCreated"
                    ></questionnaire-component>
                </div>
            </div>
        </template>
    </ModalWidget>

    <ModalWidget v-if="showModalIA"
        modalClasses="modal-fullscreen"
        :trigger="showModalIA"
        @hidden="onResetModalIA">
        <template #body>
            <PromptWidget
                class="mt-3 mb-3"
                placeholderPrompt="je veux un formulaire pour ..."
                :isLoading="isLoading"
                @prompt-data="onReceivedData"
                @submit-prompt="onSubmitPrompt"
                @receive-prompt-response="onReceivePromptResponse"
            ></PromptWidget>
        </template>
    </ModalWidget>
</template>

<script>
    import TableWidget from '~estarter/components/widgets/Table.vue'
    import { mapActions, mapState } from 'pinia'
    import { useServerStore } from '~socializer/stores/server.js'
    import { useApplicationStore } from '~estarter/stores/application.js'
    import { defineAsyncComponent } from 'vue'
    import { useAjaxService } from '~estarter/services/AjaxService.js'
    const AjaxService = useAjaxService()
     import { useDynamicQuestionnaireStore } from '~formdesigner/application/formCreator/composables/useDynamicQuestionnaireStore.js'

    export default {
        name: 'QuestionnaireManager',
        inject: [
            "AWN",
        ],
        components: {
            TableWidget,
            ModalWidget: defineAsyncComponent(() => import('~estarter/components/widgets/ModalLazy.js')),
            IconWidget: defineAsyncComponent(() => import('~estarter/components/widgets/IconWidgetLazy.js')),
            PromptWidget: defineAsyncComponent(() => import('~formdesigner/application/formCreator/widgets/partials/Prompt.vue')),
        },
        data() {
            return {
                QStoreDyn: null,
                showModal: false,
                showModalIA: false,
                validModal: false,
                per_page: 50,
                buttons: [
                    {
                        class: 'btn btn-primary btn-sm',
                        icon: 'edit',
                        event: 'edit-questionnaire',
                        label: 'Editer'
                    },
                    {
                        class: 'btn btn-outline-primary btn-sm',
                        icon: 'trash',
                        event: 'delete-questionnaire',
                        label: 'Supprimer'
                    }
                ],
                columns:  [
                    {
                        title: 'Questionnaire',
                        id: 'model.name'
                    },
                    // {
                    //     title: 'Statut',
                    //     id: 'model.STATUS',
                    // }
                ],
                dataValues: [],
                questionnaireSettings: null,
                questionnaireTitle: null,
                selectedQuestionnaire: null,
            }
        },
        computed: {
            ...mapState(useServerStore, {
                currentServer: 'getCurrentServer',
            }),
            ...mapState(useApplicationStore, {
                aiEnhancement: 'getIsAi',
            }),
        },
        created() {
            this.onLoadQuestionnaires()
        },
        watch: {
            questionnaireTitle: {
                handler() {
                    this.checkQuestionnaireInfo()
                },
            }
        },
        methods: {
            ...mapActions(useServerStore, [
                'saveServerQuestionnaire',
                'loadServerQuestionnaires',
                'deleteServerQuestionnaire'
            ]),
            onQuestionnaireStoreCreated(dynStoreId) {
                const dynamicStore = useDynamicQuestionnaireStore(dynStoreId)
                this.QStoreDyn = dynamicStore()
            },
            async onLoadQuestionnaires() {
                let result = await this.loadServerQuestionnaires(this.per_page)

                // format result
                result.data = result.data.map(item => {
                    return {
                        id: item.id,
                        model: {
                            name: item.name
                        }
                    }
                })

                this.dataValues = result
            },
            onCreateQuestionnaire() {
                this.showModal = true
                this.selectedQuestionnaire = null
            },
            onResetModal() {
                this.showModal = false
                this.questionnaireTitle = null
            },
            onUpdateQuestionnaireSettings(settings, isDirty = false) {
                this.questionnaireSettings = settings
                if(this.questionnaireTitle) {
                    this.validModal = isDirty
                }
            },
            async onSaveQuestionnaireSettings() {
                const result = await this.saveServerQuestionnaire({
                    settings: this.questionnaireSettings,
                    title: this.questionnaireTitle,
                })
                // is new ?
                if(!this.selectedQuestionnaire) {
                    this.dataValues.data.push(result.questionnaire)
                } 
            },
            onTableBtnAction(event, item) {
                switch(event) {
                    case 'edit-questionnaire':
                        this.editQuestionnaire(item)
                        break
                    case 'delete-questionnaire':
                        this.deleteQuestionnaire(item)
                        break
                }
            },
            editQuestionnaire(item) {
                this.selectedQuestionnaire = item.id
                this.questionnaireTitle = item.model.name
                this.showModal = true
            },
            deleteQuestionnaire(item) {
                let onOk = async () => {
                    await this.deleteServerQuestionnaire(item.id)
                    this.dataValues.data = this.dataValues.data.filter(el => {
                        return item.id != el.id
                    })
                }
                let onCancel = () => {}
                this.AWN.confirm(
                    'Etes-vous certain ?',
                    onOk,
                    onCancel,
                    {
                        labels: {
                            confirm: 'Supprimer',
                            confirmOk: "Valider",
                            confirmCancel: "Annuler",
                        }
                    }
                )
            },
            checkQuestionnaireInfo() {
                const el = document.getElementById('nameInput')
                if(el) {
                    if (this.questionnaireTitle) {
                        document.getElementById('nameInput').classList.add('is-valid')
                        document.getElementById('nameInput').classList.remove('is-invalid')
                        if(this.questionnaireSettings) {
                            this.validModal = true
                        }
                    } else {
                        document.getElementById('nameInput').classList.add('is-invalid')
                        document.getElementById('nameInput').classList.remove('is-valid')
                        this.validModal = false
                    }
                }
            },
            onShowModalIA() {
                this.showModalIA = true
            },
            onResetModalIA() {
                this.showModalIA = false
            },
            async onSubmitPrompt(payload) {
                this.isLoading = true
                const data = await this.QStoreDyn.createQuestionnaireIA(payload)
            },
            onReceivePromptResponse(payload) {
                const form = this.QStoreDyn.returnNewQuestionnaireIA(payload)
                this.onResetModalIA()
            },
        }
    }
</script>