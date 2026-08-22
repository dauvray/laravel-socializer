# Signalisation temps réel

> **À quoi ça sert :** comment un événement part du serveur et arrive dans un composable Vue.
> **Quand le lire :** pour ajouter un événement temps réel, un canal, ou débugger un signal
> qui n'arrive pas.

Transport : **Laravel Broadcasting → Reverb → Laravel Echo**. Aucun socket.io, aucun serveur de
signalisation maison. WebRTC lui-même passe par **PeerJS** (serveur PeerJS externe + STUN Google +
TURN coturn).

---

## Canaux

`src/routes/socializer/channels.php`

| Canal | Type | Autorisation | Usage |
|---|---|---|---|
| `App.Models.User.{userId}` | privé | `$user->id === $userId` | **toute la signalisation WebRTC2** |
| `chat.{chatId}` | présence | `canJoinchatRoom()` — appartenance au chat | messages de chat, liste `users` |
| `room.{roomId}` | présence | `canJoinRoom()` ou `isCreator()` | rooms de serveur |
| `server.{serverId}` | présence | `canJoinServer()` | liste des membres d'un serveur |
| `questionnaire.{roomId}` | **privé** | `canJoinRoom()` ou `isCreator()` | questionnaires |

Les canaux de présence retournent une `PresenceUser` — c'est elle qui alimente la prop `users` des
composants, et son périmètre est délibérément restreint (§ suivant). ⚠️ `questionnaire.{roomId}` en
retourne une aussi mais est consommé en `Echo.private()` (`Data/QuestionnaireComponent.vue`, et son
émetteur `Events/QuestionnaireAnswered.php` rend un `PrivateChannel`) : seule la véracité du retour
compte, la ressource est construite pour rien. Elle reste alignée sur les trois autres — un canal
consommé demain en `Echo.join()` ne doit pas rouvrir la fuite que le § suivant décrit.

### Ce que la présence mesure : un onglet ouvert

Un canal de présence compte des **souscriptions**, donc des onglets — ni des membres, ni des
personnes actives. Trois conséquences à ne pas confondre quand un compteur « se trompe » :

- **« connecté à l'app » ne suffit pas à être compté.** `Server.vue` est le seul à souscrire à
  `server.{serverId}` ; le feed, la liste des domaines, un mur n'y touchent pas. Quitter la page
  serveur par une navigation SPA libère bien le canal (`Echo.leave('server.…')` — vérifié).
- **Un onglet d'arrière-plan compte.** Une fenêtre oubliée sur la page serveur est « présente ».
  Distinguer présence et activité demanderait un mécanisme en plus (`visibilitychange` + whisper) —
  c'est une fonctionnalité, pas un correctif : [`work/serveur-todo.md`](../../work/serveur-todo.md).
- **Le nombre de membres, lui, n'est pas dans la présence** : il vient de `nb_users`
  (`Services/Server::getServer`) — aujourd'hui faux sur un serveur privé, même fichier de chantier.

Devant un compteur suspect, **interroger Reverb avant de soupçonner le front** :
`GET /apps/{appId}/channels/presence-server.{id}/users`.

### Une charge utile de présence est fabriquée par son propre sujet

C'est le fait le moins intuitif de tout le transport, et il a deux conséquences qui n'ont rien à
voir entre elles.

Chaque `user_info` est construite pendant la requête `/broadcasting/auth` **du membre qu'elle
décrit** — jamais pendant celle du membre qui la lira. Donc `Auth::user()` y est **toujours** le
sujet de la donnée. Reverb stocke le résultat par connexion, puis le diffuse aux autres membres
via `here` et `member_added`.

D'où la règle : **les quatre canaux de présence renvoient `PresenceUser`, jamais `Resources\User`.**
Son périmètre est une **liste blanche** de six champs — `id`, `name`, `slug`, `image`, `function`,
`connected` — et elle ne consulte aucune identité de requête. La liste blanche n'est pas un détail
de style : le bloc privé d'`EstarterUserResource` n'était pas la seule source, `Resources\User`
ajoutait *aussi* son propre `groups` sans condition. Une liste noire aurait fermé la première,
manqué la seconde, et n'aurait rien dit du champ ajouté demain en amont.
Épinglé par `tests/Feature/Channels/PresencePayloadTest.php`.

