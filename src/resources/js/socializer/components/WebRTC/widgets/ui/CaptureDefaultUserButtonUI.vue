<template>
    <button v-if="!isCapturing" 
        type="button" 
        class="btn btn-sm btn-primary"
        @click="onBrodcastScreen">
        <IconWidget icon="tv"></IconWidget> Partage
    </button>
    <button v-else
        type="button" 
        class="btn btn-sm btn-danger"
        @click="onStopBrodcastScreen">
        <IconWidget icon="window-close"></IconWidget> Arrêter partage
    </button>
</template>

<script>
import IconWidget from '~estarter/components/widgets/IconWidget.vue'

export default {
    name: 'CaptureDefaultUserButtonUI',

    components: {
        IconWidget,
    },

    props: {
        isCapturing: Boolean,
        onBrodcastScreen: Function,
        onStopBrodcastScreen: Function,
    },
}
</script>