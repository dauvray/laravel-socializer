<template>
    <div class="fmd-editor-navigation">
        <div class="form-check form-switch">
            <input class="form-check-input" type="checkbox" role="switch" id="editPageButton" v-model="showModal">
            <label class="form-check-label" for="editPageButton">Edition</label>
        </div>
    </div>

    <ModalWidget
        v-if="showModal"
        data-test="fmd-modal-server"
        class="d-flex justify-content-end"
        modalClasses="modal-fullscreen"
        target="server-params-modal"
        :trigger="showModal"
        :canValidate="canValidate"
        :showBtn="false"
        @hidden="onCancelEditModal"
        @saveModalChanges="onSaveUpdatedModal">
            <template #header>
                <h2><IconWidget icon="tools"></IconWidget> Edition de l'application</h2>
            </template>
            <template #body>
                <ul class="nav nav-tabs" role="tablist">
                    <li class="nav-item" role="presentation">
                        <button class="nav-link active" 
                            id="configuration-tab" 
                            aria-current="page" 
                            data-bs-toggle="tab"
                            data-bs-target="#configuration-tab-pane"
                            role="tab" 
                            aria-controls="configuration-tab-pane" 
                            aria-selected="true"
                        >Infos</button>
                    </li>
                    <li class="nav-item" role="presentation">
                        <button class="nav-link" 
                            id="code-tab" 
                            aria-current="page" 
                            data-bs-toggle="tab" 
                            data-bs-target="#code-tab-pane"
                            role="tab" 
                            aria-controls="code" 
                            aria-selected="false"
                        >IA</button>
                    </li>
                    <li class="nav-item" role="presentation">
                        <button class="nav-link" 
                            id="script-tab" 
                            aria-current="page" 
                            data-bs-toggle="tab" 
                            data-bs-target="#script-tab-pane"
                            role="tab" 
                            aria-controls="script" 
                            aria-selected="false"
                        >Code</button>
                    </li>
                    <li v-if="canPublish" class="nav-item" role="presentation">
                        <button class="nav-link" 
                            id="marketplace-tab" 
                            aria-current="page" 
                            data-bs-toggle="tab"
                            data-bs-target="#marketplace-tab-pane"
                            role="tab" 
                            aria-controls="marketplace" 
                            aria-selected="false"
                        >Store</button>
                    </li>
                </ul>

                <div class="tab-content" id="formTabContent">
                    <div class="tab-pane fade show active ps-3 pe-3" 
                        id="configuration-tab-pane" 
                        role="tabpanel" 
                        aria-labelledby="configuration-tab" 
                        tabindex="0">
                        <Questionnaire
                            ref="appDetailsQuestionnaire"
                            :questionnaireid="appAiDetailsFormId"
                            :answerid="answerid"
                            :iseditable="false"
                            :isstandalone="true"
                            :deportSending="true"
                            :deportvalidation="true"
                            :modelPlaceholder="modelPlaceholder"
                            @deport-sending="onSendAppDetails"
                            @questionnaire-isvalid="onCheckQuestionnaireIsValid"
                        ></Questionnaire>
                    </div>

                    <div class="tab-pane fade show  ps-3 pe-3" 
                        id="code-tab-pane" 
                        role="tabpanel" 
                        aria-labelledby="code-tab" 
                        tabindex="0">
                        <PromptWidget
                            :data="componentData"
                            @prompt-data="onChangeJson"
                            @submit-prompt="onSendAppDetails"
                        ></PromptWidget>
                    </div>

                    <div class="tab-pane fade show  ps-3 pe-3" 
                        id="script-tab-pane" 
                        role="tabpanel" 
                        aria-labelledby="script-tab" 
                        tabindex="0">
                        <ul class="nav nav-underline justify-content-end" role="tablist">
                            <li class="nav-item">
                                <a class="nav-link active" 
                                    id="html-tab" 
                                    data-bs-toggle="tab" 
                                    href="#html"
                                    role="tab" 
                                    aria-controls="html" 
                                    aria-selected="true">Template</a>
                            </li>
                            <li class="nav-item">
                                <a class="nav-link" 
                                    id="javascript-tab" 
                                    data-bs-toggle="tab" 
                                    href="#javascript"
                                    role="tab" 
                                    aria-controls="javascript" 
                                    aria-selected="false">Script</a>
                            </li>
                            <li class="nav-item">
                                <a class="nav-link"
                                    id="css-tab" 
                                    data-bs-toggle="tab" 
                                    href="#css"
                                    role="tab" 
                                    aria-controls="css" 
                                    aria-selected="false"
                                >Style</a>
                            </li>
                            <li class="nav-item">
                                <a class="nav-link"
                                    id="translations-tab" 
                                    data-bs-toggle="tab" 
                                    href="#translations"
                                    role="tab" 
                                    aria-controls="translations" 
                                    aria-selected="false"
                                >Traductions</a>
                            </li>
                        </ul>

                        <div class="tab-content">
                            <div class="tab-pane fade show active ps-3 pe-3" 
                                id="html" 
                                role="tabpanel" 
                                aria-labelledby="html-tab">
                                <CodeEditor
                                    lang="html"
                                    :code="componentData.template || ''"
                                    @input="onUpdateHtml"
                                ></CodeEditor>
                            </div>

                            <div class="tab-pane fade ps-3 pe-3" 
                                id="javascript" 
                                role="tabpanel" 
                                aria-labelledby="javascript-tab">
                                <CodeEditor
                                    lang="javascript"
                                    :code="componentData.script || ''"
                                    @input="onUpdateJavascript"
                                ></CodeEditor>
                            </div>

                            <div class="tab-pane fade ps-3 pe-3" 
                                id="css" 
                                role="tabpanel" 
                                aria-labelledby="css-tab">
                                <CodeEditor
                                    lang="css"
                                    :code="componentData.style || ''"
                                    @input="onUpdateCSS"
                                ></CodeEditor>
                            </div>

                            <div class="tab-pane fade ps-3 pe-3" 
                                id="translations" 
                                role="tabpanel" 
                                aria-labelledby="translations-tab">
                                <CodeEditor
                                    lang="javascript"
                                    :code="JSON.stringify(componentData.translations) || ''"
                                    @input="onUpdateTransaltions"
                                ></CodeEditor>
                            </div>
                        </div>

                    </div>

                    <div v-if="canPublish"
                        class="tab-pane fade show  ps-3 pe-3" 
                        id="marketplace-tab-pane" 
                        role="tabpanel" 
                        aria-labelledby="marketplace-tab" 
                        tabindex="0">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox"
                                    role="switch" id="published" v-model="published">
                            <label
                                class="form-check-label"
                                for="published"
                                >Publier sur le store</label>
                        </div>
                    </div>
                </div>

            </template>
    </ModalWidget>
