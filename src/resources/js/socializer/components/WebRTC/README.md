    ## Front A & B
    [Notifications::mounted()]
        - setLocalVideoPeer with visioPlayerCallback (default callback)
        [usePeer::setLocalVideoPeer()]
            [peerStore::setLocaVideoPeer()]
                - create 'peerStore.localPeer' if not exists
                [peerStore::createLocalPeer()] *(3)
                - add 'peerStore.localPeer' 'onCall' event
                - define callback if call.options.metadata.callback
                - else call callback passed in arguments
           

        - setLocalDataPeer with visioPlayerDataCallback (default callback)
        [usePeer::setLocalDataPeer()]
            - save current room ID for stream in 'onAirRoom.value'
            - register callback *(2)
            [peerStore::registerIncomingPeerCallback()]
                - set 'peerStore.incomingConnectionCallbacks' with `${currentType.value}-${onAirRoom.value}` as key and callback as value
            [peerStore::setLocalDataPeer()]
                - create 'peerStore.localPeer' if not exists
                [peerStore::createLocalPeer()] *(3)
                    - create 'peerStore.localPeer'
                    - add 'peerStore.localPeer' 'onOpen' and 'onDisconnected' events
                - add 'peerStore.localPeer' 'onConnection' event
                - define callback to call (conn.options.metadata : callbackKey but callback is possible) *(2)

Note : TODO la gestion des callback devrait être unifiée entre setLocalVideoPeer et setLocalDataPeer             

    #---------------------------------
    # When A stream webcam action to B 
    #---------------------------------
   
    ## Front A
    [StreamDefaultUserButtonUI] 
        - on click => onVideoCall
    [UseMediaBroadcast::startBroadcast()] 
        - init and start video call
        [usePeer::startWebcamStream()]
            - set 'peerStore.isStreamingWebcam' flag to true
            - save current room ID for stream in 'onAirRoom.value'
            - get user media stream with options and set it to 'currentStream.value'
            - save stream in 'peerStore.streams' in current room with type *(1)
            - update video states for local stream in 'videoStates'
        - sync connections for all users in the room to receive the new stream
        [usePeer::syncUsersConnections()]
            - if remote user B have no connection for current stream type in current room
            [userPeer::getRemotePeerId]
            - send A peerId to remote user B (Ajax: '/ask-to-peer-id')
            - set 'peerStore.isConnecting' flag to true TODO verif

    ## Back A
    [UserController::askForPeerId()]
        - Broadcast private message to remote user B ( A peerID, room, type, A slug)

    ## Front B
    [Notifications::listen()]
        - '.AskToPeerID' : transfer event to 'usePeer.sendLocalPeerId'
        [usePeer::sendLocalPeerId]
            - set 'peerStore.isConnecting' flag to false TODO verif
            - response B peerId to user A (Ajax: '/response-to-peer-id')

    ## Back B
    [UserController::responseToPeerId()]
        - Broadcast private message to remote user A ( B peerId, room, type, B slug)

    ## Front A
    [Notifications::listen]
        - transfer event to 'usePeer.connectToQueuedConnections'
        [usePeer::connectToQueuedConnections]

            - create JSON peer connection configuration
            - add current room stored stream to conf.stream *(1)

            [peerStore::openPeerConnection]
                - Format peer configuration and init connection

                [peerStore::initConnection()]
                    - init 'peerStore.connections' tree if not exists (this.connections[room][userSlug][type])

                - check if peerId already exists in 'peerStore.connections' tree
                - set 'streamPlayerCallback' as call callback in metadata
                - localPeer call User B with A stream and stream options ( metadata ...) # here A send stream to B ( B play metadata callback)
                - store 'call' in this.connections[room][slug][type] ( type ="stream")
                - if needed, localPeer connect User B with dataConnection A
                - store 'conn' in this.connections[room][slug][type] ( type = "data")
                - return {call , conn}

            - receice created 'call' and 'conn' peer connection
            - When stream A arrived add Id in 'usePeer.receivedStreams'  
            - Save remote stream
            [usePeer::saveRemoteStream()]
                [peerStore::saveRemoteStream()]
                    - save stream A in peerStore.remoteStreams[room][userSlug][type]
            - create video player User A
            - add 'onEnded' event to stream

