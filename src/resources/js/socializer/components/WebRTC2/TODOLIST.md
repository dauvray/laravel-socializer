# WebRTC2 — Todo List & Analyse Architecture

> Analyse effectuée le 17 mai 2026 sur `usePeerOrchestrator` et ses composables connexes.

---

## 🗂️ Vue d'ensemble de l'architecture

```
usePeerOrchestrator          ← Coordinateur principal (façade)
├── createPeerContext         ← Context Factory (état partagé)
├── usePeerCore               ← Signaling (Ajax / peerId exchange)
├── usePeerMedia              ← MediaStream lifecycle
├── usePeerConnections        ← WebRTC connections
└── usePeerTransport          ← DataChannel + routage topologie

utils/ (infrastructure — usage libre par tous les composables)
└── usePeerRetry              ← Backoff exponentiel (timer manager générique)
```

---

## 🔴 P0 — Critiques (bugs actifs / stabilité immédiate)

> **Critère P0 strict** : la fonctionnalité plante ou corrompt des données en production aujourd'hui, sans manipulation particulière.  
> Effort : `[S]` = quelques heures · `[M]` = 1–2 j · `[L]` = 3–5 j · `[XL]` = > 1 semaine

### usePeerOrchestrator

- [✅] **Race condition `resolveRemoteSlug`** : lit `context.meStore.getMe?.slug` qui peut être null → retourne le slug local → `removeCurrentCallUser(remote)` échoue → cleanup jamais déclenché
- [✅] **`openCallBetweenPeer` : pas de return après refus** : si `!payload.status`, le flux continue (addCurrentCallUser, startCurrentStream, connect) même quand l'appel est refusé
- [✅] **État mutable non-réactif** : `let isShuttingDown = false` et `let syncUsersConnectionsLock = false` — pas accessible/monitorable, race condition masquée
- [✅] **API publique surexposée** : `...core, ...media, ...connections, ...transport` expose tous les internals → contrat instable, refactorisation cassée
- [✅] **Pas de validation des inputs** : `userSlug`, `payload`, `room`, `type` jamais validés → crashes silencieuses
- [✅] **Memory leaks** : `remoteStreamsMap` grandit sans limite, listeners `eventBus.$emit()` jamais nettoyés
- [✅] **`cleanupPeerConnection()` réinitialise `isShuttingDown = false`** immédiatement après cleanup → retries peuvent relancer avant la fin réelle

### createPeerContext

- [✅] **`setUpConnectionListeners()` sans cleanup** `[M]` : appelée partout, jamais de unsub → listener explosion avec plusieurs contextes actifs
- [✅] **Pas de cleanup du contexte** `[M]` : aucun hook de destruction → stores / computed / watchers restent actifs après unmount

> ⬇️ Items suivants re-classés : ne causent pas de crash immédiat — voir P1/P2.

### usePeerCore

- [✅] **Memory leak Map sans limite** `[S]` : `inviteRetries` et `userSlugToInviteId` grandissent indéfiniment — aucun TTL, aucune limite de taille
- [✅] **Pas de `onUnmounted()`** `[S]` : les timers d'invitation restent actifs après destruction du composant
- [✅] **Ajax calls non-awaited** `[S]` : `AjaxService.load()` lancée sans `await` → état inconsistant si réponse arrive après nettoyage
- [✅] **`watch(ctx.lastRoomSignal, ...)` non-unsubscribed** `[S]` : watcher actif pour toujours même après destruction
- [✅] **Double système de retry invitation** `[M]` : `requestAuthorizationRemotePeerId` gère son propre backoff (`inviteRetries` Map + timers) en parallèle de `usePeerRetry` — même problème, deux solutions — à unifier via `usePeerRetry` avec un callback dédié
- [✅] **Endpoints HTTP hardcodés** `[S]` : `/ask-to-peer-id`, `/response-to-peer-id`, etc. — cassable à la refacto backend
- [✅] **Pas d'error handling HTTP** `[S]` : si un POST échoue, l'appel reste en "attente" indéfiniment

### usePeerMedia

