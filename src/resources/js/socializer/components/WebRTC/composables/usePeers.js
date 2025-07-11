import { ref, reactive, computed, onMounted ,onBeforeUnmount, h, createApp, inject } from 'vue'
import { useAjaxService } from '~estarter/services/AjaxService.js'
import { usePeerStore } from '~socializer/stores/peers.js'
import { useServerStore } from '~socializer/stores/server.js'
import { useMeStore } from '~estarter/stores/me.js'
import { deepGet, uniqueId } from '~estarter/services/helpers.js'
import Draggable from '~socializer/directives/draggable.js'

export function usePeers(props, type = 'data', room = 'app') {

    /*******************************
     * INITIALISATION
     * *****************************/
    const eventBus = inject('eventBus')

    const peerStore = usePeerStore()
    const AjaxService = useAjaxService()
    const meStore = useMeStore()
    const serverStore = useServerStore()

    const isConnecting = ref(false)
    const videoStates = reactive({
        isMuted: false,
        isVideoEnabled: true,
    })

    const videoContainer = ref('#videoContainer')
    const currentStream = ref(null) // current stream
    const currentType = ref(type) // current room 
    const currentRoom = ref(room) // current room  id
    const onAirRoom = ref(room) // room id where streaming started

    /*******************************
     * METHODS
     * *****************************/

    /*------  PEER MANAGEMENT ----------*/

    /*------  Calls ----------*/

    // send authorization to remote peer connect
    const getAuthorizationRemotePeerId = (toUserSlug = '', type = 'vocal') => {

        if(!currentCallRoomId.value) {
            setCurrentCallRoomId(uniqueId('room'))
        }

        const data = {
            type: type,
            action: 'peer-access-permission',
            room: currentCallRoomId.value,
            peerId: peerStore.localPeer._id,
        }

        peerStore.putToPendingRequests(toUserSlug, data)

        AjaxService.load('/send-alert-to-user', 'post', {
            toUserSlug: toUserSlug,
            options: data
        }) 
    }

    // ask for authorization to remote peer connect
    const sendAuthorizationRemotePeerId = (toUserSlug, data, status) => {

        if(!currentCallRoomId.value) {
            setCurrentCallRoomId(data.room)
        }

        AjaxService.load('/response-to-authorization-peer', 'post', {
            toUserSlug,
            options: data,
            status
        }) 
    }

    // receive remote authorization to peer connect
    const receiveAuthorizationRemotePeerId = (data) => {

        peerStore.removeToPendingRequests(data.fromUserSlug)

        if(!data.status) {

            const type = data.options.type
            window.AWN.alert(`${data.fromUserSlug} est injoignable`)
            // stopVideoStream(type)
            // removeVideoElement(`local-${type}`)

        } else {

            startVisioStream({
                audio: false,
                video: true,
            }).then(() => {

                updateCurrentRoom(data.options.room)

                if(!document.getElementById('local-webcam')) {
                    createVideoElement(
                        {
                            videoId: `local-${data.options.type}`,
                            nickname: meStore.getMe.slug
                        },
                        currentStream.value
                    )
                }
                setCallInProgress(true)
                connectToQueuedConnections({
                    peerId: data.options.peerId, 
                    userSlug: data.fromUserSlug, 
                    type: data.options.type, 
                    room: data.options.room 
                })
            })
        }
    }

    const onResponseCallError = (call, err) => {
        sendAuthorizationRemotePeerId(call.metadata.from, {
            room: call.metadata.room,
            type: call.metadata.source,
            from: call.metadata.slug,
        }, false )
    }

    /*------  Streams ----------*/
    
    // envoi le peerId a l'utilisateur distant et attent le sien en retour
    const getRemotePeerId = (toUserSlug) => {

        const room = currentRoom.value || deepGet(serverStore, 'currentRoom.id', null)
        const peerId = peerStore.localPeer._id
        const payload = {
                peerId: peerStore.localPeer._id,
                toUserSlug: toUserSlug,
                room: onAirRoom.value,
                type: currentType.value
            }

        if(room && peerId && toUserSlug) {
            AjaxService.load('/ask-to-peer-id', 'post', payload) 
        }

        isConnecting.value = true
    }

    // repond a une demande de peer id
    const sendLocalPeerId = (fromUserSlug, custom_type= null, custom_room = null) => {

        isConnecting.value = false
        const payload = {
            peerId: peerStore.localPeer._id,
            type: custom_type || currentType.value,
            room: custom_room || onAirRoom.value,
            toUserSlug: fromUserSlug,
        }

        AjaxService.load('/response-to-peer-id', 'post', payload)
    }

    /*------  Synchronization ----------*/

    const connectToQueuedConnections = async (payload) => {
        if(payload.type === 'data') {

            peerStore.openPeerConnection({
                peerId: payload.peerId,
                options: { 
                    reliable: true,
                    metadata: { 
                        slug: payload.userSlug,
                        from: meStore.getMe.slug,
                        source: payload.type,
                        room: payload.room,
                    }, 
                },
                room: payload.room,
                type: payload.type,
            })

        } else {

            const connection = peerStore.openPeerConnection({
                peerId: payload.peerId, 
                stream: peerStore.getStream(payload.room, payload.type),
                options: { 
                    metadata: { 
                        slug: payload.userSlug,
                        from: meStore.getMe.slug,
                        source: payload.type,
                        room: payload.room,
                    }, 
                },
                room: payload.room,
                type: payload.type,
            })

            if(connection && connection.call) {

                // Recevoir et afficher le flux vidéo distant
                connection.call.on('stream', (remoteStream) => {
                    createVideoElement({
                        videoId: connection.call.connectionId, 
                        nickname: connection.call.metadata.slug,
                        // peer needed only for one-way diffusion
                        peer: payload.room == 'visio' ? null : connection.call,
                    }, remoteStream)

                    remoteStream.getVideoTracks()[0].addEventListener('ended', () => {
                        console.log('ended stream remote')

                        removeVideoElement(connection.call.connectionId)
                        if(!connections.value.hasOwnProperty(onAirRoom.value)) {
                            console.log('le salon est vide')
                        }

                    })
                })
            }
        }
    }

    // store remote calling connection
    
    const storeConnection = (call, options) => {
        peerStore.setRemoteConnection(call, options)
    }

    const closeRemotePeerId = (toUserSlug, custom_type = null, custom_room = null, notify = false) => {
        peerStore.closePeerConnection(
            toUserSlug, 
            custom_type || currentType.value, 
            custom_room || onAirRoom.value, 
            notify
        )
    }

    const syncUsersConnections = (users) => {
        users.forEach( user => {
            if(user.slug !== meStore.getMe.slug && !deepGet(connections, `${onAirRoom.value}.${user.slug}.${currentType.value}`, false)) {
                getRemotePeerId(user.slug)
            }
        })
    }

    const syncJoingingUsers = (users, previousUsers) => {
        // Comparer avec la copie précédente
        if(!previousUsers) {
            previousUsers = [];
        }
        const previousIds = previousUsers.map(user => user.id)

         // Identifier les nouveaux utilisateurs
         const newUsers = users.filter(user => !previousIds.includes(user.id))

        if (newUsers.length > 0) {
            syncUsersConnections(newUsers)
        }
    }

    /*------  DATA CONNECTION ----------*/

    const setLocalDataPeer = async (context, callback) => {
        onAirRoom.value = currentRoom.value || deepGet(serverStore, 'currentRoom.id', null)
        registerIncomingPeerCallback(onAirRoom.value, callback)
        await peerStore.setLocalDataPeer(context)
    } 

    const registerIncomingPeerCallback = (roomId, callback) => {
        peerStore.registerIncomingPeerCallback(`${currentType.value}-${roomId}`, callback)
    }

    const sendData = (data) => {
        peerStore.sendData(data, onAirRoom.value)
    }

    /*------  MEDIA CONNECTION ----------*/

    const setLocalVideoPeer = (context, callback) => {
        peerStore.setLocalVideoPeer(context, callback)
    } 

    const startWebcamStream = async (options, isLocal = false) => {
        peerStore.startVideoStream()
        onAirRoom.value = currentRoom.value || deepGet(serverStore, 'currentRoom.id', null)
        const newStream = await navigator.mediaDevices.getUserMedia(options)
        newStream.isLocal = isLocal // to mute local sound in player
        currentStream.value = newStream
        peerStore.saveStream(onAirRoom.value, currentStream.value, currentType.value)
        updateVideoProps({
            isVideoEnabled: options.video,
            isMuted: options.audio
        })
    }

    const startVisioStream = async options => {
        currentStream.value = await navigator.mediaDevices.getUserMedia(options)
        onAirRoom.value = currentCallRoomId.value
    }

    const startScreenCapture = async () => {
        currentStream.value = await navigator.mediaDevices.getDisplayMedia()
        peerStore.startCaptureStream()
        onAirRoom.value = currentRoom.value || deepGet(serverStore, 'currentRoom.id', null)
        peerStore.saveStream(onAirRoom.value, currentStream.value, currentType.value)
    }

    const stopVideoStream = async (source) => {

        if(currentStream.value) {
            currentStream.value.getTracks().forEach((track) => {
                track.stop()
            })
            currentStream.value = null
        }

        await peerStore.stopVideoStream(onAirRoom.value, source)
        peerStore.removeStream(onAirRoom.value, source)
    }

    // stop visio connection with one user
    const stopUserVisioStream = async (userSlug, type) => {   

        const connections = peerStore.getConnections
        const currentCallRoomId = peerStore.getCurrenCallRoomId

        if (connections[currentCallRoomId][userSlug] && connections[currentCallRoomId][userSlug].hasOwnProperty(type)) {

            connections[currentCallRoomId][userSlug][type].forEach (peer => {
                if(peer.hasOwnProperty('_remoteStream')) {
                    closeEventBusStream(type, peer._remoteStream, peer)
                    peerStore.closePeerConnection(userSlug, type, currentCallRoomId)
                }
            })
        }
        
        // if no one in room stop my stream
        if(!connections.hasOwnProperty(currentCallRoomId)) {
            removeVideoElement(`local-${type}`)
            peerStore.setCallInProgress(false)
        }
    }

    // stop all visio connections in room
    const stopAllVisioStream = async (type) => {   

        const connections = peerStore.getConnections
        const currentCallRoomId = peerStore.getCurrenCallRoomId

        if (connections[currentCallRoomId]) {

            Object.keys(connections[currentCallRoomId]).forEach (userSlug => {
                console.log(userSlug)
                if(connections[currentCallRoomId][userSlug].hasOwnProperty(type)) {
                    connections[currentCallRoomId][userSlug][type].forEach(peer => {
                        if(peer.hasOwnProperty('_remoteStream')) {
                            console.log('close stream')
                            closeEventBusStream(type, peer._remoteStream, peer)
                            peerStore.closePeerConnection(userSlug, type, currentCallRoomId)
                        }
                    })
                }
            })
        }
        
        // if no one in room stop my stream
        if(!connections.hasOwnProperty(currentCallRoomId)) {
            removeVideoElement(`local-${type}`)
            peerStore.setCallInProgress(false)
        }
    }

    const setCallInProgress = (status) => {
        peerStore.setCallInProgress(status)
    }

    const setCurrentCallRoomId = (roomId) => {
        peerStore.setCurrentCallRoomId(roomId)
    }

     /*------  Utils ----------*/

    const createVideoElement = async (options = {}, stream = null) => {

       const wrapperId = `wrapper-${options.videoId}`
       const source = options.type || currentType.value

        // if exists abort
        if(document.getElementById(wrapperId)) {
            return
        }

        const VideoComponent = await import('~socializer/components/WebRTC/widgets/VideoComponent.vue')
        
        // Créer un élément wrapper unique pour chaque vidéo
        const wrapper = document.createElement('div')
        wrapper.id = wrapperId
        wrapper.classList.add('draggable-video')

        const containerElement = document.querySelector(videoContainer.value)

        if (containerElement) {
          containerElement.appendChild(wrapper)
        } else {
          console.error(`Container '${videoContainer.value}' not found.`)
          return
        }

        const app = createApp({
            render: () =>
                h(VideoComponent.default, {
                    videoId: options.videoId,
                    stream: stream,
                    nickname: options.nickname,
                    type: options?.source || source,
                    peer: options.peer,
                    roomId: options?.roomId || onAirRoom.value,
                }),
        });

        app.provide('states', videoStates)
        app.provide('eventBus', eventBus)

        app.mount(wrapper)
        
         // Stocker l'application avec ses métadonnées
        peerStore.addPlayer({ app, videoId: options.videoId, type: source })

        // Appliquer manuellement la directive `v-draggable` sur le wrapper
        const draggableDirective = Draggable.mounted // Récupérer la méthode `mounted` de la directive
        if (draggableDirective) {
            draggableDirective(wrapper) // Appliquer la directive sur l'élément wrapper
        }
    }

    const removeVideoElement = (elementId) => {
        const players = peerStore.getPlayers
        const index = players.findIndex((entry) => entry.videoId === elementId);
        if (index !== -1) {
            const { app } = players[index];
            const el = document.getElementById(elementId)

            if(el) {
                el.parentNode.remove()
            }
            app.unmount() // Démonter l'application Vue
            peerStore.removePlayer(elementId)
        }
    }

    const updateVideoProps = (props) => {
        const keys = Object.keys(props)
        keys.forEach( key => {
            videoStates[key] = props[key]
        })
    }

    const closeEventBusStream = (type, stream = null, peer) => {

        // stop my stream
        if(stream && currentStream.value && stream.id === currentStream.value.id ) {
            stopVideoStream(type)
            removeVideoElement(`local-${type}`)
        } else {
            // stop remote stream just for me and signal remote streamer
            if(peer) {
                peerStore.signalRemoteToClosePeer(peer.metadata)
                removeVideoElement(peer.connectionId)
                if(stream) {
                    stream.getTracks().forEach(track => track.stop())
                }
                
                peer.close()
            }
        }
    }

    const updateCurrentRoom = (roomId) => {
        currentRoom.value = roomId
    }

    const updateCurrentType = (type) => {
        currentType.value = type
    }

    // check if call is running with a user
    const ConnectionsHasTypeInRoom = (userSlug, type ) => {
        const connections = peerStore.getConnections
        for (const room in connections) {
            if (connections[room][userSlug] && connections[room][userSlug].hasOwnProperty(type)) {
                return true
            }
        }
        return false
    }

    /*******************************
     * COMPUTED
     * *****************************/

    const localPeer = computed(() => {
        return peerStore.getLocalPeer
    })

    const localPeerId = computed(() => {
        return peerStore.getLocalPeerId
    })

    const isStreaming = computed(() => {
        return peerStore.isStreamingWebcam
    })

    const isCapturing = computed(() => {
        return peerStore.isCapturingScreen
    })

    const connections = computed(() => {
        return peerStore.getConnections
    })

    const peerConnections = computed(() => {
        return peerStore.getPeerConnections
    })

    const pendingRequests = computed(() => {
        return peerStore.getPendingRequests
    })

    const callInprogress = computed(() => {
        return peerStore.getIsCallInProgress
    })

    const currentCallRoomId = computed(() => {
        return peerStore.getCurrenCallRoomId
    })

    /*******************************
     * WATCHERS
     * *****************************/



    /*******************************
     * LIFE CYCLE
     * *****************************/

    onBeforeUnmount(() => {
        for (const userSlug in connections.value[onAirRoom.value]) {
            connections.value[onAirRoom.value][userSlug][currentType.value].forEach (conn => {
                closeRemotePeerId(userSlug, currentType.value, onAirRoom.value, true)
            })
        }

         eventBus.$off("closeStream", closeEventBusStream)

        // const players = peerStore.getPlayers
        // players.forEach(player => {
        //     if(player.type === currentType.value) {
        //         removeVideoElement(player.videoId)
        //     } 
        // })

        // stopVideoStream(currentType.value)
    })

    onMounted(() => {
        eventBus.$on("closeStream", closeEventBusStream)
    })

    return {
        getAuthorizationRemotePeerId,
        sendAuthorizationRemotePeerId,
        receiveAuthorizationRemotePeerId,
        onResponseCallError,
        setLocalDataPeer,
        setLocalVideoPeer,
        sendData,
        getRemotePeerId,
        sendLocalPeerId,
        closeRemotePeerId,
        storeConnection,
        connectToQueuedConnections,
        syncUsersConnections,
        syncJoingingUsers,
        startWebcamStream,
        startScreenCapture,
        startVisioStream,
        stopVideoStream,
        stopUserVisioStream,
        stopAllVisioStream,
        createVideoElement,
        removeVideoElement,
        updateCurrentRoom,
        updateVideoProps,
        updateCurrentType,
        ConnectionsHasTypeInRoom,
        setCallInProgress,
        setCurrentCallRoomId,
        registerIncomingPeerCallback,
        localPeer,
        localPeerId,
        isConnecting,
        currentStream,
        connections,
        peerConnections,
        pendingRequests,
        isStreaming,
        isCapturing,
        callInprogress,
    }
}