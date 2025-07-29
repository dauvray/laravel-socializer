<template>
    <div class="alert alert-warning" role="alert">
        <h4 class="alert-heading"><IconWidget icon="phone-volume"></IconWidget> Appel video de {{ fromUserSlug }}</h4>
        <hr>
        <button type="button" class="btn btn-success" @click="onAcceptCall">Accepter</button>
        <button type="button" class="btn btn-danger" @click="onRefuseCall">Refuser</button>
    </div>
</template>

<script>
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'

    export default {
        name: 'VideoCallAlert',
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
            pickedUp: false,
          }  
        },
        mounted() {
            this.interval = setInterval(() => {
                this.ding.play()
            }, 1000)

            setTimeout(() => {
                if(!this.pickedUp) {
                    this.onRefuseCall()
                }
            }, 10000)
            
        },
        beforeUnmount() {
            this.ding.pause()
            this.stopDing()
        },
        methods: {
            stopDing() {
                this.ding.pause()
                clearInterval(this.interval)
            },
            onRefuseCall() {
                this.stopDing()
                this.$emit('response-alert', false)
            },
            onAcceptCall() {
                this.stopDing()
                this.$emit('response-alert', true)
            }
        }
    }
</script>