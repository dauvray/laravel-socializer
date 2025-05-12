<template>
    <div v-attributes="'wrapper'"
        :class="fieldClasses">
        <VueSelect
            v-attributes="'input'"
            v-model="value"
            :options="items"
            :class="inputClasses"
            :multiple="field.multiple"
            :readonly="isReadonly"
            :disabled="isDisabled"
            :clearable="false"
            :reduce="(option) => option.value"
            :placeholder="field.placeholder"
            :taggable="field.selectizeAddElement"
            :create-option="validNewOption"
        ></VueSelect>
    </div>
</template>

<script>
    import {CustomFieldMixin} from '~formdesigner/application/formCreator/mixins/CustomFieldMixin'
    import abstractField from "~formdesigner/vueFormGenerator/fields/abstractField.js"
    import VueSelect from 'vue-select'
    import { coreComponentMapping } from '~socializer/components/Server/roomSettings.js'

    export default {
        name: "AvailableRoomTypeList",
        mixins: [
            CustomFieldMixin,
            abstractField,
        ],
        components: {
            VueSelect,
        },
        data() {
            return {
                fieldValues: []
            }
        },
        created() {
            let idx = 0
            for (const property in coreComponentMapping) {
                if(coreComponentMapping[property].selectable) {
                    this.fieldValues.push({
                        label: coreComponentMapping[property].name,
                        value: property,
                        name: `content_type-${idx}`
                    })
                }
                idx++
            }
            this.QStoreDyn.customizeFieldsAttrs([{ name : 'content_type', attr: {values: this.fieldValues } }])
            this.QStoreDyn.setMapping()
        },
        methods: {
            formatValueToField(val) {
                let result = this.items.find(el => el.value == val)
                if(!result) {
                    return null
                }
                return result
            },
        },
    }
</script>
