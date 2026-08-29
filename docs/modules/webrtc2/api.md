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
`StreamSimpleUI`, qui gère lui-même la réception). Passer `callbacks` **et** initialiser dans
l'enfant initialiserait deux fois.

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

⚠️ **`remoteStreams` exclut les partages d'écran** ; `remoteScreens` ne contient qu'eux — les deux
sont des `computed` filtrant `remoteStreamsMap` sur `remoteType !== 'screen'` dans
`createPeerContext.js`. Consommer `remoteStreams` seul rend tout partage d'écran invisible.

### Niveau 3 — `usePeerOrchestrator(type, room, options)`

Façade technique. Rarement nécessaire hors tests.

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

`Widgets/UI/Buttons/` — `CallManagerBtn.vue`, `CallRemotePeerBtn.vue` (props `user`, `type`),
`GroupLocalStreamBtn.vue` (prop `api`), `LocalStreamBtn.vue`, `LocalCaptureBtn.vue`.

`Widgets/UI/` — `Audio/SpectrumAnalyzer.vue`, `Report/Debug.vue`.

`Widgets/Mediaplayer/Composables/` — `useAwaitedStreams(api)` (vignettes « en attente du flux »),
`useRemotePeerState.js` (mute / vidéo distants), `useMediaControls.js`.

---

## Événements applicatifs

Deux événements transitent par l'eventBus injecté : **`call-user`** `(slug, type)` et
**`close-call`**.

⚠️ **`EventBus/webrtc2Events.js` n'est consommé par personne.** Le module exporte
`WEBRTC2_EVENTS`, `emitCallUser`, `emitCloseCall`, `onCallUser`, `onCloseCall` et
`normalizeType` (qui n'accepte que `'visio' | 'vocal'`), mais les deux appelants réels —
`System/Notifications.vue` et `Widgets/UI/Buttons/CallRemotePeerBtn.vue` — font toujours
`eventBus.$emit('call-user', slug, type)` en direct. Le traiter comme la normalisation
**visée**, pas comme le chemin en vigueur.

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
(5 routes de signalisation + 3 routes WebRTC qui ne relaient rien : ICE, attestation, vérification)
et le symbole `WEBRTC_API_KEY`.

⚠️ **Le plafond `/ask-to-peer-id` est par cible et non global** : un join mesh émet légitimement
jusqu'à 14 demandes dans le même tick (7 pairs × type principal + écran). Un cap global mal
dimensionné casserait le join — c'est le même piège côté serveur, voir
[signalisation.md, invariant 5](../../architecture/signalisation.md#cinq-invariants-backend).

---

## Topologies

- **mesh** — connexions directes entre tous les membres, jusqu'à `MAX_PEERS_PER_ROOM`. Visio/vocal
  et petits salons. Aucun tiers applicatif ne voit les payloads.
- **star** — un hub relaie les messages data via `forwardStarMessage`. Grandes rooms. Le hub lit les
  payloads en clair : c'est ce qui rend la modération possible, et c'est un choix assumé — voir
  [securite.md](securite.md).
- `sfu` est accepté dans `options.topology` et branché dans le fan-out de `syncUsersConnections`,
  sans implémentation serveur.
