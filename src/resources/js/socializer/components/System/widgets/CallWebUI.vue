<template>
    <div id="call-web-ui" class="card-body">
        <button type="button" >
            <IconWidget icon="microphone-slash"></IconWidget>
        </button>
        <button type="button">
            <IconWidget icon="video-slash"></IconWidget>
        </button>
        <button 
            type="button" 
            class="btn-stop-call"
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