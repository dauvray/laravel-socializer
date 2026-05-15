
export default () => {
  return {
    lastLocalPeerId: null, // last peer id local
    localPeer: null, // peer local
    localPeerReady : false, // indique si le peer local est prêt (id attribué)
    connections: {}, // connexions actives (peerId, userSlug, stream, type)
    remotePeersId: new Map(), // peers id distants
    waitingRemotePeerId: new Map(), // connexions en attente d’un peer id distant (key: userSlug, value: { room, type })
    signalQueues: {}, // files d’attente de signaux pour les callbacks de connexions { type-roomId, payload }
    lastSignal: null, // dernier signal reçu (pour debug)
    players: [], // liste des players actifs
  }
}