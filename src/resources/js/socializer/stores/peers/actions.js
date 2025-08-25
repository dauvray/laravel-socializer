import { Peer } from "peerjs"
import { useAjaxService } from '~estarter/services/AjaxService.js'
import { useMeStore } from '~estarter/stores/me.js'
import { isEmpty } from '~estarter/services/helpers.js'

const AjaxService = useAjaxService()

export default {
   
    /*******************************
     * PEERS
     * *****************************/
    createLocalPeer() { 
        this.localPeer =  new Peer({
            host: import.meta.env.VITE_PEERS_SERVER_HOST,
            port: import.meta.env.VITE_PEERS_SERVER_PORT,
            path: import.meta.env.VITE_PEERS_SERVER_PATH,
            key: import.meta.env.VITE_PEERS_SERVER_KEY,
            secure: true,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    {
                        urls: `turn:${import.meta.env.VITE_PEERS_SERVER_HOST}:3478`,
                        username: import.meta.env.VITE_COTURN_USERNAME,
                        credential: import.meta.env.VITE_COTURN_CREDENTIAL
                    }
                ]
            }
        })

        this.localPeer.on('open', id => {
            // Workaround for peer.reconnect deleting previous id
            if (id === null) {
                this.localPeer.id = this.lastLocalPeerId
            } else {
                this.lastLocalPeerId = id
            }
        })

        // this.localPeer.on('error', (err) => {
        //     console.error('Erreur PeerJS :', err);
        // })

        this.localPeer.on('disconnected', () => {
            // Workaround for peer.reconnect deleting previous id
            this.localPeer.id = this.lastLocalPeerId
            this.localPeer._lastServerId = this.lastLocalPeerId
            this.localPeer.reconnect()
        })
    },
    initConnection(payload) {

        const userSlug = payload.options.metadata.slug
        const room = payload.room
        const type = payload.type

        // init room
        if(!this.connections.hasOwnProperty(room)) {
            this.connections[room] = {}
        }


        // init user
        if(!this.connections[room].hasOwnProperty(userSlug)) {
            this.connections[room][userSlug] ={}
        }


        // init type
        if(!this.connections[room][userSlug].hasOwnProperty(type)) {
            this.connections[room][userSlug][type] = []
        }
    },
    // add when you call
    openPeerConnection(payload) {

        const slug = payload.options.metadata.slug
        const peerID = payload.peerId
        const room = payload.room
        const type = payload.type
        const ignoredDataConnections = [] // put here video types without dataPeerConnection

        this.initConnection(payload)

        // create connection
        if (!this.hasActiveConnection(room, slug, type, peerID)) {

            let call = null
            let conn = null

            if(type === 'data') {

                payload.options.metadata.callbackKey = `${type}-${room}`
                call = this.localPeer.connect(peerID, payload.options )

                this.connections[room][slug][type].push(call) 
                
            } else {

                let streamOptions = { ...payload.options, metadata: { ...payload.options.metadata } }

                // custom callbacks
                streamOptions.metadata.callback = `${type}PlayerCallback`

                call = this.localPeer.call(peerID, payload.stream, streamOptions)

                this.connections[room][slug][type].push(call) 

                // join data connection
                if(!ignoredDataConnections.includes(type)) {
                    delete payload.options.stream
                    payload.options.metadata.callback = `${type}PlayerDataCallback` // custom callback
console.log('Creating data connection for', type, payload.options.metadata.callback)
                    conn = this.localPeer.connect(peerID, payload.options )

                    this.connections[room][slug][type].push(conn)  

                }

                return {call , conn}
            }
        }
    },
    hasActiveConnection(room, slug, type, peerID = null) {
        if (!this.connections[room] || !this.connections[room][slug] || !this.connections[room][slug][type]) {
            return false
        }

        if( peerID) {
            return this.connections[room][slug][type].some(conn => {

                if (!conn) return false

                // Pour DataConnection
                if (conn.peer && conn.peer === peerID && !conn.open) return false
                if (conn.peer && conn.peer === peerID && conn.open) return true

                // Pour MediaConnection
                if (conn.connectionId && conn.peer === peerID && conn.open) return true

                return false
            })
        }

        return true
    },
    // add when you are called
    setRemoteConnection(call, payload) {
        
       const slug = payload.options.metadata.slug
       const type = payload.type
       const room = payload.room

       this.initConnection(payload)

       this.connections[room][slug][type].push(call) 
    },
    closePeerConnection(toUserSlug, type = 'data', room = 'default', notify = false) {

        // alert others
        if(notify) {
            this.signalRemoteToClosePeer({
                from: toUserSlug,
                room,
                source: type,
            })
        }

        if(!this.connections.hasOwnProperty(room) 
            || !this.connections[room].hasOwnProperty(toUserSlug)
            || !this.connections[room][toUserSlug].hasOwnProperty(type)
        ) {
            return
        }

        this.connections[room][toUserSlug][type].forEach((conn, idx) => {

            // is emitter ?
            if(conn.hasOwnProperty('peer')) {
                switch(type) {
                    case 'data':
                        conn.close()
                        break
                    case 'stream':
                    case 'screen':
                    case 'visio':
                        if(conn._localStream) {
                            conn._localStream.getTracks().forEach(track => track.stop())
                            conn.peerConnection.close()
                        } else {
                            conn.close()
                        }
                }
            }

        })

        this.connections[room][toUserSlug][type] = []

        // clear rooms
        this.clearRoom(room, toUserSlug, type)
    },
    clearRoom(room, toUserSlug, type) {

        if(this.connections[room][toUserSlug].hasOwnProperty(type) 
            && this.connections[room][toUserSlug][type].length === 0) {
            delete this.connections[room][toUserSlug][type]
        }

        if(isEmpty(this.connections[room][toUserSlug])) {
            delete this.connections[room][toUserSlug]
        }

        if(isEmpty(this.connections[room])) {
            delete this.connections[room]
        }
    },
    signalRemoteToClosePeer(metadata){
        const meStore = useMeStore()
        AjaxService.load('/close-connection-to-peer-id', 'post', {
            toUserSlug: metadata.from,
            fromUserSlug: meStore.getMe.slug,
            room: metadata.room,
            type: metadata.source,
        })
    },
    putToPendingRequests(toUserSlug, data) {
        this.pendingRequests[toUserSlug] = data
    },
    removeToPendingRequests(toUserSlug) {
        delete this.pendingRequests[toUserSlug]
    },
    deleteRemoteOpenedConnections(conn) {
        this.remoteOpenedConnections.delete(conn.connectionId)
        this.signalRemoteToClosePeer({
            from: conn.metadata.from,
            room: conn.metadata.room,
            source: conn.metadata.source,
        })
    },

     /*******************************
     * DATA
     * *****************************/

    registerIncomingPeerCallback(callbackKey, callbackFn) {
        if (typeof callbackFn === 'function') {
            this.incomingConnectionCallbacks.set(callbackKey, callbackFn)
        }
    },
    unregisterIncomingPeerCallback(callbackKey) {
        this.incomingConnectionCallbacks.delete(callbackKey)
    },
    async setLocalDataPeer(context) {

        if (!this.localPeer) {
            this.createLocalPeer()
        }

        if (this.connectionListenerSet) return

        this.localPeer.on('connection', async(conn) => {

            conn.on('error', (err) => {
                console.error('Erreur sur la connexion entrante :', err);
            });

            conn.on('close', () => {
                console.log('Connexion call fermée dans actions :', conn.connectionId);
                this.remoteOpenedConnections.delete(conn.connectionId)
            });

            const meta = conn.options?.metadata || {}

            const callbackKey = meta.callbackKey

            const dynamicCallback = this.incomingConnectionCallbacks.get(callbackKey)

            if (callbackKey && dynamicCallback && !this.remoteOpenedConnections.has(conn.connectionId)) {
                this.remoteOpenedConnections.add(conn.connectionId)
                dynamicCallback(conn)
            } 
            // En prevision car actuellement les dataChannels sont gérés par la callbackKey
            else if (meta.callback) {
                try {
                    const module = await import(`~socializer/callbacks/${meta.callback}.js`)
                    if (typeof module.default === 'function' && !this.remoteOpenedConnections.has(conn.connectionId)) {
                        this.remoteOpenedConnections.add(conn.connectionId)
                        console.log('Appel du callback dynamique', meta.callback)
                        await module.default(conn, context)
                    }
                } catch (e) {
                    console.error(`Callback dynamique ${meta.callback} invalide`, e)
                }
            } else {
                console.warn('Aucun callback trouvé pour cette connexion', meta)
            }
        })

        this.connectionListenerSet = true
    },
    sendData(message, room = 'default') {

        if(!isEmpty(this.connections)) {

            for (const userSlug in this.connections[room]) {

                if(message.hasOwnProperty('exclude') && message.exclude.includes(userSlug) ) {
                    continue
                }

                if(message.hasOwnProperty('include') && !message.include.includes(userSlug) ) { 
                    continue
                }

                this.connections[room][userSlug]['data'].forEach(conn => {
                    conn.send(JSON.stringify(message.data))
                })
            }
        }
    },

     /*******************************
     * MEDIA
     * *****************************/

    setLocalVideoPeer(context, callback = null) {

        if(this.videoPeerActivated) {
            return
        }

        this.videoPeerActivated = true

        if(!this.localPeer) {
            this.createLocalPeer()
        }

        this.localPeer.on('call', async(call) => {

            // a placer dans la callback
            // call.on('error', (err) => {
            //     console.error('Erreur sur la connexion entrante :', err);
            // });

            // call.on('close', () => {
            //     console.log('Connexion call fermée dans actions :', call.connectionId);
            //     this.remoteOpenedConnections.delete(call.connectionId)
            // });

            if(call.options.metadata.hasOwnProperty('callback')) {
                const customCallbacks = await import(`~socializer/callbacks/${call.options.metadata.callback}.js`)
                if (typeof customCallbacks.default === 'function' && !this.remoteOpenedConnections.has(call.connectionId)) {
                    this.remoteOpenedConnections.add(call.connectionId)
                    customCallbacks.default(call, context)
                } else {
                    console.error(`Le module ${call.options.metadata.callback}.js n'a pas d'exportation par défaut valide.`);
                }

           } else {

                if (callback instanceof Function) {
                    callback(call, context)
                }
            }
        }) 
    },
    setCurrentCallRoomId(roomId) {
        this.currentCallRoomId = roomId
    },
    startVideoStream() {
        this.isStreamingWebcam = true
    },
    startCaptureStream() {
        this.isCapturingScreen = true
    },
    setCallInProgress(status) {
        this.isCallInProgress = status
    },
    stopVideoStream(room, source) {

        switch(source) {
            case 'stream':
                this.isStreamingWebcam = false
                break;
            case 'screen':
                this.isCapturingScreen = false
                break;
        }

        this.removeStream(room, source)

        for (const slug in this.connections[room]) {
            if(this.connections[room][slug].hasOwnProperty(source)) {

                for (let i = 0; i < this.connections[room][slug][source].length; i++) {
                    this.connections[room][slug][source][i].close()
                }
                delete this.connections[room][slug][source]
                this.clearRoom(room, slug, source)
            }
        }
    },
    sendVideoData(data, room = 'default', type = 'stream') {
        const roomConnections = this.connections?.[room];

        if (!roomConnections) return;

        for (const slug in roomConnections) {
            const peers = roomConnections[slug]?.[type];

            if (!Array.isArray(peers)) continue;

            for (const conn of peers) {
                if (conn && typeof conn.send === 'function') {
                    try {
                        conn.send(data);
                    } catch (err) {
                        console.warn(`Erreur lors de l'envoi de données à ${slug}`, err);
                    }
                }
            }
        }
    },
    addPlayer(player) {
        this.players.push(player)
    },
    removePlayer(elementId) {
        this.players = this.players.filter(item => item.videoId !== elementId)
    },
    saveStream(room = 'default', stream = null, type = 'stream') {
        if(!this.streams.hasOwnProperty(room)) {
            this.streams[room] = []
        }
        
        this.streams[room].push({
            type: type,
            stream: stream,
        })
    },
    removeStream(room = 'default', type = 'stream') {

        if(this.streams.hasOwnProperty(room)) {

            this.streams[room] = this.streams[room].filter(item => item.type !== type)

            if(this.streams[room].length === 0) {
                delete this.streams[room]
            }
        }
    },
    saveRemoteStream(room = 'default', userSlug, stream = null, type = 'stream') {

        // init room
        if(!this.remoteStreams.hasOwnProperty(room)) {
            this.remoteStreams[room] = {}
        }

        // init user
        if(!this.remoteStreams[room].hasOwnProperty(userSlug)) {
            this.remoteStreams[room][userSlug] ={}
        }

        // init type
        if(!this.remoteStreams[room][userSlug].hasOwnProperty(type)) {
            this.remoteStreams[room][userSlug][type] = []
        }

        this.remoteStreams[room][userSlug][type].push(stream)
    },
    removeRemoteStream(room = 'default', userSlug, type = 'stream') {

        if (!this.remoteStreams?.[room]?.[userSlug]?.[type]) return;

        this.remoteStreams[room][userSlug][type] = [];
        
        if (this.remoteStreams[room][userSlug][type].length === 0) {
            delete this.remoteStreams[room][userSlug][type];
        }

        if (Object.keys(this.remoteStreams[room][userSlug]).length === 0) {
            delete this.remoteStreams[room][userSlug];
        }

        if (Object.keys(this.remoteStreams[room]).length === 0) {
            delete this.remoteStreams[room];
        }
    }
}