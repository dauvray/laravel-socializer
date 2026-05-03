<template>
    <!-- <Teleport :to="`#collapser-${roomId}`" >-->
        <SpectrumAnalyzer
            v-if="currentStream"
            class="border rounded mt-2"
            :streams="streams"
        ></SpectrumAnalyzer>
  <!--  </Teleport> -->
</template>

<script>
    import IconWidget from '~estarter/components/widgets/IconWidget.vue'
    import SpectrumAnalyzer from '~socializer/components/AudioRoom/widgets/SpectrumAnalyzer.vue'

    export default {
        name: 'AudioDefaultUserButtonUI',
        components: {
            IconWidget,
            SpectrumAnalyzer,
        },
        props: {
            onAudioCall: Function,
            onStopBrodcastWebcam: Function,
            room: String,
            onAirRoom: {
                type: String,
                required: false,
                default: null,
            },
            currentType: {
                type: String,
                required: false,
                default: 'stream',
            },
            currentStream: MediaStream,
            remoteStreams: {
                type: Object,
                required: false,
                default: () => ({}),
            },
        },
        data() {
            return {
                streams: [],
            }
        },
        mounted() {
            console.log('ready to audio stream')
            if (typeof this.onAudioCall === 'function') {
                this.onAudioCall()
            }
        },
        beforeUnmount() {
            if (typeof this.onStopBrodcastWebcam === 'function') {
                this.onStopBrodcastWebcam()
            }
        },
        watch: {
            remoteStreams: {
                handler() {
                    console.log('remoteStreams updated', this.remoteStreams)
                    this.updateStreams()
                 
                },
                deep: true,
                immediate: true
            },
        },
        methods: {
            updateStreams() {
                console.log('Updating streams for room:', this.room, 'onAirRoom:', this.onAirRoom, 'currentType:', this.currentType)
                const roomId = this.onAirRoom || this.room
                if (!roomId || !this.remoteStreams?.[roomId]) {
                    this.streams = []
                    return
                }

                const streamType = this.currentType || 'stream'
                const nextStreams = []
                const seenIds = new Set()

                Object.keys(this.remoteStreams[roomId]).forEach(slug => {
                    const userStreams = this.remoteStreams[roomId]?.[slug]?.[streamType]
                    if (!Array.isArray(userStreams)) return

                    userStreams.forEach(mediaStream => {
                        if (!mediaStream) return

                        const streamId = mediaStream.id || `${slug}-${nextStreams.length}`
                        if (seenIds.has(streamId)) return

                        seenIds.add(streamId)
                        nextStreams.push(mediaStream)
                    })
                })

                this.streams = nextStreams
            }
        }
    }
</script>