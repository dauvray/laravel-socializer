# Whiteboard — Todo

> Chantier ouvert sur le **tableau blanc** : son service PHP, ses deux routes, et son chemin de
> persistance. Le canal data temps réel du module, lui, appartient à
> [`webrtc2-todo.md`](webrtc2-todo.md) et à la migration v1 → v2 de
> [`doc-rustines.md`](doc-rustines.md) — ne pas mélanger : ce fichier ne parle pas de WebRTC.
>
> Effort : `[S]` `[M]` `[L]`

---

## 🔴 Les deux routes du tableau n'ont AUCUNE garde d'autorisation `[M]`

Ouvert le 01/09/2026, en cartographiant le second chemin du Whiteboard (celui de `save_board = 1`)
pendant le correctif du renvoi de scène à un arrivant. **Indépendant de ce correctif** : rien de ce
qui est décrit ici n'a été introduit par lui, et rien de ce qui est décrit ici n'a été refermé par
lui.

`app/Services/WhiteBoard.php` porte deux fois le commentaire `// todo a protéger`, et il dit vrai.

### Ce qui est exact, vérifié le 01/09/2026

- **Les trois clés viennent du client et ne sont confrontées à rien.** `saveWhiteBoard` fait un
  `updateOrCreate` sur `server_id` + `room_id` + `vertexid`, tous trois lus dans la requête ;
  `loadWhiteBoard` fait le `where` symétrique. Aucun `Gate`, aucune `Policy`, aucun `authorize()`,
  aucune lecture d'appartenance — ni dans le service, ni dans
  `app/Http/Controllers/Front/WhiteBoardController.php`, qui ne fait que déléguer.
- **Le périmètre exact est « tout utilisateur connecté ET vérifié ».** Les deux routes vivent dans
  `routes/socializer/routes.private.php`, chargé par `routes.php` sous
  `config('estarter.routes_middlewares.classic.private')` = `['web', 'auth', 'routeProtect',
  'verified', 'restrictedMode']`. Ce n'est donc **pas** exposé à un anonyme — et c'est la seule
  bonne nouvelle de cet item.
- **`routeProtect` ne compense pas.** Il décide de l'affichage et de l'accès à une route au sens du
  menu, pas de la propriété des trois ids postés. Aucun `MenuItem` ne correspond à ces deux routes.
- **`save_board` ne protège rien.** Ce réglage décide seulement si le *client* appelle ces routes.
  Le serveur répond dans tous les cas, y compris pour une room dont `save_board` est `NULL`.
- **L'écriture réattribue la propriété au passage** : `model_id` / `model_type` sont écrasés avec
  l'utilisateur courant. Un écrasement ne laisse donc pas de trace de la victime.

Conséquence, en une phrase : **tout utilisateur connecté peut lire ou écraser le tableau de
n'importe quelle room** en forgeant `server_id`, `room_id` et `vertex_id` — trois valeurs qu'il
obtient de sa propre session, ou par énumération.

### ⚠️ Le correctif naïf est faux DEUX fois — ne pas le poser

L'envie immédiate est d'ajouter `$this->user->canJoinRoom($request->get('room_id'))`. Ne pas le
faire tel quel : `canJoinRoom` **n'est pas un prédicat d'appartenance**, et son propre docblock le
dit (`Socializable.php`, règle 2, et `docs/modules/webrtc2/securite.md` piège 1) :

1. sur `privacy == 0`, sa clause est vraie pour **n'importe quel couple** — la garde autoriserait
   donc tout le monde sur toute room publique, c'est-à-dire ne fermerait rien là où le volume est ;
2. une room publique **vide** refuse jusqu'à son propriétaire — la garde fermerait donc un usage
   légitime.

