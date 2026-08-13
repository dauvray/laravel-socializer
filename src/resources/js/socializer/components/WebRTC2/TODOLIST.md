# WebRTC2 — Todo List & Analyse Architecture

> Analyse effectuée le 17 mai 2026 sur `usePeerOrchestrator` et ses composables connexes.

---

**Règles de couplage** (schéma complet des couches : [CONVENTIONS.md](CONVENTIONS.md))

- `useMediaBroadcast` n'importe **que** `usePeerOrchestrator` ; il ne touche jamais aux sous-modules ni au `peerStore`.
- `usePeerOrchestrator` est le **seul** à instancier `createPeerContext` et à composer les couches.
- Les sous-modules (`usePeerCore`, `usePeerMedia`, `usePeerConnections`, `usePeerTransport`) communiquent **uniquement** via le `context` partagé — pas d'imports croisés entre eux.
- Les couches supérieures (`useConnectionPool`, `useCallManager`, futur `useStreamManager`) reçoivent leurs dépendances **par injection descendante** depuis l'orchestrateur, et **jamais de callback vers une couche supérieure** — sinon le graphe redevient cyclique.
- `utils/` est l'infra transverse : sans état partagé, importable de partout, jamais l'inverse.

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
- [ ] **Séparer SignalingQueue** `[M]` : extraire la gestion des signaux/watchers dans `useSignalingQueue()`
- [ ] **Tests unitaires** `[XL]` : couplage fort à Vue/inject/eventBus rend le code non-testable → extraire logique pure. Débloqué pour les couches extraites (`useCallManager` 62, `useConnectionPool` 31, `usePeerCore` 25, `useStreamManager` 19, `usePeerTransport` 24, `usePeerMedia.players` 15 — 244 au total) ; reste `usePeerConnections`, le reste de `usePeerMedia` (streams), `createPeerContext`

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
