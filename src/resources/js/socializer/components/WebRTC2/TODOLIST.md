# WebRTC2 — Todo List & Analyse Architecture

> Analyse effectuée le 17 mai 2026 sur `usePeerOrchestrator` et ses composables connexes.

---

**Règles de couplage** (schéma complet des couches : [CONVENTIONS.md](CONVENTIONS.md))

- `useMediaBroadcast` n'importe **que** `usePeerOrchestrator` ; il ne touche jamais aux sous-modules ni au `peerStore`.
- `usePeerOrchestrator` est le **seul** à instancier `createPeerContext` et à composer les couches.
- Les sous-modules (`usePeerCore`, `usePeerMedia`, `usePeerConnections`, `usePeerTransport`) communiquent **uniquement** via le `context` partagé — pas d'imports croisés entre eux.
- Les couches supérieures (`useConnectionPool`, `useCallManager`, futur `useStreamManager`) reçoivent leurs dépendances **par injection descendante** depuis l'orchestrateur, et **jamais de callback vers une couche supérieure** — sinon le graphe redevient cyclique.
- `utils/` est l'infra transverse : sans état partagé, importable de partout, jamais l'inverse.
- `useSignalingQueue` détient **seule** le routage des signaux serveur entrants : aucune autre couche ne pose de `watch` sur `ctx.lastRoomSignal` — on expose un verbe et on l'inscrit dans la table `routes` de l'orchestrateur.

---

## 🟡 P2 — Améliorations (pérennisation long terme)

### createPeerContext

- [X] **`waitForMeReady()` timeout hardcodé (15s)** `[S]` : rendre configurable via options
- [X] **`session.closingUsers = new Set()` exposé directement** `[S]` : remplacer par des accesseurs pour éviter la corruption externe
- [X] **`media.videoContainer = '#videoContainer'` hardcodé** `[S]` : injecter via options pour la testabilité

### Architecture

