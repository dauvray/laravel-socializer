import { ref } from 'vue'
import { usePeers } from '~socializer/components/WebRTC/composables/usePeers.js'
import { useMeStore } from '~estarter/stores/me.js'
import { storeToRefs } from 'pinia'
import { setContext, logError } from '~estarter/services/logger.js'

import streamPeerCallback from '~socializer/callbacks/streamPlayerCallback.js'
import screenPeerCallback from '~socializer/callbacks/screenPlayerCallback.js'

export function useMediaBroadcast(props, emit, mode = 'stream') {
    const {
        onAirRoom,
        currentType,
        isStreaming,
        isCapturing,
        callInprogress,
        startWebcamStream,
        startScreenCapture,
        stopVideoStream,
        currentStream,
        remoteStreams,
        setLocalVideoPeer,
        syncUsersConnections,
        syncJoingingUsers,
        createVideoElement,
        removeVideoElement,
        updateVideoProps,
        deleteRemoteOpenedConnections,
        saveRemoteStream,
        removeRemoteStream,
        resolveAnswerStream,
    } = usePeers(props, mode, props.room)

    const localVideoPlayer = 'local-stream'
    const localScreenPlayer = `local-screen`
    const isMuted = ref(true)
    const isVideoEnabled = ref(false)
    const isVideoCall = ref(false)
    const isAudioCall = ref(false)

    const meStore = useMeStore()
    const { getMe } = storeToRefs(meStore)

    function init(instance) {
        setContext({
            users: props.users,
            room: props.room,
            feature: 'stream-broadcast',
        })

        switch (mode) {
            case 'stream':
                setLocalVideoPeer(instance, streamPeerCallback.default)
                break
            case 'screen':
                setLocalVideoPeer(instance, screenPeerCallback.default)
                break
            default:
                setLocalVideoPeer(instance, streamPeerCallback.default)
                break
        }
    }
    // watch users list to sync connections when new user join the room
    function watchUsers(newVal) {
        try {
            if(newVal && newVal.length === 0) {
                return
            }

            if (isStreaming.value || isCapturing.value) {
                syncJoingingUsers(newVal)
            }
        } catch (e) {
            logError(e)
        }
    }
    // init and start video call
    function onVideoCall() {
        isMuted.value = false
        isVideoEnabled.value = true
        isVideoCall.value = true
        isAudioCall.value = false

        startBroadcast()
    }
    // init and start audio call
    function onAudioCall() {
        isMuted.value = false
        isVideoEnabled.value = false
        isVideoCall.value = false
        isAudioCall.value = true

        startBroadcast()
    }
    // toggle audio stream
    function onManageAudio() {
        isMuted.value = !isMuted.value

        updateVideoProps({
            isMuted: isMuted.value
        })
    }
    // toggle video stream
    function onManageVideo() {
        isVideoEnabled.value = !isVideoEnabled.value

        updateVideoProps({
            isVideoEnabled: isVideoEnabled.value
        })
    }
    // start stream
    function startBroadcast() {
        
        // start webcam stream with audio and video constraints ( set it local )
        startWebcamStream(
            {
                audio: !isMuted.value,
                video: isVideoEnabled.value,
            },
            true
        )
        .then(async () => {
            
            // sync connections for all users in the room to receive the new stream
            syncUsersConnections([...props.users])

            // create local video element for the stream
            if (!document.getElementById(localVideoPlayer)) {
                await createVideoElement(
                    {
                        videoId: localVideoPlayer,
                        nickname: getMe.value.slug,
                        isMuted: isMuted.value,
                        isVideoEnabled: isVideoEnabled.value,
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true,
                    },
                    currentStream.value
                )

                emit('started-stream', 'stream', localVideoPlayer)
            }
        })
    }
    // stop webcam stream
    function onStopBrodcastWebcam() {
        stopVideoStream('stream')
        removeVideoElement(localVideoPlayer)

        emit('stoped-stream', 'stream', localVideoPlayer)
    }
    // start screen capture
    function onBrodcastScreen() {
        startScreenCapture()
        .then(async () => {
            syncUsersConnections(props.users)
            if(!document.getElementById(localScreenPlayer)) {
                await createVideoElement(
                    {
                        videoId: localScreenPlayer,
                        nickname: getMe.value.slug
                    },
                    currentStream.value
                )
                emit('started-stream', 'screen', localScreenPlayer)
            }
        })
    }
    // stop screen capture
    function onStopBrodcastScreen() {
        stopVideoStream('screen')
        removeVideoElement(localScreenPlayer)
        emit('stoped-stream', 'screen', localScreenPlayer)
    }

    return {
        // system
        init,
        watchUsers,
        createVideoElement,
        removeVideoElement,
        deleteRemoteOpenedConnections,
        saveRemoteStream,
        removeRemoteStream,
        resolveAnswerStream,
        // stream
        isStreaming,
        currentStream,
        onAirRoom,
        currentType,
        remoteStreams,
        callInprogress,
        isMuted,
        isVideoEnabled,
        isVideoCall,
        isAudioCall,
        localVideoPlayer,
        onVideoCall,
        onAudioCall,
        onManageAudio,
        onManageVideo,
        onStopBrodcastWebcam,
        // screen
        isCapturing,
        localScreenPlayer,
        onBrodcastScreen,
        onStopBrodcastScreen,
    }
}