<template>
    <button 
        class="btn btn-primary"
        @click="onCreateServer"
        ><IconWidget icon="plus"></IconWidget> Créer un domaine
    </button>
    <ModalWidget
        data-test="fmd-modal-plugin"
        v-if="showModal"
        class="d-flex justify-content-end"
        modalClasses="modal-lg"
        :modalTitle="modalTitle"
        target="server-create-modal"
        :trigger="showModal"
        :canValidate="canValidate"
        :showBtn="false"
        @hidden="onCancelEditModal"
        @saveModalChanges="onSaveUpdatedModal">
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

    <h1>Domaines</h1>
    <div class="d-flex">
        <div v-for="server in servers" class="card col-md-4 col-lg-3" :key="server.id">
            <img :src="server.image || 'https://picsum.photos/200'" class="card-img-top" alt="...">
            <div class="card-body">
                <h5 class="card-title">
                    <IconWidget v-if="server.is_private" class="text-warning" icon="key"></IconWidget> {{ server.name }}
                </h5>
                <h6 class="card-subtitle mb-2 text-body-secondary">
                    <span class="badge text-bg-info">Catégorie</span>
                </h6>
                <p class="card-text">{{ server.description }}</p>
                <button class="btn btn-primary" @click="onCheckAccess(server.id)">
                    visiter
                </button>
            </div>
        </div>
    </div>
</template>

<script>
    import { mapActions, mapState } from 'pinia'
    import { defineAsyncComponent } from '@vue/runtime-core'
    import { useServerStore } from '~socializer/stores/server.js'
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import FormsSettingHelper from '~socializer/services/FormsSetting.js'
    import { checkServerAccess } from '~socializer/services/helpers.js'

    export default {
        name: 'Servers',
        components: {
            IconWidget,
            ModalWidget: defineAsyncComponent(() => import('~estarter/components/widgets/ModalLazy.js')),
        },
        data() {
            return {
                showModal: false,
                canValidate: false,
                currentQuestionnaire: null,
                currentServer: null,
                modalTitle: '',
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
                'loadAllServers',
                'requestServerAccess',
            ]),
            onCreateServer() {
                this.showModal = true
                this.currentQuestionnaire = FormsSettingHelper.questionnaires.createServer
                this.modalTitle = 'Créer un domaine'
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

                // request private server
                if(this.currentQuestionnaire === FormsSettingHelper.questionnaires.accessPrivateServer) {
                    this.$refs.serverQuestionnaire.setUnsavedStatus(false)
                    formData.append('serverId', this.currentServer)
                    this.requestServerAccess(formData)
                    .then(() => {
                        this.showModal = false
                        console.log('Votre demande d\'accès a été envoyée au propriétaire du domaine')
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
            async onCheckAccess(serverId) {
                this.currentServer = serverId
                this.modalTitle = 'Demande d\'accès'
                const hasAccess = await checkServerAccess(serverId)
                if(hasAccess) {
                    this.$router.push({ name: 'server', params: { serverId }})
                } else {
                    this.showModal = true
                    this.currentQuestionnaire = FormsSettingHelper.questionnaires.accessPrivateServer
                }
            }
        }
    }
</script>