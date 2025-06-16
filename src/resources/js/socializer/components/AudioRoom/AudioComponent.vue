<template>
AUDIO ROOM
</template>

<script>
    import { usePeers } from '~socializer/components/WebRTC/composables/usePeers.js'
    import { ref } from 'vue'
    import { useMeStore } from '~estarter/stores/me.js'
    import { mapState } from 'pinia'

    export default {
        name: 'AudioComponent',
        props: {
            room: {
                type: String,
                required: false,
                default: null,
            },
            users: {
                type: Array,
                required: true
            },
        },
        setup( props ) {

            const {
                startWebcamStream,
                syncUsersConnections,
                syncJoingingUsers,
                createVideoElement,
                isStreaming,
            } = usePeers(props, 'stream', props.room)

            const isAudioCall = ref(true)
            const previousUsers = ref([])
            const audioLocalRoomStream = 'audio-local-Room-stream'

            return {
                startWebcamStream,
                isStreaming,
                syncUsersConnections,
                syncJoingingUsers,
                audioLocalRoomStream,
                isAudioCall,
                createVideoElement,
                previousUsers,
            }

        },
        computed: {
            ...mapState(useMeStore, {
                me: 'getMe',
            }),
        },
        mounted() {
            this.startAudio()
        },
        watch: {
            users : {
                handler(newVal) {
                    // if on air send stream to new users
                    if(this.isStreaming) {
                        this.syncJoingingUsers(newVal, this.previousUsers)
                        this.previousUsers = JSON.parse(JSON.stringify(newVal)); // Créer une copie profonde
                    }
                },
                deep: true,
                immediate: true
            }
        },
        methods: {
            startAudio() {
               this.startWebcamStream({
                    audio: true,
                    video: false,
                }).then(async () => {
                    this.syncUsersConnections(this.users)
                    if(!document.getElementById(this.audioLocalRoomStream)) {
                         await this.createVideoElement(
                            {
                                videoId: this.audioLocalRoomStream,
                                nickname: this.me.slug,
                                isMuted: false,
                                isVideoEnabled: false,
                            },
                            this.currentStream
                        )
                        this.$emit('started-stream', 'stream', this.audioLocalRoomStream)
                    }
                })
            },
        }
    };
</script>