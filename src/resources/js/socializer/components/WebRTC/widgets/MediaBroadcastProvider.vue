<template>
    <slot
        :room="room"
        :onAirRoom="onAirRoom"
        :currentType="currentType"
        :isStreaming="isStreaming"
        :isCapturing="isCapturing"
        :currentStream="currentStream"
        :remoteStreams="remoteStreams"
        :callInprogress="callInprogress"
        :isMuted="isMuted"
        :isVideoEnabled="isVideoEnabled"
        :isVideoCall="isVideoCall"
        :isAudioCall="isAudioCall"
        :onVideoCall="onVideoCall"
        :onAudioCall="onAudioCall"
        :onManageAudio="onManageAudio"
        :onManageVideo="onManageVideo"
        :onStopBrodcastWebcam="onStopBrodcastWebcam"
        :onBrodcastScreen="onBrodcastScreen"
        :onStopBrodcastScreen="onStopBrodcastScreen"
    ></slot>
</template>

<script>
    import { useMediaBroadcast } from '../composables/useMediaBroadcast.js'
    import { isEqual } from '~estarter/services/helpers.js'

    export default {
        name: 'MediaBroadcastProvider',
        emits: [
            'stoped-stream',
            'started-stream',
        ],
        props: {
            room: {
                type: String,
                required: false,
                default: null,
            },
            users: {
                type: Array,
                required: true,
            },
            mode: {
                type: String,
                required: false,
                default: 'stream', // type: stream, screen ...
            },
        },
        setup(props, { emit }) {
            return useMediaBroadcast(props, emit, props.mode)
        },
        mounted() {
            this.init(this)
        },
        watch: {
            users: {
                handler(newVal, oldVal) {
                    this.watchUsers(newVal)
                },
                immediate: true,
                deep: true,
            },
        },
    }
</script>