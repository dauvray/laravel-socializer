
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

    // ─── Signalisation : deux granularités, à ne pas confondre ───────────────
    // Ce store est PARTAGÉ par tous les contextes de l'onglet (`data-app` des
    // notifications + un contexte par MediaBroadcastProvider monté). Chaque entrée
    // doit donc être indexée à la granularité du FAIT qu'elle décrit, sinon un
    // contexte confisque ou détruit l'état d'un autre.
    //
    //   - un peerId est un fait par ONGLET distant : un seul `Peer` PeerJS par onglet,
    //     donc une entrée par slug. Ce qui est propre au contexte, ce n'est pas la
    //     valeur, c'est sa DURÉE DE VIE — d'où `roomMembers` plus bas.
    //   - une demande de peerId est un fait par CONTEXTE : « j'ai demandé le peerId de
    //     X pour la room R en type T ». D'où la clé composite `slug|room|type`.
    //
    // Historique : les deux étaient indexées sur le slug seul. Sur une page montant
    // plusieurs providers (cf. Exemples/Home.vue), le premier contexte à demander un
    // peerId posait un drapeau que les autres lisaient comme « demande déjà en vol »,
    // et n'émettaient donc jamais la leur — le contexte `stream` restait muet et
    // l'arrivant ne voyait aucun flux.
    remotePeersId: new Map(), // peerId distants (clé: userSlug)
    waitingRemotePeerId: new Map(), // demandes de peerId en vol (clé: `slug|room|type`, valeur: { room, type, createdAt, … })

    // Composition des rooms, par contexte (clé: contextId, valeur: string[] de slugs).
    // Écrit par l'unique producteur de `ctx.connection.usersInRoom`
    // (usePeerConnections._doGetRoomUsersDiff), purgé à la destruction du contexte.
    // C'est la source de vérité de « ce pair est-il encore présent quelque part ? »,
    // seul prédicat qui autorise à oublier son peerId (cf. removeRemotePeerId).
    roomMembers: {},
    signalQueues: {}, // files d’attente de signaux pour les callbacks de connexions { type-roomId, payload }
    signalSeq: {}, // seq monotone par clé de file (type-room) — jamais réinitialisé, cf. dispatchSignal
    lastSignal: null, // dernier signal reçu (pour debug)
    players: [], // liste des players actifs
  }
}