- [✅] **`createApp()` par vidéo sans cleanup** : chaque `createVideoElement()` crée une instance Vue orpheline → fuite mémoire massive sur appels longs
- [ ] **Injection `eventBus` sans fallback** `[S]` : `inject('eventBus')` peut être null
- [✅] **Collision d'ID vidéo non détectée** : deux appels concurrents avec le même `videoId` → état incohérent
- [✅] **Container null = fail silencieux** : `document.querySelector(videoContainer)` retourne null → log + return sans retry
- [ ] **`_bindStreamCleanup()` listeners s'accumulent** `[S]` : `track.ended` / `track.inactive` listeners jamais nettoyés si `removeVideoElement()` échoue
- [✅] **`remoteStreamsMap` sans limite** : `_cleanupStaleRemoteStreams()` dans l'orchestrateur implémente TTL + borne MAX_REMOTE_STREAMS

### usePeerConnections

- [✅] **Race condition `getRoomUsersDiff()`** `[S]` : modifie directement `ctx.connection.usersInRoom` pendant la lecture → diff incohérent entre appels parallèles
- [ ] **Pas de validation stream pour `visio`** `[S]` : `ctx.media.currentStream` peut être null → `peer.call()` avec stream null = comportement indéfini
- [ ] **Anti-pattern polling stream** `[S]` : `while (!localStream && attempts < 25) { await sleep(200) }` → 5s max arbitraire, expiration silencieuse
- [ ] **TOCTOU sur connection state** `[S]` : `connectionState` / `signalingState` peuvent changer entre la vérification et l'utilisation
- [ ] **Pas de limite de connexions par room** `[M]` : WebRTC mesh est raisonnable jusqu'à ~8 peers ; au-delà le navigateur sature — ajouter un guard dans `connectToPeer`
- [ ] **`watch(lastRoomSignal)` non-unsubscribed** `[S]` : listener WebRTC actif après destruction
- [ ] **`_buildPeerConnectionConfig()` sans validation** `[S]` : assume peerId/userSlug non-null/valides

### usePeerTransport

- [ ] **`contextRegistry` global jamais nettoyé** `[S]` : contextes détruits restent en mémoire indefiniment
- [ ] **`context.hooks.onPeerUnavailable` : couplage par mutation implicite** `[M]` : l'orchestrateur pousse un callback sur un objet `hooks` du contexte que `usePeerTransport` appellera plus tard — inversion de dépendance artisanale ; un signal réactif (computed/watch sur le store) ou un eventEmitter interne serait plus explicite
- [ ] **Race condition Peer singleton** `[S]` : `if(peerStore.localPeerReady) return` insuffisant — 2 composants peuvent passer simultanément
- [ ] **Error handler Peer inerte** `[S]` : `localPeer.on('error', ...)` ne fait que logger → pas de fallback, pas de recovery
- [ ] **Auto-reconnect infinie** `[S]` : `localPeer.reconnect()` appelée sans guard → peut boucler si serveur PeerJS down
- [ ] **`forwardStarMessage()` sans rate limiting** `[S]` : hub peut être saturé par rafale de messages (N × targets)
- [ ] **Connexion entrante ignorée silencieusement** `[S]` : si `resolveContextByMetadata()` retourne null, juste un warning

### usePeerRetry

- [ ] **`MAX_ATTEMPTS = 8` hardcodé** `[S]` : ~6 min max, puis abandon silencieux sans notification upstream
- [ ] **Erreurs callback avalées** `[S]` : `catch(e) { console.error; scheduleRetry() }` — on retente même si l'erreur est fatale
- [ ] **Pas de validation du callback** `[S]` : `executionCallback` non-vérifiée → crash async si undefined passé
- [ ] **Pas de notification d'abandon** `[S]` : quand `MAX_ATTEMPTS` atteint, aucun événement émis → couches supérieures ne savent pas

---

## 🟠 P1 — Importants (dégradation progressive / maintenabilité)

### Architecture générale

