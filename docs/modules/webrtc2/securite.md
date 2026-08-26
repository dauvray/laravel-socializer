# WebRTC2 — Sécurité

> **À quoi ça sert :** le modèle de confiance, les décisions d'architecture sécurité et leur
> justification, et le **périmètre réel** de ce qui est durci aujourd'hui.
> **Quand le lire :** avant d'ouvrir un chemin de connexion, de relayer un payload, ou de
> conclure que « la sécu est faite ».

**Sommaire** — [Périmètre réel](#périmètre-réel--à-lire-en-premier) ·
[Modèle de confiance](#modèle-de-confiance) ·
[Sens entrant](#décisions-en-vigueur-sens-entrant-mai-2026) ·
[Sens sortant](#décisions-en-vigueur-sens-sortant-août-2026) ·
[Backend](#décisions-en-vigueur-backend-août-2026) ·
[Rafraîchissement TURN](#le-rafraîchissement-du-credential-turn) ·
[Bornes non fermées](#bornes-non-fermées-connues)

---

## Périmètre réel — à lire en premier

| Direction | État | Détail |
|---|---|---|
| **Entrant** (`peer.on('connection')`, `peer.on('call')`) | durci **côté client**, borné côté serveur — audits du 20/05 et du 14/08/2026 | garde `_isAuthorizedIncomingPeer`, anti-usurpation inconditionnelle, gardes de taille, sanitisation. Reste aveugle au membre de room qui se présente avec un peerId neuf sous le slug d'un autre ; le garde de relation serveur borne désormais qui peut tenter |
| **Sortant** (`connectToPeer`, `responseRemotePeerConnection`) | durci **côté client**, garde autoritatif posé côté serveur | prédicat unique `utils/isAuthorizedPeer.js` : membre de la room **ou** interlocuteur d'appel marqué — [décisions](#décisions-en-vigueur-sens-sortant-août-2026). Son jumeau serveur `Socializable::mayReach` tranche ce que le navigateur ne peut pas voir |
| **Backend** (`UserController`, routes) | durci | `fromUserSlug` authentifié, liste blanche de champs, `throttle` par utilisateur (deux buckets), `validate()` sur les 5 payloads, **contrôle de relation** émetteur ↔ destinataire en 403 uniforme, et **liste de contacts restreinte aux joignables** sauf permission `list_users` |
| **Credentials TURN** | servis par le serveur, **éphémères et signés par utilisateur**, **rafraîchis côté client** | `GET /get-ice-servers` : STUN seul pour un invité, STUN + TURN pour une session authentifiée. TURN REST API — `username = "<expiry>:<userId>"`, `credential = base64(HMAC-SHA1(secret, username))`, TTL 24 h annoncé par `credential_ttl` et renouvelé avant échéance par le transport ([détail](#le-rafraîchissement-du-credential-turn)). Un abus est donc attribuable, plafonnable par personne et révocable en bloc. Le mode statique partagé reste servi si aucun secret n'est configuré, pour ne pas casser un coturn encore en `--user` |

**La leçon réutilisable, et la seule qui compte : un garde d'admission ne sécurise qu'une
direction.** Tout chemin qui *ouvre* une connexion doit porter le sien.

L'audit de mai portait sur le sens **entrant** seulement, tout en étant marqué « clôturé — toutes
les failles corrigées ». **C'est pourquoi ce fichier énonce un périmètre plutôt qu'un verdict** : un
verdict global sur « la sécurité » ne survit pas à la première direction qu'on n'a pas regardée.

### La chaîne d'attaque du sens sortant, et pourquoi il faut DEUX gardes

**La forme.** Un authentifié quelconque POSTe `/response-to-peer-id` en se donnant pour un
interlocuteur légitime de sa victime, sur un `type`/`room` correspondant à un contexte monté chez
elle. Le signal est relayé, routé, et `connectToPeer` appelle le peerId annoncé : **si la victime
diffuse, c'est elle qui ouvre la connexion média** et pousse sa webcam vers l'attaquant
(`connectionType: 'screen'` donne l'écran). Aucune appartenance à la room n'est requise, et
`_isAuthorizedIncomingPeer` ne s'exécute pas — il ne garde que l'entrant.

**Pourquoi le registre `authorizedCallPeers` existe.** En variante `type: 'data'`, le contexte
`data-app` étant monté en permanence pour tout connecté, le canal est disponible en continu — et
l'écriture inconditionnelle d'`addRemotePeerId` **empoisonnait le mapping qui sert d'allowlist** au
chemin (b) de `_isAuthorizedIncomingPeer` : l'attaquant s'auto-inscrivait comme « interlocuteur
d'appel direct vérifié » sans qu'aucun appel n'ait été autorisé. D'où un registre distinct du
mapping, décrit dans
[« Décisions en vigueur (sens sortant) »](#décisions-en-vigueur-sens-sortant-août-2026).

> **Fermée à ses deux bouts — et aucun des deux gardes ne rend l'autre redondant.** Côté client,
> `utils/isAuthorizedPeer.js` coupe dans `connectToPeer`, avant `addRemotePeerId`, et sur la
> livraison du peerId qui l'alimente. Côté serveur, `Socializable::mayReach` coupe au relais.
>
> Un attaquant **en relation** avec sa victime (même groupe, ou follow réciproque) passe le garde
> serveur en toute légitimité, et seul le garde client l'arrête ; un client modifié retire son
> propre garde, et seul le serveur l'arrête. C'est un attaquant du premier type que modélise
> `scenarios/outgoingAuth.test.js`, en désarmant le garde entrant de mallory pour reproduire ce
> qu'un bundle patché donne.

⚠️ Deux pièges à ne pas défaire en touchant à ce chemin :
- **Ne pas** déplacer le garde dans `useSignalingQueue` — l'absence de précondition dans le routage
  est un invariant, déjà cassé une fois avec des flux disparus chez les arrivants.
- `return false` et **non** `true` : `true` signifie « pas d'erreur » et **annule** le retry.

---

## Modèle de confiance

WebRTC2 **n'implémente pas de chiffrement de bout en bout (E2E) applicatif**. Le transport WebRTC
reste chiffré au niveau réseau (DTLS/SRTP entre pairs), mais en topologie star le hub déchiffre
nécessairement les enveloppes pour les retransmettre.

**Mesh** — les payloads transitent **directement** entre pairs. Aucun tiers applicatif ne les voit
en clair. Pas de modération centralisée possible : chaque pair reçoit indépendamment.

**Star** — le hub lit `envelope.payload` en clair avant retransmission. C'est un **choix
d'architecture délibéré**, qui rend possibles côté hub :
- le rate-limiting par identité PeerJS vérifiée (`_isHubRateLimited`) ;
- la garde de taille (`MAX_PAYLOAD_BYTES`) ;
- le filtrage des destinataires (`envelope.to` ∩ `usersInRoom`) ;
- la **modération applicative** (prof relayant des messages d'élèves, filtrage, journalisation).

Si le hub est compromis (compte usurpé, machine vérolée), il a accès à toutes les conversations data
transitant par lui. Le modèle de menace par défaut suppose le hub **honnête** — même modèle qu'un
serveur de visioconférence centralisé classique.

### Recommandations d'usage

| Cas d'usage | Topologie | Justification |
|---|---|---|
| Cours prof/élèves, room modérée | **star** (hub = modérateur) | la visibilité du hub *est* la fonctionnalité ; l'E2E la casserait |
| Réunion fermée ≤ `MAX_PEERS_PER_ROOM` | **mesh** | pas de tiers applicatif, payloads jamais centralisés |
| Non-divulgation au serveur exigée | **mesh uniquement** | aucun chiffrement applicatif supplémentaire n'est fourni |
| Très grande room avec messages sensibles | **non supporté** | star n'offre pas la confidentialité hub-opaque ; mesh ne passe pas à l'échelle |

### E2E applicatif : pourquoi pas

Un chiffrement symétrique côté client (AES-GCM via Web Crypto) au-dessus du transport star aurait
un coût d'implémentation important — rotation de clé à chaque join/leave pour la forward secrecy,
échange de clés sans révélation au hub, vérification d'identité des clés, SFrame/Insertable Streams
pour la visio — **et rendrait la modération par le hub impossible**, donc incompatible avec le cas
d'usage principal. La décision est de privilégier la modération et d'expliciter la limitation
plutôt que d'ajouter une couche partiellement utile.

Si un cas d'usage futur impose la confidentialité vis-à-vis du hub, la voie recommandée est de
**basculer la room en mesh**, pas d'introduire de l'E2E par-dessus star.

---

## Décisions en vigueur (sens entrant, mai 2026)

### Identité : jamais le champ déclaratif

L'identité de l'émetteur se lit **toujours** depuis la connexion — `resolveRemoteSlug`, authentifié
à l'admission — jamais depuis un champ du payload.

- Le hub résout le slug réel depuis le `contextRegistry` (identité PeerJS de la connexion entrante)
  et **ignore `envelope.from`** comme source de vérité. `forwardStarMessage` abandonne quand
  l'expéditeur n'est pas résolu : la retransmission n'est pas usurpable.
- Le rate-limiting du hub porte sur cette identité réelle, **jamais** sur `envelope.from` — sinon un
  client contourne son plafond en faisant tourner le champ.
- Côté backend, `fromUserSlug` broadcasté est toujours `Auth::user()->slug`, jamais la valeur du
  payload ; `closeConnectionToPeerId` journalise tout écart (`auth_user_id`, `claimed_slug`,
  `target_slug`, `ip`, `user_agent`).

### `_isAuthorizedIncomingPeer` — deux chemins disjoints

Un pair entrant est admis par **(a)** appartenance à `ctx.connection.usersInRoom` (présence Reverb),
**ou** **(b)** appel direct vérifié : `peerStore.getRemotePeerId(from)` existe **et** correspond à
`conn.peer` — allowlist et anti-usurpation fusionnées en une seule condition stricte.

L'anti-usurpation par **résolution inverse** — le peerId réel de la connexion ne doit être résolu à
aucun **autre** slug — s'applique ensuite aux **deux** chemins. Sur (b) elle n'est pas redondante :
la concordance n'y est vérifiée que dans le sens slug → peerId, et laissait donc passer un pair dont
le peerId identifie *aussi* quelqu'un d'autre. Ce qu'elle ne fait **jamais**, c'est conclure sur une
non-résolution — voir « Le mapping peerId n'existe pas à l'admission » ci-dessous.

### Le mapping peerId n'existe pas à l'admission, sur le chemin présence

Mesuré, pas supposé (`scenarios/incomingMappingInvariant.test.js`) : quand une connexion entrante
arrive par le chemin (a) — arrivant tardif, partage d'écran — `peerStore.getRemotePeerId(from)` est
**vide**. La cause est structurelle : le mapping du récepteur est écrit par **sa propre**
`connectToPeer`, donc quand c'est LUI qui ouvre ; sur la présence, le premier contact est l'appel
**entrant** de l'autre, qui arrive nécessairement avant. Sur l'appel direct c'est l'inverse —
`acceptCallFromPeer` écrit le mapping avant même de répondre à l'invitation. Les deux chemins sont
opposés par construction ; aucun réglage de timing ne les rapprochera.

Conséquence de conception : « peerId non résolu » ne vaut **pas** refus, sous peine de fermer toute
diffusion en room. L'admission est accordée et tracée (`console.debug`, « Admission entrante non
corroborée ») — la trace mesure la surface que le contrôle backend devra couvrir.

### Le bail des peerId ne touche pas l'allowlist

Le mapping `remotePeersId` porte depuis le 26/08/2026 un **bail** (`REMOTE_PEER_ID_LEASE_MS`,
cf. [architecture.md](architecture.md#un-onglet-plusieurs-contextes--la-granularité-des-clés-du-store)).
Trois faits, à ne pas relire de travers :

1. **Le bail ne concerne qu'un seul des trois lecteurs du mapping.** Composer un appel
   (`getDialableRemotePeerId`, lu uniquement par `useConnectionPool`) est sous bail ;
   l'allowlist du chemin (b) (`getRemotePeerId`) et la résolution inverse anti-usurpation
   (`getSlugByRemotePeerId`) sont **aveugles au temps**.
2. **Un anti-usurpation périmable serait un contournement planifiable par l'attaquant** : il
   n'aurait qu'à attendre l'expiration du bail pour que `resolvedSlug` revienne `null` et que
   le refus sur contradiction cesse de mordre. C'est la raison pour laquelle une expiration ne
   supprime jamais l'entrée — elle filtre une **lecture**, elle ne purge pas.
3. **Le bail n'ajoute aucun écrivain du mapping.** En particulier, aucune annonce du type
   « j'ai rechargé, voici mon peerId neuf » : ce serait l'auto-inscription décrite plus haut
   remise en service. Les trois écrivains restent `usePeerConnections.connectToPeer` et les
   deux de `useCallManager`, chacun derrière son garde.

Épinglé par `usePeerTransport.incomingAuth.test.js` (« admet encore un interlocuteur d'appel
direct dont le bail a expiré », « refuse encore une usurpation dont le bail a expiré ») et par
`peers2Store.remotePeerId.test.js` (« `getSlugByRemotePeerId` est AVEUGLE au bail »).

⚠️ **`ctx.session.currentCallUsers` ne peut pas servir d'allowlist.** C'est un état **UI** (qui voir,
qui raccrocher) ; le réutiliser comme politique de sécurité couplerait affichage et autorisation.
Cet usage a été explicitement retiré. Le chemin (b) l'a remplacé.

Historique utile : la règle (a) seule fermait les appels **directs** 1-à-1 entre users sans room
commune — remote bloqué en « pending ». C'est la non-régression à ne jamais casser en durcissant
l'admission.

### Une liste vide n'est pas une réponse

`usersInRoom` vide ne dit pas « ce pair n'est pas membre », il dit « je ne sais pas encore qui est
membre ». Les deux gardes qui lisent le chemin (a) — `_isAuthorizedIncomingPeer` et
`responseRemotePeerConnection` — **attendent la première synchronisation de présence du contexte
avant de refuser** (`ctx.waitForPresenceSync`, adossé au fait `connection.presenceSynced` qu'écrit
l'unique écrivain de `usersInRoom`). Jamais avant d'admettre : le chemin (b) reste immédiat, donc la
visio n'est pas ralentie et `data-app` — qui n'a aucun canal de présence — n'attend rien.

Sans cette distinction, tout contact légitime reçu pendant le démarrage d'un contexte est refusé, et
**aucun des deux refus n'est rattrapable** : la re-demande du pair distant n'arrive que 12 s plus
tard (`SIGNALING_STALE_MS`), et une MediaConnection refusée n'est notifiée à personne (PeerJS ne
signale pas le `close()` d'un appel jamais répondu) — l'émetteur voit son `peerConnection` en
`connecting`, donc `hasOpenConnection` vraie, donc son moteur de retry s'arrête. L'ordre de
production met systématiquement l'arrivant du mauvais côté : son `usersInRoom` n'est écrit qu'après
`waitForMeReady` (donc après le peerId local), alors que la demande du diffuseur ne coûte qu'un
aller-retour HTTP + Reverb.

L'attente est **mémoïsée par contexte** : une promesse et un timer, pour la vie du contexte, quel
que soit le flot de connexions refusées.

**Faille résiduelle connue, chemin (a) — non fermable côté client.** Un membre de la room qui ouvre
un **second** `new Peer()` (UUID neuf, donc non mappé) obtient `resolvedSlug = null` et est admis
sur la seule foi d'un `metadata.from` déclaratif qui n'a qu'à nommer un autre membre. Il parle alors
sous l'identité de l'usurpé : chat, `BROADCAST_STATE` et `AUDIO_MUTE_TOGGLE` lisent tous
`resolveRemoteSlug`. Le durcissement côté client a fait ce qu'un client peut faire — rejeter la
résolution **contradictoire** sur les deux chemins, tracer l'admission non corroborée — mais le cas
nominal de la présence et l'usurpation ont ici la **même signature locale** : slug déclaré membre,
peerId inconnu. Les distinguer demande une source de vérité que le récepteur n'a pas.

La fermeture appartient donc au backend, seul détenteur du lien `Auth::user()` ↔ peerId relayé
Ne pas lire cette règle comme une défense-en-profondeur : sur le chemin (a) elle est le
**seul** anti-usurpation, et elle est incomplète.

### Gardes de taille — trois points, une mécanique

`MAX_PAYLOAD_BYTES` est appliqué à l'**émission** (`sendData` mesh), à la **retransmission**
(`forwardStarMessage`) **et** à la **réception** (`handleData` de `createPeerContext`, avant le
callback métier). Le contrôle en réception est de la défense-en-profondeur : les deux premiers sont
contournables par un pair qui retire le check client.

Logique mutualisée dans `Composables/utils/payloadSize.js` (`getPayloadSizeBytes`,
`isPayloadWithinLimit`) — source de vérité unique pour les trois points. `envelope.to` est filtré
par `isValidSlug` **et** croisé avec les membres réels de la room avant retransmission.

### Le hub porte deux plafonds, et le second est celui qui compte

Un plafond par message et un plafond par émetteur ne bornent pas leur **produit**. Le coût réel
d'une retransmission star est `octets × destinataires` : à 100 membres, 20 msg/s de 64 Ko font
sortir ~128 Mo/s d'un onglet navigateur, et chaque message pris isolément est parfaitement légal.
D'où `HUB_MAX_BYTES_PER_WINDOW`, plafond du **coût agrégé**, sur la même clé que le plafond de
messages (identité PeerJS entrante réelle).

**La sémantique est celle du total déjà dépensé, pas du total + le message courant** : un fan-out
isolé dont le coût dépasse à lui seul le budget passe, et consomme sa fenêtre. Sans quoi le premier
message d'une grande room serait refusé au lieu du centième — c'est l'amplification *soutenue* qui
est le risque, pas un gros envoi.

La règle générale, valable au-delà de ce chemin : **un garde par unité ne borne jamais un produit.**
Deux plafonds justes sur deux facteurs différents laissent leur multiplication libre.

### `contextRegistry` : last-write-wins volontaire

Si deux contextes partagent le même `contextId` (même `type` + même `room`), le second écrase le
premier. **Les deux pistes de correction ont été écartées** :

1. *suffixe aléatoire* — le `contextId` doit rester **déterministe et identique entre pairs** :
   l'appelant envoie son `contextId` comme `callbackKey`, résolu sans fallback côté récepteur ;
2. *refus d'enregistrement* — casse le remontage : un contexte fraîchement monté doit pouvoir
   reprendre l'id d'un contexte en cours de démontage.

Durcissement retenu : `unregisterContext` ne supprime l'entrée **que si elle appartient toujours à
ce contexte** — sinon l'`onUnmounted` d'un ancien contexte effacerait l'entrée détenue par le
nouveau, qui ne recevrait plus aucune connexion entrante. Le risque résiduel (usurpation de
`callbackKey` par un pair distant) est couvert en aval par `_isAuthorizedIncomingPeer`.

### `conn.metadata` : trois gardes, dont un de position

`conn.metadata` est un objet **du réseau**. Trois choses le bornent, et elles ne se remplacent pas.

**1. La taille, à l'admission — et sa position fait le garde.**
`isPayloadWithinLimit(metadata, …, MAX_METADATA_BYTES)` est la **première** instruction des deux
dispatchers entrants (`bind('connection')`, `bind('call')`), avant la résolution de contexte. La
raison n'est pas l'économie : les `console.warn` de non-résolution journalisent l'objet **entier**,
et c'est le pair distant qui décide de les déclencher — il contrôle `callbackKey`, donc le fait
qu'aucun contexte ne se résolve. Un garde placé après eux serait vide de son objet. C'est un
**quatrième point d'application** de `payloadSize.js`, pas une seconde mécanique.

**2. Les champs, par liste blanche.** `sanitizeMetadataType` (liste blanche
`VALID_CONNECTION_TYPES`, rejet) et `sanitizeMetadataName` (longueur bornée, **troncature**) — un
type hors liste n'a aucun repli utilisable, un nom trop long en a un : lui-même, coupé.

**3. Ce qui atteint l'interface, par liste blanche aussi.** `useStreamManager` recopiait la metadata
distante par un spread `...meta` : **toute** clé du pair distant traversait donc jusqu'à
`streamData.metadata`, et ce que le player en fait n'est pas inerte — `countViewers` est **rendu en
texte** et `roomId` devient le `wrapperId` de la directive `v-resize`
(`MediaBroadcastPlayer.vue`). Aucun producteur local ne posait ces deux clés sur ce chemin : elles
ne pouvaient venir que du réseau. Sept champs explicites les remplacent, `roomId` étant **dérivé**
de `room` et les deux drapeaux coercés en booléens.

> **Une liste noire ne ferme pas des champs, elle ferme ceux qu'on connaissait le jour où on l'a
> écrite.** Même leçon que côté backend, ici sur le front. Les deux producteurs de
> `streamData` — `useStreamManager` et `Exemples/StreamSimple/StreamSimpleUI.vue` — doivent
> s'accorder sur cette liste ; ajouter un champ demande de vérifier ce que le player en fait.

⚠️ **Le registre `remoteStreamsMap` conserve la metadata brute**, lui. Le mode **diffusion** ne
passe pas par `createVideoElement`, donc pas par la liste blanche : il rend le registre
directement, et c'est `StreamSimpleUI` qui borne le nom à l'affichage. Deux chemins de rendu, deux
points à tenir.

**Toujours pas de XSS** : aucun `v-html` ni `innerHTML` dans le module, Vue échappe l'interpolation.
Ce qui est borné ici, c'est la **mise en page** et les **logs** — et le rejet lui-même ne journalise
jamais la valeur rejetée, seulement sa taille et son genre.

### Fuites mémoire fermées

Les fenêtres de rate-limiting purgent leur clé quand elle devient vide (sinon la Map grossit
indéfiniment au fil des rotations de room). La mécanique — fenêtre glissante + balayage throttlé —
vit dans `Composables/utils/createRateLimiter.js` : **un seul système** pour les deux plafonds du hub
star et pour `/ask-to-peer-id`, avec des clés délibérément différentes. Le budget d'octets n'y ajoute
pas un second mécanisme : il passe un **poids** à `isLimited(key, weight)`, dont le comptage d'appels
est le cas particulier (poids 1).

---

## Décisions en vigueur (sens sortant, août 2026)

### Un prédicat unique, quatre lecteurs

`Composables/utils/isAuthorizedPeer.js` répond à une seule question — « ai-je le droit d'ouvrir une
connexion vers ce pair ? » — et rend `true` sur **exactement les deux chemins** de l'admission
entrante : slug valide, **et** (membre de `connection.usersInRoom`, **ou** inscrit dans
`session.authorizedCallPeers`). C'est un utilitaire pur, sans état, importable de partout ; la
symétrie avec `_isAuthorizedIncomingPeer` est délibérée, une seule définition de « pair légitime »
par contexte.

Il est lu à quatre endroits, dont **deux sont des gardes** :

| Lecteur | Ce qu'il décide | Refus |
|---|---|---|
| `usePeerConnections.connectToPeer` | ouvrir une connexion — appelé **avant** `addRemotePeerId` | `return false` (diffère) |
| `usePeerCore.responseRemotePeerConnection` | livrer mon peerId au demandeur | `return false` (le demandeur re-demandera) |
| `useConnectionPool` (moteur de retry) | « ce pair me concerne-t-il encore ? » quand ni peerId ni demande en vol | abandon du retry |
| `usePeerTransport` (recovery `peer-unavailable`) | quels contextes relancent la demande de peerId | ne relance pas |

Les deux derniers ne sont pas des gardes de sécurité : ils réutilisent la définition parce qu'elle
est la bonne. Distinguer « ce pair est parti » de « je ne lui ai pas encore demandé » se fait sur la
**présence**, pas sur un drapeau de bookkeeping — et le second chemin du prédicat
(`authorizedCallPeers`) est précisément ce qui préserve la visio 1-à-1, qui n'a aucune room commune.

**Le garde de `connectToPeer` va au plus tôt, pas dans la section critique.** Le plan d'origine le
voulait après l'acquisition du verrou `inFlightConnections` ; c'est inutile — `connectToPeer` est
**entièrement synchrone**, rien ne peut s'intercaler entre la lecture de `usersInRoom` et
`peer.call()`. L'exigence réelle est « avant `addRemotePeerId` » : cette écriture vit **hors** du
verrou, et empoisonner le mapping est la seconde moitié de la faille — le mapping sert d'allowlist
au chemin (b) de l'admission entrante, donc un attaquant qui s'y inscrit s'auto-délivre un brevet
d'« interlocuteur d'appel vérifié ».

**Le second garde ne peut casser aucun chemin que le premier n'ait déjà fermé** : c'est le *même*
prédicat sur le *même* contexte. Refuser de livrer son peerId à un pair vers lequel `connectToPeer`
refuserait d'ouvrir ne retire rien. La symétrie tient parce que les deux chemins d'autorisation sont
eux-mêmes symétriques : `usersInRoom` vient du même canal Reverb pour les deux parties, et
`authorizedCallPeers` est marqué **des deux côtés** par `useCallManager` (`acceptCallFromPeer` chez
l'appelé, `openCallBetweenPeer` chez l'appelant).

Sur le chemin présence, ces deux gardes attendent la première synchronisation avant de **refuser** —
voir [« Une liste vide n'est pas une réponse »](#une-liste-vide-nest-pas-une-réponse), qui est né
d'une régression de ce garde-ci.

### Tout chemin qui ÉCRIT dans l'allowlist en porte un aussi

C'est le corollaire que le premier durcissement avait manqué, et il vide le garde s'il manque : une allowlist ne
vaut que ce que valent les écritures qui la remplissent.

`useCallManager.openCallBetweenPeer` traite l'acceptation d'un appel. Il écrivait
`addRemotePeerId` **et** `markAuthorizedCallPeer` *avant* la transition de FSM — laquelle refuse
bien IDLE → CONNECTED, donc aucune session ne démarrait, **mais les deux écritures avaient déjà eu
lieu**. Un POST forgé sur `/response-to-authorization-peer` avec `status: true` vers une victime qui
n'a jamais invité personne l'inscrivait donc dans `authorizedCallPeers`, ce qui lui ouvrait ensuite
les **deux** sorties du contexte. Les durcissements du seul chemin de connexion étaient contournés par la route de réponse.

> **La FSM ne protège que ce qui la suit.** Un garde d'état placé après des écritures ne les annule
> pas — il fait seulement croire qu'il les gouverne.

L'acceptation exige désormais une **invitation en vol** : `peerStore.hasWaitingRemotePeerId(slug,
room, type)`, sur la clé composite exacte qu'a écrite `requestAuthorizationRemotePeerId`, lue avant
toute écriture et consommée ensuite. Un garde indexé sur le slug seul passerait sans rien voir. Ce
cas-là, le client peut le trancher **seul** — « ai-je invité ce pair ? » est un fait purement local,
contrairement à l'usurpation intra-room.

⚠️ **Le `contextId` de la demande n'est volontairement pas contrôlé**, bien que le store soit
partagé par l'onglet. `openCallBetweenPeer` ne s'exécute que dans le contexte de `Notifications.vue`
(seul destinataire de `.ResponseToAuthorizationPeer`), alors que `startCallWithPeer` est exposé par
**toute** instance de `useMediaBroadcast` : une invitation partie d'un provider de room porte donc
un autre `contextId`. L'exiger fabriquerait une régression. Le fait qui compte est « cet onglet a
invité ce pair » — le test correspondant est **inversé** et vire au rouge si un contrôle de
`contextId` se glisse un jour.

Deux durcissements joints, même classe de défaut — le payload vient du réseau : `addRemotePeerId`
est conditionné à la présence de `options.peerId` (l'écriture inconditionnelle mappait `undefined`,
et un `options` absent levait un TypeError dans un handler `async`), et la branche `!payload.status`
(refus distant) est laissée morte en connaissance de cause, `Notifications.vue` traitant le refus
sans passer par là.

> **Le piège de harnais qui a failli faire passer tout ceci pour du nominal.** Les blocs de tests
> « nominaux » de `openCallBetweenPeer` et de `responseRemotePeerConnection` décrivaient, sans le
> dire, le chemin que ces gardes ferment : le premier appelait bien `startCallWithPeer` mais sur un
> `core` mocké qui n'enregistrait **aucune** demande en vol, le second répondait à `bob` avec un
> `usersInRoom` vide. Un `beforeEach` qui pose la précondition n'est pas un assouplissement du
> test — c'est l'inverse. Quand un garde nouvellement posé laisse une suite entière verte,
> l'hypothèse à écarter en premier est que le harnais décrivait déjà le trou.

---

## Décisions en vigueur (backend, août 2026)

### Le garde de relation — `Socializable::mayReach`

Les 5 routes de signalisation exigent un lien entre l'émetteur et le destinataire : **même groupe
MariaDB OU follow réciproque**. C'est le jumeau serveur de `utils/isAuthorizedPeer.js`, et la
**seule** fermeture possible de l'usurpation intra-room, pour la raison exposée plus haut — d'où le
fait qu'il vive côté serveur et non côté client.

**Pourquoi symétrique.** L'invitation d'appel est un broadcast *fire-and-forget* : **aucune
invitation n'est persistée côté serveur**, donc `responseToPeerAuthorization` n'a rien contre quoi se
valider. Avec une relation asymétrique il aurait fallu l'inverser sur la route de réponse (« mon
interlocuteur aurait-il eu le droit de m'appeler ? ») — une seconde règle à tenir juste. La symétrie
l'évite, et permet une seule entrée de cache par paire non ordonnée.

**Pourquoi pas le chat 1-à-1 comme troisième voie.** `conversations()` serait un prédicat
**auto-servi** : `/get-or-create-chat-room` crée une conversation avec n'importe qui, donc un
attaquant s'octroie la relation en une requête.

> **« Pas de relation ⇒ pas de contact » est la règle voulue, pas un trou de couverture.** Un compte
> sans follow réciproque ni groupe commun ne joint personne : c'est ce que le garde énonce. Mesurer
> que 10 comptes de la base sur 12 n'ont aucun groupe ne décrit pas une règle trop stricte, ça décrit
> des comptes sans relations.
>
> **Avant de proposer d'assouplir ce garde, exhiber un scénario légitime nommable qu'il bloque — pas
> une statistique.** Sur des données clairsemées la statistique est toujours alarmante et ne prouve
> rien. Le seul scénario réel trouvé jusqu'ici est la room `privacy == 0`, que `Server::getRoom()`
> ouvre à tout authentifié ; il se tranche par une requête sur les données, pas par un arbitrage.

### Deux pièges du graphe que ce garde contourne

**1. `canJoinRoom` n'est pas un prédicat d'appartenance.** `u` y est *n'importe quel* utilisateur
enregistré, pas l'appelant, dont le `vertexid` ne pèse que sur la branche `privacy == 1`. Sur une
room publique la requête renvoie une ligne dès qu'un membre quelconque existe : **`true` pour tout
le monde**. (Effet miroir : une room publique **vide** renvoie `false`, même à son propriétaire.)
C'est un garde de **canal Reverb** ; l'employer comme garde de relation rendrait le contrôle
contournable en nommant une room publique.

> ⚠️ **La règle générale, dont ceci n'est qu'un cas : un garde doit conditionner le résultat
> entier, jamais l'ensemble qu'on énumère dedans.** Ici la clause de confidentialité restreint `u`
> — la variable *énumérée* — au lieu de décider si la requête doit rendre quoi que ce soit. Deux
> défauts en sortent, selon le sens de lecture, et **ils ont la même cause** :
> - en **prédicat**, il accorde à tort (`privacy == 0` ⇒ vrai pour tout le monde) ;
> - en **agrégat**, il sous-compte (une clause qui restreint le membre compté au demandeur rend
>   toujours 1).
>
> Le remède est le même dans les deux cas : sortir la décision d'accès en prédicat distinct, puis
> énumérer sans restriction. C'est ce qui a réparé `nb_users` de `Services\Server::getServer` par
> construction, sans que le compteur soit pris pour lui-même.
>
> ⚠️ **Sous-évaluer n'est pas fuir.** Un agrégat sous-compté ne divulgue rien : c'est le
> *correctif* qui touche la visibilité, en ouvrant un chiffre sur un objet privé. Un tel correctif
> ne vaut donc qu'accompagné de son test de non-régression sur le refus — ici
> `tests/Feature/Server/ServerAccessTest.php`, qui vérifie qu'un non-membre ne voit toujours pas le
> serveur.

⚠️ **Ne pas généraliser de lui à ses deux sœurs, qui sont bien des prédicats d'appartenance** :
`canJoinchatRoom` et `canJoinServer` en sont bien, eux (`ChannelGuardTest`).

**2. L'appartenance à un groupe vit dans MariaDB, et plus aucun garde ne la lit ailleurs.**
L'arête `user -[:registered_in]-> group` est **synchronisée** à l'attachement et au détachement : le
pivot `GroupUser` du socle émet `GroupUserCreated` / `GroupUserDeleted` — `->using()` est déclaré
des deux côtés de la relation, sans quoi aucun événement ne partirait — et les listeners **de ce
paquet** posent puis retirent l'arête. Sur Laravel 13, `attach`/`detach`/`sync` passent tous par le
modèle de pivot, y compris `detach()` sans argument : ce ne sont pas des trous.

Elle dérive quand même, et **toujours dans le sens qui accorde** — un trou y laisse une arête *en
trop*, jamais en moins, donc personne ne s'en plaint :

| Chemin | Ce qui se passe |
|---|---|
| **écriture de réplica refusée** | `ToleratesGraphFailure` la rattrape **par décision** — MySQL ne doit pas échouer parce qu'une copie n'a pas pu être écrite. Journalisée, jamais réparée |
| suppression de groupe hors Eloquent | ne passe pas par `deleting`, donc aucun listener |
| `group_user` vidé par la cascade SQL | les lignes partent sans événement de pivot |
| rattachements antérieurs aux listeners | arête jamais posée — le seul trou qui *refuse* ; `socializer:nebula-populate` le rattrape |

⚠️ **La suppression d'un groupe par Eloquent, elle, ne dérive pas** : `Users::deleteGroup` fait un
`deleteVertex(…, WITH EDGE)` qui emporte les `registered_in` entrantes.

⚠️ **`socializer:nebula-populate` ne répare pas cette dérive-ci.** `projectUsers()` repose les
arêtes manquantes mais est **purement additive** : aucune étape de `GraphProjection` ne supprime une
arête `registered_in` orpheline.

**D’où la décision du 24/08/2026 : `canJoinServer` a cessé de lire l'appartenance dans le
graphe.** Il n'y demande plus que ce dont le graphe est maître — la confidentialité du sommet
serveur et le groupe qui le possède — puis interroge `group_user`. Les quatre chemins ci-dessus
basculent ainsi en **refus**, puisqu'une ligne pivot absente est précisément ce qu'ils produisent
tous. Les deux autres lecteurs de la même clause, `Services\Server::getServer` et le pré-contrôle
`checkServerAccess` du front, passent par le même garde (`ServerAccessTest`) — trois copies d'une
règle d'accès divergent toujours.

⚠️ **Ce qui reste ouvert, et qui n'est plus un sujet de sécurité.** `Socializable::servers()`,
`Server::getServers` et le compteur `nb_users` continuent de lire `registered_in` : la qualité du
réplica reste un sujet de **données**. De même, `user -[:registered_in]-> room` n'est posée que pour
le **créateur** de la room — aucune route « rejoindre une room » ne l'ajoute.

> ⚠️ **Deux listeners homonymes sont abonnés au même événement**, un par paquet :
> `Dauvray\Estarter\app\Listeners\GroupUserCreatedListener` est entièrement commenté,
> `Dauvray\Socializer\app\Listeners\GroupUserCreatedListener` fait le travail. Ouvrir le premier
> fait conclure que rien ne se propage.

> **La leçon durable : le graphe est un réplica, pas une source de vérité.** Un garde qui l'interroge
> pour une donnée dont MySQL est le maître hérite de tous les trous de sa synchronisation — et ici le
> trou **accorde** au lieu de refuser, donc personne ne s'en plaint et il dérive d'autant plus que le
> temps passe.
>
> **Corollaire de méthode, tranché le 24/08/2026.** Face à un réplica qui dérive,
> deux voies : le re-synchroniser, ou cesser de le lire. La seconde a été retenue, et l'argument
> vaut au-delà de ce cas : **re-synchroniser aurait ajouté des événements à une chaîne dont l'échec
> est toléré par décision** (`ToleratesGraphFailure`), donc n'aurait pas pu fermer le trou qui reste
> — elle aurait raccourci la fenêtre entre dérive et réparation, pas supprimé la fenêtre. Router la
> question vers le maître ne laisse aucune fenêtre.
>
> Ce n'est pas « ne jamais lire le graphe » : le follow y reste lu, et l'inscription à un chat ou à
> un salon aussi. Le graphe en est le maître — c'est **la même règle**, pas une exception à elle.
> `registered_in` porte les deux sémantiques : le tag aux deux bouts de l'arête dit laquelle.

Les trois régimes de la couture graphe — lectures qui ne lèvent pas, écritures DML qui lèvent, DDL
qui ne lève pas — sont décrits une fois dans
[signalisation.md](../../architecture/signalisation.md#les-trois-régimes-de-la-couture-graphe). Ce
qui suit est ce que la table ne dit pas : **pourquoi** chaque régime est là, et les causes racines
qui l'ont imposé.

> **Une erreur permanente devient une autorisation permanente.** Le refus par défaut en lecture
> n'est pas une ceinture posée à côté du correctif de `canJoinchatRoom` : c'en **est** le correctif.
> Sa requête employait un `OPTIONAL MATCH` porteur d'un `WHERE`, que NebulaGraph refuse en
> `SyntaxError` — et le `if($result)` d'alors, voyant un objet *truthy*, transformait cette erreur
> définitive en accord définitif. Le motif à reprendre pour tout nouveau garde qui lit le graphe est
> celui de `followsMutually` : les quatre gardes du trait le recopient, refus + `Log::warning`.

> **Un échec d'écriture était totalement muet, et c'est ce qui rend « ça lève » non négociable.** La
> grande majorité des sites d'écriture du paquet ignorent la valeur de retour — donc rendre l'erreur
> sans lever ni journaliser ne prévenait personne : pas d'arête, pas de log, et une interface qui
> affiche « ✅ ». `insertVertex` le masquait activement : **succès et échec retombaient tous deux sur
> la chaîne construite localement avant l'envoi**, dont les appelants extrayaient un vid qu'ils
> écrivaient en MySQL/Mongo — pointant vers un sommet inexistant. Aucun appelant ne pouvait les
> distinguer : il n'y avait rien à distinguer. Les gardes `if(!is_array($vertex))` qui prétendaient
> le faire ont été retirés.
>
> ⚠️ **Faire lever révèle des erreurs nGQL préexistantes.** Un post sans commentaire émettait
> `DELETE VERTEX  WITH EDGE`, invalide et absorbé depuis toujours. D'où le garde « liste vide ⇒
> aucune requête », posé **dans la couture** et non chez les appelants.

> **Un échec d'écriture de réplica ne fait pas échouer l'opération hôte.** Aucun listener n'est
> `ShouldQueue` : ils tournent dans la requête HTTP du socle, et faire échouer l'attachement d'un
> utilisateur à un groupe parce qu'une *copie* n'a pas pu être écrite inverserait le rapport entre la
> source de vérité et son réplica. Ils rattrapent et journalisent (`ToleratesGraphFailure`,
> `ReplicaFailureListenerTest`). C'est cette tolérance qui a écarté la re-synchronisation du réplica
> — l'argument est dans [« Deux pièges du graphe »](#deux-pièges-du-graphe-que-ce-garde-contourne).

### 403 uniforme, et ce que le journal garde

Un slug inconnu et une absence de relation répondent **le même 403** : la différence était un oracle
d'énumération. Le `Log::warning`, lui, conserve `target_exists` — il n'est pas exposé.

L'uniformité porte sur le **corps entier, libellé compris**. Le refus dit maintenant pourquoi
(`DENIED_MESSAGE`), et ce message est unique : un texte qui distinguerait les deux causes rouvrirait
mot pour mot l'oracle que le code de retour vient de fermer. Le point d'appel est unique, donc la
règle tient structurellement — `RelationGuardTest` compare tout de même les deux corps.

> **Le corps d'une réponse de signalisation est du texte affiché, pas seulement une donnée de
> protocole.** Il est tentant de conclure « aucun composable WebRTC2 n'inspecte le statut HTTP, donc
> le corps n'est lu par personne » : c'est vrai des composables — tous ces POST sont dans un `catch`
> nu — et faux de la chaîne complète. `AjaxService.load` d'estarter, lui, inspecte le statut et émet
> `httpError` sur 403 comme sur 500 ; `widgets/Alert.vue` en fait un `AWN.alert(data.message ||
> toaster.err)`. Les appels WebRTC2 ne passant aucun `toaster`, un corps sans `message` produisait un
> toast **au contenu nul** : l'utilisateur voyait une alerte vide, ce qui est pire que pas d'alerte.
> Un garde n'est fini que lorsqu'on a suivi son refus jusqu'au pixel.

### Le verdict est exposé au profil — de l'UX, pas un contrôle

`Users::getGraphUser` place le résultat de `mayReach` dans la charge utile du mur (`may_reach`), et
`Cover.vue` n'affiche le bouton d'appel que s'il est vrai. **Ce n'est pas un second garde** : le
serveur refuse de toute façon, et rien de ce qui est masqué n'est rendu impossible par le masquage.

C'est un correctif d'**honnêteté de l'interface**. Un garde serveur ajouté sans ce pendant crée un
bouton qui ment : l'appel part en 403, aucun composable WebRTC2 n'inspecte le statut HTTP — tous ces
POST sont dans un `catch` nu — donc l'utilisateur ne voit ni appel, ni erreur. La règle générale :
**tout garde posé sur une action proposée par l'UI doit être lisible par cette UI**, sinon l'échec
devient silencieux.

> ⚠️ Corollaire à ne pas perdre : le verdict est calculé **au chargement du profil**. S'abonner
> depuis le mur peut créer la réciprocité qui rend l'appel légitime — le serveur oublie bien son
> verdict mémorisé (`Users::forgetRelationVerdict`), mais le bouton n'apparaîtra qu'au rechargement
> de la page.

### La liste de contacts applique le même prédicat, en lot

`POST /get-user-list` rendait **tous les utilisateurs actifs à tout authentifié** : son contrôle de
permission était commenté dans le contrôleur. C'était une énumération plus directe que le sondage de
slugs fermé par le 403 uniforme ci-dessus — nom, slug, image et statut de connexion de toute la base,
en une requête.

**Décision produit du 25/08/2026** : `list_users` voit tout le monde ; sans la permission, la liste
se restreint aux utilisateurs **joignables au sens de `mayReach`**. Le périmètre se décide dans
`Users::visibleUsers()` et non dans le contrôleur, parce que la permission ne refuse pas la route :
elle en change l'étendue.

L'alignement est celui que réclame la règle du bouton d'appel, un cran plus haut : la liste de
contacts est elle-même une **action proposée par l'UI**. Y faire figurer quelqu'un que la
signalisation refusera, c'est proposer un appel qui partira en 403.

> ⚠️ **Le lot et l'unitaire doivent dire la même chose, et c'est un invariant fragile.**
> `Socializable::reachableVertexIds()` est la version en lot de `mayReach` — mêmes deux jambes,
> mêmes sources, plus soi-même (multi-onglet). Elle existe pour une raison de coût : N appels à
> `mayReach` coûteraient N allers-retours Thrift sur cache froid, là où le lot en coûte deux pour
> toute la liste. Elle **n'utilise pas** le cache de `mayReach` et ne l'alimente pas : ses entrées
> sont des verdicts de *paire*, oubliés à l'unité par `Users::followUser`.
> `UserListScopeTest::le_lot_dit_la_meme_chose_que_le_predicat_unitaire` compare les deux verdicts
> candidat par candidat — c'est la seule chose qui empêche les deux implémentations de diverger.

Deux détails que la lecture seule ne donne pas :

- **Le vertexid ne se déduit pas d'un `user_id`.** `getVertexId()` rend la colonne `vertexid` quand
  elle existe et retombe sinon sur `<tag><id>` : la production n'a pas cette colonne, le stub du
  harnais l'a. Reconstruire `'user'.$id` à la main marche donc en production et ment en test — d'où
  deux requêtes SQL et non une pour la jambe groupe.
- **Une panne du graphe sur la requête de liste rendait un 500**, pas une liste vide. `execute()`
  rend un `JsonResponse` sur une lecture qui échoue ; le `foreach` itérait alors l'unique attribut
  public de la réponse Symfony (`$headers`) et levait « Cannot use object of type
  ResponseHeaderBag as array ». Constaté en retirant le garde, pas déduit — la lecture seule
  concluait « zéro propriété, donc liste vide ».

### Ce que les tests ne prouvent pas

`FakeNebulaGraph` fait du `str_contains` sur le nGQL, **il ne le parse pas**. Les cas « follow » de
`RelationGuardTest` testent donc « le graphe a répondu vrai/faux », jamais la réciprocité elle-même.
Toute la sémantique de cette jambe vit dans une requête que le harnais ne sait pas évaluer, et une
requête syntaxiquement invalide y passerait au vert. Elle se contre-vérifie contre un vrai
NebulaGraph.

Corollaire moins visible : le défaut `[]` de la doublure **n'est pas** « pas de follow ». La requête
finit par `RETURN count(*) > 0`, un agrégat — un vrai graphe renvoie toujours exactement une ligne.
Zéro ligne veut dire « le graphe n'a pas répondu », et c'est traité comme un refus. Écrire un test
d'absence de relation sur `[]` revient à tester une panne.

---

## Le rafraîchissement du credential TURN

Le credential est éphémère alors que le `Peer` est un singleton d'onglet : la panne, son symptôme
(« la visio ne passe plus, un F5 la répare ») et le dimensionnement des constantes sont écrits une
fois, dans `webrtc2.config.js`, section « Rafraîchissement du credential TURN ». **Ce qui suit est ce
que le fichier de configuration ne porte pas : les trois alternatives écartées.**

### Trois décisions, et la raison de chacune

**Le serveur annonce une DURÉE, pas une échéance.** La réponse porte `credential_ttl` en secondes, à
la racine — jamais dans l'entrée TURN, qui reste une liste blanche de trois clés. L'autre source
possible était l'epoch préfixant `username`, mais il est **absolu** : un poste dont l'horloge est en
retard de deux heures programmerait le rafraîchissement deux heures après l'expiration, c'est-à-dire
reproduirait exactement la panne. Une durée relative n'a aucune horloge à partager. La clé est
**absente** — et non `null` — quand il n'y a rien à rafraîchir (invité, mode statique, hôte TURN non
configuré), ce qui donne au client un prédicat unique pour les trois cas.

**Un minuteur, pas un rafraîchissement paresseux avant `connectToPeer`.** Le paresseux ne dépend
d'aucune horloge et ne travaille que si l'on appelle, mais `connectToPeer` est **synchrone** et porte
un verrou anti-TOCTOU. Y insérer un `await` créerait un état intermédiaire observable, et **tout ce
qui LIT cet état devrait être réexaminé**, pas seulement ce qui l'écrit — c'est ce qu'a coûté le
passage de la configuration ICE en HTTP. Le seul `await` du mécanisme vit donc dans le callback du
minuteur, sur aucun chemin d'appel.

**On réécrit `peer.options.config`, et rien d'autre.** PeerJS relit
`provider.options.config` à **chaque** nouvelle `RTCPeerConnection`, et `options` est un getter
vivant sur `_options` : une réécriture profite à toutes les connexions futures **sans toucher aux
connexions ouvertes**. Ni `setConfiguration()`, ni cycle destroy → init.

### Les deux pièges

**Un rafraîchissement peut DÉGRADER.** `fetchIceServers` ne jette jamais : quand la route répond mal,
elle rend le repli STUN seul. L'écrire remplacerait une configuration TURN qui marche par une
configuration sans relais — l'exact contraire du but. D'où la règle : **pas de TTL dans la réponse ⇒
aucune écriture**, la configuration en place est conservée et une reprise est armée, bornée
(`ICE_REFRESH_MAX_RETRIES`, dont le pourquoi est sur la constante).

**`options.config` est un interne non contractuel de PeerJS.** Un renommage amont rendrait le
rafraîchissement **muet** : aucune erreur, aucun log, et la panne reviendrait sous sa forme d'origine
des mois plus tard. C'est pourquoi `peerjsMockFidelity.descriptors.test.js` vérifie sur la **source**
de `bundler.mjs` que `provider.options.config` y figure encore.

### Ce que ce mécanisme ne décide pas

**Il ne raccourcit pas le TTL, il rend son raccourcissement possible.** `credential_ttl` est un
réglage d'hôte, et la condition de réouverture du `throttle` reste armée pour le jour où un déployeur
descend à l'échelle de l'heure.

Et la suite ne prouve pas que **coturn accepte** le credential rafraîchi : elle prouve que le
minuteur rejoue la requête et réécrit l'objet. La contre-épreuve est manuelle — un
`COTURN_CREDENTIAL_TTL` court, un onglet laissé ouvert au-delà, puis un **nouvel** appel qui obtient
un candidat `relay`.

---

## Bornes non fermées, connues

Ce qui a été **fermé** n'est pas ici : c'est la table du
[périmètre réel](#périmètre-réel--à-lire-en-premier), en tête de fichier.

- **L'usurpation intra-room, bornée mais pas fermée.** Le mécanisme est décrit dans
  [« Une liste vide n'est pas une réponse »](#une-liste-vide-nest-pas-une-réponse) — chemin (a).
  Le garde de relation serveur **borne qui peut tenter** (il faut déjà être en relation avec la
  victime) sans supprimer le cas, puisqu'un membre de la même room l'est le plus souvent. La fermer
  demande de lier `Auth::user()` au peerId relayé côté serveur, c'est-à-dire de faire du backend le
  témoin de l'identité PeerJS — un chantier, pas un garde. Borne assumée.
- **Amplification du hub star, par la somme des émetteurs.** Le produit `octets × fan-out` est
  désormais plafonné (`HUB_MAX_BYTES_PER_WINDOW`), mais **par émetteur** : N émetteurs honnêtes
  peuvent encore additionner leurs budgets. Un budget global du hub fermerait ce cas et en ouvrirait
  un pire — le premier à dépenser priverait les autres, soit un déni de service sur les pairs
  légitimes. Arbitrage assumé.
- **TURN, le secret de signature** : il est unique et partagé par tous les utilisateurs. Le
  compromettre ne vaut pas un relais ouvert mais **la capacité de forger le credential de
  n'importe qui**, donc la perte de la non-répudiation que ce mode achète. Ce qui l'arrête est une
  liste blanche de trois clés dans `WebRTCController::turnServer()`, et non une liste noire —
  épinglée par `IceServersTest::la_charge_utile_ne_relaie_que_les_trois_cles_attendues`, dont la
  contre-épreuve est un splat de `config('socializer.signaling.ice.turn')`.
- **TURN, ce qui n'appartient pas à ce paquet** : le durcissement de coturn lui-même — gardes de
  pair (`--denied-peer-ip`, `--no-tcp-relay`), quotas, publication de la plage de ports de relais —
  vit dans le `docker-compose` du projet hôte. Ces gardes tiennent **même si le credential fuite**,
  ce qui les rend complémentaires et non redondants avec ce qui précède.

> **La leçon qui se réutilise ailleurs : `import.meta.env.VITE_*` n'est pas de la configuration,
> c'est du code source.** Vite remplace l'expression par sa valeur **au build** ; la clé finit en
> clair dans `public/build/assets/js/*.js`, servi à tout visiteur. Le credential coturn y était
> présent **deux fois** — parce que deux fichiers le lisaient, dont un appartenant à la v1 morte :
> Vite ne se soucie pas de savoir si le code est atteignable. Corollaire de méthode : **ne jamais
> conclure « le secret est sorti » depuis le seul code source** — la preuve est un `grep` sur le
> bundle reconstruit. Épinglé par `__tests__/noInlinedTurnSecret.test.js`, qui scanne exactement ce
> que Vite compile (tests et commentaires exclus, puisqu'ils ne sont pas bundlés).

Ce qui reste ouvert sur ce module : [`work/webrtc2-todo.md`](../../../work/webrtc2-todo.md).
