<template>
    <component
        v-if="currentComponent"
        v-draggable
        :is="currentComponent"
        :fromUserSlug="fromUserSlug"
        :options="options"
        @response-alert="onResponseAlert"
    ></component>
</template>

<script>
    import { defineAsyncComponent } from 'vue'
    import Draggable from '~socializer/directives/draggable.js'

    export default {
        name: 'AlertComponent',
        emits: [
            'response-alert'
        ],
        components: {
            AudioCallAlert: defineAsyncComponent(() => import('~socializer/components/WebRTC/widgets/partials/AudioCallAlert.vue')),
            VideoCallAlert: defineAsyncComponent(() => import('~socializer/components/WebRTC/widgets/partials/VideoCallAlert.vue')),
        },
        props: {
            fromUserSlug: {
                type: String,
                required: false,
                default: null
            },
            options: {
                type: Object,
                required: true
            }
        },
        directives: {
            draggable: Draggable,
        },
        data() {
            return {
                currentComponent: null,
                mappingComponents: {
                    'peer-access-permission' : {
                        'vocal': 'AudioCallAlert',
                        'visio': 'VideoCallAlert'
                    }
                }
            }
        },
        created() {
            this.currentComponent = this.mappingComponents[this.options.action][this.options.type]
        },
        methods: {
            onResponseAlert(status) {
                this.$emit('response-alert', this.fromUserSlug, this.options, status)
            }
        }
    }
</script>