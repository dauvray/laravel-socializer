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

- **`vi.resetModules()` par pair.** `usePeerTransport` porte deux variables module-level, et deux
  seulement : `_hubRateLimiter` et `_hubByteLimiter`, les compteurs du hub star. Sans reset, deux
  pairs partagent la même fenêtre de débit. Corollaire : monter les pairs **séquentiellement**.
  ⚠️ Le mock PeerJS doit être **ré-importé après le même reset**, sinon `getLastPeerInstance()` ne
  voit pas les instances créées par la copie sous test.
  ℹ️ `contextRegistry` **n'est plus module-level** : il vit dans `stores/peers2/state.js` depuis que
  les dispatchers du Peer ont dû le consulter au travers d'un HMR. C'est donc la Pinia neuve de
  `setup.js` qui l'isole, pas le reset de modules.
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
- **Semer une file de signaux passe par l'action `dispatchSignal`, jamais par une écriture directe
  dans `signalQueues`.** C'est l'unique écrivain en production, et lui seul pose l'enveloppe (`ts`,
  `seq`, plafond à 10 par file) : écrire la map à la main laisse le test inventer une forme que la
  production n'écrit jamais.
  - **Un `computed` au-dessus d'un getter Pinia paramétré est réactif y compris à la CRÉATION de
    la clé** : un watcher posé sur `getLastRoomSignal('peer-a')` alors que la file n'existe pas
    encore se déclenche au premier dispatch. Ne pas pré-créer la file « pour être sûr » — ça
    masquerait une régression de réactivité.
  - **Un seul `await nextTick()`** entre le dispatch et l'assertion. Si un cas en réclame deux,
    c'est un signal à instruire, pas un tick à ajouter.
  - ⚠️ **Deux dispatch sans tick entre eux ne réveillent le watcher qu'UNE fois**, avec le second :
    la première annonce est perdue. Tout cas multi-signaux doit donc intercaler un tick — sauf
    celui qui vise cette coalescence, et il doit dire pourquoi il ne le fait pas. Un cas écrit sans
    ce tick est vert ou rouge pour la mauvaise raison ; c'est arrivé en écrivant le fichier.
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
- **Amener le Peer jusqu'à l'`'open'` est OBLIGATOIRE**, plus seulement de la fidélité :
  `setLocalPeer()` ne se règle plus avant, donc un `await` sans `'open'` **interbloque**, et une
  init laissée en vol emporte un minuteur de `PEER_OPEN_TIMEOUT_MS` au-delà du test. Le motif est
  dans `helpers/bootLocalPeer.js` — lancer sans attendre, attendre l'instance, ouvrir, **puis**
  attendre l'init.
  - ⚠️ **Sous `vi.useFakeTimers()`, passer `waitForInstance: waitForPeerInstance`.** `vi.waitFor`
    avance l'horloge **factice** de 50 ms par tour de sondage, dès le premier appel, qui est
    synchrone — `checkCallback` commence par `if (vi.isFakeTimers()) vi.advanceTimersByTime(interval)`
    (vitest 2.1.9, `dist/chunks/vi.DgezovHB.js:3591`). Un fichier qui pilote des échéances à la
    milliseconde près, comme `iceRefresh.test.js`, verrait son budget entamé avant sa première
    assertion. `waitForPeerInstance` n'attend que des microtâches : `_doInit` n'a besoin d'aucune
    horloge, `AjaxService.load` résolvant par microtâche.
  - ⚠️ **Attendre « une instance non nulle » est faux au SECOND démarrage** d'un même test :
    `getLastPeerInstance()` rend l'ancienne tant que la nouvelle n'est pas construite. D'où le
    paramètre `previous`, relevé avant le démarrage. Mesuré : deux cas de `singleton.test.js`
    verdissaient à l'envers, en asseoirtant sur un peer déjà détruit.
  - ⚠️ **Répéter `await Promise.resolve()` ne prouve pas qu'une promesse n'est PAS réglée** : la
    chaîne `_doInit()` → `.catch` → `.finally` → le `.then` du test consomme plusieurs tours, et en
    compter « assez » donne un vert par budget. Rendre la main sur une **tâche**
    (`setTimeout(…, 0)`) draine la file de microtâches entière. Mesuré : avec trois tours, le cas
    « l'init ne se règle pas tant que l'`'open'` n'est pas arrivé » passait sur le code d'AVANT le
    correctif.
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
- **Un seul pair, une seule connexion, un seul type : c'est là que naissent les verts gratuits.**
  Quatre contre-épreuves ont rougi **zéro** cas en écrivant `usePeerOrchestrator.*`
  (29/08/2026), et les quatre fois la faute était dans le test. Le motif est toujours le même —
  **un périmètre à un seul élément ne distingue pas « cible précise » de « tout le monde »** :

  | Ce que le cas croyait prouver | Pourquoi il était vert sans le code |
  |---|---|
  | `sendDataToPeer` transmet ses destinataires | avec un seul pair, diffuser à toute la room, c'est lui |
  | `stopScreenCapture` ne ferme QUE `screen` | sans connexion `stream` à côté, rien ne distingue les deux types |
  | la garde `isCapturing` de l'arrêt natif | la première fermeture vide la room, la seconde sort par l'early-return de `closePeerConnection` |
  | le wrap de fermeture n'est pas posé hors `stream` | le flux semé était d'un AUTRE type que la connexion, or `handleRemoteDeparture` n'emporte que le type qui se ferme |

  La parade est mécanique : **deux pairs, deux connexions, deux types** dès qu'un cas affirme une
  portée. Et le commentaire qui dit pourquoi le second existe, sans quoi un lecteur le retirera
  « pour simplifier ».

