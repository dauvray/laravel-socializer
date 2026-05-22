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
- [✅] **Injection `eventBus` sans fallback** `[S]` : `inject('eventBus')` peut être null
- [✅] **Collision d'ID vidéo non détectée** : deux appels concurrents avec le même `videoId` → état incohérent
- [✅] **Container null = fail silencieux** : `document.querySelector(videoContainer)` retourne null → log + return sans retry
- [✅] **`_bindStreamCleanup()` listeners s'accumulent** `[S]` : `track.ended` / `track.inactive` listeners jamais nettoyés si `removeVideoElement()` échoue
- [✅] **`remoteStreamsMap` sans limite** : `_cleanupStaleRemoteStreams()` dans l'orchestrateur implémente TTL + borne MAX_REMOTE_STREAMS

### usePeerConnections

- [✅] **Race condition `getRoomUsersDiff()`** `[S]` : modifie directement `ctx.connection.usersInRoom` pendant la lecture → diff incohérent entre appels parallèles
- [✅] **Pas de validation stream pour `visio`** `[S]` : `ctx.media.currentStream` peut être null → `peer.call()` avec stream null = comportement indéfini
- [✅] **Anti-pattern polling stream** `[S]` : `while (!localStream && attempts < 25) { await sleep(200) }` → 5s max arbitraire, expiration silencieuse
- [✅] **TOCTOU sur connection state** `[S]` : `connectionState` / `signalingState` peuvent changer entre la vérification et l'utilisation
- [✅] **Pas de limite de connexions par room** `[M]` : WebRTC mesh est raisonnable jusqu'à ~8 peers ; au-delà le navigateur sature — ajouter un guard dans `connectToPeer`
- [✅] **`watch(lastRoomSignal)` non-unsubscribed** `[S]` : listener WebRTC actif après destruction
- [✅] **`_buildPeerConnectionConfig()` sans validation** `[S]` : assume peerId/userSlug non-null/valides

### usePeerTransport

- [✅] **`contextRegistry` global jamais nettoyé** `[S]` : contextes détruits restent en mémoire indefiniment
- [✅] **`context.hooks.onPeerUnavailable` : couplage par mutation implicite** `[M]` : l'orchestrateur pousse un callback sur un objet `hooks` du contexte que `usePeerTransport` appellera plus tard — inversion de dépendance artisanale ; un signal réactif (computed/watch sur le store) ou un eventEmitter interne serait plus explicite
- [✅] **Race condition Peer singleton** `[S]` : `if(peerStore.localPeerReady) return` insuffisant — 2 composants peuvent passer simultanément
- [✅] **Error handler Peer inerte** `[S]` : `localPeer.on('error', ...)` ne fait que logger → pas de fallback, pas de recovery
- [✅] **Auto-reconnect infinie** `[S]` : `localPeer.reconnect()` appelée sans guard → peut boucler si serveur PeerJS down
- [✅] **`forwardStarMessage()` sans rate limiting** `[S]` : hub peut être saturé par rafale de messages (N × targets)
- [✅] **Connexion entrante ignorée silencieusement** `[S]` : si `resolveContextByMetadata()` retourne null, juste un warning

### usePeerRetry

- [✅] **`MAX_ATTEMPTS = 8` hardcodé** `[S]` : configurable via `options.maxAttempts` (défaut 8)
- [✅] **Erreurs callback avalées** `[S]` : si `e.fatal === true`, stop sans retry + notification `onAbandoned`
- [✅] **Pas de validation du callback** `[S]` : guard `typeof executionCallback !== 'function'` en entrée
- [✅] **Pas de notification d'abandon** `[S]` : callback `options.onAbandoned(userSlug, attempt, error?)` appelé à l'épuisement des tentatives

---

## 🟠 P1 — Importants (dégradation progressive / maintenabilité)

### Architecture générale

- [✅] **`waitForMeReady()` : polling `setTimeout` non-réactif** `[S]` : boucle toutes les 100ms sur deux stores jusqu'à 15s — remplacer par un `watch` sur `meStore.getMe?.slug` + `peerStore.localPeer?.id` qui résout la promesse à la première valeur valide
- [✅] **Triple fallback peerId répété 4+ fois** `[S]` : `peerStore.localPeer?.id || peerStore.localPeer?._id || peerStore.lastLocalPeerId` copié-collé dans `usePeerCore`, `usePeerConnections`, `usePeerTransport`, `usePeerOrchestrator` — encapsuler dans un getter `peerStore.localPeerId` (propriété calculée dans le store)
- [✅] **API façade trop large** `[S]` : remplacer `...core, ...media, ...connections, ...transport` par une API explicite minimale
- [✅] **Listeners explosion** `[M]` : 4 `watch()` + multiple `on()` = 40+ listeners actives pour 10 contextes simultanés
- [✅] **Peer singleton global fragile** `[M]` : `peerStore.localPeer` partagé — destruction par un composant = crash des autres

### createPeerContext

- [✅] **`allUsersInRoom` computed : dead code silencieux** `[S]` : `hub` et `others` calculés mais jamais utilisés → retourne `[...usersInRoom, mySlug]` sans exclusion hub, doublon mySlug possible
- [✅] **Flags `__ctx*` mutés sur objets PeerJS tiers** `[S]` : `conn.__ctxListenersBound`, `conn.__ctxCloseHandled`, `conn.__ctxCustomCloseEmitted` — propriétés collées sur des objets que l'on ne possède pas → remplacer par un `WeakSet` interne à `setUpConnectionListeners`
- [✅] **Pas de fallback injection** `[S]` : `inject('eventBus')` échoue silencieusement si non fourni — ajouter un guard défensif