- **`is_me` n'est pas dans cette liste, et ce n'est pas un oubli** : absent vaut mieux que
  trompeur. Il valait `true` sur TOUTES les entrées d'une liste de présence — un front qui s'en
  servait pour distinguer « moi » se trompait sur chaque ligne. Le juge côté client est le store
  `me` (`ServerUsersList.isMe` en donne le patron). Le champ reste juste sur une charge utile
  **HTTP**, où `ThumbnailWidget` et `Cover` s'en servent légitimement.
- **Ne pas confondre les deux ressources.** `PresenceUser` ne convient pas à un mur ni à un
  profil : `identifier`, `may_reach`, `groups`, `nb_followers` y sont lus, et c'est
  `Resources\User` qui les porte.

La leçon réutilisable, jumelle de celle de C2 sur le graphe : **un garde qui dépend de
`Auth::user()` ne veut plus rien dire dans un contexte où `Auth::user()` est toujours le sujet de
la donnée.** Le périmètre d'une ressource de diffusion se décide dans la ressource, pas dans
l'identité de la requête qui l'a fabriquée.

⚠️ Reste ouvert, même famille et autre vecteur : `filterSensibleDataUserRessource()`, la **liste
noire** qui filtre les charges utiles d'auteur de message
([`work/webrtc2-securite-2026-08-14.md`](../../work/webrtc2-securite-2026-08-14.md), tâche **E9**).

Les méthodes `canJoin*` viennent du trait `Socializable` (`src/app/Helpers/ModelTraits/`) et
interrogent NebulaGraph. **Un graphe muet vaut un refus** : `execute()` rend un `JsonResponse`
*truthy* sur erreur nGQL et ne lève jamais — les quatre gardes traitent donc toute réponse
inexploitable comme une absence de droit (`ChannelGuardTest`). ⚠️ `canJoinRoom` / `canJoinServer`
restent des gardes de canal et **non** des prédicats d'appartenance : sur `privacy == 0` ils
répondent `true` à tout le monde
([securite.md](../modules/webrtc2/securite.md)).

⚠️ Envoyer un message n'inscrit plus son auteur dans le chat : `Chat::checkRegistration` refuse
d'inscrire un appelant que le chat ne connaît pas, et l'entrée dans le chat d'un salon est déléguée
au garde du salon (`Chat::registerInRoomChat`). Sans ces gardes, un POST de message posait l'arête
`registered_in` et rouvrait au join suivant le canal que `canJoinchatRoom` venait de fermer
(`ChatRegistrationTest`).

Côté JS, la souscription passe par `useReverbChannel` / `useReverbPresence` —
voir [reference/use-reverb-channel.md](../reference/use-reverb-channel.md).

---

## Les cinq événements de signalisation WebRTC2

Émis en **broadcasting anonyme** (`Broadcast::private(...)->as(...)->with([...])->sendNow()`) — d'où
l'absence de classes d'Event dédiées dans `src/app/Events/`. Nommés via `->as(...)`, donc écoutés
avec le point de tête côté JS.

Contrôleur unique : `src/app/Http/Controllers/Front/UserController.php`, section
`/*--- SIGNALING ---*/`. Routes : `src/routes/socializer/routes.private.php`, section `WEBRTC`
(+ `/send-alert-to-user`).