⚠️ **Ne pas généraliser depuis ses sœurs** : `canJoinchatRoom` (21/08/2026) et `canJoinServer`
(24/08/2026) **sont**, elles, des prédicats d'appartenance. `canJoinServer` lit MariaDB, les deux
autres le graphe — chaque donnée chez son maître. Le modèle d'usage existant à imiter est
`Services/Chat.php:119`, qui apparie le garde avec `isCreator` : `if (! canJoinRoom(...) && !
isCreator(...))`. Cet appariement traite le point 2 ci-dessus, **pas** le point 1.

### La décision à prendre avant d'écrire une ligne

Ce n'est pas un oubli de garde, c'est une politique absente. Trois questions, dans cet ordre :

- [ ] **Qui a le droit d'ÉCRIRE sur le tableau d'une room ?** Tout membre du serveur ? Tout membre
      de la room ? Le créateur seul ? Un rôle ? La réponse n'est pas déductible du code — la
      trancher est le préalable, et elle appartient à David.
- [ ] **Qui a le droit de LIRE ?** Pas forcément la même réponse : un tableau peut se vouloir
      lisible par tout le serveur et modifiable par les seuls inscrits de la room.
- [ ] **Les trois ids désignent-ils bien la même room ?** Aujourd'hui `room_id` et `vertex_id`
      reçoivent la **même** valeur côté client (`whiteBoardId`, deux fois), et `server_id` n'est
      recoupé avec rien. Une garde posée sur `room_id` seul laisserait `server_id` libre, donc la
      clé composite du document toujours forgeable. Le garde doit porter sur le **triplet**, ou le
      triplet doit être réduit.

### Une fois tranché

- [ ] Poser la garde dans le **service**, pas dans le contrôleur : `config('socializer.controllers_front.whiteboard')`
      est substituable par l'hôte, donc un garde posé dans le contrôleur disparaît chez qui le
      remplace.
- [ ] Épingler par un test PHP (Orchestra Testbench, depuis le paquet — voir
      `docs/architecture/tests.md`). **Rouge d'abord** : un test d'autorisation écrit après le
      correctif est vert dès qu'il ne mesure rien. Le cas qui compte est « un connecté NON membre
      poste le triplet d'une autre room » — pas « un membre y arrive ».
- [ ] Écrire la règle retenue dans la doc du module, **une seule fois**, et y renvoyer d'ici.

---

## Ailleurs, et volontairement pas ici

- **Les trois défauts du chemin de chargement** (`loadWhiteBoard` rend `null` et `updateScene`
  l'applique en silence · `loadScene()` sans `.catch`, appelé dans `created()` avant l'existence des
  refs · la fenêtre où `excalidrawAPI` n'est pas prêt à l'arrivée d'une scène) sont au **lot 5 de
  [`doc-rustines.md`](doc-rustines.md)**, « à arbitrer et assumés ». Ils y ont été insérés le
  01/09/2026 et **ne sont pas recopiés ici** : deux copies d'un même fait divergent toujours.
- **Le plafond de 64 Ko** du canal data, que la scène Excalidraw frôle et qu'une image collée
  franchit (~294 Ko mesurés), appartient au même lot 5 et son contrat vit dans
  `docs/modules/webrtc2/api.md`.
- **Le renvoi de scène à un arrivant** est corrigé (01/09/2026, `sendDataOnConnection`). Son
  histoire est dans `git log` et son contrat dans `docs/modules/webrtc2/api.md`.
  ℹ️ Daté à la relecture de la v1 : le défaut était **antérieur au lot D1**, pas une régression de
  la migration v2. En v1, `setRemoteConnection` (« add when you are called ») n'était appelé que par
  trois callbacks **média** — `visioPlayerCallback`, `vocalPlayerDataCallback`,
  `visioPlayerDataCallback` — jamais par le canal data pur, et le `sendData` du store v1 n'itérait
  lui aussi que des connexions sortantes. Le renvoi était déjà, mot pour mot, un
  `handleExcalidrawMouseUp` — donc déjà une diffusion à tous et non un envoi ciblé.
