<template>
    <button v-if="!isInCall" 
        type="button" 
        class="btn btn-primary btn-sm" 
        :disabled="isCalling"
        :title="`Appel ${type}`"
        @click="onCallUser">
        <IconWidget :icon="callIcon"></IconWidget>
    </button>
    <button v-else 
        type="button"
        class="btn btn-danger btn-sm"
        :title="`Terminer appel ${type}`"
        @click="onCloseCall">
        <IconWidget :icon="callIcon"></IconWidget>
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
        name: 'CallUserButton',
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
            type: {
                type: String,
                default: 'visio'
            }
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
            callIcon: function() {
                if(this.type === 'vocal') {
                    return this.isCalling ? 'phone-slash' : 'phone'
                }
                return this.isCalling ? 'video-slash' : 'video'
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
                this.getAuthorizationRemotePeerId(this.user.slug, this.type)
                this.AWN.info(`Appel ${this.user.slug}`)
            },
            onCloseCall() {
                this.stopAllVisioStream(this.type)
            },
            checkIsInCall() {
                this.isInCall = this.ConnectionsHasTypeInRoom(this.user.slug, this.type)
            }
        }
    }
</script>