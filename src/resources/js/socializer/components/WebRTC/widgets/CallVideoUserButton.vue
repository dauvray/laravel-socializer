<template>
    <button v-if="!isInCall" 
        type="button" 
        class="btn btn-primary btn-sm" 
        :disabled="isCalling"
        title="Appel visio"
        @click="onCallUser">
        <IconWidget icon="video"></IconWidget>
    </button>
    <button v-else 
        type="button"
        class="btn btn-danger btn-sm"
        title="Terminer appel visio"
        @click="onCloseCall">
        <IconWidget icon="video-slash"></IconWidget>
    </button>
</template>

<script>
    /**
     * Use the global notification component system
     */

    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import { usePeers } from '~socializer/components/WebRTC/composables/usePeers.js'
    import { useMeStore } from '~estarter/stores/me.js'
    import { mapActions, mapState } from 'pinia'
    import { ref } from 'vue'


    export default {
        name: 'CallVideoUserButton',
        inject: [
            "AWN",
        ],
        components: {
            IconWidget,
        },
        props: {
            user: {
                type: Object,
                required: true
            },
        },
        setup( props ) {
            const {
                getAuthorizationRemotePeerId,
                pendingRequests,
                stopAllVisioStream,
                connections,
                ConnectionsHasTypeInRoom,
            } = usePeers(props, 'visio', null)

            const isInCall= ref(false)

            return {
                getAuthorizationRemotePeerId,
                pendingRequests,
                stopAllVisioStream,
                connections,
                ConnectionsHasTypeInRoom,
                isInCall,
            }
        },
        async mounted() {
          
            this.checkIsInCall()
        },
        computed: {
            ...mapState(useMeStore, {
                me: 'getMe',
            }),
            isCalling: function() {
                return this.pendingRequests.hasOwnProperty(this.user.slug)
            },
        },
        watch: {
            connections: {
                handler() {
                    this.checkIsInCall()
                },
                deep: true
            },
        },
        methods: {
            onCallUser() {
                this.getAuthorizationRemotePeerId(this.user.slug, 'visio')
                this.AWN.info(`Appel ${this.user.slug}`)
            },
            onCloseCall() {
                this.stopAllVisioStream('visio')
            },
            checkIsInCall() {
                this.isInCall = this.ConnectionsHasTypeInRoom(this.user.slug, 'visio')
            }
        }
    }
</script>