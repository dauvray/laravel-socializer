<template>
        <div  class="fmd-editor-navigation">
            <div 
                data-test="fmd-editor-navigation"
                class="form-check form-switch">
                <input
                    class="form-check-input"
                    type="checkbox"
                    role="switch"
                    v-model="editionMode"
                    id="setMode"
                    />
                <label class="form-check-label" for="canSeeAnswer"
                    title="Editer le questionnaire"
                    >Edition
                </label>
            </div>
        </div>
</template>

<script>
    export default {
        name: 'EditionMode',
        emits: [
            'edition-mode'
        ],
        data() {
           return {
               editionMode: false,
           }
       },
       watch: {
            editionMode(newValue) {
                this.$emit('edition-mode', newValue)
            }
       }
    }
</script>