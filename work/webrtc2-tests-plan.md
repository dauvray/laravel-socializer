# WebRTC2 — Plan de tests unitaires

> **Chantier ouvert.** Le harnais, ses invariants et les pièges de mock sont dans
> [`docs/modules/webrtc2/tests.md`](../docs/modules/webrtc2/tests.md) ; l'infra générale dans
> [`docs/architecture/tests.md`](../docs/architecture/tests.md). Ce fichier ne porte que
> l'avancement et les tâches restantes.

> Helpers : `withSetup`, `createMockContext`, `mockEventBus`, `__mocks__/peerjs.js`,
> `createVirtualPeer`, `bootLocalPeer`, `fakeSignalingServer`, `fakeMedia`.
> Commande : `npm run test:run` depuis la racine de l'hôte.

⚠️ **Ne jamais recopier un décompte ici** : ce document a déjà divergé du réel deux fois, dans les
deux sens — un total sous-évalué, puis onze fichiers existants absents de ses listes.

---

## Où en est la couverture

Les décomptes se relisent dans la sortie du runner : `npm run test:run`. Le recensement des
fichiers aussi — `find src/resources/js -path '*__tests__*' -name '*.test.js'` — et c'est la seule
liste qui ne mente pas, celle-ci ayant déjà ignoré onze fichiers existants.

Trois étages, dont le dernier est celui qui manquait : **unitaire** (`__tests__/*.test.js`,
`utils/`), **conformité** (`mockFidelity`, `peerjsMockFidelity.descriptors` — le mock n'est ni en
retard ni en avance sur le réel), **bout en bout** (`scenarios/` — deux pairs réels qui se parlent,
et le seul étage où les incendies du paquet étaient détectables). Le harnais et ses invariants :
[docs/modules/webrtc2/tests.md](../docs/modules/webrtc2/tests.md).