- [X] **Séparer ConnectionPool** `[M]` : `useConnectionPool()` — retry, établissement (`requestOrConnectPeer`), recovery peer-unavailable, `syncUsersConnections`. **Fait en premier, avant CallManager** : sans lui, `useCallManager` aurait reçu un callback `requestOrConnectPeer` vers l'orchestrateur, donc un cycle. Reste à faire dans cette couche : backpressure et limites explicites (`MAX_PEERS_PER_ROOM` n'est appliqué que dans `usePeerConnections`)
- [X] **Séparer CallManager** `[L]` : `useCallManager()` — start/accept/open/stop/reset, room d'appel, retries d'invitation. Propriétaire de la FSM d'appel **sauf** les 2 mutations restées dans les handlers de stream (voir StreamManager)
- [X] **Séparer StreamManager** `[L]` : `useStreamManager()` — registre des flux distants (clé canonique, TTL, éviction FIFO), players des flux distants, départ d'un pair dont la connexion se ferme (⚠️ la **séquence** de départ est depuis remontée au CallManager — cf. « Départ d'un pair » ci-dessous ; il ne reste ici que la résolution du pair depuis `conn.metadata`). Ne touche plus `callMachine` : elle passe par les verbes `markCallConnected` / `isRemoteClosing` / `beginRemoteClosing` / `endRemoteClosing` du CallManager, qui redevient **seul propriétaire de la FSM**
- [X] **Pool d'instances Vue pour les players** `[M]` (2026-08-13) : une seule app hôte par container (`Widgets/Mediaplayer/PlayerHost.vue`) rend un `v-for` sur un registre réactif de slots détenu par `usePeerMedia`. `createVideoElement` = **acquire** (slot libre recyclé, sinon nouveau), `removeVideoElement` = **release** (slot vidé + masqué, instance conservée) → le nombre d'instances montées suit le **pic de flux simultanés**, plus le cumul de la session. Points notables : clé du `v-for` = `slot.key` (identité du slot, pas du `videoId`) sinon aucun recyclage ; le div `wrapper-${videoId}` est conservé car `v-resize` insère son propre wrapper hors virtual DOM ; point de montage en `display: contents` pour que les wrappers restent enfants flex directs de `#videoContainer` ; source de vérité de l'idempotence passée du DOM au registre ; `MediaBroadcastPlayer` réinitialise `nativeMuted` au changement de flux (instance recyclée) ; `destroyPlayers()` (teardown terminal, appelé par `cleanupPeerConnection`) est le seul chemin qui démonte réellement. 15 tests dans `__tests__/usePeerMedia.players.test.js`
- [X] **Départ d'un pair : deux chemins voisins** `[M]` (2026-08-13) : `remoteStopCall` (signal `CloseConnectionToPeerID`) et `useStreamManager.handleStreamRemoved` (fermeture de connexion PeerJS) convergent maintenant vers **`useCallManager.handleRemoteDeparture`** — séquence unique, propriétaire unique. Chaque appelant ne garde que ce qui lui appartient : validation/adaptation du payload de signalisation d'un côté, résolution du pair depuis `conn.metadata` (`_resolveRemoteSlug`, d'où le `waitForMeReady`) de l'autre. La politique est décidée par le **mode courant**, pas par le déclencheur : un seul `isCallMode = currentType !== 'stream'` gouverne à la fois la fermeture de transport et le full stop — c'est ce qui a débloqué la fusion (plus besoin de brancher par transport). **3 bugs corrigés** : (1) `handleStreamRemoved` ne coupait ni les retries ni les connexions du pair parti → sur une coupure brutale (onglet fermé, donc **sans** signal serveur) le `remotePeerId` restait enregistré et `_handleConnectionAttempt` reconnectait un pair déjà parti ; (2) la purge par `entry.metadata.from` ne matchait jamais côté **initiateur** (le flux distant arrive sur ma connexion sortante, dont `metadata.from` porte mon slug) → entrée fantôme dans `remoteStreams` ; désormais filtre sur `entry.remoteSlug` ; (3) purge limitée à la clé `slug-type` → `alice-screen` fuyait quand un pair partageait écran + caméra ; désormais tous les types du pair. **Deltas assumés** (ce n'est pas iso-comportement, d'où le report initial) : `close-call` émis avant le full stop dans les deux cas (l'ordre de la couche streams), garde `currentType !== 'stream'` appliqué aussi au chemin signal, `try/finally` sur les deux chemins (le chemin signal fuyait le garde `closingUsers` sur exception → tout départ ultérieur du pair était avalé), et full stop gardé par `canTransition` (supprime le warn `Transition invalide` du second transport). 12 tests dans `useCallManager.test.js`
- [X] **Nettoyage de la façade** (2026-08-13, avec l'extraction des couches) : retirés de `usePeerOrchestrator` **et** de `useMediaBroadcast` faute d'appelant et parce qu'ils permettaient de désynchroniser l'état — `setCurrentCallUsers`, `addCurrentCallUser`, `removeCurrentCallUser`, `clearCurrentCallUsers` (mutateurs de liste : un ajout sans invite laisse un fantôme que `stopCallWithPeers` notifie dans le vide) et `setCallInProgress` (no-op avec `true`, `callMachine.reset()` sans nettoyage des players avec `false`). Un futur appel de groupe doit passer par un verbe qui envoie l'invitation, pas par un setter de liste. `setCurrentCallRoomId` / `ensureCurrentCallRoomId` sont **conservés** : seul moyen d'imposer l'ID de room d'un appel
- [X] **Séparer SignalingQueue** `[M]` (2026-08-13) : `useSignalingQueue(ctx, { routes })`, instanciée **en dernier** dans l'orchestrateur — elle ne fait que consommer des verbes, donc sa table de routes peut pointer vers n'importe quelle couche sans callback ascendant. La table **remplace `SIGNAL_TYPES` et les deux `switch`** : un seul catalogue de types au lieu de deux sources de vérité (avant, un type listé sans `case` était ignoré en silence, un `case` sans entrée dans `SIGNAL_TYPES` était injoignable). `usePeerCore` et `usePeerConnections` n'observent plus la file ; `usePeerConnections` **n'enregistre plus aucun hook de lifecycle** (import Vue réduit à `markRaw`), donc il devient testable sans `withSetup`. **Périmètre volontairement réduit** : la sémantique de consommation reste `ctx.lastRoomSignal` (dernier signal), pas de drain — voir l'item « Drainer réellement la file de signaux » ci-dessous. **Deltas assumés** : (1) plus de POST `peerId: null` — garde `!getLocalPeerId` dans `responseRemotePeerConnection`, qui retourne désormais un booléen ; (2) `stopSignaling()` appelé **en tête** de `cleanupPeerConnection` — un `PEER_CONNECT_TO_REMOTE_PEER` arrivant pendant le teardown rouvrait une connexion juste après `closePeerConnection` (le watcher ne s'arrêtait qu'à `onUnmounted`) ; (3) type sans handler ou signal sans type → `warn` explicite, signal routé → `console.debug` ; (4) handler qui rejette → `console.error` au lieu d'une unhandled rejection. `roomSignals` a été **supprimé** du contexte (cf. item ci-dessous). 12 tests dans `__tests__/useSignalingQueue.test.js`

  🔥 **Régression corrigée le 2026-08-13 (même journée)** : la première version de `_route` posait deux préconditions **avant** d'appeler le handler — `await ctx.waitForMeReady()` et `if (ctx.isShuttingDown.value) return`. Symptôme : quand A diffusait sa webcam ou partageait son écran, un arrivant B ne voyait **rien**, de façon **intermittente** (le partage d'écran en premier). Cause : le chemin qui porte le média vers un arrivant est **asymétrique** — B, sans flux local, ressort de `connectToPeer` par un `return true` sans rien ouvrir (`usePeerConnections.js:196-203`), c'est donc **A** qui doit appeler `peer.call(B, monStream)`, et **`PEER_CONNECT_TO_REMOTE_PEER` n'est jamais re-livré** par l'émetteur. Un signal abandonné = un flux jamais vu. `waitForMeReady` résout instantanément quand `slug && lastLocalPeerId` sont là, mais attend **15 s puis abandonne** sinon — or `lastLocalPeerId` est remis à `null` par `_destroyPeerSingleton`, déclenché par `_schedulePeerDestroy` dès que le compteur de consommateurs passe à 0 (délai 10 s) : fenêtre atteignable quand plusieurs providers montent/démontent, et systématiquement polluée par le HMR. D'où l'aléatoire. La garde `isShuttingDown` ajoutait un second abandon, **muet**, qui frappait aussi `PEER_CONNECTION_REQUEST` (répondre son propre peerId n'ouvre pourtant aucune connexion) et pouvait rester bloquée à vie (cf. `try/finally` ci-dessous). **Règle qui en découle, désormais dans l'en-tête du composable** : le routage ne pose AUCUNE précondition et n'attend rien — les préconditions appartiennent aux handlers et au moteur de retry, qui savent réessayer, alors qu'un signal abandonné dans le routage l'est définitivement. Le cas `screen` est le plus exposé : `requestRemotePeerConnection` envoie toujours `type: currentType`, **jamais `'screen'`** (`usePeerCore.js:71`), donc la connexion d'écran vers un arrivant n'est ouverte que par le moteur de retry
