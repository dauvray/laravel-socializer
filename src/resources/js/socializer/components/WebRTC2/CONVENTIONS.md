# WebRTC2 — Conventions issues du refacto initial (mai 2026)

> Historique exhaustif des ~70 fixes P0/P1 disponible dans git
> (`git log -- vendor/dauvray/laravel-socializer/src/resources/js/socializer/components/WebRTC2/`).
> Ce fichier conserve uniquement les **conventions à respecter** qui ne sont
> pas évidentes à la lecture du code et qu'une refacto pourrait casser sans le savoir.

## Ordre des couches

```
createPeerContext                         source de vérité unique (état, stores, FSM d'appel)
  └─ usePeerCore · usePeerMedia · usePeerConnections · usePeerTransport
                                          sous-modules : dialoguent uniquement via ctx
       └─ useConnectionPool               retry, établissement, sync room → connexions
            └─ useCallManager             cycle d'appel (invite → accept → open → stop → reset)
                 └─ useStreamManager      registre des flux distants + players + départs
                      └─ useBroadcastPresence  annonce « je diffuse » sur le data channel
                           └─ useSignalingQueue   routage des signaux serveur entrants
                                └─ usePeerOrchestrator   composition + façade, aucune logique métier
```

`useSignalingQueue` est instanciée **en dernier** précisément parce qu'elle ne fait que
consommer des verbes : personne ne consomme les siens, donc sa table `routes` peut
pointer vers n'importe quelle couche sans jamais créer de callback ascendant.

**Règle : une couche ne reçoit jamais de callback vers une couche supérieure.** Les
dépendances descendent par injection explicite depuis l'orchestrateur
(`useCallManager(ctx, { core, media, connections, transport, pool })`) — jamais par
import croisé, jamais par callback remontant. C'est ce qui garde le graphe acyclique
quand une couche de plus est extraite ; un callback inverse (« passe-moi
`requestOrConnectPeer` ») est le signe qu'une couche est au mauvais étage.

Corollaire : l'état partagé entre deux couches vit dans `createPeerContext`, derrière
des accesseurs (`callMachine`, `beginShutdown`/`endShutdown`), pas dans un `ref` de
l'orchestrateur passé de main en main.

**Propriétaires uniques** — un invariant se tient à un seul endroit, vérifiable au grep :