| Événement | Méthode PHP | Route | Consommé par `Notifications.vue` |
|---|---|---|---|
| `.AskToPeerID` | `askForPeerId` | `/ask-to-peer-id` | `dispatchSignal(PEER_CONNECTION_REQUEST)` |
| `.ResponseToPeerID` | `responseToPeerId` | `/response-to-peer-id` | `dispatchSignal(PEER_CONNECT_TO_REMOTE_PEER)` |
| `.AlertToUser` | `sendAlertToUser` | `/send-alert-to-user` | affiche `System/widgets/AlertComponent.vue` |
| `.ResponseToAuthorizationPeer` | `responseToPeerAuthorization` | `/response-to-authorization-peer` | `openCallBetweenPeer` |
| `.CloseConnectionToPeerID` | `closeConnectionToPeerId` | `/close-connection-to-peer-id` | `remoteStopCall` |

Seuls les **deux premiers** passent par la file de signaux. Les trois autres sont consommés
directement par `Notifications.vue`.

---

## Quatre invariants backend

**1. `fromUserSlug` diffusé est toujours `Auth::user()->slug`**, jamais la valeur du payload.
`closeConnectionToPeerId` journalise tout écart (`auth_user_id`, `auth_user_slug`, `claimed_slug`,
`target_slug`, `ip`, `user_agent`) — c'est le format à reproduire pour tout nouveau garde.

**2. Liste blanche stricte** : le backend ne relaie que les champs qu'il nomme dans `->with()`.
`__tests__/helpers/fakeSignalingServer.js` la reproduit **à l'identique**, volontairement. La
desserrer fabriquerait un chemin impossible en production et rendrait le harnais menteur ; y ajouter
un champ côté JS sans l'ajouter côté PHP produit un champ qui n'arrive jamais.

**3. Les payloads sont validés dans le contrôleur, jamais avant.** Chaque méthode ouvre sur un
`$request->validate()` : `toUserSlug` en format slug, `type` / `connectionType` en liste blanche
(miroir de `VALID_CONNECTION_TYPES`), `peerId` en UUID, `room` bornée en longueur, et `options`
réduit à ses clés attendues — c'est le seul champ relayé verbatim. La validation est posée **avant
la résolution du destinataire et hors du `try`** : `ValidationException` étend `\Exception`, donc à
l'intérieur elle repartirait en 500 par le handler d'échec. Le `throttle`, lui, s'exécute **en
amont** du contrôleur : la clé de plafonnement porte un `toUserSlug` encore non validé.

**4. Un refus est uniforme jusqu'au libellé, et il dit pourquoi.** Le garde de relation
(`Socializable::mayReach`) répond le même 403 sur un slug inconnu et sur une absence de relation —
corps compris, message compris : distinguer les deux causes par le texte rouvrirait l'oracle
d'énumération que le code de retour ferme. Et ce corps porte un `message`, parce qu'il est **affiché**
— `AjaxService` d'estarter en tire un toast, qui restait vide sans lui. Même règle pour l'échec de
broadcast (500), dont le message est une constante : le diagnostic vit dans le `Log::error`, jamais
dans la réponse. Voir [modules/webrtc2/securite.md](../modules/webrtc2/securite.md).

---

## `type` vs `connectionType` — ne jamais les confondre

C'est le piège n°1 de la signalisation, et il a coûté deux régressions.

| Champ | Ce que c'est | Qui le lit |
|---|---|---|
| `type` | type du **contexte** (`ctx.session.currentType`) | **clé de routage** : `Notifications.vue` en dérive `roomId = '<type>-<room>'`, qui doit être le `contextId` du destinataire |
| `connectionType` | type de connexion réellement demandé (`'screen'`…) | `connectToPeer`, qui ouvre ce type-là |

Mettre `'screen'` dans `type` envoie la réponse dans une file **que personne n'observe** :
`'screen'` n'a pas de contexte à lui. C'est pourquoi le type demandé a son champ propre, relayé tel
quel par `askForPeerId` / `responseToPeerId`.

Avant ce champ, la signalisation n'ouvrait **jamais** la connexion d'écran vers un arrivant : seul
le moteur de retry le faisait, ~1,5 s plus tard. Le partage d'écran reposait donc entièrement sur
la chaîne de retry, ce qui l'a rendu totalement cassable deux fois par un simple `return` prématuré.

`connectionType` absent ⇒ repli sur `type` — rétrocompatible avec un backend non déployé.

