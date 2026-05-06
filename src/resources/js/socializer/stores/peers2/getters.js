
import { isEmpty, findDeepValue } from '~estarter/services/helpers.js'

export default {

    getConnections() {
        return this.connections
    },
    getLocalPeer() {
        return this.localPeer
    },
    getLocalPeerId() {
        return this.localPeer ? this.localPeer.id : null
    },


    getQueueForRoom: (state) => {
        return (roomId) => {
            if (!state.signalQueues[roomId]) {
                state.signalQueues[roomId] = []
            }
            return state.signalQueues[roomId]
        }
    },
    clearSignalQueueRoom(roomId) {
        delete this.signalQueues[roomId]
    },
    getLastSignal() {
        return this.lastSignal
    },




}