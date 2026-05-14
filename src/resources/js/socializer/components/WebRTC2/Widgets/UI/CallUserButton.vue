<template>
    <button
        type="button" 
        class="btn btn-primary btn-sm" 
        :disabled="isInCall"
        :title="`Appel ${type}`"
        @click="onCallUser">
        <IconWidget :icon="callIcon"></IconWidget>
    </button>
</template>

<script>
    /**
     * Use the global notification component system
     */

    import IconWidget from '~estarter/components/widgets/IconWidget.vue'

    export default {
        name: 'CallUserButton',
        inject: [
            "AWN",
            "eventBus",
        ],
        components: {
            IconWidget,
        },
        props: {
            user: {
                type: Object,
                required: true
            },
            type: {
                type: String,
                default: 'visio'
            }
        },
        data() {
            return {
                isInCall: false,
            }
        },
        mounted() {
            this.eventBus.$on('close-call', this.onCloseCall)
        },
        beforeUnmount() {
            this.eventBus.$off('close-call', this.onCloseCall)
        },
        computed: {
            callIcon: function() {
                if(this.type === 'vocal') {
                    return this.isCalling ? 'phone-slash' : 'phone'
                }
                return this.isCalling ? 'video-slash' : 'video'
            },
        },
        methods: {
            onCallUser() {
                this.eventBus.$emit('call-user', this.user.slug, this.type)
                this.AWN.info(`Appel ${this.user.slug}`)
                this.isInCall = true
            },
            onCloseCall(users) {
                if(users.find(user => user.userSlug === this.user.slug && user.type === this.type)) {
                    this.isInCall = false
                }
            },
        }
    }
</script>