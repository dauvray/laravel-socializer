# WebRTC2 — Plan de tests unitaires

> **Chantier ouvert.** Le harnais, ses invariants et les pièges de mock sont dans
> [`docs/modules/webrtc2/tests.md`](../docs/modules/webrtc2/tests.md) ; l'infra générale dans
> [`docs/architecture/tests.md`](../docs/architecture/tests.md). Ce fichier ne porte que
> l'avancement et les tâches restantes.

> Infrastructure : vitest 2.1.9 · @vue/test-utils · happy-dom  
> Helpers : `withSetup`, `createMockContext`, `mockEventBus`, `__mocks__/peerjs.js`,
> `createVirtualPeer`, `fakeSignalingServer`, `fakeMedia`  
> Commande : `npm run test:run` — **566 tests / 32 fichiers, ~2,9 s** (2026-08-15)

⚠️ **Ne jamais recopier un décompte de mémoire** : ce document avait divergé du réel
(377 annoncés pour 466 réels). Les chiffres se relisent dans la sortie du runner.

---

## Trois étages

| Étage | Où | Rôle |
|---|---|---|
| **Unitaire** | `__tests__/*.test.js`, `utils/` | une couche, dépendances injectées mockées |
| **Conformité** | `mockFidelity.test.js` | le mock n'est ni en retard ni en avance sur le store réel |
| **Bout en bout** | `scenarios/` | deux pairs **réels** qui se parlent |

Les scénarios sont l'étage qui manquait, et sans lequel aucun des incendies du package
n'était détectable : ils ne sont vrais ou faux que **vus du pair d'en face**. Détail du
harnais et de ses trois invariants (reset des modules par pair, une tâche par signal,
livraisons asynchrones) dans [docs/modules/webrtc2/tests.md](../docs/modules/webrtc2/tests.md).

- [x] `scenarios/harness.smoke.test.js` — 5 tests : le harnais lui-même (pairs isolés, va-et-vient de signalisation, data channel réel, **propagation des metadata**, `peer-unavailable`). Sans lui, un scénario rouge serait indistinguable d'un harnais cassé
- [x] `scenarios/lateJoiner.test.js` — 5 tests : **le symptôme**. Webcam vers un arrivant, **écran seul** (rouge avant le fix `connectionType`), webcam + écran, troisième arrivant, annonce de diffusion
- [x] `scenarios/broadcastLifecycle.test.js` — 3 tests : arrêter un flux n'en emporte pas un autre (webcam↛écran, écran↛webcam), relance d'une diffusion
- [x] `scenarios/peerDeparture.test.js` — 4 tests : coupure brutale sans signal serveur, oubli du peerId d'un partant, retour avec un nouveau peerId, **B initiateur sortant d'un peerId mort**
- [x] `mockFidelity.test.js` — 5 tests : tout `peerStore.X` consommé par la production existe sur le vrai store **et** sur le mock ; le mock n'invente rien ; `getConnections` jamais enveloppé dans un `computed`

---

## ✅ Déjà réalisé

> Décomptes relus dans la sortie du runner le **2026-08-15** : **566 tests** sur
> 32 fichiers, ~2,9 s (dont 17 scénarios bout en bout et 5 de conformité des mocks).

- [x] **Infrastructure** : `vitest.config.js`, `setup.js` (mocks globaux : mediaDevices, RTCPeerConnection, crypto, Pinia)
- [x] **`utils/useCallStateMachine.test.js`** — 36 tests : transitions FSM, computed dérivés, reset(), closingUsers
- [x] **`utils/usePeerRetry.test.js`** — 15 tests : scheduleRetry, clearRetry, clearAll, fake timers, erreurs fatales, cleanup onUnmounted
- [x] **`utils/payloadSize.test.js`** — 12 tests · **`utils/sanitizeMetadata.test.js`** — 5 tests
- [x] **`utils/createRateLimiter.test.js`** — 9 tests : fenêtre glissante (pas fixe), clés indépendantes, appel bloqué qui ne consomme pas de jeton, purge throttlée, `reset()`, isolation entre instances
- [-] **`usePeerCore.test.js`** — 34 tests (partiel) : requestRemotePeerConnection (+ rate limiting `/ask-to-peer-id`), responseRemotePeerConnection, requestAuthorizationRemotePeerId (inclut MAX_INVITE_RETRIES), sendAuthorizationRemotePeerId

---

## 📋 Prochaines tâches (une conversation par tâche)

### Ordre recommandé

