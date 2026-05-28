# WebRTC2 — Todo List & Analyse Architecture

> Analyse effectuée le 17 mai 2026 sur `usePeerOrchestrator` et ses composables connexes.

---

## 🗂️ Vue d'ensemble de l'architecture

```
┌─ Feature Layer (métier) ────────────────────────────────────────────────┐
│  useMediaBroadcast            ← intentions utilisateur (start/stop,     │
│                                 mute/toggle, join → connexions)         │
│                                 expose l'état UI (isMuted, callState…)  │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │ utilise
┌─ Technical Orchestrator ─────────▼──────────────────────────────────────┐
│  usePeerOrchestrator          ← façade unifiée + coordination des       │
│                                 sous-modules ; ne connaît pas l'UI      │
└──┬───────────────┬───────────────┬───────────────┬──────────────────────┘
   │               │               │               │
   ▼               ▼               ▼               ▼
createPeerContext  usePeerCore     usePeerMedia    usePeerConnections    usePeerTransport
état partagé       Signaling       MediaStream     RTCPeerConnection     DataChannel +
(refs, session,    (Reverb /       lifecycle       lifecycle             routage topologie
 media, conn.)     peerId exch.)   (getUserMedia)  (offer/answer/ICE)    (mesh / star / sfu)

┌─ utils/ (infrastructure — usage libre par tous les composables) ────────┐
│  usePeerRetry            ← backoff exponentiel (timer manager générique)│
│  useCallStateMachine     ← machine d'état appel (IDLE → CALLING → …)    │
│  sanitizeMetadata        ← validation des champs `conn.metadata` réseau │
│  payloadSize             ← mesure + garde anti-DoS sur data channels    │
└─────────────────────────────────────────────────────────────────────────┘

webrtc2.config.js   ← constantes partagées (MAX_*, *_TIMEOUT, *_PATTERN…)
EventBus/           ← bus d'événements applicatif (signaling Reverb, UI)
Widgets/            ← composants Vue consommateurs (montés via provider)
```

**Règles de couplage**

- `useMediaBroadcast` n'importe **que** `usePeerOrchestrator` ; il ne touche jamais aux sous-modules ni au `peerStore`.
- `usePeerOrchestrator` est le **seul** à instancier `createPeerContext` et à composer Core / Media / Connections / Transport.
- Les sous-modules (`usePeerCore`, `usePeerMedia`, `usePeerConnections`, `usePeerTransport`) communiquent **uniquement** via le `context` partagé — pas d'imports croisés entre eux.
- `utils/` est l'infra transverse : sans état partagé, importable de partout, jamais l'inverse.

---

## 🟡 P2 — Améliorations (pérennisation long terme)

### createPeerContext

- [x] **`waitForMeReady()` timeout hardcodé (15s)** `[S]` : rendre configurable via options
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

- [ ] **Rate limiting client sur les requêtes Ajax `/ask-to-peer-id`** `[S]` : `usePeerCore` appelle `ENDPOINTS.ASK_TO_PEER_ID` sans throttle côté émission — un mount/unmount rapide ou une boucle de retry peut spammer le backend. Scope distinct du rate limiting hub (`_isHubRateLimited`, qui couvre les enveloppes star data-channel sur identité PeerJS réelle). Pas un vecteur d'attaque (route authentifiée), mais protection contre le spam involontaire

### usePeerTransport

- [ ] **Variables module-level désynchronisées du store** `[M]` : `_peerConsumerCount`, `_peerInitPromise`, `_reconnectAttempts`, `_peerDestroyTimer` vivent dans le module ES et non dans Pinia — en cas de HMR, de reset du store ou de tests unitaires, ces compteurs deviennent incohérents avec l'état du `peerStore` → les déplacer dans le store ou dans une structure partagée initialisée à la création du store. ⚠️ **Contrainte de migration** : `_destroyPeerSingleton` comporte un early return (quand `localPeer` est null après un échec d'init) qui **ne remet volontairement pas `_peerConsumerCount` à 0** — les consommateurs encore montés doivent pouvoir décrémenter normalement pour un retry ; lors de la migration vers Pinia, cette asymétrie doit être préservée (ex : action `resetPeerState({ keepConsumerCount: true })`).
- [ ] **Pas de cleanup explicite des listeners Peer** `[S]` : à la destruction (`_destroyPeerSingleton`), `peer.destroy()` retire les listeners implicitement via PeerJS, mais les handlers `on('connection')`, `on('call')`, `on('disconnected')`, `on('error')`, `on('open')` ne sont jamais retirés explicitement — stocker les handlers et appeler `peer.off()` avant `peer.destroy()` pour ne pas dépendre du comportement interne de PeerJS

### usePeerConnections

- [ ] **`usersInRoom` : sémantique trompeuse (filtrage prématuré)** `[M]` : `connection.usersInRoom` stocke uniquement les *peers distants* (moi filtré à la source dans `_doGetRoomUsersDiff`) — le nom suggère "tous les users de la room" alors qu'il signifie "peers auxquels je dois me connecter" → `allUsersInRoom` n'existe que pour compenser ce filtrage prématuré (aller-retour : liste complète Reverb → retire moi → rajoute moi) ; solution : renommer `connection.usersInRoom` en `connection.remotePeers`, exposer `usersInRoom = [...remotePeers, mySlug]` (liste neutre complète) et appliquer le filtre `!== mySlug` explicitement dans la logique de connexion — supprime `allUsersInRoom` comme computed compensatoire
- [ ] **Migrer `usersInRoom` vers Pinia** `[M]` : `ctx.connection.usersInRoom` est un tableau mutable partagé hors store — le déplacer dans `peerStore` avec une action `computeRoomDiff(newSlugs)` synchrone (lecture + écriture atomique dans le store) — supprime le mutex `_diffLock` devenu inutile et rend la liste réactive dans les composants

### Robustesse

- [ ] **Configurer les constantes** : `MAX_ATTEMPTS`, `STALE_MS`, `STREAM_WAIT_TIMEOUT`, `HUB_RATE_LIMIT` → dans un fichier de config WebRTC2
- [ ] **Graceful degradation eventBus** : si eventBus indisponible, logger au lieu de crash
- [ ] **Cleanup AbortController** : utiliser `AbortController` pour annuler opérations longues à la destruction

---

## 📋 Checklist de refactoring suggérée (ordre d'exécution)

```

Phase 3 — Architecture (P2)           effort / projet
──────────────────────────────────────────────────────
✅  [L]  Unifier les deux systèmes de retry (inviteRetries → usePeerRetry)
□  [L]  Implémenter machine d'état appels (remplace isShuttingDown + isStoppingCall + closingUsers)
□  [L]  Extraire useCallManager() (start/accept/open/stop/reset)
□  [L]  Déplacer routage star dans usePeerTransport (sortir de l'orchestrateur) — inclut le wrapping `onDataReceived` actuellement dans `initializePeerConnection` ; 
        nécessite un middleware/pipeline données dans `createPeerContext` ou un composable `usePeerRouter` dédié
□  [XL] Extraire useStreamManager() avec pool Vue apps
□  [XL] Ajouter tests unitaires sur logique pure extraite
□  [M]  Renommer connection.usersInRoom → remotePeers, inverser le filtre "moi" au niveau de l'usage — supprime allUsersInRoom comme computed compensatoire
□  [M]  Déplacer variables module-level (consumer count, timers) dans peerStore
□  [S]  Cleanup explicite listeners Peer avant peer.destroy()
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