<template>
    <div v-if="field">
        <AvailableRoomTypeList
            ref="fieldComponent"
            :field="localField"
            :model="model"
            :formOptions="formOptions"
            :editable="editable"
            @model-updated="onUpdatedModel"
            @validated="onFieldValidated"
        ></AvailableRoomTypeList>
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
    import AvailableRoomTypeList from '../customFields/AvailableRoomTypeList.vue'
    import { defineAsyncComponent } from '@vue/runtime-core'

    export default {
        name: "AvailableRoomTypeListCreator",
        mixins: [
            FieldMixin
        ],
        components: {
            AvailableRoomTypeList,
            PluginsModal: defineAsyncComponent(() => import('~formdesigner/application/formCreator/widgets/modals/FieldPluginsModal.vue')),
        },
        data() {
            return {
                element: {
                    type: "AvailableRoomTypeList",
                    allowedValidators: []
                }
            }
        },
    }
</script>
