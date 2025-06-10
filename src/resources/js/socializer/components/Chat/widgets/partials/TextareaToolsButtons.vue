<template>
    <button 
        type="button" 
        class="btn btn-link" 
        :class="iconColor"
        title="Ajouter fichier" 
        @click="onSelectFile">
        <IconWidget icon="paperclip"></IconWidget>
    </button>
       <input 
        ref="fileInput"
        type="file" 
        style="display: none"
        @change="onFileSelected"
        multiple>
    <button 
        type="button" 
        class="btn btn-link" 
        :class="iconColor"
        title="Modifier" 
        @click="onWysiwyg">
        <IconWidget icon="pen-alt"></IconWidget>
    </button>
    <EmojBtn 
        :btn-class="`btn btn-link ${iconColor}`"
        title="Ajouter un emoji"
        @selected-emoji="onSelectedEmoji"
    ></EmojBtn>
    <VoiceToTextBtn
        @text-voiced="handleVoiceInput"
    ></VoiceToTextBtn>
    <AudioBtn 
        :class="iconColor"
        @record-result="onRecorded"
    ></AudioBtn>
</template>

<script>
    import EmojBtn from '~formdesigner/application/formCreator/widgets/Emoji.vue'
    import AudioBtn from './AudioBtn.vue'
    import VoiceToTextBtn from './VoiceToTextBtn.vue';
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
   
    export default {
        name: 'TextareaToolsButtons',
        emits: [
            'selected-emoji',
            'open-wysiwyg',
            'record-result',
            'selected-file',
            'text-voiced',
        ],
        components: {
            EmojBtn,
            IconWidget,
            AudioBtn,
            VoiceToTextBtn,
        },
        props: {
            iconColor: {
                type: String,
                required: false,
                default: 'text-black',
            },
        },
        methods: {
            onSelectedEmoji(emoji) {
                this.$emit('selected-emoji', emoji);
            },
            onWysiwyg() {
                this.$emit('open-wysiwyg', this.wysiwyg_open);
            },
            onRecorded(formData) {
                this.$emit('record-result', formData);
            },
            onSelectFile() {
                // Déclenche le clic sur l'input file caché
                this.$refs.fileInput.click();
            },
            onFileSelected(event) {
                const files = Array.from(event.target.files);

                files.forEach(file => {
                   this.$emit('selected-file', file);
                });
            },
            handleVoiceInput(text) {
                this.$emit('text-voiced', text)
            }
        },
    };

</script>