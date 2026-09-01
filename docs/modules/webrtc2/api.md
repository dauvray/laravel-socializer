# WebRTC2 — Surface publique

> **À quoi ça sert :** ce qu'un consommateur monte, importe et configure.
> **Quand le lire :** pour brancher la visio, le chat data ou la diffusion dans un composant.

---

## Trois niveaux d'entrée

### Niveau 1 — `MediaBroadcastProvider.vue` (recommandé)

```vue
<script setup>
import { provide } from 'vue'
import MediaBroadcastProvider from '~socializer/components/WebRTC2/Widgets/Mediaplayer/MediaBroadcastProvider.vue'
import { useReverbPresence } from '~socializer/components/System/composables/useReverbChannel.js'
import { REVERB_CHANNEL } from '~socializer/components/System/system.config.js'

const reverb = useReverbPresence(`server.${serverId}`)
const { users } = reverb

// Optionnel, mais c'est ce qui fait exister le 4ᵉ chemin d'annonce de diffusion.
provide(REVERB_CHANNEL, reverb)
</script>

<template>
  <MediaBroadcastProvider :users="users" :room="room" mode="stream" v-slot="webrtc">
    <StreamSimpleUI v-bind="webrtc" />
  </MediaBroadcastProvider>
</template>
```

| Prop | Type | Défaut | Rôle |
|---|---|---|---|
| `users` | `Array` | **requis** | liste de présence de la room — le provider la `watch` et pilote `api.watchUsers` |
| `room` | `String` | `null` → `'app'` | identifiant de room ; avec `mode`, forme le `contextId` `<type>-<room>` |
| `mode` | `String` | `'data'` | `data` · `stream` · `visio` · `vocal` · `screen` |
| `callbacks` | `Object` | `null` | `{ onDataReceived, onConnectionOpen, onConnectionClose, onStreamReceived }` |
| `options` | `Object` | `{ topology: 'mesh', hubSlug: null, videoContainer: '#videoContainer' }` | topologie et cible DOM |

L'API est exposée de **trois** façons : slot scopé (`v-slot="webrtc"`),
`provide(WEBRTC_API_KEY, api)` pour tous les descendants, et `defineExpose({ api })` pour un
`ref` parent. Le provider appelle `api.cleanup()` en `onBeforeUnmount`.

⚠️ **`callbacks` est optionnel et son absence est significative** : sans lui, `api.initialize()`
n'est **pas** appelé par le provider — c'est alors au composant enfant de le faire (modèle de
`StreamSimpleUI`, qui gère lui-même la réception). Les deux voies sont **exclusives**, et pas parce
qu'elles feraient le travail deux fois : le stockage est **write-once par clé**
(`storeConnectionEventCallbacks`, garde `if (!eventEntry.isActive)`), donc passer `callbacks` **et**
initialiser dans l'enfant **perd le second jeu en silence** — les callbacks de l'enfant ne prennent
jamais effet. Épinglé par `usePeerOrchestrator.callbacks.test.js`, « une seconde initialisation garde
SILENCIEUSEMENT les premiers callbacks ».

