import { markRaw } from 'vue'

export default () => {
  return {
    lastLocalPeerId: null, // last peer id local
    localPeer: null, // peer local
    localPeerReady : false, // indique si le peer local est prêt (id attribué)

    // ─── Registre des contextes WebRTC montés (clé: contextId) ───────────────
    // key = contextId (ex: data-room-test, stream-room-test), value = ctx complet.
    //
    // ⚠️ ICI, et non au niveau du module ES de usePeerTransport, parce que les
    // dispatchers du Peer (`bind('call')`, `bind('connection')`, `bind('error')`) sont
    // des closures qui le consultent : il doit donc vivre EXACTEMENT aussi longtemps que
    // `localPeer` ci-dessus. Quand il vivait dans le module, un HMR renouvelait le
    // registre et conservait le Peer : celui-ci résolvait alors les connexions entrantes
    // contre un registre vide — « Aucun contexte trouvé », connexion FERMÉE — pendant que
    // les composants remontés s'inscrivaient dans le neuf. La recovery
    // `peer-unavailable` balayait le même registre mort.
    //
    // ⚠️ `markRaw` : Vue proxifie les Map. Sans lui, les valeurs ressorties du registre
    // seraient des proxies réactifs et non les objets de contexte eux-mêmes, ce qui
    // casserait les comparaisons d'identité de `unregisterContext` (last-write-wins) et
    // d'`_isAuthorizedIncomingPeer`. Même arbitrage que les handles de timer plus bas.
    //
    // ⚠️ `resetPeerState` NE le vide PAS : un contexte monté survit à la destruction et à
    // la recréation du Peer. Le vider là reviendrait à rendre le Peer neuf sourd à tous
    // les contextes déjà en place.
    contextRegistry: markRaw(new Map()),

    // ─── Runtime du Peer singleton (usePeerTransport) ────────────────────────
    // Cet état décrit le cycle de vie du `localPeer` ci-dessus : il vit donc ici, et
    // non au niveau du module ES du transport, sinon un HMR (module rechargé, store
    // conservé) ou une Pinia neuve désynchronise les compteurs de l'état du peer —
    // le dernier consommateur devient invisible et un peer encore utilisé est détruit.
    // Consommateurs du peer singleton, par JETON (un par instance de usePeerTransport)
    // et non par compteur.
    //
    // ⚠️ C'était un entier, et la soustraction était un piège à deux détentes :
    //   1. `resetPeerState` remettait le compteur à 0 alors que des consommateurs étaient
    //      encore MONTÉS (une destruction de Peer ne démonte personne) ;
    //   2. le décrément était planché à 0, donc un décrément orphelin restait à 0 et
    //      repassait le test « plus personne » de l'appelant.
    // Composés : après une destruction, le démontage suivant d'un consommateur survivant
    // réarmait une destruction sur un Peer que d'AUTRES consommateurs utilisaient encore.
    //
    // Avec des jetons, « plus aucun consommateur » est un fait (`size === 0`) et non le
    // résultat d'une soustraction, et un retrait de jeton inconnu est un no-op structurel.
    // `markRaw` pour la même raison que `contextRegistry` : Vue proxifie les Set.
    peerConsumers: markRaw(new Set()),
    peerInitPromise: null, // init en vol — garde anti-race (2 contextes = 1 seul Peer)
    peerReconnectAttempts: 0, // tentatives de reconnexion PeerJS (backoff + garde anti-boucle)
    peerDestroyTimer: null, // handle de la destruction différée (PEER_DESTROY_DELAY_MS)
    peerReconnectTimer: null, // handle du backoff de reconnexion en cours
    // Rafraîchissement du credential TURN avant son expiration (cf. `_scheduleIceRefresh`).
    // Ici pour la raison de toute cette section, et elle mord particulièrement pour ce
    // minuteur-ci : il est armé pour des HEURES. Au niveau du module, un HMR en aurait
    // renouvelé la référence en laissant le `Peer` vivant — donc un minuteur orphelin
    // impossible à annuler, plus un second armé par la copie neuve. Sur un onglet de
    // développement, ce sont deux rafraîchissements concurrents sur le même `Peer`.
    peerIceRefreshTimer: null, // handle du rafraîchissement de la configuration ICE
    peerIceRefreshAttempts: 0, // tentatives infructueuses consécutives (ICE_REFRESH_MAX_RETRIES)
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
    //     L'entrée porte AUSSI la date de son apprentissage : « le peerId de X est id »
    //     et « je l'ai appris à t » sont le même fait, donc la même entrée et la même
    //     écriture. Deux structures parallèles se désynchroniseraient sans jamais lever
    //     (cf. l'en-tête de keys.js), et le harnais a déjà ce piège en réserve
    //     (`_signalQueue` vs `_signalQueueRooms`). Précédent : `waitingRemotePeerId`
    //     porte son `createdAt` DANS l'entrée. Ce que la date gouverne est la CONFIANCE
    //     (composer ou redemander : `getDialableRemotePeerId`), jamais l'existence de
    //     l'entrée — cf. REMOTE_PEER_ID_LEASE_MS.
    //   - une demande de peerId est un fait par CONTEXTE : « j'ai demandé le peerId de
    //     X pour la room R en type T ». D'où la clé composite `slug|room|type`.
    //
    // Historique : les deux étaient indexées sur le slug seul. Sur une page montant
    // plusieurs providers (cf. Exemples/Home.vue), le premier contexte à demander un
    // peerId posait un drapeau que les autres lisaient comme « demande déjà en vol »,
    // et n'émettaient donc jamais la leur — le contexte `stream` restait muet et
    // l'arrivant ne voyait aucun flux.
    remotePeersId: new Map(), // peerId distants (clé: userSlug, valeur: { peerId, learnedAt })
    waitingRemotePeerId: new Map(), // demandes de peerId en vol (clé: `slug|room|type`, valeur: { room, type, createdAt, … })

    // Composition des rooms, par contexte (clé: contextId, valeur: string[] de slugs).
    // Écrit par l'unique producteur de `ctx.connection.remotePeers`
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