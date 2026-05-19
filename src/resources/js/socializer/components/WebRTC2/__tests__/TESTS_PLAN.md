# WebRTC2 — Plan de tests unitaires

> Infrastructure : vitest 2.1.9 · @vue/test-utils · happy-dom  
> Helpers : `withSetup`, `createMockContext`, `mockEventBus`, `__mocks__/peerjs.js`  
> Commande : `npm run test:run`

---

## ✅ Déjà réalisé

- [x] **Infrastructure** : `vitest.config.js`, `setup.js` (mocks globaux : mediaDevices, RTCPeerConnection, crypto, Pinia)
- [x] **`utils/useCallStateMachine.test.js`** — 35 tests : transitions FSM, computed dérivés, reset(), closingUsers
- [x] **`utils/usePeerRetry.test.js`** — 15 tests : scheduleRetry, clearRetry, clearAll, fake timers, erreurs fatales, cleanup onUnmounted

---

## 📋 Prochaines tâches (une conversation par tâche)

### Ordre recommandé

```
Tâche 1 → usePeerCore          (Ajax + signaling pur)
Tâche 2 → usePeerConnections   (connexions PeerJS factices)
Tâche 3 → usePeerMedia         (DOM + MediaStream)
Tâche 4 → usePeerTransport     (singleton Peer + DataChannel)
Tâche 5 → createPeerContext    (context factory + lifecycle)
Tâche 6 → usePeerOrchestrator  (intégration orchestration)
Tâche 7 → useMediaBroadcast    (intégration feature layer)
```

---

### Tâche 1 — `usePeerCore.test.js` (Signaling layer)

**Périmètre** : couche HTTP/Ajax pure, sans WebRTC.

- [ ] `requestRemotePeerConnection` : POST Ajax déclenché, `addWaitingRemotePeerId` appelé, throttling SIGNALING_STALE_MS (pas de 2e requête si `waiting` récent)
- [ ] `responseRemotePeerConnection` : POST avec `peerId` local correct
- [ ] `requestAuthorizationRemotePeerId` : envoi immédiat + retry via `inviteRetryManager`, retourne un `inviteId`
- [ ] `sendAuthorizationRemotePeerId` : envoi avec `status: true` (inclut peerId) vs `status: false` (type seulement)
- [ ] `notifyCloseConnectionToPeer` : POST avec room/type/fromUserSlug
- [ ] Signal watcher : un signal `PEER_CONNECTION_REQUEST` dans `lastRoomSignal` déclenche `responseRemotePeerConnection`
- [ ] `stopCallInviteRetry` / `stopCallInviteRetryForUser` / `clearAllCallInviteRetries` : cancellent les retries correspondants
- [ ] Limite `MAX_INVITE_RETRIES` : la plus ancienne entrée est évincée quand la Map est pleine
- [ ] `onUnmounted` : watcher stoppé + inviteRetryManager vidé

**Prérequis** : `createMockContext()` suffit (AjaxService injecté via ctx) ; `vi.useFakeTimers()` pour les retries.

---

### Tâche 2 — `usePeerConnections.test.js` (WebRTC connections)

**Périmètre** : ouverture/fermeture de connexions PeerJS, diff de room.

- [ ] `getRoomUsersDiff` : nouveaux users détectés, users partis détectés, mon propre slug filtré
- [ ] `getRoomUsersDiff` mutex : deux appels concurrents retournent des diff cohérents (pas de TOCTOU)
- [ ] `hasOpenConnection` — DataConnection : `conn.open === true` → true, `conn.open === false` → false
- [ ] `hasOpenConnection` — MediaConnection : `connectionState` closed/failed → false, connected → true
- [ ] `connectToPeer` : guard `inFlightConnections` (pas de double tentative), guard `MAX_PEERS_PER_ROOM`
- [ ] `closePeerConnection` : fermeture sélective (liste `users`), fermeture globale, `clearSignalQueue`
- [ ] Signal watcher : `PEER_CONNECT_TO_REMOTE_PEER` déclenche l'action correspondante
- [ ] `onUnmounted` : watcher stoppé

**Prérequis** : `createMockDataConnection()` et `createMockMediaConnection()` de `__mocks__/peerjs.js` ; injecter des connexions factices dans `peerStore._connections` du `createMockContext`.

---

### Tâche 3 — `usePeerMedia.test.js` (MediaStream lifecycle)

**Périmètre** : getUserMedia, cycle de vie des éléments vidéo Vue.

- [ ] `startCurrentStream` : `getUserMedia` appelé avec les bonnes contraintes, `currentStream` mis à jour, stream marqué `markRaw`
- [ ] `stopCurrentStream` : `track.stop()` appelé sur chaque track, `currentStream` null, `isStreaming` false
- [ ] `createVideoElement` : guard `creatingVideoIds` (idempotent sur appels concurrents), container absent → erreur claire, `peerStore.addPlayer` appelé
- [ ] `createVideoElement` : `VideoComponent.vue` importé dynamiquement (mock via `vi.mock`)
- [ ] `removeVideoElement` : guard `removingVideoIds`, `app.unmount()` appelé, wrapper DOM retiré, `peerStore.removePlayer` appelé
- [ ] `cleanupCallPlayers` : nettoie uniquement les entrées `local-webcam` et `remote-*`, ignore les autres
- [ ] `_bindStreamCleanup` : listener `track.ended` déclenche `removeVideoElement`, idempotent (pas de double binding)
- [ ] `_unbindStreamCleanup` : listeners retirés sur `removeVideoElement`

