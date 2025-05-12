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
    import { useAjaxService } from '~estarter/services/AjaxService.js'
    const AjaxService = useAjaxService()
    import { useServerStore } from '~socializer/stores/server.js'
    import { useFormdesignerStore } from '~formdesigner/stores/formdesigner.js'
    import { mapActions, mapState } from 'pinia'

    export default {
        name: "ServerQuestionnaireList",
        mixins: [
            CustomFieldMixin,
            abstractField,
        ],
        components: {
            VueSelect,
        },
        data() {
           return {
                items: []
           }
        },
        async created() {
            if(!this.isBackend) {
                let result = await this.loadServerQuestionnaires()

                // format result
                this.items = result.map(item => {
                    return {
                        value: item.id,
                        label: item.name
                    }
                })
            }
        },
        computed: {
            ...mapState(useFormdesignerStore, {
                isBackend: 'isBackend',
            })
        },
        methods: {
            ...mapActions(useServerStore, [
                'loadServerQuestionnaires',
            ]),
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
