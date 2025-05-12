export default () => {
  return {
    lastLocalPeerId: null,
    localPeer: null,
    connections: {},
    queuedConnections: {},
    pendingRequests: {},
    players: [],
    currentCallRoomId: null,
    videoPeerActivated: false,
    isStreamingWebcam: false,
    isCapturingScreen: false,
    isCallInProgress: false,
  }
}