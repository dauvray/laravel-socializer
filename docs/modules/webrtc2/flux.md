# WebRTC2 — Flux

> **À quoi ça sert :** les quatre séquences du module, de l'action utilisateur au flux vidéo.
> **Quand le lire :** quand quelque chose n'arrive pas — un appel qui reste en « pending », un
> arrivant qui ne voit rien, un écran qui n'apparaît que parfois.

Le symptôme utilisateur de **tous** les incendies du module a été le même — « A diffuse, B
arrive, B ne voit rien » — avec chaque fois une cause racine différente. Les sections
« ⚠️ où ça casse » ci-dessous listent celles déjà vues, pour ne pas les rechasser.

---

## Appel sortant (visio / vocal)

```
CallRemotePeerBtn.vue
  └─ eventBus.$emit('call-user', slug, type)
System/Notifications.vue           ($on('call-user') → onStartCall)
  └─ peers.startCallWithPeer({ toUserSlug, type })
useCallManager.startCallWithPeer
  ├─ transport.setLocalPeer()               ← ni await ni garde sur le retour (voir plus bas)
  ├─ callMachine.transition(CALLING)
  ├─ ensureCurrentCallRoomId()              ← crypto.randomUUID()
  ├─ ctx.addCurrentCallUser(...)
  └─ core.requestAuthorizationRemotePeerId({ toUserSlug, type })
       └─ POST /send-alert-to-user
          options = { type, action: 'peer-access-permission', room, peerId, inviteId }
          + re-planification par inviteRetryManager (usePeerRetry)

  … le distant accepte …

Reverb .ResponseToAuthorizationPeer → Notifications.vue
  ├─ peers.stopCallInviteRetry(inviteId)
  └─ peers.openCallBetweenPeer(event)
useCallManager.openCallBetweenPeer
  ├─ core.stopCallInviteRetryForUser(...)
  ├─ peerStore.addRemotePeerId(fromUserSlug, options.peerId)
  ├─ callMachine.transition(CONNECTED)
  ├─ _enterCallSession()   → media.startCurrentStream() + createVideoElement('local-webcam')
  └─ pool.requestOrConnectPeer(fromUserSlug)
       └─ usePeerConnections.connectToPeer → peer.call(peerId, stream, config)
```

⚠️ **`setLocalPeer()` n'est ni attendu ni testé.** C'est volontaire : la fonction est `async`
(donc toujours truthy) et sort par `undefined` sur ses chemins « rien à faire », **y compris
quand le peer est déjà prêt**. L'attente de l'identité locale se fait en aval par
`waitForMeReady`. Un `const ready = setLocalPeer(); if (!ready) return` est un garde mort — et
inversé dans le cas nominal.

---

## Appel entrant

```
Reverb .AlertToUser → Notifications.vue
  ├─ peers.isInviteDuplicate(inviteId)      ← dédoublonnage
  └─ affiche System/widgets/AlertComponent.vue

  … l'utilisateur répond …

onResponseAlert(fromUserSlug, options, status)
  └─ case 'peer-access-permission' → peers.acceptCallFromPeer({ fromUserSlug, options, status })
useCallManager.acceptCallFromPeer
  ├─ transport.setLocalPeer()
  ├─ peerStore.addRemotePeerId(fromUserSlug, options.peerId)   ← AVANT la transition
  ├─ callMachine.transition(RECEIVING)
  ├─ _enterCallSession()
  └─ core.sendAuthorizationRemotePeerId()
       └─ POST /response-to-authorization-peer
          (le peerId LOCAL n'y est injecté que si `status` est vrai)

  … le peer.call() de l'initiateur arrive …

usePeerTransport, dispatcher bind('call', …)
  ├─ sanitizeMetadataType(metadata.type)
  ├─ resolveContextByMetadata(metadata.callbackKey)
  ├─ _isAuthorizedIncomingPeer(metadata, conn, ctx)            ← garde d'admission
  ├─ waitForLocalStream()                                       ← watch réactif, STREAM_WAIT_TIMEOUT_MS
  ├─ call.answer(localStream)
  └─ setUpConnectionListeners(call)

  … le flux arrive …

orchestrateur, wrap onStreamReceived
  └─ useStreamManager.handleStreamReceived
       ├─ remoteStreamsMap[`${slug}-${type}`] = { stream, remoteSlug, remoteType, … }
       ├─ callManager.markCallConnected()   (RECEIVING → CONNECTED)
       └─ media.createVideoElement(`remote-<slug>-<type>`)   (sauf en mode `stream`)
```

