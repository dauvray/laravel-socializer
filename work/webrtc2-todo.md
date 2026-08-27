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
> **Deux verrous sont fermés** (27/08/2026) : `syncUsersConnections` coalesce au lieu de jeter la
> composition reçue, et le tour sur liste vide purge sans déclarer la présence connue. Les deux
> invariants vivent dans
> [architecture.md § Conventions de code](../docs/modules/webrtc2/architecture.md#conventions-de-code).
> Ce qui suit ne s'en déduit pas : un tour qui a bien lieu peut encore ne rien voir.
- [ ] **Le diff de présence ne voit pas un départ+retour coalescés** `[M]`
  `usePeerConnections.js:45-46` : si `member_removed` et `member_added` tombent dans le même flush
  Vue, le slug est dans `previousSlugs` **et** `nextSlugs` — `removedUsers` et `newUsers` sont donc
  tous deux vides. Rien ne purge, rien ne recompose : le contexte ne fait **rien du tout** du
  rechargement d'un pair. C'est le trou que le bail borne côté composition.
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
