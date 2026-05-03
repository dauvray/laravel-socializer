
export default () => {
  return {
    lastLocalPeerId: null, // last peer id local
    localPeer: null, // peer local
    remotePeersId: new Map(), // peers id distants
    connectionListenerSet : false,
    incomingConnectionCallbacks : new Map(), // callbacks pour les connexions entrantes
    connections: {}, // connections ouvertes aux autres pairs
    streams: {}, // stream locaux ouverts aux autres pairs
    remoteStreams: {}, // streams ouverts par les autres pairs
    pendingRequests: {},
    players: [], // liste des players actifs
    currentCallRoomId: null,
    videoPeerActivated: false,
    isStreamingWebcam: false,
    isCapturingScreen: false,
    isCallInProgress: false,

    remoteOpenedConnections: new Set(), // connections ouvertes provenant des autres pairs ( TODO: peut etre inutile )
  }
}