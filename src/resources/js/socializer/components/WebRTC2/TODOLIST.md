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
├── usePeerTransport          ← DataChannel + routage topologie
└── usePeerRetry              ← Backoff exponentiel
```

---

## 🔴 P0 — Critiques (bugs actifs / stabilité immédiate)

### usePeerOrchestrator

- [✅] **Race condition `resolveRemoteSlug`** : lit `context.meStore.getMe?.slug` qui peut être null → retourne le slug local → `removeCurrentCallUser(remote)` échoue → cleanup jamais déclenché
- [✅] **`openCallBetweenPeer` : pas de return après refus** : si `!payload.status`, le flux continue (addCurrentCallUser, startCurrentStream, connect) même quand l'appel est refusé
- [✅] **État mutable non-réactif** : `let isShuttingDown = false` et `let syncUsersConnectionsLock = false` — pas accessible/monitorable, race condition masquée
- [✅] **API publique surexposée** : `...core, ...media, ...connections, ...transport` expose tous les internals → contrat instable, refactorisation cassée
- [✅] **Pas de validation des inputs** : `userSlug`, `payload`, `room`, `type` jamais validés → crashes silencieuses
- [✅] **Memory leaks** : `remoteStreamsMap` grandit sans limite, listeners `eventBus.$emit()` jamais nettoyés
- [ ] **`cleanupPeerConnection()` réinitialise `isShuttingDown = false`** immédiatement après cleanup → retries peuvent relancer avant la fin réelle

### createPeerContext

- [ ] **Pas de fallback injection** : `inject('eventBus')` échoue silencieusement si non fourni
- [ ] **`setUpConnectionListeners()` sans cleanup** : appelée partout, jamais de unsub → listener explosion avec plusieurs contextes actifs
- [ ] **`waitForMeReady()` timeout hardcodé (15s)** : pas configurable, peut expirer trop tôt ou trop tard
- [ ] **Pas de cleanup du contexte** : aucun hook de destruction → stores / computed / watchers restent actifs après unmount
- [ ] **`session.closingUsers = new Set()`** : état mutable exposé directement, n'importe quel module peut le corrompre
- [ ] **`media.videoContainer = '#videoContainer'` hardcodé** : dépendance au HTML global, non testable

### usePeerCore

- [ ] **Memory leak Map sans limite** : `inviteRetries` et `userSlugToInviteId` grandissent indéfiniment — aucun TTL, aucune limite de taille
- [ ] **Pas de `onUnmounted()`** : les timers d'invitation restent actifs après destruction du composant
- [ ] **Ajax calls non-awaited** : `AjaxService.load()` lancée sans `await` → état inconsistant si réponse arrive après nettoyage
- [ ] **`watch(ctx.lastRoomSignal, ...)` non-unsubscribed** : watcher actif pour toujours même après destruction
- [ ] **Endpoints HTTP hardcodés** : `/ask-to-peer-id`, `/response-to-peer-id`, etc. — cassable à la refacto backend
- [ ] **Pas d'error handling HTTP** : si un POST échoue, l'appel reste en "attente" indéfiniment

### usePeerMedia

- [ ] **`createApp()` par vidéo sans cleanup** : chaque `createVideoElement()` crée une instance Vue orpheline → fuite mémoire massive sur appels longs
- [ ] **Injection `eventBus` sans fallback** : `inject('eventBus')` peut être null
- [ ] **Collision d'ID vidéo non détectée** : deux appels concurrents avec le même `videoId` → état incohérent
- [ ] **Container null = fail silencieux** : `document.querySelector(videoContainer)` retourne null → log + return sans retry
- [ ] **`_bindStreamCleanup()` listeners s'accumulent** : `track.ended` / `track.inactive` listeners jamais nettoyés si `removeVideoElement()` échoue
- [ ] **`remoteStreamsMap` sans limite** : peut contenir des centaines d'entrées stales

### usePeerConnections

- [ ] **Race condition `getRoomUsersDiff()`** : modifie directement `ctx.connection.usersInRoom` pendant la lecture → diff incohérent entre appels parallèles
- [ ] **Pas de validation stream pour `visio`** : `ctx.media.currentStream` peut être null → `peer.call()` avec stream null = comportement indéfini
- [ ] **Anti-pattern polling stream** : `while (!localStream && attempts < 25) { await sleep(200) }` → 5s max arbitraire, expiration silencieuse
- [ ] **TOCTOU sur connection state** : `connectionState` / `signalingState` peuvent changer entre la vérification et l'utilisation
- [ ] **Pas de limite de connexions par room** : 1000 users = 1000 connexions WebRTC = crash navigateur
- [ ] **`watch(lastRoomSignal)` non-unsubscribed** : listener WebRTC actif après destruction
- [ ] **`_buildPeerConnectionConfig()` sans validation** : assume peerId/userSlug non-null/valides

### usePeerTransport

- [ ] **`contextRegistry` global jamais nettoyé** : contextes détruits restent en mémoire indefiniment
- [ ] **Race condition Peer singleton** : `if(peerStore.localPeerReady) return` insuffisant — 2 composants peuvent passer simultanément
- [ ] **Error handler Peer inerte** : `localPeer.on('error', ...)` ne fait que logger → pas de fallback, pas de recovery
- [ ] **Auto-reconnect infinie** : `localPeer.reconnect()` appelée sans guard → peut boucler si serveur PeerJS down
- [ ] **`forwardStarMessage()` sans rate limiting** : hub peut être saturé par rafale de messages (N × targets)
- [ ] **Connexion entrante ignorée silencieusement** : si `resolveContextByMetadata()` retourne null, juste un warning

### usePeerRetry

- [ ] **`MAX_ATTEMPTS = 8` hardcodé** : ~6 min max, puis abandon silencieux sans notification upstream
- [ ] **Erreurs callback avalées** : `catch(e) { console.error; scheduleRetry() }` — on retente même si l'erreur est fatale
- [ ] **Pas de validation du callback** : `executionCallback` non-vérifiée → crash async si undefined passé
- [ ] **Pas de notification d'abandon** : quand `MAX_ATTEMPTS` atteint, aucun événement émis → couches supérieures ne savent pas

---

## 🟠 P1 — Importants (dégradation progressive / maintenabilité)

### Architecture générale

- [ ] **API façade trop large** : remplacer `...core, ...media, ...connections, ...transport` par une API explicite minimale
- [ ] **Listeners explosion** : 4 `watch()` + multiple `on()` = 40+ listeners actives pour 10 contextes simultanés
- [ ] **Peer singleton global fragile** : `peerStore.localPeer` partagé — destruction par un composant = crash des autres

### usePeerOrchestrator

- [ ] **`stopCallWithPeers()` non-réentrant** : `isStoppingCall` flag mais pas protégé contre appels simultanés vrais
- [ ] **Pas de machine d'état pour les appels** : états `callInprogress`, `isStoppingCall`, `closingUsers` éparpillés sans transitions claires
- [ ] **`ensureCurrentCallRoomId()` génère avec `Math.random()`** : pas cryptographiquement sûr pour un ID de room

### usePeerCore

- [ ] **Deux systèmes de retry parallèles** : `inviteRetries` (Core) + `usePeerRetry` (Orchestrateur) — logiques dupliquées

### usePeerMedia

- [ ] **Directive draggable appliquée manuellement** : `Draggable.mounted(wrapper)` — fragile, non reactive, peut casser avec les MàJ Vue

### usePeerConnections

- [ ] **`hasOpenConnection()` pas atomique** : vérification + utilisation séparées → TOCTOU systématique

---

## 🟡 P2 — Améliorations (pérennisation long terme)

### Architecture

- [ ] **Séparer CallManager** : extraire toute la logique appels (start/accept/stop/reset) dans un composable dédié `useCallManager()`
- [ ] **Séparer StreamManager** : extraire lifecycle vidéo dans `useStreamManager()` avec pool d'instances Vue
- [ ] **Séparer SignalingQueue** : extraire la gestion des signaux/watchers dans `useSignalingQueue()`
- [ ] **Séparer ConnectionPool** : extraire backpressure et limites dans `useConnectionPool()`
- [ ] **Tests unitaires** : couplage fort à Vue/inject/eventBus rend le code non-testable → extraire logique pure

### Observabilité

- [ ] **Ajouter un logger centralisé** : remplacer les `console.log/warn/error` dispersés par un logger configuré par composable
- [ ] **Exposer un état debug** : readonly computed pour inspecter l'état interne (retries, connections, streams)
- [ ] **Émettre des events structurés** : `peer:connected`, `peer:disconnected`, `call:started`, `call:failed`, etc.

### Sécurité

- [ ] **Valider tous les slugs entrants** : `userSlug` d'un peer distant peut être forgé — valider format/longueur
- [ ] **Rate limiting local** : limiter les requêtes Ajax (ask-to-peer-id) pour éviter le spam involontaire
- [ ] **Sanitiser les métadonnées** : `conn.metadata` vient du réseau → valider avant usage

### Robustesse

- [ ] **Configurer les constantes** : `MAX_ATTEMPTS`, `STALE_MS`, `STREAM_WAIT_TIMEOUT`, `HUB_RATE_LIMIT` → dans un fichier de config WebRTC2
- [ ] **Graceful degradation eventBus** : si eventBus indisponible, logger au lieu de crash
- [ ] **Cleanup AbortController** : utiliser `AbortController` pour annuler opérations longues à la destruction

---

## 📋 Checklist de refactoring suggérée (ordre d'exécution)

```
Phase 1 — Stabilisation (P0)
────────────────────────────
□ Fix resolveRemoteSlug (guard mySlug null)
□ Fix openCallBetweenPeer (return après !status)
□ Ajouter fallbacks inject('eventBus') partout
□ Ajouter onUnmounted() dans usePeerCore
□ Ajouter cleanup contextRegistry dans usePeerTransport
□ Limiter inviteRetries Map (max size + TTL)
□ Ajouter validation inputs (userSlug, payload)
□ Fix createApp leak dans usePeerMedia (unmount à removeVideoElement)
□ Fix race condition getRoomUsersDiff (copie locale avant mutation)
□ Ajouter validation stream avant peer.call() visio

Phase 2 — Robustesse (P1)
──────────────────────────
□ Ajouter unwatch() sur tous les watch()
□ Centraliser les constantes dans webrtc2.config.js
□ Remplacer Math.random() par crypto.randomUUID() pour room IDs
□ Ajouter rate limiting dans forwardStarMessage()
□ Réduire l'API exposée par usePeerOrchestrator ✅

Phase 3 — Architecture (P2)
────────────────────────────
□ Extraire useCallManager()
□ Extraire useStreamManager() avec pool Vue apps
□ Extraire useSignalingQueue()
□ Implémenter machine d'état explicite pour les appels
□ Ajouter logger centralisé
□ Ajouter tests unitaires sur logique pure extraite
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