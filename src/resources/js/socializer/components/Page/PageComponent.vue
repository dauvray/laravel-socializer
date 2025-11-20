<template>
    <div v-if="editable" class="fmd-editor-navigation">
        <div class="fmd-editor-navigation-main">
            <div class="form-check form-switch">
                <input class="form-check-input" type="checkbox" role="switch" id="editPageButton" v-model="editing">
                <label class="form-check-label" for="editPageButton">Edition</label>
            </div>
        </div>
        <div id="fmd-editor-navigation-tools"></div>
        <button v-if="isDirty" 
            type="button" 
            class="btn btn-primary btn-sm"
            @click="onSaveContent"
            >Enregistrer
        </button>
    </div>

    <component
        class="flex-grow-1"
        :key="pageKey"
        :is="currentComponent"
        :html="html"
        :styles="pageCss"
        :script="pageJs"
        @update-content="onUpdateContent"
        @submit-prompt="onSubmitPrompt"
        @reload-current-page="loadPage"
    ></component>

    <input type="hidden" name="identifier" :value="identifier" id="identifier"/>
</template>

<script>

    import { mapActions } from 'pinia'
    import { useServerStore } from '~socializer/stores/server.js'
    import { defineAsyncComponent } from '@vue/runtime-core'
    import { useAjaxService } from '~estarter/services/AjaxService.js'
    const AjaxService = useAjaxService()

    export default {
        name: 'PageComponent',
        components: {
            PageWebBuilder: defineAsyncComponent(() => import('./PageWebBuilder.vue')),
            PageWidget: defineAsyncComponent(() => import('./SandboxedPageSecure.vue')),
       },
        props: {
            pageid: {
                type: String,
                required: false,
                default: null,
            },
            editable: {
                type: Boolean,
                required: true,
            },
        },
        data() {
            return {
                currentComponent: null,
                editing: false,
                html: '',
                identifier: null,
                webBuilderHtml: '',
                pageHtml: '',
                pageCss: '',
                pageJs: '',
                isDirty: false,
                pageKey: 0,
            }
        },
        computed: {
            currentPageId: function() {
                return this.pageid || this.$route.params.vertexId
            }
        },
        created() {
            this.loadPage()
        },
        watch: {
            editing(newValue) {
                if(newValue) {
                    this.displayWebBuilder()
                } else {
                    this.displayPage()
                }
            },
            currentPageId(value) {
                if(value) {
                    this.loadPage()
                }
            }
        },
        methods: {
            ...mapActions(useServerStore, [
                'submitPagePrompt',
            ]),
            async loadPage() {
                const response = await AjaxService.load(`/get-room-page/${this.currentPageId}`)
                this.pageHtml = response.page // html with rendered components
                this.pageCss = response.styles
                this.pageJs = response.script
                this.webBuilderHtml = response.webbuilder // only html
                this.identifier = response.identifier
                this.displayPage()
            },
            displayPage() {
                this.isDirty = false
                this.editing = false
                this.html = this.pageHtml
                this.currentComponent = 'PageWidget'
                this.pageKey++
            },
            displayWebBuilder() {
                this.html = this.webBuilderHtml
                this.currentComponent = 'PageWebBuilder'
                this.pageKey++
            },
            onUpdateContent(html, css, js) {
                this.isDirty = true
                this.webBuilderHtml = html
                this.pageCss = css
                this.pageJs = js
                this.displayWebBuilder()
            },
            async onSaveContent() {
                const response =  await AjaxService.load(`/update-room-page`, 'post', { 
                    content: this.webBuilderHtml,
                    styles: this.pageCss,
                    script: this.pageJs,
                    pageid: this.currentPageId
                })
                this.pageHtml = response.page
                this.displayPage()
            },
            onSubmitPrompt(payload) {
                this.submitPagePrompt({...payload, pageId: this.currentPageId})
            }
        }
    }
</script>