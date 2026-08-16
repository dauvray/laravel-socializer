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
| `chat.{chatId}` | présence | `canJoinchatRoom()` | messages de chat, liste `users` |
| `room.{roomId}` | présence | `canJoinRoom()` ou `isCreator()` | rooms de serveur |
| `server.{serverId}` | présence | `canJoinServer()` | liste des membres d'un serveur |
| `questionnaire.{roomId}` | présence | `canJoinRoom()` ou `isCreator()` | questionnaires |

Les canaux de présence retournent une `UserResource` — c'est elle qui alimente la prop `users` des
composants. Les méthodes `canJoin*` viennent du trait `Socializable`
(`src/app/Helpers/ModelTraits/`) et interrogent NebulaGraph.

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