### usePeerOrchestrator

- [✅] **`handleStreamRemoved` : nettoyage en deux passes** `[S]` : suppression par clé exacte (`streamKey`) puis balayage global (`forEach`) — indique que la clé composite n'est pas fiable ; unifier la clé ou utiliser une Map indexée par slug
- [✅] **`openCallBetweenPeer` / `acceptCallFromPeer` : ~15 lignes dupliquées** `[S]` : démarrage stream local, création élément vidéo, mise à jour `currentType`/`currentCallRoomId` présents dans les deux fonctions → extraire `_enterCallSession(payload)`
- [✅] **`stopCallWithPeers()` non-réentrant** `[S]` : `isStoppingCall` flag mais pas protégé contre appels simultanés vrais
- [✅] **Pas de machine d'état pour les appels** `[L]` : états `callInprogress`, `isStoppingCall`, `closingUsers` éparpillés sans transitions claires
- [✅] **`ensureCurrentCallRoomId()` génère avec `Math.random()`** `[S]` : pas cryptographiquement sûr pour un ID de room
- [✅] **`_enterCallSession` : écrasement silencieux de l'ID généré** `[S]` : `ensureCurrentCallRoomId(null)` génère un ID aléatoire, mais la ligne suivante `context.session.currentCallRoomId = room` (room = null) l'écrase immédiatement → l'ID est perdu ; supprimer la ligne redondante et laisser `ensureCurrentCallRoomId` seul gérer l'affectation

### usePeerMedia

- [✅] **`session.isStreaming` / `session.isCapturing` mal placés** `[S]` : portent le commentaire `// a mettre dans media` depuis la création — déplacer dans `media` reactive ou dans `usePeerMedia`
- [✅] **Directive draggable appliquée manuellement** `[S]` : `Draggable.mounted(wrapper)` — fragile, non reactive, peut casser avec les MàJ Vue

### usePeerConnections

- [✅] **`hasOpenConnection()` pas atomique** `[S]` : vérification + utilisation séparées → TOCTOU systématique

### usePeerTransport

- [✅] **`localPeerReady` sémantique trompeuse** `[S]` : le flag est mis à `true` dès le début de `_doInit()`, avant l'événement `open` — il indique "initialisation en cours" et non "peer utilisable" ; toute vérification externe de ce flag est trompeuse → renommer en `localPeerInitializing` ou ne le passer à `true` qu'à la réception de l'événement `open`
- [✅] **Timer de reconnexion orphelin** `[S]` : dans `on('disconnected')`, le `setTimeout` de backoff est créé sans stocker sa référence — si `_destroyPeerSingleton` est appelé pendant le délai, le timer ne peut pas être annulé (seul le guard `peer.destroyed` le protège à l'exécution, mais le timer reste en mémoire jusqu'à expiration) → stocker la référence et l'annuler dans `_destroyPeerSingleton`
- [✅] **`catch` incomplet sur `_peerInitPromise`** `[S]` : si `_doInit()` échoue, `localPeerReady` et `localPeer` sont remis à zéro mais `_peerConsumerCount` reste inchangé — les `onUnmounted` décrémentent correctement, mais `_destroyPeerSingleton` est appelé sur un peer déjà null sans que le compteur reflète l'état réel

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
✅ Ajouter cleanup contextRegistry dans usePeerTransport [S]
✅ Limiter inviteRetries Map (max size + TTL)         [S]
✅ Fix race condition getRoomUsersDiff                [S]
✅ Fix anti-pattern polling stream → watch réactif (usePeerTransport)  [S]
✅ Guard auto-reconnect infinie (usePeerTransport)    [S]

Phase 2 — Robustesse (P1)             effort / done
────────────────────────────────────────────────────
✅ Réduire l'API exposée par usePeerOrchestrator       [S]
✅ Encapsuler triple fallback peerId → peerStore.localPeerId [S]
✅  Remplacer polling waitForMeReady par watch réactif [S]
✅ Corriger allUsersInRoom (dead code + doublon mySlug) [S]
✅ Remplacer flags __ctx* par WeakSet                 [S]
✅ Fix handleStreamRemoved (clé canonique slug+type, passe unique)  [S]
✅ Extraire _enterCallSession (déduplique open/accept) [S]
✅ Ajouter unwatch() sur tous les watch()             [M]
✅  Ajouter guard défensif eventBus fallback dans createPeerContext [S]
✅ Rendre stopCallWithPeers réentrant (try/finally + responsabilité unique) [S]
✅ Centraliser les constantes dans webrtc2.config.js  [S]
✅ Remplacer Math.random() par crypto.randomUUID()    [S]
✅ Ajouter rate limiting dans forwardStarMessage()    [S]
✅ Clarifier sémantique localPeerReady (rename ou déplacer l'affectation) [S]
✅  Stocker et annuler le timer de backoff dans _destroyPeerSingleton [S]
✅ Corriger catch _peerInitPromise (remettre _peerConsumerCount) [S]