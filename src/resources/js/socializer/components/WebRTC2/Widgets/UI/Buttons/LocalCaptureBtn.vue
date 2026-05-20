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

<script setup>
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'

    const props = defineProps({
        isCapturing: {
            type: Boolean,
            required: true,
        },
    })

     const emit = defineEmits(['start-stream', 'stop-stream'])

    const onBrodcastScreen = () => {
        emit('start-stream')
    }

    const onStopBrodcastScreen = () => {
        emit('stop-stream')
    }

</script>