# WebRTC2 — Todo

> Chantier ouvert. Les items **terminés** sont élagués : leur rationale vit dans
> [`docs/modules/webrtc2/`](../docs/modules/webrtc2/INDEX.md), leur récit dans `git log`.
> Tests : [webrtc2-tests-plan.md](webrtc2-tests-plan.md).
>
> Effort : `[S]` `[M]` `[L]`

---

## 🧊 Gelé — déplacer le routage star dans `usePeerTransport` `[L]`

Sortir de `usePeerOrchestrator` le wrapping du routage star, actuellement dans
`initializePeerConnection` (~245 lignes avec les passthroughs média). Nécessite un
middleware/pipeline de données dans `createPeerContext`, ou un composable `usePeerRouter` dédié.

**Gelé pendant la stabilisation.** C'est exactement le type de refacto structurelle qui a produit
les régressions du 13/08 ; il attend que les scénarios servent de filet.

**Bloque** les tâches 6 et 7 de [webrtc2-tests-plan.md](webrtc2-tests-plan.md) : écrire ces tests
avant le déménagement revient à les jeter.

---

## usePeerTransport

- [ ] **`peerInitPromise` devrait couvrir jusqu'à `'open'`** `[M]`
  Le garde d'instance ferme la fenêtre, mais le fond du problème reste : « init terminée » ne
  signifie pas « peer utilisable ». Faire de `_doInit` une promesse qui `await` réellement
  l'événement `'open'` (avec rejet sur `error` et timeout) rendrait la sémantique honnête et
  permettrait aux appelants de s'y raccrocher — notamment `useCallManager`, dont le
  `const ready = transport.setLocalPeer(); if (!ready) return` a été retiré comme garde mort.
  ⚠️ **Écarté de la passe de régression** : une vingtaine de tests font `await api.setLocalPeer()`
  **avant** de déclencher `'open'` et se bloqueraient. C'est une refonte du harnais autant que du code.
- [ ] **La machine à états du cycle de vie du Peer** `[L]`
  Six prédicats coexistent pour répondre à « ai-je un peer utilisable, et quel est son id ? » :
  `localPeer`, `localPeerReady`, `lastLocalPeerId`, `peerInitPromise`, `localPeer.disconnected`,
  `localPeer.destroyed`. Ils divergent, et c'est la cause commune de la majorité des pannes du
  module. `peerStore.peerIdentity()` les réconcilie déjà en un fait unique
  (`{ state, id, lastId, consumers }`) et `peerStateViolations()` nomme les six contradictions —
  mais **aucun lecteur n'est migré** : c'est un instrument de mesure, pas encore la source de
  vérité.
  ⚠️ **Portée réelle mesurée : 68 cas de test**, pas 20. Deux fichiers entiers
  (`usePeerTransport.incomingAuth`, 24 cas ; `usePeerTransport.peerUnavailable`, 12 cas)
  **n'émettent jamais `'open'`** : leur `beforeEach` est à réécrire, pas à réordonner.
  **Préalable obligatoire** : extraire dans `__tests__/helpers/` le motif non-bloquant qui
  existe déjà à `createVirtualPeer.js` (dupliqué dans
  `usePeerOrchestrator.broadcastPresence.test.js`). Et `useCallManager.test.js` +
  `:81-89` sont la spécification de surface à renégocier, pas des dommages collatéraux.
- [ ] **Fidélité du mock : `disconnect()` ne met pas `_id` à `null`** `[S]`
  Le vrai `Peer.disconnect()` fait `this._id = null` (`bundler.mjs:1809`) ; le mock conserve
  l'id — écart assumé et documenté (le registre du bus est keyé sur `id`, et trois scénarios
  appellent `destroy()` directement). Conséquence : la divergence identité courante /
  identité historique, qui est le cœur de la panne silencieuse, n'est pas reproductible en
  test. Fermer cet écart demande de rekeyer le bus sur une clé stable.
- [ ] **Fidélité du mock : `open` des connexions est inscriptible** `[S]`
  `peerjsMockFidelity.descriptors.test.js` couvre les **sept accesseurs du `Peer`**. Les
  connexions (`DataConnection`, `MediaConnection`) exposent aussi `open` en lecture seule dans
  la vraie lib, et le mock le laisse inscriptible — 12 sites de test s'appuient sur
  `conn.open = true`. Aucun code de production n'y écrit aujourd'hui (vérifié au grep), donc la
  classe de bug est fermée côté production ; l'étendre demande un verbe de mock et la reprise
  des 12 sites.

