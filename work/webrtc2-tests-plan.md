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
| Tâche 8 · **Composants** `Widgets/**` — 15 fichiers, **12** couverts | 🟠 **lots A, B, V faits le 30/08 · lots C et D faits le 31/08** | restent 3 fichiers, en deux lots : **E** `LocalMediaPlayer` + `MediaBroadcastProvider`, **F** `CallManagerBtn` + `CallRemotePeerBtn` (+ `SpectrumAnalyzer`, exclu et classé). Deux décomptes de l'énoncé étaient **faux** — voir ci-dessous |
| Scénarios — smoke, `lateJoiner`, `broadcastLifecycle`, `peerDeparture`, `multiContext`, `incomingMappingInvariant`, `outgoingAuth`, `incomingSpoof` | 🟠 | **aucun scénario n'utilise la topologie star** (`grep topology scenarios/` : zéro) — `lateJoiner` est intégralement mesh. La transition **« hub absent → hub présent »** n'est donc épinglée à aucun étage : ni en unitaire, ni bout en bout. Relevé le 30/08/2026 |
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

**Le constat de l'énoncé disait « 3 couverts ». C'était 4** — `PlayerHost.vue` s'exécute
réellement dans `usePeerMedia.players.test.js` (17 cas ; seul `MediaBroadcastPlayer` y est mocké).
Il avait été manqué parce que le fichier porte le nom du **composable**, pas du composant. Une
tâche 8 écrite sur l'énoncé aurait donc re-testé un composant déjà couvert.

