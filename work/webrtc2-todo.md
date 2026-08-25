# WebRTC2 — Todo

> Chantier ouvert. Les items **terminés** ont été élagués : leur rationale durable est dans
> [`docs/modules/webrtc2/`](../docs/modules/webrtc2/INDEX.md), leur récit dans `git log`.
> Sécurité : le chantier d'audit d'août 2026 est **clos**, son durable est dans
> [`docs/modules/webrtc2/securite.md`](../docs/modules/webrtc2/securite.md) ; la seule borne qu'il
> laisse ouverte est reprise ci-dessous.
> Tests : voir [webrtc2-tests-plan.md](webrtc2-tests-plan.md).
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

## Rafraîchir le credential TURN avant son expiration `[M]`

🟡 Seul reste du chantier de sécurité d'août 2026 (tâche D3). **Ne bloque rien** : la borne qu'elle
ferme est assumée et écrite dans
[`securite.md`](../docs/modules/webrtc2/securite.md#bornes-non-fermées-connues).

**Le problème, mesuré en livrant les credentials éphémères.** Le navigateur ne demande la
configuration ICE qu'**une fois par cycle de vie du `Peer`**, et le `Peer` est un singleton d'onglet
que rien ne détruit tant que la coquille SPA vit (contexte permanent `data-app` monté au tick 0 ;
`PEER_DESTROY_DELAY_MS` ne se déclenche qu'au départ du **dernier** consommateur ;
`peer.reconnect()` réutilise la même instance, donc le même `_options.config`). Passé le TTL de
24 h, l'appel en cours tient — coturn a déjà sa clé de session — mais **toute nouvelle allocation
échoue** : nouvel appel, ICE restart, nouveau flux. Symptôme : « la visio ne passe plus, un F5 la
répare ».

**Le mécanisme est repéré, et il est petit.** `peerjs/dist/bundler.mjs` fait
`new RTCPeerConnection(this.connection.provider.options.config)` — relu à **chaque** connexion — et
`options` est un getter vivant sur `_options`. Réécrire `peerStore.localPeer.options.config` suffit
donc pour toutes les connexions futures, sans `setConfiguration()` ni chirurgie sur les connexions
ouvertes.

Tout le coût est dans trois arbitrages :

- [ ] **Le déclencheur** — timer aligné sur le TTL, ou paresseux avant chaque `connectToPeer` ? Le
      paresseux ne dépend d'aucune horloge et ne travaille que si l'on appelle, mais il ajoute un
      `await` sur un chemin d'appel. ⚠️ **Insérer un `await` dans une séquence synchrone crée un
      état intermédiaire observable, et tout ce qui LIT cet état doit être réexaminé**, pas
      seulement ce qui l'écrit : c'est ce qu'a coûté le passage de la config ICE en HTTP (un
      `localPeer` nul alors que `peerInitPromise` était posée, dans lequel le timer de destruction
      différée faisait naître un `Peer` **orphelin** hors d'atteinte de toute destruction). Ici
      l'état en question est celui d'un `Peer` déjà vivant.
- [ ] **`options.config` est un interne PeerJS non contractuel** — à épingler par un test qui casse
      si une mise à jour de PeerJS le renomme, faute de quoi le rafraîchissement deviendra muet.
- [ ] **La réouverture de la question du `throttle`**, énoncée dans `routes.public.php` : si le TTL
      descend à l'échelle de l'heure, la route est re-appelée et le plafond redevient un sujet —
      bucket dédié rendant `Limit::none()` pour l'invité, jamais une clé IP.

**Tests :** le credential est re-demandé après expiration simulée · une connexion ouverte n'est pas
perturbée · `options.config` existe toujours (garde anti-renommage).
**Commit :** `secu(socializer): rafraichir le credential TURN avant expiration`

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
  existe déjà à `createVirtualPeer.js:133-147` (dupliqué dans
  `usePeerOrchestrator.broadcastPresence.test.js:46-52`). Et `useCallManager.test.js:45-51` +
  `:81-89` sont la spécification de surface à renégocier, pas des dommages collatéraux.

- [ ] **Le bail des peerId distants** `[M]`
  `remotePeersId` est indexé sur le slug, global à l'onglet, et **sans contrat
  d'invalidation** : seul `isUserInAnyRoom` autorise à oublier une entrée. Un pair qui recharge
  sa page obtient un peerId neuf ; l'ancien reste dans le store de tous les autres, qui lui
  envoient des offres expirant en `peer-unavailable` — c'est la signature exacte du
  « Could not connect to peer &lt;uuid&gt; » signalé.

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
  supprimerait le mutex `_diffLock` devenu inutile et rendrait la liste réactive dans les composants.
  Dépend du renommage ci-dessus.
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

Les deux autres patterns de la liste d'origine (`createBoundedMap`, `CALL_STATES`) sont **déjà
implémentés** — éviction LRU de `remoteStreamsMap` et `utils/useCallStateMachine.js` — et ont été
retirés d'ici.

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
