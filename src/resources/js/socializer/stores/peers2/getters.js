import { waitingPeerIdKey } from '~socializer/stores/peers2/keys.js'

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
    getLastRoomSignal: (state) => {
        return (roomId) => {
            const q = state.signalQueues[roomId] || null
             return q?.at(-1) ?? null
        }
    },

    /*--------------------------
    | Composition des rooms (index de présence)
    --------------------------*/
    /**
     * Ce pair est-il présent dans au moins une room connue de cet onglet ?
     * Seul prédicat qui autorise à oublier son peerId (cf. removeRemotePeerId).
     */
    isUserInAnyRoom: (state) => (userSlug) => {
        if (!userSlug) return false
        return Object.values(state.roomMembers).some(
            (slugs) => Array.isArray(slugs) && slugs.includes(userSlug)
        )
    },

    /*--------------------------
    | Remote peers ID
    --------------------------*/
    // ⚠️ Lectures EXACTES : une demande appartient à un contexte (slug + room + type).
    // Interroger sur le slug seul ferait lire à un contexte la demande d'un autre —
    // c'est exactement ce qui empêchait le contexte `stream` d'émettre la sienne.
    getWaitingRemotePeerId: (state) => (userSlug, room = null, type = null) => {
        return state.waitingRemotePeerId.get(waitingPeerIdKey(userSlug, room, type)) ?? null
    },
    hasWaitingRemotePeerId: (state) => (userSlug, room = null, type = null) => {
        return state.waitingRemotePeerId.has(waitingPeerIdKey(userSlug, room, type))
    },
    /** Toutes les demandes en vol concernant un pair, tous contextes confondus (debug/tests). */
    getWaitingRemotePeerIds: (state) => (userSlug) => {
        return [...state.waitingRemotePeerId.values()].filter((entry) => entry?.userSlug === userSlug)
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