**État au 31/08/2026 — 12 fichiers de `Widgets/**` exercés sur 15** (10 avant le lot E), les lots
A, B, V, C, D et E étant faits. Les 3 restants : `SpectrumAnalyzer` (hors périmètre, assumé —
[voir plus bas](#pourquoi-ça-compte-et-ce-nest-pas-une-question-de-pourcentage)) et les deux
boutons d'appel du lot F.

> ⚠️ **Ce décompte est re-mesuré, pas repris de la ligne précédente, et les deux ne sont pas
> comparables** : la série antérieure comptait `StreamSimpleUI`, qui vit dans `Exemples/` et non
> dans `Widgets/**`. La mesure se refait sur les chemins d'import réels — un nom trouvé au grep
> peut n'être qu'une mention en commentaire, ce qui a fait passer `CallRemotePeerBtn` pour couvert
> le temps d'une vérification. `PlayerHost`, à l'inverse, n'est importé par aucun test et **est**
> exercé : `usePeerMedia.js:105` l'importe dynamiquement et le rend, et
> `usePeerMedia.players.test.js` ne mocke que `MediaBroadcastPlayer`.

| Lot | Fichiers | Fichiers de test |
|---|---|---|
| **A** | `LocalStreamBtn`, `LocalCaptureBtn`, `GroupLocalStreamBtn` | `LocalStreamBtn.test.js`, `LocalCaptureBtn.test.js`, `GroupLocalStreamBtn.test.js` |
| **B** | le refus de permission média (code + test) | `GroupLocalStreamBtn.permission.test.js` |
| **V** | le contrat DOM du 🔴 de la vignette | `StreamSimpleUI.awaited.test.js` + `tests/visual/` |
| **C** | `useRemotePeerState`, `RemoteMediaPlayer`, le joint `conn.peer` | `useRemotePeerState.test.js`, `RemoteMediaPlayer.test.js`, `StreamSimpleUI.toggles.test.js` |
| **D** | `useMediaControls` + les contrôles de `MediaBroadcastPlayer` | `useMediaControls.test.js`, `MediaBroadcastPlayer.controls.test.js`, `helpers/fakeFullscreen.js` |
| **E** | `LocalMediaPlayer`, `MediaBroadcastProvider`, le joint de l'exception d'écran | `LocalMediaPlayer.test.js`, `MediaBroadcastProvider.test.js`, `StreamSimpleUI.local.test.js` |
| déjà là | `MediaBroadcastPlayer`, `PlayerHost`, `useAwaitedStreams`, `Debug` | — |

**Le lot qui reste** :

| Lot | Fichiers de production | Pourquoi ils vont ensemble |
|---|---|---|
| **F** | `CallManagerBtn`, `CallRemotePeerBtn` | les deux boutons d'appel |

> ⚠️ **L'énoncé de la tâche était FAUX sur le périmètre du lot C**, et il faut le dire parce que
> l'erreur était structurante. Il écrivait : « les deux composables et `RemoteMediaPlayer` forment
> un ensemble — c'est la boucle ». **`useMediaControls` n'est pas dans la boucle** : c'est un
> composable purement DOM (plein écran, PiP, mute **natif** de l'élément), qui ne connaît ni pair,
> ni signal, ni store. Son propre commentaire (l. 41) et celui de `MediaBroadcastPlayer.vue:61-67`
> le disent déjà. L'ensemble réel est `useRemotePeerState` + `RemoteMediaPlayer` + le joint
> `conn.peer` de `StreamSimpleUI`.
>
> Le suivre aurait mélangé deux harnais qui ne se touchent jamais : le lot C sème une file Pinia,
> le lot D doit **fabriquer quatre membres de `document`** absents de happy-dom 20.0.10 (mesuré :
> `fullscreenElement`, `exitFullscreen`, `pictureInPictureElement`, `exitPictureInPicture` sont
> tous `undefined`, et `requestFullscreen` / `requestPictureInPicture` n'existent pas sur les
> éléments). Deux graines pour le lot D, trouvées en cadrant : `isFullscreen` / `isPip` ne sont lus
> par **aucun** template et mis à jour par **aucun** listener — ils mentent dès qu'on quitte par
> Échap ; et la sentinelle `null` **est** atteignable en production, quand le consommateur fournit
> un slot `#video` (`ref="player"` n'est alors jamais posé).

> ℹ️ **`Debug` a été couvert par la bande, en fermant la mesure de bascule d'`enforce`** — et
> seulement sur son bloc de corroboration d'identité, pas sur le reste du panneau. C'est le bon
> précédent de montage (`mount` + store Pinia semé, `data-role` pour cibler), pas la fin de la tâche.

> ⚠️ **`SpectrumAnalyzer` est EXCLU du périmètre, et ce n'est pas un oubli.** Trois raisons qui se
> cumulent : `happy-dom` n'a pas d'`AudioContext`, donc tout collaborateur serait fabriqué à la
> main et le test prouverait sa propre doublure ; ses deux consommateurs **WebRTC2** sont commentés
> — et l'un des deux usages commentés est **faux** (`v-bind="audioProps"` passe `{streamData}` à un
> composant dont l'unique prop est `streams: Array required` : le décommenter lèverait au montage) ;
> et son **seul consommateur vivant est la v1**, `components/WebRTC/widgets/ui/AudioDefaultUserButtonUI.vue:13`,
> sous la route `audio/:vertexId`. C'est un fichier **WebRTC2 maintenu en vie par le module déclaré
> mort** — direction que `doc-rustines.md` lot 1 n'enregistrait pas. Les deux défauts sont classés
> dans [webrtc2-todo.md](webrtc2-todo.md) ; il meurt avec `components/WebRTC/`.

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

**Tranché le 30/08/2026 — deux sorties, une par moitié, et non une case cochée.**

Le 🔴 est une chaîne de **sept maillons**. Six sont des faits sur des fichiers versionnés ; un
seul est une propriété du moteur de rendu. Il n'était donc pas « invérifiable » : il était non
vérifié sur six maillons vérifiables.

**Les six → sortie C, dans la suite.** `StreamSimpleUI.awaited.test.js`, 8 cas : la vignette porte
exactement `draggable-video video-awaited` (**classe d'intention** — aucun binding, rien dans le
template ne trahirait sa disparition), elle ne contient **aucun `<video>`** — l'asymétrie exacte
avec `MediaBroadcastPlayer.vue:2` qui a produit l'effondrement, épinglée **des deux côtés dans le
même fichier** —, elle porte son label, et `_socializer.scss` porte encore la règle.

> ⚠️ **Le périmètre annoncé de cette tâche était faux.** Elle disait `Widgets/**` ; le site du
> correctif est `Exemples/StreamSimple/StreamSimpleUI.vue:42`. Et `Exemples/` est de la
> **production** : l'hôte l'importe (`resources/js/estarter_custom_elements/views/Home.vue:6`).
> Le nom du dossier ment.

**Le septième → sortie D, avec sa procédure.** `happy-dom` ne calcule aucune mise en page :
`getBoundingClientRect()` y rend des zéros. `height > 0` serait **rouge sur du code correct**,
`height === 0` serait **verte sur les deux états** — aucune formulation ne discrimine. Ce n'est
pas difficile, c'est **impossible dans ce runner**, et jsdom n'y changerait rien. Ce qui remplace
la case est nommé et versionné : **`tests/visual/check-awaited-thumbnail.mjs`**, lancé à la main,
Playwright venant d'un runtime **hors dépôt** (`package.json` de l'hôte intact). Il porte le
sujet et le contrôle **dans la même page** — le run de contrôle ne peut plus être oublié — et deux
**canaris de cascade évalués avant toute mesure**, pour que le message dise « CSS absente » et non
« cadre effondré ». Détail et bornes : [`tests/visual/README.md`](../tests/visual/README.md).

**Pourquoi pas `@playwright/test` dans les dépendances de l'hôte** : il n'y a aucune CI. Sans CI,
la couverture réelle d'une suite Playwright et d'un script `node` est identique — ce qui tourne est
ce qu'on lance —, pour une dépendance à faire approuver et un test qui appartient au **paquet**,
lequel n'a ni `package.json` ni `node_modules`. Le fixture et les assertions se transposent sans
changement le jour où une CI existe.

> ⚠️ **Il n'y a PAS de hauteur de référence à retrouver, et c'est un résultat.** Le todo cite
> ~391 px mesurés à la main le 28/08 ; ce chiffre ne peut pas servir de seuil. La largeur du
> conteneur de page est un **réglage** — `layout_class_container` par route, à défaut
> `config('estarter.bootstrap_container_type')`, qui vaut `container-fluid` chez cet hôte et
> `container` par défaut dans le paquet. Toute cote absolue serait vraie d'une configuration et
> fausse de l'autre. Le harnais rejoue donc la mesure **aux deux largeurs** et n'asserte que ce qui
> n'en dépend pas. Mesuré le 30/08 : contrôle à **0 px exactement** dans les deux cas, sujet à
> 464 px (`container`) et 509 px (`container-fluid`).

**Ce qui reste assumé** : le fixture est une copie à la main de la chaîne d'ancêtres et peut rester
vert sur un DOM que la production n'a plus ; le garde-fou est l'assertion de jeu de classes de
`StreamSimpleUI.awaited.test.js`, qui, elle, tourne à chaque suite. Et le harnais dépend d'un
runtime hors dépôt : ailleurs, il ne tourne pas — il s'arrête en le disant.

#### Ce que le lot E a trouvé, et qui n'était pas dans l'énoncé

**25 cas, 3 fichiers, 23 contrôles de harnais mesurés.** Suite complète verte : 79 fichiers,
1417 cas (76 / 1392 avant le lot).

**Trois affirmations de l'énoncé ne tenaient pas**, et il faut les dire parce que deux étaient
structurantes :

1. **`helpers/fakeFullscreen.js` n'a servi à rien.** L'index l'annonçait « réutilisable tel quel » ;
   `useMediaControls` ne touche `document` que sur une action de bascule, et aucun cas du lot n'en
   déclenche. Le précédent qui tranchait était sous les yeux : `RemoteMediaPlayer.test.js` monte le
   même player réel sans ce helper. Ce qui était réellement réutilisable est l'autre moitié du
   précédent du lot D — monter les vrais lecteurs plutôt que des stubs.
2. **Le joint du lot n'est pas dans les deux fichiers nommés, il est ENTRE eux.**
   `WEBRTC_API_KEY` n'a qu'un `provide` (`MediaBroadcastProvider.vue:44`) et qu'un `inject`
   (`LocalMediaPlayer.vue:23`) dans tout le dépôt.
3. **La seconde moitié de l'exception d'écran vit hors du périmètre annoncé**, dans
   `StreamSimpleUI.vue:176` — d'où le troisième fichier. Aucun test ne pouvait monter ce chemin :
   les deux fichiers `StreamSimpleUI.*` sèment les deux flux locaux à `null`, donc les `v-if` sont
   faux et `LocalMediaPlayer` ne se monte jamais (il aurait levé, faute de provider).

⭐ **Les deux chiffres qui valent le lot sont deux 0 croisés, un par joint** — et ce sont eux qui
justifient trois fichiers plutôt qu'un :

| Mutation | rougit | reste vert |
|---|---|---|
| la clé de `provide` permutée | 1 cas, `MediaBroadcastProvider.test.js` | **0** dans les deux autres |
| `screenStreamData.stream` reconstruit en copie | 1 cas, `StreamSimpleUI.local.test.js` | **0** dans les deux autres |

Le premier veut dire que le joint provide/inject peut mourir entièrement pendant que les deux
étages restent verts. Le second, que mon écran partagé peut disparaître dès que je coupe ma caméra
sans qu'un cas d'étage bouge.

**Une sortie B, et sa mesure dit plus que le retrait.** `v-bind="$attrs"` retiré de
`LocalMediaPlayer.vue:6` (0 cas, comme chez le jumeau). Mais cette ligne **désarmait le contrôle du
voisin** : tant qu'elle était là, `inheritAttrs: false` rougissait **0** cas ici contre 1 chez le
jumeau, qui ne l'avait plus. Après retrait : 1 des deux côtés. D'où une règle remontée dans
[`tests.md`](../docs/modules/webrtc2/tests.md) — **un contrôle à 0 doit faire chercher quelle AUTRE
ligne absorbe la mutation** avant de conclure que le test est inutile.

⚠️ **Deux contre-épreuves ont rougi ZÉRO cas, et les deux fois la faute était dans le test** —
quatrième lot consécutif où ce motif revient, et cette fois les deux fautes sont des faits de
harnais réutilisables, écrits dans `tests.md` :

- **`wrapper.vm` traverse `defineExpose`.** Le cas d'exposition, écrit `monter().vm.api`, ne
  pouvait pas échouer : VTU atteint les bindings d'un `<script setup>` que le composant les expose
  ou non. Réécrit avec une **ref de template** — un `<script setup>` est fermé par défaut, et
  c'est le chemin que la production emploie (`Home.vue:12`). La contre-épreuve rougit alors 1 cas.
- **Pousser dans un tableau NU n'est vu par aucun watcher, profond ou pas.** Le cas du watch
  superficiel était vert des deux côtés de la mutation `deep: true` : il ne disait pas « le watch
  est superficiel », il disait « mon tableau de test est inerte ». La composition passe donc par un
  `ref`, comme `useReverbChannel` l'expose.

**Un défaut latent trouvé en écrivant le second, et ouvert comme item mesuré** : le
`watch(() => props.users)` du provider n'étant pas profond, toute la chaîne de présence dépend du
fait qu'`useReverbChannel` **réaffecte** son tableau. Y écrire un `push` rougit **0 cas sur 1417**
et arrête silencieusement la synchronisation de tous les providers — fail-closed, sans une trace.
La moitié provider est épinglée ; la moitié d'en face demande un filet mécanique au grep, sur le
modèle de `roomMembersSourceOfTruth.test.js`.

**Deux faits de production corrigés en chemin, tous deux dans la doc du jumeau** : ses deux
mentions « `LocalMediaPlayer` porte encore le `v-bind` redondant, aucun test ne le couvre »
étaient devenues fausses (`RemoteMediaPlayer.vue`, `RemoteMediaPlayer.test.js`).

**Un doublon évité par relecture, et c'est la leçon des lots 6 et 7 qui a servi** : l'anti-écho
(`isMe` ⇒ lecteur muet, pas de bouton Mute) était au plan du lot E. Il est **déjà** épinglé sur le
lecteur réel par `MediaBroadcastPlayer.controls.test.js` § « mon propre flux ». Ce qui n'était
couvert nulle part est l'**origine** du drapeau — que `localStreamData` et `screenStreamData` le
posent — et cela n'est visible qu'au troisième fichier.

ℹ️ **Un contrôle à 0 conservé sans correctif** : le repli `null` d'`inject`
(`inject(WEBRTC_API_KEY, null)`). Il n'affirme rien de faux, le garde levant dans les deux cas ; il
sert à ce que la levée porte son message plutôt qu'un `injection not found` suivi d'un `TypeError`.
Même arbitrage que le `if (m !== null)` du lot D.

ℹ️ **Un couplage à connaître avant de toucher au template de `StreamSimpleUI`** : retirer le `v-if`
du second player local rougit **12** cas — 1 attendu, plus 6 dans `.awaited` et 5 dans `.toggles`,
qui ne fournissent aucune api et voient donc `LocalMediaPlayer` lever. Ces deux fichiers ne sont
protégés du player local que par ce `v-if`.

#### Ce que le lot D a trouvé, et qui n'était pas dans l'énoncé

**28 cas, 2 fichiers, 1 helper partagé, 30 contrôles de harnais mesurés.** Suite complète verte :
76 fichiers, 1392 cas (74 / 1364 avant le lot).

**Quatre corrections de production, une sortie B de nettoyage — et DEUX des trois défauts fermés
n'étaient pas dans l'énoncé :**

1. **sortie A — `togglePip` compare enfin `document.pictureInPictureElement` à SON élément.** Le
   pool rend une vignette par flux et `_acquireSlot` n'a aucun plafond : cliquer `PIP` sur la
   vignette B pendant que A y était **fermait le PiP de A sans ouvrir celui de B**. Deux clics
   nécessaires, et le PiP d'un tiers volé au premier. Vu rouge d'abord, aux deux étages (1 cas + 1).
2. **sortie A — le recyclage d'un slot rend la présentation** (`releasePresentation`, appelé par le
   `watch` du player). `PlayerHost` est un `v-show` : l'instance **et** l'élément `<video>` survivent
   au changement de flux, mais le PiP et le plein écran ne sont pas des états Vue. La fenêtre PiP
   ouverte « sur Bob » affichait donc Carol, sans bandeau d'identité — et la vignette libérée étant
   masquée, plus **aucun bouton** ne la fermait. Absent de l'énoncé. 2 cas vus rouges d'abord.
3. **sortie A — le mute natif survit à l'extinction de la caméra.** L'`<AudioPlayer>` recevait
   `metadata?.isMe || false` là où le `<VideoPlayer>` recevait `isLocallyMuted` : un pair qu'on avait
   coupé se faisait **réentendre** dès qu'il éteignait sa caméra (la boucle `VIDEO_ACTIVE_TOGGLE`
   que le lot C vient d'épingler), et le bouton Mute n'existe pas sur cette branche. Absent de
   l'énoncé. 1 cas vu rouge d'abord.
4. **sortie B — `isFullscreen` et `isPip` retirés**, du `return` et de `api.md`. Écritures
   neutralisées ⇒ **0 cas**, trois passes sur référence relue verte. Conséquence non anticipée et
   qui vaut d'être dite : le composable **n'importe plus rien de Vue**. C'est un retrait de surface
   publique, assumé sur trois constats (aucun consommateur de `#controls`, aucun hors paquet, aucun
   tag) — et **sans alias de transition**, contrairement à la politique habituelle, un alias
   propageant la valeur fausse. Ce qui le distingue du précédent `stopAudio`, gardé sur la surface
   publique : garder un export inutilisé mais **juste** n'est pas garder un export **faux**.
5. **sortie B — le `ref="container"` mort**, avec sa déclaration : les directives reçoivent leur
   élément par le contrat de directive et stockent leur état sur lui. 0 cas rougis. **Deux fois dans
   le même fichier, une annotation avait maintenu du code mort en vie** — celle du `container` le
   disait « nécessaire au déplacement », celle de `showSpinner` justifie encore une condition qui a
   cessé d'être vraie dans un cas. C'est le mode de panne de ce fichier.

⭐ **Le chiffre qui vaut le lot : renommer `nativeVideo` chez `~estarter` rougit 8 cas du fichier
qui monte le vrai lecteur, et 0 du fichier composable.** Le joint testé **est le nom** : un stub qui
expose `nativeVideo` valide sa propre orthographe, et le dépôt en avait déjà le cadavre —
`AudioPlayer` expose `nativeAudio`, ce qui rend la sentinelle `null` **structurelle** sur toute la
branche audio. C'est cette mesure, et pas une préférence de style, qui interdit de stuber le lecteur.

**La coupe en deux fichiers est une mesure, pas un rangement** : retirer le `try/catch` de l'un ou
l'autre toggle rougit **1 cas du fichier composable et 0 du fichier composant**. Au niveau composant
`console.error` n'est pas discriminant — `callWithAsyncErrorHandling` journalise déjà le rejet d'un
handler, donc « notre `catch` a tracé » et « Vue a tracé à sa place » y donnent le même vert. Tout
cas d'échec appartient à l'étage où le composable s'appelle nu.

**Deux affirmations de l'énoncé ne tenaient pas, et il fallait relire le code pour le voir :**

- **« la comparaison à `el` » n'était un défaut que pour le PiP.** Pour le plein écran, `el` est la
  `<video>` nue et nos boutons sont ses **frères** : ils ne sont pas peints tant qu'elle est en plein
  écran, et rien d'autre dans l'app ne pose `fullscreenElement` (grep : seulement la v1 morte). La
  branche `else` de `toggleFullscreen` est donc **déjà morte** — y ajouter `!== el` l'aurait rendue
  prouvablement morte, ce qui n'est pas une sortie A. Non touchée ; le fait part en item 🟠 (le
  bouton plein écran est un **aller sans retour**).
- **« la sentinelle `null` est atteignable en production quand le consommateur fournit un slot
  `#video` »** décrit une **capacité du contrat**, pas un chemin existant : aucun consommateur du
  dépôt ne fournit `#video` ni `#controls`. Le chemin réellement atteignable est ailleurs, et
  l'énoncé ne le nommait pas — **toute la branche audio**, où `_getEl()` rend `null` par
  construction. C'est ce que le lot épingle, par la paire de cas sur le slot `#controls`.

⚠️ **Un piège de harnais payé, et il vise les contrôles eux-mêmes** : pour mesurer un `catch`, il
faut retirer le `try` **avec** lui. Vider le corps du `catch` laisse la suite compiler sans rien
mesurer ; le retirer seul laisse un `try` orphelin, la suite ne compile plus, et le « 0 cas rouge »
se lit alors comme « ce `catch` ne sert à rien ». Première mesure de cette passe, jetée et refaite.

**Trois zéros conservés, avec leur raison écrite dans les docblocks** pour ne pas les re-mesurer :
`?? null` de `_getEl` et `if (m !== null)` du composant (0 aux deux étages) sont le **contrat** de la
sentinelle, pas des lignes qui mentent — la sortie B est pour une ligne fausse, pas pour toute ligne
immesurable ; et `v-if="props.videoActive"` du bloc de contrôles rougit **0 cas ici, 2 ailleurs**
(`spinner.test.js`, `RemoteMediaPlayer.test.js`), ce qui est la preuve qu'il ne fallait pas dupliquer
« aucun bouton sur la branche audio ».

**Pas de sortie `tests/visual/` ici, et c'est un résultat** : contrairement à la mise en page, le
plein écran et le PiP se **fabriquent** (`helpers/fakeFullscreen.js`, un emplacement unique lu par
des accesseurs). Ce qui resterait invérifiable — la boîte réelle d'une `<video>` en plein écran, la
vignette PiP — n'est pas ce que la production décide : elle **désigne un élément**, et c'est
exactement ce que la suite asserte.

#### Ce que le lot C a trouvé, et qui n'était pas dans l'énoncé

**Trois corrections de production, dont une sortie B et deux sorties A** — le lot n'était pas qu'un
lot de tests :

1. **Le garde `signal.roomId !== peerId` : supprimé.** 0 cas rougis, trois passes, comme l'item
   `webrtc2-todo.md` l'exigeait. Ce qui protège réellement est le `switch` sans `default` (7 cas).
2. **`immediate: true` : ajouté**, la piste non vérifiée de l'item était juste. Trois cas vus
   rouges avant. Coût réel payé : les contrôles des **trois** fichiers re-mesurés, l'un passant de
   2 à 15 cas.
3. **Défaut neuf** : un flux sans `peerId` lisait la clé `"undefined"`, **exactement celle qu'écrit
   `dispatchSignal` quand la connexion manque** — une file poubelle commune à tous les partages
   d'écran. Garde ajouté ; la surdité d'un écran reste voulue.

**Le contrôle qui vaut le lot est un 0 croisé.** Casser l'un ou l'autre bout du joint `conn.peer`
rougit 3 et 2 cas de `StreamSimpleUI.toggles.test.js` — et **0 cas** des deux autres fichiers,
mesuré trois fois chacun. C'est la preuve chiffrée qu'un test par étage ne voit pas la boucle
mourir : les deux couches restent vertes pendant que plus rien n'arrive à l'écran.

⚠️ **Deux pièges de harnais payés, et le second est le plus coûteux :**

- **La coalescence a rougi mon propre test avant d'être écrite en pin.** Un cas enchaînait deux
  annonces sans tick, et perdait la première — la faute était dans le test, pas dans le code.
  C'est la quatrième passe consécutive où une contre-épreuve ou un cas rate pour cette famille de
  raison.
- **Un commentaire HTML placé dans le `<template>` avant la racine coupe le fallthrough des
  attributs** : le composant devient multi-racine, silencieusement. L'explication du retrait de
  `v-bind="$attrs"`, écrite là, a cassé ce qu'elle expliquait. Et le contrôle mesuré juste après a
  rendu « 1 cas rougi » **qui n'était pas le sien** — c'était la régression déjà présente. D'où la
  règle, désormais dans `docs/modules/webrtc2/tests.md` : **un contrôle dont la référence n'a pas
  été relue à 0 ne mesure rien.**

**Deux sorties D, datées, avec déclencheur** — l'état initial jamais semé (avec son piège
`?? false` écrit dans le todo, qui est ce qui coûte à redécouvrir) et l'absence de réinitialisation
au changement de `peerIdSource` (inatteignable en production après la correction 3). Plus un
report : la coalescence appartient à l'item « drainer réellement la file de signaux », pas à un lot
de tests de présentation.

