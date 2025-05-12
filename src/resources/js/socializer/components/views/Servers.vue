<template>

    <button 
        class="btn btn-primary btn-sm"
        @click="onCreateServer"
        ><IconWidget icon="plus"></IconWidget> Nouveau domaine
    </button>
    <ModalWidget
        data-test="fmd-modal-plugin"
        v-if="showModal"
        class="d-flex justify-content-end"
        modalClasses="modal-lg"
        target="server-create-modal"
        :trigger="showModal"
        :canValidate="canValidate"
        :showBtn="false"
        @hidden="onCancelEditModal"
        @saveModalChanges="onSaveUpdatedModal">
            <template #header>
                header
            </template>
            <template #body>
                <questionnaire-component
                    ref="serverQuestionnaire"
                    v-if="currentQuestionnaire"
                    :questionnaireid="currentQuestionnaire"
                    :isstandalone="true"
                    :deportvalidation="true"
                    :deport-sending=true
                    @deport-sending="onQuestionnaireData"
                    @deported-validation="onQuestionnaireValidation"
                ></questionnaire-component>
            </template>
    </ModalWidget>

    <h3>Domaines</h3>
    <ul v-if="servers" 
        class="list-group list-group-flush">
        <li v-for="server in servers"
            class="list-group-item"
            :key="server.id">
            <router-link :to="{ name: 'server', params: { serverId: server.id }}">
                <IconWidget icon="server"></IconWidget> {{ server.name }}
            </router-link>
        </li>
    </ul>

</template>

<script>
    import { mapActions, mapState } from 'pinia'
    import { defineAsyncComponent } from '@vue/runtime-core'
    import { useServerStore } from '~socializer/stores/server.js'
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import FormsSettingHelper from '~socializer/services/FormsSetting.js'

    export default {
        name: 'Servers',
        components: {
            IconWidget,
            ModalWidget: defineAsyncComponent(() => import('~estarter/components/widgets/Modal.vue')),
        },
        data() {
            return {
                showModal: false,
                canValidate: false,
                currentQuestionnaire: null,
            }
        },
        computed: {
            ...mapState(useServerStore, {
                servers: 'getServers',
            })
        },
        created() {
            this.loadAllServers()
        },
        methods: {
            ...mapActions(useServerStore, [
                'createServer',
                'loadAllServers'
            ]),
            onCreateServer() {
                this.showModal = true
                this.currentQuestionnaire = FormsSettingHelper.questionnaires.createServer
            },
            onQuestionnaireData(formData){
                // create  serve
                if(this.currentQuestionnaire === FormsSettingHelper.questionnaires.createServer) {
                    this.$refs.serverQuestionnaire.setUnsavedStatus(false)
                    this.createServer(formData.get('model'))
                    .then(server => {
                        this.showModal = false
                        this.$router.push({ name: 'server', params: { serverId: server.id }})
                    })
                }  
            },
            onQuestionnaireValidation(isValid) {
                if(isValid) {
                    this.canValidate = true
                } else {
                    this.canValidate = false
                }
            },
            onCancelEditModal() {
                this.$refs.serverQuestionnaire.setUnsavedStatus(false)
                this.showModal = false
                this.currentQuestionnaire = null
            },
            onSaveUpdatedModal() {
                this.$refs.serverQuestionnaire.onValidQuestionnaire()
            },
        }
    }
</script>