<template>
    <div v-if="props.status !== 'idle'" id="call-web-ui">
        <template v-if="props.status === 'calling' || props.status === 'receiving'">
            <Spinner></Spinner>
        </template>
        <template v-else>
            <button type="button">
                <IconWidget icon="microphone-slash"></IconWidget>
            </button>
            <button type="button">
                <IconWidget icon="video-slash"></IconWidget>
            </button>
            <button
                type="button"
                class="btn-stop-call"
                @click="emit('stop-call')">
                <IconWidget icon="phone-slash"></IconWidget>
            </button>
        </template>
    </div>
</template>

<script setup>
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import Spinner from '~estarter/components/widgets/Spinners/Spinner1.vue'

    const props = defineProps({
        status: {
            type: String,
            default: 'idle'
        }
    })

    const emit = defineEmits(['stop-call'])
</script>