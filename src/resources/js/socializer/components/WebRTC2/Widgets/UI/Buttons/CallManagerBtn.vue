<template>
    <div id="call-web-ui" class="card-body">
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
    </div>
</template>

<script setup>
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'

    const emit = defineEmits(['stop-call'])
</script>