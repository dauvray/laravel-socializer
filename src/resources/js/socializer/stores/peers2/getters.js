
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

    hasIncomingPeerCallbacks: (state) => {
        return (callbackKey) => {
            return state.incomingConnectionCallbacks.has(callbackKey)
        }
    },
    getIncomingPeerCallbacks: (state) => {
        return (callbackKey) => {
            return state.incomingConnectionCallbacks.get(callbackKey)
        }
    }
}