#### Ce que les lots A et B ont trouvé, et qui n'était pas dans l'énoncé

**Trois contre-épreuves ont rougi ZÉRO cas. Les trois fois, la faute était dans le test** — jamais
dans le code. C'est la troisième passe consécutive où ce motif se reproduit ; il commence à être la
règle et non l'exception.

1. **« les deux messages d'erreur diffèrent »** — le cas n'assertait que la différence des chaînes,
   ce que le préfixe `err.name` garantit à lui seul. Fusionner les deux explications restait vert.
   Il asserte désormais le **geste indiqué**, qui est opposé dans les deux cas.
2. **`inject('AWN', null)` vs un `inject` nu** — il n'y avait rien à garder : un inject nu ne plante
   pas, il rend `undefined`, et le repli `?? window.AWN` fonctionne à l'identique. Le commentaire du
   composant affirmait un plantage : **c'était faux, corrigé**. Le défaut `null` n'évite qu'un
   avertissement Vue — c'est tout ce qu'il vaut, et c'est ce qui est épinglé maintenant.
3. **« le rejet ne part pas en unhandled rejection »** — cas **supprimé, pas commenté** (précédent
   `isValidSlug`). Voir ci-dessous : la question est intestable ici.

**Deux corrections d'énoncé sur le refus de permission**, trouvées en écrivant le test :

