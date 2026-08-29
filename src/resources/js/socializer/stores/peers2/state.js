import { markRaw } from 'vue'
import { PEER_PHASES } from '~socializer/stores/peers2/phases.js'

export default () => {
  return {
    lastLocalPeerId: null, // last peer id local
    localPeer: null, // peer local

    // ─── La phase déclarée du Peer singleton ─────────────────────────────────
    // Le SEUL fait déclaré du cycle de vie, et le seul réactif : `localPeer` est
    // `markRaw`, donc ses mutations internes (`_open`, `_disconnected`, `_destroyed`) sont
    // invisibles à Vue. Sans cette phase, un `watchEffect` ne serait jamais réveillé par
    // une reconnexion — c'est ce qui obligeait `waitForMeReady` à s'accrocher à
    // `lastLocalPeerId`, un fait HISTORIQUE, et à répondre « prêt » sur un peer fini.
    //
    // ⚠️ Écrite UNIQUEMENT par les transitions de `actions.js` (`markPeerCreating`,
    // `markPeerOpen`, …), elles-mêmes appelées par le seul `usePeerTransport`. Une
    // affectation directe depuis un composable rouvrirait le problème qu'elle ferme :
    // deux écrivains pour un même fait.
    //
    // Elle remplace `localPeerReady` (un booléen, donc muet sur tout ce qui n'est pas
    // « ouvert ») et l'usage de `peerInitPromise` COMME ÉTAT — cette dernière reste, mais
    // n'est plus qu'un moyen d'attente partagé (cf. plus bas). Elle ne remplace pas
    // `destroyed` / `disconnected`, qui sont observés et gardent le dernier mot.
    peerPhase: PEER_PHASES.ABSENT,

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
    // Init en vol — garde anti-race (2 contextes = 1 seul Peer). ⚠️ Un MOYEN D'ATTENTE,
    // pas un état : « où en est le Peer » se lit sur `peerPhase` ci-dessus. Elle a servi
    // des deux, et c'est ainsi que « pas de peer » a pu être tantôt normal (init en vol)
    // tantôt contradictoire, sans que rien ne distingue les deux.
    peerInitPromise: null,
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

    // ─── Attestation du peerId LOCAL ─────────────────────────────────────────
    // Ce que le serveur a signé pour moi — `{peerId, slug, exp}` — et que je transporte
    // dans la `metadata` de chaque connexion sortante. Un fait du `Peer` singleton, donc
    // ici et pour toutes les raisons de cette section : elle décrit une identité PeerJS
    // précise, et devient fausse à la seconde où le `Peer` est remplacé.
    //
    // ⚠️ `resetPeerState` la vide, contrairement au registre des contextes : une
    // attestation qui survivrait à son `Peer` serait présentée pour un peerId qui n'est
    // plus le nôtre, donc refusée par le vérificateur — un fail-closed silencieux.
    localPeerAttestation: null,
    // La politique du SERVEUR, servie avec l'attestation : le garde d'admission
    // refuse-t-il une admission non corroborée sur le chemin (a) ? Elle ne se compile pas
    // dans le bundle (un `VITE_*` la figerait au build de l'image), et elle vaut `false`
    // tant que le serveur n'a pas parlé — le seul défaut sûr des deux.
    attestationEnforce: false,
    peerAttestationRefreshTimer: null, // handle du rafraîchissement de l'attestation
    peerAttestationAttempts: 0, // tentatives infructueuses consécutives (ATTESTATION_MAX_RETRIES)

    // ─── Attestations VÉRIFIÉES des pairs distants (clé: peerId) ─────────────
    // Valeur : `{ slug, expiresAt }` — le verdict rendu par `/verify-peer-attestation`,
    // mémoïsé jusqu'à ce qu'on ne puisse plus s'y fier.
    //
    // ⚠️⚠️ CE REGISTRE EST DISTINCT DE `remotePeersId`, ET C'EST TOUT LE POINT DE SÉCURITÉ.
    // `remotePeersId` est l'allowlist du chemin (b) de `_isAuthorizedIncomingPeer` : y
    // verser une attestation ferait d'un pair attesté un « interlocuteur d'appel direct
    // vérifié » sans qu'aucun appel n'ait jamais été autorisé — exactement
    // l'auto-inscription que le registre `authorizedCallPeers` a fermée, remise en service
    // par une autre porte. Le précédent est le modèle : un registre distinct du mapping.
    //
    // Lecteurs autorisés, et EUX SEULS : `_resolveSenderSlugFromIncomingConn` (résolution
    // inverse anti-usurpation) et la règle de corroboration de `_isAuthorizedIncomingPeer`.
    // Aucun chemin d'AUTORISATION ne le lit — il ne fait qu'établir QUI est en face, jamais
    // s'il a le droit d'entrer. Épinglé par `peers2Store.attestedPeers.test.js`.
    //
    // ⚠️ Indexé par peerId et non par slug, à l'inverse de `remotePeersId` : le fait décrit
    // est « CETTE identité PeerJS appartient à untel », et c'est le peerId qui est la clé
    // que le récepteur tient en main (`conn.peer`). Une entrée n'est jamais écrasée par un
    // autre slug — un peerId n'a qu'un propriétaire, et le serveur ne signe que pour son
    // porteur authentifié.
    //
    // ⚠️ `markRaw` : Vue proxifie les Map, et ce registre est lu depuis les dispatchers du
    // Peer — mêmes contraintes d'identité que `contextRegistry`.
    //
    // ⚠️ `resetPeerState` NE le vide PAS : les identités des pairs distants ne dépendent
    // pas de la vie de MON `Peer`, exactement comme le registre des contextes. Ce qui les
    // périme est leur propre `expiresAt`.
    attestedPeers: markRaw(new Map()),

    // ─── Ce qui décide de la bascule d'`enforce` — trois compteurs, une décision ─────
    //
    // ⚠️ CES TROIS CHIFFRES SONT LA MOITIÉ CLIENT D'UNE MESURE QUI EN A DEUX. L'autre est le
    // `Log::warning('Attestation de pair refusée')` de `WebRTCController`, et aucune des deux ne
    // suffit : le journal voit TOUS les utilisateurs mais seulement les attestations PRÉSENTÉES ;
    // ceux-ci voient tout ce qui entre, mais dans UN onglet, et meurent au rechargement. La
    // procédure qui les croise est dans `docs/modules/webrtc2/securite.md`. Ils sont rendus par
    // `Widgets/UI/Report/Debug.vue`, et `Debug.attestation.test.js` garde le fait qu'ils y soient.

    // Combien d'admissions entrantes ont été accordées sans que rien ne rattache le peerId au slug
    // déclaré, ET sur lesquelles la question a été TRANCHÉE. Autrement dit : combien de pairs
    // seraient refusés si l'on basculait maintenant. C'est LE chiffre de la décision.
    uncorroboratedAdmissions: 0,
    // SOUS-ENSEMBLE du précédent : ceux qui ne présentaient AUCUNE attestation.
    //
    // ⚠️ C'est l'angle mort du journal serveur, et c'est ce qui interdit de décider depuis le
    // serveur seul : un pair sans attestation n'appelle JAMAIS `/verify-peer-attestation`
    // (`_admitIncoming` court-circuite sur `nothingToAsk`), donc le serveur ne saura jamais qu'il
    // est passé. C'est pourtant le cas MAJORITAIRE de la phase d'observation — l'onglet resté sur un
    // bundle antérieur, celui pour lequel `enforce` est faux — et le seul que le DÉPLOIEMENT fait
    // disparaître, là où le reste appelle une enquête. Le confondre avec une forge ferait prendre la
    // décision inverse.
    unattestedAdmissions: 0,
    // DISJOINT des deux précédents : le serveur n'a pas répondu. Admission fail-open, même sous
    // `enforce` — refuser sur une indisponibilité d'infra ferait d'un incident serveur une coupure
    // de visio non rattrapable, et offrirait le levier correspondant.
    //
    // ⚠️ Hors du compteur de décision — il mesure une panne d'infra, pas la surface du contrôle, et
    // les fondre rendrait le premier illisible le jour où il compte vraiment. Mais compté, et non
    // simplement documenté : un journal serveur vide ne distingue pas « aucun refus » de « aucune
    // requête », et c'est le seul garde-fou contre une bascule décidée sur une mesure qui n'a jamais
    // tourné.
    unverifiableAdmissions: 0,
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

    // Composition des rooms, par contexte (clé: contextId, valeur: string[] de slugs — mon
    // propre slug en est filtré à la source). C'est LA composition, pas une projection :
    // `ctx.connection.remotePeers` n'est qu'un accesseur en lecture seule au-dessus de
    // cette entrée (cf. createPeerContext). Écrit par `computeRoomDiff` — l'écrivain de
    // production unique, appelé par usePeerConnections.getRoomUsersDiff —, semé par
    // `setRoomMembers`, purgé par `clearRoomMembers` à la destruction du contexte.
    //
    // ⚠️ Cette entrée porte DEUX rôles, et le second est de sécurité :
    //   1. « ce pair est-il encore présent quelque part ? », seul prédicat qui autorise à
    //      oublier son peerId (`isUserInAnyRoom` / `removeRemotePeerId`) — un balayage de
    //      TOUS les contextes de l'onglet ;
    //   2. l'allowlist du chemin (a) des DEUX gardes d'autorisation (`isAuthorizedPeer` en
    //      sortie, `_isAuthorizedIncomingPeer` en entrée) — la lecture d'UN seul contexte.
    // Toute politique posée ici touche les deux : une péremption d'entrée pensée pour (1)
    // fermerait silencieusement (2) sur un contexte dont la composition est simplement
    // stable. Une telle politique appartient à la LECTURE de (1), pas à l'entrée.
    //
    // ⚠️ L'écriture est toujours une RÉAFFECTATION du tableau entier, jamais un `push` :
    // un computed qui trace la clé (c'est le cas de tous les lecteurs, via l'accesseur)
    // ne s'invaliderait pas sur une mutation en place. C'est le piège qui avait rendu
    // `roomSignals` inconsommable — il est écrit en entier à `createPeerContext.js`, sur
    // le computed de `lastRoomSignal`.
    roomMembers: {},
    signalQueues: {}, // files d’attente de signaux pour les callbacks de connexions { type-roomId, payload }
    signalSeq: {}, // seq monotone par clé de file (type-room) — jamais réinitialisé, cf. dispatchSignal
    lastSignal: null, // dernier signal reçu (pour debug)
    players: [], // liste des players actifs
  }
}