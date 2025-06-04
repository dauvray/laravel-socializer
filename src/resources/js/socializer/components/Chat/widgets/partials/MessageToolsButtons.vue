<template>
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
        @selected-emoji="onSelectedEmoji"
    ></EmojBtn>
</template>

<script>
    import EmojBtn from '~formdesigner/application/formCreator/widgets/Emoji.vue'
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
   
    export default {
        name: 'MessageToolsButtons',
        emits: [
            'selected-emoji',
            'open-wysiwyg'
        ],
        components: {
            EmojBtn,
            IconWidget,
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
                this.$emit('open-wysiwyg');
            },
        },
    };

</script>