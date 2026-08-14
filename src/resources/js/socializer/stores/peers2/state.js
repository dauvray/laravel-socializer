
export default () => {
  return {
    lastLocalPeerId: null, // last peer id local
    localPeer: null, // peer local
    localPeerReady : false, // indique si le peer local est prêt (id attribué)

    // ─── Runtime du Peer singleton (usePeerTransport) ────────────────────────
    // Cet état décrit le cycle de vie du `localPeer` ci-dessus : il vit donc ici, et
    // non au niveau du module ES du transport, sinon un HMR (module rechargé, store
    // conservé) ou une Pinia neuve désynchronise les compteurs de l'état du peer —
    // le dernier consommateur devient invisible et un peer encore utilisé est détruit.
    peerConsumerCount: 0, // contextes consommateurs du peer singleton (ref-counting)
    peerInitPromise: null, // init en vol — garde anti-race (2 contextes = 1 seul Peer)
    peerReconnectAttempts: 0, // tentatives de reconnexion PeerJS (backoff + garde anti-boucle)
    peerDestroyTimer: null, // handle de la destruction différée (PEER_DESTROY_DELAY_MS)
    peerReconnectTimer: null, // handle du backoff de reconnexion en cours
    // Closure qui débranche les listeners du Peer courant, produite par `_doInit` (seul
    // endroit qui sait ce qui a été branché, et sur quelle instance). Ici pour la même
    // raison que le reste de cette section : le Peer est un singleton que N'IMPORTE QUEL
    // contexte — voire une autre copie du module après un HMR — peut détruire, donc la
    // référence qui permet de le débrancher ne peut vivre ni dans la closure de
    // `usePeerTransport`, ni au niveau de son module.
    peerListenersDetach: null,
    connections: {}, // connexions actives (peerId, userSlug, stream, type)
    remotePeersId: new Map(), // peers id distants
    waitingRemotePeerId: new Map(), // connexions en attente d’un peer id distant (key: userSlug, value: { room, type })
    signalQueues: {}, // files d’attente de signaux pour les callbacks de connexions { type-roomId, payload }
    signalSeq: {}, // seq monotone par clé de file (type-room) — jamais réinitialisé, cf. dispatchSignal
    lastSignal: null, // dernier signal reçu (pour debug)
    players: [], // liste des players actifs
  }
}