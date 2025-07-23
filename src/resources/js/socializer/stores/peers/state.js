
import { shallowReactive, markRaw } from 'vue'


export default () => {
  return {
    lastLocalPeerId: null, // last peer id local
    localPeer: null, // peer local
    connectionListenerSet : false,
    incomingConnectionCallbacks : new Map(), // callbacks pour les connexions entrantes
    connections: {}, // connections ouvertes aux autres pairs
    streams: {}, // stream ouverts aux autres pairs
    remoteOpenedConnections: new Set(), // connections ouvertes provenant des autres pairs
    pendingRequests: {},
    players: [], // liste des players actifs
    currentCallRoomId: null,
    videoPeerActivated: false,
    isStreamingWebcam: false,
    isCapturingScreen: false,
    isCallInProgress: false,
  }
}