- [ ] **`waitForMeReady()` : polling `setTimeout` non-réactif** `[S]` : boucle toutes les 100ms sur deux stores jusqu'à 15s — remplacer par un `watch` sur `meStore.getMe?.slug` + `peerStore.localPeer?.id` qui résout la promesse à la première valeur valide
- [ ] **Triple fallback peerId répété 4+ fois** `[S]` : `peerStore.localPeer?.id || peerStore.localPeer?._id || peerStore.lastLocalPeerId` copié-collé dans `usePeerCore`, `usePeerConnections`, `usePeerTransport`, `usePeerOrchestrator` — encapsuler dans un getter `peerStore.localPeerId` (propriété calculée dans le store)
- [ ] **API façade trop large** `[S]` : remplacer `...core, ...media, ...connections, ...transport` par une API explicite minimale
- [ ] **Listeners explosion** `[M]` : 4 `watch()` + multiple `on()` = 40+ listeners actives pour 10 contextes simultanés
- [ ] **Peer singleton global fragile** `[M]` : `peerStore.localPeer` partagé — destruction par un composant = crash des autres

### createPeerContext

- [ ] **`allUsersInRoom` computed : dead code silencieux** `[S]` : `hub` et `others` calculés mais jamais utilisés → retourne `[...usersInRoom, mySlug]` sans exclusion hub, doublon mySlug possible
- [✅] **Flags `__ctx*` mutés sur objets PeerJS tiers** `[S]` : `conn.__ctxListenersBound`, `conn.__ctxCloseHandled`, `conn.__ctxCustomCloseEmitted` — propriétés collées sur des objets que l'on ne possède pas → remplacer par un `WeakSet` interne à `setUpConnectionListeners`
- [ ] **Pas de fallback injection** `[S]` : `inject('eventBus')` échoue silencieusement si non fourni — ajouter un guard défensif

### usePeerOrchestrator

- [ ] **`handleStreamRemoved` : nettoyage en deux passes** `[S]` : suppression par clé exacte (`streamKey`) puis balayage global (`forEach`) — indique que la clé composite n'est pas fiable ; unifier la clé ou utiliser une Map indexée par slug
- [ ] **`openCallBetweenPeer` / `acceptCallFromPeer` : ~15 lignes dupliquées** `[S]` : démarrage stream local, création élément vidéo, mise à jour `currentType`/`currentCallRoomId` présents dans les deux fonctions → extraire `_enterCallSession(payload)`
- [ ] **Wrapping `onDataReceived` dans l'orchestrateur** `[M]` : la responsabilité du routage star (intercepter `__starRoute`) est dans `initializePeerConnection` faute d'une couche dédiée → appartient à `usePeerTransport` ou à un futur `usePeerRouter`
- [ ] **`stopCallWithPeers()` non-réentrant** `[S]` : `isStoppingCall` flag mais pas protégé contre appels simultanés vrais
- [ ] **Pas de machine d'état pour les appels** `[L]` : états `callInprogress`, `isStoppingCall`, `closingUsers` éparpillés sans transitions claires
- [ ] **`ensureCurrentCallRoomId()` génère avec `Math.random()`** `[S]` : pas cryptographiquement sûr pour un ID de room

### usePeerMedia

- [ ] **`session.isStreaming` / `session.isCapturing` mal placés** `[S]` : portent le commentaire `// a mettre dans media` depuis la création — déplacer dans `media` reactive ou dans `usePeerMedia`
- [ ] **Directive draggable appliquée manuellement** `[S]` : `Draggable.mounted(wrapper)` — fragile, non reactive, peut casser avec les MàJ Vue

### usePeerConnections

- [ ] **`hasOpenConnection()` pas atomique** `[S]` : vérification + utilisation séparées → TOCTOU systématique

---

## 🟡 P2 — Améliorations (pérennisation long terme)

### createPeerContext

- [ ] **`waitForMeReady()` timeout hardcodé (15s)** `[S]` : rendre configurable via options
- [ ] **`session.closingUsers = new Set()` exposé directement** `[S]` : remplacer par des accesseurs pour éviter la corruption externe
- [ ] **`media.videoContainer = '#videoContainer'` hardcodé** `[S]` : injecter via options pour la testabilité

### Architecture

- [ ] **Séparer CallManager** `[L]` : extraire toute la logique appels (start/accept/stop/reset) dans un composable dédié `useCallManager()`
- [ ] **Séparer StreamManager** `[L]` : extraire lifecycle vidéo dans `useStreamManager()` avec pool d'instances Vue
- [ ] **Séparer SignalingQueue** `[M]` : extraire la gestion des signaux/watchers dans `useSignalingQueue()`
- [ ] **Séparer ConnectionPool** `[M]` : extraire backpressure et limites dans `useConnectionPool()`
- [ ] **Tests unitaires** `[XL]` : couplage fort à Vue/inject/eventBus rend le code non-testable → extraire logique pure

