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
  ├─ transport.setLocalPeer()               ← nu, et il DOIT le rester (voir plus bas)
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

⚠️ **`setLocalPeer()` est appelée nue ici, et elle DOIT le rester.** La valeur ne dit rien (la
fonction est `async`, donc toujours truthy, et sort par `undefined` sur ses chemins « rien à
faire », **y compris quand le peer est déjà prêt** : un `if (!ready) return` est un garde mort,
inversé dans le cas nominal). Mais depuis que sa promesse ne se règle qu'à l'`'open'`,
**l'attendre** aurait un sens — et ce serait une régression sur ces deux sites précis :

- `acceptCallFromPeer` pose `addRemotePeerId` huit lignes plus bas, qui doit précéder l'arrivée
  du `peer.call` de l'initiateur. Un `await` de plusieurs secondes intercalé fait refuser cet
  appel entrant par `_isAuthorizedIncomingPeer`, et **un refus ne revient jamais à l'émetteur** ;
- `startCallWithPeer` place `callMachine.transition(CALLING)` **avant son premier `await`** :
  l'awaiter y déplacerait la transition après un point de suspension, donc deux clics rapides
  passeraient tous deux le garde.

  > ℹ️ Le verbe est `async` depuis le 2026-08-31 (il attend le verdict de
  > `requestAuthorizationRemotePeerId` et le rend à son appelant), et **cela ne change rien à ce
  > qui précède** : un corps `async` s'exécute synchronement jusqu'à son premier `await`, et la
  > transition est au-dessus. C'est la ligne de partage à retenir — awaiter `setLocalPeer()`
  > reste interdit pour cette raison exacte, awaiter l'émission de l'invitation ne l'est pas.

L'invitation part sans attendre l'ouverture : c'est `waitForMeReady` qui porte cette attente, en
aval, et qui meurt avec son contexte.

### Refus du distant : le même chemin, jamais un raccourci

Un refus arrive par **le même signal** que l'acceptation, avec `status: false` — c'est aussi la
forme que prend une **non-réponse** : les deux alertes s'auto-refusent seules, `VideoCallAlert` au
bout de 10 s et `AudioCallAlert` au bout de 20 s. Ce minuteur **meurt avec l'alerte** : répondre ou
quitter l'écran l'annule, comme la sonnerie, sur le chemin commun `stopAlert()` — épinglé par
`AlertComponent.timers.test.js`, le seul fichier du paquet à monter un composant sous horloge
factice.

```
Reverb .ResponseToAuthorizationPeer (status: false) → Notifications.vue
  ├─ toast « <slug> est injoignable » + eventBus close-call     ← UI seule, n'AGIT PAS sur la FSM
  └─ peers.openCallBetweenPeer(event)                           ← branche !status
useCallManager.openCallBetweenPeer
  ├─ core.stopCallInviteRetryForUser(...)
  ├─ ctx.removeCurrentCallUser(fromUserSlug)
  └─ dernier participant ? → stopCallWithPeers([], false, {mode:'full'})
                               → CALLING → CLOSING → IDLE
```

⚠️ **`openCallBetweenPeer` doit être appelé AUSSI sur refus** : sa branche `!status` est le seul
chemin qui retire le participant et ramène la FSM à IDLE. Ni le toast ni `close-call` ne touchent
à l'état d'appel. Un `return` posé après le toast — ce qu'a fait `Notifications.vue` — laisse
`callStatus` bloqué sur `calling`, donc le spinner de `CallManagerBtn` (`v-if="status !== 'idle'"`)
affiché jusqu'au rechargement de la page. Gardé par `components/System/__tests__/Notifications.test.js`.

### Personne ne répond : l'abandon du retry est le seul signal

Si le destinataire n'a **aucun onglet ouvert**, *aucun* `.ResponseToAuthorizationPeer` ne part : il
n'y a pas de refus à recevoir. Le seul événement disponible est l'épuisement du moteur de retry
d'invitation — `MAX_RETRY_ATTEMPTS` tentatives, backoff plafonné à 10 s, soit ≈55 s.

