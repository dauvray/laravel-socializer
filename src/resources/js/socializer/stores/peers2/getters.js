
import { isEmpty, findDeepValue } from '~estarter/services/helpers.js'

export default {

    /*--------------------------
    | Connections
    --------------------------*/
    getConnections() {
        return this.connections
    },

    /*--------------------------
    | LocalPerr
    --------------------------*/
    getLocalPeer() {
        return this.localPeer
    },
    getLocalPeerId() {
        return this.localPeer ? this.localPeer.id : null
    },

    /*--------------------------
    | Signal queues
    --------------------------*/
    getQueueForRoom: (state) => {
        return (roomId) => {
            if (!state.signalQueues[roomId]) {
                state.createSignalQueueRoom(roomId)
            }
            return state.signalQueues[roomId]
        }
    },
    getLastSignal() {
        return this.lastSignal
    },

    /*--------------------------
    | Remote peers ID
    --------------------------*/
    getWaitingRemotePeerId: (state) => (userSlug) => {
        return state.waitingRemotePeerId.get(userSlug) ?? null
    },
    hasWaitingRemotePeerId: (state) => (userSlug) => {
        return state.waitingRemotePeerId.has(userSlug)
    },
    hasRemotePeerId: (state) => (userSlug) => {
        return state.remotePeersId.has(userSlug)
    },
    getRemotePeerId: (state) => (userSlug) => {
        return state.remotePeersId.get(userSlug)
    },

}