---

## Chaîne de présence — ce qui reste en amont du bail

> Trouvés en posant **le bail des peerId** (livré le 26/08/2026), qui les rend non fatals sans les
> corriger : un mapping périmé n'est plus composé, mais une composition de room perdue reste perdue.
> D'où des items séparés — mélanger deux mécanismes dans une même passe rendrait indécidable lequel
> a fait le travail.
>
> **Trois verrous sont fermés** : `syncUsersConnections` coalesce au lieu de jeter la composition
> reçue (27/08), le tour sur liste vide purge sans déclarer la présence connue (27/08), et le fan-out
> réconcilie au lieu de differ (28/08). Les trois invariants vivent dans
> [architecture.md § Conventions de code](../docs/modules/webrtc2/architecture.md#conventions-de-code).
> Ce qui suit ne s'en déduit pas : un tour qui a bien lieu peut encore ne rien voir.
- [x] **Le diff de présence est aveugle à un pair parti et revenu entre deux instantanés** `[M]` —
  fermé le 28/08/2026, mais **pas par le mécanisme que cet item nommait**, et c'est le résultat
  principal. Trois réfutations, consignées pour que personne ne les re-dérive :
  1. **le « même flush Vue » n'existe pas** — pusher-js émet un événement par frame
     (`pusher.ts:110-118`, `presence_channel.ts:74-95`), Echo les mappe 1:1, une frame WebSocket est
     une tâche et un flush `'pre'` est une microtâche : il est drainé entre deux frames ;
  2. **réfutation décisive, côté serveur** — Reverb supprime l'un des deux événements dès qu'ils se
     chevauchent (`InteractsWithPresenceChannels::userIsSubscribed` : pas de `member_added` si déjà
     abonné, pas de `member_removed` s'il reste une connexion). Un rechargement produit donc soit
     `(remove, add)` en deux frames — traité correctement — soit **rien du tout** ;
  3. **la branche coalescente de `syncUsersConnections` n'a aucun chemin d'entrée** — en régime
     établi un tour est borné aux microtâches, et la seule fenêtre large (`waitForMeReady` pendant)
     est celle où le diff n'a **rien** écrit, donc où `usersInRoom` est vide et où personne n'est
     perdu. `lastLocalPeerId` ne tombe que quand le dernier consommateur se démonte.

  Les deux mécanismes qui produisaient réellement le dommage — **(a)** coupure de présence au
  reconnect Echo, `here()` rejoué avec la liste complète ; **(b)** rechargement chevauchant, zéro
  événement de présence — et la correction (« le fan-out réconcilie, il ne diffe pas ») sont dans
  [architecture.md](../docs/modules/webrtc2/architecture.md#conventions-de-code). ⚠️ Le cas **(b)**
  n'est réparé qu'au **prochain** tour de présence, quel qu'en soit le motif : aucun tour n'a lieu au
  moment du rechargement, donc aucune correction fondée sur la présence ne peut faire mieux. Le
  déclencheur structurellement juste serait la **fermeture de connexion** — item ci-dessous.
- [ ] **Re-composer sur fermeture de connexion, pas seulement sur tour de présence** `[M]`
  Le fait qui change lors d'un rechargement est la connexion, pas la présence : le déclencheur juste
  est `handleClose`, pas le tour de présence. C'est ce qui fermerait le cas **(b)** ci-dessus sans
  attendre un tour. Le discriminant existe déjà (`isAuthorizedPeer(slug, ctx)`, celui de
  `_handleConnectionAttempt`). Ce qui rend l'item non trivial : le point d'entrée unique d'une
  disparition de pair est `useCallManager.handleRemoteDeparture`, et transformer un chemin de purge
  en chemin de rétablissement traverse la frontière de couche que son en-tête déclare — de plus il
  avale ses exceptions, donc une version cassée serait verte.
- [ ] **`roomMembers` n'a pas de contrat de fraîcheur** `[M]`
  `getters.js:180` (`isUserInAnyRoom`) : un contexte monté qui ne reçoit plus de `props.users` frais
  épingle le slug pour l'onglet entier, et `removeRemotePeerId` devient un no-op permanent. Même
  question de conception un étage au-dessus — à traiter avec « Migrer `usersInRoom` vers Pinia »
  ci-dessous, pas avant. Le préjudice résiduel se limite désormais à la longévité de l'entrée
  d'allowlist, qui reste gardée par l'égalité `conn.peer`.
- [ ] **Le client star compose son hub même absent de la room** `[S]`
  `useConnectionPool._doSyncUsersConnections`, branche star client : `requestOrConnectPeer(hubSlug)`
  est appelé sans regarder `newUsers` ni la composition — donc à **chaque** tour de présence, y
  compris ceux où le hub n'est pas membre. Un POST `/ask-to-peer-id` part, un slot du plafond de
  cadence est consommé, un retry s'arme ; le garde d'`isAuthorizedPeer` ne le rattrape qu'un tour
  plus tard, dans `_handleConnectionAttempt`.
  ℹ️ Le garde « pas d'observation, pas d'émission » (27/08/2026) neutralise le cas du **tour vide**,
  pas celui d'une room peuplée sans le hub. `ctx.isHubConnected` (`createPeerContext.js:218`) existe
  déjà pour l'exprimer. Laissé ouvert délibérément : c'est un autre mécanisme, et le corriger dans
  la même passe rendait indécidable lequel des deux avait fait le travail. Le reprendre demande de
  réécrire « star : un client ne se connecte qu'au hub » (`useConnectionPool.test.js`), qui stube
  `getRoomUsersDiff` et laisse donc `usersInRoom` vide.
  ⚠️ **COUPLAGE, découvert le 28/08/2026 : ne pas le corriger seul.** Cet appel inconditionnel était,
  par accident, la **seule réconciliation** que le module possédait — la branche star client est la
  seule qui rattrapait un hub ayant rechargé sans que son départ soit annoncé. Depuis que le fan-out
  réconcilie (28/08), la règle générale couvre le cas ; l'item devient donc une **simplification**
  sous tests verts, à faire **après**, jamais avant. Le prédicat à poser est le même que celui de la
  réconciliation, restreint au hub : membre de la room **et** rien d'établi.
- [ ] **Un canal de présence mémoïsé peut rendre `users` définitivement vide** `[S]` — piège latent,
  **aucun consommateur vivant ne l'atteint aujourd'hui**, d'où l'effort `[S]` et pas de correction
  dans la passe où il a été trouvé (28/08/2026).
  `useReverbChannel.leave()` saute `Echo.leave()` quand un autre consommateur tient le même nom (le
  compteur de consommateurs, qui est là pour ça) — mais Echo mémoïse ses canaux, donc le canal pusher
  sous-jacent reste `subscribed: true`. Un consommateur qui se démonte puis se remonte sur ce nom
  re-branche son `here()` sur un canal qui ne ré-émettra **jamais** `subscription_succeeded` : son
  `users` reste à `[]` pour de bon, alors que `leave()` vient de le vider. `usersInRoom` étant
  l'allowlist des deux gardes d'autorisation, le contexte n'admettrait plus personne.
  Non joignable aujourd'hui : `Exemples/Home.vue` est le seul consommateur de présence de son canal,
  et `Server.vue`, `Room.vue`, `ChatComponent.vue` utilisent des noms distincts. Le jour où deux
  composants partagent un nom de canal de **présence**, c'est joignable.

---

## Annonce de diffusion — ce qui reste après le champ `isBroadcasting`

> Le champ embarqué sur les deux routes de peerId (livré le 27/08/2026) ferme la fenêtre entre
> l'arrivée dans la room et le premier contact P2P, où l'arrivant n'avait localement AUCUN moyen de
> savoir qu'un flux venait. Ce qui suit est ce qu'il ne ferme pas — **trois** fenêtres résiduelles,
> dont la troisième a été trouvée par la mesure du 28/08 et n'est pas de même nature que les deux
> autres : ce n'est pas « la vignette arrive tard », c'est « le fait n'arrive pas ».
>
> ⚠️ **Et une vignette qui n'est jamais visible** — défaut de rendu, étage CSS, item séparé plus bas.
> Les deux se cumulaient : c'est pourquoi la mesure a dû instrumenter le DOM et la géométrie, pas
> l'écran.

- [ ] **Les deux premières fenêtres résiduelles** `[M]` — **aucune des deux n'est fatale** : la
  vignette d'attente y arrive tard, elle n'y est jamais fausse. Les trois chemins d'annonce et leurs
  bornes : [flux.md](../docs/modules/webrtc2/flux.md#comment-un-arrivant-sait-qui-diffuse).
  1. **Avant la première demande de peerId** — `syncUsersConnections` attend `waitForMeReady`, donc
     l'identité locale et le peerId : tant qu'elle n'est pas là, aucun POST n'est parti et il n'y a
     rien à embarquer. Longue au premier chargement — `/get-ice-servers` est `await`é avant
     `new Peer` (jusqu'à `ICE_FETCH_TIMEOUT_MS`), puis vient la poignée de main du serveur PeerJS.
     **Mesurée le 28/08 : 592 ms** entre le `goto` et la frame portant `isBroadcasting`, cache HTTP
     chaud. Donc bien plus courte que la borne théorique de 3 s.
     ⚠️ **La phrase « fenêtre courte en régime établi, le `Peer` de l'onglet est déjà ouvert quand on
     navigue en SPA » était vraie et trompeuse** : le `Peer` survit bien (vérifié, peerId identique
     avant/après une navigation vue-router), et c'est précisément **ce qui produit la fenêtre 3**.
  2. **Le client non-hub en topologie star** ne demande que le peerId du hub : il n'échange donc
     jamais de signalisation avec un diffuseur qui n'est pas le hub, et n'apprend rien de lui. Même
     borne que l'annonce data channel en star, pour une raison différente — ici il n'y a pas de
     relais qui perd l'identité, il n'y a pas d'échange du tout.

- [ ] 🔴 **Fenêtre 3 — un peerId déjà connu sous bail ne redemande rien, donc n'apprend rien** `[M]`
  — **trouvée par la mesure du 28/08/2026, et c'est le résultat principal de cette mesure.** Celle-là
  est fatale : ce n'est pas une vignette tardive, c'est une vignette **absente**.

  Le mécanisme, confirmé aux deux bouts (mesure *et* code) :
  `useConnectionPool.requestOrConnectPeer` (`:263-279`) lit `getDialableRemotePeerId(userSlug)` ;
  **si le bail est encore valide, il appelle `connectToPeer` directement et aucun POST ne part.** Or
  `isBroadcasting` ne voyage que sur ces deux POST. Un arrivant qui possède déjà le peerId du
  diffuseur n'a donc **aucun** porteur pour le fait — et en contexte `stream` un non-diffuseur
  n'ouvre pas de canal data, donc le chemin `BROADCAST_STATE` est fermé aussi. Il ne reste que le
  `peer.call` du diffuseur, c'est-à-dire exactement l'état d'avant le correctif.

  Reproduction (le cas est **majoritaire à l'usage**, pas un cas limite : c'est la navigation SPA
  ordinaire à l'intérieur du bail de ≈55 s) : B est sur `/app`, quitte par un `RouterLink`, A démarre
  sa webcam, B revient par `history.back()` — donc sans rechargement, `Peer` préservé.
  **Deux runs, zéro POST de peerId après le retour dans les deux cas**, et deux issues différentes :
  `t_vignette = 8 811 ms` (un signal finit par arriver du côté de A) et **`t_vignette = null`** (rien
  en 25 s). Le non-déterminisme est cohérent avec « il ne reste que le retry de l'autre côté ».

  ⚠️ **Ne pas « corriger » en forçant un POST à chaque tour** : ce serait rouvrir l'item « le client
  star compose son hub même absent de la room », qui consomme un slot du plafond de cadence à chaque
  tour de présence. Le porteur juste n'est probablement pas la route de peerId — c'est ici que
  l'option `whisper` écartée ci-dessous reprend de la valeur, puisqu'elle est **indépendante** de la
  signalisation P2P et fermerait les trois fenêtres. À rouvrir avec cet argument neuf.

  **L'option étudiée, et pourquoi elle n'a pas été prise** : un `whisper` sur le canal de présence
  fermerait les deux d'un coup (un seul saut WebSocket, avant toute signalisation, et le serveur
  réémet les client events de présence avec le `user_id` **authentifié** — `accept_client_events_from`
  vaut `members` par défaut dans Reverb). Son coût n'est pas la latence, c'est le **couplage** :
  WebRTC2 ne connaît aujourd'hui la présence que par la prop `users` d'un provider, et il faudrait y
  faire entrer le canal Reverb — `inject(REVERB_CHANNEL, null)`, comme `useChatSimple`, donc optionnel
  — plus un filtre sur `roomId` puisqu'une page monte plusieurs providers sur **un** canal
  (`Exemples/Home.vue` en monte trois). Le champ sur la signalisation coûtait deux lignes de PHP,
  celui-ci est un chantier.

  ✅ **L'arbitrage a changé le 28/08/2026, et c'est l'argument à retenir.** Il avait été écarté sur
  « à ne rouvrir que si la fenêtre 1 se révèle visible à l'usage » — or la fenêtre 1 s'est révélée
  **courte** (592 ms mesurés), et c'est la fenêtre 3 qui est fatale. Le couplage reste le même coût,
  mais il achète désormais autre chose : un porteur **indépendant de la signalisation P2P**, donc le
  seul qui ferme un cas où *aucun* échange de peerId n'a lieu. Adosser l'annonce aux routes de peerId
  est structurellement limité — elle ne peut rien dire quand il n'y a rien à demander.

- [ ] 🔴 **La vignette n'est JAMAIS visible : `.draggable-video` sans `<video>` s'effondre à 0 px**
  `[S]` — défaut de **rendu**, étage CSS, indépendant des trois fenêtres ci-dessus. Le nœud est bien
  dans le DOM, à l'heure : il n'apparaît simplement pas à l'écran, sur la seule page qui le rend.

  Géométrie mesurée (28/08/2026, viewport 1440×1000, `StreamSimpleUI` en contexte `stream`) :

  | Élément | hauteur | y |
  |---|---|---|
  | `.draggable-video` | **0 px** | 757 |
  | `.video-loading` (`position:absolute; inset:0`) | **0 px** | 757 |
  | `.video-loading-label` | 26 px | **792** |
  | `.col.overflow-hidden` (parent) | 34 px | 722 → **756** |

  `_socializer.scss:240-256` a été écrit pour **recouvrir le cadre noir d'un `<video>`** — son
  commentaire le dit. Dans `StreamSimpleUI.vue:42-47` le `.draggable-video` n'a pas de `<video>` :
  sans enfant en flux, sa hauteur de contenu est 0, `inset:0` donne donc une surface nulle à
  l'overlay, le label déborde à y=792 et le `.col.overflow-hidden` de `:31` — posé exprès pour le
  problème de `min-width` des `<video>` — **le clippe**.

  ⚠️ **Piège de vérification à retenir** : `isVisible()` de Playwright rend **`true`** (boîte non
  vide, `visibility:visible`, `opacity:1`) — il ne teste pas le clipping par un ancêtre. Un test qui
  s'y fierait serait vert sur une vignette invisible. Ce qui tranche, c'est la géométrie comparée à
  celle de l'ancêtre, ou une capture d'écran relue.

  Ce n'est **pas** un correctif d'une ligne : donner une hauteur au `.draggable-video` sans `<video>`
  touche un SCSS partagé avec les players réels, et **le SCSS du paquet est copié dans l'hôte, c'est
  la copie qui est compilée** (deux fichiers à modifier). À traiter avec [sass-todo.md](sass-todo.md),
  qui porte déjà l'arbitrage `_variables.scss` propre au paquet.

- [x] **Vérifier à la main que la vignette arrive tôt** `[S]` — **fait le 28/08/2026**, et le résultat
  n'est pas celui attendu : le correctif `10d634f` fonctionne, l'UI ne le montre pas, et le cas
  majoritaire n'est pas couvert. Les deux découvertes ont leurs items ci-dessus (fenêtre 3, rendu).

  Ce que la mesure a établi, chiffres relevés sur l'onglet de l'arrivant :

  | Ce qui est mesuré | Valeur |
  |---|---|
  | frame Reverb portant `isBroadcasting:true` (`.ResponseToPeerID`) | **592 ms** |
  | `announcedStreamsMap` peuplée **et** nœud DOM rendu | **607 ms** |
  | coût du front une fois le fait reçu | **15 ms** |
  | contre-épreuve : personne ne diffuse, sondage 250 ms sur 5 s | **0 vignette** |
  | navigation SPA, bail de peerId chaud | **8 811 ms**, puis **jamais** (2ᵉ run) |

  **Verdict sur `10d634f` : positif.** Le champ est sur le fil (frame brute capturée,
  `private-App.Models.User.35`), il arrive en 592 ms, et le front le rend en 15 ms. La contre-épreuve
  du 13/08 tient — et elle tient **sous contrôle positif**, ce qui est le point de méthode à garder :
  sans vérifier d'abord que B voit `["admin"]` dans `usersInRoom` et que la présence est abonnée,
  « aucune vignette » aurait été vert par panne de présence, pas par correction.

  Trois pièges de harnais mesurés, à ne pas re-payer :
  - **`waitForSelector` sur un sélecteur filtré par texte (`:has-text`) a coûté 442 ms de latence
    propre** là où un sondage `evaluate` à 50 ms donne 15 ms. Le premier chiffre a failli être
    consigné comme un coût de l'application. Chronométrer par sondage, jamais par `waitForSelector`.
  - **`a[href="/app"]` (« Vue ready ») est une ancre simple, pas un `RouterLink`** : cliquer dessus
    provoque un vrai chargement de document et fait retomber la mesure sur le cas « premier
    chargement ». Pour une navigation SPA de retour, `history.back()` (popstate → vue-router).
  - **Le bac à sable sert par le dev server Vite** (`public/hot` présent), donc le working tree, et
    **pas** `public/build` — qui a 28 h de retard sur `10d634f` et ne contient pas
    `noteBroadcastFromSignal`. Aucun build n'est requis, mais si `public/hot` disparaît la mesure
    tourne en silence sur le code d'avant le correctif. `.env` non touché de bout en bout
    (horodatage relevé avant/après), suite JS verte après coup (52 fichiers, 940 tests).

---

## usePeerConnections

- [ ] **`usersInRoom` : sémantique trompeuse (filtrage prématuré)** `[M]`
  `connection.usersInRoom` stocke uniquement les *peers distants* (moi filtré à la source dans
  `_doGetRoomUsersDiff`) — le nom suggère « tous les users de la room » alors qu'il signifie « peers
  auxquels je dois me connecter ». `allUsersInRoom` n'existe que pour compenser ce filtrage
  prématuré (aller-retour : liste complète Reverb → retire moi → rajoute moi).
  → renommer en `connection.remotePeers`, exposer `usersInRoom = [...remotePeers, mySlug]` (liste
  neutre complète) et appliquer le filtre `!== mySlug` explicitement dans la logique de connexion.
  Supprime `allUsersInRoom` comme computed compensatoire.
  ⚠️ `usersInRoom` sert d'allowlist dans `_isAuthorizedIncomingPeer` et dans le prédicat prévu en
  A2 de l'audit sécurité — le renommage touche un chemin de sécurité.
- [ ] **Migrer `usersInRoom` vers Pinia** `[M]`
  `ctx.connection.usersInRoom` est un tableau mutable partagé hors store. Le déplacer dans
  `peerStore` avec une action `computeRoomDiff(newSlugs)` synchrone (lecture + écriture atomique)
  supprimerait le mutex `_diffLock` et rendrait la liste réactive dans les composants.
  Dépend du renommage ci-dessus.
  ℹ️ **`_diffLock` n'attend plus cette migration pour être sans emploi** (constaté le 27/08/2026) :
  depuis que le verrou du pool coalesce, son drain sérialise déjà les tours, et c'est le **seul
  appelant de production** de `getRoomUsersDiff`. Le mutex ne garde donc plus qu'un export public
  que personne n'exerce en parallèle — coût nul, à retirer avec la migration, pas avant ni
  séparément.
- [ ] **`getNewUsersInRoom` est un export mort** `[S]`
  Zéro appelant de production dans le paquet **et** dans l'hôte (vérifié au grep le 27/08/2026) :
  seul `usePeerConnections.test.js:123` le maintient en vie, et ce test n'épingle donc rien
  d'observable. Sortie B (supprimer) ou C (assumer comme surface publique documentée) — pas les
  deux. Le retirer emporte son test.
  ℹ️ Une **projection** existe déjà : `peerStore.roomMembers[contextId]`, écrite par
  `_doGetRoomUsersDiff` et lue par le prédicat de `removeRemotePeerId` (cf.
  [architecture.md](../docs/modules/webrtc2/architecture.md#un-onglet-plusieurs-contextes--la-granularité-des-clés-du-store)).
  Ce n'est PAS la migration : la source de vérité reste `ctx.connection`, et la duplication est
  assumée tant que les deux écritures restent dans la même fonction. La migration consisterait à
  faire de `roomMembers` la source et à supprimer le miroir — pas à ajouter un troisième état.

---

## Observabilité

- [ ] **Logger centralisé** : remplacer les `console.log/warn/error` dispersés par un logger
  configuré par composable
- [ ] **État debug exposé** : computed readonly pour inspecter l'état interne (retries, connexions,
  flux) — `Widgets/UI/Report/Debug.vue` en consomme déjà une partie à la main
- [ ] **Events structurés** : `peer:connected`, `peer:disconnected`, `call:started`, `call:failed`.
  À croiser avec `EventBus/webrtc2Events.js`, écrit mais **pas encore consommé** (les appelants
  émettent toujours en direct).

---

## Robustesse

- [ ] **Graceful degradation eventBus** : si l'eventBus est indisponible, logger au lieu de crasher.
  Partiellement en place (`createPeerContext` pose un no-op et warn) — reste à vérifier les
  widgets qui l'injectent directement.
- [ ] **Cleanup `AbortController`** : annuler les opérations longues à la destruction du contexte.

---

## Surveillance conditionnelle

- [ ] **Drainer réellement la file de signaux** `[M]` — **à n'ouvrir que si le warn
  `N signal(s) non routé(s) (seq x→y)` apparaît réellement en production.**

  Aujourd'hui seul `at(-1)` est consommé. **Vérifié sur le code, aucun chemin actuel ne produit la
  condition** (à ne pas revérifier) : producteur unique sans boucle, et un event Reverb = une frame
  WebSocket = une tâche de boucle d'événement, entre lesquelles les microtâches — donc le flush du
  `watch` — sont drainées. La machinerie nécessaire ne s'exercerait jamais en prod.

  Trois pièges à connaître avant de s'y remettre :

  1. **ne pas** ré-exposer la file via `computed(() => peerStore.getQueueForRoom(contextId))` — ce
     computed ne trace que la *clé*, qu'un `push` ne touche pas, donc il n'est jamais invalidé.
     C'est pourquoi `roomSignals` n'avait jamais pu être consommé et a été supprimé. Watcher un
     **scalaire** dérivé de la file (ex. `at(-1)?.seq`) ;
  2. `createMockContext._pushSignal` écrit dans `_signalQueue` (réactif) alors que
     `getQueueForRoom` lit `_signalQueueRooms` (objet nu) — **tout test de drain serait un faux
     positif** avant correction du mock ;
  3. `dispatchSignal` plafonne la file à **10** par room : avec une consommation réellement
     sérialisée, une room mesh à 8 pairs génère jusqu'à 14 signaux et le plafond évincerait des
     signaux non drainés → à porter dans `webrtc2.config.js` et redimensionner en même temps. Le
     plafond rend aussi tout curseur basé sur `length` faux, d'où le `seq`.

  `clearSignalQueueRoom` appelé en pleine session est un **rewind réel**, pas théorique.

---

## Patterns proposés, non implémentés

### Injection protective

```javascript
const safeInject = (key, fallback = null) => {
    try {
        return inject(key) ?? fallback
    } catch {
        console.error(`[WebRTC2] inject('${key}') failed`)
        return fallback
    }
}
```

### Lifecycle cleanup manager

```javascript
const lifecycle = {
    watchers: [], timers: [],
    onWatch(stop) { this.watchers.push(stop) },
    onTimer(id) { this.timers.push(id) },
    cleanup() {
        this.watchers.forEach(w => w()); this.timers.forEach(t => clearTimeout(t))
        this.watchers = []; this.timers = []
    }
}
// const stop = watch(...); lifecycle.onWatch(stop)
// onUnmounted(() => lifecycle.cleanup())
```

Formaliserait la discipline déjà exigée par
[docs/modules/webrtc2/architecture.md § Cleanup obligatoire](../docs/modules/webrtc2/architecture.md#cleanup-obligatoire).