- [X] **`beginShutdown` sans `endShutdown` sur exception** `[S]` (2026-08-13) : `stopWebcamStream` (`usePeerOrchestrator.js`, appelé aussi par `stopAudioStream`) et `stopCallWithPeers` (`useCallManager.js`) encadraient leur `beginShutdown()` **sans `try/finally`** — une exception dans la fenêtre laissait `shutdownCount` à ≥ 1 pour la vie du contexte. Conséquence pire qu'un simple garde bloqué : `_handleConnectionAttempt` sort par `return true`, ce qui **annule** les retries au lieu de les différer → plus aucune connexion ne se rétablit, silencieusement. Les deux ont maintenant leur `endShutdown()` dans un `finally` (dans `stopCallWithPeers`, `beginShutdown` est remonté juste avant le `try` pour rester symétrique). ⚠️ Asymétrie laissée telle quelle : `stopScreenCapture` ne pose pas le garde du tout
- [X] **`waitForMeReady` : timer de secours jamais annulé** `[S]` (2026-08-13) : `timeoutId` était assigné **après** `scope.run()`, alors que le `watchEffect` s'exécute immédiatement — sur une identité déjà prête, `_resolve(true)` faisait `clearTimeout(null)`, le timer survivait et crachait un faux `waitForMeReady a expiré après 15000 ms` 15 s plus tard sur un contexte sain (plus une fuite de timer par appel). Le `setTimeout` est désormais armé **avant** `scope.run()`
- [ ] **Drainer réellement la file de signaux** `[M]` : aujourd'hui seul `at(-1)` est consommé (`ctx.lastRoomSignal`) — deux signaux dispatchés dans **le même tick** n'en déclenchent qu'un, le premier est perdu. **Volontairement non fait** : la condition de déclenchement est rare (Reverb livre un event par trame WebSocket, donc une tâche de boucle d'événement par signal, et le watcher se redéclenche pour chacun même pendant un `await`) et la machinerie nécessaire (`seq` monotone dans le store, curseur, drain sérialisé, garde de ré-entrance, détection de rewind) ne s'exercerait jamais en prod. **Critère de réévaluation : un signal réellement observé comme perdu.** Trois pièges à connaître avant de s'y remettre : (1) ne pas ré-exposer la file via `computed(() => peerStore.getQueueForRoom(contextId))` — ce computed ne trace que la *clé* `signalQueues[contextId]`, qu'un `push` ne touche pas, donc il n'est jamais invalidé et aucun `watch` ne se déclenche dessus ; c'est pourquoi `roomSignals` n'avait jamais pu être consommé et a été supprimé. Il faut watcher un **scalaire** dérivé de la file (ex. `at(-1)?.seq`) ; (2) `createMockContext._pushSignal` écrit dans `_signalQueue` (un `ref` réassigné, donc réactif par changement d'identité) alors que `getQueueForRoom` lit `_signalQueueRooms` (objet nu, non réactif) — deux structures déconnectées : **tout test de drain serait un faux positif** avant correction du mock ; (3) `dispatchSignal` plafonne la file à **10** par room (`shift()`) : avec une consommation réellement complète et sérialisée (un POST par signal), une room mesh à 8 pairs génère jusqu'à 14 signaux et le plafond évincerait des signaux non encore drainés → à porter dans `webrtc2.config.js` et redimensionner en même temps
- [ ] **Tests unitaires** `[XL]` : couplage fort à Vue/inject/eventBus rend le code non-testable → extraire logique pure. Débloqué pour les couches extraites (`useCallManager` 62, `useConnectionPool` 31, `usePeerCore` 27, `useStreamManager` 19, `usePeerTransport` 24, `usePeerMedia.players` 15, `useSignalingQueue` 12 — 261 au total) ; reste `usePeerConnections` (désormais sans hook de lifecycle, donc appelable directement), le reste de `usePeerMedia` (streams), `createPeerContext`

### Observabilité

- [ ] **Ajouter un logger centralisé** : remplacer les `console.log/warn/error` dispersés par un logger configuré par composable
- [ ] **Exposer un état debug** : readonly computed pour inspecter l'état interne (retries, connections, streams)
- [ ] **Émettre des events structurés** : `peer:connected`, `peer:disconnected`, `call:started`, `call:failed`, etc.

### Sécurité

- [ ] **Rate limiting client sur les requêtes Ajax `/ask-to-peer-id`** `[S]` : `usePeerCore` appelle `ENDPOINTS.ASK_TO_PEER_ID` sans throttle côté émission — un mount/unmount rapide ou une boucle de retry peut spammer le backend. Scope distinct du rate limiting hub (`_isHubRateLimited`, qui couvre les enveloppes star data-channel sur identité PeerJS réelle). Pas un vecteur d'attaque (route authentifiée), mais protection contre le spam involontaire

### usePeerTransport

- [ ] **Variables module-level désynchronisées du store** `[M]` : `_peerConsumerCount`, `_peerInitPromise`, `_reconnectAttempts`, `_peerDestroyTimer` vivent dans le module ES et non dans Pinia — en cas de HMR, de reset du store ou de tests unitaires, ces compteurs deviennent incohérents avec l'état du `peerStore` → les déplacer dans le store ou dans une structure partagée initialisée à la création du store. ⚠️ **Contrainte de migration** : `_destroyPeerSingleton` comporte un early return (quand `localPeer` est null après un échec d'init) qui **ne remet volontairement pas `_peerConsumerCount` à 0** — les consommateurs encore montés doivent pouvoir décrémenter normalement pour un retry ; lors de la migration vers Pinia, cette asymétrie doit être préservée (ex : action `resetPeerState({ keepConsumerCount: true })`).
- [ ] **Pas de cleanup explicite des listeners Peer** `[S]` : à la destruction (`_destroyPeerSingleton`), `peer.destroy()` retire les listeners implicitement via PeerJS, mais les handlers `on('connection')`, `on('call')`, `on('disconnected')`, `on('error')`, `on('open')` ne sont jamais retirés explicitement — stocker les handlers et appeler `peer.off()` avant `peer.destroy()` pour ne pas dépendre du comportement interne de PeerJS

