# WebRTC2 — Plan de tests unitaires

> Infrastructure : vitest 2.1.9 · @vue/test-utils · happy-dom  
> Helpers : `withSetup`, `createMockContext`, `mockEventBus`, `__mocks__/peerjs.js`  
> Commande : `npm run test:run`

---

## ✅ Déjà réalisé

> Décomptes vérifiés par `npx vitest run --reporter=dot` le **2026-08-13** : **377 tests WebRTC2**
> sur 16 fichiers, ~1,5 s. Les chiffres de ce document avaient divergé du réel — ne pas les
> mettre à jour de mémoire, les relire dans la sortie du runner.

- [x] **Infrastructure** : `vitest.config.js`, `setup.js` (mocks globaux : mediaDevices, RTCPeerConnection, crypto, Pinia)
- [x] **`utils/useCallStateMachine.test.js`** — 36 tests : transitions FSM, computed dérivés, reset(), closingUsers
- [x] **`utils/usePeerRetry.test.js`** — 15 tests : scheduleRetry, clearRetry, clearAll, fake timers, erreurs fatales, cleanup onUnmounted
- [x] **`utils/payloadSize.test.js`** — 12 tests · **`utils/sanitizeMetadata.test.js`** — 5 tests
- [-] **`usePeerCore.test.js`** — 27 tests (partiel) : requestRemotePeerConnection, responseRemotePeerConnection, requestAuthorizationRemotePeerId (inclut MAX_INVITE_RETRIES), sendAuthorizationRemotePeerId

---

## 📋 Prochaines tâches (une conversation par tâche)

### Ordre recommandé

```
Tâche 1 → usePeerCore          (Ajax + signaling pur)               ◐ 4/9 items
Tâche 2 → usePeerConnections   (connexions PeerJS factices)         ✅
Tâche 3 → usePeerMedia         (DOM + MediaStream)                  ✅ (.players + .streams)
Tâche 4 → usePeerTransport     (singleton Peer + DataChannel)       ◐ sécurité seule
Tâche 5 → createPeerContext    (context factory + lifecycle)        ✅
Tâche 6 → usePeerOrchestrator  (intégration composition)            ⛔ bloquée — voir ci-dessous
Tâche 7 → useMediaBroadcast    (intégration feature layer)
```

⛔ **La tâche 6 est volontairement bloquée** : le wrapping du routage star qu'elle doit couvrir
est justement ce que la TODOLIST prévoit de *déplacer* dans `usePeerTransport` (item `[L]`,
ouvert). Écrire ces tests avant le déménagement revient à les jeter. Reprendre la tâche 6 —
puis la 7 — **après** cet item.

Les couches extraites de l'orchestrateur (`useConnectionPool`, `useCallManager`,
`useStreamManager`, `useSignalingQueue`) se testent avec des mocks `vi.fn()` pour les
dépendances injectées — c'est tout l'intérêt de l'injection descendante. `useCallManager` et
`useStreamManager` n'enregistrent aucun hook de lifecycle : ils s'appellent
directement, **sans** `withSetup` ; `useConnectionPool` et `useSignalingQueue` posent un
`watch` + un `onUnmounted`, donc `withSetup` est obligatoire pour eux. Ce qui reste à couvrir en tâche 6 :
`initializePeerConnection` (wrapping star + chaînage des handlers de flux) et les
passthroughs média — soit ~245 lignes.

---

### Avancement

