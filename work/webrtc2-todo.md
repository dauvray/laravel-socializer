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
  ℹ️ La FSM n'y a pas touché (surface inchangée, décidé avant la passe), mais elle en a **réduit
  l'enjeu** : « peer utilisable » a désormais un nom lisible de partout (`peerIdentity().state`),
  et les appelants qui en ont besoin le lisent sans avoir à s'accrocher à la promesse d'init.
  Le préalable de harnais, lui, est **fait** : `__tests__/helpers/bootLocalPeer.js`.
- [x] **La machine à états du cycle de vie du Peer** `[L]` — **close le 29/08/2026.** Un seul fait
  déclaré (`peerPhase`, écrit par cinq transitions) remplace `localPeerReady` et l'usage de
  `peerInitPromise` COMME état ; `peerIdentity()` est le seul chemin de lecture de la production,
  et `getLocalPeerId` / `getLastLocalPeerId` / `getLocalPeerReady` sont supprimés — avec trois
  setters du store qui n'avaient aucun appelant. La substance est dans
  [flux.md](../docs/modules/webrtc2/flux.md#lire-létat-du-peer-local). Ce que la passe a **appris
  ou réfuté**, et qui ne se déduit pas du diff :
  - **La panne silencieuse était fermable seule**, et l'a été en premier (lot 1) :
    `waitForMeReady` lisait `lastLocalPeerId`, un fait HISTORIQUE, et répondait « prêt » sur un
    peer détruit ou déconnecté sans recours. Trois cas rouges d'abord, dans
    `createPeerContext.test.js`. La sémantique retenue n'est pas « répondre `false` » mais
    **attendre** : abandonner ferait sortir les quatre consommateurs par leur `if (!ready) return`
    pendant un backoff qui allait aboutir. Le timeout de 15 s reste le filet.
  - **La phase est appliquée même quand la transition est inattendue** — l'inverse de
    `useCallStateMachine`, qui refuse. Une phase qui refuserait de suivre PeerJS décrirait un peer
    qui n'existe plus : c'est la divergence même qu'elle supprime. L'arbitrage est dans l'en-tête
    de `stores/peers2/phases.js`, épinglé par `peers2Store.peerRuntime.test.js`.
  - **L'observation garde le dernier mot sur la déclaration** : `peerIdentity()` ne croit pas une
    phase `ready` sur un peer `destroyed`. Sans cette règle, la phase aurait été un septième
    prédicat, capable de mentir comme les six autres.
  - **68 cas de test annoncés, 10 assertions réellement à réécrire** — plus un décor. L'énoncé
    comptait les fichiers qui n'émettent pas `'open'` ; ce qui coûte n'est pas là, mais dans les
    fichiers qui asserted sur `localPeerReady` (`singleton`, `reconnect`, `iceRefresh`) et dans
    `usePeerCore.test.js`, dont TOUT le décor reposait sur un `getLocalPeerId` que le double
    servait par défaut et que le vrai store n'a jamais eu.
  - **Un mensonge du double, trouvé en chemin** : `localPeer` et `getLocalPeer` y étaient deux
    champs INDÉPENDANTS, alors que le store réel ne peut pas les faire diverger. Invisible tant
    que rien ne lisait les deux — les tests semaient l'un, la production a commencé à lire
    l'autre. Ce sont désormais deux accesseurs sur un seul objet, avec le garde structurel de
    `connection.remotePeers`.
  - **La surface de `setLocalPeer` n'a pas bougé**, comme prévu : `useCallManager.js` et
    `useCallManager.test.js` sont intacts. L'item voisin `peerInitPromise` reste ouvert et
    séparé.
- [ ] **L'id historique survit à un échec d'init — contradiction désormais SUPPRIMABLE** `[S]`
  Trouvé en fermant la FSM, et laissé hors de sa passe à dessein. Le `.catch` de `_doInit` nulle
  `localPeer` et laisse `lastLocalPeerId` posé — l'audit le signale (`id-historique-sans-peer`).
  La raison de le préserver était `waitForMeReady`, **qui ne le lit plus**. Les deux seuls
  lecteurs de production restants (`peer._id` restauré à l'`'open'` d'une reconnexion,
  `peer._lastServerId` avant `reconnect()`) exigent tous deux une instance vivante, donc aucun
  n'est sur ce chemin. Le nettoyer supprime la contradiction ; la garder demande un motif que
  personne n'a plus. ⚠️ Le code de violation, lui, RESTE : l'état est encore atteignable, et
  c'est ce qui interdit à un futur lecteur de se raccrocher à l'id historique.
- [ ] **Fidélité du mock : `disconnect()` ne met pas `_id` à `null`** `[S]`
  Le vrai `Peer.disconnect()` fait `this._id = null` (`bundler.mjs:1809`) ; le mock conserve
  l'id — écart assumé et documenté (le registre du bus est keyé sur `id`, et trois scénarios
  appellent `destroy()` directement). Conséquence : la divergence identité courante /
  identité historique, qui est le cœur de la panne silencieuse, n'est pas reproductible en
  test. Fermer cet écart demande de rekeyer le bus sur une clé stable.
  ℹ️ **Moins urgent depuis la FSM, et l'argument compte** : les gardes migrés décident sur la
  PHASE, qui est parfaitement observable en test — c'est ce qui a permis d'épingler la panne
  silencieuse sans jamais reproduire la nullification de `_id`.
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
> **Quatre verrous sont fermés** : `syncUsersConnections` coalesce au lieu de jeter la composition
> reçue (27/08), le tour sur liste vide purge sans déclarer la présence connue (27/08), le fan-out
> réconcilie au lieu de differ (28/08), et **la perte d'une connexion est devenue un second
> déclencheur de composition** (28/08) — celui qui ferme le cas où aucun tour de présence n'a lieu.
> Les quatre invariants vivent dans
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
     est celle où le diff n'a **rien** écrit, donc où `remotePeers` est vide et où personne n'est
     perdu. `lastLocalPeerId` ne tombe que quand le dernier consommateur se démonte.

  Les deux mécanismes qui produisaient réellement le dommage — **(a)** coupure de présence au
  reconnect Echo, `here()` rejoué avec la liste complète ; **(b)** rechargement chevauchant, zéro
  événement de présence — et la correction (« le fan-out réconcilie, il ne diffe pas ») sont dans
  [architecture.md](../docs/modules/webrtc2/architecture.md#conventions-de-code). ⚠️ Le cas **(b)**
  n'est réparé qu'au **prochain** tour de présence, quel qu'en soit le motif : aucun tour n'a lieu au
  moment du rechargement, donc aucune correction fondée sur la présence ne peut faire mieux. Le
  déclencheur structurellement juste serait la **fermeture de connexion** — item ci-dessous,
  **fermé le 28/08/2026**, ce qui clôt (b) du même geste.
- [x] **Re-composer sur fermeture de connexion, pas seulement sur tour de présence** `[M]` —
  **fermé le 28/08/2026.** `handleClose` publie `ctx.connectionLostSignal`, `useConnectionPool`
  l'observe : troisième « signal réactif de communication inverse », sur le motif exact de
  `peerUnavailableSignal`. Les cinq gardes et les deux décisions écartées vivent dans
  [architecture.md § Conventions de code](../docs/modules/webrtc2/architecture.md#conventions-de-code) ;
  la séparation perte / départ dans
  [§ Départ d'un pair](../docs/modules/webrtc2/architecture.md#départ-dun-pair--un-fait-métier-deux-transports).

  **Ce que la passe a RÉFUTÉ dans l'énoncé ci-dessus, et qui a rendu la tâche plus simple que
  prévu** — à ne pas re-dériver :

  1. **« le point d'entrée unique d'une disparition de pair est `handleRemoteDeparture` » est faux
     pour ce déclencheur.** Le wrap de `usePeerOrchestrator` (`:196-214`) n'existe que pour
     `type === 'stream'` et n'y route que les fermetures **entrantes** (`senderSlug !== mySlug`).
     Or ce qui tombe chez un diffuseur quand son pair recharge est sa connexion **sortante** —
     explicitement exclue ; et `data`/`visio` n'ont aucun chemin fermeture → départ. Le seul point
     d'entrée universel est `createPeerContext.handleClose`, un étage plus bas. Il n'y avait donc
     **aucune frontière de couche à traverser**, et le `try/catch` avaleur de `handleRemoteDeparture`
     n'était pas en jeu : une perte n'est pas un départ.
  2. **`hasPendingRetry` n'est pas qu'un anti-boucle, c'est le garde qui empêche de parler trop
     tôt** — et il a été retiré puis remis. Un rechargement dure une seconde pendant laquelle
     personne ne répond : composer alors pose un `waiting` de `SIGNALING_STALE_MS` qui **muselle la
     demande suivante**, y compris celle du tour de présence quand le pair est enfin là. Mesuré : sans
     lui, le scénario voisin « A recharge sans que B voie son départ » passe au rouge. Ce déclencheur
     ne vise donc **que le régime établi**, seul état où plus aucun moteur ne veille.
  3. **Le premier scénario écrit était vert pour la mauvaise raison** : il provoquait la perte juste
     après l'établissement, donc alors qu'une chaîne veillait encore (elle ne s'éteint qu'à son
     réveil, ≤ 1299 ms). Il a fallu une **attente réelle** de 1,5 s — `settle()` ne draine pas les
     minuteurs et `useFakeTimers` gèlerait le faux serveur. Le piège complet est dans
     [tests.md](../docs/modules/webrtc2/tests.md).
  4. **Écarté, et à ne pas rouvrir** : invalider le mapping peerId directement sur la fermeture pour
     économiser l'aller-retour mort. Une fermeture ne prouve pas que le peerId est mort, et
     `getRemotePeerId` est la source **anti-usurpation** du chemin (b) de `_isAuthorizedIncomingPeer`.
     La chaîne existante (`peer-unavailable` → `invalidateRemotePeerId` → watcher voisin) fait le
     travail sans toucher à un chemin de sécurité.
  5. **Un garde retiré parce qu'aucune contre-épreuve ne pouvait le faire rougir** : `isValidSlug`,
     déjà porté par `isAuthorizedPeer` en première ligne. Les quatre autres ont chacun été vus rouges,
     un par un.
- [x] **`roomMembers` n'a pas de contrat de fraîcheur** `[M]` — **fermé le 29/08/2026, et pas par le
  mécanisme que cet item cherchait.** Ce n'était pas un contrat de fraîcheur, c'était un contrat de
  **propriété** : *une entrée n'existe que tant que son auteur est vivant et détenteur de son
  `contextId`*. Deux règles, sur deux mécanismes qui existaient déjà — un contexte en arrêt n'écrit
  pas (`ctx.isShuttingDown` après la barrière `waitForMeReady`), seul le détenteur enregistré efface
  (`clearRoomMembers(contextId, owner)`, jumeau du garde de `unregisterContext`). Sous ces règles,
  toute entrée présente est le témoignage courant d'un contexte vivant : `isUserInAnyRoom` et
  `getRoomMembers` **n'ont pas été touchés**. La règle, les trois pistes écartées et la fenêtre
  assumée vivent dans [securite.md](../docs/modules/webrtc2/securite.md).

  **Quatre réfutations de l'énoncé, à ne pas re-dériver :**

  1. **Une mise en sourdine passe d'abord par un vidage.** `useReverbChannel.leave()` fait
     `users.value = []` **avant** de révoquer son jeton → tour de présence vide → composition
     purgée. L'entrée d'un contexte muet est **vide**, pas périmée. Le « contexte monté devenu
     muet » que l'item cherchait n'épingle donc rien.
  2. **L'exemple qui portait l'énoncé est faux.** `roomMembers['data-app']` n'existe **jamais** :
     `Notifications.vue` appelle `useMediaBroadcast()` sans jamais appeler `watchUsers`, dont le
     seul appelant de production est `MediaBroadcastProvider`. Ce contexte n'a jamais pu opposer de
     veto. Trois commentaires de test l'affirmaient comme « configuration réelle » — rustine héritée
     du prédicat `connections` ; corrigés du même geste.
  3. **Pendant une coupure pusher — le seul chemin qui périme sans vider — le veto est le
     comportement CORRECT** : rien n'y prouve un départ, tous les contextes de la même source
     périment ensemble, et `here()` répare au ré-abonnement avec la liste complète.
  4. **Un `removeRemotePeerId` plus agressif serait une RÉGRESSION.** Supprimer l'entrée prive
     `getSlugByRemotePeerId` de sa corroboration : l'admission bascule de « refusée sur
     contradiction » à « non corroborée ». `securite.md` interdit déjà toute péremption sur cette
     lecture (« un contournement planifiable »).

  **Le défaut réel, absent de l'énoncé — l'entrée fantôme.** La barrière `waitForMeReady` dure
  jusqu'à 15 s et son `effectScope` est détaché : `destroy()` ne l'annule pas, et `getRoomUsersDiff`
  ne lisait aucun garde de teardown. Un tour parti avant l'ouverture du peer local reprend après le
  démontage et **ressuscite** l'entrée que `destroy()` vient de retirer — que plus rien ne retirera,
  `clearRoomMembers` n'ayant qu'un appelant, déjà passé. C'était le seul épinglage réellement
  permanent du module, atteignable par une navigation SPA, et sans aucun rapport avec la présence.
  Son jumeau fail-**closed** : le démontage d'un homonyme emportait l'allowlist du vivant, qui
  refusait alors toute connexion entrante du chemin (a) en silence et sans rattrapage.

  **Deux écarts de harnais fermés en chemin** : le double ne portait pas le garde de propriété (il
  aurait été plus permissif que la production sur un chemin de sécurité), et son `getRemotePeerId`
  rendait `null` là où le store rend `undefined` — sept assertions épinglaient la valeur du double.

  **Puis la CAUSE RACINE, fermée dans la foulée** — parce que le premier correctif gardait un
  consommateur et pas le mécanisme. `waitForMeReady` a **quatre** consommateurs de production, et
  aucun n'est inerte sur un contexte mort : `handleStreamReceived` repeuple `remoteStreamsMap` que
  `destroy()` vient de vider et peut créer un player DOM, `handleStreamRemoved` appelle
  `handleRemoteDeparture` (qui avale ses exceptions). `destroy()` résout désormais les attentes en
  vol à `false` — les quatre sortent par le `if (!ready) return` qu'ils écrivent déjà, et qui est
  déjà testé chez chacun. Le garde de `getRoomUsersDiff` reste, comme second mécanisme.

  ⚠️ **Une asymétrie assumée, à ne pas prendre pour un oubli** : `clearSignalQueueRoom` n'a PAS
  reçu le garde de propriété. Ce n'est pas un verbe de témoignage — il a deux autres appelants de
  production en pleine session — et la collision d'homonymes y coûte au plus un signal tamponné :
  `dispatchSignal` recrée la file si elle manque, et `signalSeq` n'est pas supprimé, donc pas de
  rewind. Idem pour `clearWaitingRemotePeerIdsForContext`, dont la collision coûte un aller-retour
  de signalisation. Mesuré, puis écarté comme disproportionné.
- [x] **Le client star compose son hub même absent de la room** `[S]` — **fermé le 28/08/2026**, sous
  tests verts, comme la simplification annoncée. La branche client est devenue la branche mesh
  filtrée : `targets.includes(hubSlug)`, avec le même `preserveRetry`. Le couplage annoncé s'est
  **vérifié** — rien n'aurait pu être resserré avant que le fan-out réconcilie. La règle, sa borne
  (chemin (a) de l'autorisation seulement) et le récit du couplage vivent dans
  [architecture.md § Conventions de code](../docs/modules/webrtc2/architecture.md#conventions-de-code).

  **Deux écarts avec l'énoncé ci-dessus, à ne pas re-dériver :**

  1. **`ctx.isHubConnected` n'a PAS été utilisé**, alors que l'item le nommait comme « existant déjà
     pour l'exprimer ». Il ne dit que la moitié du prédicat — l'appartenance, pas l'établissement —
     et la disait alors via un computed compensatoire qui rajoutait mon slug pour rien dans une
     branche où `hubSlug !== mySlug` par construction (ce computed a disparu depuis, avec le
     renommage plus bas). `targets`, déjà calculé quinze lignes plus haut, porte
     les deux moitiés sans ajouter de seconde source de vérité.
  2. **Un second défaut au même site d'appel, absent de l'énoncé** : la branche client était la
     dernière du fan-out à ne pas passer `preserveRetry`. Un tour de présence est l'appelant
     PÉRIODIQUE type, et `scheduleRetry(slug, 0, …)` commence par `clearRetry` : `attempt` repartait
     de zéro à chaque tour, donc l'horizon d'abandon de ≈55 s ne tombait jamais. Corrigé du même
     geste, épinglé à part.

  La réécriture prévue de « star : un client ne se connecte qu'au hub » était bien nécessaire, et le
  **contrôle négatif l'a confirmée load-bearing** : pré-semis de `remotePeers` retiré, le cas
  rougit — sans lui il aurait verdi par absence du hub dans `targets`, soit pour la raison inverse
  de ce qu'il épingle.
- [ ] **Un canal de présence mémoïsé peut rendre `users` définitivement vide** `[S]` — piège latent,
  **aucun consommateur vivant ne l'atteint aujourd'hui**, d'où l'effort `[S]` et pas de correction
  dans la passe où il a été trouvé (28/08/2026).
  `useReverbChannel.leave()` saute `Echo.leave()` quand un autre consommateur tient le même nom (le
  compteur de consommateurs, qui est là pour ça) — mais Echo mémoïse ses canaux, donc le canal pusher
  sous-jacent reste `subscribed: true`. Un consommateur qui se démonte puis se remonte sur ce nom
  re-branche son `here()` sur un canal qui ne ré-émettra **jamais** `subscription_succeeded` : son
  `users` reste à `[]` pour de bon, alors que `leave()` vient de le vider. `remotePeers` étant
  l'allowlist des deux gardes d'autorisation, le contexte n'admettrait plus personne.
  Non joignable aujourd'hui : `Exemples/Home.vue` est le seul consommateur de présence de son canal,
  et `Server.vue`, `Room.vue`, `ChatComponent.vue` utilisent des noms distincts. Le jour où deux
  composants partagent un nom de canal de **présence**, c'est joignable.

---

## Annonce de diffusion — les quatre chemins, et ce qui reste après eux

> ✅ **Les trois fenêtres sont fermées le 28/08/2026** par un QUATRIÈME chemin d'annonce : un
> whisper sur le canal de présence Reverb, seul porteur indépendant de la signalisation P2P. Les deux
> 🔴 de cette section sont tombés. Ce qui reste ici est le résidu d'AFFICHAGE et les bornes de
> déploiement — plus aucune fenêtre de porteur.
>
> ℹ️ S'y cumulait **une vignette jamais visible** — défaut de rendu à l'étage CSS, fermé le 28/08
> (item plus bas). C'est ce cumul qui a obligé la mesure à instrumenter le DOM et la géométrie plutôt
> que l'écran.

- [x] **Les trois fenêtres résiduelles** `[M]` — **fermées le 28/08/2026** par le whisper de présence
  (`useBroadcastPresence.announceBroadcastStateOnChannel` / `handleBroadcastStateWhisper`), quatrième
  chemin d'annonce. Les quatre chemins et leurs bornes :
  [flux.md](../docs/modules/webrtc2/flux.md#comment-un-arrivant-sait-qui-diffuse).

  **Ce que la fenêtre 3 avait appris, et qui reste vrai** : les trois premiers chemins partagent une
  limite structurelle — ils ne disent rien quand il n'y a rien à demander.
  `useConnectionPool.requestOrConnectPeer` (`:263-279`) lit `getDialableRemotePeerId(userSlug)` et,
  bail valide, appelle `connectToPeer` directement : **aucun POST, donc aucun porteur**. Mesuré,
  navigation SPA ordinaire dans le bail de ≈55 s : zéro POST après le retour sur deux runs,
  `t_vignette = 8 811 ms` puis **`null`**. Le whisper est le seul porteur indépendant de la
  signalisation P2P, et il ferme du même geste le client non-hub en star (fenêtre 2), qui ne demande
  jamais le peerId d'un diffuseur autre que le hub.

  Épinglé par `scenarios/lateJoiner.test.js` § « le peerId d'A est déjà connu sous bail », dont la
  contre-épreuve — mêmes coupures, sans canal fourni — **est** la mesure du 28/08 sous forme de test.

  **Vérifié à deux onglets le 28/08/2026**, même protocole que la mesure qui avait trouvé la
  fenêtre 3, sous contrôle positif (`Remote users : ["admin"]`, présence synchronisée) :

  | Ce qui est mesuré | Avant | Après |
  |---|---|---|
  | navigation SPA, bail chaud (`history.back()`) | **8 811 ms**, puis **jamais** | **71 ms** |
  | frame portant le fait | aucune | `client-webrtc2-broadcast-state`, **68 ms** |
  | attribution par Reverb | — | `"user_id":"2"` sur l'enveloppe |
  | coût du front une fois le fait reçu | 15 ms | **3 ms** |
  | contre-épreuve : personne ne diffuse, sondage 250 ms sur 5 s | 0 vignette | **0 vignette** (20 échantillons) |

  ⚠️ **Une passe « régime établi » ne suffit pas à prouver le porteur** — piège rencontré : à son
  retour, A **redemande** parfois le peerId de B (départ observé ⇒ bail purgé de son côté), et sa
  demande porte `isBroadcasting`. Premier run : 6 POST à +133 ms. La passe décisive coupe donc
  `/ask-to-peer-id` **chez A** juste avant le retour — plus aucun `PEER_CONNECTION_REQUEST` n'atteint
  B, et A ne peut plus ni l'appeler ni lui ouvrir de canal. Le whisper arrive alors à 68 ms, la
  vignette à 71 ms, et le premier POST résiduel à **131 ms** — soit 60 ms *après* la vignette.

  ⚠️ **Le correctif écarté reste écarté** : forcer un POST à chaque tour rouvrirait « le client star
  compose son hub même absent de la room » et son plafond de cadence. Rien n'a été ajouté à la
  signalisation.

  **Trois choses apprises en le posant**, toutes vérifiées et toutes contre-intuitives :
  1. **`accept_client_events_from` absent de `config/reverb.php` vaut `'all'`, pas `'members'`** —
     `ConfigApplicationProvider` lit `?? 'all'`, à l'inverse du défaut du template. Sous `'all'`,
     Reverb ne contrôle **aucune** appartenance au canal (`EventDispatcher` publie sur le canal nommé
     par l'émetteur) et retransmet l'enveloppe brute, `user_id` forgeable compris. C'était l'état de
     l'hôte : le porteur invoqué par l'arbitrage n'existait pas. Corrigé côté projet, et consigné
     dans [le `work/` de l'hôte](../../../../work/deploiement-tiers.md).
  2. **Une course réelle entre l'annonce et l'annuaire** : le diffuseur re-annonce dès qu'il voit
     l'arrivant, or un client event ne se rejoue pas — si l'arrivant ne peut pas encore traduire le
     `user_id`, le fait est perdu **définitivement**. D'où `_rebuildSlugDirectory` écrit **devant** la
     barrière `waitForMeReady`, seule écriture de ce tour à la précéder. Elle ne concède rien : la
     garde d'affichage est l'intersection de `useAwaitedStreams` avec `remotePeers`, qui reste
     derrière.
  3. **`stopListeningForWhisper(event)` emportait les handlers de TOUS les consommateurs du canal** —
     même défaut de classe que `Echo.leave()`, un étage plus bas, et joignable dès qu'une page monte
     deux providers sur un canal (`Exemples/Home.vue` en monte trois). `useReverbChannel` désabonne
     désormais par callback, repli nu conservé pour `useChatSimple`.

  **Ce qui reste, et n'est plus une fenêtre de porteur** : le fait arrive avant que la vignette
  puisse s'afficher, parce que `awaitedPeers` intersecte `remotePeers` — écrit derrière
  `waitForMeReady`, mesuré à 592 ms. Borne d'affichage, pas d'annonce. La fermer voudrait dire
  toucher à l'intersection, ce qui rouvrirait les vignettes fantômes de pairs déjà partis : **non
  souhaitable, décision assumée.**

- [x] 🔴 **La vignette n'est JAMAIS visible : `.draggable-video` sans `<video>` s'effondre à 0 px**
  `[S]` — **fermé le 28/08/2026.** Un enfant unique en `position:absolute` ne contribue pas à la
  hauteur du parent : le cadre valait 0 px, `.video-loading` (`inset:0`) avec lui, et le label
  débordait dans le `.col.overflow-hidden` qui le clippait.

  Correctif : une classe d'intention `.video-awaited` sur le seul site sans `<video>`
  (`StreamSimpleUI.vue:42`), et dans `_socializer.scss` le gabarit de la règle `video` voisine
  (`width:100%; aspect-ratio:16/9`) — donc la vignette occupe déjà la place du flux, sans saut de
  mise en page à l'arrivée. Les players réels ne portent pas la classe : par construction, aucun
  effet sur eux. **Aucun `_variables.scss` n'a été nécessaire** — le couplage que cet item annonçait
  avec [sass-todo.md](sass-todo.md) n'existait pas, `aspect-ratio` ne demande aucune valeur en dur.

  ⚠️ **Piège de vérification à retenir** : `isVisible()` de Playwright rend **`true`** (boîte non
  vide, `visibility:visible`, `opacity:1`) — il ne teste pas le clipping par un ancêtre. Un test qui
  s'y fierait serait vert sur une vignette invisible. Ce qui tranche, c'est la géométrie comparée à
  celle de l'ancêtre, ou une capture d'écran relue.

  Vérifié sur la **CSS réellement compilée** (chaîne `app.scss` entière, viewport 1440×1000) dans un
  harnais reproduisant la chaîne d'ancêtres, à deux runs — contrôle sans la classe, puis avec :
  0 px → 391 px, label clippé → label centré dans le parent, captures relues. Le contrôle n'est pas
  décoratif : le **premier** harnais donnait la même valeur aux deux runs parce que `setContent()`
  part de `about:blank` et n'y charge aucun `<link href="file://">`. Sans run de contrôle, « h=51 dans
  les deux cas » se lisait comme « le correctif ne sert à rien » sur une page **sans aucune CSS**.
  Ce que le harnais ne couvre pas — que `awaitedPeers` rende bien un nœud — est ce que la mesure à
  deux onglets du 28/08 avait déjà établi (nœud DOM à 607 ms).

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
  sans vérifier d'abord que B voit `["admin"]` dans `remotePeers` et que la présence est abonnée,
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

- [x] **`usersInRoom` : sémantique trompeuse (filtrage prématuré)** `[M]` — **fermé le 28/08/2026**,
  sous tests verts. `connection.remotePeers` remplace `usersInRoom` **partout**, y compris sur la
  surface publique (`api.remotePeers`) et dans les consts locales des trois fonctions de garde.
  Le nom vit dans [architecture.md](../docs/modules/webrtc2/architecture.md) et
  [securite.md](../docs/modules/webrtc2/securite.md) ; ce qui suit est ce que la passe a appris et
  qui ne se déduit ni du diff ni de l'énoncé.

  **Trois écarts avec l'énoncé ci-dessus, à ne pas re-dériver :**

  1. **La « liste neutre complète » n'a pas été exposée, et ne doit pas l'être.** L'énoncé prévoyait
     de garder `usersInRoom = [...remotePeers, mySlug]`. Mesuré : **aucun lecteur ne la voulait** —
     ni les trois `forEach` de l'orchestrateur, ni `useAwaitedStreams`, ni `StreamSimpleUI`. Elle
     n'aurait pas *supprimé* le computed compensatoire, elle lui aurait donné le nom qui signifiait
     jusque-là le contraire : même nom, sens inversé, zéro consommateur — le pire cas d'un
     renommage, parce qu'il ne lève aucune erreur.
  2. **`allUsersInRoom` n'avait qu'un seul lecteur réel, `isHubConnected`.** Il était bien destructuré
     par `useMediaBroadcast`, mais jamais ré-exporté ni utilisé. Le prédicat s'écrit maintenant en
     deux termes explicites — le hub est moi, ou le hub est dans `remotePeers` — ce qui a rendu le
     computed supprimable, pas seulement renommable.
  3. **Le filtre `!== mySlug` « à appliquer explicitement dans la logique de connexion » est devenu
     sans objet** : la liste ne me contient plus par construction, elle ne l'a d'ailleurs jamais fait.
     C'était le nom qui suggérait qu'un filtre manquait quelque part.

  **Le mode de panne de cette passe était silencieux**, et c'est le fait le plus réutilisable :
  `connection` est un `reactive` à spread d'overrides et les deux gardes lisent
  `Array.isArray(…) ? … : []`. Un site de test oublié n'aurait donc **pas** échoué — il aurait écrit
  une propriété orpheline, la garde aurait lu `[]`, et le verdict aurait basculé vers « refusé »,
  que la moitié des tests d'autorisation attend déjà. Parade employée : un accesseur jetant sur
  l'ancien nom, posé dans `createPeerContext` **et** `createMockContext` le temps de la migration,
  retiré avant le commit. À reprendre pour tout renommage d'un champ de `connection`.

  ⚠️ **La mention « le prédicat prévu en A2 de l'audit sécurité » était une référence pendante** :
  `securite.md` ne porte plus de section numérotée, et ce prédicat est **livré** depuis, sous la
  forme de `utils/isAuthorizedPeer.js`.
- [x] **Migrer `remotePeers` vers Pinia** `[M]` — **fermé le 29/08/2026**, sous tests verts
  (983 → 1015 cas). `roomMembers[contextId]` est la source unique ; `ctx.connection.remotePeers` est
  devenu un **accesseur en lecture seule** au-dessus d'elle, donc les ~25 lectures de production et
  les ~55 semis sur double n'ont pas bougé. L'écrivain de production est `peerStore.computeRoomDiff`,
  et `_diffLock` est parti. Le contrat, ses deux lecteurs de nature différente et l'invariant de
  réaffectation vivent dans
  [architecture.md](../docs/modules/webrtc2/architecture.md#propriétaires-uniques) ; le versant
  harnais dans [tests.md](../docs/modules/webrtc2/tests.md).

  **Quatre écarts avec l'énoncé ci-dessus, à ne pas re-dériver :**

  1. **« lecture + écriture atomique » était faux, et c'était la justification affichée.** Le couple
     lecture-puis-écriture n'a jamais eu de point de suspension entre ses deux moitiés — l'unique
     `await` de la fonction précède la lecture —, donc aucun TOCTOU n'y était possible et `_diffLock`
     n'a jamais rien gardé. Ce que la migration apporte est **un seul chemin d'écriture** vers
     l'allowlist, la valeur précédente étant lue là où la nouvelle est écrite. Rester synchrone est
     en revanche un vrai invariant, épinglé sans `await` : rendre l'action asynchrone fait rougir
     12 cas.
  2. **« rendrait la liste réactive dans les composants » : elle l'était déjà.** `connection` est un
     `reactive` et l'écriture était une réaffectation, donc `api.remotePeers` s'invalidait. Le gain
     réel est ailleurs : un domicile unique, et la composition lisible depuis le store sans `ctx`.
  3. **Les deux tests qui visaient le mutex n'étaient pas porteurs.** Celui qui affirmait « sans le
     mutex, les deux appels liraient le même `previousSlugs` vide » était vert par symétrie de
     microtâches et n'a pas rougi à son retrait ; ne pas le réécrire en test de FIFO, l'ordre étant
     garanti un étage au-dessus par le drain de `syncUsersConnections`. Les deux ont été remplacés
     par le seul énoncé qui survive et puisse rougir : un tour qui lève ne laisse pas la composition
     à moitié écrite.
  4. **La parade est devenue permanente au lieu d'être jetable.** La passe de renommage avait posé un
     accesseur jetant, retiré avant commit ; ici l'absence de setter en production **est** la parade
     (une écriture lève un `TypeError`), et `roomMembersSourceOfTruth.test.js` la fige avec ce qui
     ferme le seul risque du setter conservé dans le double : un grep sur les sources de production
     vérifiant qu'aucune n'assigne ni ne mute ce champ — la forme exacte de la panne de `Peer.id`,
     traitée à la source plutôt qu'en durcissant le double.

  ℹ️ **Deux constats de méthode, mesurés :** le seul mode de panne réellement silencieux était
  l'override `connection: { remotePeers }` du double, qui arrivait **après** l'accesseur par le
  spread et l'écrasait sans rien casser (clé extraite avant le spread, plus un garde structurel) ;
  et la réactivité de `_roomMembers` dans le double n'était exigée par **aucun** test existant — le
  proxy de `connection` déclenche même sur un index nu. Ce qu'un index nu casse est le chemin de
  production, que plus aucun test ne voyait depuis que la production a cessé d'écrire là. Le cas qui
  le prouve a été écrit et **vu rouge** avant d'être vert.
- [x] **`getNewUsersInRoom` est un export mort** `[S]` — **fermé le 28/08/2026, sortie B** : la
  fonction (un simple `await getRoomUsersDiff(users)` dont on ne garde que `newUsers`), son export
  et son unique test sont supprimés. Aucun appelant de production ne le lisait, dans le paquet
  comme dans l'hôte, donc rien d'observable n'a changé — un test de moins, et c'était le bon.
  ℹ️ **Ce qui cadrait la migration Pinia, et qui est fait depuis (29/08/2026)** : la duplication
  entre `ctx.connection.remotePeers` et sa projection `peerStore.roomMembers[contextId]` était
  assumée « tant que les deux écritures restent dans la même fonction ». `roomMembers` est
  maintenant la source et le miroir a disparu — sans troisième état.

---

## Sécurité — fermer le chemin (a), et ça se joue au backend

- [ ] **L'identité déclarée du chemin (a) n'est corroborée par rien** `[L]` — la faille résiduelle
  de [securite.md](../docs/modules/webrtc2/securite.md), ouverte et assumée depuis août, remontée
  ici le 29/08/2026 parce que c'est elle qui **domine** le préjudice de tout ce qui touche à la
  longévité des mappings peerId (c'est l'argument qui a permis d'assumer la fenêtre
  `subscription_error` en fermant le contrat de propriété de `roomMembers`).

  Un membre de la room qui ouvre un **second** `new Peer()` obtient un UUID non mappé, donc
  `resolvedSlug = null`, donc aucune contradiction à opposer : il est admis sur la seule foi d'un
  `metadata.from` déclaratif nommant n'importe quel autre membre, et parle ensuite sous son
  identité (chat, `BROADCAST_STATE`, `AUDIO_MUTE_TOGGLE` lisent tous `resolveRemoteSlug`).

  **Non fermable côté client — le cas nominal de la présence et l'usurpation ont la même signature
  locale.** Deux voies, toutes deux backend, à trancher dans leur propre chantier :

  1. **Annuaire d'attestation.** `UserController::responseToPeerId` voit déjà le couple
     `Auth::user()` + `peerId` et le **relaie sans le retenir**. Qu'il le conserve (TTL calé sur
     l'`alive_timeout` de 60 s) et expose la route inverse « à qui appartient ce peerId ? » :
     l'admission du chemin (a) sur peerId inconnu interroge alors l'autorité au lieu de croire
     `metadata.from`. Coût : un aller-retour à la première connexion de chaque pair, mis en cache
     par `remotePeersId` ; et la règle « peerId non résolu ne vaut pas refus » devient « ne vaut pas
     refus **avant** la réponse de l'autorité » — à re-négocier avec « Une liste vide n'est pas une
     réponse », dont c'est exactement le sujet.
  2. **Identité intrinsèque au peerId.** Ne plus laisser le client tirer son UUID : le backend
     l'émet et le signe, validé à l'inscription sur le serveur PeerJS. `conn.peer` **porte** alors
     l'identité, `metadata.from` devient décoratif, et la classe entière disparaît — plus d'annuaire,
     plus d'aller-retour, plus d'« admission non corroborée ». C'est la durable, et la plus chère
     (elle touche l'infra PeerJS, hors paquet).

  ⚠️ Ne pas confondre avec l'usurpation intra-room déjà assumée : c'est la **même** faille, et cet
  item est la seule chose qui puisse la fermer. Tant qu'il est ouvert, tout durcissement côté client
  sur la longévité des mappings est décoratif — l'argument est écrit dans `securite.md`.

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