| Périmètre | État | Ce qui reste |
|---|---|---|
| `utils/` — FSM d'appel, retry, rate limiter, taille de payload, sanitisation, `fetchIceServers` | ✅ | — |
| Tâche 1 · `usePeerCore` — Ajax + signalisation pure | ✅ | — |
| Tâche 2 · `usePeerConnections` | ✅ | — |
| Tâche 3 · `usePeerMedia` — `.players` + `.streams` | ✅ | — |
| Tâche 4 · `usePeerTransport` — 8 fichiers (sécurité, `peer-unavailable`, singleton, mesh, **star**, reconnexion, `forwardStar`, `iceRefresh`) | ✅ | — |
| Tâche 5 · `createPeerContext` | ✅ | — |
| Tâche 6 · `usePeerOrchestrator` — 4 fichiers (`broadcastPresence`, **`callbacks`**, **`teardown`**, **`media`**) | ✅ | — (la branche **hub** du wrap `onDataReceived` est couverte depuis le 29/08, (a) l'ayant débloquée) |
| Tâche 7 · `useMediaBroadcast` — 2 fichiers (façade doublée, **surface** sur l'orchestrateur réel) | ✅ | — |
| Couches extraites de l'orchestrateur — `useConnectionPool`, `useCallManager`, `useStreamManager`, `useSignalingQueue` | ✅ | — |
| Store — `peers2Store` : runtime, observabilité, `remotePeerId`, **phase du Peer**, **registre des contextes** | ✅ | — |
| Composables d'UI — `useAwaitedStreams`, `useBroadcastPresence` | ✅ | — |
| Tâche 8 · **Composants** `Widgets/**` — 15 fichiers, **3** couverts (`MediaBroadcastPlayer`, `useAwaitedStreams`, `Debug`) | **ouverte** | 12 sans aucun test, dont 10 des 12 composants `.vue` ; c'est l'étage d'où venait le dernier 🔴. `Debug` n'est couvert que sur son bloc de corroboration d'identité (29/08) |
| Scénarios — smoke, `lateJoiner`, `broadcastLifecycle`, `peerDeparture`, `multiContext`, `incomingMappingInvariant`, `outgoingAuth`, `incomingSpoof` | ✅ | — |
| Perte de connexion → re-composition — `scenarios/peerDeparture` (« A recharge en chevauchement »), `useConnectionPool`, `createPeerContext` | ✅ | — |
| Hors WebRTC2 — `Chat/dateSeparatorRender`, `System/useReverbChannel` (dont le désabonnement de whisper par callback), `User/coverCallButton` | amorces | plan Chat : [chat-tests-plan.md](chat-tests-plan.md) |

✅ **La tâche 6 est fermée le 29/08/2026, sauf son cas star** — et le dégel a été confirmé par les
faits : le déménagement du routage star ne concernait bien qu'**un cas**, la branche hub du wrap
`onDataReceived`. Tout le reste a été écrit et n'asserte rien sur le routage star.

⚠️ **Ce que la passe a trouvé et que l'énoncé ne disait pas : il décrivait un fichier qui n'existe
plus.** Écrit avant l'extraction des couches, il visait un orchestrateur monolithique ; le fichier
réel fait 466 lignes et ne porte que la composition. Sept de ses cases étaient déjà vertes chez
`useConnectionPool`, `useStreamManager` et `useCallManager` — les rejouer aurait produit des
doublons. En revanche il **ne listait pas** ce qui restait vraiment : `toggleAudioState`,
`toggleVideoState` et `stopAudioStream` n'avaient aucun test nulle part. Le tableau de renvois est
dans la tâche 6 ci-dessous. La leçon valait pour la tâche 7, écrite le même jour : **relire le code
avant de croire l'énoncé.**

✅ **La tâche 7 est fermée le 29/08/2026, et la leçon a payé deux fois.** Son énoncé décrivait un
test « bout en bout » de flux d'appel là où le fichier est une façade : **huit de ses onze cases
étaient des doublons stricts**, trois n'étaient couvertes que par morceaux, et **la dixième était
fausse** — l'écrire aurait rougi contre un
comportement épinglé à l'envers par `useStreamManager.test.js`. Ce qui restait n'était dans aucune
case : la mémoire d'invitations, et le fait que trois wrappers jetaient la promesse d'un verbe
`async`. **Un énoncé périmé ne se contente pas de faire perdre du temps : il fait écrire un test
qui demande au code de régresser.** Le détail est dans la tâche 7 ci-dessous.

⚠️ **Ce qui reste vrai** : `useMediaBroadcast.watchUsers.test.js` (27/08/2026) mocke l'orchestrateur
en entier pour épingler le seul point d'entrée de la chaîne de présence — son en-tête explique
pourquoi, et cette contrainte-là n'a rien à voir avec le gel. Ce choix vaut pour toute assertion de
comportement sur la façade ; il a en revanche un prix, **mesuré** en fermant la tâche 7 : un double
définit la surface, donc aucun de ces fichiers ne peut voir un renommage en amont. D'où le second
fichier, `useMediaBroadcast.surface.test.js`, qui monte l'orchestrateur réel et ne fait que ça.

Les couches extraites se testent avec des `vi.fn()` pour les dépendances injectées — c'est tout
l'intérêt de l'injection descendante. `useCallManager` et `useStreamManager` n'enregistrent aucun
hook de lifecycle et s'appellent **directement**, sans `withSetup` ; `useConnectionPool` et
`useSignalingQueue` posent un `watch` + un `onUnmounted`, donc `withSetup` y est **obligatoire**.

### Un scénario ne peut pas faire tourner le moteur de retry (28/08/2026)

`settle()` draine les microtâches et les tâches à échéance 0, **jamais les minuteurs** — et
`vi.useFakeTimers()` est exclu en scénario (il gèlerait le faux serveur). Or une chaîne de retry se
réveille à `1000·2^0 + jitter` (≤ 1299 ms) et ne s'éteint qu'à ce réveil, même sur une connexion
établie depuis longtemps. Tout scénario qui vise un comportement du **régime établi** doit donc
attendre réellement (`await new Promise(r => setTimeout(r, 1500))`), sans quoi il court-circuite un
moteur qui aurait fait le travail — vert gratuit. Le piège symétrique, plus coûteux, est d'en
conclure que le garde du correctif est trop strict et de le retirer :
[tests.md](../docs/modules/webrtc2/tests.md) porte les deux versants.

### Démarrer un Peer dans un test : `helpers/bootLocalPeer.js` (29/08/2026)

Trois verbes, et le choix entre eux n'est pas cosmétique :

- **`bootLocalPeer(start, { peerId, getPeer })`** — le motif non-bloquant : lancer la création
  **sans l'attendre**, attendre que l'instance existe, puis émettre `'open'`. C'était un
  copier-coller entre `createVirtualPeer` et `usePeerOrchestrator.broadcastPresence.test.js`.
  ⚠️ `getPeer` est **obligatoire** après un `vi.resetModules()` : `_lastInstance` est un état de
  module du mock (contrairement au bus, qui vit sur `globalThis`), donc l'accesseur importé
  statiquement interrogerait l'ancienne copie et l'attente expirerait sur « Peer non créé ».
- **`seedReadyPeer(peerStore, peerId)`** — pour les tests qui ne construisent aucun `Peer` et
  semaient le seul `lastLocalPeerId`. Il parcourt le CHEMIN complet des transitions
  (`creating → connecting → ready`), et repasse par `absent` en cas de re-semis : un raccourci
  ferait journaliser un enchaînement que la production ne produit jamais.
- **`seedAbsentPeer(peerStore)`** — « je n'ai pas encore de peerId à publier ». Nettoie AUSSI
  `lastLocalPeerId`, sans quoi le semis décrirait une contradiction au lieu d'un état.

> ⚠️ **Ce que le contrôle négatif a montré, et qui contredit l'énoncé de l'item.** Commenter
> l'émission de `'open'` dans le helper fait rougir **tous les scénarios** — et **aucun cas** de
> `incomingAuth` ni de `peerUnavailable`, les deux fichiers qui ne l'émettaient jamais. Leur
> admission entrante ne consulte pas l'identité locale : l'`'open'` y est de la **fidélité**, pas
> un support d'assertion. Ne pas le retirer en concluant « il ne sert à rien ».

### Le canal de présence est livrable au harnais depuis le 28/08/2026

`helpers/createFakePresenceChannel.js` rejoue les **client events** d'un canal de présence, et
`createVirtualPeer({ id, reverb })` les livre à un onglet (un abonnement par onglet, partagé par ses
contextes — comme en production). Deux fidélités portent tout l'intérêt du double, et les défaire
rendrait vert un correctif faux :

- **l'émetteur ne reçoit pas son propre whisper** (Reverb exclut la connexion source) — sinon un
  diffuseur s'annoncerait à lui-même et le garde « pas mon propre slug » masquerait l'erreur ;
- **`metadata.user_id` vient du serveur, jamais de la charge utile**, comme sous
  `accept_client_events_from: 'members'`.

⚠️ **`connectRoom` livre désormais `id` ET `slug`**, parce que la production le fait
(`PresenceUser`). Un pair monté sans `id` laisse l'annuaire vide — état valide pour tout scénario qui
n'exerce pas les whispers, mais un test d'annonce y serait muet sans rien dire.

ℹ️ **Décision en attente côté Chat** : ce double est le candidat naturel au `mockEcho` partagé que
[chat-tests-plan.md](chat-tests-plan.md) laisse ouvert. Rien n'a été mutualisé — celui-ci n'imite que
les client events, pas `here`/`joining`/`leaving`, que le Chat exercera.

---

## Tâches restantes

### Tâche 1 — `usePeerCore.test.js` (Signaling layer) ✅

**Périmètre** : couche HTTP/Ajax pure, sans WebRTC.

- [✅] `requestRemotePeerConnection` : POST Ajax déclenché, `addWaitingRemotePeerId` appelé, throttling SIGNALING_STALE_MS (pas de 2e requête si `waiting` récent)
- [✅] `requestRemotePeerConnection` rate limiting `ASK_PEER_MAX_REQUESTS_PER_WINDOW` / `ASK_PEER_RATE_WINDOW_MS` : plafond par cible, discrimination slug **et** `connectionType`, reprise après la fenêtre, un POST en échec consomme un jeton, le garde `waiting` sorti en amont n'en consomme aucun. ⚠️ Les tests passent par `invalidateRemotePeerId` (chemin réel du `peer-unavailable`) : sans cette purge c'est le garde `waiting` qui sort en premier et ils verdissent pour la mauvaise raison. ⚠️ `askPeerRateLimiter.reset()` obligatoire en `beforeEach` — état module-level + `Date.now()` gelé par les fake timers
- [✅] `responseRemotePeerConnection` : POST avec `peerId` local correct, garde d'identité publiable — `peerIdentity().state !== 'ready'` ⇒ aucun POST, `false` —, booléen de retour
- [✅] `requestAuthorizationRemotePeerId` : envoi immédiat + retry via `inviteRetryManager`, retourne un `inviteId`
- [✅] `sendAuthorizationRemotePeerId` : envoi avec `status: true` (inclut peerId) vs `status: false` (type seulement)
- [✅] `notifyCloseConnectionToPeer` : POST avec room/type/fromUserSlug, les **trois** étages de repli de `room`, le repli de `type` sur le littéral `'visio'` (et non le type du contexte), les deux sorties anticipées, et le retour `undefined` sur échec. ⚠️ Le cas « aucune room » exige d'annuler `currentCallRoomId` **et** `currentRoom` : le double pose `'app'` sur le second
- [✅] ~~Signal watcher~~ : déplacé dans `useSignalingQueue.test.js` (le routage ne vit plus ici)
- [✅] `stopCallInviteRetry` / `stopCallInviteRetryForUser` / `clearAllCallInviteRetries` : cancellent les retries correspondants, avec la contre-épreuve de l'`inviteId` inconnu (sans elle, un `clearAll()` déguisé passerait). **A révélé un défaut réel**, désormais épinglé : la clé de minuteur porte `currentType`/`currentRoom`, donc un changement de room entre invitation et annulation fait survivre la MAUVAISE chaîne — voir le 🟠 de [webrtc2-todo.md](webrtc2-todo.md)
- [✅] Limite `MAX_INVITE_RETRIES` : la plus ancienne entrée est évincée quand la Map est pleine *(couvert dans requestAuthorizationRemotePeerId)*
- [✅] `onUnmounted` : inviteRetryManager vidé — écrit comme **filet structurel**, et son contrôle négatif est mesuré dans le docblock : neutraliser le seul hook de `usePeerCore` laisse le cas VERT (`usePeerRetry` enregistre le sien avant), il faut neutraliser **les deux**. Le seul effet exclusif du hook, `userSlugToInviteId.clear()`, n'est observable que hors production — pas de cas écrit dessus

**Prérequis** : `createMockContext()` suffit (AjaxService injecté via ctx) ; `vi.useFakeTimers()` pour les retries.

---

### Tâche 2 — `usePeerConnections.test.js` ✅

Périmètre couvert. Le détail est dans l'en-tête du fichier de test ; les pièges de mock qu'il a
révélés sont dans [docs/modules/webrtc2/tests.md](../docs/modules/webrtc2/tests.md#pièges-de-mock).

### Tâche 3 — `usePeerMedia.*.test.js` ✅

Périmètre couvert, en deux fichiers : `.players` (pool d'instances) et `.streams` (flux locaux et
fin de vie d'un flux). Ses deux pièges de harnais — les `vi.fn()` globaux non réinitialisés, le flux
factice qui est un objet nu — sont dans
[docs/modules/webrtc2/tests.md](../docs/modules/webrtc2/tests.md#pièges-de-mock).

### Tâche 4 — `usePeerTransport.*.test.js` (Peer singleton + DataChannel)

**Périmètre** : singleton PeerJS, envoi de données, topologie, **et durcissement sécurité** (auth entrante, anti-usurpation, limites de taille/débit). Découpée en plusieurs fichiers par surface.

> ⚠️ **Mise à jour 2026-05-27** : le composant a reçu 5 commits sécurité. Note importante sur l'item « sendData star » : **le hub envoie en direct** (`conn.send(data)`, sans enveloppe) ; c'est le **client** qui construit l'enveloppe `__starRoute`. L'ancienne formulation « hub construit l'enveloppe » était fausse.

#### ✅ Déjà couvert (6 fichiers, 56 tests)

- [✅] **`usePeerTransport.incomingAuth.test.js`** (15) — `_isAuthorizedIncomingPeer` :
  - accepte/rejette une connexion data selon l'appartenance à `remotePeers`
  - rejette `from` absent / format de slug invalide
  - anti-usurpation : rejet si peerId réel mappé ≠ `from` déclaré ; accepte si concordance
  - répond/rejette un appel one-way selon l'auth
  - accepte connexion data **et** appel visio d'un interlocuteur d'appel direct (`session.currentCallUsers`) hors room
- [✅] **`usePeerTransport.forwardStar.test.js`** (5) — `forwardStarMessage`, validation `envelope.to` :
  - retransmet uniquement aux membres ciblés présents dans la room
  - ignore slugs hors room / format invalide ; exclut toujours l'expéditeur ; diffuse à tous si `to` absent
- [✅] **`usePeerTransport.mesh.test.js`** (10) — `sendData` mesh + limite de taille payload :
  - diffuse un payload dans la limite à tous les membres
  - rejette payload JSON / binaire (ArrayBuffer) > `MAX_PAYLOAD_BYTES`, accepte pile à la limite
  - rejette payload non sérialisable ; applique la limite aussi avec `destUserSlugs` explicite
- [✅] **`usePeerTransport.peerUnavailable.test.js`** (9) — recovery du peerId mort :
  - ignore les autres types d'erreur PeerJS et les peerId inconnus
  - retire la connexion échouée, conserve celles pointant sur un autre peerId
  - invalide le mapping **même** si le pair reste connecté dans une autre room (le bug du 2026-08-13), et même si aucune instance n'a été stockée ; positionne `peerUnavailableSignal`
- [✅] **`usePeerTransport.singleton.test.js`** (35) — cycle de vie du Peer singleton :
  - création, phase `ready` seulement sur `'open'`, garde d'init (2 contextes simultanés = 1 seul Peer), peer prêt réutilisé
  - 🔥 **la fenêtre asynchrone entre les deux gardes, désormais FERMÉE par construction** : `peerInitPromise` retombait au `new Peer`, donc au milieu de la fenêtre qu'elle prétendait garder, et `'open'` n'était pas arrivé. C'est la séquence NOMINALE de production (`data-app` au tick 0, `stream-<room>` après résolution de route), et le trou de couverture qui a laissé passer la régression du 2026-08-14. Le cas est **retourné, pas supprimé** : il vérifie maintenant que la promesse est toujours posée dans cette fenêtre, que le second appelant reçoit **la même attente** (et non un `undefined` immédiat), et que la garde d'instance tient toujours en ceinture
  - **l'invariant « une seule instance de Peer par onglet »**, énoncé une fois pour les quatre fenêtres de montage (même tick / récupération ICE en vol / Peer construit sans `'open'` / `'open'` reçu). Les tests voisins en sont des cas particuliers : c'est **ici** qu'on vérifie que les quatre gardes tiennent encore après un remaniement
  - **l'init ne se termine qu'à l'`'open'`** (2026-08-29, 5 cas + 7 neutralisations mesurées) : elle ne se règle pas avant ; une erreur autre que `peer-unavailable` la conclut en échec sans rien laisser derrière ; un `peer-unavailable` ne conclut **rien** ; le délai `PEER_OPEN_TIMEOUT_MS` abandonne **et détruit**, et la session repart ; une init supplantée qui expire ne touche pas le Peer courant (les deux gardes d'identité, celle du `.catch` et celle du minuteur)
  - ref-counting : destruction **différée** de `PEER_DESTROY_DELAY_MS`, **annulée** si un consommateur remonte, peer conservé tant qu'un autre consommateur est monté
  - `_destroyPeerSingleton` : cas nominal (reset complet du store) **et** cas `localPeer` déjà absent (échec d'init : ni crash ni destruction)
  - intégration sur le **vrai** store Pinia (le mock garantit la surface, pas la sémantique)
  - **HMR** : le peer partagé survit au démontage d'un consommateur enregistré par une autre copie du module ; une seule instance créée quand une init est en vol au moment du rechargement (+ un contrôle de harnais, sinon ces deux tests seraient verts pour rien)
  - **détachement des listeners** : chaque `peer.on` a son `peer.off` par identité et **tous avant `destroy()`** (filet structurel : un 6e listener branché hors du helper `bind` casse ce test) ; un `error` livré après la destruction ne loggue plus rien (seul événement réellement livrable ensuite, cf. `retrieveId` `bundler.mjs:1564`) ; un `open` tardif ne ressuscite pas un peer fantôme (**invariant**, pas repro — `socket._cleanup()` met `onmessage = null` avant, l.731) ; aucun détachement croisé entre deux Peer successifs
- [✅] **`usePeerTransport.reconnect.test.js`** (8) — garde de reconnexion :
  - backoff exponentiel (1s·2s·4s·8s·16s) plafonné à `RECONNECT_MAX_DELAY_MS`, abandon après `MAX_RECONNECT_ATTEMPTS` sans boucler
  - compteur remis à zéro sur `'open'` ; aucune tentative sur un peer détruit
  - un backoff armé pendant le délai de grâce ne survit pas à la destruction (aucun timer résiduel)
  - une **destruction volontaire n'est pas une coupure réseau** : ni tentative consommée, ni `warn` de reconnexion, ni fausse alerte `abandon` au plafond. `destroy()` émet `disconnected` avant de poser son drapeau (`bundler.mjs:1810` / `:1781`) — sans détachement explicite, le garde `localPeer.destroyed` du handler ne voit rien

#### ✅ Fermé le 29/08/2026 — les quatre derniers items

- [✅] **`usePeerTransport.star.test.js`** (14) — `sendData` en star, des deux côtés : le client emballe et n'adresse **que** le hub (enveloppe assertée entière), le hub envoie les données **nues**, `hubSlug` vide fait sortir en silence (aucun envoi, **aucun warn**). Deux faits y sont **épinglés**, pas corrigés :
  - ⭐ **`destUserSlugs = []` veut dire « personne »** — `[]` est *truthy*, il traverse les deux replis `|| …` et produit un fan-out nul. Le correctif tentant (`?.length ? … : null`) inverserait la sémantique sans lever. L'énoncé de cet item, qui annonçait `to: null`, était **faux**.
  - **Aucun contrôle de `MAX_PAYLOAD_BYTES` sur les deux branches star**, là où le mesh contrôle. Voir le 🟢 de [webrtc2-todo.md](webrtc2-todo.md). Contrôle négatif **inversé** : il faut *ajouter* le contrôle pour voir le rouge, et `mesh.test.js` reste vert.
- [✅] `forwardStarMessage` rate limiting — le **câblage** (la mécanique reste dans `utils/createRateLimiter.test.js`) : deux `from` déclarés différents depuis la **même** connexion partagent le quota ; deux connexions déclarant le **même** `from` ne partagent rien ; et un message rejeté pour sa **taille** a quand même consommé un jeton — seul cas du module dont la couleur dépend de l'**ordre** des gardes, et il exige d'asserter le *texte* du warn
- [✅] `forwardStarMessage` limite de taille payload : JSON et binaire au-delà, binaire **pile** à la limite (accepté), et enveloppe **sans `payload`** — la seule forme d'invalidité atteignable en production. ⚠️ Messages **sans accent** sur ce chemin (`Enveloppe star ignoree`), le hub n'appelant pas `isPayloadWithinLimit`
- [✅] Purge throttlée des expéditeurs inactifs (pas de fuite mémoire sur rotation de room) — logique déplacée de `_sweepHubRateWindows` vers `utils/createRateLimiter.js`, couverte par `utils/createRateLimiter.test.js`
- [✅] `contextRegistry` — **deux versants, tous deux obligatoires** : la sémantique sur le vrai store (`peers2Store.contextRegistry.test.js`, 12 cas — dont le `markRaw`, sans lequel `get() === ctx` est faux et le garde d'identité ne supprime plus rien), et le câblage dans `usePeerTransport.singleton.test.js` (inscription à `setLocalPeer`, retrait à l'`onUnmounted` **et** par `unregisterLocalContext`, remontage sous le même id, pas de fuite). Le double porte les deux mêmes gardes : un test écrit contre lui seul serait resté vert

**Prérequis** : `getLastPeerInstance()` + `resetPeerMock()` + `instance._triggerEvent('open', 'peer-id')` de `__mocks__/peerjs.js` ; **tout démarrage passe par `helpers/bootLocalPeer.js`** — l'init ne se règle plus avant l'`'open'`, donc un `await setLocalPeer()` sans `'open'` interbloque, et sous `vi.useFakeTimers()` il faut `waitForInstance: waitForPeerInstance` (cf. [tests.md](../docs/modules/webrtc2/tests.md)) ; `vi.useFakeTimers()` pour le délai de destruction et le backoff de reconnexion ; `vi.resetModules()` entre les tests pour réinitialiser ce qui reste au niveau du module (`contextRegistry`, `_hubRateLimiter`) — **le mock PeerJS doit être ré-importé après le même reset**, sinon `getLastPeerInstance()` ne voit pas les instances créées par la copie sous test. L'état du Peer singleton (ref-counting, garde d'init, reconnexion) vit désormais dans `peerStore` : une Pinia fraîche (posée par `setup.js`) ou un `ctx` neuf suffit à l'isoler.

---

### Tâche 5 — `createPeerContext.test.js` ✅

Périmètre couvert. Deux contraintes de harnais à ne pas défaire : `withSetup` est **obligatoire**
(`inject`, `onBeforeMount`, `onUnmounted`), et **on ne mocke pas ses quatre imports** — contrairement
à ce que ce plan prévoyait : `peers2`, `me` et `server` sont de vrais stores Pinia, et les doubler
ferait passer le test à côté de ce qu'il croit exercer.

### Tâche 6 — `usePeerOrchestrator.*.test.js` ✅ (fermée le 29/08/2026, cas star compris)

**Périmètre RÉEL** : la composition, et rien d'autre. ⚠️ L'énoncé de cette tâche a été écrit avant
l'extraction des couches et décrivait un fichier qui n'existe plus — **988 lignes juste avant
l'extraction (`2aa4a8b~1`), 466 aujourd'hui**, dont ~180 de commentaires. Les cases visant
`syncUsersConnections`, `requestOrConnectPeer`,
les deux `handleStream*`, `stopCallWithPeers`, le garde `isShuttingDown` et le watcher
`peerUnavailableSignal` **ont déménagé avec le code** — elles sont vertes chez leur nouveau
propriétaire, et les rejouer ici n'aurait produit que des doublons. Le tableau de renvois est plus bas.

Quatre fichiers, écrits le 29/08/2026 pour les trois derniers :

- [✅] **`.broadcastPresence`** (27/08) — le câblage de l'annonce de diffusion, ses trois chemins
- [✅] **`.callbacks`** — le stockage des callbacks (dont le **write-once par clé** de
  `storeConnectionEventCallbacks` : une seconde initialisation garde silencieusement les premiers),
  le wrap `onStreamReceived` (chaîné **et attendu**), le wrap `onConnectionClose` limité à
  `type === 'stream'` avec son garde « ma connexion sortante ne purge rien », et la normalisation
  type/room
- [✅] **`.teardown`** — `cleanupPeerConnection` : garde **permanent** (aucun `endShutdown`),
  signalisation coupée, whispers de présence coupés, demandes de peerId purgées **par contexte**
  (le cas que `closePeerConnection` ne peut pas couvrir, son early-return l'en empêchant), room
  d'appel privilégiée, players détruits, contexte retiré du registre
- [✅] **`.media`** — fan-out des trois démarrages de flux, arrêt **natif** du partage d'écran et son
  garde de ré-entrée, `try/finally` de `stopWebcamStream` (y compris quand une étape lève), les deux
  asymétries de `clearSignalQueue`, le type `'screen'` en dur, les deux bascules, `sendDataToPeer`

- [✅] **Le dernier cas, écrit le 29/08/2026** dans la foulée de (a) — describe « branche hub du wrap
  `onDataReceived` » de `.broadcastPresence`. **Trois cas et non un** : la retransmission + la
  remontée du payload en arité 1 ; une annonce de diffusion retransmise QUI NE REMONTE PAS à l'app ;
  et le fall-through, une enveloppe reçue hors du cas hub livrée telle quelle en arité 3 — ce
  dernier est le seul à épingler le prédicat de topologie, et sans lui un routeur qui déballerait
  sur le seul marqueur `__starRoute` resterait vert.

  ⚠️ **Trois préparations, chacune nécessaire** : un contexte `star` dont le hub est moi ; `isHub`
  **résolu** — il vaut `null` au montage et n'est écrit que par `waitForMeReady`, qu'un tour de
  synchronisation sur une liste **vide** déclenche sans rien ouvrir ; et une connexion sortante
  **semée** vers un tiers (`prepareRoomConnection` puis `storePeerConnection`, la paire de la
  production), car **les connexions entrantes ne sont pas enregistrées dans le store** — le
  dispatcher n'y branche que ses listeners. Sans la troisième, le hub n'a personne à qui
  retransmettre et le cas est vert par vacuité.

**Deux replis du prédicat de fermeture ne sont PAS couverts, et c'est écrit dans l'en-tête du
fichier** : `!senderSlug` (une connexion sans `metadata.from` est refusée en amont, ses listeners ne
sont jamais branchés) et `!mySlug` (sans identité locale, `handleStreamRemoved` suspend sur
`waitForMeReady` jusqu'au timeout). Gardes défensifs, pas des chemins.

#### Où sont parties les cases de l'énoncé d'origine

| Case | Couverte par |
|---|---|
| `syncUsersConnections` mesh / star hub / star client | `useConnectionPool.test.js` § `syncUsersConnections` |
| `_requestOrConnectPeer` (nom réel : `requestOrConnectPeer`) | `useConnectionPool.test.js` § `requestOrConnectPeer` + § logique de tentative |
| `syncUsersConnections` lock | `useConnectionPool.test.js` — et pas sous le contrat prévu ici : le verrou ne sérialise pas, il **coalesce** |
| `handleStreamReceived` (stream vs visio, clé `slug-type`, RECEIVING→CONNECTED) | `useStreamManager.test.js` |
| `handleStreamRemoved` | `useStreamManager.test.js` |
| `stopCallWithPeers` `full` / `partial` | `useCallManager.test.js` § `stopCallWithPeers` |
| garde `isShuttingDown`, watcher `peerUnavailableSignal` | `useConnectionPool.test.js` § recovery + § cleanup |
| `onUnmounted` (watcher stoppé, retries vidés) | `useConnectionPool.test.js` § cleanup |

**Prérequis — l'énoncé se trompait aussi là-dessus.** Il annonçait `vi.mock` sur les quatre
sous-modules : c'est le mauvais choix, les dix sont des imports ESM statiques appelés dans le corps
du composable, sans injection. Les quatre fichiers montent **contexte, stores et couches réels** et
ne mockent que PeerJS — même réfutation que la tâche 5 pour `createPeerContext`. Horloge réelle,
`installFakeMedia()` obligatoire dès qu'un flux est en jeu.

**28 contre-épreuves mesurées** et consignées dans les trois en-têtes. Quatre ont rougi **zéro** cas
au premier passage, et les quatre fois la faute était dans le test : la leçon générale — un périmètre
à un seul élément ne distingue pas « cible précise » de « tout le monde » — est remontée dans
[docs/modules/webrtc2/tests.md](../docs/modules/webrtc2/tests.md#ce-quil-faut-savoir-avant-décrire).

---

### Tâche 7 — `useMediaBroadcast` ✅ (fermée le 29/08/2026, en deux fichiers)

**Périmètre RÉEL** : ce que la façade possède en propre, et rien d'autre.

⚠️ **L'énoncé de cette tâche décrivait un test qui n'avait pas lieu d'être** — écrit le même
jour que celui de la tâche 6, il a reproduit la même erreur en pire. Il annonçait un test
« bout en bout » des flux d'appel ; or `useMediaBroadcast` n'écrit aucun de ces flux. Sur ses
288 lignes, ~110 sont une déstructuration de `usePeerOrchestrator`, ~90 un `return` qui la
ré-expose, 11 wrappers d'une ligne. Les sept verbes d'appel et de flux qu'il voulait tester
sont des **passthroughs verbatim** : les asserter ici testerait une identité de référence.
Décompte exact : **huit de ses onze cases étaient des doublons stricts** de cas existants
(`useCallManager`, `useStreamManager`, `useConnectionPool`), et **trois n'étaient couvertes
que par morceaux** — les deux flux d'appel complets et la jonction RECEIVING→CONNECTED d'un
flux visio, qui n'était affirmée d'un bout à l'autre par aucun cas unique.

⚠️ **Et sa case 10 était FAUSSE.** « `handleStreamRemoved` supprime le videoElement » : elle
ne supprime plus rien depuis l'extraction des couches, ce qui est épinglé **à l'envers** par
`useStreamManager.test.js` (« ne nettoie plus rien elle-même : le registre et les players sont
du ressort du CallManager »). L'écrire telle quelle aurait produit un test rouge contre le
code voulu — et, pire, une « correction » du code pour le faire passer.

Deux fichiers écrits, et la séparation n'est pas cosmétique :

- [✅] **`useMediaBroadcast.test.js`** — orchestrateur doublé en entier. La **mémoire
  d'invitations** (`isInviteDuplicate` / `clearSeenInvites`), seule vraie logique du fichier
  et **absente des 11 cases de l'énoncé** ; le contrat de renommage des 11 wrappers, avec
  l'assertion négative sur les dix autres verbes qui seule rend un câblage croisé visible ;
  le défaut `destUserSlugs = null` de `sendData` ; et l'attendabilité des trois démarrages
  de flux.
- [✅] **`useMediaBroadcast.surface.test.js`** — orchestrateur RÉEL, seul PeerJS mocké. Le
  contrat façade ↔ orchestrateur : rien d'exposé n'est `undefined`, et les états restent des
  refs. **Mesuré** : renommer `remotePeers` en `peers` dans le `return` de l'orchestrateur ne
  rougit QUE ce fichier — les deux autres doublent l'orchestrateur, donc le renommage n'existe
  pas pour eux. Sans ce fichier, la clé disparaîtrait de la façade sans qu'un seul des cas de
  la suite ne bouge.

**Un cas neuf ailleurs** : les points 4 et 5 de l'énoncé (les deux flux d'appel complets)
étaient couverts transition par transition, mais toujours depuis un état POSÉ à la main. Deux
cas d'enchaînement les jouent d'un bloc — `useCallManager.test.js` § `le cycle complet`, leur
place naturelle.

**Volet code, deux sorties de la doctrine** — `getWebcamStream` / `getAudioStream` /
`startCapture` appelaient des verbes `async` **sans `return`** (sortie A : la promesse est
rendue à l'appelant, sinon un refus de permission caméra part en rejet non traité) ; et
`contextId` était déstructuré sans jamais être ré-exporté (sortie B). La moitié UI du premier
— traiter le refus côté bouton — est un item de [webrtc2-todo.md](webrtc2-todo.md), bloqué par
l'absence de test de l'étage `Widgets/**`.

#### Où sont parties les cases de l'énoncé d'origine

| Case | Couverte par |
|---|---|
| lifecycle data channel (init → sync → cleanup) | `usePeerOrchestrator.callbacks.test.js` (init), `useConnectionPool.test.js` (sync), `usePeerOrchestrator.teardown.test.js` (cleanup), et les scénarios pour la séquence |
| `sendDataToPeer` → `transport.sendData` | `usePeerOrchestrator.media.test.js` § `sendDataToPeer`, `usePeerTransport.mesh/star` |
| `onDataReceived` exécuté à l'arrivée | `createPeerContext.test.js` § réception de données, `usePeerOrchestrator.broadcastPresence.test.js` |
| flux initiateur / récepteur complets | `useCallManager.test.js` § **`le cycle complet`** (neuf), + chaque transition isolément |
| refus d'appel (`status: false`) | `useCallManager.test.js` § `acceptCallFromPeer` — doublon strict de l'énoncé |
| `remoteStopCall` (stream, videoElement, `close-call`) | `useCallManager.test.js` § `remoteStopCall` — les trois assertions demandées, à l'identique |
| `handleStreamReceived` modes `stream` / `visio` | `useStreamManager.test.js` + `usePeerOrchestrator.callbacks.test.js` (`remoteStreams` 0→1) |
| `handleStreamRemoved` | `useStreamManager.test.js` — **et l'énoncé est périmé**, voir ci-dessus |
| `close-call` avec le bon payload | `useCallManager.test.js` (3 fois) |

⚠️ **La case `close-call` a failli être écrite contre un module mort.** `EventBus/webrtc2Events.js`
normalise un payload à six champs que **personne n'émet** : la production émet la forme brute à
deux (`useCallManager.js`), et le module n'est importé nulle part. Sa suppression est déjà un item
de [doc-rustines.md](doc-rustines.md) (lot 1) — re-confirmée au grep le 29/08, ne pas en ouvrir un
second.

---

### Tâche 8 — les composants `Widgets/**` (étage de présentation)

**Ouverte, ajoutée le 29/08/2026** au point d'étape QA. Ce n'est **pas** un reste des tâches 6 et 7
— celles-ci visent `usePeerOrchestrator` et `useMediaBroadcast`, des composables. C'est un étage de
plus, et il n'était au plan d'aucune tâche.

**Le constat, mesuré** : 15 fichiers sous `Widgets/`, **3 couverts** (`MediaBroadcastPlayer` par
`identity` + `spinner`, `useAwaitedStreams`, et `Debug` depuis le 29/08 par
`Debug.attestation.test.js`). Restent 12, dont **10 des 12 composants `.vue`** :
`MediaBroadcastProvider`, `PlayerHost`, `LocalMediaPlayer`, `RemoteMediaPlayer`, les cinq boutons de
`UI/Buttons/`, `SpectrumAnalyzer` — plus `useMediaControls` et `useRemotePeerState`.

> ℹ️ **`Debug` a été couvert par la bande, en fermant la mesure de bascule d'`enforce`** — et
> seulement sur son bloc de corroboration d'identité, pas sur le reste du panneau. C'est le bon
> précédent de montage (`mount` + store Pinia semé, `data-role` pour cibler), pas la fin de la tâche.

**Pourquoi ça compte, et ce n'est pas une question de pourcentage** : le dernier 🔴 du module — la
vignette d'attente effondrée à 0 px, `.draggable-video` sans `<video>` — vivait exactement là. Il a
été trouvé par une mesure Playwright manuelle et par une relecture de capture, jamais par la suite,
qui était verte pendant toute sa durée de vie. Un module dont la logique est couverte à 1141 cas
peut afficher un écran vide sans qu'un seul test bouge.

⚠️ **Le piège de vérification est déjà payé, ne pas le re-payer** : `isVisible()` de Playwright rend
**`true`** sur un élément clippé par un ancêtre (boîte non vide, `visibility:visible`, `opacity:1`).
Un test qui s'y fierait serait vert sur une vignette invisible. Ce qui tranche est la **géométrie
comparée à celle de l'ancêtre**, ou une capture relue — et il faut un **run de contrôle** sans le
correctif, sans quoi une page sans aucune CSS donne la même valeur aux deux runs et se lit comme
« le correctif ne sert à rien » (mesuré le 28/08 : `setContent()` part d'`about:blank` et n'y charge
aucun `<link href="file://">`).

**À trancher avant d'écrire** : `@vue/test-utils` (déjà employé par les deux tests de
`MediaBroadcastPlayer`) suffit pour le câblage props/emits/rendu conditionnel, mais **ne dit rien de
la mise en page** — c'est-à-dire de la classe de défaut qui a produit le 🔴. Les deux étages sont
donc complémentaires, et l'item ne sera pas fini par le premier seul.
