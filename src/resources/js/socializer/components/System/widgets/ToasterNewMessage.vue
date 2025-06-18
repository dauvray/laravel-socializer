<template>
    <div class="toast-container position-fixed bottom-0 end-0 p-3">
        <div id="liveToast" ref="liveToast" class="toast" role="alert" aria-live="assertive" aria-atomic="true">
            <div class="toast-header">
                <strong class="me-auto">Bootstrap</strong>
                <small>11 mins ago</small>
                <button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close"></button>
                </div>
                <div class="toast-body">
                    <p>lo, world! This is a toast message.</p>
                    <form class="row g-3">
                        <div class="col-10">
                            <input class="form-control form-control-sm" 
                                    type="text" 
                                    placeholder="Réponse rapide"
                                    aria-label=".form-control-sm example"
                                    v-model="message"
                                    >
                        </div>
                         <div class="col-2">
                             <button type="button" class="btn btn-primary btn-sm" @click="onSendMessage">
                                <IconWidget icon="paper-plane" />
                                <span class="visually-hidden">Envoyer</span>
                             </button>
                        </div>
                    </form>

            </div>
        </div>
    </div>
</template>

<script>
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    export default {
        name: 'ToasterNewMessage',
        emits: [
            'closed',
            'send-message',
        ],
        components: {
            IconWidget,
        },
        props: {
            event: {
                type: Object,
                
            },
        },
        data() {
            return {
                toastBootstrap: null,
                message: null,
            }
        },
        mounted() {
            this.toastBootstrap = bootstrap.Toast.getOrCreateInstance(this.$refs.liveToast)
            this.$refs.liveToast.addEventListener('hidden.bs.toast', this.onClose)
            this.toastBootstrap.show()
        },
        methods: {
            onSendMessage() {
                this.toastBootstrap.hide()
                this.onClose()
            },
            onClose() {
                this.$emit('closed')
            },
        }
    }
</script>