</template>

<script>
    import ModalWidget from '~estarter/components/widgets/Modal.vue'
    import PromptWidget from '~formdesigner/application/formCreator/widgets/partials/Prompt.vue'
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import Questionnaire from '~formdesigner/application/formCreator/Questionnaire.vue'
    import FormSettings from '~socializer/services/FormsSetting.js'
    import CodeEditor from '~formdesigner/application/formCreator/widgets/codeEditor/CodeEditor.vue'

    export default {
        name: 'ApplicationModale',
        components: {
            ModalWidget,
            PromptWidget,
            IconWidget,
            Questionnaire,
            CodeEditor,
        },
        emits: [
            'save-changes'
        ],
        props: {
            componentData: {
                type: String,
                required: true,
                default: null
            },
            componentInfos: {
                type: Object,
                required: true,
            },
            modelPlaceholder: {
                type: Object,
                default: () => {}
            }
        },
        data() {
            return {
                appAiDetailsFormId: FormSettings.questionnaires.appAiDetails,
                showModal: false,
                codeApp: this.componentData,
                infosApp: this.componentInfos,
                isFormInfosValid: false,
                isDirty: false,
            }
        },
        computed: {
            canValidate: function() {
                return this.isFormInfosValid && this.codeApp && this.isDirty
            },
            canPublish: function() {
                if(!this.componentData || !this.componentInfos || !this.modelPlaceholder) {
                    return false
                } else {
                    return true
                }
            },
            published: {
                get() {
                    return this.infosApp.hasOwnProperty('published') ? this.infosApp['published'] : false
                },
                set(value) {
                    this.infosApp['published'] =  value
                }
            },
        },
        methods: {
            onCancelEditModal() {
                this.showModal = false
            },
            onSaveUpdatedModal() {
                this.showModal = false
                this.$emit('save-changes', {infos: this.infosApp, code: this.codeApp})
            },
            onChangeJson(jsonText) {
                this.codeApp = jsonText
                this.isDirty = true
            },
            onSendAppDetails(formData) {
                this.infosApp = JSON.parse(formData.get('model'))
            },
            onCheckQuestionnaireIsValid(isValid) {
                this.isDirty = true
                this.isFormInfosValid = isValid
                this.$refs.appDetailsQuestionnaire.onValidQuestionnaire()
            },
            onUpdateHtml(html) {
                 this.codeApp.template = html
                 this.isDirty = true
            },
            onUpdateJavascript(js) {
                 this.codeApp.script = js
                 this.isDirty = true
            },
            onUpdateCSS(css) {
                 this.codeApp.style = css
                 this.isDirty = true
            },
            onUpdateTransaltions(translations) {
                 this.codeApp.translations = JSON.parse(translations)
                 this.isDirty = true
            }
        }
    }
</script>