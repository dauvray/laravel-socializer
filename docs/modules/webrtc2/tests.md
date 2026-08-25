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
un nouveau peerId), `multiContext` (plusieurs contextes dans le même onglet — la forme réelle
d'une page, cf. [ci-dessous](#un-onglet-plusieurs-contextes), et l'ordre de montage réel :
`data-app` d'abord, diffusion ensuite), `outgoingAuth` (un tiers ne peut pas se faire pousser un
flux) et `incomingMappingInvariant` (à quel instant le mapping slug→peerId est posé, relativement à
l'admission entrante).

---

## Le protocole

1. **Un bug vécu s'écrit d'abord dans `scenarios/`**, en repro, **rouge avant le fix**. C'est le seul
   protocole qui n'a jamais produit de régression derrière lui.
2. **Asserter le fait métier, jamais l'implémentation.** `bob.receivedScreensFrom()`, pas « telle
   fonction a été appelée ». C'est ce qui rend ces tests insensibles aux refactos internes. Un
   scénario qui passe au vert **d'emblée** est un mauvais signe : il ne teste pas ce qu'on croit.
3. **Un mock qui ment est pire qu'un test manquant** — il rend vert pour la mauvaise raison.
4. **Rien ne se pousse en rouge** — `hooks/pre-push` lance les deux suites. **Il n'y a pas de CI** :
   ce hook est le seul filet automatique, et son activation est une config locale, jamais
   versionnée — cf. [architecture/tests.md](../../architecture/tests.md).
5. **Contrôle de harnais.** Après un correctif, neutraliser la ligne de production censée le porter
   et vérifier que les tests rougissent. C'est ce qui distingue un test qui épingle un invariant d'un
   test qui ne tient rien. Le contrôle apprend parfois quelque chose : quand deux mécanismes
   indépendants tiennent la même propriété, il faut les neutraliser tous les deux — et c'est à écrire
   dans le docblock du test.

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
pas encore ma room » : chez un arrivant, `usersInRoom` n'est écrit qu'après `waitForMeReady` (donc
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
- **`createMockContext._pushSignal` écrit dans `_signalQueue`** (un `ref` réassigné, donc réactif par
  changement d'identité) alors que `getQueueForRoom` lit `_signalQueueRooms` (objet nu, non réactif) :
  deux structures déconnectées. **Tout test de drain de file serait un faux positif** avant
  correction du mock.
- **`hasOpenConnection` ne peut pas servir de prédicat côté récepteur** : `usePeerTransport`
  n'enregistre **jamais** de connexion dans le store (aucun `prepareRoomConnection` /
  `storePeerConnection` dans tout le fichier ; seul `usePeerConnections._saveRoomConnection` en
  écrit, côté **initiateur**). Pour un appel one-way entrant, le récepteur se contente de
  `call.answer()` + `setUpConnectionListeners()`. Un correctif conditionné à ce prédicat est **inerte**
  côté récepteur — et son test vert uniquement parce que le mock fournit une information que le vrai
  store ne peut pas donner. C'est arrivé.
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