### usePeerConnections

- [ ] **`usersInRoom` : sémantique trompeuse (filtrage prématuré)** `[M]` : `connection.usersInRoom` stocke uniquement les *peers distants* (moi filtré à la source dans `_doGetRoomUsersDiff`) — le nom suggère "tous les users de la room" alors qu'il signifie "peers auxquels je dois me connecter" → `allUsersInRoom` n'existe que pour compenser ce filtrage prématuré (aller-retour : liste complète Reverb → retire moi → rajoute moi) ; solution : renommer `connection.usersInRoom` en `connection.remotePeers`, exposer `usersInRoom = [...remotePeers, mySlug]` (liste neutre complète) et appliquer le filtre `!== mySlug` explicitement dans la logique de connexion — supprime `allUsersInRoom` comme computed compensatoire
- [ ] **Migrer `usersInRoom` vers Pinia** `[M]` : `ctx.connection.usersInRoom` est un tableau mutable partagé hors store — le déplacer dans `peerStore` avec une action `computeRoomDiff(newSlugs)` synchrone (lecture + écriture atomique dans le store) — supprime le mutex `_diffLock` devenu inutile et rend la liste réactive dans les composants

### Robustesse

- [X] **`isShuttingDown` : garde non ré-entrant** `[S]` (2026-08-13) : `lifecycle.isShuttingDown` (booléen) → `lifecycle.shutdownCount` (compteur), `ctx.isShuttingDown` = `count > 0`. Deux arrêts concurrents ne peuvent plus se voler le garde : le premier à finir décrémente sans réautoriser les retries tant que le second est en vol. Les chemins qui appellent `beginShutdown` **sans** `endShutdown` (`cleanupPeerConnection`, `onUnmounted` du pool) gardent leur sémantique de garde permanent *sans code spécial* — un incrément jamais décrémenté maintient `count > 0` à vie. `endShutdown` a un plancher à 0 pour qu'un appel orphelin ne rende pas le compteur négatif. **Fait en prérequis de l'unification des départs de pair** : `handleRemoteDeparture` fait passer le chemin streams par l'arrêt partiel, donc par `begin`/`endShutdown` — avec un booléen, deux départs concurrents (appel à 3+) se volaient le garde
- [ ] **Retry annulé alors qu'aucune connexion n'a été ouverte** `[M]` : `_handleConnectionAttempt` (`useConnectionPool.js`) fait `return true` — donc **annule** le retry, il ne le diffère pas — dès que `connectToPeer` retourne `true`. Or `connectToPeer` retourne `true` **sans rien ouvrir** quand le flux local n'est pas encore valide, pour `stream` (`usePeerConnections.js:196-203`) comme pour `screen` (`:211-215`) — seul `visio` retourne `false` dans ce cas. Conséquence : si le flux n'est pas prêt au moment exact de la tentative, la connexion n'est jamais rouverte. Candidat direct pour un partage d'écran qui « marche une fois sur deux », d'autant que la connexion `screen` vers un arrivant n'est ouverte **que** par ce moteur (cf. l'item SignalingQueue). **Antérieur à l'extraction de SignalingQueue.** Fix naturel : ne considérer la tentative réussie qu'après vérification de `hasOpenConnection`, ou distinguer « rien à envoyer, abandonner » de « pas encore prêt, réessayer » — ça change la sémantique du retry pour tous les types, donc à trancher avec les logs de `useSignalingQueue`/`connectToPeer` sous les yeux, dans un commit séparé
- [ ] **`'audio'` absent de `VALID_CONNECTION_TYPES`** `[S]` : `VALID_CALL_TYPES` (`utils/validators.js`, utilisé par la couche appels) accepte `'audio'`, mais `VALID_CONNECTION_TYPES` (`webrtc2.config.js`, utilisé par `usePeerConnections._buildPeerConnectionConfig` et `sanitizeMetadataType`) non → un appel de type `'audio'` passe la validation d'entrée puis se fait refuser à l'ouverture de connexion. Asymétrie historique, non fusionnée lors de l'extraction (changerait le comportement) : trancher quel jeu de types fait autorité
- [ ] **Configurer les constantes** : `MAX_ATTEMPTS`, `STALE_MS`, `STREAM_WAIT_TIMEOUT`, `HUB_RATE_LIMIT` → dans un fichier de config WebRTC2
- [ ] **Graceful degradation eventBus** : si eventBus indisponible, logger au lieu de crash
- [ ] **Cleanup AbortController** : utiliser `AbortController` pour annuler opérations longues à la destruction

---

## 📋 Checklist de refactoring suggérée (ordre d'exécution)

```

Phase 3 — Architecture (P2)           effort / projet
──────────────────────────────────────────────────────
✅  [L]  Unifier les deux systèmes de retry (inviteRetries → usePeerRetry)
✅  [L]  Implémenter machine d'état appels (remplace callInprogress + isStoppingCall + closingUsers)
✅  [M]  Extraire useConnectionPool() — À FAIRE AVANT CallManager (sinon callback inverse = cycle)
✅  [L]  Extraire useCallManager() (start/accept/open/stop/reset), au-dessus du pool
✅  [L]  Extraire useStreamManager(), au-dessus du CallManager — FSM à propriétaire unique
✅  [M]  Pool d'instances Vue pour les players (app hôte + slots recyclés, dans usePeerMedia)
□  [L]  Déplacer routage star dans usePeerTransport (sortir de l'orchestrateur) — inclut le wrapping `onDataReceived` actuellement dans `initializePeerConnection` ; 
        nécessite un middleware/pipeline données dans `createPeerContext` ou un composable `usePeerRouter` dédié
✅  [S]  isShuttingDown : booléen → compteur (garde ré-entrant) — prérequis du point suivant
✅  [M]  Unifier les deux chemins de départ d'un pair (remoteStopCall / handleStreamRemoved)
✅  [M]  Extraire useSignalingQueue() — table de routes unique, instanciée en dernier (sémantique at(-1) conservée)
□  [XL] Ajouter tests unitaires sur logique pure extraite (fait pour pool + call + stream)
□  [M]  Renommer connection.usersInRoom → remotePeers, inverser le filtre "moi" au niveau de l'usage — supprime allUsersInRoom comme computed compensatoire
□  [M]  Déplacer variables module-level (consumer count, timers) dans peerStore
□  [S]  Cleanup explicite listeners Peer avant peer.destroy()
```

**Ordre imposé** : chaque extraction doit se faire *sous* les couches qui en dépendent, jamais au-dessus. StreamManager après CallManager (il appelle `stopCallWithPeers`), CallManager après ConnectionPool (il appelle `requestOrConnectPeer`). Ce qui reste dans l'orchestrateur (≈245 lignes) : le wrapping des callbacks de connexion (routage star, chaînage des handlers de flux) et les passthroughs média — c'est le périmètre de l'item « routage star » ci-dessus.

---

## 💡 Patterns à adopter

### Injection protective

```javascript
const safeInject = (key, fallback = null) => {
    try {
        return inject(key) ?? fallback
    } catch {
        console.error(`[WebRTC2] inject('${key}') failed`)
        return fallback
    }
}
```

### Lifecycle cleanup manager

```javascript
const lifecycle = {
    watchers: [],
    timers: [],
    onWatch(stop) { this.watchers.push(stop) },
    onTimer(id) { this.timers.push(id) },
    cleanup() {
        this.watchers.forEach(w => w())
        this.timers.forEach(t => clearTimeout(t))
        this.watchers = []
        this.timers = []
    }
}
// Usage: const stop = watch(...); lifecycle.onWatch(stop)
// Destroy: onUnmounted(() => lifecycle.cleanup())
```

### Map avec TTL et limite

```javascript
const createBoundedMap = (maxSize = 1000, ttlMs = 300000) => {
    const map = new Map()
    const add = (key, value) => {
        if (map.size >= maxSize) {
            const oldest = map.keys().next().value
            map.delete(oldest)
        }
        map.set(key, { value, createdAt: Date.now() })
    }
    const get = (key) => {
        const entry = map.get(key)
        if (!entry) return null
        if (Date.now() - entry.createdAt > ttlMs) {
            map.delete(key)
            return null
        }
        return entry.value
    }
    return { add, get, delete: (k) => map.delete(k), clear: () => map.clear() }
}
```

### Machine d'état appel

```javascript
const CALL_STATES = {
    IDLE: 'idle',
    CALLING: 'calling',      // initiateur: attente réponse
    RECEIVING: 'receiving',  // récepteur: invitation reçue
    CONNECTED: 'connected',  // appel actif
    CLOSING: 'closing',      // fermeture en cours
}
// Transitions valides uniquement: IDLE→CALLING, IDLE→RECEIVING, etc.
```

---

*Document généré à partir de l'analyse de `usePeerOrchestrator.js`, `createPeerContext.js`, `usePeerCore.js`, `usePeerMedia.js`, `usePeerConnections.js`, `usePeerTransport.js`, `usePeerRetry.js`*
