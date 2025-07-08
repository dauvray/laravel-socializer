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
        @hidden="onResetModal"
        @shown="checkQuestionnaireInfo"
        @saveModalChanges="onSaveQuestionnaireSettings">
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
                        :display-builder="true"
                        :deport-saving="true"
                        :questionnaireid="selectedQuestionnaire"
                        @deport-saving="onUpdateQuestionnaireSettings"
                    ></questionnaire-component>
                </div>
            </div>
        </template>
    </ModalWidget>
</template>

<script>
    import TableWidget from '~estarter/components/widgets/Table.vue'
    import { mapActions, mapState } from 'pinia'
    import { useServerStore } from '~socializer/stores/server.js'
    import { defineAsyncComponent } from 'vue'
    import { useAjaxService } from '~estarter/services/AjaxService.js'
    const AjaxService = useAjaxService()

    export default {
        name: 'QuestionnaireManager',
        inject: [
            "AWN",
        ],
        components: {
            TableWidget,
            ModalWidget: defineAsyncComponent(() => import('~estarter/components/widgets/ModalLazy.js')),
        },
        data() {
            return {
                showModal: false,
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
                console.log(settings, isDirty)
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
            }
        }
    }
</script>