---

## Trous de couverture connus

Sans décompte, parce qu'il pourrit : l'état exact se lit dans
[`work/webrtc2-tests-plan.md`](../../../work/webrtc2-tests-plan.md).

- `usePeerOrchestrator` — **couvert depuis le 29/08/2026**, en quatre fichiers : le câblage de
  l'annonce de diffusion (`.broadcastPresence`), les wraps de callbacks et la normalisation des
  entrées (`.callbacks`), le teardown (`.teardown`), les flux locaux et les bascules (`.media`).
  La branche hub du wrap `onDataReceived` a rejoint `.broadcastPresence` le même jour, une fois la
  décision de routage descendue dans `usePeerTransport.routeIncomingData`. ⚠️ Le montage d'un hub
  y demande trois préparations, et deux d'entre elles fabriquent un test **vert par vacuité** si on
  les oublie : `isHub` vaut `null` tant que `waitForMeReady` n'a pas tourné, et une connexion
  **entrante** n'est pas enregistrée dans le store — le hub n'a alors personne à qui retransmettre.
- `useMediaBroadcast` — **couvert depuis le 29/08/2026**, en deux fichiers dont la séparation est un
  fait mesuré, pas un rangement : le fichier de comportement double l'orchestrateur en entier (il
  n'y a derrière que des passthroughs), et **un double définit la surface**, donc il est structurel-
  lement aveugle à un renommage en amont — une clé renommée dans le `return` de l'orchestrateur
  deviendrait un `undefined` ré-exporté sans qu'un seul cas de la suite ne bouge. C'est
  `useMediaBroadcast.surface.test.js`, monté sur l'orchestrateur réel, qui tient ce contrat-là.
  ⚠️ Il vérifie aussi que les états restent des **refs** : un ref déballé rend une valeur définie,
  donc le garde « rien n'est `undefined` » le laisse passer.
- `usePeerTransport` — couvert depuis le 29/08/2026 : `sendData` star
  (`usePeerTransport.star.test.js`), le **câblage** du rate-limiting hub et la taille du chemin hub
  (`usePeerTransport.forwardStar.test.js`), le registre des contextes des deux côtés
  (`peers2Store.contextRegistry.test.js` pour la sémantique, `usePeerTransport.singleton.test.js`
  pour le câblage).
- `usePeerCore` — couvert depuis le 29/08/2026 : `notifyCloseConnectionToPeer`,
  `stopCallInviteRetry*` et `onUnmounted`. Ce dernier porte un contrôle négatif **mesuré** :
  neutraliser le seul hook de `usePeerCore` le laisse vert, parce que `usePeerRetry` enregistre le
  sien avant — il faut neutraliser les deux.