---

## La file de signaux

```
UserController → Reverb → Echo → Notifications.vue
   └─ peerStore.dispatchSignal({ roomId, type, payload })
        └─ signalQueues[roomId]   (plafond 10 par room, seq monotone par room)
             └─ ctx.lastRoomSignal   (= at(-1))
                  └─ useSignalingQueue._route → table `routes`
```

- **`roomId` est le `contextId` du destinataire**, dérivé côté `Notifications.vue` par
  `` `${event.type}-${event.room}` ``.
- **Table de routage unique**, construite par l'orchestrateur
  (`usePeerOrchestrator.js`) : `PEER_CONNECTION_REQUEST → core.responseRemotePeerConnection`,
  `PEER_CONNECT_TO_REMOTE_PEER → connections.connectToPeer`. Elle remplace l'ancien couple
  `SIGNAL_TYPES` + `switch` — avec deux sources de vérité, un type listé sans `case` était ignoré en
  silence et un `case` sans entrée était injoignable.
- **Sémantique `at(-1)`, pas de drain.** Deux signaux dispatchés dans le même tick n'en
  déclencheraient qu'un. **Vérifié : aucun chemin actuel ne produit cette condition** — producteur
  unique sans boucle, et un event Reverb = une frame WebSocket = une tâche de boucle d'événement,
  entre lesquelles les microtâches (donc le flush du `watch`) sont drainées.
- **Détecteur de coalescence** : `dispatchSignal` estampille chaque signal d'un `seq` monotone **par
  room**, et `_route` loggue tout trou (`N signal(s) non routé(s) (seq x→y)`). Trois décisions à ne
  pas défaire — le compteur est par room (un compteur global créerait un faux positif à chaque signal
  d'une autre room), il **survit à `clearSignalQueueRoom`** (sinon rewind à gérer côté consommateur),
  et il **avance même sur un signal non routable** (sinon le trou deviendrait permanent).
- **Le routage ne pose aucune précondition** — invariant, voir
  [modules/webrtc2/architecture.md](../modules/webrtc2/architecture.md#le-routage-ne-pose-aucune-précondition).

⚠️ Ne pas ré-exposer la file via `computed(() => peerStore.getQueueForRoom(contextId))` : ce computed
ne trace que la *clé* `signalQueues[contextId]`, qu'un `push` ne touche pas — il n'est donc jamais
invalidé et aucun `watch` ne se déclenche dessus. C'est pourquoi l'ancien `roomSignals` n'avait
jamais pu être consommé et a été supprimé. Il faut watcher un **scalaire** dérivé de la file
(ex. `at(-1)?.seq`).

---

## Un troisième canal : le data channel PeerJS

Hors Reverb. Il porte les enveloppes de routage star, les annonces `BROADCAST_STATE` et les
projections d'état des Widgets — voir
[modules/webrtc2/architecture.md](../modules/webrtc2/architecture.md#signaux-datachannel--trois-enveloppes-trois-consommateurs).

---

## Ajouter un événement

1. Émettre en PHP : `Broadcast::private("App.Models.User.{$user->id}")->as('.MonEvent')->with([...])->sendNow()`,
   avec `Auth::user()->slug` comme source de vérité pour toute identité, et une liste blanche
   explicite de champs.
2. Déclarer la route dans `routes.private.php` en référençant le contrôleur **par config**
   (`config('socializer.controllers_front.user').'@maMethode'`), jamais en dur.
3. Écouter dans `System/Notifications.vue`, via le `listeners` de `useReverbChannel`.
4. Si l'événement doit atteindre un composable WebRTC2 : `dispatchSignal` avec
   `roomId = '<type>-<room>'`, puis **inscrire le verbe dans la table `routes`** de l'orchestrateur.
   Ne jamais poser un `watch` sur `ctx.lastRoomSignal` ailleurs.
5. Répercuter le champ dans `__tests__/helpers/fakeSignalingServer.js` **si et seulement si** le PHP
   le relaie.
