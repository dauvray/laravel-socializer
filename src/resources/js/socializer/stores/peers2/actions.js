import { isEmpty } from '~estarter/services/helpers.js'

export default {

    prepareRoomConnection(payload) {

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
    closePeerConnection(room, slug, type) {
 
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


    // Gérer les signaux provenant des autres composants (Notifications.vue)
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
    clearSignalQueueRoom(roomId) {
        delete this.signalQueues[roomId]
    },
    createSignalQueueRoom(roomId) {
        if (!this.signalQueues[roomId]) {
            this.signalQueues[roomId] = []
        }
    },

    // Enregistrer l’id d’un peer distant lorsqu’il est reçu
    removeRemotePeerId(userSlug) {
        this.remotePeersId.delete(userSlug)
    },
    addRemotePeerId(userSlug, peerId) {
        this.remotePeersId.set(userSlug, peerId)
    },

    // Gérer les connexions en attente d’un peer id distant
    addWaitingRemotePeerId(userSlug, { room, type }) {
        this.waitingRemotePeerId.set(userSlug, {
            room,
            type,
            createdAt: Date.now(),
        })
    },
    removeWaitingRemotePeerId(userSlug) {
        this.waitingRemotePeerId.delete(userSlug)
    },

}