**Prérequis** : `vi.mock('~socializer/components/WebRTC2/Widgets/VideoComponent.vue', ...)` pour le dynamic import ; helper `createMockContainer()` (div attachée au document pour que `querySelector` fonctionne).

---

### Tâche 4 — `usePeerTransport.test.js` (Peer singleton + DataChannel)

**Périmètre** : singleton PeerJS, envoi de données, topologie.

- [ ] `setLocalPeer` : crée un `Peer`, incrémente `_peerConsumerCount`, résout la promise quand l'event `open` est déclenché
- [ ] `setLocalPeer` singleton : deuxième appel réutilise le même Peer (pas de nouvelle instance)
- [ ] `unregisterLocalContext` : décrément consumer count, `peer.destroy()` appelé seulement quand count == 0
- [ ] `sendData` mesh : données envoyées à toutes les connexions ouvertes du type courant
- [ ] `sendData` star (client) : données envoyées au hub uniquement
- [ ] `sendData` star (hub) : enveloppe `__starRoute` construite et envoyée aux destinataires
- [ ] `forwardStarMessage` : rate limiting `HUB_MAX_MESSAGES_PER_WINDOW` (messages excédentaires ignorés)
- [ ] `peerUnavailableSignal` : mis à jour quand un peer répond `unavailable`
- [ ] Reconnect guard : `_reconnectAttempts` plafonne, pas de boucle infinie
- [ ] `contextRegistry` : retiré à la destruction, pas de fuite mémoire

**Prérequis** : `getLastPeerInstance()` + `resetPeerMock()` + `instance._triggerEvent('open', 'peer-id')` de `__mocks__/peerjs.js` ; `vi.resetModules()` entre les tests pour réinitialiser les singletons module-level.

---

### Tâche 5 — `createPeerContext.test.js` (Context factory)

**Périmètre** : création du contexte isolé, helpers, lifecycle.

- [ ] Isolation : deux appels `createPeerContext` produisent des `contextId` différents, états indépendants
- [ ] Session init : `type`, `room`, `topology`, `hubSlug` correctement propagés
- [ ] `addCurrentCallUser` / `removeCurrentCallUser` / `clearCurrentCallUsers` : mutations et retours corrects, pas de doublon (même slug + type)
- [ ] `storeConnectionEventCallbacks` : idempotent (`isActive` guard), clés inconnues ignorées, callback non-fonction ignoré
- [ ] `setUpConnectionListeners` : handlers bindés, idempotent (WeakSet — double appel ignoré), cleanup retourné désincrit les handlers
- [ ] `setUpConnectionListeners` `handleClose` : retire la connexion du store, supprime le `remotePeerId` si user hors room
- [ ] `waitForMeReady` : résout `true` dès que `meStore.getMe.slug` et `peerStore.lastLocalPeerId` sont disponibles
- [ ] `waitForMeReady` timeout : résout `false` après `timeoutMs` si les données n'arrivent pas
- [ ] `destroy()` : vide `remoteStreamsMap`, remet `callMachine` en IDLE, vide `usersInRoom`
- [ ] `onUnmounted` → appelle `destroy()`
- [ ] EventBus fallback : si `eventBus` non fourni via inject, les `$emit/$on/$off` sont des no-op (pas de crash)

**Prérequis** : `vi.mock` pour les 4 imports (`~socializer/stores/peers2`, `~estarter/stores/me`, `~socializer/stores/server`, `~estarter/services/AjaxService`) ; `withSetup` avec `provides: { eventBus: mockEventBus() }`.

---

### Tâche 6 — `usePeerOrchestrator.test.js` (Orchestration — intégration)

**Périmètre** : coordination des sous-modules, guard `isShuttingDown`, machine d'état appel.

- [ ] `initializePeerConnection` : callbacks stockés dans `connectionEvents` ; en topologie star + hub, `onDataReceived` est wrappé (enveloppe `__starRoute` interceptée, payload remonté)
- [ ] `syncUsersConnections` topologie mesh : `_requestOrConnectPeer` appelé pour chaque new user
- [ ] `syncUsersConnections` topologie star hub : se connecte à tous les new users
- [ ] `syncUsersConnections` topologie star client : se connecte uniquement au hub
- [ ] `syncUsersConnections` lock : appels parallèles sérialisés (le 2e attend la fin du 1er)
- [ ] `_requestOrConnectPeer` : connexion directe si `remotePeerId` connu ; sinon `requestRemotePeerConnection` ; retry `scheduleRetry` lancé dans tous les cas
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
- [ ] `handleStreamReceived` : crée le videoElement distant, transition RECEIVING→CONNECTED
- [ ] `handleStreamRemoved` : supprime le videoElement, si dernier user → `stopCallWithPeers` full
- [ ] Événements exposés : `close-call` émis avec le bon payload

**Prérequis** : `usePeerOrchestrator` entièrement mocké via `vi.mock` (résultat de la tâche 6) ou intégration complète avec tous les sous-modules mockés.
