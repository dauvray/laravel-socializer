# WebRTC2

Communication temps réel — data, audio, vidéo, partage d'écran — construite sur **PeerJS**,
organisée en composables Vue 3 empilés en couches strictes, avec des widgets de présentation.
La signalisation passe par Laravel Reverb (voir
[architecture/signalisation.md](../../architecture/signalisation.md)).

Code : `src/resources/js/socializer/components/WebRTC2/`

⚠️ **`components/WebRTC/` (sans le 2) est l'implémentation v1, morte.** Elle est toujours dans
l'arbre mais rien ne doit y être ajouté. Ses notes de lecture sont archivées dans
[`work/webrtc-v1-notes.md`](../../../work/webrtc-v1-notes.md).

---

## Où lire quoi

| J'ai besoin de… | Fichier |
|---|---|
| brancher la visio / le chat data / la diffusion dans un composant | [api.md](api.md) |
| comprendre pourquoi un flux n'arrive pas, ou un appel reste en « pending » | [flux.md](flux.md) |
| ajouter un composable, déplacer une responsabilité, toucher au Peer singleton | [architecture.md](architecture.md) |
| savoir qui voit quoi, ou ouvrir un nouveau chemin de connexion | [securite.md](securite.md) |
| écrire un test, ou comprendre pourquoi un test est vert à tort | [tests.md](tests.md) |
| savoir ce qui reste ouvert | [`work/webrtc2-todo.md`](../../../work/webrtc2-todo.md) · [`work/webrtc2-tests-plan.md`](../../../work/webrtc2-tests-plan.md) |

---

## Arborescence

```
WebRTC2/
├── webrtc2.config.js       source de vérité : bornes, ENDPOINTS, types valides, WEBRTC_API_KEY
├── Composables/            le cœur — une couche par fichier (voir architecture.md)
│   ├── createPeerContext.js       état, stores, FSM d'appel
│   ├── usePeerCore.js             signalisation HTTP (ask/response peerId, invitations)
│   ├── usePeerMedia.js            getUserMedia / getDisplayMedia + pool de players
│   ├── usePeerConnections.js      peer.connect / peer.call, diff de room, fermetures
│   ├── usePeerTransport.js        singleton Peer, dispatchers entrants, sendData, routage star
│   ├── useConnectionPool.js       retry, requestOrConnectPeer, syncUsersConnections
│   ├── useCallManager.js          FSM d'appel, handleRemoteDeparture
│   ├── useStreamManager.js        registre des flux distants (TTL + éviction LRU)
│   ├── useBroadcastPresence.js    annonce BROADCAST_STATE sur data channel
│   ├── useSignalingQueue.js       routage des signaux serveur entrants
│   ├── usePeerOrchestrator.js     composition + façade
│   ├── useMediaBroadcast.js       couche feature consommée par l'UI
│   └── utils/                     infra pure, sans état partagé, importable de partout
│                                  useCallStateMachine · usePeerRetry · createRateLimiter
│                                  payloadSize · sanitizeMetadata · resolveRemoteSlug · validators
├── EventBus/webrtc2Events.js   normalisation de call-user / close-call — ⚠️ pas encore consommée
├── Widgets/                    Mediaplayer/ (provider, players, pool) · UI/ (boutons, audio, debug)
├── Exemples/                   Home.vue + 3 UI de démonstration — documentation exécutable
└── __tests__/                  unitaires · mockFidelity · scenarios/ + helpers/ et __mocks__/
```

Hors du dossier mais indissociables :

- `stores/peers2.js` + `stores/peers2/{state,getters,actions}.js` — le store Pinia `usePeer2Store`,
  qui porte aussi le runtime du Peer singleton
- `components/System/Notifications.vue` — le pont Reverb → signaux, **monté en permanence**
- `components/System/composables/useReverbChannel.js` — voir
  [reference/use-reverb-channel.md](../../reference/use-reverb-channel.md)

---

## Topologies

- **mesh** — connexions pair-à-pair directes entre tous les membres, jusqu'à `MAX_PEERS_PER_ROOM`.
  Visio, vocal, petits salons.
- **star** — un hub relaie les messages data via `forwardStarMessage`. Rooms nombreuses. Le hub voit
  les payloads en clair, et c'est délibéré : [securite.md](securite.md).

---

## Le symptôme

Tous les incendies du module ont produit le même symptôme utilisateur — **« A diffuse, B arrive, B
ne voit rien »** — avec chaque fois une cause racine différente. Un test de couche isolée ne peut
pas l'observer : il n'est vrai ou faux que **vu de B**. C'est la raison d'être de l'étage
`__tests__/scenarios/`, et le tableau des causes déjà rencontrées est dans
[flux.md](flux.md#où-ça-casse--causes-racines-déjà-vues).
