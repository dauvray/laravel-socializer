<template>
    <div v-if="field">
        <ServerQuestionnaireList
            ref="fieldComponent"
            :field="localField"
            :model="model"
            :formOptions="formOptions"
            :editable="editable"
            @model-updated="onUpdatedModel"
            @validated="onFieldValidated"
        ></ServerQuestionnaireList>
        <PluginsModal
            v-if="editable"
            :edited="edited"
            :localField="localField"
            :isNewElement="isNewElement"
            :forceRequired="forceRequired"
            :dirty="dirty"
            :allowedValidators="allowedValidators"
            @field-plugin-proxy="onFieldPluginEvent"
        ></PluginsModal>
    </div>
</template>

<script>

    import { FieldMixin } from '~formdesigner/application/formCreator/mixins/FieldMixin.js'
    import ServerQuestionnaireList from '../customFields/ServerQuestionnaireList.vue'
    import { defineAsyncComponent } from '@vue/runtime-core'

    export default {
        name: "ServerQuestionnaireListCreator",
        mixins: [
            FieldMixin
        ],
        components: {
            ServerQuestionnaireList,
            PluginsModal: defineAsyncComponent(() => import('~formdesigner/application/formCreator/widgets/modals/FieldPluginsModal.vue')),
        },
        data() {
            return {
                element: {
                    type: "ServerQuestionnaireList",
                    allowedValidators: []
                }
            }
        },
    }
</script>
