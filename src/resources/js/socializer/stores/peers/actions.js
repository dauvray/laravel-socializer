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
            })

        this.localPeer.on('open', id => {
            // Workaround for peer.reconnect deleting previous id
            if (id === null) {
                this.localPeer.id = this.lastLocalPeerId
            } else {
                this.lastLocalPeerId = id
            }
        })

        this.localPeer.on('error', (err) => {
            console.error('Erreur PeerJS :', err);
        })

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
            this.connections[room][userSlug] = {}
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
        if(!this.connections[room][slug][type].some(item => {
            if(item) {
                return item.peer === peerID
            }
        })) {

            let call = null
            let conn = null

            if(type === 'data') {
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
                    conn = this.localPeer.connect(peerID, payload.options )
                    this.connections[room][slug][type].push(conn) 
                }

                return {call , conn}
            }
        }
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

            // alert others
            if(notify) {
                const meStore = useMeStore()
                AjaxService.load('/close-connection-to-peer-id', 'post', {
                    toUserSlug: toUserSlug,
                    fromUserSlug: meStore.user.slug,
                    room,
                    type,
                })
            }
        })

        this.connections[room][toUserSlug][type] = []

        // clear rooms
        this.clearRoom(room, toUserSlug, type)
    },
    addToQueuedConnections(peerId, userSlug, room = 'default', type = 'data',) {
        this.queuedConnections[userSlug] = { 
            peerId, 
            room, 
            type 
        }
    },
    removeToQueuedConnections(userSlug) {
        delete this.queuedConnections[userSlug]
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
            fromUserSlug: meStore.user.slug,
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

     /*******************************
     * DATA
     * *****************************/

    setLocalDataPeer(context, callback = null) {

        if(!this.localPeer) {
             this.createLocalPeer()
        }

        this.localPeer.on('connection', async(conn) => {

            conn.on('error', (err) => {
                console.error('Erreur sur la connexion entrante :', err);
            });

             // execute la callback dynamique passée dans les metadata sinon celle passée en argument
           if(conn.options.metadata.hasOwnProperty('callback')) {
                const customCallbacks = await import(`~socializer/callbacks/${conn.options.metadata.callback}.js`)
                if (typeof customCallbacks.default === 'function') {
                    await customCallbacks.default(conn, context)
                } else {
                    console.error(`Le module ${conn.options.metadata.callback}.js n'a pas d'exportation par défaut valide.`);
                }
           } else {
                if (callback instanceof Function) {
                    callback(conn)
                }
           }
           
        })
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

            if(call.options.metadata.hasOwnProperty('callback')) {
                const customCallbacks = await import(`~socializer/callbacks/${call.options.metadata.callback}.js`)
                if (typeof customCallbacks.default === 'function') {
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
        if(!isEmpty(this.connections)) {
            for (const slug in this.connections[room]) {
                if(typeof this.connections[room][slug][type][1] !== 'undefined') {
                    this.connections[room][slug][type][1].send(data)
                }
            }
        }
    },
    addPlayer(player) {
        this.players.push(player)
    },
    removePlayer(elementId) {
        this.players = this.players.filter(item => item.videoId !== elementId)
    }
}