```
Tâche 1 → usePeerCore          (Ajax + signaling pur)               ◐ 5/10 items
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
- [x] `utils/createRateLimiter.test.js` — 9 tests ✅ (mécanique partagée hub star + `/ask-to-peer-id`)
- [-] Tâche 1 — `usePeerCore.test.js` — 34 tests ✅ (5/10 items couverts, 5 restants)
- [x] Tâche 2 — `usePeerConnections.test.js` — 47 tests ✅ (voir ci-dessous)
- [-] Tâche 3 — `usePeerMedia` — 34 tests ✅ répartis en deux fichiers : `.players` 15 (pool d'instances) + `.streams` 19 (flux locaux). Périmètre couvert
- [-] Tâche 4 — `usePeerTransport.*.test.js` — 66 tests ✅ (sécurité, recovery `peer-unavailable`, singleton/ref-counting/reconnexion et détachement des listeners du Peer couverts ; restent `sendData` star, câblage du rate limiting hub et `contextRegistry`)
- [x] Tâche 5 — `createPeerContext.test.js` — 52 tests ✅ (voir ci-dessous)
- [-] Tâche 6 — `usePeerOrchestrator.test.js` — **toujours à ne pas ouvrir en entier** : le wrapping du routage star doit d'abord déménager dans `usePeerTransport` (item `[L]` de la TODOLIST), sinon les tests sont à jeter. Exception ouverte : `usePeerOrchestrator.broadcastPresence.test.js` couvre le seul câblage de l'annonce de diffusion (aucune assertion sur le routage star, donc survit à ce déménagement)
- [ ] Tâche 7 — `useMediaBroadcast.test.js`
- [x] `useConnectionPool.test.js` — 31 tests ✅ : `requestOrConnectPeer` (6), logique de tentative/retry (8 — dont garde `isShuttingDown`, signalisation stale, connexion screen, clearRetry/clearAllRetries), `syncUsersConnections` (9 — lock concurrent, `waitForMeReady` négatif, nettoyage des partants, fan-out mesh/star-hub/star-client/sfu), recovery `peerUnavailableSignal` (3), cleanup (2)
- [x] `useStreamManager.test.js` — 19 tests ✅ : `handleStreamReceived` (clé canonique, résolution du slug, idempotence, mode stream sans player, éviction TTL et FIFO), `handleStreamRemoved` (départ complet, full stop conditionnel, garde par participant, dédoublonnage concurrent, libération de la garde sur exception)
- [x] `useSignalingQueue.test.js` — 19 tests ✅ : routage (table de routes, `payload` seul passé au handler, warn sur type inconnu, enveloppe `payload.type` des Widgets ignorée sans warn, warn sur signal sans aucun type), **absence de précondition asynchrone (non-régression : route sans attendre `waitForMeReady`, route même pendant un arrêt)**, détecteur de coalescence (`seq`), erreurs, cleanup (`stopSignaling` idempotent, démontage, plus rien routé après l'arrêt)
- [x] `useCallManager.test.js` — 73 tests ✅ : `startCallWithPeer` (dont « aucune mutation si appel en cours », room imposée, et **le Peer réclamé sans attendre son `'open'`** — l'ancienne branche « peer pas prêt » était une invention du mock, cf. TODOLIST), `acceptCallFromPeer` (dont **ordre mapping peerId avant transition**), `openCallBetweenPeer`, `stopCallWithPeers` (partial vs full, ordre du cleanup, mutex CLOSING, exception → pas de blocage), `remoteStopCall` (dont dédoublonnage concurrent), `handleRemoteDeparture` (séquence unifiée des deux chemins de départ), `resetCallState`, room d'appel, verbes FSM pour la couche streams, retries d'invitation, **registre `authorizedCallPeers`** (8 — marquage à l'acceptation et à l'ouverture, **un refus ne marque pas**, marquage même sans `options.peerId`, ordre marquage avant `requestOrConnectPeer`, purge au départ du pair sans toucher aux autres, purge totale au `resetCallState`)
- [x] `usePeerConnections.test.js` — 47 tests ✅ : `getRoomUsersDiff` (7 — arrivants/partants, filtrage de mon slug, `waitForMeReady` négatif, sérialisation du mutex, verrou non bloqué par une exception), `hasOpenConnection` (12 — data/media, fallback `signalingState`, `peerConnection` illisible, room d'appel prioritaire), `connectToPeer` (22 — gardes anti-soi/verrou/`MAX_PEERS_PER_ROOM`, branche par type, validations de config, métadonnées produites), `closePeerConnection` (7 — sélectif vs global, oubli conditionnel du peerId, `clearSignalQueue`)
- [x] `createPeerContext.test.js` — 52 tests ✅ : isolation/initialisation (6), `waitForMeReady` (5 — dont **non-régression du timer de secours** : aucun faux « a expiré » sur identité déjà prête), eventBus (3 — bus injecté, fallback no-op, bus incomplet rejeté), `setUpConnectionListeners` (17 — branchement, idempotence WeakSet, cleanup/rebranchement, garde de taille en réception, close métier unique, `handleClose` : retrait du store, oubli conditionnel du peerId, slug distant vs le mien, type forgé neutralisé), `storeConnectionEventCallbacks` (3), garde de teardown (2), helpers `currentCallUsers` (5), **registre des pairs d'appel autorisés** (6 — slug invalide refusé, auto-marquage refusé, purge unitaire sans toucher aux autres, purge totale, purge par `destroy()`), projections calculées (3), `destroy`/`onUnmounted` (4)
- [x] `usePeerMedia.streams.test.js` — 19 tests ✅ : `startCurrentStream` (4 — contraintes issues de `streamStates`, markRaw), `stopCurrentStream` (3), `startAudioStream` (2 — alignement de l'UI), `startScreenCapture`/`stopScreenCapture` (5), nettoyage de fin de vie d'un flux (5 — `ended`/`inactive`, idempotence du binding, désinscription, garde `instanceof MediaStream`)
- [x] `useBroadcastPresence.test.js` — 18 tests ✅ : émission (8 — annonce à l'ouverture d'une connexion, silence quand je ne diffuse pas, gardes de type sur la connexion, diffusion au changement d'état local, annonce d'arrêt, **aucun envoi si aucun pair joignable en data** — chemin normal au premier démarrage, routage laissé au transport en star, plus rien après `stopBroadcastPresence`), réception (6 — identité résolue depuis la connexion entrante *et* sortante, retrait sur `isBroadcasting: false`, **payload `from` ignoré (anti-usurpation)**, annonce consommée même sans pair résolu, messages métier non consommés), **star** (2 — côté client, une annonce relayée n'est pas attribuée au hub ; côté hub, l'annonce d'un client est bien enregistrée), purge au départ de la room (2)
- [x] `usePeerOrchestrator.broadcastPresence.test.js` — 6 tests ✅ : **intégration réelle** (contexte, stores et `setUpConnectionListeners` non mockés ; seul PeerJS l'est) du câblage de l'annonce — wrap `onDataReceived` posé même sans callback applicatif, annonce jamais remontée au métier, arité `(data, conn, metadata)` préservée pour le métier, retrait sur annonce d'arrêt, annonce émise à l'`open` d'une connexion data avec `conn` transmis au callback applicatif. Périmètre volontairement limité à la présence de diffusion (cf. Tâche 6)
- [x] `useAwaitedStreams.test.js` — 15 tests ✅ (UI) : **aucune attente pour un pair qui n'a rien annoncé** (le symptôme corrigé), attente sur annonce, arrêt d'attente à l'arrivée du flux (webcam ou écran), annonce d'un pair hors room ignorée, filet de délai (4 — abandon, non-abandon avant l'échéance, un timer par pair, flux de dernière seconde), pas de ré-attente après un arrêt, réarmement par une nouvelle annonce, tolérance aux `api` non réactives
- [x] `peers2Store.peerRuntime.test.js` — 15 tests ✅ (store) : runtime du Peer singleton — ref-counting planchéré à 0, garde d'init (**la promesse traverse le state réactif sans être enveloppée** : identité préservée, `await` intact), compteur de reconnexion, annulation réelle des deux timers avec retour booléen, `resetPeerState({ keepConsumerCount: true })` qui **préserve** le compteur après un échec d'init pour qu'un retry reparte d'un compte juste, et la **closure de détachement des listeners du Peer** : identité préservée elle aussi (une fonction n'est jamais proxifiée), exécutée-puis-oubliée, exécutée avant d'être remplacée, absorbée si elle jette sans interrompre le reset
- [x] `MediaBroadcastPlayer.spinner.test.js` — 9 tests ✅ (UI) : overlay d'attente d'image sur un flux **déjà reçu** — piloté par les events réels du `<video>` (`can-play`, `playing`, `waiting`, `stalled`, `error`), neutralisé sans flux, sans vidéo active ou avec slot `video` fourni, réarmé sur instance recyclée par le pool

---

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
