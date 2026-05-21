
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
    getLastLocalPeerId() {
        return this.lastLocalPeerId
    },
    getLocalPeerReady() {
        return this.localPeerReady
    },

    /*--------------------------
    | Signal queues
    --------------------------*/
    getQueueForRoom: (state) => {
        return (roomId) => {
            return state.signalQueues[roomId] || null
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

    /*--------------------------
    | Players
    --------------------------*/
    getPlayers() {
        return this.players
    },

}