<template>
    <div class="alert alert-warning" role="alert">
        <h4 class="alert-heading"><IconWidget icon="phone-volume"></IconWidget> Appel vocal de {{ fromUserSlug }}</h4>
        <hr>
        <button type="button" class="btn btn-success" @click="onAcceptCall">Accepter</button>
        <button type="button" class="btn btn-danger" @click="onRefuseCall">Refuser</button>
    </div>
</template>

<script>
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'

    export default {
        name: 'AudioCallAlert',
        emits: [
            'response-alert',
        ],
        props: {
            fromUserSlug: {
                type: String,
                required: true
            },
            options: {
                type: Object,
                required: true
            }
        },
        components: {
            IconWidget,
        },
        data() {
          return {
            ding: new Audio('/vendor/socializer/sounds/phone-call.mp3'),
            interval: null,
            autoRefuseTimeout: null,
          }
        },
        mounted() {
            this.interval = setInterval(() => {
                this.ding.play()
            }, 1000)

            this.autoRefuseTimeout = setTimeout(() => {
                this.onRefuseCall()
            }, 20000)

        },
        beforeUnmount() {
            this.stopAlert()
        },
        methods: {
            /**
             * Tout ce que `mounted()` a armé s'arrête ensemble : la sonnerie, sa répétition et
             * l'auto-refus. Les trois chemins qui terminent l'alerte — accepter, refuser, quitter
             * l'écran — passent par ici, et aucun n'a le droit d'en oublier un.
             */
            stopAlert() {
                this.ding.pause()
                clearInterval(this.interval)
                clearTimeout(this.autoRefuseTimeout)
            },
            onRefuseCall() {
                this.stopAlert()
                this.$emit('response-alert', false)
            },
            onAcceptCall() {
                this.stopAlert()
                this.$emit('response-alert', true)
            }
        }
    }
</script>