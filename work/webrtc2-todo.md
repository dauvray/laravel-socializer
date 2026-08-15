# WebRTC2 — Todo

> Chantier ouvert. Les items **terminés** ont été élagués : leur rationale durable est dans
> [`docs/modules/webrtc2/`](../docs/modules/webrtc2/INDEX.md), leur récit dans `git log`.
> Sécurité : voir [webrtc2-securite-2026-08-14.md](webrtc2-securite-2026-08-14.md).
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

## usePeerTransport

- [ ] **`peerInitPromise` devrait couvrir jusqu'à `'open'`** `[M]`
  Le garde d'instance ferme la fenêtre, mais le fond du problème reste : « init terminée » ne
  signifie pas « peer utilisable ». Faire de `_doInit` une promesse qui `await` réellement
  l'événement `'open'` (avec rejet sur `error` et timeout) rendrait la sémantique honnête et
  permettrait aux appelants de s'y raccrocher — notamment `useCallManager`, dont le
  `const ready = transport.setLocalPeer(); if (!ready) return` a été retiré comme garde mort.
  ⚠️ **Écarté de la passe de régression** : une vingtaine de tests font `await api.setLocalPeer()`
  **avant** de déclencher `'open'` et se bloqueraient. C'est une refonte du harnais autant que du code.

- [ ] **peerId fantôme après un `destroy()` précoce** `[M]`
  `new Peer({ host, … })` passe un objet d'options en 1er argument, donc `userId` est `undefined`
  (`bundler.mjs:1517`) et PeerJS résout l'id par HTTP. Or son
  `retrieveId().then(id => this._initialize(id))` (l.1564) **n'a aucun garde `destroyed`**, et
  `Socket.start()` (l.650) ne refuse que si `!!this._socket || !this._disconnected`. Après un
  `destroy()` survenu avant la résolution, `_socket` est `undefined` et `_disconnected` est `true` :
  les deux conditions passent, un **vrai WebSocket + un heartbeat 5 s** s'ouvrent et enregistrent un
  peerId côté serveur, **invisible du `Peer`** puisque ses listeners socket ont été retirés par
  `_cleanup()`.
  ⚠️ **Aucun `peer.off()` ne le corrige** : il faut un garde côté appelant (ne pas initialiser un
  peer déjà détruit) ou renoncer à la résolution HTTP en fournissant nous-mêmes l'id.

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
