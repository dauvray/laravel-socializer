export default () => {
  return {
    lastLocalPeerId: null, // last peer id local
    localPeer: null, // peer local
    _connectionHandlerRegistered : false,
    _dynamicConnectionCallbacks: {},
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