| État | Seul à le muter | Les autres couches passent par |
|---|---|---|
| `callMachine` (FSM d'appel) | `useCallManager` | `markCallConnected`, `isRemoteClosing` / `beginRemoteClosing` / `endRemoteClosing` |
| `lifecycle.shutdownCount` | `useCallManager`, orchestrateur (arrêts de stream), `useConnectionPool` (unmount) | `ctx.isShuttingDown` en lecture (`count > 0`) |
| `media.remoteStreamsMap` | `useStreamManager` (ajout/TTL/éviction), `useCallManager` (purge au départ d'un pair) | `ctx.remoteStreams` / `remoteScreens` en lecture |
| séquence de départ d'un pair | `useCallManager.handleRemoteDeparture` | point d'entrée unique quel que soit le transport qui l'annonce |
| timers de retry connexion | `useConnectionPool` | `clearRetry` / `clearAllRetries` |
| routage des signaux serveur | `useSignalingQueue` (table `routes` construite par l'orchestrateur) | exposer un verbe et l'inscrire dans la table — pas de `watch` sur `ctx.lastRoomSignal` ailleurs |
| `media.announcedStreamsMap` (« un flux de ce pair est en route ») | deux écrivains assumés, chacun sur la seule information qu'il voit : `useBroadcastPresence` (annonce `BROADCAST_STATE`) et `usePeerTransport` (appel one-way entrant) ; purge au départ par `useCallManager.handleRemoteDeparture` | accesseurs `ctx.markAnnouncedStream` / `ctx.clearAnnouncedStream` (jamais d'écriture directe), lecture via `ctx.announcedStreamPeers` |

**Départ d'un pair : un fait métier, deux transports.** « Tel pair quitte l'appel »
arrive soit par le signal serveur `CloseConnectionToPeerID` (→ `remoteStopCall`), soit
par la fermeture de la connexion PeerJS (→ `useStreamManager.handleStreamRemoved`).
Les deux peuvent se déclencher pour un même départ, dans un ordre non déterministe
(aller-retour serveur vs P2P direct) — d'où le garde par participant `closingUsers`.
Les deux **doivent** converger vers `handleRemoteDeparture` : c'est le déclencheur qui
varie, jamais la séquence. Historiquement les deux chemins avaient chacun leur version
de la séquence, et **aucune n'était complète** (l'une oubliait la fermeture du
transport et des retries, l'autre purgeait le registre sur une clé qui ne matchait pas
côté initiateur) : la correction dépendait de quel transport arrivait en premier.
Corollaire : `close-call` est **idempotent par contrat** — un même départ peut
l'émettre deux fois si les deux transports se réveillent hors de la fenêtre du garde.

Ce qui différencie encore les deux appelants est uniquement ce qui leur appartient :
`remoteStopCall` valide et adapte un payload de signalisation, `handleStreamRemoved`
résout le pair distant depuis `conn.metadata` (d'où son `waitForMeReady`, qui est la
précondition de `_resolveRemoteSlug` et non de la séquence de départ).

**Signaux datachannel : deux enveloppes, deux consommateurs.** La file du store porte les
signaux **serveur** (`{ roomId: '<type>-<room>', type, payload }`, routés par
`useSignalingQueue`) et les projections d'état des Widgets
(`{ roomId: '<peerId>', payload: { type } }`, ex. `AUDIO_MUTE_TOGGLE`, lues par
`useRemotePeerState`) — ces dernières restent hors du routage serveur. Un troisième cas
existe depuis l'annonce de diffusion : `BROADCAST_STATE` est consommé **par l'infra**,
dans le wrap `onDataReceived` de l'orchestrateur, et n'atteint jamais l'app. C'est ce qui
évite d'imposer un câblage à chaque consommateur (et interdit à un pair d'injecter ce
type dans un flux de chat). Corollaire de sécurité : l'identité de l'émetteur d'un message
datachannel se lit **toujours** depuis la connexion (`resolveRemoteSlug`, authentifiée à
l'admission), jamais depuis un champ du payload.

L'état *plat* partagé (`session.currentCallUsers`, via `ctx.addCurrentCallUser` &co.)
n'a pas de propriétaire unique : il n'a pas d'invariant de transition à protéger,
contrairement à la FSM. C'est la raison de la différence de traitement.

## Bornes & limites (toutes dans `webrtc2.config.js`)

- `MAX_PEERS_PER_ROOM = 8` — mesh sature au-delà (CPU + bande passante navigateur)
- `MAX_REMOTE_STREAMS = 12` + `STREAM_STALE_MS = 300_000` — éviction LRU dans `remoteStreamsMap` (anti-leak)
- `MAX_PAYLOAD_BYTES = 64 * 1024` — garde anti-DoS hub star (émission + réception)
- `HUB_MAX_MESSAGES_PER_WINDOW = 20` / `HUB_RATE_WINDOW_MS = 1000` — rate-limit `forwardStarMessage`
- `MAX_RETRY_ATTEMPTS = 8` / `MAX_RECONNECT_ATTEMPTS = 8` — bornes anti-boucle infinie

## Conventions de code

- **IDs de session** : `crypto.randomUUID()` — jamais `Math.random()` (cf. `ensureCurrentCallRoomId`)
- **PeerId local** : `ctx.peerStore.getLocalPeerId` — jamais le triple fallback historique `localPeer?.id || localPeer?._id || lastLocalPeerId`
- **Retry peer** : un seul système, `usePeerRetry` — pas de Map `inviteRetries` parallèle
- **Clé `remoteStreamsMap`** : `slug+type` canonique, passe unique (la double-passe historique venait d'une clé non fiable)
- **Identité du pair d'une entrée de `remoteStreamsMap`** : `entry.remoteSlug` — jamais `entry.metadata.from`. Sur une connexion **sortante**, `metadata.from` porte **mon** slug (cf. `_buildPeerConnectionConfig`), et le flux distant arrive bien sur cette connexion : filtrer sur `metadata.from` ne matche donc rien côté initiateur. `remoteSlug` / `remoteType` sont normalisés à l'écriture par `handleStreamReceived` — c'est ce qu'il faut lire
- **Garde de teardown** : `beginShutdown`/`endShutdown` sont un **compteur** ré-entrant. Un `beginShutdown` sans `endShutdown` (teardown terminal) laisse volontairement le garde actif pour de bon
- **Flags sur objets PeerJS tiers** : interdit (pas de `conn.__ctxListenersBound` etc.) — utiliser un `WeakSet` interne
- **API orchestrateur** : façade explicite minimale — pas de `...spread` des composables internes
- **Stream local** : attente via `watch` réactif — pas de polling `while (!stream && attempts < N)`
- **Signalisation prête** : `watch` sur `meStore.getMe?.slug` + `peerStore.localPeer?.id` — pas de `setTimeout` polling

## Cleanup obligatoire

- Tout `watch()` ⇒ `unwatch()` dans `onUnmounted`
- `setUpConnectionListeners` ⇒ retourne un unsub appelé au démontage du contexte
- Timers `setTimeout` de backoff ⇒ référence stockée et annulée dans `_destroyPeerSingleton`
- `contextRegistry` ⇒ entrée supprimée dans `onUnmounted` **seulement si elle appartient toujours au contexte** (voir [SECURITY_AUDIT.md](SECURITY_AUDIT.md) — last-write-wins volontaire)

## Pour aller plus loin

- Décisions sécurité + modèle de confiance : [SECURITY_AUDIT.md](SECURITY_AUDIT.md)
- TODO actifs (améliorations pérennisation) : [TODOLIST.md](TODOLIST.md)
- Vue d'ensemble du module : [README.md](README.md)