- [x] Infrastructure (vitest.config.js, setup.js, helpers, mocks)
- [x] `utils/useCallStateMachine.test.js` — 36 tests ✅
- [x] `utils/usePeerRetry.test.js` — 15 tests ✅
- [-] Tâche 1 — `usePeerCore.test.js` — 27 tests ✅ (4/9 items couverts, 5 restants)
- [x] Tâche 2 — `usePeerConnections.test.js` — 47 tests ✅ (voir ci-dessous)
- [-] Tâche 3 — `usePeerMedia` — 34 tests ✅ répartis en deux fichiers : `.players` 15 (pool d'instances) + `.streams` 19 (flux locaux). Périmètre couvert
- [-] Tâche 4 — `usePeerTransport.*.test.js` — 24 tests ✅ (sécurité couverte ; singleton/lifecycle/reconnect restants)
- [x] Tâche 5 — `createPeerContext.test.js` — 46 tests ✅ (voir ci-dessous)
- [-] Tâche 6 — `usePeerOrchestrator.test.js` — **toujours à ne pas ouvrir en entier** : le wrapping du routage star doit d'abord déménager dans `usePeerTransport` (item `[L]` de la TODOLIST), sinon les tests sont à jeter. Exception ouverte : `usePeerOrchestrator.broadcastPresence.test.js` couvre le seul câblage de l'annonce de diffusion (aucune assertion sur le routage star, donc survit à ce déménagement)
- [ ] Tâche 7 — `useMediaBroadcast.test.js`
- [x] `useConnectionPool.test.js` — 31 tests ✅ : `requestOrConnectPeer` (6), logique de tentative/retry (8 — dont garde `isShuttingDown`, signalisation stale, connexion screen, clearRetry/clearAllRetries), `syncUsersConnections` (9 — lock concurrent, `waitForMeReady` négatif, nettoyage des partants, fan-out mesh/star-hub/star-client/sfu), recovery `peerUnavailableSignal` (3), cleanup (2)
- [x] `useStreamManager.test.js` — 19 tests ✅ : `handleStreamReceived` (clé canonique, résolution du slug, idempotence, mode stream sans player, éviction TTL et FIFO), `handleStreamRemoved` (départ complet, full stop conditionnel, garde par participant, dédoublonnage concurrent, libération de la garde sur exception)
- [x] `useSignalingQueue.test.js` — 19 tests ✅ : routage (table de routes, `payload` seul passé au handler, warn sur type inconnu, enveloppe `payload.type` des Widgets ignorée sans warn, warn sur signal sans aucun type), **absence de précondition asynchrone (non-régression : route sans attendre `waitForMeReady`, route même pendant un arrêt)**, détecteur de coalescence (`seq`), erreurs, cleanup (`stopSignaling` idempotent, démontage, plus rien routé après l'arrêt)
- [x] `useCallManager.test.js` — 62 tests ✅ : `startCallWithPeer` (dont « aucune mutation si appel en cours » et room imposée), `acceptCallFromPeer` (dont **ordre mapping peerId avant transition**), `openCallBetweenPeer`, `stopCallWithPeers` (partial vs full, ordre du cleanup, mutex CLOSING, exception → pas de blocage), `remoteStopCall` (dont dédoublonnage concurrent), `handleRemoteDeparture` (séquence unifiée des deux chemins de départ), `resetCallState`, room d'appel, verbes FSM pour la couche streams, retries d'invitation
- [x] `usePeerConnections.test.js` — 47 tests ✅ : `getRoomUsersDiff` (7 — arrivants/partants, filtrage de mon slug, `waitForMeReady` négatif, sérialisation du mutex, verrou non bloqué par une exception), `hasOpenConnection` (12 — data/media, fallback `signalingState`, `peerConnection` illisible, room d'appel prioritaire), `connectToPeer` (22 — gardes anti-soi/verrou/`MAX_PEERS_PER_ROOM`, branche par type, validations de config, métadonnées produites), `closePeerConnection` (7 — sélectif vs global, oubli conditionnel du peerId, `clearSignalQueue`)
- [x] `createPeerContext.test.js` — 46 tests ✅ : isolation/initialisation (6), `waitForMeReady` (5 — dont **non-régression du timer de secours** : aucun faux « a expiré » sur identité déjà prête), eventBus (3 — bus injecté, fallback no-op, bus incomplet rejeté), `setUpConnectionListeners` (17 — branchement, idempotence WeakSet, cleanup/rebranchement, garde de taille en réception, close métier unique, `handleClose` : retrait du store, oubli conditionnel du peerId, slug distant vs le mien, type forgé neutralisé), `storeConnectionEventCallbacks` (3), garde de teardown (2), helpers `currentCallUsers` (5), projections calculées (3), `destroy`/`onUnmounted` (4)
- [x] `usePeerMedia.streams.test.js` — 19 tests ✅ : `startCurrentStream` (4 — contraintes issues de `streamStates`, markRaw), `stopCurrentStream` (3), `startAudioStream` (2 — alignement de l'UI), `startScreenCapture`/`stopScreenCapture` (5), nettoyage de fin de vie d'un flux (5 — `ended`/`inactive`, idempotence du binding, désinscription, garde `instanceof MediaStream`)
- [x] `useBroadcastPresence.test.js` — 18 tests ✅ : émission (8 — annonce à l'ouverture d'une connexion, silence quand je ne diffuse pas, gardes de type sur la connexion, diffusion au changement d'état local, annonce d'arrêt, **aucun envoi si aucun pair joignable en data** — chemin normal au premier démarrage, routage laissé au transport en star, plus rien après `stopBroadcastPresence`), réception (6 — identité résolue depuis la connexion entrante *et* sortante, retrait sur `isBroadcasting: false`, **payload `from` ignoré (anti-usurpation)**, annonce consommée même sans pair résolu, messages métier non consommés), **star** (2 — côté client, une annonce relayée n'est pas attribuée au hub ; côté hub, l'annonce d'un client est bien enregistrée), purge au départ de la room (2)
- [x] `usePeerOrchestrator.broadcastPresence.test.js` — 6 tests ✅ : **intégration réelle** (contexte, stores et `setUpConnectionListeners` non mockés ; seul PeerJS l'est) du câblage de l'annonce — wrap `onDataReceived` posé même sans callback applicatif, annonce jamais remontée au métier, arité `(data, conn, metadata)` préservée pour le métier, retrait sur annonce d'arrêt, annonce émise à l'`open` d'une connexion data avec `conn` transmis au callback applicatif. Périmètre volontairement limité à la présence de diffusion (cf. Tâche 6)
- [x] `useAwaitedStreams.test.js` — 15 tests ✅ (UI) : **aucune attente pour un pair qui n'a rien annoncé** (le symptôme corrigé), attente sur annonce, arrêt d'attente à l'arrivée du flux (webcam ou écran), annonce d'un pair hors room ignorée, filet de délai (4 — abandon, non-abandon avant l'échéance, un timer par pair, flux de dernière seconde), pas de ré-attente après un arrêt, réarmement par une nouvelle annonce, tolérance aux `api` non réactives
- [x] `MediaBroadcastPlayer.spinner.test.js` — 9 tests ✅ (UI) : overlay d'attente d'image sur un flux **déjà reçu** — piloté par les events réels du `<video>` (`can-play`, `playing`, `waiting`, `stalled`, `error`), neutralisé sans flux, sans vidéo active ou avec slot `video` fourni, réarmé sur instance recyclée par le pool

---

### Tâche 1 — `usePeerCore.test.js` (Signaling layer)

**Périmètre** : couche HTTP/Ajax pure, sans WebRTC.

- [✅] `requestRemotePeerConnection` : POST Ajax déclenché, `addWaitingRemotePeerId` appelé, throttling SIGNALING_STALE_MS (pas de 2e requête si `waiting` récent)
- [✅] `responseRemotePeerConnection` : POST avec `peerId` local correct, garde `!getLocalPeerId` (aucun POST, `false`), booléen de retour
- [✅] `requestAuthorizationRemotePeerId` : envoi immédiat + retry via `inviteRetryManager`, retourne un `inviteId`
- [✅] `sendAuthorizationRemotePeerId` : envoi avec `status: true` (inclut peerId) vs `status: false` (type seulement)
- [ ] `notifyCloseConnectionToPeer` : POST avec room/type/fromUserSlug
- [✅] ~~Signal watcher~~ : déplacé dans `useSignalingQueue.test.js` (le routage ne vit plus ici)
- [ ] `stopCallInviteRetry` / `stopCallInviteRetryForUser` / `clearAllCallInviteRetries` : cancellent les retries correspondants
- [✅] Limite `MAX_INVITE_RETRIES` : la plus ancienne entrée est évincée quand la Map est pleine *(couvert dans requestAuthorizationRemotePeerId)*
- [ ] `onUnmounted` : inviteRetryManager vidé

**Prérequis** : `createMockContext()` suffit (AjaxService injecté via ctx) ; `vi.useFakeTimers()` pour les retries.

---

### Tâche 2 — `usePeerConnections.test.js` (WebRTC connections)

**Périmètre** : ouverture/fermeture de connexions PeerJS, diff de room.

- [✅] `getRoomUsersDiff` : nouveaux users détectés, users partis détectés, mon propre slug filtré
- [✅] `getRoomUsersDiff` mutex : deux appels concurrents retournent des diff cohérents (pas de TOCTOU) ; une exception ne bloque pas le verrou
- [✅] `hasOpenConnection` — DataConnection : `conn.open === true` → true, `conn.open === false` → false
- [✅] `hasOpenConnection` — MediaConnection : `connectionState` closed/failed/disconnected → false, connected → true ; fallback `signalingState` ; lecture défensive si l'objet jette
- [✅] `connectToPeer` : guard `inFlightConnections` (pas de double tentative), guard `MAX_PEERS_PER_ROOM`, branche par type, validations de `_buildPeerConnectionConfig`
- [✅] `closePeerConnection` : fermeture sélective (liste `users`), fermeture globale, `clearSignalQueue`
- [✅] ~~Signal watcher / `onUnmounted`~~ : déplacés dans `useSignalingQueue.test.js`

**Prérequis** : `createMockDataConnection()` et `createMockMediaConnection()` de `__mocks__/peerjs.js` ; injecter des connexions factices via `peerStore.addPeerConnectionInstance()` du `createMockContext`, et fournir un `peerStore.getLocalPeer` factice (`connect`/`call`) — il vaut `null` par défaut.
**Depuis l'extraction de `useSignalingQueue`** : ce composable n'enregistre plus aucun hook de lifecycle → il s'appelle **directement, sans `withSetup`**, comme `useCallManager` / `useStreamManager`.
⚠️ Les branches `stream`/`screen`/`visio` filtrent sur `stream instanceof MediaStream` **et** sur au moins une piste `readyState === 'live'` : construire de vraies instances `MediaStream` (happy-dom expose la classe) avec un `getTracks()` surchargé — `MediaStreamTrack` a un constructeur illégal.

---

### Tâche 3 — `usePeerMedia.test.js` (MediaStream lifecycle)

**Périmètre** : getUserMedia, cycle de vie des éléments vidéo Vue.

Découpée en deux fichiers : `usePeerMedia.players.test.js` (pool d'instances) et
`usePeerMedia.streams.test.js` (flux locaux + fin de vie d'un flux).

- [✅] `startCurrentStream` : `getUserMedia` appelé avec les bonnes contraintes, `currentStream` mis à jour, stream marqué `markRaw`
- [✅] `stopCurrentStream` : `track.stop()` appelé sur chaque track, `currentStream` null, `isStreaming` false, `isAudioStream` false
- [✅] `startAudioStream` : contraintes audio seul, `currentStream` mis à jour, alignement de l'UI (`isVideoEnabled` false, `isMuted` true)
- [✅] `startScreenCapture` : `getDisplayMedia` avec/sans audio système, `screenStream` mis à jour sans écraser `currentStream`
- [✅] `stopScreenCapture` : `track.stop()` appelé sur chaque track, `screenStream` null, `isCapturing` false
- [✅] `createVideoElement` / `removeVideoElement` / `cleanupCallPlayers` / `destroyPlayers` : couverts par `usePeerMedia.players.test.js` (recyclage des slots, idempotence, teardown terminal)
- [✅] `_bindStreamCleanup` : `ended` et `inactive` déclenchent `removeVideoElement`, idempotent (pas de double binding), garde `instanceof MediaStream`
- [✅] `_unbindStreamCleanup` : listeners retirés sur `removeVideoElement`

**Prérequis** : `vi.mock` du `MediaBroadcastPlayer.vue` (le dynamic import passe par `PlayerHost.vue`) ; un `<div id="videoContainer">` dans `document.body` pour que `querySelector` réussisse.
⚠️ Les `vi.fn()` globaux de `setup.js` ne sont **pas** réinitialisés entre les tests (pas de `clearMocks` dans `vitest.config.js`) : faire `navigator.mediaDevices.getUserMedia.mockReset()` en `beforeEach`, sinon les compteurs d'appels s'accumulent.
⚠️ Le flux factice de `setup.js` est un objet nu, or `_bindStreamCleanup` filtre sur `stream instanceof MediaStream` → construire de vraies instances avec `getTracks()` surchargé.

---

### Tâche 4 — `usePeerTransport.*.test.js` (Peer singleton + DataChannel)

**Périmètre** : singleton PeerJS, envoi de données, topologie, **et durcissement sécurité** (auth entrante, anti-usurpation, limites de taille/débit). Découpée en plusieurs fichiers par surface.

> ⚠️ **Mise à jour 2026-05-27** : le composant a reçu 5 commits sécurité. Note importante sur l'item « sendData star » : **le hub envoie en direct** (`conn.send(data)`, sans enveloppe) ; c'est le **client** qui construit l'enveloppe `__starRoute`. L'ancienne formulation « hub construit l'enveloppe » était fausse.

#### ✅ Déjà couvert (3 fichiers, 22 tests)

- [✅] **`usePeerTransport.incomingAuth.test.js`** (11) — `_isAuthorizedIncomingPeer` :
  - accepte/rejette une connexion data selon l'appartenance à `usersInRoom`
  - rejette `from` absent / format de slug invalide
  - anti-usurpation : rejet si peerId réel mappé ≠ `from` déclaré ; accepte si concordance
  - répond/rejette un appel one-way selon l'auth
  - accepte connexion data **et** appel visio d'un interlocuteur d'appel direct (`session.currentCallUsers`) hors room
- [✅] **`usePeerTransport.forwardStar.test.js`** (5) — `forwardStarMessage`, validation `envelope.to` :
  - retransmet uniquement aux membres ciblés présents dans la room
  - ignore slugs hors room / format invalide ; exclut toujours l'expéditeur ; diffuse à tous si `to` absent
- [✅] **`usePeerTransport.mesh.test.js`** (6) — `sendData` mesh + limite de taille payload :
  - diffuse un payload dans la limite à tous les membres
  - rejette payload JSON / binaire (ArrayBuffer) > `MAX_PAYLOAD_BYTES`, accepte pile à la limite
  - rejette payload non sérialisable ; applique la limite aussi avec `destUserSlugs` explicite

#### 📋 Restant à couvrir

- [ ] `setLocalPeer` : crée un `Peer`, incrémente `_peerConsumerCount`, résout la promise quand l'event `open` est déclenché
- [ ] `setLocalPeer` singleton : deuxième appel réutilise le même Peer (`_peerInitPromise` partagée, pas de nouvelle instance)
- [ ] Ref-counting / `unregisterLocalContext` : `_peerConsumerCount` décrémenté à l'`onUnmounted`, destruction **différée** `PEER_DESTROY_DELAY_MS` planifiée à count == 0, **annulée** si un consommateur remonte avant la fin du délai
- [ ] `_destroyPeerSingleton` : cas `localPeer` déjà null (échec init) → ne réinitialise pas le compteur ; cas nominal → `peer.destroy()`, reset des refs module-level
- [ ] `sendData` star (client) : enveloppe `__starRoute` (`to`, `from`, `payload`) construite et envoyée au **hub uniquement**
- [ ] `sendData` star (hub) : envoi **direct** aux destinataires (pas d'enveloppe)
- [ ] `forwardStarMessage` rate limiting : `HUB_MAX_MESSAGES_PER_WINDOW` / `HUB_RATE_WINDOW_MS` (excédent ignoré), clé = peerId entrant réel (non `envelope.from`)
- [ ] `forwardStarMessage` limite de taille payload : rejet > `MAX_PAYLOAD_BYTES` (JSON + binaire) et payload invalide
- [ ] `_sweepHubRateWindows` : purge throttlée des expéditeurs déconnectés (pas de fuite mémoire sur rotation de room)
- [ ] `peerUnavailableSignal` : handler `'error'` type `peer-unavailable` → retire la connexion échouée, invalide le peerId stale, positionne le signal réactif sur le slug cible
- [ ] Reconnect guard : `_reconnectAttempts` avec backoff exponentiel plafonné à `MAX_RECONNECT_ATTEMPTS` (`RECONNECT_MAX_DELAY_MS`), pas de boucle infinie, reset sur `'open'`
- [ ] `contextRegistry` : `unregisterContext` last-write-wins (ne supprime que si l'entrée appartient toujours au ctx — cf. note), retiré à l'`onUnmounted`, pas de fuite

**Prérequis** : `getLastPeerInstance()` + `resetPeerMock()` + `instance._triggerEvent('open', 'peer-id')` de `__mocks__/peerjs.js` ; `vi.resetModules()` entre les tests pour réinitialiser les singletons module-level (`_peerInitPromise`, `_peerConsumerCount`, `_reconnectAttempts`, `contextRegistry`, `_hubRateWindows`) ; `vi.useFakeTimers()` pour le délai de destruction et le backoff de reconnexion.

---

### Tâche 5 — `createPeerContext.test.js` (Context factory)

**Périmètre** : création du contexte isolé, helpers, lifecycle.

- [✅] Isolation : deux appels `createPeerContext` produisent des `contextId` différents, états indépendants
- [✅] Session init : `type`, `room`, `topology`, `hubSlug`, `videoContainer` correctement propagés (+ valeurs par défaut)
- [✅] File de signaux créée au montage (`onBeforeMount`) ; `lastRoomSignal` suit bien le dernier signal **de ce contexte**
- [✅] `addCurrentCallUser` / `removeCurrentCallUser` / `clearCurrentCallUsers` : mutations et retours corrects, pas de doublon (même slug + type)
- [✅] `storeConnectionEventCallbacks` : idempotent (`isActive` guard), clés inconnues ignorées, callback non-fonction ignoré
- [✅] `setUpConnectionListeners` : handlers bindés, idempotent (WeakSet — double appel ignoré), cleanup retourné désinscrit les handlers et autorise un rebranchement
- [✅] `setUpConnectionListeners` `handleClose` : retire la connexion du store, supprime le `remotePeerId` si user hors room, ne confond pas mon slug avec le distant, neutralise un `type` forgé, idempotent
- [✅] Garde de taille en réception : payload > `MAX_PAYLOAD_BYTES` abandonné avant le callback métier
- [✅] `waitForMeReady` : résout `true` dès que `meStore.getMe.slug` et `peerStore.lastLocalPeerId` sont disponibles ; positionne `session.isHub`
- [✅] `waitForMeReady` timeout : résout `false` après `timeoutMs` si les données n'arrivent pas
- [✅] `waitForMeReady` **non-régression** : aucun faux « a expiré » 15 s après coup sur une identité déjà prête (timer armé avant `scope.run()`)
- [✅] `beginShutdown` / `endShutdown` : compteur ré-entrant, plancher à 0
- [✅] `destroy()` : vide `remoteStreamsMap`, remet `callMachine` en IDLE, vide `usersInRoom`, supprime la file de signaux, **conserve** `shutdownCount`
- [✅] `onUnmounted` → appelle `destroy()`
- [✅] EventBus fallback : si `eventBus` non fourni via inject (ou interface incomplète), les `$emit/$on/$off` sont des no-op (pas de crash)

**Prérequis** : `withSetup` avec `provides: { eventBus: mockEventBus() }` — obligatoire (`inject`, `onBeforeMount`, `onUnmounted`).
**Pas de `vi.mock` des 4 imports** (contrairement à ce que prévoyait ce plan) : `peers2`, `me` et `server` sont des stores Pinia d'options **sans effet de bord à l'instanciation**, et `setup.js` pose déjà une Pinia fraîche avant chaque test → on les utilise pour de vrai, ce qui couvre au passage la vraie intégration store ↔ contexte (notamment la suppression **conditionnelle** de `removeRemotePeerId`). `useAjaxService()` est seulement instancié, jamais appelé.

---

### Tâche 6 — `usePeerOrchestrator.test.js` (Orchestration — intégration)

**Périmètre** : coordination des sous-modules, guard `isShuttingDown`, machine d'état appel.

- [ ] `initializePeerConnection` : callbacks stockés dans `connectionEvents` ; en topologie star + hub, `onDataReceived` est wrappé (enveloppe `__starRoute` interceptée, payload remonté)
- [ ] `initializePeerConnection` wrapping `onStreamReceived` : `handleStreamReceived` interne est chaîné **avant** le callback utilisateur (quel que soit le type) ; le callback utilisateur reste appelé ensuite si fourni
- [ ] `initializePeerConnection` wrapping `onConnectionClose` stream : uniquement pour `type === 'stream'`, `handleStreamRemoved` interne est chaîné avant le callback utilisateur ; pour les autres types (`data`, `visio`…) la fermeture n'est pas wrappée
- [ ] `syncUsersConnections` topologie mesh : `_requestOrConnectPeer` appelé pour chaque new user
- [ ] `syncUsersConnections` topologie star hub : se connecte à tous les new users
- [ ] `syncUsersConnections` topologie star client : se connecte uniquement au hub
- [ ] `syncUsersConnections` lock : appels parallèles sérialisés (le 2e attend la fin du 1er)
- [ ] `_requestOrConnectPeer` : connexion directe si `remotePeerId` connu ; sinon `requestRemotePeerConnection` ; retry `scheduleRetry` lancé dans tous les cas
- [ ] `handleStreamReceived` mode `stream` : peuple `remoteStreamsMap` (clé `${slug}-${type}`) **sans** appeler `createVideoElement` — l'UI consomme `remoteStreams` via le slot
- [ ] `handleStreamReceived` autres modes (visio, vocal…) : peuple `remoteStreamsMap` **et** crée le player DOM via `createVideoElement`, transition RECEIVING→CONNECTED
- [ ] `handleStreamRemoved` mode `stream` : retire l'entrée de `remoteStreamsMap`, `removeVideoElement` est appelé (no-op si absent), `removeCurrentCallUser` mis à jour
- [ ] `stopCallWithPeers` mode `full` : `closePeerConnection` global, `stopCurrentStream`, reset `callMachine`, `isShuttingDown` repasse à false en fin
- [ ] `stopCallWithPeers` mode `partial` : fermeture sélective, `isShuttingDown` repasse à false, `callMachine` reste en CONNECTED
- [ ] `isShuttingDown` guard : watcher `peerUnavailableSignal` et `_handleConnectionAttempt` ne s'exécutent pas si true
- [ ] Watcher `peerUnavailableSignal` : déclenche `_requestOrConnectPeer` puis reset le signal à null
- [ ] `cleanupPeerConnection` : `isShuttingDown` permanent, watcher arrêté, retries vidés, `unregisterLocalContext` appelé
- [ ] `onUnmounted` : stoppe le watcher + vide les retries (guard `isShuttingDown`)

**Prérequis** : `vi.mock` pour `usePeerCore`, `usePeerMedia`, `usePeerConnections`, `usePeerTransport` — ou `createMockContext` enrichi avec des sous-modules fictifs ; `vi.useFakeTimers()`.

---

### Tâche 7 — `useMediaBroadcast.test.js` (Feature layer — bout en bout)

**Périmètre** : couche métier, flux complets appel + données + events Vue.

- [ ] Lifecycle data channel : `initializePeerConnection` → `syncUsersConnections` → `cleanupPeerConnection` appelés dans l'ordre
- [ ] `sendDataToPeer` : délègue à `transport.sendData` avec le bon payload
- [ ] `onDataReceived` callback : exécuté quand une donnée arrive via la connexion
- [ ] Flux appel complet initiateur : `startCallWithPeer` → `openCallBetweenPeer` → `stopCallWithPeers` (IDLE→CALLING→CONNECTED→CLOSING→IDLE)
- [ ] Flux appel complet récepteur : `acceptCallFromPeer` (status true) → `stopCallWithPeers`
- [ ] Refus d'appel : `acceptCallFromPeer` (status false) → aucun stream démarré, callMachine reste IDLE
- [ ] `remoteStopCall` : ferme le stream distant, supprime le videoElement, émet `close-call`
- [ ] `handleStreamReceived` mode `stream` (via `initializePeerConnection`) : `remoteStreams` (computed) passe de longueur 0 à 1 après réception ; **aucun** `createVideoElement` appelé
- [ ] `handleStreamReceived` mode `visio` : `createVideoElement` appelé, transition RECEIVING→CONNECTED
- [ ] `handleStreamRemoved` : supprime le videoElement (si présent), `remoteStreams` revient à longueur 0, si dernier user → `stopCallWithPeers` full
- [ ] Événements exposés : `close-call` émis avec le bon payload

**Prérequis** : `usePeerOrchestrator` entièrement mocké via `vi.mock` (résultat de la tâche 6) ou intégration complète avec tous les sous-modules mockés.
