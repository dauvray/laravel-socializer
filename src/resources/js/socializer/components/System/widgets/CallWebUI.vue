<template>
    <div id="call-web-ui" class="card-body">
        <button type="button" class="btn btn-secondary rounded-circle">
            <IconWidget icon="microphone-slash"></IconWidget>
        </button>
        <button type="button" class="btn btn-secondary rounded-circle">
            <IconWidget icon="video-slash"></IconWidget>
        </button>
        <button 
            type="button" 
            class="btn btn-danger rounded-circle"
            @click="onStopCall">
            <IconWidget icon="phone-slash"></IconWidget>
        </button>
    </div>
</template>

<script>
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    export default {
        name: 'CallWebUI',
        emits: [
            'stop-call',
        ],
        components: {
            IconWidget,
        },
        methods: {
            onStopCall() {
                this.$emit('stop-call')
            }
        }
    }
</script>