- `Widgets/**` — l'**étage de présentation**, couvert en partie depuis le 30/08/2026 : les trois
  boutons de flux local, le traitement du refus de permission média, et le contrat DOM de la
  vignette d'attente. La **boucle des toggles** l'a rejoint le 31/08/2026, en trois fichiers dont
  la séparation est une mesure : `useRemotePeerState.test.js` (le protocole, sans rendu),
  `RemoteMediaPlayer.test.js` (l'adaptateur, avec le player réel) et
  `StreamSimpleUI.toggles.test.js` (le **joint** `conn.peer`). Casser l'un des deux bouts du joint
  ne rougit **que** le troisième — mesuré à 0 sur les deux autres : c'est ce qui prouve qu'aucun
  n'est le doublon d'un autre. **Les contrôles de la vignette** l'ont rejoint le 31/08/2026, en
  deux fichiers dont la séparation est elle aussi une mesure (voir « Fabriquer le plein écran et le
  PiP » ci-dessous). **Le provider et `LocalMediaPlayer`** l'ont rejoint le 31/08/2026, en trois
  fichiers — et là encore la séparation est mesurée, par deux 0 croisés : permuter la clé de
  `provide(WEBRTC_API_KEY)` ne rougit que `MediaBroadcastProvider.test.js`, et reconstruire
  `screenStreamData.stream` en copie ne rougit que `StreamSimpleUI.local.test.js`. Cette clé n'a
  qu'un `provide` et qu'un `inject` dans tout le dépôt : aucun étage ne peut voir les deux bouts.
  **Les deux boutons d'appel** l'ont rejoint le 31/08/2026 et **ferment l'étage** — `CallManagerBtn`
  et `CallRemotePeerBtn`, plus un troisième fichier pour la couture avec `Notifications`. Ce
  troisième est justifié par la mesure la plus nette du chantier : les **sept** contrôles de
  couture (attribut renommé, prop coupée, écouteurs croisés) rougissent le fichier du joint et
  **0 cas** de celui de la barre. `SpectrumAnalyzer` reste hors périmètre, assumé.

---

## Tester un composant : 14 faits mesurés

### ⚠️ Les `directives` passées en `global` sont INERTES

Plusieurs fichiers passent `directives: { resize: noop, draggable: noop }` en croyant neutraliser
`v-resize` / `v-draggable`. **Ils ne neutralisent rien.** `MediaBroadcastPlayer` fait
`const vResize = resizeDirective` dans son `<script setup>` : le compilateur résout la directive
en **binding de setup** et n'émet aucun `resolveDirective`, donc l'enregistrement global n'est
jamais consulté. Les vraies directives tournent, dans ces fichiers comme dans les autres — elles
sont inoffensives parce que `resizable` et `draggable` valent `false` par défaut et sortent en
early-return, pas parce qu'on les aurait remplacées.

Conséquence pratique : ne pas compter dessus pour isoler un test, et ne pas les ajouter « par
sécurité » — elles font croire à une protection qui n'existe pas.

### ⚠️ Un commentaire HTML en tête de `<template>` coupe le fallthrough des attributs

Mesuré, et payé : un composant dont la racine est unique laisse Vue faire descendre les attributs
du consommateur. **Ajouter un commentaire HTML avant cette racine rend le composant multi-racine**,
et le fallthrough s'arrête — silencieusement. C'est arrivé en documentant le retrait d'un
`v-bind="$attrs"` redondant dans `RemoteMediaPlayer.vue` : l'explication, écrite dans le
`<template>`, a cassé ce qu'elle expliquait.

Deux règles en sortent : un commentaire de ce genre vit dans le `<script setup>`, et **un contrôle
de harnais dont la référence n'a pas été relue à 0 ne mesure rien** — le contrôle suivant avait
rendu « 1 cas rougi » qui n'était pas le sien, mais la régression déjà présente.

⚠️ **Corollaire mesuré sur le jumeau, et c'est le plus contre-intuitif : une ligne redondante peut
DÉSARMER le contrôle du voisin.** Tant que `LocalMediaPlayer` portait son `v-bind="$attrs"`
superflu, le contrôle « `inheritAttrs: false` ajouté » y rougissait **0** cas — le `v-bind`
rendait les attributs de toute façon — contre 1 cas chez `RemoteMediaPlayer`, qui ne l'avait plus.
Après retrait : 1 des deux côtés. Une ligne idempotente n'est donc pas seulement du bruit ; elle
peut rendre aveugle le test censé garder la transparence, et un contrôle à 0 doit faire chercher
**quelle autre ligne** absorbe la mutation avant de conclure que le test est inutile.

### Monter les enfants réels, ne pas les stuber

Sur un composant qui n'existe que pour **convertir des événements en appels** — le cas de
`GroupLocalStreamBtn` —, stuber les enfants revient à asserter les noms d'événements de son propre
stub. Le contrat n'est alors vérifié nulle part, des deux côtés à la fois.

C'est concret ici : `LocalStreamBtn` parle **snake_case** (`start_video`) et `LocalCaptureBtn`
**kebab-case** (`start-stream`), et leur parent est le seul endroit du dépôt où les deux
vocabulaires se croisent. Renommer d'un seul côté n'émet aucune erreur — **Vue ne se plaint jamais
d'un événement que personne n'écoute**. Seul un montage réel le voit.

Corollaire utile : `IconWidget` (`~estarter`) rend `<i class="las la-{icon}">` et n'a aucune
dépendance. Les icônes s'assertent donc sur la valeur rendue (`.la-microphone-slash`), pas sur un
`data-icon` qu'un stub aurait posé lui-même.

### ⚠️ `emitted()` capte aussi les événements DOM natifs

Un `trigger('click')` fait apparaître `click` dans `wrapper.emitted()`, à côté des événements
déclarés. Toute assertion sur le **vocabulaire complet** d'un composant doit les écarter, sinon
elle échoue pour une raison qui n'a rien à voir avec le composant.

### ⚠️ Un rejet jeté par un espion ne déclenche JAMAIS `unhandledRejection`

Mesuré côte à côte : un `Promise.reject()` nu est bien signalé à Node ; celui que rend un
`vi.fn().mockRejectedValue()`, appelé puis jeté, ne l'est **jamais** — l'espion attache son propre
handler pour tracer ses résultats et absorbe le signal.

Conséquence directe : **« ce code laisse-t-il échapper un rejet ? » n'est pas une question
testable** dès que la source du rejet est un double. Un cas qui l'affirmerait serait vert par
construction, avant comme après un correctif. Ce qui reste testable est l'effet observable — un
toast apparaît, un état ne bascule pas.

Le corollaire vaut au-delà des tests, et il a surpris ici : un handler d'événement Vue qui appelle
un verbe `async` **sans rendre sa promesse** ne fait pas non plus remonter le rejet à
`app.config.errorHandler`. `callWithAsyncErrorHandling` n'enveloppe que ce que le handler **rend**.
Un rejet jeté à cet endroit disparaît sans trace : ni console, ni gestionnaire global.

### Fabriquer le plein écran et le PiP : un emplacement, lu par des accesseurs

`happy-dom` n'a **aucun** des six membres dont `useMediaControls` a besoin :
`document.fullscreenElement`, `exitFullscreen`, `pictureInPictureElement`,
`exitPictureInPicture` sont absents au sens `in` — donc un `Object.defineProperty` suivi d'un
`delete` restaure exactement l'état d'origine — et `requestFullscreen` / `requestPictureInPicture`
n'existent pas sur les éléments. Contrairement à la mise en page, **ce n'est pas une impossibilité :
c'est une fabrication**, et `helpers/fakeFullscreen.js` la porte.

Son invariant est ce qui l'empêche de mentir : **un seul emplacement par fonctionnalité, détenu par
la scène, et `document.*Element` installés en accesseurs `get` qui le lisent.** Un faux
`requestFullscreen` qui « oublierait » de mettre à jour ce que le code lit devient structurellement
impossible — il n'y a pas deux vérités à synchroniser. Le mode de panne évité est un DOM où un
élément serait en plein écran sans que `document.fullscreenElement` le dise, ce qu'aucun navigateur
ne produit.

Trois corollaires opérationnels :

- **Équiper aussi le concurrent.** Un cas qui prouve *quel* élément est retenu doit équiper les deux
  (la `<video>` **et** le cadre `.draggable-video`), sinon c'est l'absence d'une méthode sur le
  perdant qui décide, et non le code testé. Même règle pour un lecteur audio : on l'équipe, et ce
  qui décide reste la clé exposée (`nativeAudio` ≠ `nativeVideo`).
- **La sortie par Échap et la fermeture de la fenêtre PiP se simulent en appelant `document.exit*()`
  depuis le test.** C'est fidèle : la production n'observe que l'emplacement, et le navigateur le
  vide dans les deux cas. Elle n'écoute ni `fullscreenchange` ni `leavepictureinpicture`, et c'est
  précisément ce que ces cas épinglent.
- **Ne fabriquer que ce qui est lu.** Pas de `fullscreenEnabled`, `pictureInPictureEnabled`,
  `onfullscreenchange` ni `disablePictureInPicture` : fabriquer un membre que personne ne lit, c'est
  inventer un DOM.

### `console.error` n'est pas discriminant au niveau composant

C'est ce qui a coupé les contrôles de la vignette en deux fichiers, et la coupe est une mesure :
retirer le `try/catch` de `toggleFullscreen` ou de `togglePip` rougit **1 cas du fichier composable
et 0 du fichier composant**. La raison est le corollaire ci-dessus : `@click="controls.togglePip"`
passe par `callWithAsyncErrorHandling`, qui journalise déjà en `console.error` le rejet d'un
handler. « Notre `catch` a tracé la cause » et « Vue a tracé à sa place » y donnent donc le même
vert. **Tout cas d'échec appartient à l'étage où le composable s'appelle nu.**

⚠️ Et le contrôle lui-même se prépare : vider le corps d'un `catch` laisse la suite compiler sans
rien mesurer, le retirer seul laisse un `try` orphelin — la suite ne compile plus, et le « 0 cas
rouge » se lit alors comme « ce `catch` ne sert à rien ». Il faut retirer le `try` **avec** lui.

### `happy-dom` réfléchit `muted` en attribut, un vrai navigateur non

Mesuré : après `el.muted = true`, `el.hasAttribute('muted')` rend `true` sous happy-dom, alors
qu'un navigateur ne réfléchit que `defaultMuted`. **N'asserter jamais `attributes('muted')`** —
toujours la **propriété** `.muted`, sinon on épingle un artefact du runner.

Corollaire, et c'est ce qui interdit de stuber `VideoPlayer` dans un test de mute : il y a **deux
écrivains** de `el.muted` en production — l'écriture impérative de `toggleNativeMute` et le patch de
Vue via la prop `:muted`. Un stub qui omet ce binding rend rouge, sur du code correct, le cas « le
pool recycle la vignette ». Mesure qui tranche : renommer `nativeVideo` chez `~estarter` rougit
**8 cas du fichier qui monte le vrai lecteur et 0 du fichier composable**, dont le
`ref({ nativeVideo })` fait main valide sa propre orthographe.

### ⚠️ `wrapper.vm` traverse `defineExpose` — un test d'exposition écrit ainsi ne peut pas échouer

Mesuré : retirer `defineExpose({ api })` de `MediaBroadcastProvider` laisse
`expect(wrapper.vm.api)` **vert**. `wrapper.vm` de VTU atteint les bindings d'un `<script setup>`
que le composant les expose ou non — alors qu'un `<script setup>` est **fermé par défaut** pour
tout le reste du monde.

Ce qu'il faut écrire à la place est le chemin que la production emploie : une **ref de template**
posée par un composant parent (`$refs.provider.api`), qui ne voit que l'exposé. La contre-épreuve
rougit alors 1 cas. Un test d'exposition sans ref de template n'atteste rien.

### ⚠️ Pousser dans un tableau NU n'est vu par aucun watcher, profond ou pas

Un cas qui distingue `watch` superficiel et `deep: true` doit semer sa donnée à travers un `ref`,
comme la production. Mesuré : un `props.users` passé en tableau littéral puis muté par `push`
laisse le cas vert **des deux côtés** de la mutation `deep: true` — il ne dit pas « le watch est
superficiel », il dit « mon tableau de test est inerte ». `ref([])` réactive en profondeur, et
c'est ce proxy-là qu'un watcher profond observerait (`useReverbChannel` expose `users` ainsi).

Corollaire de production, mesuré au même endroit : le `watch(() => props.users)` de
`MediaBroadcastProvider` **n'est pas profond**, donc toute la chaîne de présence dépend du fait que
le fournisseur **réaffecte** son tableau. Y écrire un `push` rougit **0 cas sur 1417** et arrête
silencieusement la synchronisation de tous les providers.

### ⚠️ Un composant asynchrone ne se résout PAS avec `flushPromises`

`defineAsyncComponent(() => import(…))` n'est pas une microtâche en attente : c'est un chargement de
module. Mesuré à la sonde, sur `CallManagerBtn` monté à travers `Notifications` — **quatre tours de
`flushPromises()` laissent le placeholder en place**, et le conteneur rend littéralement `<!---->`.
Ce qui le résout est `await vi.dynamicImportSettled()`, et il le résout **à lui seul** : un
`flushPromises()` ajouté derrière ne change plus rien.

Le danger n'est pas le rouge, c'est le **vert par vacuité** : sur un placeholder, `findAll('button')`
rend `[]` et `find('.btn-stop-call').exists()` rend `false`, donc tout cas écrit en négatif passe
sans rien exercer. D'où la règle : **un fichier qui monte un composant asynchrone commence par un cas
qui asserte sa PRÉSENCE**, avant toute autre assertion. Sur
`Notifications.callControls.test.js`, remplacer `dynamicImportSettled` par `flushPromises` fait
tomber 6 cas sur 7 — c'est la mesure du garde-fou lui-même.

Corollaire à ne pas chercher : le « nombre de tours de `flushPromises` » n'existe pas ici.

### ⚠️ Un stub s'apparie sur le nom du BINDING LOCAL, pas sur le `name` du composant

`Spinner1.vue` (`~estarter`) déclare `name: 'Spinner1'`, et deux fichiers le stubent sous la clé
`Spinner1` — parce que leurs composants l'**importent** sous ce nom.
`CallManagerBtn.vue` fait `import Spinner from '…/Spinner1.vue'` : la clé y est donc `Spinner`.
Mesuré : avec la clé `Spinner1`, le spinner réel est monté et `.spinner-stub` reste introuvable — un
cas qui n'assertait que « 0 bouton » serait resté **vert sans jamais exercer la branche d'attente**.

### ⚠️ `trigger` ne dispatche pas sur un élément portant l'attribut `disabled`

`@vue/test-utils` sort silencieusement de `trigger()` quand `isDisabled()` rend vrai, et
`isDisabled()` lit l'**attribut** `disabled` sur une liste de balises dont `BUTTON`
(`dist/vue-test-utils.cjs.js:7228` et `:7060-7072`). Deux conséquences :

- un état « désactivé » s'asserte par `attributes('disabled')`, **pas** par une propriété — l'inverse
  du piège `muted` ci-dessus, où c'est la propriété qui compte ;
- un cas de « second clic sur un bouton désactivé » mesure l'émulation du navigateur par VTU autant
  que le composant. Acceptable : un vrai navigateur ferme au même endroit. Mais il **absorbe** toute
  garde équivalente posée dans le handler — mesuré : retirer `if (!busPret) return` de
  `CallRemotePeerBtn.onCallUser` rougit **0 cas**, et 2 dès qu'on neutralise aussi `:disabled`.
  C'est un cas d'école de la règle « chercher quelle AUTRE ligne absorbe la mutation ».

### Un double qui appelle une fonction dans un `computed` supprime la réactivité de la production

`Notifications.vue:71` fait `computed(() => peers.callStatus())`. Le double posait
`callStatus: vi.fn(() => 'calling')` : aucune dépendance réactive n'est alors créée, donc le composant
**ne se re-rend jamais** sur un changement d'état d'appel — alors qu'en production `ctx.callStatus`
est un `computed` ref (`createPeerContext.js:289`) et que la lecture est bien réactive.

Le double ne mentait pas sur la *valeur*, il mentait sur la *réactivité* — et un test qui fait varier
l'état d'appel serait resté vert sur un rendu mort. La parade est un vrai `ref` derrière le `vi.fn`,
ce qui garde l'espionnabilité : `callStatus: vi.fn(() => statutAppel.value)`.

---

## Géométrie et mise en page : ce que la suite ne verra jamais

La suite JS ne calcule aucune mise en page — la raison et le partage sont dans
[`architecture/tests.md`](../../architecture/tests.md#cette-suite-ne-calcule-aucune-mise-en-page).
Deux pièges y sont déjà payés, à ne pas re-payer :

**`isVisible()` ne teste pas le clipping par un ancêtre.** Il rend `true` sur une boîte non vide en
`visibility:visible; opacity:1`, même entièrement hors du cadre d'un parent `overflow-hidden`. Ce
qui tranche est la **géométrie comparée à celle de l'ancêtre**, ou une capture relue.

**Une mesure sans canari de cascade est une mesure sans valeur.** `setContent()` part
d'`about:blank` et n'y charge aucun `<link href="file://">`. Le 28/08, « h=51 dans les deux cas »
s'est lu « le correctif ne sert à rien » alors que la page n'avait **aucune CSS**. D'où deux
canaris binaires évalués **avant** toute mesure — `.d-none` ⇒ `display:none` (Bootstrap) et
`.draggable-video` ⇒ `cursor:grab` (`_socializer.scss`) — et un contrôle placé **dans le même run**
plutôt qu'un second run, pour qu'il ne puisse pas être oublié.

⚠️ **Ne pas chercher de hauteur de référence.** La largeur du conteneur de page est un réglage
(`layout_class_container` par route, à défaut `config('estarter.bootstrap_container_type')`), donc
toute cote absolue est vraie d'une configuration et fausse d'une autre. Ce qui est stable et
mesurable : le cadre sans la classe d'intention s'effondre, celui qui la porte tient son ratio, et
rien n'est clippé.