ℹ️ **`provide(REVERB_CHANNEL, reverb)` n'est pas une prop, et c'est optionnel** : le provider
l'`inject` (défaut `null`) et le transmet à la couche présence. Sans lui tout fonctionne, mais
l'annonce de diffusion perd son seul porteur indépendant de la signalisation P2P — donc la vignette
d'attente n'apparaît pas quand le peerId du diffuseur est déjà connu sous bail, cas majoritaire d'un
retour de navigation SPA ([flux.md](flux.md#comment-un-arrivant-sait-qui-diffuse)). Un seul
`useReverbPresence` par page, partagé par tous ses providers : le filtrage par room est dans la
charge utile de l'annonce.

Trois usages complets et commentés dans
[`Exemples/Home.vue`](../../../src/resources/js/socializer/components/WebRTC2/Exemples/Home.vue) :
data nu, chat en star avec hub, stream en mesh.

### Niveau 2 — `useMediaBroadcast` (couche métier)

```js
import { useMediaBroadcast } from '~socializer/components/WebRTC2/Composables/useMediaBroadcast.js'

const api = useMediaBroadcast(type, room, options)
api.initialize({ onDataReceived, onConnectionOpen, onConnectionClose, onStreamReceived })
```

Verbes : `initialize` · `cleanup` · `watchUsers` · `sendData` · `getWebcamStream` / `stopStream` ·
`getAudioStream` / `stopAudio` · `startCapture` / `stopCapture` · `toggleAudioMute` /
`toggleVideoVisibility` · `startCallWithPeer` / `acceptCallFromPeer` / `openCallBetweenPeer` /
`stopCallWithPeers` / `remoteStopCall` · `handleStreamReceived` / `handleStreamRemoved` ·
`createVideoElement` / `removeVideoElement` · `setCurrentCallRoomId` / `ensureCurrentCallRoomId` ·
`announceBroadcastState` · `stopCallInviteRetry` / `clearAllCallInviteRetries` ·
`clearSeenInvites` / `isInviteDuplicate`.

État exposé : `currentStream` · `screenStream` · `remoteStreams` · `remoteScreens` ·
`announcedStreamPeers` · `remotePeers` · `isStreaming` · `isCapturing` · `isAudioStream` ·
`callState` · `callStatus` · `isCallInProgress` · `currentCallUsers` · `inviteAbandonedSignal` ·
`isMuted` ·
`isVideoEnabled` · `streamStates` · `topology` / `hubSlug` / `isHub` / `isHubConnected` ·
`localPeerId` · `mySlug` / `myName`.

⚠️ **`stopAudio` n'a plus aucun site d'appel dans le paquet.** Il reste sur la surface publique —
c'est un export inutilisé mais **juste** (un alias de `stopStream` en aval), pas un export faux, et
la politique du paquet ne retire que les seconds. Le câblage qui l'appelait était mort des deux
côtés ; « Stop stream » couvre le cas, flux audio seul compris. Ne pas le prendre pour le chemin en
vigueur.

⚠️ **`remoteStreams` exclut les partages d'écran** ; `remoteScreens` ne contient qu'eux — les deux
sont des `computed` filtrant `remoteStreamsMap` sur `remoteType !== 'screen'` dans
`createPeerContext.js`. Consommer `remoteStreams` seul rend tout partage d'écran invisible.

⚠️ **`getWebcamStream`, `getAudioStream` et `startCapture` rendent une promesse — les seuls des
verbes de flux.** Elle peut rejeter, et c'est le cas nominal : l'utilisateur refuse la permission
(`NotAllowedError`) ou n'a pas de périphérique (`NotFoundError`). Rien ne l'attrape sur toute la
chaîne — `usePeerMedia` appelle `getUserMedia` / `getDisplayMedia` nus. **Un appelant qui ignore la
valeur de retour transforme donc un refus en rejet non traité** : pas de toast, pas de changement
d'état, un bouton qui semble mort. Les trois verbes d'arrêt sont synchrones et ne rendent rien.
Traité côté UI : `GroupLocalStreamBtn` porte un `.catch` qui notifie par AWN,
avec le nom de l'erreur — la seule exception assumée est `NotAllowedError` sur `startCapture`, que
`getDisplayMedia` rend indiscernable d'une simple fermeture du sélecteur de partage.

⚠️ **`startCallWithPeer` rend un verdict, et son appelant DOIT le lire** — `Promise<?string>` :
l'`inviteId` si l'invitation est partie, `null` si elle a été refusée **après** que la FSM a été
engagée, `undefined` si le payload était irrecevable (rien n'a été engagé, il n'y a personne à
prévenir). Sur `null`, le verbe a déjà ramené la FSM à IDLE et purgé la session ; ce qui reste à
l'appelant est de le dire à l'utilisateur et d'émettre `close-call`. Ignorer ce retour, c'était le
cul-de-sac qui bloquait tout appel d'un onglet —
[flux.md](flux.md#linvitation-ne-part-pas--aucun-peerid-local-publiable).

⚠️ **Le mutex de `startCallWithPeer` tient malgré son `async`** : `callMachine.transition(CALLING)`
est **avant** le premier `await`. Ne pas en conclure qu'on peut awaiter n'importe quoi dans ce
verbe — awaiter `setLocalPeer()` déplacerait la transition après une suspension et ouvrirait la
fenêtre de double clic.

### Niveau 3 — `usePeerOrchestrator(type, room, options)`

Façade technique. Rarement nécessaire hors tests.

---

## Le canal data : les callbacks et `sendData`

Vrai aux trois niveaux d'entrée. `callbacks` est un objet opaque pour le provider : ce qu'il accepte
est décidé par la table `connectionEvents` de `createPeerContext.js`, qui reconnaît **cinq clés et
seulement cinq**. Toute autre clé, et tout ce qui n'est pas une `function`, est **ignoré en silence**
(`storeConnectionEventCallbacks`).

| Clé | Invocation réelle | À savoir |
|---|---|---|
| `onDataReceived` | `(data, conn, conn.metadata)` | le 3ᵉ argument **est** `conn.metadata`, pas un objet reconstruit |
| `onConnectionOpen` | `(conn)` | wrapper nommé **parce que** `conn.on('open')` n'émet aucun argument ; l'annonce de diffusion part **avant** le callback applicatif |
| `onConnectionClose` | `(conn)` | **une seule fois par connexion**, garde `customCloseEmitted` |
| `onConnectionError` | l'argument brut de PeerJS | **le seul jamais wrappé** — épinglé par `usePeerOrchestrator.callbacks.test.js` |
| `onStreamReceived` | `(stream, conn, conn.metadata)` | hors canal data ; son wrap `await` le suivi interne avant l'appel applicatif |

⚠️ **Ne pas poser soi-même `conn.on('data')` sur la connexion reçue en `onConnectionOpen`.** Le
transport possède déjà ce listener (`handleData`) : un second doublerait chaque réception **et**
contournerait la garde de taille en entrée ainsi que l'interception de `BROADCAST_STATE` et des
enveloppes `__starRoute`. Le geste est `onDataReceived`, jamais `conn.on('data')`.

⚠️ **`onConnectionOpen` est appelé dans les DEUX SENS, et en mesh chaque paire a deux connexions.**
`setUpConnectionListeners` est appelé par `usePeerConnections` sur la connexion **sortante** que
j'ouvre, et par `usePeerTransport` sur celle que je **reçois** : un effet de bord posé là s'exécute
donc **deux fois par pair**, pas une. Il n'y a pas de drapeau de sens — il se lit sur la metadata,
qui est construite par l'émetteur de la connexion : sur une **sortante** `conn.metadata.from` est
**mon** slug, sur une **entrante** c'est celui du pair. Un consommateur qui ne veut réagir qu'à
l'arrivée d'autrui doit poser ce test lui-même (modèle :
`Whiteboard/WhiteboardComponent.vue#handleConnectionOpen`, qui renvoie la scène courante à
l'arrivant).

### `api.sendData(data, destUserSlugs = null)`

`useMediaBroadcast.js:169`, sur la façade. Quatre propriétés qui ne se devinent pas :

- **aucun argument de room** — elle est figée dans `session.onAirRoom` à la construction du contexte ;
  émettre vers deux rooms demande **deux contextes**, donc deux providers ;
- **le payload part tel quel** : aucune sérialisation, aucune enveloppe. Ce qu'on passe est ce que le
  pair reçoit — un objet arrive en objet. `usePeerTransport.mesh.test.js` épingle l'absence de
  transformation (la valeur ressort identique, chaîne comme `ArrayBuffer`) ;
- `destUserSlugs = null` ⇒ tous les `remotePeers` (mon slug n'y est jamais). En topologie star côté
  client, la liste est portée par l'enveloppe et c'est le hub qui la respecte ;
- au-delà de `MAX_PAYLOAD_BYTES` (64 Ko, `webrtc2.config.js:106`), ou si le payload n'est pas
  mesurable, **l'envoi est entièrement annulé sans un mot**. Un destinataire injoignable ne produit
  qu'un `console.warn` par slug.

⚠️ **Ce plafond de 64 Ko n'est pas théorique : un consommateur du paquet le frôle.** La scène
Excalidraw du Whiteboard (`update_scene` : `getSceneElements()` + `getFiles()`) est le plus gros
payload du paquet, et le seul dont la taille est pilotée par l'utilisateur — une image collée dans
le tableau, encodée en base64 dans `files`, suffit à le franchir. L'abandon étant muet des deux
côtés, le symptôme produit est « le tableau ne se synchronise plus », sans erreur. Aucune découpe ni
synchronisation par delta n'existe aujourd'hui : c'est une **borne assumée**, pas un cas traité.

### ⚠️ `sendData` peut LEVER, et le garde de taille ne l'en protège pas

Les quatre cas ci-dessous et la limite de taille échouent **en silence**. Il existe un cinquième
mode, et il est bruyant : **la sérialisation elle-même peut jeter**, de façon **synchrone**, depuis
`conn.send`.

La sérialisation par défaut de PeerJS est **BinaryPack**, qui refuse tout ce qu'il ne connaît pas —
`Map`, `Set`, une instance de classe — avec
`Error: Type "function Map() { [native code] }" not yet supported`.

**Le garde de taille ne peut pas l'attraper**, et c'est le piège : `getPayloadSizeBytes` mesure via
`JSON.stringify`, qui accepte une `Map` (elle rend `{}`). Il rejette bien une **fonction nue**, ce
qui donne l'illusion d'une couverture. Le trou est précis — **un conteneur que JSON accepte et que
BinaryPack refuse**.

Trois conséquences, parce que le throw part du `forEach` de diffusion :

- les **pairs suivants** de la boucle ne reçoivent rien ;
- l'exception **remonte à l'appelant** — tout ce qu'il faisait après son `sendData` est sauté ;
- **aucun test de la suite ne peut le voir** : `conn.send` y est un `vi.fn()`, sans BinaryPack.
  `usePeerTransport.mesh.test.js` épingle la moitié vérifiable — le garde laisse passer une `Map` —
  et le dit dans son cas.

Le geste, côté consommateur : **n'émettre que des données plates**. Le cas vécu est le Whiteboard,
dont l'`appState` Excalidraw porte `collaborators: Map` ; il l'exclut de son émission
(`WhiteboardComponent#handleExcalidrawMouseUp`).

### Les quatre cas où `onDataReceived` n'est pas appelé, ou l'est amputé

1. **`{ type: 'BROADCAST_STATE', … }` est consommé par l'infra** et n'atteint jamais l'app
   ([architecture.md](architecture.md#signaux-datachannel--trois-enveloppes-trois-consommateurs)) — **le champ `type` est
   donc réservé** : un payload applicatif qui reprendrait ce nom serait avalé.
2. **Payload au-delà de la limite** : abandonné en réception aussi, silencieusement, sans déconnecter
   le pair.
3. **Hub star recevant une enveloppe `__starRoute` : le callback est appelé en ARITÉ 1** — pas de
   `conn`, pas de `metadata`, parce que la connexion est celle du relais et non celle de l'émetteur
   d'origine. Un consommateur qui lit `conn.peer` sans `?.` casse **sur le hub seulement**.
4. **Client star** : le message relayé arrive **nu**, l'identité de son émetteur perdue par la
   retransmission — d'où le `data?.payload ?? data` de `Exemples/ChatSimple/useChatSimple.js`.

---

## Prérequis d'environnement

Ils sont implicites et cassent **silencieusement**.

- **`System/Notifications.vue` monté en permanence.** C'est lui qui traduit Reverb →
  `peerStore.dispatchSignal` et qui porte le contexte permanent `data-app`. Sans lui, aucune
  signalisation n'arrive.
- **`provide('eventBus', bus)`** valide dans l'arbre — sinon `createPeerContext` warn et pose un
  no-op (pas de crash, mais plus aucun `call-user` / `close-call`).
- **Pinia actif**, avec `useMeStore().getMe.slug` renseigné, et **Echo/Reverb** global.
- **Un conteneur vidéo** : `<div id="videoContainer">` (téléporté sur `body` par
  `System/Notifications.vue`), ou un `options.videoContainer` custom.
- **Variables Vite** : `VITE_PEERS_SERVER_HOST` / `_PORT` / `_PATH` / `_KEY`. Les identifiants
  TURN n'en font **plus** partie : ils sont servis à l'exécution par `GET /get-ice-servers`
  (`WebRTCController`), depuis `COTURN_STATIC_AUTH_SECRET` — une variable lue par PHP, donc
  modifiable sans rebuild. Le credential est signé par utilisateur et expire seul ; le transport le
  **rafraîchit en place avant son échéance** (la route annonce sa durée de vie dans
  `credential_ttl`), sans recréer le `Peer` ni couper les appels en cours —
  [détail](securite.md#le-rafraîchissement-du-credential-turn). À défaut de secret, le couple
  statique `COTURN_USER` / `COTURN_PASS` reste servi, et n'est alors pas rafraîchi. Une clé `VITE_*`
  est inlinée dans le bundle public au `npm run build` ; un identifiant n'y a jamais sa place.
- **Une source de présence** pour `users` — `useReverbPresence(channel)`, voir
  [use-reverb-channel.md](../../reference/use-reverb-channel.md). La charge utile doit porter `id`
  **et** `slug` (`Http\Resources\PresenceUser` les livre) : le slug est le pivot de l'admission des
  pairs, l'id celui de l'attribution d'un whisper.
- **Pour l'annonce de diffusion par whisper, et pour elle seule** : ce même canal `provide`é sous
  `REVERB_CHANNEL`, **et** Reverb en `accept_client_events_from: 'members'`. Les deux manquent en
  silence, mais pas au même endroit : sans `provide` le chemin n'existe pas, sans la clé de config il
  existe et se refuse (`warn` unique nommant la clé) —
  [securite.md](securite.md#la-borne-de-déploiement-du-whisper--accept_client_events_from).
- `window.AWN` pour certains widgets.

---

## Widgets réutilisables

`Widgets/Mediaplayer/` — `MediaBroadcastPlayer.vue` (player générique : video/audio, drag/resize,
PIP, fullscreen, overlay d'attente d'image), `LocalMediaPlayer.vue` / `RemoteMediaPlayer.vue`,
`PlayerHost.vue` (hôte du pool d'instances). ⚠️ `LocalMediaPlayer` **jette** sans
`MediaBroadcastProvider` parent.

⚠️ **Le pool recycle l'instance ET son élément `<video>`** — c'est tout son intérêt — mais le plein
écran et le PiP ne sont pas des états Vue : ils survivraient au changement de flux. Le player les
rend donc explicitement quand son `streamData.stream` change (`releasePresentation`, cf. plus bas),
et ce n'est pas une précaution : sans ça la fenêtre PiP ouverte sur un pair affiche le flux du
suivant sous l'identité du précédent, la vignette libérée étant masquée par le pool (`v-show`) donc
sans aucun bouton pour la fermer.

⚠️ **Le mute natif choisi par l'utilisateur est partagé par les deux branches** (`isLocallyMuted`),
et pas seulement par la vidéo : un pair coupé qui éteint sa caméra bascule sur l'`<audio>`, qui doit
se monter muté. Sinon on le réentend sans pouvoir le recouper — le bouton Mute n'existe pas sur
cette branche, seuls les contrôles natifs de l'`<audio>` offrent la voie de retour.

⚠️ **Ce que le player affiche vient uniquement de `streamData.metadata`** — il n'interroge aucun
store. Champs lus : `fromName` (sinon « Inconnu »), `isMe` (coupe le son du player local),
`countViewers` (compteur d'audience, affiché **seulement s'il est fourni** : un appel direct n'a
pas d'audience), `isAudioMuted` / `isVideoEnabled`, `roomId` (portée du redimensionnement).
Deux producteurs de cet objet, à tenir cohérents : le consommateur qui rend ses players lui-même
(`Exemples/StreamSimple/StreamSimpleUI.vue`) et `usePeerMedia.createVideoElement({ metadata })`
pour le pool — dont les appelants sont `useStreamManager.handleStreamReceived` (flux distant) et
`useCallManager._enterCallSession` (flux local d'appel).

⚠️ **Cet objet est une liste blanche, pas une copie de `conn.metadata`.** Deux des champs ci-dessus
ne sont pas inertes — `countViewers` est rendu en texte, `roomId` sert de cible à `v-resize` — et un
spread laissait le pair distant les peupler. Un producteur qui ajoute un champ vérifie donc d'abord
ce que le player en fait, et le nom distant passe par `sanitizeMetadataName` : voir
[securite.md](securite.md#connmetadata--trois-gardes-dont-un-de-position). Corollaire :
`countViewers` n'apparaît que sur un flux dont le producteur **local** compte l'audience — jamais
sur une vignette de visio ou d'appel.

⚠️ Sur une connexion **sortante**, `conn.metadata.fromName` porte **mon** nom, pas celui du
distant (cf. [`resolveRemoteSlug`](../../../src/resources/js/socializer/components/WebRTC2/Composables/utils/resolveRemoteSlug.js)
pour la même règle sur le slug) : `useStreamManager` retombe donc sur le slug distant. La
signalisation serveur ne transportant que des slugs, l'appelant ne connaît pas le *nom* de
l'appelé — le lui faire afficher demanderait un champ `fromUserName` dans les événements de
`UserController`.

`Widgets/UI/Buttons/` — `GroupLocalStreamBtn.vue` (prop `api`), `LocalStreamBtn.vue`,
`LocalCaptureBtn.vue`, et les deux boutons d'appel :

- **`CallManagerBtn.vue`** — la barre de commande d'un appel en cours. Props `status` (les cinq
  états de la FSM), `isMuted`, `isVideoEnabled` ; émet `stop-call`, `toggle-audio`,
  `toggle-video`. Purement présentationnel, comme `LocalStreamBtn` : son adaptateur est
  `System/Notifications.vue`.
- **`CallRemotePeerBtn.vue`** — le bouton d'appel d'un mur. Props `user` (requise) et `type`,
  **normalisé** à `visio | vocal` (voir ci-dessous). `AWN` est optionnel avec repli
  `window.AWN` ; **`eventBus` est REQUIS** — sans lui le bouton se désactive et le journalise
  une fois, au lieu de faire semblant.

⚠️ **Les deux bascules de `CallManagerBtn` n'annoncent RIEN aux pairs, et ce n'est pas un oubli.**
`GroupLocalStreamBtn` le fait par `sendData({ type: 'AUDIO_MUTE_TOGGLE' })` ; c'est hors de portée
dans un appel 1-à-1, pour trois raisons cumulées : la branche `visio`/`vocal` de
`usePeerConnections` n'ouvre que `peer.call()`, jamais `peer.connect()` — il n'existe donc aucun
canal de données ; `sendData` lit `onAirRoom`, figé à `'app'` dans le contexte de `Notifications`,
alors que les connexions d'appel sont rangées sous `currentCallRoomId` ; et `remotePeers` y reste
vide, `watchUsers` n'y étant jamais appelé. La moitié utile fonctionne quand même sans
signalisation : `toggleAudioState` pose `track.enabled = false` sur le flux local, donc le pair
d'en face entend du silence immédiatement. Ce qui manque est le **badge** de son côté — item ouvert
de `work/webrtc2-todo.md`.

⚠️ **`normalizeDirectCallType` n'est PAS `isValidCallType`**, et les confondre a coûté un
cul-de-sac. `isValidCallType` est dérivé de `VALID_CONNECTION_TYPES` : il accepte les **cinq**
types de connexion (`data`, `stream`, `screen`, `visio`, `vocal`), ce qui est juste pour un type de
**contexte** et faux pour un appel direct. `isValidCallType('screen')` rendant `true`, un
`startCallWithPeer({type:'screen'})` passait la validation, basculait la FSM en CALLING, puis
mourait à l'ouverture de connexion — où `config.stream` vaut `null` et où le `return true` **annule**
le retry. `normalizeDirectCallType` (`Composables/utils/validators.js`) ne connaît que les **deux**
types d'un appel, et normalise plutôt que de valider : le titre, l'icône et l'invitation disent
alors tous les trois la même chose. Il remplace le repli du chemin **sortant** ; les trois chemins
entrants gardent `isValidCallType`, délibérément.

`Widgets/UI/` — `Audio/SpectrumAnalyzer.vue`, `Report/Debug.vue`, et les deux alertes d'appel
entrant :

- **`Alerts/AudioCallAlert.vue`** et **`Alerts/VideoCallAlert.vue`** — jumelles, qui ne diffèrent que
  par leur libellé et par leur délai. Props `fromUserSlug` et `options`, requises ; émettent
  `response-alert` avec un booléen. **Aucune ne se monte directement** : leur seul consommateur est
  `System/widgets/AlertComponent.vue`, qui les charge en `defineAsyncComponent` et choisit sur
  `options.type` (`vocal` → audio, `visio` → vidéo). Chacune sonne en boucle et **s'auto-refuse**
  seule au bout de son délai (les valeurs et ce qu'un refus déclenche : [flux.md](flux.md#refus-du-distant--le-même-chemin-jamais-un-raccourci)) ;
  les trois chemins qui la terminent — accepter, refuser, quitter l'écran — passent par le même
  `stopAlert()`, épinglé par `AlertComponent.timers.test.js`.

`Widgets/Mediaplayer/Composables/` — `useAwaitedStreams(api)` (vignettes « en attente du flux »),
`useRemotePeerState(peerIdSource)` → `{ muted, videoActive }` (état annoncé d'un pair distant ;
`peerIdSource` est une valeur **ou une `Ref`**, et un id absent rend le composable sourd — cf. le
joint de la projection Widget dans [architecture.md](architecture.md)), `useMediaControls(videoRef)`
→ `{ toggleFullscreen, togglePip, toggleNativeMute, releasePresentation }`.

⚠️ **`useMediaControls` ne rend aucun drapeau d'état — décision du 31/08/2026** —
`isFullscreen` et `isPip` ont été retirés de cette surface. Personne ne les lisait et aucun listener
ne les mettait à jour : ils mentaient dès une sortie par Échap ou une fermeture de la fenêtre PiP.
La vérité est `document.fullscreenElement` / `document.pictureInPictureElement`, relue à chaque
appel. Aucun alias de transition n'a été posé, contrairement à la politique habituelle : un alias
propagerait la valeur fausse. Un consommateur qui veut un libellé « Quitter le plein écran » pose son
propre listener `fullscreenchange` — épinglé par `useMediaControls.test.js`.

`releasePresentation()` est l'inverse des deux bascules : il sort l'élément du PiP **et** du plein
écran, mais seulement s'il les détient. `MediaBroadcastPlayer` l'appelle quand le pool réattribue son
slot à un autre flux — sans lui, la fenêtre PiP ouverte « sur Bob » affiche le flux suivant sous
l'identité de Bob, et la vignette libérée étant masquée (`v-show`), plus aucun bouton ne la ferme.

⚠️ **Ces deux composables voisins n'ont rien à voir l'un avec l'autre**, et les confondre a déjà
coûté un énoncé de tâche faux. `useRemotePeerState` porte le protocole applicatif des Widgets —
le mute **annoncé** par le pair, qui n'est qu'une information affichée. `useMediaControls` ne
touche que l'élément DOM local (plein écran, PiP, mute **navigateur**) : il ne connaît ni pair,
ni signal, ni store. Le mute réel d'une piste se fait chez l'émetteur (`track.enabled`), jamais
chez le récepteur.

---

## Événements applicatifs

Deux événements transitent par l'eventBus injecté : **`call-user`** `(slug, type)` et
**`close-call`**.

Les deux appelants — `System/Notifications.vue` et `Widgets/UI/Buttons/CallRemotePeerBtn.vue` —
émettent **en forme brute**, directement sur le bus (`eventBus.$emit('call-user', slug, type)`), et
c'est cette forme que les tests épinglent des deux côtés (`CallRemotePeerBtn.test.js`). Le type, lui,
passe par `normalizeDirectCallType` (`Composables/utils/validators.js`) **aux deux bouts** — le
bouton normalise sa prop avant d'émettre, `useCallManager` renormalise le payload entrant : un
`call-user` peut venir d'ailleurs que du bouton, et un type non normalisé devient un cul-de-sac en
aval.

`close-call` est **idempotent par contrat** : un même départ peut l'émettre deux fois
(voir [flux.md](flux.md#départ-dun-pair)).

---

## Configuration

Source de vérité unique :
[`webrtc2.config.js`](../../../src/resources/js/socializer/components/WebRTC2/webrtc2.config.js) —
chaque constante y porte son rationale de dimensionnement. **Ne pas recopier les valeurs ici :**
elles bougent, le fichier fait foi.

| Constante | Ce qu'elle borne |
|---|---|
| `MAX_PEERS_PER_ROOM` | saturation mesh (CPU + bande passante navigateur) |
| `MAX_RETRY_ATTEMPTS` · `MAX_RECONNECT_ATTEMPTS` | anti-boucle infinie (backoff exponentiel + jitter) |
| `RECONNECT_BASE_DELAY_MS` · `RECONNECT_MAX_DELAY_MS` | backoff de reconnexion PeerJS |
| `PEER_DESTROY_DELAY_MS` | délai de grâce avant destruction du Peer singleton |
| `PEER_OPEN_TIMEOUT_MS` | abandon **et destruction** d'un Peer qui n'a jamais reçu son `'open'` (sous `ME_READY_TIMEOUT_MS`) |
| `MAX_REMOTE_STREAMS` · `STREAM_STALE_MS` | éviction LRU de `remoteStreamsMap` (anti-leak) |
| `MAX_PAYLOAD_BYTES` | anti-DoS : émission mesh, retransmission hub **et** réception |
| `HUB_MAX_MESSAGES_PER_WINDOW` · `HUB_RATE_WINDOW_MS` | rate-limit `forwardStarMessage` |
| `HUB_MAX_BYTES_PER_WINDOW` | anti-amplification : octets **retransmis** par le hub (`payload × destinataires`), **par émetteur** |
| `MAX_METADATA_BYTES` · `MAX_METADATA_NAME_LENGTH` | taille de `conn.metadata` à l'admission, et longueur d'un `fromName` distant (tronqué) |
| `ASK_PEER_MAX_REQUESTS_PER_WINDOW` · `ASK_PEER_RATE_WINDOW_MS` | rate-limit `/ask-to-peer-id`, **par cible** (`slug\|room\|connectionType`) |
| `SIGNALING_STALE_MS` | âge d'une entrée `waiting` — anti-spam **et** déclencheur de re-demande |
| `STREAM_WAIT_TIMEOUT_MS` · `ME_READY_TIMEOUT_MS` | attentes réactives (flux local, identité locale) |
| `AWAITED_STREAM_TIMEOUT_MS` | filet « annonce reçue, flux jamais arrivé » |
| `MAX_INVITE_RETRIES` | taille max de la Map d'invitations en attente |
| `ATTESTATION_REFRESH_*` · `ATTESTATION_RETRY_MS` · `ATTESTATION_MAX_RETRIES` | renouvellement de l'attestation d'identité — même forme que le rafraîchissement ICE, enjeu différent : une configuration ICE périmée dégrade en STUN, une attestation périmée fait REFUSER sous `enforce` |
| `ATTESTATION_FETCH_TIMEOUT_MS` · `MAX_ATTESTATION_LENGTH` | délai d'un aller-retour d'attestation (⚠️ la vérification est sur le chemin d'admission d'une connexion entrante) et borne de longueur, jumelle de `WebRTCController::MAX_ATTESTATION_LENGTH` |

Y vivent aussi `VALID_CONNECTION_TYPES` (`data` · `stream` · `screen` · `visio` · `vocal` — dont
`VALID_CALL_TYPES` est **dérivé**, une seule source de vérité), `SLUG_PATTERN`, la table `ENDPOINTS`
(les routes de signalisation, plus celles qui ne relaient aucun signal : ICE, attestation,
vérification)
et le symbole `WEBRTC_API_KEY`.

⚠️ **Le plafond `/ask-to-peer-id` est par cible et non global** : un join mesh émet légitimement,
dans le même tick, une demande par pair déjà présent **et par type** — soit jusqu'à
`2 × (MAX_PEERS_PER_ROOM - 1)` au plafond (type principal + écran). Un cap global mal
dimensionné casserait le join — c'est le même piège côté serveur, voir
[signalisation.md, invariant 5](../../architecture/signalisation.md#cinq-invariants-backend).

---

## Topologies

- **mesh** — connexions directes entre tous les membres, jusqu'à `MAX_PEERS_PER_ROOM`. Visio/vocal
  et petits salons. Aucun tiers applicatif ne voit les payloads.
- **star** — un hub relaie les messages data via `forwardStarMessage`, **verbe interne au transport
  et non exporté** (`usePeerTransport` le dit à son site de définition). Grandes rooms. Le hub lit les
  payloads en clair : c'est ce qui rend la modération possible, et c'est un choix assumé — voir
  [securite.md](securite.md).
Toute autre valeur est **refusée à la construction** : `createPeerContext` lève, en distinguant une
topologie **réservée** (`sfu` — prévue, non implémentée) d'une valeur **inconnue**. Même refus pour
`star` sans `hubSlug`, qui produisait le même contexte mort. Épinglé par `createPeerContext.test.js`
(« topologie refusée à la construction »).

⚠️ **`hubSlug` fourni n'est pas hub présent.** Un hub absent de la room est un état transitoire
normal : le client ne le compose pas, sans rien tenter ni journaliser, et le tour de présence qui
voit arriver le hub rétablit la connexion. Ce qui est refusé ci-dessus, c'est l'absence de la
*désignation* — sans elle, les prédicats de `useConnectionPool` et `usePeerTransport`, qui sont
composés, sont faux pour toujours.

Ce qui tient la porte ouverte pour un futur SFU n'est pas une valeur acceptée mais la couture
recensée dans [`work/webrtc2-todo.md`](../../../work/webrtc2-todo.md) : un SFU est « star dont le hub
est un serveur », donc une troisième branche aux mêmes sites de décision — que ce fichier liste avec
leur fichier propriétaire, les numéros de ligne se re-grepant.
