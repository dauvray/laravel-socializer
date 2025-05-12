<template>
    <section class="results-questionnaire">
        <button
            v-if="showAlertBtn"
            class="btn btn-primary btn-sm"
            @click="onCreateFilterAlert">
            <IconWidget icon="bell"></IconWidget> Créer une alerte
        </button>
 
        <KeepAlive>
            <OffCanvas
                v-if="!showItem"
                class="flex-grow-1 d-flex justify-content-end"
                direction="offcanvas-end"
                btnclass="btn btn-primary btn-sm"
                :showBtn="haveFilter">
                <template #button>
                    <IconWidget icon="search"></IconWidget> Rechercher
                </template>
                <template #custom-buttons>
                    <button 
                        v-if="showAlertBtn"
                        type="button" 
                        class="btn btn-danger btn-sm"
                        @click="onResetFilters">Reset</button>
                </template>
                <template #header>
                    Recherche filtrée
                </template>
                <template #body>
                    <QuestionnaireFilters
                        :validation="false"
                        :getFiltersUrl="getFiltersUrl"
                        :triggerReset="resetFilters"
                        @have-filter="onCheckHasFilter"
                        @update-filters="onUpdateFilters"
                    ></QuestionnaireFilters>
                </template>
            </OffCanvas>
        </KeepAlive>
        <KeepAlive>
            <component
                v-if="config && !showItem"
                :key=compKey
                :is="typeResult"
                @select-item="onSelectItem"
            ></component>
        </KeepAlive>
        <template v-if="showItem">
            <div class="d-grid gap-2 d-md-block">
                <button 
                    type="button" 
                    class="btn btn-primary btn-sm" 
                    @click="onResetItem">
                    <IconWidget icon="angle-double-left"></IconWidget> Retour
                </button>
            </div>

            <div class="card">
                <router-view class="card-body" ></router-view>
            </div>
        </template>

   </section>
</template>

<script>
   import { hashJsonObject, isEmpty } from '~estarter/services/helpers.js'
   import { mapActions, mapState } from 'pinia'
   import { useSearchStore } from '~formdesigner/stores/search.js'
   import { defineAsyncComponent, ref } from 'vue'
   import { useResults } from '~formdesigner/application/formCreator/composables/useResults.js'
   import { useSocialUserStore } from '~socializer/stores/socialUser.js'
   import { useServerStore } from '~socializer/stores/server.js'
   
   export default {
       name: 'DataComponent',
       inject: [
           "AWN",
       ],
       components: {
           QuestionnaireListResults: defineAsyncComponent(() => import('~formdesigner/application/formCreator/widgets/results/QuestionnaireListResults.vue')),
           QuestionnaireTableResults: defineAsyncComponent(() => import('~formdesigner/application/formCreator/widgets/results/QuestionnaireTableResults.vue')),
           QuestionnaireFilters: defineAsyncComponent(() => import('~formdesigner/application/formCreator/widgets/filters/QuestionnaireFilters.vue')),
           OffCanvas: defineAsyncComponent(() => import('~estarter/components/widgets/Offcanvas.vue')),
           IconWidget: defineAsyncComponent(() => import('~estarter/components/widgets/IconWidget.vue')),
       },
       props: {
           searchResultLink: {
               type: String,
               required: false,
               default: '/send-server-questionnaire-filters'
           },
           getFiltersUrl: {
               type: String,
               required: false,
               default: '/get-server-questionnaire-filters'
           },
           editable: {
                type: Boolean,
                required: false,
                default: false
           }
       },
       setup(props, context) {
           const {
               selectItem,
               loadItems,
               filters,
               loading,
               selectedItem,
           } = useResults(props, context)

           const showItem = ref(false)

           return {
               selectItem,
               loadItems,
               filters,
               showItem,
               loading,
               selectedItem,
           }
       },
       data() {
           return {
               haveFilter: false,
               compKey: 0,
               showAlertBtn: false,
               resetFilters: false,
           }
       },
       computed: {
           ...mapState(useSearchStore, {
               config: 'getSearchQuestionnaireConfig',
               selectedFilters: 'getSearchFiltersValues',
           }),
           ...mapState(useServerStore, {
                currentContent: 'getCurrentContent',
           }),
           typeResult: function() {
               if(this.config && this.config.hasOwnProperty('filterResultFormat')) {
                   switch(this.config.filterResultFormat) {
                       case 'table':
                           return 'QuestionnaireTableResults'
                           break
                       default:
                           return 'QuestionnaireListResults'
                           break
                   }
               }
           },
           questionnaireid: function() {
                return this.currentContent.questionnaire_id
           },
       },
       watch: {
           filters: {
               handler() {
                   this.loadItems()
               },
               deep: true,
           },
           loading(newVal, oldVal) {
               if(!newVal && oldVal) {
                   this.compKey++
               }
           },
           selectedFilters: {
               handler(value) {
                   this.showAlertBtn = !isEmpty(value)
               },
               deep: true
           }
       },
       created() {
            this.setSelectedQuestionnaire(this.questionnaireid)
            if(this.$route.params.answerId) {
                this.onGotoItem(this.$route.params.answerId)
            }
       },
       methods: {
           ...mapActions(useSearchStore, [
               'setSelectedQuestionnaire',
           ]),
           ...mapActions(useSocialUserStore, [
               'sendSearchAlert',
           ]),
           onCheckHasFilter(haveFilter) {
               this.haveFilter = haveFilter
           },
           onResetItem() {
                this.showItem = false
            },
           onSelectItem(answer) {
                this.selectItem(answer)
                this.onGotoItem(answer.id)
           },
           onGotoItem(answerId) 
           {   
                setTimeout(() => {
                    this.showItem = true
                    this.$router.push({ name: 'viewer', params: { answerId: answerId} })
                },300)  
           },
           async onCreateFilterAlert() {
               let onOk = () => {
                   hashJsonObject(this.selectedFilters).then( hash => {
                       this.sendSearchAlert(this.questionnaireid, this.selectedFilters, hash)
                   })
               }

               let onCancel = () => {}

               this.AWN.confirm(
                   `Créer une alerte envoyée sur votre fil d\'actualité en rapport avec cette recherche ?
                   Lorsque qu\'un nouvel enregistrement correspondant à cette recherche sera enregistré, vous serez prévenu immédiatement.
                   `,
                   onOk,
                   onCancel,
                   {
                       labels :  {
                           confirm: 'Créer une alerte',
                           confirmOk: "Valider",
                           confirmCancel: "Annuler",
                       }
                   }
               )
           },
           onResetFilters() {
               this.resetFilters = true
           },
           onUpdateFilters() {
               this.resetFilters = false
           },
       }
   }
</script>
