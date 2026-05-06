import { isEmpty } from '~estarter/services/helpers.js'

export default {

    setLocalDataPeer(type) {

        if (!this.localPeer) {
            this.createLocalPeer()
        }

        // if the connection listener is already set, we don't need to set it again
        if (this.localPeerReady) return

        this.localPeer.on('connection', async(conn) => {

            const meta = conn.options?.metadata?.callbackKey
            if(this.hasIncomingPeerCallbacks(meta)) {
                const dynamicCallback = this.incomingConnectionCallbacks.get(meta)
            }


            conn.on('error', (err) => {
                console.error('Erreur sur la connexion entrante :', err);
            });

            conn.on('close', () => {
                console.log('Connexion call fermée dans actions :', conn.connectionId);
                // inutile this.remoteOpenedConnections.delete(conn.connectionId)
            });

          


           
            if(dynamicCallback === undefined) {
                console.warn('Aucun callback trouvé pour cette connexion entrante avec callbackKey', meta)
            }
            console.log('Metadata de la connexion entrante :', meta, dynamicCallback)

            if (callbackKey && dynamicCallback && !this.remoteOpenedConnections.has(conn.connectionId)) {
              // inutile  this.remoteOpenedConnections.add(conn.connectionId)
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

        this.localPeerReady = true
    },

    initConnection(payload) {

        const userSlug = payload.options.metadata.slug
        const room = payload.options.metadata.room
        const type = payload.options.metadata.type

        const connections = { ...this.connections }

        if (!connections[room]) {
            connections[room] = {}
        }

        if (!connections[room][userSlug]) {
            connections[room][userSlug] = {}
        }

        if (!connections[room][userSlug][type]) {
            connections[room][userSlug][type] = []
        } else {
            return
        }

        this.connections = connections
    },
    storePeerConnection(room, slug, type, connection) {
        this.connections[room][slug][type].push(connection)
    },
    removePeerConnection(room, slug, type, connectionId) {

        // const connections = this.connections[room][slug][type]
        // this.connections[room][slug][type] = connections.filter(conn => conn.connectionId !== connectionId)

        
        if(!this.connections.hasOwnProperty(room) 
            || !this.connections[room].hasOwnProperty(slug)
            || !this.connections[room][slug].hasOwnProperty(type)
        ) {
            return
        }

        this.connections[room][slug][type].forEach((conn, idx) => {

            // is emitter ?
            if(conn && conn.hasOwnProperty('peer')) {
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

        delete this.connections[room][slug][type]
    },  
    clearConnectionsRoom(room, slug, type) {

        if(!this.connections.hasOwnProperty(room)) {
            return
        }

        if(!this.connections[room].hasOwnProperty(slug)) {
            return
        }

        if(this.connections[room][slug].hasOwnProperty(type)) {
            delete this.connections[room][slug][type]
        }

        if(isEmpty(this.connections[room][slug])) {
            delete this.connections[room][slug]
        }

        if(isEmpty(this.connections[room])) {
            delete this.connections[room]
        }
    },


    dispatchSignal(signal) {
        const s = { ...signal, ts: Date.now() }
        this.lastSignal = s
        const key = s.roomId

        if (!this.signalQueues[key]) {
            this.signalQueues[key] = []
        }
        this.signalQueues[key].push(s)

         // Garde un historique limité par room
        if (this.signalQueues[s.roomId].length > 10) {
            this.signalQueues[s.roomId].shift()
        }
    },


    // Enregistrer l’id d’un peer distant lorsqu’il est reçu
    hasRemotePeerId(userSlug) {
        return this.remotePeersId.has(userSlug)
    },
    getRemotePeerId(userSlug) {
        return this.remotePeersId.get(userSlug)
    },
    removeRemotePeerId(userSlug) {
        this.remotePeersId.delete(userSlug)
    },
    addRemotePeerId(userSlug, peerId) {
        this.remotePeersId.set(userSlug, peerId)
    },

    // Gérer les connexions en attente d’un peer id distant
    addWaitingRemotePeerId(userSlug, { room, type }) {
        this.waitingRemotePeerId.set(userSlug, { room, type })
    },
    hasWaitingRemotePeerId(userSlug) {
        return this.waitingRemotePeerId.has(userSlug)
    },
    removeWaitingRemotePeerId(userSlug) {
        this.waitingRemotePeerId.delete(userSlug)
    },

}