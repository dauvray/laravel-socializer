export default () => {
  return {
    lastLocalPeerId: null,
    localPeer: null,
    connections: {},
    streams: {}, // stream ouverts
    remoteOpenedConnections: [], // connections ouvertes
    pendingRequests: {},
    players: [],
    currentCallRoomId: null,
    videoPeerActivated: false,
    isStreamingWebcam: false,
    isCapturingScreen: false,
    isCallInProgress: false,
  }
}