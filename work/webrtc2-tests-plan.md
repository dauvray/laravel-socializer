# WebRTC2 — Plan de tests unitaires

> **Chantier ouvert.** Le harnais, ses invariants et les pièges de mock sont dans
> [`docs/modules/webrtc2/tests.md`](../docs/modules/webrtc2/tests.md) ; l'infra générale dans
> [`docs/architecture/tests.md`](../docs/architecture/tests.md). Ce fichier ne porte que
> l'avancement et les tâches restantes.

> Helpers : `withSetup`, `createMockContext`, `mockEventBus`, `__mocks__/peerjs.js`,
> `createVirtualPeer`, `fakeSignalingServer`, `fakeMedia`.
> Commande : `npm run test:run` depuis la racine de l'hôte.

⚠️ **Ne jamais recopier un décompte ici** : ce document a déjà divergé du réel deux fois, dans les
deux sens — un total sous-évalué, puis onze fichiers existants absents de ses listes.

---

## Où en est la couverture

Les décomptes se relisent dans la sortie du runner : `npm run test:run`. Le recensement des
fichiers aussi — `find src/resources/js -path '*__tests__*' -name '*.test.js'` — et c'est la seule
liste qui ne mente pas, celle-ci ayant déjà ignoré onze fichiers existants.

Trois étages, dont le dernier est celui qui manquait : **unitaire** (`__tests__/*.test.js`,
`utils/`), **conformité** (`mockFidelity`, `peerjsMockFidelity.descriptors` — le mock n'est ni en
retard ni en avance sur le réel), **bout en bout** (`scenarios/` — deux pairs réels qui se parlent,
et le seul étage où les incendies du paquet étaient détectables). Le harnais et ses invariants :
[docs/modules/webrtc2/tests.md](../docs/modules/webrtc2/tests.md).

| Périmètre | État | Ce qui reste |
|---|---|---|
| `utils/` — FSM d'appel, retry, rate limiter, taille de payload, sanitisation, `fetchIceServers` | ✅ | — |
| Tâche 1 · `usePeerCore` — Ajax + signalisation pure | ◐ | 3 items, ci-dessous |
| Tâche 2 · `usePeerConnections` | ✅ | — |
| Tâche 3 · `usePeerMedia` — `.players` + `.streams` | ✅ | — |
| Tâche 4 · `usePeerTransport` — 7 fichiers (sécurité, `peer-unavailable`, singleton, mesh, reconnexion, `forwardStar`, `iceRefresh`) | ◐ | 4 items, ci-dessous |
| Tâche 5 · `createPeerContext` | ✅ | — |
| Tâche 6 · `usePeerOrchestrator` | ⛔ **bloquée** | voir ci-dessous ; seul `broadcastPresence` est couvert |
| Tâche 7 · `useMediaBroadcast` | ⛔ **bloquée** | après la tâche 6 |
| Couches extraites de l'orchestrateur — `useConnectionPool`, `useCallManager`, `useStreamManager`, `useSignalingQueue` | ✅ | — |
| Store — `peers2Store` : runtime, observabilité, `remotePeerId` | ✅ | — |
| UI — `useAwaitedStreams`, `useBroadcastPresence`, `MediaBroadcastPlayer` (identité, spinner) | ✅ | — |
| Scénarios — smoke, `lateJoiner`, `broadcastLifecycle`, `peerDeparture`, `multiContext`, `incomingMappingInvariant`, `outgoingAuth` | ✅ | — |
| Hors WebRTC2 — `Chat/dateSeparatorRender`, `System/useReverbChannel`, `User/coverCallButton` | amorces | plan Chat : [chat-tests-plan.md](chat-tests-plan.md) |

⛔ **Les tâches 6 et 7 sont volontairement bloquées.** Le wrapping du routage star qu'elles doivent
couvrir est justement ce que la TODOLIST prévoit de *déplacer* dans `usePeerTransport` (item `[L]`,
gelé). Écrire ces tests avant le déménagement revient à les jeter. Exception ouverte, et elle
survit au déménagement : `usePeerOrchestrator.broadcastPresence.test.js` n'asserte rien sur le
routage star.

Les couches extraites se testent avec des `vi.fn()` pour les dépendances injectées — c'est tout
l'intérêt de l'injection descendante. `useCallManager` et `useStreamManager` n'enregistrent aucun
hook de lifecycle et s'appellent **directement**, sans `withSetup` ; `useConnectionPool` et
`useSignalingQueue` posent un `watch` + un `onUnmounted`, donc `withSetup` y est **obligatoire**.

---

## Tâches restantes

### Tâche 1 — `usePeerCore.test.js` (Signaling layer)

**Périmètre** : couche HTTP/Ajax pure, sans WebRTC.

