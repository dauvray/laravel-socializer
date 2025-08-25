<template>
    <Teleport :to="`#collapser-${room.id}`" >
        <SpectrumAnalyzer
            v-if="currentStream"
            class="border rounded mt-2"
            :streams="streams"
        ></SpectrumAnalyzer>
    </Teleport>

    <div class="chat-header m-2">
        <RoomUsersList :users="users"></RoomUsersList>
    </div>
</template>

<script>
    import { usePeers } from '~socializer/components/WebRTC/composables/usePeers.js'
    import { ref } from 'vue'
    import { useMeStore } from '~estarter/stores/me.js'
    import { mapState } from 'pinia'
    import SpectrumAnalyzer from './widgets/SpectrumAnalyzer.vue'
    import RoomUsersList from '~socializer/components/Server/widgets/RoomUsersList.vue'

    const streamPeerCallback = import(`~socializer/callbacks/streamPlayerCallback.js`)
    
    export default {
        name: 'AudioComponent',
        props: {
            room: {
                type: Object,
                required: false,
                default: null,
            },
            users: {
                type: Array,
                required: true
            },
        },
        components: {
            SpectrumAnalyzer,
            RoomUsersList,
        },
        setup( props ) {

            const {
                startWebcamStream,
                stopVideoStream,
                removeVideoElement,
                syncUsersConnections,
                syncJoingingUsers,
                createVideoElement,
                isStreaming,
                currentStream,
                setLocalVideoPeer,
                connections,
                onAirRoom,
                remoteStreams,
            } = usePeers(props, 'stream', props.room.id)

            const isAudioCall = ref(true)
            const audioLocalRoomStream = 'audio-local-Room-stream'
            const streams = ref([])

            return {
                startWebcamStream,
                stopVideoStream,
                removeVideoElement,
                isStreaming,
                syncUsersConnections,
                syncJoingingUsers,
                audioLocalRoomStream,
                isAudioCall,
                createVideoElement,
                currentStream,
                setLocalVideoPeer,
                connections,
                onAirRoom,
                streams,
                remoteStreams,
            }
        },
        mounted() {
            this.setLocalVideoPeer(this, streamPeerCallback.default)
        },
        computed: {
            ...mapState(useMeStore, {
                me: 'getMe',
            }), 
        },
        mounted() {
            this.startAudio()
        },
        beforeUnmount() {
            this.stopVideoStream('stream')
            this.removeVideoElement(this.audioLocalRoomStream)
        },
        watch: {
            users : {
                handler(newVal, oldVal) {
           
                    if(!oldVal) oldVal = []
                    
                    // if on air send stream to new users
                    if(this.isStreaming) {
                        this.syncJoingingUsers(newVal, oldVal)
                    }
                },
                deep: true,
                immediate: true
            },
            remoteStreams: {
                handler() {
                    console.log('remoteStreams updated', this.remoteStreams)
                   this.updateStreams()
                 
                },
                deep: true,
                immediate: true
            }
        },
        methods: {
            startAudio() {
               this.startWebcamStream({ audio: true, video: false }, true )
                .then(async () => {
                  //  this.syncUsersConnections(this.users)

                    if(!document.getElementById(this.audioLocalRoomStream)) {
                         await this.createVideoElement(
                            {
                                videoId: this.audioLocalRoomStream,
                                nickname: this.me.slug,
                                isMuted: false,
                                isVideoEnabled: false,
                                echoCancellation: true,
                                noiseSuppression: true,
                                autoGainControl: true
                            },
                            this.currentStream
                        )

                        // hide UI elements
                      //  document.getElementById('videoContainer').style.display = 'none'
                       // document.getElementById('stop-stream-btn').style.display = 'none'

                        this.$emit('started-stream', 'stream', this.audioLocalRoomStream)
                    }
                })
            },
            updateStreams() {

                if (!this.remoteStreams?.[this.onAirRoom]) return;

                Object.keys(this.remoteStreams[this.onAirRoom]).forEach(slug => {
                   this.remoteStreams[this.onAirRoom][slug].stream.forEach(mediaStream => {
                        this.streams.push(mediaStream)
                   })
                })

            }
            
        }
    }
</script>

