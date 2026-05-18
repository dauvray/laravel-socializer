
import { isEmpty, findDeepValue } from '~estarter/services/helpers.js'

export default {
    getLocalPeer() {
        return this.localPeer
    },
    /**
     * Retourne le peerId local avec triple fallback :
     * localPeer.id → localPeer._id → lastLocalPeerId
     * Utiliser ce getter partout plutôt que de dupliquer le fallback manuellement.
     */
    getLocalPeerId() {
        return this.localPeer?.id || this.localPeer?._id || this.lastLocalPeerId || null
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
        return (room = 'default', type = 'stream') => {

            return findDeepValue(state.streams, {
                conditions: { type },
                rootCondition: (key) => key == room
            }, 'stream')

        }
    },
    getRemoteStreams() {
       return this.remoteStreams
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