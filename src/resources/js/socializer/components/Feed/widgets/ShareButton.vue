<template>
    <button class="share-btn" 
        type="button"
        @click="onShare">
        <IconWidget icon="share"></IconWidget> Partager
    </button>
</template>

<script>
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'

    export default {
        name: 'ShareButton',
        emits: [
            'share-item'
        ],
        components: {
            IconWidget,
        },
        methods: {
            onShare() {
                this.$emit('share-item')
            }
        }
    }
</script>