- **Ce n'était pas un « rejet non traité » au sens de Node.** Le handler appelait le verbe **sans
  rendre** sa promesse, et les émetteurs de `LocalStreamBtn` ne rendent rien non plus : Vue ne
  voyait donc jamais de promesse, et `callWithAsyncErrorHandling` n'avait rien à rattraper. Mesuré :
  ni `app.config.errorHandler`, ni `console.error`, ni `process.on('unhandledRejection')` ne
  voyaient quoi que ce soit. Le symptôme décrit restait exact, mais l'erreur disparaissait **sans la
  moindre trace** — pire que ce qui était écrit.
- **La question « le rejet s'échappe-t-il ? » est INTESTABLE à travers un espion.** Mesuré côte à
  côte : un `Promise.reject()` nu déclenche bien `unhandledRejection`, celui d'un
  `vi.fn().mockRejectedValue()` **jamais** — l'espion attache son propre handler pour tracer ses
  résultats et absorbe le signal. Tout cas assertant cette propriété serait vert par construction,
  avant comme après un correctif.

**Deux défauts de production fermés en passant** : `GroupLocalStreamBtn` déclarait `api` en
`required: false, default: null` alors que son template le déréférence au rendu — le défaut ne
protégeait rien, il remplaçait « Missing required prop » par un `Cannot read properties of null`
opaque à trois composants du câblage fautif (**sortie A**) ; et le câblage `@stop_audio` était
**mort des deux côtés** — aucun élément du template de `LocalStreamBtn` n'émettait cet événement
(**sortie B**, supprimé après avoir vu rouge la négative qui le gardait). Rien n'est perdu : « Stop
stream » s'affiche dès que `isStreaming` est vrai, flux audio seul compris, et
`usePeerOrchestrator.stopAudioStream` n'est qu'un **alias de `stopWebcamStream`**. `stopAudio`
reste dans la surface publique mais n'a plus aucun site d'appel dans le paquet.

**Un piège de harnais neuf, à ne pas re-payer** : `wrapper.emitted()` capte **aussi les événements
DOM natifs** qui remontent à la racine du composant — un `trigger('click')` fait apparaître `click`
dans la liste. Toute assertion sur le vocabulaire complet d'un composant doit les écarter.