```
usePeerRetry épuisé → usePeerCore.onAbandoned
  ├─ stopCallInviteRetryForUser(slug)                      ← purge l'entrée slug → inviteId
  └─ ctx.inviteAbandonedSignal = { userSlug, type }
watch dans Notifications.vue
  ├─ remise du signal à null, AVANT l'await                ← un second abandon doit repasser
  ├─ toast « <slug> n'a pas répondu » + eventBus close-call   ← UI seule, n'AGIT PAS sur la FSM
  └─ peers.openCallBetweenPeer({ status: false })             ← la branche du refus, réutilisée
```

⚠️ **Un signal réactif, pas un callback.** `usePeerCore` est la couche la plus basse : elle ne
connaît ni la FSM ni l'UI, et recevoir `stopCallWithPeers` serait un callback vers une couche
supérieure, ce que [l'ordre des couches](architecture.md) interdit. Le signal vit donc sur
`createPeerContext`, comme `peerUnavailableSignal`, et remonte par `usePeerOrchestrator` puis
`useMediaBroadcast`. Le `type` transporté est `session.currentType`, que `startCallWithPeer` pose
**avant** d'émettre l'invitation — la même valeur que celle de la clé de retry.

Le libellé du toast diffère de celui du refus (« n'a pas répondu » vs « est injoignable ») : sur une
capture d'écran, il dit lequel des deux chemins s'est produit. Gardé par
`__tests__/usePeerCore.test.js` (le signal, et son absence tant qu'il reste des tentatives) et
`components/System/__tests__/Notifications.test.js` (les trois gestes, et la consommation du signal).

### L'invitation ne part pas : aucun peerId local publiable

Le troisième chemin d'échec, et il arrive **plus tôt** que les deux autres : la FSM est déjà en
CALLING quand `requestAuthorizationRemotePeerId` refuse d'émettre, faute de peerId local publiable.
Refuser est le bon geste — une invitation partie avec un id nul ne se corrige plus, le destinataire
peut accepter, il n'a aucun id vers lequel se connecter.

```
useCallManager.startCallWithPeer
  ├─ callMachine.transition(CALLING)                       ← AVANT le premier await : le mutex tient
  ├─ inviteId = await core.requestAuthorizationRemotePeerId(...)
  └─ !inviteId ?
       ├─ await openCallBetweenPeer({ status: false })     ← la branche du refus, réutilisée
       └─ return null                                      ← le verdict, rendu à l'appelant
Notifications.onStartCall
  ├─ toast « Appel vers <slug> impossible pour l'instant »
  └─ close-call, SI je ne suis pas déjà en appel avec ce pair   ← sinon on réarmerait son bouton
```

⚠️ **Ce chemin n'était fermé nulle part avant le 2026-08-31, et c'était le pire des trois.** Le
`return null` de `usePeerCore` précède l'armement du moteur de retry : ni `.ResponseToAuthorizationPeer`
ni `inviteAbandonedSignal` ne pouvaient donc arriver. La FSM restait en CALLING **pour la vie de
l'onglet**, et par ordre de gravité : `CallManagerBtn` n'affiche qu'un spinner dans cet état, donc
**aucune sortie** ; `transition(CALLING)` depuis `calling` étant invalide, **plus aucun appel
possible vers personne** ; la session restait polluée ; et seulement en quatrième, le bouton du mur
restait désactivé. Le commentaire de `usePeerCore` affirmait « l'utilisateur peut rappeler » : c'est
vrai depuis, faux avant.

⚠️ **Le garde « déjà participant » du `close-call` n'est pas décoratif** : `startCallWithPeer` refuse
aussi quand un appel est en cours — ce pair-là compris. Émettre sans vérifier réarmerait son bouton
d'appel **pendant** la conversation.

Gardé des deux côtés, et les deux moitiés sont mesurées mutuellement aveugles : retirer la reprise
rougit 3 cas de `__tests__/useCallManager.test.js` et **0** de `Notifications.test.js` ; retirer le
toast rougit 2 cas de `Notifications.test.js` et **0** de l'autre.

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
  └─ useConnectionPool.syncUsersConnections(users)  ← verrou COALESCENT : la dernière liste gagne
       ├─ await ctx.waitForMeReady()
       ├─ connections.getRoomUsersDiff(users)      ← mutex à chaîne de promesses (anti-TOCTOU)
       ├─ nettoyage des removedUsers
       └─ fan-out selon la topologie :
            mesh  → requestOrConnectPeer(arrivant)  (+ 'screen' si isCapturing)
            star  → hub : tous ; client : le hub SEULEMENT s'il est membre et rien d'établi
useConnectionPool.requestOrConnectPeer
  ├─ remotePeerId connu ?  → connections.connectToPeer directement
  ├─ sinon                 → core.requestRemotePeerConnection(userSlug, type)
  │                            └─ POST /ask-to-peer-id
  └─ dans les deux cas     → retryManager.scheduleRetry(userSlug, 0, _handleConnectionAttempt)

  … à l'ouverture d'une connexion data …

useBroadcastPresence.announceBroadcastStateTo(conn)  → BROADCAST_STATE
```

`BROADCAST_STATE` à l'ouverture de connexion est le chemin qui informe un arrivant qu'un pair
diffuse déjà **sur le data channel**. C'est le seul instant fiable pour ce transport-là : un `watch`
sur `remotePeers` serait trop tôt, le canal n'existe pas encore. Le whisper de présence, lui, n'a
rien à attendre — c'est justement pourquoi il existe (§ suivant, chemin 4).

### Comment un arrivant sait qui diffuse

`ctx.media.announcedStreamsMap` (projeté par `ctx.announcedStreamPeers`) est alimenté par **quatre
chemins exacts et complémentaires** — c'est un fait, plus une heuristique. Le `source` enregistré
avec chaque entrée dit lequel des quatre a parlé :

1. **Annonce `BROADCAST_STATE`** sur le data channel (`useBroadcastPresence`, source `signal`),
   émise au changement d'état local **et** à l'ouverture de chaque connexion data.
2. **Trace de l'appel one-way entrant** (`usePeerTransport`, `peer.on('call')`, source `call`) : un
   tel appel n'existe que si l'émetteur a un flux vivant, et l'événement arrive **avant ICE**, donc
   avant le `stream`. C'est ce qui couvre « A diffuse déjà, B arrive » — que l'annonce seule ne
   couvre pas, la connexion data d'un contexte `stream` naissant *avec* l'appel média.
3. **État embarqué sur les deux routes de peerId** (`isBroadcasting` sur `.AskToPeerID` et
   `.ResponseToPeerID`, source `peer-id`) : le premier chemin qui n'exige **aucun** contact P2P.
   `usePeerCore` y joint son propre `ctx.isBroadcasting` à chaque demande et à chaque réponse ;
   la table `routes` de l'orchestrateur le note avant de déléguer
   (`useBroadcastPresence.noteBroadcastFromSignal`).
4. **Whisper sur le canal de présence Reverb** (`webrtc2-broadcast-state`, source `presence`) : le
   seul chemin qui n'emprunte **rien** à la signalisation P2P — ni route, ni peerId, ni canal data.
   Émis par le diffuseur au changement d'état local **et** à chaque arrivée observée dans
   `remotePeers` (un client event ne s'historise pas : l'arrivant ne peut rien savoir d'un état
   antérieur à son arrivée, c'est donc au diffuseur de re-parler).

Avant ce mécanisme, `useAwaitedStreams` attendait **tout** pair de `remotePeers` sans flux : tout
membre non-diffuseur affichait un spinner pendant `AWAITED_STREAM_TIMEOUT_MS`, et un flux plus lent
que ce délai n'en affichait plus.

**Pourquoi le troisième chemin existe** : avec les deux premiers seuls, un arrivant qui ne diffuse
pas n'ouvre **rien** (`connectToPeer` n'ouvre en contexte `stream` qu'avec un flux local valide) — il
ne pouvait donc rien apprendre avant le `peer.call` du diffuseur, soit un échange de peerId complet
et, à défaut, le pas de retry suivant (t ≈ 1 s, 3 s, 7 s…). L'écran restait vide sans le moindre
spinner, ce qui se lit comme une panne. Le champ voyage sur des POST qui partaient déjà : ni route,
ni canal, ni plafond nouveau.

⚠️ **Ce chemin marque, il ne purge JAMAIS sur `isBroadcasting: false`.** `BROADCAST_STATE` peut
purger : data channel ordonné, émis au changement d'état. Un signal de peerId est un instantané sur
un chemin HTTP + Reverb sans garantie d'ordre — un `false` en retard effacerait une annonce vraie.
L'arrêt de diffusion garde ses purges existantes (`handleRemoteDeparture`, `BROADCAST_STATE: false`)
et le filet `AWAITED_STREAM_TIMEOUT_MS`.

**Pourquoi le quatrième existe** : les trois premiers partagent une limite structurelle — **ils ne
disent rien quand il n'y a rien à demander.** `requestOrConnectPeer` ne poste sur les routes de
peerId que si le peerId distant n'est **pas** déjà connu sous bail (`useConnectionPool.js`, lecture
de `getDialableRemotePeerId` avant l'alternative connexion directe / demande). Un contexte qui
remonte avec un bail encore valide — cas nominal, et **majoritaire**, d'une navigation SPA à
l'intérieur de `REMOTE_PEER_ID_LEASE_MS` — se connecte directement, **sans POST, donc sans porteur
pour `isBroadcasting`** ; et en contexte `stream` un non-diffuseur n'ouvre pas de canal data, ce qui
ferme aussi le chemin 1. Il ne restait alors que le `peer.call` du diffuseur (chemin 2) : mesuré le
28/08/2026, vignette à **8 811 ms** sur un run et **jamais** sur l'autre. Le whisper est indépendant
de tout ça — un saut WebSocket sur un canal déjà rejoint et déjà autorisé — et il ferme du même
geste le **client non-hub en star**, qui ne demande jamais le peerId d'un diffuseur autre que le hub.
Épinglé par `scenarios/lateJoiner.test.js`, § « le peerId d'A est déjà connu sous bail », dont la
contre-épreuve (mêmes coupures, sans canal) est la mesure du 28/08 sous forme de test.

**Ce qui reste non couvert**, et ce n'est plus un problème de porteur mais d'**affichage** :
`useAwaitedStreams` intersecte les annonces avec `remotePeers`, écrit derrière `waitForMeReady`. Le
fait arrive donc avant que la vignette puisse s'afficher, et l'attente est celle du peerId local —
mesurée à 592 ms. L'annuaire d'identité, lui, est volontairement écrit **devant** cette barrière
(`_rebuildSlugDirectory`) : sans ça un whisper arrivé tôt serait rejeté définitivement, faute d'être
traduisible.

> ⚠️ **Deux conditions pour que le chemin 4 existe, et aucune n'est dans le paquet.**
> 1. L'hôte doit fournir son canal : `provide(REVERB_CHANNEL, reverb)` au-dessus des
>    `MediaBroadcastProvider` (cf. `Exemples/Home.vue`). Sans lui, tout fonctionne comme avant —
>    l'injection est optionnelle par contrat.
> 2. Reverb doit être en `accept_client_events_from: 'members'`. Sous `'all'` il retransmet les
>    client events **bruts**, sans attribution : la réception est alors *fail-closed* et journalise
>    la cause une fois. Voir [securite.md](securite.md#identité--jamais-le-champ-déclaratif).

### Lire l'état du Peer local

**`peerIdentity()` est le seul chemin de lecture.** Aucun code de production ne lit un champ brut
du Peer — ni `peerPhase`, ni `lastLocalPeerId`, ni `localPeer.destroyed`. Six prédicats
répondaient chacun à sa façon à « ai-je un peer utilisable, et quel est son id ? », ils
divergeaient, et cette divergence était la cause commune de la plupart des pannes du module.

| Verbe | Rend | À quoi il sert |
|---|---|---|
| `peerStore.peerIdentity()` | `{ state, id, lastId, consumers }`, `state` parmi `absent` · `creating` · `connecting` · `ready` · `disconnected` · `destroyed` | LE fait : l'état du Peer et son identité |
| `peerStore.peerStateViolations()` | les contradictions présentes, chacune avec un `code` stable | confronter le **déclaré** à l'**observé** |
| `peerStore.auditPeerState('<transition>')` | idem, **et** hurle sur `console.error` | dire quelle transition a produit la contradiction |

`id` est l'identité **courante**, `lastId` l'identité **historique**, et leur divergence était le
cœur de la panne la plus silencieuse du module : `Peer.disconnect()` met `_id` à `null` alors que
`lastLocalPeerId` reste posé, et `waitForMeReady` ne consultait que le second — l'onglet se croyait
joignable, ne répondait plus à aucune demande de peerId, et rien ne le disait. **La barrière lit
désormais l'identité courante** ; ce qui l'épingle, ce sont les trois cas
« ne répond pas prêt sur un peer détruit / déconnecté sans recours / attend la fin d'un backoff »
de `createPeerContext.test.js`. Le code `id-historique-sur-peer-inutilisable` reste : l'état est
toujours atteignable, seul son exploitant a disparu.

Son jumeau `id-historique-sans-peer`, lui, n'a plus de **producteur** : le `.catch` d'init nullait
`localPeer` en préservant l'id historique — pour ce même `waitForMeReady` — et oublie désormais les
deux faits ensemble. Le code reste pour la raison ci-dessus, mais un audit qui rougirait dessus
après un échec d'init signale un chemin qui a recommencé à garder l'un sans l'autre.

#### La phase, et ce qu'elle ne décide pas

Un seul fait est **déclaré** — `peerPhase`, dans le store (`absent` · `creating` · `connecting` ·
`ready` · `disconnected`), écrit par les transitions `markPeerCreating` / `markPeerConnecting` /
`markPeerOpen(id)` / `markPeerDisconnected` / `markPeerAbsent`, appelées par le seul
`usePeerTransport`. Il fallait un fait **réactif** : `localPeer` est `markRaw`, donc les mutations
internes du `Peer` sont invisibles à Vue et aucun `watchEffect` — celui de `waitForMeReady` en
particulier — ne serait réveillé par une reconnexion.

Deux règles, et elles sont ce qui empêche la phase de devenir un septième prédicat menteur :

- **L'observation l'emporte sur la déclaration.** `destroyed` / `disconnected` sont écrits par
  PeerJS ; une phase qui prétendrait `ready` sur un peer détruit n'est pas crue par
  `peerIdentity()`, elle est signalée (`pret-mais-detruit`).
- **Une transition inattendue est appliquée, jamais refusée** — l'inverse de
  `useCallStateMachine`, qui arbitre des actions et refuse. Ici la phase ne fait que SUIVRE une
  bibliothèque tierce : refuser la laisserait décrire un peer qui n'existe plus. Elle est donc
  appliquée et journalisée (`[WebRTC2][peerFSM]`). Épinglé par `peers2Store.peerRuntime.test.js` ›
  « APPLIQUE une transition inattendue, en la journalisant ».

> ⚠️ **Les trois verbes du tableau sont des getters rendant une FONCTION**, comme
> `getWaitingRemotePeerId`, et pour la même raison que ci-dessus : sur un `Peer` `markRaw`, un
> `computed` servirait un état partiellement périmé — pire qu'un état absent pour un outil
> d'observation. Ce qui est réactif, c'est la phase ; ce qui est juste, c'est le getter.

#### Lire, et attendre : ce ne sont pas les mêmes verbes

| Ce qu'on veut | Le verbe | Sa portée |
|---|---|---|
| l'état, maintenant | `peerStore.peerIdentity()` | l'onglet, sans attente |
| que le pair soit joignable, **dans ce contexte** | `ctx.waitForMeReady()` | le contexte : meurt avec lui (`destroy()` résout à `false`), `ME_READY_TIMEOUT_MS` |
| que l'init en cours ait abouti ou échoué | `await transport.setLocalPeer()` | l'onglet : la promesse ne se règle qu'à l'`'open'`, à une erreur ou au délai |

Ce ne sont pas trois réponses à la même question : la promesse d'init porte le **moment**,
`peerIdentity()` le **verdict**, `waitForMeReady` l'attente **contextuelle**. Un consommateur qui
veut savoir « puis-je publier mon peerId ? » lit `peerIdentity()` ; un consommateur qui veut
attendre lit `waitForMeReady` — pas la promesse d'init, qui ne sait rien du démontage de son
contexte. Et **le routage des signaux n'attend rien du tout**, cf.
[architecture.md § Le routage ne pose aucune précondition](architecture.md#le-routage-ne-pose-aucune-précondition).

Côté journal, toute destruction du Peer nomme sa **cause** (`_schedulePeerDestroy` /
`_destroyPeerSingleton`) et son peerId, relevé **avant** le `destroy()` — après, `disconnect()` l'a
déjà mis à `null`. Sans ça, une destruction volontaire, un rechargement de page et une coupure
réseau produisent la même trace des deux côtés, et il faut croiser à la main les logs du serveur
PeerJS avec les `GET /app` de nginx pour les distinguer.

### Où ça casse — causes racines déjà vues

| Symptôme | Cause racine | Correctif en place |
|---|---|---|
| B arrive, ne voit rien, **muet**, intermittent | une précondition (`waitForMeReady`, `isShuttingDown`) posée dans le **routage** des signaux : un signal abandonné là l'est définitivement | le routage ne pose aucune précondition ([architecture.md](architecture.md#le-routage-ne-pose-aucune-précondition)) |
| B arrive, `Could not connect to peer <uuid>` en console | peerId périmé « collant » — plus rien ne pouvait l'invalider (`removeRemotePeerId` est **conditionnel**, et le contexte permanent `data-app` maintient le pair présent dans `connections['app']`) | `peerStore.invalidateRemotePeerId` (suppression inconditionnelle + purge du drapeau d'attente) |
| Écran non reçu, ~1 fois sur 2 | `requestRemotePeerConnection` n'envoyait jamais `type: 'screen'` — l'écran ne reposait que sur le moteur de retry, ~1,5 s plus tard | champ `connectionType` distinct ([signalisation](../../architecture/signalisation.md)) |
| Écran non reçu quand A ne diffuse **que** son écran | `return` prématuré en fin de branche « type principal » de `_handleConnectionAttempt`, avant la tentative `screen` | tentatives indépendantes, décision accumulée dans `settled` |
| Connexion jamais rouverte après un flux pas encore prêt | `_handleConnectionAttempt` faisait `return true` (= annuler le retry) dès que `connectToPeer` renvoyait `true`, qui signifie « pas d'erreur », pas « connexion ouverte » | prédicat `_canEmitStreamFor(type)` |
| B reste sur le spinner, `Could not connect to peer <uuid>` | deux `Peer` créés dans la fenêtre entre `peerInitPromise` retombée et `'open'` reçu ; le premier, débranché, restait enregistré côté serveur PeerJS | la fenêtre n'existe plus : `peerInitPromise` couvre jusqu'à l'`'open'`, la garde d'instance n'est plus que la ceinture ([architecture.md](architecture.md#le-peer-peerjs--un-seul-par-onglet)) |
| Le pair n'est jamais joignable, aucune erreur, un F5 répare | `'open'` jamais reçu : le `Peer` restait vivant en phase `connecting`, et la garde d'instance interdisait toute ré-init pour la vie de l'onglet | `PEER_OPEN_TIMEOUT_MS` — l'init abandonne **et détruit** ([architecture.md](architecture.md#linit-se-termine-à-lopen-jamais-à-la-construction)) |
| Page à plusieurs providers : le contexte `stream` ne demande **jamais** le peerId de l'arrivant (les autres rooms, si) | `waitingRemotePeerId` indexé sur le slug seul : le premier contexte à demander posait un drapeau que les suivants lisaient comme « demande déjà en vol » | clé `slug\|room\|type` ([architecture.md](architecture.md#un-onglet-plusieurs-contextes--la-granularité-des-clés-du-store)) |
| B revient après un rechargement, A rappelle son ancien peerId sans jamais redemander le nouveau | `removeRemotePeerId` conditionné à `connections`, no-op permanent dès la 2ᵉ room ; et le peerId frais jeté quand `connectToPeer` sortait par « déjà connecté » | prédicat de présence `roomMembers` + enregistrement du peerId **avant** les gardes |
| Appel `vocal` : aucun flux ne part | pas de branche `vocal` dans `connectToPeer`, et le `return true` final annulait le retry | fusionnée avec la branche `visio` (mêmes préconditions de flux) |
| A diffuse, B arrive, rien ; `Could not connect to peer <uuid>` chez **A** (celui qui diffuse), aléatoire et de longue date | le serveur PeerJS fauche tout pair 60 s après son dernier `HEARTBEAT` (`alive_timeout`) ; le client émet alors `disconnected`, et le `setTimeout` de reconnexion exécutait `peer.id = …` **avant** `peer.reconnect()`. Or `id` est un accesseur **sans setter** (peerjs 1.5.4) et un module ES est en mode strict : `TypeError`, `reconnect()` jamais atteint. Le peer restait mort jusqu'au rechargement de l'onglet, sans rien dire — et l'`OFFER` d'en face, mis en file pour un destinataire inconnu, revenait en `EXPIRE` après `expire_timeout` (5 s) sous la forme de ce message. Vert en test : le mock portait `id` en propriété simple | `peer._lastServerId` seul (le champ dont `reconnect()` repart), et `id` reproduit en accesseur sans setter dans `__mocks__/peerjs.js` |
| B arrive, **aucune vignette** pendant plusieurs secondes : l'écran reste vide, puis le spinner apparaît — indistinguable d'une panne | les deux seuls chemins d'annonce exigeaient un contact P2P, or B qui ne diffuse pas n'ouvre rien : il ne pouvait rien savoir avant le `peer.call` d'A (échange de peerId complet, sinon le pas de retry suivant) | `isBroadcasting` embarqué sur les deux routes de peerId (§ ci-dessus, chemin 3) |
| B revient par une navigation SPA, **aucune vignette du tout** (mesuré : 8,8 s, ou jamais) — et c'est le cas majoritaire | le peerId d'A est encore sous bail des deux côtés : `requestOrConnectPeer` compose directement, **aucun POST ne part**, donc le chemin 3 n'a pas de porteur. Adosser l'annonce à la signalisation ne peut rien dire quand il n'y a rien à demander | whisper sur le canal de présence (§ ci-dessus, chemin 4), indépendant de la signalisation P2P |
| Appel direct : le flux arrive, mais les deux vignettes affichent « Inconnu 👁 0 » (et ma voix me revient) | `usePeerMedia._acquireSlot` forçait `metadata: {}`. Les seuls champs transmis au player du pool (`nickname`, `peer`, `roomId`) ne sont pas des props déclarées de `MediaBroadcastPlayer` : ils retombaient en attributs HTML. Le player n'affichant QUE `streamData.metadata`, tout flux passé par le pool était anonyme — et `isMe` absent laissait le player local non muté | `options.metadata` transmis par le pool, construit par `useStreamManager.handleStreamReceived` (distant) et `useCallManager._enterCallSession` (local) |

---

## Couper son micro ou sa caméra, et le dire aux autres

Le seul protocole **applicatif** des Widgets — tout le reste du datachannel est de l'infra. Il
n'a ni fichier de constantes ni table de routage : deux chaînes littérales, écrites une fois à
l'émission et une fois à la réception.

| Étape | Où | Ce qui se passe |
|---|---|---|
| 1 | `GroupLocalStreamBtn.onToggleAudioMute` | `api.toggleAudioMute()` **puis** `api.sendData({ roomId, type: 'AUDIO_MUTE_TOGGLE', isMuted })` — l'ordre est load-bearing : l'annonce doit porter l'état d'**après** la bascule |
| 2 | `usePeerTransport.sendData` | diffusion à toute la room (mesh), ou encapsulation `__starRoute` et retransmission par le hub (star) |
| 3 | wrap `onDataReceived` de l'orchestrateur | ni le routage star ni `BROADCAST_STATE` ne le consomment : il remonte à l'app, avec sa `conn` |
| 4 | `StreamSimpleUI.handleStreamData` | `dispatchSignal({ roomId: conn.peer, payload: data })` — la clé de file est le **peerId de la connexion** |
| 5 | `useRemotePeerState` | `getLastRoomSignal(metadata.peerId)` → `muted` / `videoActive` |
| 6 | `MediaBroadcastPlayer` | `muted` rend **une icône** et rien d'autre ; `videoActive` faux fait basculer tout le player de la branche `<video>` vers la branche `<audio>` |

Deux choses que cette chaîne **ne fait pas**, et qu'on lui prête volontiers :

- **`muted` ne coupe aucun son.** C'est une information affichée. Le mute réel est chez
  l'émetteur (`track.enabled` dans `usePeerOrchestrator.toggleAudioState`) ; recâbler le
  `<video>` du récepteur sur cette prop rendrait un pair en sourdine inaudible pour tout le
  monde, ce qu'aucune annonce ne demande.
- **le `roomId` porté par la charge n'est lu par personne.** Le routage se fait sur la clé
  d'enveloppe, donc sur `conn.peer`. Le champ est émis, il ne sert à rien à l'arrivée.

Les deux bornes de la boucle — elle n'existe que sur le chemin `mode='stream'`, et un flux sans
`peerId` est sourd — sont dans
[architecture.md § Le joint de la projection d'état Widget](architecture.md#le-joint-de-la-projection-détat-widget).

### Où ça casse — causes racines déjà vues

| Symptôme | Cause racine | Correctif |
|---|---|---|
| Un pair qui avait coupé son micro **avant** que son flux n'arrive s'affiche micro ouvert | le datachannel s'ouvre avant le flux média, et le montage de la vignette **est** l'arrivée du flux : l'annonce attendait en file, et le `watch` n'était pas `immediate` | `{ immediate: true }` — qui reprend le dernier **signal**, pas l'état : micro puis caméra coupés avant l'arrivée ne restituent que la caméra |
| Toutes les vignettes de partage d'écran basculent ensemble | sans `peerId`, la lecture retombait sur la clé `"undefined"` — exactement celle qu'écrit un dispatch sans connexion : une file poubelle commune à tous les écrans partagés | garde `!peerId` dans le `computed` ; la surdité d'un écran est voulue |

---

## Départ d'un pair

Deux transports, une seule séquence. Voir
[architecture.md § Départ d'un pair](architecture.md#départ-dun-pair--un-fait-métier-deux-transports)
pour le rationale.

```
signal serveur .CloseConnectionToPeerID → remoteStopCall ─┐
fermeture de connexion PeerJS → handleStreamRemoved ──────┤
   (entrantes seulement, contexte 'stream')               ▼
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

## Perte d'une connexion — l'autre lecteur, qui ne purge pas mais rétablit

⚠️ **Le second transport ci-dessus ne voit qu'une partie des fermetures** : le wrap de
l'orchestrateur ne route que les **entrantes** d'un contexte `stream`. Ce qui tombe chez un
diffuseur quand son pair recharge est sa connexion **sortante** — et les contextes `data` et
`visio` n'ont aucun chemin fermeture → départ. Un second lecteur, indépendant, part donc du seul
point d'entrée universel :

```
conn.on('close') → createPeerContext.handleClose   (tous types, LES DEUX SENS)
   ├─ purge l'instance + le peerId (sous veto de présence)
   └─ publie ctx.connectionLostSignal = remoteSlug   ⟵ si shutdownCount === 0, lu SYNCHRONE
                        │
                        ▼
        useConnectionPool  (watch, jumeau de peerUnavailableSignal)
          ├─ remet le signal à null   (deux conns par pair en 'stream' : média + data)
          ├─ isShuttingDown ?         filet tardif
          ├─ hasPendingRetry ?        un moteur veille déjà → se taire
          ├─ isAuthorizedPeer ?       le pair me concerne-t-il encore
          ├─ _canEmitStreamFor ?      ai-je quelque chose à émettre
          └─ requestOrConnectPeer(userSlug)
```

Une **perte** n'est pas un **départ** : l'une rétablit, l'autre purge, et chacune a son
propriétaire. Les cinq gardes et ce qu'ils coûtent quand ils manquent :
[architecture.md § Conventions de code](architecture.md#conventions-de-code).
