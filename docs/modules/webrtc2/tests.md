# WebRTC2 — Tests

> **À quoi ça sert :** les trois étages de tests du module, les invariants du harnais de
> scénarios, et les pièges de mock qui rendent un test vert pour la mauvaise raison.
> **Quand le lire :** avant d'écrire un test WebRTC2, et quand un test passe alors qu'il ne
> devrait pas.

Infrastructure générale (runner, alias, commandes, hook de push) :
[architecture/tests.md](../../architecture/tests.md).

---

## Trois étages, trois rôles

| Étage | Où | Rôle |
|---|---|---|
| **Unitaire** | `__tests__/*.test.js`, `__tests__/utils/` | une couche, dépendances injectées mockées |
| **Conformité** | `__tests__/mockFidelity.test.js` | le mock n'est ni en retard ni en avance sur le store réel |
| **Bout en bout** | `__tests__/scenarios/` | deux pairs **réels** qui se parlent |

Les scénarios sont l'étage qui manquait, et sans lequel aucun des incendies du module n'était
détectable : ils ne sont vrais ou faux que **vus du pair d'en face**.

`scenarios/` couvre aujourd'hui `harness.smoke` (le harnais lui-même — sans lui, un scénario rouge
serait indistinguable d'un harnais cassé), `lateJoiner` (le symptôme), `broadcastLifecycle` (arrêter
un flux n'en emporte pas un autre), `peerDeparture` (coupure brutale, peerId oublié, retour avec
un nouveau peerId, et le bail qui évite l'appel mort), `multiContext` (plusieurs contextes dans le même onglet — la forme réelle
d'une page, cf. [ci-dessous](#un-onglet-plusieurs-contextes), et l'ordre de montage réel :
`data-app` d'abord, diffusion ensuite), `outgoingAuth` (un tiers ne peut pas se faire pousser un
flux) et `incomingMappingInvariant` (à quel instant le mapping slug→peerId est posé, relativement à
l'admission entrante).

---

## Le protocole

Les règles générales — repro rouge avant le fix, asserter le fait métier, un mock qui ment est pire
qu'un test manquant, le contrôle de harnais — sont dans
[architecture/tests.md](../../architecture/tests.md#les-règles). Ce module en porte trois deltas :

1. **Un bug vécu s'écrit d'abord dans `scenarios/`**, pas dans un test unitaire : c'est l'étage où le
   symptôme est observable.
2. **Le fait métier s'écrit avec les verbes du harnais** — `bob.receivedScreensFrom()`, jamais
   « telle fonction a été appelée ». C'est ce qui rend ces tests insensibles aux refactos internes.
3. **Rien ne se pousse en rouge** — `hooks/pre-push` lance les deux suites. Son activation est une
   config locale, jamais versionnée : c'est le seul filet automatique du dépôt.

⚠️ **Ne jamais recopier un décompte de tests de mémoire.** Ce chiffre a divergé du réel dans trois
documents à la fois. Il se relit dans la sortie du runner, et n'a rien à faire dans une doc durable.

---

## Le harnais de scénarios — cinq invariants

`__tests__/helpers/createVirtualPeer.js`, `helpers/fakeSignalingServer.js`,
`__mocks__/peerjs.js` (mode bus).

- **`vi.resetModules()` par pair.** `usePeerTransport` porte encore deux variables module-level
  (`contextRegistry`, `_hubRateLimiter`) ; sans reset, deux pairs partagent le même registre de
  contextes et ne sont qu'un seul participant. Corollaire : monter les pairs **séquentiellement**.
  ⚠️ Le mock PeerJS doit être **ré-importé après le même reset**, sinon `getLastPeerInstance()` ne
  voit pas les instances créées par la copie sous test.
- **`destroy()` du mock émet `disconnected` et conserve `_handlers`.** Par fidélité au vrai
  (`bundler.mjs:1810` et `:1789`) — c'est ce qui rend observable le détachement explicite des
  listeners. Les vider « pour faire propre » rendrait vert un correctif inerte, et c'est exactement
  ce qui s'est produit : un test existant est passé au **rouge** le jour où le mock a cessé de mentir.
  Ce qui mentait était l'**ordre** (drapeau `destroyed` posé en premier, `disconnected` jamais émis).
  Écart assumé : le mock ne met pas `_id = null` (le vrai le fait, l.1809) — le registre du bus est
  keyé sur `id` et trois scénarios appellent `destroy()` directement.
- **Une tâche de boucle d'événement par signal** (`setTimeout(…, 0)` dans le faux serveur). Un event
  Reverb = une frame WebSocket = une tâche. Dispatcher deux signaux dans le même tick fabriquerait
  une coalescence (`lastRoomSignal` = `at(-1)`) **impossible en production**, et ferait échouer des
  scénarios sur un artefact de test.
- **Livraisons asynchrones du bus PeerJS.** Le code branche ses handlers *après* l'appel
  (`call.answer(…)` puis `setUpConnectionListeners(call)`) — une livraison synchrone les manquerait
  tous.
- **Un pair virtuel est un onglet, pas un contexte** — et la présence se livre séquentiellement
  aux contextes d'un même onglet, sans quoi le scénario reste vert malgré le bug
  ([détail](#un-onglet-plusieurs-contextes)).
- **Une connexion refusée ne revient jamais à son émetteur.** C'est l'asymétrie la plus coûteuse de
  PeerJS, et le mock l'a longtemps niée sur trois points, qui rendaient *structurellement*
  inobservable la panne « A diffuse, B ne voit rien » dans sa forme définitive :
  une MediaConnection naissait `connected` (elle naît `connecting` et ne s'établit qu'au `answer()`
  du récepteur) ; `close()` se propageait à l'autre extrémité même sur une paire jamais ouverte
  (il n'existe alors aucun canal pour porter l'information) ; et l'orphelin rendu sur
  `peer-unavailable` ne portait pas le peerId visé (`conn.peer`), seul lien permettant à la recovery
  de retrouver la connexion morte dans le store. Un mock optimiste ne rend pas les tests plus
  faciles : il les rend muets sur toute une famille de pannes.

`createPeerBus()` est **opt-in** : sans lui, le mock garde son comportement isolé historique et les
tests unitaires existants ne voient aucune différence.

### Un onglet, plusieurs contextes

Un pair virtuel est un **onglet**, pas un contexte. `peer.mountContext({ type, room })` en ajoute
un dans le même registre de modules et la même Pinia — donc même `contextRegistry`, même `Peer`
PeerJS, même store. C'est la seule configuration où les collisions d'état entre contextes
existent (cf.
[architecture.md](architecture.md#un-onglet-plusieurs-contextes--la-granularité-des-clés-du-store)),
et la production n'en connaît pas d'autre.

⚠️ **La présence doit être livrée aux contextes d'un onglet SÉQUENTIELLEMENT** pour que le
scénario ait une valeur. `connectRoom` les synchronise tous dans le même tick : chacun lit alors
le store *avant* que le voisin n'ait enregistré sa demande — `addWaitingRemotePeerId` n'a lieu
qu'après le POST — et la collision n'a jamais lieu. Un scénario concurrent reste **vert même
avec l'indexation fautive**, ce qui a été vérifié en réintroduisant le bug. La production, elle,
est séquentielle : les providers montent dans l'ordre du template, s'initialisent à des ticks
différents (le parent en `onMounted`, le provider `stream` depuis `StreamSimpleUI`), et le canal
de présence re-déclenche le watcher à chaque changement. Voir `syncSequentially` dans
`scenarios/multiContext.test.js`.

⚠️ **Entre onglets, `connectRoom` est concurrent — et c'est un angle mort.** Il livre la présence à
tous les pairs dans le même tick, ce qui referme avant de l'ouvrir la fenêtre « je connais mon peerId,
pas encore ma room » : chez un arrivant, `remotePeers` n'est écrit qu'après `waitForMeReady` (donc
après le peerId local), alors que la demande du diffuseur ne coûte qu'un aller-retour HTTP + Reverb.
Cette fenêtre est réelle et a produit une régression (les gardes d'admission y refusaient tout
contact légitime). Un scénario qui la vise livre donc la présence explicitement, un pair après
l'autre — cf. `lateJoiner.test.js`, cas « la demande de peerId d'A précède sa présence ». La règle
générale reste la concurrence : la séquentialité est un outil de scénario, pas un défaut de harnais.

Le faux serveur reproduit la **liste blanche exacte** du `UserController` : y ajouter un champ que le
PHP ne relaie pas fabriquerait un chemin impossible en production. Réciproquement, desserrer la liste
blanche côté PHP rendrait le harnais menteur.

### Deux canaux, pas un

Les signaux de room (`.AskToPeerID`, `.ResponseToPeerID`) arrivent dans la **file de signaux du
store** et sont routés par `useSignalingQueue` — c'est ce que `_dispatchTo` reproduit. Les
invitations d'appel direct (`.AlertToUser`, `.ResponseToAuthorizationPeer`) arrivent sur le **canal
utilisateur** Reverb, que `System/Notifications.vue` écoute, et le store ne les voit jamais. Un test
d'appel direct passe donc par `server.bindUserChannel(slug, handler)`.

⚠️ Le harnais s'arrête **au bord du composant** : `.AlertToUser` ouvre un composant d'alerte, donc une
décision humaine, et c'est au test de tenir ce rôle en appelant `acceptCallFromPeer`. Router jusqu'au
verbe demanderait de monter `Notifications.vue`, et le scénario ne parlerait plus de WebRTC.

---

## Pièges de mock

- **Les `vi.fn()` globaux de `setup.js` ne sont pas réinitialisés entre les tests** (pas de
  `clearMocks` dans `vitest.config.js`) : faire `navigator.mediaDevices.getUserMedia.mockReset()` en
  `beforeEach`, sinon les compteurs d'appels s'accumulent.
- **Le flux factice de `setup.js` est un objet nu**, or `_bindStreamCleanup` et `connectToPeer`
  filtrent sur `stream instanceof MediaStream` **et** sur au moins une piste `readyState === 'live'`.
  Construire de vraies instances (happy-dom expose la classe) avec un `getTracks()` surchargé —
  `MediaStreamTrack` a un **constructeur illégal**.
- **`askPeerRateLimiter.reset()` obligatoire en `beforeEach`** : le limiteur est module-level et
  `vi.useFakeTimers()` gèle `Date.now()`, donc sa fenêtre ne s'écoule jamais d'un `it` à l'autre —
  sans le reset, les tests s'étranglent mutuellement.
- **Tester le plafond `/ask-to-peer-id` passe par `invalidateRemotePeerId`** (chemin réel du
  `peer-unavailable`). Sans cette purge, c'est le garde `waiting` qui sort en premier et les tests
  verdissent pour la mauvaise raison.
- **`getConnections` ne doit jamais être enveloppé dans un `computed()` dans le mock** : les getters
  Pinia sont auto-déballés et la production lit `ctx.peerStore.getConnections?.[room]` **sans
  `.value`** → `hasOpenConnection` renverrait *toujours* `false` en test, faux négatif silencieux.
  `mockFidelity.test.js` épingle ce cas nommément.
- **Une barrière de test se construit UNE fois, pas à chaque appel.** Le motif naturel pour tenir
  un verrou ouvert — `waitForMeReady: vi.fn(() => new Promise((resolve) => { release = resolve }))`
  — fabrique une promesse **neuve à chaque invocation**, et `release` ne désigne que la dernière.
  Tout ce qui rappelle l'attente derrière le premier appel (le rejeu de `syncUsersConnections`, un
  moteur de retry) se bloque alors sur une barrière que le test croit avoir levée, et le symptôme
  est un **timeout**, pas une assertion rouge — donc muet sur sa cause. Une seule barrière partagée,
  `vi.fn(() => gate.then(() => true))`, résout instantanément après ouverture et laisse le drain
  s'exercer. `useConnectionPool.test.js` (§ `syncUsersConnections`) en porte le helper.
- **`createMockContext._pushSignal` écrit dans `_signalQueue`** (un `ref` réassigné, donc réactif par
  changement d'identité) alors que `getQueueForRoom` lit `_signalQueueRooms` (objet nu, non réactif) :
  deux structures déconnectées. **Tout test de drain de file serait un faux positif** avant
  correction du mock.
- **`connection.remotePeers` est un ACCESSEUR des deux côtés**, au-dessus de
  `peerStore.roomMembers[contextId]` — le double ne le déclare donc pas comme une propriété, et un
  override `connection: { remotePeers: [...] }` est **extrait avant le spread** pour semer l'index.
  Le remettre dans le spread écraserait l'accesseur par un tableau nu et ressusciterait le miroir
  dans le double **sans rien casser** : les deux gardes lisent `Array.isArray(…) ? … : []`, donc la
  composition deviendrait simplement invisible au store et le verdict basculerait vers « refusé »,
  que la moitié des tests d'autorisation attend déjà. Trois conséquences pour le double :
  `_roomMembers` est `reactive` (l'état Pinia réel l'est, et c'est la réactivité du chemin de
  PRODUCTION — écrire par `computeRoomDiff`, lire par l'accesseur — qu'un objet nu casserait, pas
  celle du semis) ; son `computeRoomDiff` **importe** `diffRoomMembers` du store ; et son setter est
  le **seul** écart assumé avec la production, qui n'en a aucun. `roomMembersSourceOfTruth.test.js`
  épingle les trois, et ferme l'écart là où il compte : au grep sur les sources de production, qui
  ne doivent ni assigner ni muter ce champ. C'est la forme exacte de la panne de `Peer.id`
  (`peerjsMockFidelity.descriptors.test.js`), traitée à la source plutôt qu'en durcissant le double.
- **Le bail se lit avec la constante, jamais avec un littéral**, et le mock stocke la même FORME
  de valeur que le store (`{ peerId, learnedAt }`). `createMockContext` importe donc
  `REMOTE_PEER_ID_LEASE_MS` pour la raison exacte qui lui fait importer `waitingPeerIdKey` : une
  seconde implémentation d'un contrat partagé diverge sans jamais lever. Corollaire **fail-closed**
  des deux côtés : une entrée sans estampille numérique n'est **pas** composable — le choix inverse
  rendrait verts, pour la mauvaise raison, tous les tests de composition dès qu'un double
  oublierait le tampon.
- **Un bail a deux versants, et les tests du transport n'en exercent qu'un.** Rendre
  `getRemotePeerId` / `getSlugByRemotePeerId` sensibles au temps dans le **vrai** store laisse
  `usePeerTransport.incomingAuth` et `.peerUnavailable` **entièrement verts** : ils lisent le
  mock. Ces fichiers épinglent donc la cécité au bail du *harnais* ; celle du store est épinglée à
  part, sur Pinia réel, par `peers2Store.remotePeerId.test.js`. Même règle que le minuteur ICE
  ci-dessous — **le contrôle de harnais doit neutraliser les deux côtés**, sinon il ne prouve que
  celui qu'on a doublé. (Contre-épreuve faite dans les deux sens le 26/08/2026.)
- **Une attente pendante rougit par le `testTimeout`, pas par une assertion.** Le cas
  « `destroy()` résout les attentes en vol à `false` » (`createPeerContext.test.js`) reste pendant
  jusqu'à l'alarme du contexte (15 s) si le correctif saute : sa contre-épreuve met donc 10 s à
  rougir, et c'est volontaire. La tentation est d'écrire un `Promise.race` contre une sentinelle —
  il testerait la sentinelle. Ne pas non plus « accélérer » avec `vi.useFakeTimers()` : l'attente ne
  dépend pas d'un minuteur, mais d'un `watchEffect` sur deux clés de store.
- **Le garde de propriété de `clearRoomMembers` a lui aussi deux versants**, et le double le porte
  pour cette raison — pas par symétrie décorative. Mesuré dans les deux sens : neutraliser le verbe
  du **store** fait rougir `createPeerContext.test.js` et `peers2Store.roomMembers.test.js` en
  laissant vert le cas du double ; neutraliser celui du **double** fait rougir le seul cas de
  `roomMembersSourceOfTruth.test.js` en laissant les deux autres verts. Sans le versant double, le
  harnais serait plus permissif que la production sur un chemin de sécurité — la panne n° 2 de
  `mockFidelity.test.js`. Un troisième filet, mécanique celui-là, vérifie au grep que **l'appel de
  production présente bien son propriétaire** : le garde est conditionné à cet argument, donc un
  appelant qui l'oublierait le rendrait décoratif sans qu'aucun test de comportement ne rougisse
  (les deux contextes de la panne sont homonymes, tous les cas à contexte unique restent verts).
- **`getRemotePeerId` rend `undefined` sur entrée absente, des deux côtés.** Le double rendait
  `null` : sans conséquence sur la production (ses lecteurs testent la truthiness ou comparent à
  `conn.peer`), mais sept assertions épinglaient la valeur du **double** au lieu du contrat du
  store. Aligné le 29/08/2026. La règle générale : quand un double « normalise » une valeur de
  retour, ce sont les tests qui finissent par documenter le double.
- **`hasOpenConnection` ne peut pas servir de prédicat côté récepteur** : `usePeerTransport`
  n'enregistre **jamais** de connexion dans le store (aucun `prepareRoomConnection` /
  `storePeerConnection` dans tout le fichier ; seul `usePeerConnections._saveRoomConnection` en
  écrit, côté **initiateur**). Pour un appel one-way entrant, le récepteur se contente de
  `call.answer()` + `setUpConnectionListeners()`. Un correctif conditionné à ce prédicat est **inerte**
  côté récepteur — et son test vert uniquement parce que le mock fournit une information que le vrai
  store ne peut pas donner. C'est arrivé. C'est aussi ce qui a fait écarter la variante « fraîcheur
  du bail par preuve de connexion » : la preuve qu'elle chercherait est **produite par le bug** —
  une `MediaConnection` à moitié ouverte compte comme ouverte, c'est-à-dire exactement l'état d'un
  pair qui vient de recharger sa page.
- **`handleRemoteDeparture` avale ses exceptions** : une purge qui jette avant d'atteindre l'entrée
  visée rend le test vert. Poser un garde `console.error` dans le test.
- **`setLocalPeer` mocké par `vi.fn(() => true)`** fabrique un booléen que la production ne produit
  jamais — deux tests validaient ainsi une branche inexistante. Voir
  [architecture.md](architecture.md#conventions-de-code).
- **Un minuteur a deux versants, et le test du composable n'en exerce qu'un.** Retirer l'annulation
  du minuteur ICE du vrai `resetPeerState` laisse `usePeerTransport.iceRefresh.test.js`
  **entièrement vert** : ce fichier n'exerce que la doublure du store. Le versant store se teste
  donc à part (`peers2Store.peerRuntime.test.js`). La règle vaut pour tout état vivant dans le store
  et piloté depuis un composable : **le contrôle de harnais doit neutraliser les deux côtés**, sinon
  il ne prouve que celui qu'on a doublé.

---

## Ce qu'il faut savoir avant d'écrire

- **`withSetup` : obligatoire ou interdit selon la couche.** `useCallManager` et `useStreamManager`
  n'enregistrent aucun hook de lifecycle → ils s'appellent **directement**. `useConnectionPool` et
  `useSignalingQueue` posent un `watch` + un `onUnmounted` → `withSetup` obligatoire.
  `usePeerConnections` n'enregistre plus de hook depuis l'extraction de `useSignalingQueue` : lui
  aussi s'appelle directement. `createPeerContext` exige `withSetup` avec
  `provides: { eventBus: mockEventBus() }` (`inject`, `onBeforeMount`, `onUnmounted`).
- **`createPeerContext` se teste avec les VRAIS stores Pinia**, pas avec des `vi.mock`. `peers2`, `me`
  et `server` sont des stores d'options **sans effet de bord à l'instanciation**, `setup.js` pose déjà
  une Pinia fraîche avant chaque test, et on couvre au passage la vraie intégration store ↔ contexte
  (notamment la suppression **conditionnelle** de `removeRemotePeerId`).
- **Le runtime du Peer singleton vit dans `peerStore`** : une Pinia fraîche ou un `ctx` neuf suffit à
  l'isoler. Seuls `contextRegistry` et `_hubRateLimiter` exigent encore `vi.resetModules()`.
- **`remoteStreams` exclut les partages d'écran.** Asserter sur `remoteStreams` seul laisse passer
  toute régression d'écran — utiliser aussi `remoteScreens`.
- **Simuler le HMR** : `vi.resetModules()` + ré-import **en gardant la même Pinia**, précédé d'un
  contrôle de harnais (vérifier qu'une copie rechargée réagit bien à `onUnmounted`) — sans quoi « le
  peer n'est pas détruit » serait vert pour rien.
- **`getLastPeerInstance()` / `resetPeerMock()` / `instance._triggerEvent('open', 'peer-id')`** sont
  les entrées du mock PeerJS ; `vi.useFakeTimers()` pour le délai de destruction et le backoff.
- **Faire vieillir une horloge : `vi.setSystemTime()`, et surtout pas une avance de minuteurs.**
  Deux pièges distincts, tous deux rencontrés en posant le bail des peerId :
  - Dans un **scénario**, `vi.useFakeTimers()` gèlerait le `setTimeout(…, 0)` du faux serveur de
    signalisation et bloquerait le test. `setSystemTime` seul ne mocke que `Date` : `settle()` et la
    règle « une tâche par signal » continuent de tourner. Restaurer par `vi.useRealTimers()`.
  - Dans un test **à minuteurs factices**, `advanceTimersByTime(REMOTE_PEER_ID_LEASE_MS)` jouerait
    toute la chaîne de retry (le bail est dimensionné **au-dessus** de son horizon, ≈55 s) : le
    moteur aurait abandonné avant la première assertion. `setSystemTime` décale l'horloge **et** les
    échéances en vol du même delta — le temps a passé, rien ne s'est exécuté.

  Deux effets de bord assumés, dans le bon sens : la fenêtre glissante d'`/ask-to-peer-id` repart à
  zéro, et les `createdAt` des demandes en vol deviennent stale.
- **Un scénario de rechargement qui garde un tour de présence intermédiaire teste autre chose, et il
  est vert gratuitement.** Le `await bob.api.syncUsersConnections([{ slug: 'bob' }])` glissé entre le
  départ et le retour rend le revenant « nouveau » pour le survivant : c'est une **béquille de
  harnais**, pas le cas de production. En production le départ n'est pas toujours annoncé (cf.
  [architecture.md](architecture.md), « le fan-out réconcilie »), donc le scénario qui vise cet angle
  mort doit **ne rien livrer** entre les deux.
- **Le revenant est toujours vert comme initiateur : asserter sur la direction que possède le
  SURVIVANT.** Un pair qui recharge repart d'un contexte neuf où tout le monde est « nouveau » — tout
  ce qu'il initie fonctionne sans correctif. En mode `stream` le flux ne part que du diffuseur : il
  faut donc **faire diffuser le survivant** et asserter que le revenant reçoit son flux. Se tromper
  de direction donne un test vert qui ne prouve rien.
- **`useConnectionPool.test.js` stube `getRoomUsersDiff`**, donc la composition n'y est jamais
  réellement écrite : tout cas qui exerce une lecture de la composition doit la **pré-semer**
  lui-même. Sans ce pré-semis, un test de réconciliation ne voit aucun membre et verdit pour la
  mauvaise raison. Le semis s'écrit `ctx.connection.remotePeers = [...]` sur un double (le setter de
  semis) et `peerStore.setRoomMembers(ctx.contextId, [...])` sur un **vrai** contexte, où l'écriture
  lève. Toujours par réaffectation, jamais par `push` : les lecteurs tracent la clé.
- **Un scénario ne peut pas faire tourner le moteur de retry, et l'oublier fabrique des verts
  gratuits *comme* des rouges trompeurs.** `settle()` draine les microtâches et les tâches à échéance
  0, jamais les minuteurs — or une chaîne de retry se réveille à `1000·2^0 + jitter` (≤ 1299 ms) et
  ne s'éteint qu'à ce réveil, même si la connexion est établie depuis longtemps. Deux conséquences
  opposées, toutes deux rencontrées en posant la re-composition sur perte :
  - **vert gratuit** : un scénario qui provoque la perte juste après l'établissement la provoque
    alors qu'un moteur veille encore — état qui n'existe qu'une seconde en production. Le tester
    revient à court-circuiter un mécanisme qui aurait fait le travail. Il faut **attendre réellement**
    (`await new Promise(r => setTimeout(r, 1500))`) pour atteindre le régime établi, seul état où le
    trou existe ;
  - **rouge trompeur** : à l'inverse, un correctif conditionné à « aucune chaîne en vol » paraît
    inerte dans un scénario écrit sans cette attente, et l'on est tenté de **retirer le garde**. Le
    faire régresse aussitôt le scénario voisin (« A recharge sans que B voie son départ »), pour une
    raison qui n'a rien à voir avec le harnais : composer un pair qui n'est pas encore revenu pose un
    `waiting` de `SIGNALING_STALE_MS` qui muselle la demande suivante.

  Et pas de `vi.useFakeTimers()` pour s'en sortir : il gèlerait le `setTimeout(…, 0)` du faux serveur.
- **Un garde qu'aucune contre-épreuve ne peut faire rougir ment sur son utilité.** En neutralisant les
  gardes un par un du watcher de perte, l'un d'eux — `isValidSlug` — n'a fait rougir aucun cas :
  `isAuthorizedPeer` le porte déjà en première ligne. Il a été retiré, pas commenté. Corollaire pour
  le test qui vise ce refus : il doit **empoisonner la composition** (`remotePeers = ['slug invalide']`),
  sinon il sort sur « pas membre » et n'épingle pas ce qu'il croit.
- **Trois chemins alimentent `announcedStreamPeers` : un scénario qui n'en coupe aucun ne prouve
  aucun des trois.** C'est la version « annonce » du piège de direction ci-dessus. Pour isoler le
  chemin voulu, **neutraliser le P2P sortant du diffuseur** avec les fabriques du mock :

  ```js
  alice.peerInstance.call = vi.fn((peerId, stream, options) =>
      createMockMediaConnection(options?.metadata))
  alice.peerInstance.connect = vi.fn((peerId, options) =>
      createMockDataConnection(options?.metadata))
  ```

  Les deux rendent une connexion **valide mais non reliée au bus** — donc l'état exact d'un
  `peer.call` que personne ne répond. Ni l'annonce `BROADCAST_STATE` (pas de canal data) ni la trace
  de l'appel entrant (rien n'est livré) ne peuvent plus expliquer le résultat : il ne reste que la
  signalisation. Sans cette coupure, en contexte `stream`, `connectToPeer` ouvre le canal data **avec**
  l'appel média et l'annonce arrive par le premier chemin — le test serait vert avant même le
  correctif.
- **Une fonctionnalité qui traverse trois étages se contre-éprouve sur les trois.** En neutralisant
  `noteBroadcastFromSignal` (27/08/2026), exactement trois cas tombent — le verbe
  (`useBroadcastPresence`), le câblage (`usePeerOrchestrator.broadcastPresence`) et le scénario
  (`lateJoiner`) — et **le cas pré-existant « B est averti qu'A diffuse » reste vert**, puisqu'il
  passe par le data channel. C'est ce dernier point qui donne le rayon d'action : une contre-épreuve
  qui fait tomber plus que prévu dit qu'on a couplé deux chemins.

---

## Trous de couverture connus

Sans décompte, parce qu'il pourrit : l'état exact se lit dans
[`work/webrtc2-tests-plan.md`](../../../work/webrtc2-tests-plan.md).

- `usePeerOrchestrator` — **volontairement bloqué** : le wrapping du routage star qu'il faudrait
  couvrir est justement ce qui doit *déménager* dans `usePeerTransport`. Écrire ces tests avant le
  déménagement revient à les jeter. Exception ouverte :
  `usePeerOrchestrator.broadcastPresence.test.js`, qui n'asserte rien sur le routage star et survivra
  donc au déplacement.
- `useMediaBroadcast` — dépend du point précédent.
- `usePeerTransport` — restent `sendData` star (client/hub), le **câblage** du rate-limiting hub (la
  mécanique est couverte dans `utils/createRateLimiter.test.js`), et `contextRegistry`.
- `usePeerCore` — restent `notifyCloseConnectionToPeer`, `stopCallInviteRetry*`, `onUnmounted`.