⚠️ **L'ordre `addRemotePeerId` avant la transition est une précondition de sécurité**, pas un
détail : c'est ce mapping que `_isAuthorizedIncomingPeer` consulte pour autoriser un appel
direct hors room. Et il doit être posé **avant** que `sendAuthorizationRemotePeerId` n'écrase
`payload.options.peerId` avec le peerId **local**.

---

## Rejoindre une room (diffusion / chat)

```
useReverbPresence(channel)          ← liste `users` (canal de présence Reverb)
  └─ MediaBroadcastProvider.vue : watch(() => props.users, api.watchUsers, { immediate: true })
useMediaBroadcast.watchUsers
  └─ useConnectionPool.syncUsersConnections(users)
       ├─ await ctx.waitForMeReady()
       ├─ connections.getRoomUsersDiff(users)      ← mutex à chaîne de promesses (anti-TOCTOU)
       ├─ nettoyage des removedUsers
       └─ fan-out selon la topologie :
            mesh  → requestOrConnectPeer(arrivant)  (+ 'screen' si isCapturing)
            star  → hub : tous ; client : seulement hubSlug
useConnectionPool.requestOrConnectPeer
  ├─ remotePeerId connu ?  → connections.connectToPeer directement
  ├─ sinon                 → core.requestRemotePeerConnection(userSlug, type)
  │                            └─ POST /ask-to-peer-id
  └─ dans les deux cas     → retryManager.scheduleRetry(userSlug, 0, _handleConnectionAttempt)

  … à l'ouverture d'une connexion data …

useBroadcastPresence.announceBroadcastStateTo(conn)  → BROADCAST_STATE
```

`BROADCAST_STATE` à l'ouverture de connexion est **le** chemin qui informe un arrivant qu'un
pair diffuse déjà. C'est le seul instant fiable : un `watch` sur `usersInRoom` serait trop tôt,
le canal n'existe pas encore.

### Comment un arrivant sait qui diffuse

`ctx.media.announcedStreamsMap` (projeté par `ctx.announcedStreamPeers`) est alimenté par **deux
chemins exacts et complémentaires** — c'est un fait, plus une heuristique :

1. **Annonce `BROADCAST_STATE`** sur le data channel (`useBroadcastPresence`), émise au changement
   d'état local **et** à l'ouverture de chaque connexion data.
2. **Trace de l'appel one-way entrant** (`usePeerTransport`, `peer.on('call')`) : un tel appel
   n'existe que si l'émetteur a un flux vivant, et l'événement arrive **avant ICE**, donc avant le
   `stream`. C'est ce qui couvre « A diffuse déjà, B arrive » — que l'annonce seule ne couvre pas,
   la connexion data d'un contexte `stream` naissant *avec* l'appel média.

Avant ce mécanisme, `useAwaitedStreams` attendait **tout** pair de `usersInRoom` sans flux : tout
membre non-diffuseur affichait un spinner pendant `AWAITED_STREAM_TIMEOUT_MS`, et un flux plus lent
que ce délai n'en affichait plus.

**Fenêtre non couverte, et pourquoi** : entre le démarrage d'une diffusion et le premier contact P2P
(échange de peerId + backoff de retry), rien n'est observable localement — aucun canal n'existe.
Seule une annonce côté **serveur** (présence Reverb) la couvrirait ; hors périmètre front.
**Limite star** : le hub retransmet `envelope.payload` tel quel, l'identité d'origine est perdue
au-delà de lui — seul le hub enregistre les annonces de ses clients (même limite que
`AUDIO_MUTE_TOGGLE`).

### Où ça casse — causes racines déjà vues

