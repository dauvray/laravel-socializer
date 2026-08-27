# WebRTC2 — Architecture

> **À quoi ça sert :** la structure en couches du module et les invariants qu'une refacto
> casserait sans le savoir.
> **Quand le lire :** avant d'ajouter un composable, de déplacer une responsabilité, ou de
> « simplifier » une garde qui a l'air redondante.

Code : `src/resources/js/socializer/components/WebRTC2/`

**Sommaire** — [Ordre des couches](#ordre-des-couches) ·
[Propriétaires uniques](#propriétaires-uniques) ·
[Les deux sens portent chacun leur garde](#les-deux-sens-portent-chacun-leur-garde) ·
[Un onglet, plusieurs contextes](#un-onglet-plusieurs-contextes--la-granularité-des-clés-du-store) ·
[Deux prédicats de connexion](#deux-prédicats-de-connexion-jamais-un-seul) ·
[Départ d'un pair](#départ-dun-pair--un-fait-métier-deux-transports) ·
[Signaux datachannel](#signaux-datachannel--trois-enveloppes-trois-consommateurs) ·
[Le Peer PeerJS](#le-peer-peerjs--un-seul-par-onglet)
(→ [`destroy()` n'est pas une coupure réseau](#destroy-de-peerjs-nest-pas-une-coupure-réseau) ·
[ce qui traverse le state Pinia](#ce-qui-traverse-le-state-réactif-pinia)) ·
[Conventions de code](#conventions-de-code) ·
[Le routage ne pose aucune précondition](#le-routage-ne-pose-aucune-précondition) ·
[Cleanup obligatoire](#cleanup-obligatoire) ·
[Timers](#timers-armés-avant-leffet-quils-surveillent)

---

## Ordre des couches

```
createPeerContext                         source de vérité unique (état, stores, FSM d'appel)
  └─ usePeerCore · usePeerMedia · usePeerConnections · usePeerTransport
                                          sous-modules : dialoguent uniquement via ctx
       └─ useConnectionPool               retry, établissement, sync room → connexions
            └─ useCallManager             cycle d'appel (invite → accept → open → stop → reset)
                 └─ useStreamManager      registre des flux distants + players + départs
                      └─ useBroadcastPresence  annonce « je diffuse » sur le data channel
                           └─ useSignalingQueue   routage des signaux serveur entrants
                                └─ usePeerOrchestrator   composition + façade, aucune logique métier
                                     └─ useMediaBroadcast   couche feature consommée par l'UI
```

`useSignalingQueue` est instanciée **en dernier** précisément parce qu'elle ne fait que
consommer des verbes : personne ne consomme les siens, donc sa table `routes` peut pointer
vers n'importe quelle couche sans jamais créer de callback ascendant.

**Règle : une couche ne reçoit jamais de callback vers une couche supérieure.** Les
dépendances descendent par injection explicite depuis l'orchestrateur
(`useCallManager(ctx, { core, media, connections, transport, pool })`) — jamais par import
croisé, jamais par callback remontant. C'est ce qui garde le graphe acyclique quand une
couche de plus est extraite ; un callback inverse (« passe-moi `requestOrConnectPeer` ») est
le signe qu'une couche est au mauvais étage.

Corollaire : l'état partagé entre deux couches vit dans `createPeerContext`, derrière des
accesseurs (`callMachine`, `beginShutdown`/`endShutdown`), pas dans un `ref` de
l'orchestrateur passé de main en main.

**Ordre d'extraction imposé** : chaque couche s'extrait *sous* celles qui en dépendent,
jamais au-dessus. `useConnectionPool` avant `useCallManager` (qui appelle
`requestOrConnectPeer`), `useCallManager` avant `useStreamManager` (qui appelle
`stopCallWithPeers`). L'inverse produit mécaniquement un cycle.

Règles de couplage complémentaires :

- `useMediaBroadcast` n'importe **que** `usePeerOrchestrator` — jamais les sous-modules ni le
  `peerStore`.
- `usePeerOrchestrator` est le **seul** à instancier `createPeerContext` et à composer les couches.
- Les sous-modules (`usePeerCore`, `usePeerMedia`, `usePeerConnections`, `usePeerTransport`)
  communiquent **uniquement** via `ctx` — pas d'imports croisés entre eux.
- `Composables/utils/` est l'infra transverse : sans état partagé, importable de partout,
  jamais l'inverse.

---

## Propriétaires uniques

Un invariant se tient à un seul endroit, vérifiable au grep.

| État | Seul à le muter | Les autres couches passent par |
|---|---|---|
| `callMachine` (FSM d'appel) | `useCallManager` | `markCallConnected`, `isRemoteClosing` / `beginRemoteClosing` / `endRemoteClosing` |
| `lifecycle.shutdownCount` | `useCallManager`, orchestrateur (arrêts de stream), `useConnectionPool` (unmount) | `ctx.isShuttingDown` en lecture (`count > 0`) |
| `media.remoteStreamsMap` | `useStreamManager` (ajout/TTL/éviction), `useCallManager` (purge au départ d'un pair) | `ctx.remoteStreams` / `remoteScreens` en lecture |
| séquence de départ d'un pair | `useCallManager.handleRemoteDeparture` | point d'entrée unique quel que soit le transport qui l'annonce |
| timers de retry connexion | `useConnectionPool` | `clearRetry` / `clearAllRetries` |
| routage des signaux serveur | `useSignalingQueue` (table `routes` construite par l'orchestrateur) | exposer un verbe et l'inscrire dans la table — pas de `watch` sur `ctx.lastRoomSignal` ailleurs |
| `media.announcedStreamsMap` | deux écrivains assumés, chacun sur la seule information qu'il voit : `useBroadcastPresence` (annonce `BROADCAST_STATE`) et `usePeerTransport` (appel one-way entrant) ; purge par `useCallManager.handleRemoteDeparture` | `ctx.markAnnouncedStream` / `ctx.clearAnnouncedStream` (jamais d'écriture directe), lecture via `ctx.announcedStreamPeers` |
| `peerStore.roomMembers[contextId]` (index de présence) | `usePeerConnections._doGetRoomUsersDiff`, unique producteur de `usersInRoom` ; purgé par `createPeerContext.destroy` | `peerStore.isUserInAnyRoom(slug)` en lecture — c'est le prédicat de `removeRemotePeerId` |
| `session.authorizedCallPeers` (allowlist du garde sortant) | `useCallManager`, **seul écrivain** : marque à l'acceptation (`acceptCallFromPeer`) et à l'ouverture (`openCallBetweenPeer`) — les deux marquages sont eux-mêmes gardés, cf. ci-dessous —, purge au départ du pair et au `resetCallState` | `ctx.markAuthorizedCallPeer` / `isAuthorizedCallPeer` / `clearAuthorizedCallPeer` / `clearAllAuthorizedCallPeers` — jamais d'écriture directe, et **jamais** `session.currentCallUsers` à sa place (état d'affichage, cf. [securite.md](securite.md)) |

L'état *plat* partagé (`session.currentCallUsers`, via `ctx.addCurrentCallUser` &co.) n'a
**pas** de propriétaire unique : il n'a pas d'invariant de transition à protéger,
contrairement à la FSM. C'est la raison de la différence de traitement — et la raison pour
laquelle il ne doit **jamais** servir d'allowlist de sécurité (voir [securite.md](securite.md)).

---

## Les deux sens portent chacun leur garde

**Tout chemin qui ouvre une connexion porte un garde d'autorisation — dans les deux sens.** Durcir
l'entrant seul ne protège de rien : sur un appel média, c'est l'**émetteur** qui pousse son flux,
donc un tiers qui obtient de sa victime un `connectToPeer(lui)` se fait livrer webcam, micro ou
écran sans avoir eu à ouvrir quoi que ce soit. Les deux gardes lisent le même prédicat
(`utils/isAuthorizedPeer.js` en sortie, `_isAuthorizedIncomingPeer` en entrée), sur les mêmes deux
chemins d'autorisation.

**Corollaire, et c'est celui qu'on oublie : tout chemin qui ÉCRIT dans l'allowlist en porte un
aussi.** Une acceptation d'appel ne vaut que pour une invitation **en vol**, et la garde va **avant**
l'écriture, jamais après — la FSM ne protège que ce qui la suit. Sans cela, un pair s'inscrit
lui-même dans `authorizedCallPeers` et satisfait ensuite les deux gardes ci-dessus, qui n'ont pas
bougé d'une ligne.

Substance, chaîne d'attaque et deltas assumés : [securite.md](securite.md#décisions-en-vigueur-sens-sortant-août-2026).

---

## Un onglet, plusieurs contextes : la granularité des clés du store

`createPeerContext` isole les contextes… jusqu'à la porte du `peerStore`, qui est **unique
par onglet** et que tous partagent. Une page en monte couramment trois ou quatre :
`System/Notifications.vue` crée `data-app` en permanence, et chaque `MediaBroadcastProvider`
le sien (`Exemples/Home.vue` en aligne trois). Le `Peer` PeerJS aussi est unique.

**Règle : chaque entrée du store est indexée à la granularité du FAIT qu'elle décrit.**
S'en écarter ne produit pas une erreur, mais une confiscation silencieuse — un contexte
lit ou détruit l'état d'un autre.

| Fait | Granularité | Clé |
|---|---|---|
| « le peerId de X est *id*, **appris à** *t* » | l'**onglet distant** (un seul `Peer` par onglet) | `remotePeersId[slug] = { peerId, learnedAt }` |
| « X est présent dans ma room » | le **contexte** | `roomMembers[contextId]` |
| « j'ai demandé le peerId de X » | le **contexte** *et* le type de connexion | `waitingRemotePeerId[slug\|room\|type]` |

Le peerId est le seul fait par slug, et **deux régimes distincts gouvernent sa durée de
vie** — les confondre est l'erreur que ce paragraphe existe pour empêcher :

**1. Son existence est gouvernée par les autres faits.** On ne l'oublie
(`removeRemotePeerId`) qu'une fois le pair absent de **toutes** les rooms déclarées. Ce
prédicat porte sur `roomMembers`, jamais sur `connections` : cette map décrit des connexions
PeerJS, pas une présence, et chaque contexte appelle le verbe avant ou après avoir purgé sa
propre entrée — le prédicat était donc vrai pour tout le monde et le verbe un no-op permanent
dès la deuxième room. Le peerId d'un onglet fermé survivait alors indéfiniment : au retour du
pair on rappelait un peer mort (`Could not connect to peer <uuid>`) sans jamais redemander le
frais, puisqu'on croyait déjà en avoir un. L'autre sortie est `invalidateRemotePeerId`, sur
le fait de mort (`peer-unavailable`), inconditionnelle.

**2. La confiance qu'on lui accorde POUR COMPOSER est gouvernée par un bail** —
`REMOTE_PEER_ID_LEASE_MS`, lu par `getDialableRemotePeerId`. Passé le bail sans preuve
fraîche, les deux points de décision d'appel de `useConnectionPool`
(`requestOrConnectPeer` et `_handleConnectionAttempt`) redemandent la signalisation au lieu
d'appeler. Le bail est **renouvelé sur preuve** : `connectToPeer` réécrit le mapping à chaque
réponse reçue, donc une room saine ne paie jamais d'aller-retour supplémentaire. Il
**ne supprime rien** — cf. le cinquième corollaire.

> **Ce que le bail ferme, et ce qu'il ne fait que borner.** Il ferme une **impasse** : « je
> crois avoir un peerId, donc je ne redemande jamais », qui n'avait aucune borne de temps dès
> lors qu'un contexte en retard vetotait la purge ou qu'un départ+retour se coalesçait en un
> seul diff. Il ne ferme pas la divergence : entre l'instant où le pair change d'identité et
> l'expiration de mon bail, je compose encore un mort. La fenêtre passe de « à vie » à
> `REMOTE_PEER_ID_LEASE_MS` ; elle n'est pas supprimée. C'est la même forme d'argument que le
> réplica du graphe ([securite.md](securite.md), corollaire de méthode du 24/08/2026) :
> **ajouter une horloge raccourcit la fenêtre entre dérive et réparation, elle ne la supprime
> pas.** La supprimer demanderait de router la question vers le maître à chaque composition,
> c'est-à-dire un rafraîchissement paresseux dans `connectToPeer` — écarté : la fonction est
> **synchrone** et porte un verrou anti-TOCTOU, y insérer un `await` créerait un état
> intermédiaire observable dont tout ce qui LIT cet état devrait être réexaminé. Et faire
> demander le peerId à chaque tentative ferait passer les 8 tentatives du moteur de retry par
> `/ask-to-peer-id`, contre un plafond de 3 par 10 s : l'étranglement de la reconnexion
> légitime.
>
> **Décision, 26/08/2026** : fenêtre résiduelle assumée, adossée à la recovery
> `peer-unavailable`, **inchangée**. Le bail lui retire son rôle de *seul* filet, il ne la
> remplace pas. Coût borné de la fenêtre résiduelle : un appel perdu, une erreur console, un
> tour de backoff, une `MediaConnection` à moitié ouverte que `hasOpenConnection` compte comme
> ouverte. Épinglé par `scenarios/peerDeparture.test.js` (« le bail évite l'appel mort ») et
> par `peers2Store.remotePeerId.test.js` (§ le bail).

Cinq corollaires à ne pas défaire :

- **`connectToPeer` enregistre le peerId AVANT ses gardes.** Un peerId de signalisation
  décrit l'état courant du pair, que la connexion s'ouvre ou non derrière. Placé après,
  il est perdu à chaque sortie par « déjà connecté » — or `hasOpenConnection` considère
  ouverte une `MediaConnection` dont le `RTCPeerConnection` n'est plus lisible, c'est-à-dire
  exactement le cas du pair qui vient de recharger sa page. C'est aussi le point de
  **renouvellement du bail** : chaque preuve reçue re-estampille l'entrée.
- **Une demande en vol appartient à son émetteur** (`contextId` stocké dans l'entrée), et
  meurt avec lui : `cleanupPeerConnection` la purge explicitement, hors de
  `closePeerConnection` qui sort par un early-return quand la room n'a aucune connexion.
  Sans ça, un provider démonté avant l'aboutissement de sa signalisation laissait une
  demande orpheline que le contexte remonté à sa place lisait comme la sienne — il restait
  muet jusqu'à `SIGNALING_STALE_MS`. Un simple mount/unmount (navigation SPA, HMR) suffisait.
- **Les purges élargies sont scopées.** `clearWaitingRemotePeerIds(slug, room)` et
  `clearWaitingRemotePeerIdsForContext(contextId)` existent précisément pour ne pas retomber
  sur « tout ce qui concerne ce pair ». Seule `invalidateRemotePeerId` purge sans scope :
  le peerId est mort, donc aucune demande le concernant n'a plus d'objet, quel que soit le
  contexte émetteur.
- **Dans un `contextRegistry.forEach`, résoudre AVANT de muter.** Le store étant partagé par
  l'onglet, toute résolution qui le lit doit être faite hors de la boucle. La recovery
  `peer-unavailable` résolvait `peerId → slug` *à l'intérieur*, en invalidant au passage : le
  premier contexte itéré consommait le fait, tous les suivants sortaient sur
  `if (!targetSlug) return`. Or `Notifications.vue` crée `data-app` au tick 0, donc **premier**
  dans la `Map` — et comme il n'a aucun canal de présence, sa re-demande ne pouvait qu'être
  refusée en face (« demandeur non autorisé », faux signal qui masquait le vrai). Le contexte de
  diffusion, seul à avoir un flux à repousser, n'était jamais relancé. La règle qui en découle :
  **invalider est global** (c'est un fait constaté sur l'onglet distant), **relancer est une
  intention de contexte** — donc filtré par `isAuthorizedPeer`, ce qui préserve la visio 1-à-1,
  qui n'a aucune room commune et ne tient qu'à `authorizedCallPeers`.
- **Le bail ne s'applique qu'à la décision de composer.** Le mapping a trois classes de
  lecteurs — composer, servir d'allowlist au chemin (b) de `_isAuthorizedIncomingPeer`,
  résoudre `peerId → slug` pour l'anti-usurpation — et **seul le premier est sous bail**
  (`getDialableRemotePeerId`). Les deux autres lisent `getRemotePeerId` et
  `getSlugByRemotePeerId`, aveugles au temps par construction. Y brancher une péremption
  transformerait une expiration en **refus**, refermant la visio 1-à-1 hors room ; et surtout
  elle ferait de l'anti-usurpation un contournement **planifiable** — il suffirait d'attendre
  l'expiration pour que la résolution inverse rende `null` et que le refus sur contradiction
  cesse de mordre. Corollaire : une expiration ne **supprime** jamais l'entrée. On cesse de
  composer, on ne cesse pas de reconnaître.

⚠️ **Un test à un seul contexte par onglet ne peut pas voir ces pannes.** Le harnais monte
donc plusieurs contextes par pair virtuel (`peer.mountContext()`), et les scénarios leur
livrent la présence **séquentiellement** — cf. [tests.md](tests.md#un-onglet-plusieurs-contextes).

---

## Deux prédicats de connexion, jamais un seul

`usePeerConnections` en expose deux, sur exactement la même liste de connexions, et les
confondre a coûté une panne définitive.

| Prédicat | Question | Posture | Une MediaConnection `connecting` |
|---|---|---|---|
| `hasOpenConnection` | « dois-je m'abstenir d'en ouvrir une seconde ? » | optimiste | **compte** |
| `isConnectionEstablished` | « ai-je fini ? » | strict | ne compte pas |

Le moteur de retry (`useConnectionPool._handleConnectionAttempt`) utilise **les deux** : le
prédicat optimiste décide s'il faut tenter une ouverture, le strict décide s'il faut
s'arrêter. Il n'utilisait que le premier, pour les deux usages.

Pourquoi c'est fatal : un `peer.call()` que le récepteur n'a jamais répondu laisse le
`RTCPeerConnection` en `connecting` **à vie** — WebRTC ne le fait pas basculer en `failed`
faute de réponse, et PeerJS ne notifie pas au demandeur le `close()` d'un appel non répondu.
L'émetteur concluait donc « connexion établie » une seconde après l'appel, annulait sa
surveillance, et n'essayait plus jamais. Vue de l'utilisateur : écran noir chez le
récepteur, aucune erreur nulle part, et un « Could not connect to peer &lt;uuid&gt; » qui
n'apparaît **qu'une seule fois**.

⚠️ Sur un contexte `stream`, `connectToPeer` ouvre un appel média **et** un canal data avec
la même metadata : les deux sont stockés sous le même type, et ce sont deux
`RTCPeerConnection` distincts. `isConnectionEstablished` ne regarde donc que la
MediaConnection (`conn.type === 'media'`) — sans quoi un canal data ouvert ferait conclure
« flux établi » alors que rien n'arrive.

---

## Départ d'un pair : un fait métier, deux transports

« Tel pair quitte l'appel » arrive soit par le signal serveur `CloseConnectionToPeerID`
(→ `remoteStopCall`), soit par la fermeture de la connexion PeerJS
(→ `useStreamManager.handleStreamRemoved`). Les deux peuvent se déclencher pour un même
départ, dans un ordre non déterministe (aller-retour serveur vs P2P direct) — d'où le garde
par participant `closingUsers`.

Les deux **doivent** converger vers `handleRemoteDeparture` : c'est le déclencheur qui
varie, jamais la séquence. Historiquement les deux chemins avaient chacun leur version de la
séquence, et **aucune n'était complète** (l'une oubliait la fermeture du transport et des
retries, l'autre purgeait le registre sur une clé qui ne matchait pas côté initiateur) : la
correction dépendait de quel transport arrivait en premier.

Corollaire : `close-call` est **idempotent par contrat** — un même départ peut l'émettre deux
fois si les deux transports se réveillent hors de la fenêtre du garde.

Ce qui différencie encore les deux appelants est uniquement ce qui leur appartient :
`remoteStopCall` valide et adapte un payload de signalisation, `handleStreamRemoved` résout le
pair distant depuis `conn.metadata` (d'où son `waitForMeReady`, précondition de
`_resolveRemoteSlug` et non de la séquence de départ).

**La politique est décidée par le mode courant, pas par le déclencheur** : un seul
`isCallMode = currentType !== 'stream'` gouverne à la fois la fermeture de transport et le
full stop. C'est ce qui a permis de fusionner les deux chemins — plus besoin de brancher par
transport.

⚠️ **Une fermeture retire un seul type, sans condition.** Ne pas rétablir la purge élargie
(« tous les types du pair ») : A qui diffuse webcam **+** écran et coupe sa webcam voyait son
écran disparaître chez B. La purge élargie compensait en réalité une identification de pair
défectueuse, maintenant corrigée (voir la règle `entry.remoteSlug` plus bas), et un filet
indépendant existe désormais (nettoyage sur fin de pistes, ci-dessous).

---

## Signaux datachannel : trois enveloppes, trois consommateurs

| Enveloppe | Forme | Consommée par |
|---|---|---|
| Signal **serveur** | `{ roomId: '<type>-<room>', type, payload }` | `useSignalingQueue`, via sa table `routes` |
| Projection d'état **Widget** | `{ roomId: '<peerId>', payload: { type } }` (`AUDIO_MUTE_TOGGLE`, `VIDEO_ACTIVE_TOGGLE`) | `useRemotePeerState` — hors du routage serveur |
| Annonce de diffusion | `BROADCAST_STATE` | **l'infra**, dans le wrap `onDataReceived` de l'orchestrateur — n'atteint jamais l'app |

Traiter `BROADCAST_STATE` à l'étage infra évite d'imposer un câblage à chaque consommateur
**et** interdit à un pair d'injecter ce type dans un flux de chat. C'est un écart assumé avec
le plan initial (qui prévoyait de l'ajouter à la table `routes`) : cette table ne route que
les enveloppes **serveur** scopées sur `contextId`.

**Corollaire de sécurité :** l'identité de l'émetteur d'un message datachannel se lit
**toujours** depuis la connexion (`utils/resolveRemoteSlug.js`, authentifiée à l'admission),
jamais depuis un champ du payload.

---

## Le Peer PeerJS : un seul par onglet

C'est la classe de bug la plus coûteuse du module. Trois gardes empilées, chacune fermant une
fenêtre que les autres laissent ouverte :

1. **Garde d'instance** — `if (peerStore.localPeer && !peerStore.localPeer.destroyed) return`,
   **en premier**. C'est la seule qui ferme la fenêtre complète, parce que `peerStore.localPeer`
   est affecté **synchroniquement** dans `_doInit`.
2. Garde `peerInitPromise` — ne couvre que quelques microtâches : le corps de `_doInit` est
   synchrone, le seul `await` est *dans* le handler `bind('call')`.
3. Garde `localPeerReady` — n'est vrai qu'après l'événement `'open'`, soit un aller-retour réseau.

Entre 2 et 3 s'ouvrait une fenêtre de plusieurs centaines de ms — et la production monte
précisément deux consommateurs dans cet intervalle : `System/Notifications.vue` crée le contexte
permanent `data-app` au tick 0, le contexte `stream-<room>` arrive après résolution de route et
import dynamique, **sans un seul `await` avant `transport.setLocalPeer()`** sur les deux chemins.
Le second `Peer` créé restait enregistré côté serveur PeerJS (peerId fantôme) et hors d'atteinte
de `_destroyPeerSingleton`, qui n'agit que sur `peerStore.localPeer`.

**Garde d'identité dans les handlers** : `if (peerStore.localPeer !== peer) return` en tête de
`'open'`, et `peerStore.localPeer !== peer || peer.destroyed` dans `'disconnected'` (handler
**et** callback du backoff). Les handlers écrivent sur la const locale `peer`, jamais sur
`peerStore.localPeer` : un peer supplanté ou détruit ne doit ni déclarer la session prête, ni
publier son identité, ni armer un backoff pour le compte du peer courant.

### `destroy()` de PeerJS n'est pas une coupure réseau

Vérifié dans `node_modules/peerjs@1.5.4/dist/bundler.mjs` : `destroy()` (l.1776-1783) ne retire
**que** les listeners de son socket interne (l.1789), jamais ceux du `Peer` ; et il appelle
`disconnect()`, qui **émet `disconnected`** (l.1810) *avant* que le drapeau `_destroyed` soit
posé (l.1781).

Conséquence : un garde `if (!localPeer || localPeer.destroyed) return` ne voit rien —
chaque destruction volontaire était traitée comme une coupure réseau (tentative de reconnexion
consommée, faux `warn`, et surtout `peerReconnectTimer` écrasé, laissant un timer orphelin que
`resetPeerState` ne pouvait plus annuler).

D'où le **détachement explicite** : une closure unique
(`peerStore.peerListenersDetach`, verbes `setPeerListenersDetach` / `detachPeerListeners`),
appelée **avant** `peer.destroy()`. Elle vit dans le store, pas dans une closure de composable
ni au niveau du module : c'est un autre contexte — voire une autre copie du module après un HMR —
qui détruit le singleton. Dans `_doInit`, un helper `bind(event, handler)` est la **seule** porte
d'entrée : un 6e listener branché hors du helper fuirait.

Trois arbitrages à ne pas défaire :
- `resetPeerState` **exécute** la closure au lieu de la nuller, et `setPeerListenersDetach`
  exécute la précédente avant de la remplacer — sans quoi le chemin early-return de
  `_destroyPeerSingleton` jetterait le seul moyen de débrancher des listeners encore vivants ;
- l'erreur d'un `off()` est absorbée **dans l'action du store**, jamais dans le transport : elle
  ne doit empêcher ni `peer.destroy()`, ni la suite du reset (peer nullé mais drapeaux encore
  vrais serait l'état impossible qui gèle `setLocalPeer` à vie) ;
- la closure est enregistrée **avant** les `bind` et `bound` est capturé par référence : même une
  exception au milieu du branchement laisse de quoi détacher ce qui a été posé.

### Ce qui traverse le state réactif Pinia

Le runtime du Peer singleton (`peerConsumerCount`, `peerInitPromise`, `peerReconnectAttempts`,
`peerDestroyTimer`, `peerReconnectTimer`) vit dans `peerStore`
(`stores/peers2/state.js`, section « Runtime du Peer singleton »). Trois cas, tranchés et figés
par des tests d'identité :

| Type stocké | `markRaw` ? | Pourquoi |
|---|---|---|
| `Promise` | **non** | Vue ne proxifie que les objets nus et les collections — identité et `await` préservés |
| **Fonction** | **non** | `isObject` de `@vue/shared` exige `typeof === 'object'` — identité préservée au set comme au get (sinon `peer.off(event, handler)` ne retrouverait pas ses handlers) |
| **Handle de timer** | lire avec `toRaw()` | c'est un objet côté Node/vitest, donc enveloppé — `clearTimeout(toRaw(...))` pour ne pas faire dépendre une annulation du forwarding du proxy |

**Restent volontairement au niveau du module** : `contextRegistry` (registre d'objets de contexte,
pas d'état du peer — c'est lui qui justifie encore le `vi.resetModules()` par pair du harnais de
scénarios) et `_hubRateLimiter` (arbitrage « verbe `.reset()` plutôt que Pinia »).

---

## Conventions de code

- **IDs de session** : `crypto.randomUUID()` — jamais `Math.random()` (cf. `ensureCurrentCallRoomId`)
- **PeerId local** : `ctx.peerStore.getLocalPeerId` — jamais le triple fallback historique
  `localPeer?.id || localPeer?._id || lastLocalPeerId`
- **Retry peer** : un seul système, `utils/usePeerRetry` — pas de Map `inviteRetries` parallèle
- **Rate limiting** : un seul système, `utils/createRateLimiter`. Trois instances module-level, avec
  des clés délibérément différentes — les deux du hub star portent sur l'**identité PeerJS entrante
  réelle** (jamais `envelope.from`), `/ask-to-peer-id` sur `slug|room|connectionType`. Portée
  **module** et non closure de composable : c'est ce qui les fait survivre à un mount/unmount, sans
  quoi ils ne plafonnent rien.
  Le hub en a **deux, sur la même clé** : un plafond de **messages**, et un budget d'**octets
  retransmis** qui passe un poids à `isLimited(key, weight)` — compter des appels est le cas
  particulier où tous les poids valent 1. Un second mécanisme à côté (Map de timestamps ad hoc)
  serait la faute ; le mode pondéré est ce qui l'évite
- **Clé `remoteStreamsMap`** : `slug+type` canonique, passe unique (la double-passe historique
  venait d'une clé non fiable)
- **Identité du pair d'une entrée de `remoteStreamsMap`** : `entry.remoteSlug` — **jamais**
  `entry.metadata.from`. Sur une connexion **sortante**, `metadata.from` porte **mon** slug (cf.
  `_buildPeerConnectionConfig`), et le flux distant arrive bien sur cette connexion : filtrer sur
  `metadata.from` ne matche donc rien côté initiateur. `remoteSlug` / `remoteType` sont normalisés
  à l'écriture par `handleStreamReceived`
- **Les deux attentes du contexte ne se ressemblent pas.** `waitForPresenceSync` est **mémoïsée** :
  une promesse et un timer pour la vie du contexte, ce qui la rend sûre à appeler depuis un garde
  d'admission (cf. [securite.md](securite.md)). `waitForMeReady` **ne l'est pas** — chaque appel
  ouvre son propre `effectScope` et arme sa propre alarme de 15 s. Tout code qui la rappelle en
  boucle paie donc l'attente à chaque tour, et un flot d'appels sur un contexte jamais prêt accumule
  autant de timers. Ne pas déduire le comportement de l'une de celui de l'autre
- **Verrou de `syncUsersConnections`** : il **coalesce**, il ne jette pas. Un `return` sec sur
  verrou tenu ne perdait pas qu'une action : `getRoomUsersDiff` est l'unique écrivain de
  `usersInRoom`, `presenceSynced` et `roomMembers`, donc un tour sauté laissait **trois** états
  périmés d'un coup — dont l'allowlist de présence que lisent les deux gardes d'autorisation. Et la
  fenêtre est celle de `waitForMeReady` (jusqu'à 15 s au démarrage), c'est-à-dire le moment où la
  composition bouge le plus. On retient donc la **dernière** liste reçue pendant le tour et on la
  rejoue à la libération ; les intermédiaires sont écrasées sans être traitées, une liste de
  présence n'ayant pas d'historique. Le drain s'arrête sur `isShuttingDown` — rejouer après
  `beginShutdown()` rouvrirait ce que le teardown vient de fermer — mais les appelants coalescés
  résolvent **toujours**. Épinglé par `useConnectionPool.test.js` (§ `syncUsersConnections`)
- **Synchroniser n'est pas savoir.** `_doGetRoomUsersDiff` écrit `usersInRoom` et `roomMembers` à
  **tous** les tours, `presenceSynced` seulement sur un tour qui a **observé** quelque chose —
  `users.length > 0`, mesuré sur la liste **brute**, avant le filtrage de mon propre slug. Les deux
  moitiés comptent. Le tour sur liste vide est le **seul** capable de purger le dernier partant
  (`nextSlugs = []` ⇒ `removedUsers = previousSlugs`) : le tenir dehors laissait une room qui se
  vide garder ses fantômes dans l'allowlist que lisent les deux gardes d'autorisation. Et le
  déclarer « présence connue » ferait basculer ces gardes de « je ne sais pas encore » à « tu n'es
  pas membre » sur une ignorance. Mesurer **avant** le filtrage n'est pas un détail : le canal de
  présence me compte toujours parmi ses membres, donc `[moi]` est une observation valide — « je
  sais, je suis seul » — alors que sa projection filtrée est vide ; après filtrage, le seul tour qui
  apprend qu'il est seul passerait pour un tour qui n'a rien appris. Le drapeau est **monotone** :
  `waitForPresenceSync` est mémoïsée et ne résout qu'une fois, un retour à `false` ne réarmerait
  aucune attente — seul `destroy()` le rabaisse, avec la liste. L'écrivain reste unique, mais son
  invariant devient directionnel : **la connaissance n'avance jamais sans la liste**. Corollaire
  dans `_doSyncUsersConnections`, entre la purge et le fan-out : **pas d'observation, pas
  d'émission** — un tour vide oublie mais n'ouvre rien, sinon le premier tour du provider
  (`{ immediate: true }` sur une liste encore vide) ferait composer au client star le slug de son
  hub avant toute connaissance de la room, `requestOrConnectPeer` ne portant aucun garde
  d'autorisation sur sa première tentative. Épinglé par `usePeerConnections.test.js`
  (§ `getRoomUsersDiff`), `useConnectionPool.test.js` et `useMediaBroadcast.watchUsers.test.js`
- **Le fan-out RÉCONCILIE, il ne diffe pas.** `newUsers` est une optimisation, pas une autorité : il
  ne nomme que les **transitions** que le diff a vues, et un diff d'instantanés est aveugle à un pair
  parti et revenu **entre** les deux instantanés qu'il compare — il est alors dans `previousSlugs`
  **et** `nextSlugs`, donc dans aucune des deux listes. L'autorité est « membre de la room **et** rien
  d'établi ». Deux chemins produisent cet angle mort, et **aucun n'est un « même flush Vue »** :
  pusher-js émet un événement par frame et un flush `'pre'` est une microtâche, donc drainé entre
  deux frames. Ce sont **(a)** une coupure de présence — pusher-js réinitialise ses canaux sans rien
  émettre sur `connecting`/`disconnected`, puis rejoue `here()` avec la liste **complète** au retour,
  si bien qu'un pair qui a rechargé pendant la coupure n'a jamais été vu partir ; et **(b)** un
  rechargement chevauchant — Reverb n'émet pas `member_removed` tant que l'utilisateur tient une
  autre connexion, ni `member_added` s'il est déjà abonné
  (`InteractsWithPresenceChannels::userIsSubscribed`), donc un rechargement dont la connexion neuve
  précède le ramassage de l'ancienne ne produit **aucun** événement de présence : rien ne peut avoir
  lieu à ce tour-là, seul le tour suivant réparera, quel qu'en soit le motif. Le bail des peerId
  borne l'autre moitié du même symptôme — composer un numéro mort — et ne remplace pas celle-ci :
  sans entrée dans `newUsers`, aucun appel ne partait, et un diffuseur ne rappelait jamais le pair
  revenu. Trois bornes : le prédicat est `isConnectionEstablished` et **jamais**
  `hasOpenConnection`, qui compte pour ouverte une `MediaConnection` en `connecting` — l'état exact
  d'un pair qui vient de recharger — et qui garde d'ailleurs l'entrée de `requestOrConnectPeer`, si
  bien que la réconciliation **échoue fermée** (elle sous-tire, elle ne régresse pas) ; elle vit
  **sous** le garde « pas d'observation, pas d'émission », au-dessus duquel le premier tour du
  provider composerait une room entière de mémoire ; et elle **ne réarme pas** une chaîne de retry en
  vol (`requestOrConnectPeer(slug, type, { preserveRetry: true })`), sans quoi `attempt` repartirait
  de zéro à chaque tour de présence et l'horizon d'abandon de ≈55 s ne tomberait jamais. Réparation
  **opportuniste**, pas garantie : PeerJS ne ferme que sur `iceConnectionState` `failed`/`closed` et
  ne fait rien sur `disconnected`, donc le tour de présence peut arriver avant que la dégradation
  soit visible. Épinglé par `scenarios/peerDeparture.test.js` (« A recharge sans que B voie son
  départ ») et `useConnectionPool.test.js`
- **Garde de teardown** : `beginShutdown`/`endShutdown` est un **compteur** ré-entrant, jamais un
  booléen (deux arrêts concurrents se volaient le garde). Toujours dans un `try/finally` : une
  exception laissant `shutdownCount ≥ 1` fait sortir `_handleConnectionAttempt` par `return true`,
  ce qui **annule** les retries au lieu de les différer — plus aucune connexion ne se rétablit,
  silencieusement. Un `beginShutdown` sans `endShutdown` (teardown terminal) laisse volontairement
  le garde actif pour de bon
- **Valeur de retour de `setLocalPeer`** : ne rien en déduire. La fonction est `async` (donc
  toujours truthy) et sort par `undefined` sur tous ses chemins « rien à faire », **y compris quand
  le peer est déjà prêt** — un `if (!ready) return` est au mieux mort, au pire inversé. L'attente de
  l'identité locale se fait en aval, par `waitForMeReady`
- **`connectToPeer` : `return false` pour différer, `return true` pour abandonner.** `true` signifie
  « pas d'erreur » et **annule** le retry. Le prédicat `_canEmitStreamFor(type)` distingue « rien à
  envoyer, abandonner » de « pas encore prêt, réessayer »
- **Tentatives indépendantes dans `_handleConnectionAttempt`** : accumuler dans `settled` et ne
  décider qu'à la fin. Un `return` prématuré en fin de branche « type principal » condamne la
  tentative `screen` qui suit — les deux partagent la même chaîne de retry (`_retryKey` ne
  discrimine pas le type)
- **Flags sur objets PeerJS tiers** : interdit (pas de `conn.__ctxListenersBound`) — utiliser un
  `WeakSet` interne
- **Listeners d'objets PeerJS** : handlers nommés (ou branchés par un helper qui les mémorise) +
  unsub retourné ou stocké — jamais une arrow anonyme passée directement à `.on()`, elle serait
  irrécupérable
- **API orchestrateur** : façade explicite minimale — pas de `...spread` des composables internes
- **Stream local** : attente via `watch` réactif — pas de polling `while (!stream && attempts < N)`
- **Signalisation prête** : `watch` sur `meStore.getMe?.slug` + `peerStore.localPeer?.id` — pas de
  `setTimeout` polling
- **Un seul catalogue de types de signaux** : la table `routes` de `useSignalingQueue` remplace
  `SIGNAL_TYPES` + les deux `switch`. Avec deux sources de vérité, un type listé sans `case` était
  ignoré en silence et un `case` sans entrée était injoignable

---

## Le routage ne pose aucune précondition

`useSignalingQueue._route` n'attend rien et ne garde rien — **c'est un invariant, pas un oubli.**
Les préconditions appartiennent aux handlers et au moteur de retry, qui savent réessayer ; un
signal abandonné dans le routage l'est **définitivement** (l'émetteur ne re-livre jamais
`PEER_CONNECT_TO_REMOTE_PEER`).

Cassé une fois : un `await ctx.waitForMeReady()` et un `if (ctx.isShuttingDown.value) return`
ajoutés au routage ont fait disparaître les flux chez les arrivants, de façon **intermittente**.
`waitForMeReady` résout instantanément quand l'identité est là, mais attend 15 s puis abandonne
sinon — or `lastLocalPeerId` est remis à `null` par `_destroyPeerSingleton` dès que le compteur de
consommateurs passe à 0 (délai 10 s), fenêtre atteignable quand plusieurs providers montent/démontent
et systématiquement polluée par le HMR.

⚠️ **Ne jamais poser de garde d'autorisation ici non plus** — il va dans `connectToPeer` (voir
[securite.md](securite.md)).

---

## Cleanup obligatoire

- Tout `watch()` ⇒ `unwatch()` dans `onUnmounted`
- `setUpConnectionListeners` ⇒ retourne un unsub appelé au démontage du contexte
- Timers `setTimeout` de backoff ⇒ référence stockée et annulée dans `_destroyPeerSingleton`
- Listeners du **Peer** ⇒ branchés par le helper `bind` de `_doInit`, débranchés par
  `peerStore.detachPeerListeners()` **avant** `peer.destroy()` (voir ci-dessus)
- `contextRegistry` ⇒ entrée supprimée dans `onUnmounted` **seulement si elle appartient toujours
  au contexte** — un contexte fraîchement monté doit pouvoir reprendre l'id d'un contexte en cours
  de démontage (`last-write-wins` volontaire, cf. [securite.md](securite.md))
- **Flux distants** ⇒ `handleStreamReceived` écoute `ended` / `inactive` sur les pistes du flux reçu.
  En mode `stream` aucun player n'est créé, donc `usePeerMedia._bindStreamCleanup` ne tourne pas et
  le registre ne dépendrait que des événements de fermeture PeerJS : un flux mort sans `close`
  laissait une vignette figée. Écouteurs `{ once: true }` et handler idempotent (l'entrée n'est
  supprimée que si elle porte toujours **ce** flux) — aucune désinscription à tenir.
  ⚠️ Garde `typeof stream.getTracks === 'function'` **en plus** de `instanceof MediaStream` :
  happy-dom expose la classe sans implémenter `getTracks`

---

## Timers armés avant l'effet qu'ils surveillent

`waitForMeReady` assignait son `timeoutId` **après** `scope.run()`, alors que le `watchEffect`
s'exécute immédiatement : sur une identité déjà prête, `_resolve(true)` faisait
`clearTimeout(null)`, le timer survivait et crachait un faux `waitForMeReady a expiré après
15000 ms` 15 s plus tard sur un contexte sain — plus une fuite de timer par appel. Le `setTimeout`
est armé **avant** `scope.run()`.

---

## Pour aller plus loin

- Les séquences complètes (appel, join, départ) : [flux.md](flux.md)
- Surface publique et bornes de configuration : [api.md](api.md)
- Modèle de confiance et décisions sécurité : [securite.md](securite.md)
- Harnais de tests et pièges de mock : [tests.md](tests.md)
- Ce qui reste ouvert : [`work/webrtc2-todo.md`](../../../work/webrtc2-todo.md)