- [✅] `requestRemotePeerConnection` : POST Ajax déclenché, `addWaitingRemotePeerId` appelé, throttling SIGNALING_STALE_MS (pas de 2e requête si `waiting` récent)
- [✅] `requestRemotePeerConnection` rate limiting `ASK_PEER_MAX_REQUESTS_PER_WINDOW` / `ASK_PEER_RATE_WINDOW_MS` : plafond par cible, discrimination slug **et** `connectionType`, reprise après la fenêtre, un POST en échec consomme un jeton, le garde `waiting` sorti en amont n'en consomme aucun. ⚠️ Les tests passent par `invalidateRemotePeerId` (chemin réel du `peer-unavailable`) : sans cette purge c'est le garde `waiting` qui sort en premier et ils verdissent pour la mauvaise raison. ⚠️ `askPeerRateLimiter.reset()` obligatoire en `beforeEach` — état module-level + `Date.now()` gelé par les fake timers
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

### Tâche 2 — `usePeerConnections.test.js` ✅

Périmètre couvert. Le détail est dans l'en-tête du fichier de test ; les pièges de mock qu'il a
révélés sont dans [docs/modules/webrtc2/tests.md](../docs/modules/webrtc2/tests.md#pièges-de-mock).

### Tâche 3 — `usePeerMedia.*.test.js` ✅

Périmètre couvert, en deux fichiers : `.players` (pool d'instances) et `.streams` (flux locaux et
fin de vie d'un flux). Ses deux pièges de harnais — les `vi.fn()` globaux non réinitialisés, le flux
factice qui est un objet nu — sont dans
[docs/modules/webrtc2/tests.md](../docs/modules/webrtc2/tests.md#pièges-de-mock).

### Tâche 4 — `usePeerTransport.*.test.js` (Peer singleton + DataChannel)

**Périmètre** : singleton PeerJS, envoi de données, topologie, **et durcissement sécurité** (auth entrante, anti-usurpation, limites de taille/débit). Découpée en plusieurs fichiers par surface.

> ⚠️ **Mise à jour 2026-05-27** : le composant a reçu 5 commits sécurité. Note importante sur l'item « sendData star » : **le hub envoie en direct** (`conn.send(data)`, sans enveloppe) ; c'est le **client** qui construit l'enveloppe `__starRoute`. L'ancienne formulation « hub construit l'enveloppe » était fausse.

#### ✅ Déjà couvert (6 fichiers, 56 tests)

- [✅] **`usePeerTransport.incomingAuth.test.js`** (15) — `_isAuthorizedIncomingPeer` :
  - accepte/rejette une connexion data selon l'appartenance à `usersInRoom`
  - rejette `from` absent / format de slug invalide
  - anti-usurpation : rejet si peerId réel mappé ≠ `from` déclaré ; accepte si concordance
  - répond/rejette un appel one-way selon l'auth
  - accepte connexion data **et** appel visio d'un interlocuteur d'appel direct (`session.currentCallUsers`) hors room
- [✅] **`usePeerTransport.forwardStar.test.js`** (5) — `forwardStarMessage`, validation `envelope.to` :
  - retransmet uniquement aux membres ciblés présents dans la room
  - ignore slugs hors room / format invalide ; exclut toujours l'expéditeur ; diffuse à tous si `to` absent
- [✅] **`usePeerTransport.mesh.test.js`** (10) — `sendData` mesh + limite de taille payload :
  - diffuse un payload dans la limite à tous les membres
  - rejette payload JSON / binaire (ArrayBuffer) > `MAX_PAYLOAD_BYTES`, accepte pile à la limite
  - rejette payload non sérialisable ; applique la limite aussi avec `destUserSlugs` explicite
- [✅] **`usePeerTransport.peerUnavailable.test.js`** (9) — recovery du peerId mort :
  - ignore les autres types d'erreur PeerJS et les peerId inconnus
  - retire la connexion échouée, conserve celles pointant sur un autre peerId
  - invalide le mapping **même** si le pair reste connecté dans une autre room (le bug du 2026-08-13), et même si aucune instance n'a été stockée ; positionne `peerUnavailableSignal`
- [✅] **`usePeerTransport.singleton.test.js`** (19) — cycle de vie du Peer singleton :
  - création, `localPeerReady` seulement sur `'open'`, garde d'init (2 contextes simultanés = 1 seul Peer), peer prêt réutilisé
  - 🔥 **fenêtre asynchrone entre les deux gardes** : `peerInitPromise` est déjà retombée (corps de `_doInit` synchrone) et `'open'` n'est pas arrivé — un second contexte ne doit pas créer un second Peer. C'est la séquence NOMINALE de production (`data-app` au tick 0, `stream-<room>` après résolution de route), et le trou de couverture qui a laissé passer la régression du 2026-08-14
  - **l'invariant « une seule instance de Peer par onglet »**, énoncé une fois pour les trois fenêtres de montage (même tick / init résolue sans `'open'` / `'open'` reçu). Les tests voisins en sont des cas particuliers : c'est **ici** qu'on vérifie que les trois gardes tiennent encore après un remaniement
  - ref-counting : destruction **différée** de `PEER_DESTROY_DELAY_MS`, **annulée** si un consommateur remonte, peer conservé tant qu'un autre consommateur est monté
  - `_destroyPeerSingleton` : cas nominal (reset complet du store) **et** cas `localPeer` déjà absent (échec d'init : ni crash ni destruction)
  - intégration sur le **vrai** store Pinia (le mock garantit la surface, pas la sémantique)
  - **HMR** : le peer partagé survit au démontage d'un consommateur enregistré par une autre copie du module ; une seule instance créée quand une init est en vol au moment du rechargement (+ un contrôle de harnais, sinon ces deux tests seraient verts pour rien)
  - **détachement des listeners** : chaque `peer.on` a son `peer.off` par identité et **tous avant `destroy()`** (filet structurel : un 6e listener branché hors du helper `bind` casse ce test) ; un `error` livré après la destruction ne loggue plus rien (seul événement réellement livrable ensuite, cf. `retrieveId` `bundler.mjs:1564`) ; un `open` tardif ne ressuscite pas un peer fantôme (**invariant**, pas repro — `socket._cleanup()` met `onmessage = null` avant, l.731) ; aucun détachement croisé entre deux Peer successifs
- [✅] **`usePeerTransport.reconnect.test.js`** (8) — garde de reconnexion :
  - backoff exponentiel (1s·2s·4s·8s·16s) plafonné à `RECONNECT_MAX_DELAY_MS`, abandon après `MAX_RECONNECT_ATTEMPTS` sans boucler
  - compteur remis à zéro sur `'open'` ; aucune tentative sur un peer détruit
  - un backoff armé pendant le délai de grâce ne survit pas à la destruction (aucun timer résiduel)
  - une **destruction volontaire n'est pas une coupure réseau** : ni tentative consommée, ni `warn` de reconnexion, ni fausse alerte `abandon` au plafond. `destroy()` émet `disconnected` avant de poser son drapeau (`bundler.mjs:1810` / `:1781`) — sans détachement explicite, le garde `localPeer.destroyed` du handler ne voit rien

#### 📋 Restant à couvrir

- [ ] `sendData` star (client) : enveloppe `__starRoute` (`to`, `from`, `payload`) construite et envoyée au **hub uniquement**
- [ ] `sendData` star (hub) : envoi **direct** aux destinataires (pas d'enveloppe)
- [ ] `forwardStarMessage` rate limiting : excédent ignoré au **point d'appel** du hub, clé = peerId entrant réel (non `envelope.from`). ⚠️ Partiellement couvert depuis 2026-08-14 : la **mécanique** (plafond `HUB_MAX_MESSAGES_PER_WINDOW` / `HUB_RATE_WINDOW_MS`) vit désormais dans `utils/createRateLimiter.js` et y est testée ; reste à couvrir le **câblage** — que le hub passe bien `senderIdentity` et abandonne le message
- [ ] `forwardStarMessage` limite de taille payload : rejet > `MAX_PAYLOAD_BYTES` (JSON + binaire) et payload invalide
- [✅] Purge throttlée des expéditeurs inactifs (pas de fuite mémoire sur rotation de room) — logique déplacée de `_sweepHubRateWindows` vers `utils/createRateLimiter.js`, couverte par `utils/createRateLimiter.test.js`
- [ ] `contextRegistry` : `unregisterContext` last-write-wins (ne supprime que si l'entrée appartient toujours au ctx — cf. note), retiré à l'`onUnmounted`, pas de fuite

**Prérequis** : `getLastPeerInstance()` + `resetPeerMock()` + `instance._triggerEvent('open', 'peer-id')` de `__mocks__/peerjs.js` ; `vi.useFakeTimers()` pour le délai de destruction et le backoff de reconnexion ; `vi.resetModules()` entre les tests pour réinitialiser ce qui reste au niveau du module (`contextRegistry`, `_hubRateLimiter`) — **le mock PeerJS doit être ré-importé après le même reset**, sinon `getLastPeerInstance()` ne voit pas les instances créées par la copie sous test. L'état du Peer singleton (ref-counting, garde d'init, reconnexion) vit désormais dans `peerStore` : une Pinia fraîche (posée par `setup.js`) ou un `ctx` neuf suffit à l'isoler.

---

### Tâche 5 — `createPeerContext.test.js` ✅

Périmètre couvert. Deux contraintes de harnais à ne pas défaire : `withSetup` est **obligatoire**
(`inject`, `onBeforeMount`, `onUnmounted`), et **on ne mocke pas ses quatre imports** — contrairement
à ce que ce plan prévoyait : `peers2`, `me` et `server` sont de vrais stores Pinia, et les doubler
ferait passer le test à côté de ce qu'il croit exercer.

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