### Observabilité

- [ ] **Ajouter un logger centralisé** : remplacer les `console.log/warn/error` dispersés par un logger configuré par composable
- [ ] **Exposer un état debug** : readonly computed pour inspecter l'état interne (retries, connections, streams)
- [ ] **Émettre des events structurés** : `peer:connected`, `peer:disconnected`, `call:started`, `call:failed`, etc.

### Sécurité

- [ ] **Valider tous les slugs entrants** : `userSlug` d'un peer distant peut être forgé — valider format/longueur
- [ ] **Rate limiting local** : limiter les requêtes Ajax (ask-to-peer-id) pour éviter le spam involontaire
- [ ] **Sanitiser les métadonnées** : `conn.metadata` vient du réseau → valider avant usage

### usePeerConnections

- [ ] **Migrer `usersInRoom` vers Pinia** `[M]` : `ctx.connection.usersInRoom` est un tableau mutable partagé hors store — le déplacer dans `peerStore` avec une action `computeRoomDiff(newSlugs)` synchrone (lecture + écriture atomique dans le store) — supprime le mutex `_diffLock` devenu inutile et rend la liste réactive dans les composants

### Robustesse

- [ ] **Configurer les constantes** : `MAX_ATTEMPTS`, `STALE_MS`, `STREAM_WAIT_TIMEOUT`, `HUB_RATE_LIMIT` → dans un fichier de config WebRTC2
- [ ] **Graceful degradation eventBus** : si eventBus indisponible, logger au lieu de crash
- [ ] **Cleanup AbortController** : utiliser `AbortController` pour annuler opérations longues à la destruction

---

## 📋 Checklist de refactoring suggérée (ordre d'exécution)

```
Phase 1 — Stabilisation (P0)          effort / done
────────────────────────────────────────────────────
✅ Fix resolveRemoteSlug (guard mySlug null)           [S]
✅ Fix openCallBetweenPeer (return après !status)      [S]
✅ Fix createApp leak dans usePeerMedia                [S]
✅ Validation inputs (userSlug, payload, room, type)   [S]
✅ Ajouter setUpConnectionListeners cleanup (unsub)   [M]
✅ Ajouter cleanup du contexte (onUnmounted)          [M]
✅ Ajouter onUnmounted() dans usePeerCore             [S]
□  Ajouter cleanup contextRegistry dans usePeerTransport [S]
✅ Limiter inviteRetries Map (max size + TTL)         [S]
✅ Fix race condition getRoomUsersDiff                [S]
□  Ajouter validation stream avant peer.call() visio  [S]
□  Guard auto-reconnect infinie (usePeerTransport)    [S]

Phase 2 — Robustesse (P1)             effort / done
────────────────────────────────────────────────────
✅ Réduire l'API exposée par usePeerOrchestrator       [S]
□  Encapsuler triple fallback peerId → peerStore.localPeerId [S]
□  Remplacer polling waitForMeReady par watch réactif [S]
□  Corriger allUsersInRoom (dead code + doublon mySlug) [S]
✅ Remplacer flags __ctx* par WeakSet                 [S]
□  Extraire _enterCallSession (déduplique open/accept) [S]
□  Ajouter unwatch() sur tous les watch()             [M]
□  Centraliser les constantes dans webrtc2.config.js  [S]
□  Remplacer Math.random() par crypto.randomUUID()    [S]
□  Ajouter rate limiting dans forwardStarMessage()    [S]

Phase 3 — Architecture (P2)           effort / projet
──────────────────────────────────────────────────────
✅  [L]  Unifier les deux systèmes de retry (inviteRetries → usePeerRetry)
□  [L]  Implémenter machine d'état appels (remplace isShuttingDown + isStoppingCall + closingUsers)
□  [L]  Extraire useCallManager() (start/accept/open/stop/reset)
□  [L]  Déplacer routage star dans usePeerTransport (sortir de l'orchestrateur)
□  [XL] Extraire useStreamManager() avec pool Vue apps
□  [XL] Ajouter tests unitaires sur logique pure extraite
```

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