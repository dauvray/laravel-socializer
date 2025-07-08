import { isEmpty } from '~estarter/services/helpers.js'

export default {
    getLocalPeer() {
        return this.localPeer
    },
    getLocalPeerId() {
        if(this.localPeer) {
            return this.lastLocalPeerId
        }

        return null
    },
    getCurrenCallRoomId() {
        return this.currentCallRoomId
    },
    getIsStreaming() {
        return this.isStreamingWebcam ? true : false
    },
    getIsCapturing() {
        return this.isCapturingScreen ? true : false
    },
    getConnections() {
        return this.connections
    },
    getRoomViewers: (state) => {
        return (room, type) => {
            let total = 0

            if(type === 'visio') {
                room = state.currentCallRoomId
            }

            if(!isEmpty(state.connections) && state.connections.hasOwnProperty(room)) {
                for (const slug in state.connections[room]) {
                   if(state.connections[room][slug].hasOwnProperty(type)) {
                        total++
                   }
                }
            }
            return total
        }
    },
    getStream: (state) => {
        return (room = 'default') => {
            if(state.streams.hasOwnProperty(room)) {
                return state.streams[room]
            }
            return null
        }
    },
    getPendingRequests() {
        return this.pendingRequests
    },
    getIsCallInProgress() {
        return this.isCallInProgress
    },
    getPlayers() {
        return this.players
    },
}