| Symptôme | Cause racine | Correctif en place |
|---|---|---|
| B arrive, ne voit rien, **muet**, intermittent | une précondition (`waitForMeReady`, `isShuttingDown`) posée dans le **routage** des signaux : un signal abandonné là l'est définitivement | le routage ne pose aucune précondition ([architecture.md](architecture.md#le-routage-ne-pose-aucune-précondition)) |
| B arrive, `Could not connect to peer <uuid>` en console | peerId périmé « collant » — plus rien ne pouvait l'invalider (`removeRemotePeerId` est **conditionnel**, et le contexte permanent `data-app` maintient le pair présent dans `connections['app']`) | `peerStore.invalidateRemotePeerId` (suppression inconditionnelle + purge du drapeau d'attente) |
| Écran non reçu, ~1 fois sur 2 | `requestRemotePeerConnection` n'envoyait jamais `type: 'screen'` — l'écran ne reposait que sur le moteur de retry, ~1,5 s plus tard | champ `connectionType` distinct ([signalisation](../../architecture/signalisation.md)) |
| Écran non reçu quand A ne diffuse **que** son écran | `return` prématuré en fin de branche « type principal » de `_handleConnectionAttempt`, avant la tentative `screen` | tentatives indépendantes, décision accumulée dans `settled` |
| Connexion jamais rouverte après un flux pas encore prêt | `_handleConnectionAttempt` faisait `return true` (= annuler le retry) dès que `connectToPeer` renvoyait `true`, qui signifie « pas d'erreur », pas « connexion ouverte » | prédicat `_canEmitStreamFor(type)` |
| B reste sur le spinner, `Could not connect to peer <uuid>` | deux `Peer` créés dans la fenêtre entre `peerInitPromise` retombée et `'open'` reçu ; le premier, débranché, restait enregistré côté serveur PeerJS | garde d'instance ([architecture.md](architecture.md#le-peer-peerjs--un-seul-par-onglet)) |
| Page à plusieurs providers : le contexte `stream` ne demande **jamais** le peerId de l'arrivant (les autres rooms, si) | `waitingRemotePeerId` indexé sur le slug seul : le premier contexte à demander posait un drapeau que les suivants lisaient comme « demande déjà en vol » | clé `slug\|room\|type` ([architecture.md](architecture.md#un-onglet-plusieurs-contextes--la-granularité-des-clés-du-store)) |
| B revient après un rechargement, A rappelle son ancien peerId sans jamais redemander le nouveau | `removeRemotePeerId` conditionné à `connections`, no-op permanent dès la 2ᵉ room ; et le peerId frais jeté quand `connectToPeer` sortait par « déjà connecté » | prédicat de présence `roomMembers` + enregistrement du peerId **avant** les gardes |
| Appel `vocal` : aucun flux ne part | pas de branche `vocal` dans `connectToPeer`, et le `return true` final annulait le retry | fusionnée avec la branche `visio` (mêmes préconditions de flux) |
| Appel direct : le flux arrive, mais les deux vignettes affichent « Inconnu 👁 0 » (et ma voix me revient) | `usePeerMedia._acquireSlot` forçait `metadata: {}`. Les seuls champs transmis au player du pool (`nickname`, `peer`, `roomId`) ne sont pas des props déclarées de `MediaBroadcastPlayer` : ils retombaient en attributs HTML. Le player n'affichant QUE `streamData.metadata`, tout flux passé par le pool était anonyme — et `isMe` absent laissait le player local non muté | `options.metadata` transmis par le pool, construit par `useStreamManager.handleStreamReceived` (distant) et `useCallManager._enterCallSession` (local) |

---

## Départ d'un pair

Deux transports, une seule séquence. Voir
[architecture.md § Départ d'un pair](architecture.md#départ-dun-pair--un-fait-métier-deux-transports)
pour le rationale.

```
signal serveur .CloseConnectionToPeerID → remoteStopCall ─┐
fermeture de connexion PeerJS → handleStreamRemoved ──────┤
                                                          ▼
                                    useCallManager.handleRemoteDeparture
                                      ├─ garde par participant (closingUsers) + try/finally
                                      ├─ purge remoteStreamsMap  (le type fermé, sur entry.remoteSlug)
                                      ├─ purge announcedStreamsMap
                                      ├─ clearRetry(userSlug) + fermeture du transport
                                      ├─ removeCurrentCallUser
                                      └─ close-call  (idempotent par contrat)
```

Filet indépendant des événements de fermeture : `handleStreamReceived` écoute `ended` / `inactive`
sur les pistes du flux reçu. C'est ce qui autorise `_purgePeerStreams` à ne retirer que le type
fermé sans risque de fuite.
