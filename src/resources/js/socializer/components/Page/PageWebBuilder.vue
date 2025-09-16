<template>
   
    <div class="generate-content" v-if="isBuilding">
        <div class="generate-content-inner">
            <Sprinner2 ></Sprinner2>
            Contenu en cours de création...
        </div>
    </div>
    <div v-else class="card-body m-3">
        <WebBuilder
            :html="html"
            :styles="styles"
            :script="script"
            :seeHtml="true"
            :seeCss="true"
            :seeJs="true"
            :assetsProps="{
                baseUrl: '/server-finder-files',
                params: {
                    server_id: currentServer.id,
                },
            }"
            @update-content="onUpdateContent"
        ></WebBuilder>
    </div>

    <Teleport to="#fmd-editor-navigation-tools">
        <button type="button" class="btn btn btn-outline-auto btn-sm" @click="showModal = true">
            <IconWidget icon="robot"></IconWidget> IA
        </button>
    </Teleport>

    <ModalWidget
        v-if="showModal"
        data-test="fmd-modal-server"
        class="d-flex justify-content-end"
        modalClasses="modal-lg"
        target="server-params-modal"
        :trigger="showModal"
        :canValidate="canValidate"
        :showBtn="false"
        @hidden="onCancelEditModal"
        @saveModalChanges="onSaveUpdatedModal">
            <template #header>
                <h2><IconWidget icon="robot"></IconWidget> Edition de la page avec IA</h2>
            </template>
            <template #body>
                <PromptWidget
                    :seeJson="false"
                    @prompt-data="onChangeJson"
                    @submit-prompt="onSubmitPrompt"
                ></PromptWidget>
            </template>
    </ModalWidget>

</template>

<script>
    import { mapState } from 'pinia'
    import { defineAsyncComponent } from '@vue/runtime-core'
    import { useServerStore } from '~socializer/stores/server.js'

    export default {
        name: 'PageWebBuilder',
        inject: [
            "eventBus",
        ],
        emits: [
            'update-content',
            'submit-prompt',
            'reload-current-page',
        ],
        props: {
            html: {
                type: String,
                required: false,
                default: '',
            },
            styles: {
                type: String,
                required: false,
                default: '',
            },
            script: {
                type: String,
                required: false,
                default: '',
            },
        },
        components: {
            WebBuilder: defineAsyncComponent(() => import('~eblogger/components/WebBuilder.vue')),
            PromptWidget: defineAsyncComponent(() => import('~formdesigner/application/formCreator/widgets/partials/Prompt.vue')),
            ModalWidget: defineAsyncComponent(() => import('~estarter/components/widgets/ModalLazy.js')),
            IconWidget: defineAsyncComponent(() => import('~estarter/components/widgets/IconWidgetLazy.js')),
            Sprinner2: defineAsyncComponent(() => import('~estarter/components/widgets/Spinners/Spinner2.vue')),
        },
        data() {
            return {
                showModal: false,
                canValidate: false,
                isBuilding: false,
            }
        },
        computed: {
            ...mapState(useServerStore, {
                currentServer: 'getCurrentServer',
            }),
        },
        mounted() {
            this.eventBus.$on('content-generated-ia', this.onReloadPage)
        },
        unmounted() {
            this.eventBus.$off('content-generated-ia', this.onReloadPage)
        },
        methods: {
            onUpdateContent(html, css, js) {
                this.$emit('update-content', html, css, js)
            },
            onCancelEditModal() {
                this.showModal = false
            },
            onSaveUpdatedModal() {
                this.showModal = false
                this.canValidate = false
            },
            onSubmitPrompt(prompt) {
                this.isBuilding = true
                this.onSaveUpdatedModal()
                this.$emit('submit-prompt', prompt)
            },
            onReloadPage() {
                this.isBuilding = false
                this.$emit('reload-current-page')
            },
        }
    }
</script>

<style lang="scss" scoped>
    .generate-content {
        position: fixed;
        z-index: 200;
        height: 200%;
        width: 100%;
        background-color: #000;

        .generate-content-inner {
            position: absolute;
            top: 10%;
            left: 35%;
        }
    }
</style>