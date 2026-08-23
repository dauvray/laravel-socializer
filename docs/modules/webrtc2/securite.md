# WebRTC2 — Sécurité

> **À quoi ça sert :** le modèle de confiance, les décisions d'architecture sécurité et leur
> justification, et le **périmètre réel** de ce qui est durci aujourd'hui.
> **Quand le lire :** avant d'ouvrir un chemin de connexion, de relayer un payload, ou de
> conclure que « la sécu est faite ».

---

## Périmètre réel — à lire en premier

| Direction | État | Détail |
|---|---|---|
| **Entrant** (`peer.on('connection')`, `peer.on('call')`) | durci **côté client**, borné côté serveur — audits du 20/05 et du 14/08/2026 | garde `_isAuthorizedIncomingPeer`, anti-usurpation inconditionnelle, gardes de taille, sanitisation. Reste aveugle au membre de room qui se présente avec un peerId neuf sous le slug d'un autre ; le garde de relation serveur borne désormais qui peut tenter |
| **Sortant** (`connectToPeer`, `responseRemotePeerConnection`) | durci **côté client**, garde autoritatif posé côté serveur | prédicat unique `utils/isAuthorizedPeer.js` : membre de la room **ou** interlocuteur d'appel marqué. Son jumeau serveur `Socializable::mayReach` tranche ce que le navigateur ne peut pas voir |
| **Backend** (`UserController`, routes) | durci | `fromUserSlug` authentifié, liste blanche de champs, `throttle` par utilisateur (deux buckets), `validate()` sur les 5 payloads, et **contrôle de relation** émetteur ↔ destinataire en 403 uniforme |
| **Credentials TURN** | 🟠 compilés dans le bundle | identifiants longue durée lisibles par quiconque ouvre le JS |

**La leçon réutilisable, et la seule qui compte : un garde d'admission ne sécurise qu'une
direction.** Tout chemin qui *ouvre* une connexion doit porter le sien.

L'audit de mai avait été marqué « clôturé — toutes les failles corrigées ». Ses correctifs sont
réels et bien faits, mais son périmètre était le sens **entrant** ; le sens sortant n'avait jamais
été examiné. C'est ce qui rendait la mention fausse, et c'est pourquoi ce fichier énonce un
périmètre plutôt qu'un verdict.

### La chaîne d'attaque du sens sortant (tracée statiquement, non exploitée)

> **Fermée côté client** par le prédicat `utils/isAuthorizedPeer.js`, posé à l'étape 5
> (`connectToPeer`, avant `addRemotePeerId`) et sur la livraison du peerId qui l'alimente
> (`responseRemotePeerConnection`). Elle est conservée telle quelle parce que **les étapes 1
> et 2 restent vraies** : le backend relaie toujours sans exiger de relation entre les deux
> parties. Un client modifié rejoue donc la chaîne jusqu'au bout contre un pair dont le garde
> a été retiré — c'est ce que modélise `scenarios/outgoingAuth.test.js`.

1. un utilisateur authentifié quelconque POSTe `/response-to-peer-id` avec `toUserSlug: <victime>`,
   **son propre** `peerId`, et un `type`/`room` correspondant à un contexte monté chez la victime ;
2. `UserController::responseToPeerId` relaie — `fromUserSlug` est bien authentifié, mais rien ne
   vérifie que l'émetteur a le droit de parler à cette cible ;
3. `Notifications.vue` dispatche `PEER_CONNECT_TO_REMOTE_PEER` sur `roomId = '<type>-<room>'` ;
4. `useSignalingQueue` route **sans précondition** — choix délibéré et correct
   ([pourquoi](architecture.md#le-routage-ne-pose-aucune-précondition)) — mais il n'y a de garde
   nulle part ailleurs ;
5. `connectToPeer` enregistre `addRemotePeerId(attaquant, peerId)` puis appelle
   `peer.call(peerIdAttaquant, ctx.media.currentStream)`.

**Conséquence :** si la victime diffuse, **c'est elle qui ouvre la connexion média** et pousse sa
webcam / son micro vers l'attaquant. `connectionType: 'screen'` donne le partage d'écran.
`_isAuthorizedIncomingPeer` ne s'exécute pas : il ne garde que l'entrant. Aucune appartenance à la
room n'est requise.

Variante `type: 'data'` : le contexte `data-app` est monté **en permanence** pour tout utilisateur
connecté, donc le canal est disponible en continu — et l'écriture inconditionnelle
`addRemotePeerId` **empoisonne le mapping qui sert d'allowlist** au chemin (b) de
`_isAuthorizedIncomingPeer` : l'attaquant s'auto-inscrit comme « interlocuteur d'appel direct
vérifié » sans qu'aucun appel n'ait été autorisé.

Le plan de correction (registre `authorizedCallPeers`, prédicat unique
`utils/isAuthorizedPeer.js`, scénario « mallory ») est dans
[`work/webrtc2-securite-2026-08-14.md`](../../../work/webrtc2-securite-2026-08-14.md).

⚠️ Deux pièges à respecter en l'implémentant :
- **Ne pas** poser le garde dans `useSignalingQueue` — l'absence de précondition dans le routage est
  un invariant, déjà cassé une fois avec des flux disparus chez les arrivants.
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
`resolveRemoteSlug`. Le durcissement du lot B a fait ce qu'un client peut faire — rejeter la
résolution **contradictoire** sur les deux chemins, tracer l'admission non corroborée — mais le cas
nominal de la présence et l'usurpation ont ici la **même signature locale** : slug déclaré membre,
peerId inconnu. Les distinguer demande une source de vérité que le récepteur n'a pas.

La fermeture appartient donc au backend, seul détenteur du lien `Auth::user()` ↔ peerId relayé
(lot C). Ne pas lire cette règle comme une défense-en-profondeur : sur le chemin (a) elle est le
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
> écrite.** Même leçon qu'E8/E9 côté backend, ici sur le front. Les deux producteurs de
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

## Décisions en vigueur (backend, août 2026)

### Le garde de relation — `Socializable::mayReach`

Les 5 routes de signalisation exigent un lien entre l'émetteur et le destinataire : **même groupe
MariaDB OU follow réciproque**. C'est le jumeau serveur de `utils/isAuthorizedPeer.js`, et la seule
fermeture possible de l'usurpation intra-room — côté navigateur, le cas nominal et l'attaque ont la
même signature locale.

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

**1. `canJoinRoom` / `canJoinServer` ne sont pas des prédicats d'appartenance.** Dans les deux, `u`
est *n'importe quel* utilisateur enregistré, pas l'appelant, dont le `vertexid` ne pèse que sur la
branche `privacy == 1`. Sur une room publique la requête renvoie une ligne dès qu'un membre
quelconque existe : **`true` pour tout le monde**. (Effet miroir : une room publique **vide** renvoie
`false`, même à son propriétaire.) Ce sont des gardes de **canal Reverb** ; les employer comme gardes
de relation rendrait le contrôle contournable en nommant une room publique. Leur troisième sœur
`canJoinchatRoom`, elle, **est** un prédicat d'appartenance depuis le 21/08/2026 — ne pas généraliser
des deux premières à la troisième (`ChannelGuardTest`).

**2. L'appartenance vit dans MariaDB, pas dans le graphe.** L'arête
`user -[:registered_in]-> group` est bien **synchronisée** à l'attachement et au détachement : le
pivot `GroupUser` du socle émet `GroupUserCreated` / `GroupUserDeleted` — `->using()` est déclaré
des deux côtés de la relation, sans quoi aucun événement ne partirait — et les listeners **de ce
paquet** posent puis retirent l'arête. Elle dérive quand même, par les chemins qui n'émettent aucun
événement Eloquent : `group_user` porte `onDelete('cascade')` sur ses deux clés étrangères, donc
supprimer un groupe ou un compte retire les lignes en SQL et **laisse l'arête**. À quoi s'ajoutent
les rattachements antérieurs aux listeners, rattrapés seulement par `socializer:nebula-populate`.
De même, `user -[:registered_in]-> room` n'est posée que pour le **créateur** de la room — aucune
route « rejoindre une room » ne l'ajoute. Cette dérive-là **reste ouverte** : c'est la seule des
trois faiblesses des gardes de canal que le correctif du 21/08/2026 n'a pas fermée.

> ⚠️ **Deux listeners homonymes sont abonnés au même événement**, un par paquet :
> `Dauvray\Estarter\app\Listeners\GroupUserCreatedListener` est entièrement commenté,
> `Dauvray\Socializer\app\Listeners\GroupUserCreatedListener` fait le travail. Ouvrir le premier
> fait conclure que rien ne se propage.

> **La leçon durable : le graphe est un réplica, pas une source de vérité.** Un garde qui l'interroge
> pour une donnée dont MySQL est le maître hérite de tous les trous de sa synchronisation — et ici le
> trou **accorde** au lieu de refuser, donc personne ne s'en plaint et il dérive d'autant plus que le
> temps passe. Le follow y reste lu : c'est la seule donnée dont le graphe est bien le maître.

> **Corollaire refermé le 21/08/2026 : un graphe qui ne répond pas vaut un refus.** En LECTURE,
> `execute()` ne lève pas — sur erreur nGQL il rend un `JsonResponse`, un objet donc *truthy*. Les
> quatre gardes du trait recopient donc le refus par défaut de `followsMutually` : réponse
> inexploitable ⇒ refus et `Log::warning` (`ChannelGuardTest`). Ce n'est pas une ceinture ajoutée à
> côté du correctif de `canJoinchatRoom`, c'en **est** le correctif : sa requête employait un
> `OPTIONAL MATCH` porteur d'un `WHERE`, que NebulaGraph refuse en `SyntaxError`, et le `if($result)`
> d'alors faisait de cette erreur permanente une autorisation permanente. Motif à reprendre pour tout
> nouveau garde qui lit le graphe, pas à réinventer.

> **Corollaire symétrique, refermé le 22/08/2026 : une écriture qui échoue ne se tait plus.** Le même
> `responseJson()` traitait lectures et écritures à l'identique — il rendait l'erreur, sans jamais
> lever ni journaliser. Or **~80 des ~95 sites d'écriture du paquet ignorent la valeur de retour** :
> un échec d'écriture était donc parfaitement muet. Pas d'arête, pas de log, pas d'exception, et une
> interface qui affiche « ✅ ». `insertVertex` allait plus loin et le masquait activement : succès
> (`[]`) et échec (un objet) retombaient tous deux sur `$items`, la chaîne construite *localement*
> avant l'envoi — dont les appelants extrayaient un vid qu'ils écrivaient en MySQL/Mongo, pointant
> vers un sommet inexistant.
>
> **Le principe, en une phrase : une lecture ratée doit se dégrader en refus, une écriture ratée ne
> doit pas se dégrader du tout.** D'où trois régimes, et deux arbitrages datés plutôt que des
> oublis :
>
> | Chemin | Journalise | Lève | Pourquoi |
> |---|---|---|---|
> | lectures | ✅ | ❌ | faire lever rendrait inatteignables les branches ci-dessus : 500 au lieu de 403 |
> | écritures DML | ✅ | ✅ | une valeur de retour, ça s'ignore — c'est précisément le bug |
> | DDL | ✅ | ❌ | schéma asynchrone, `IF NOT EXISTS`, la migration doit rester rejouable |
>
> Second arbitrage, sur les onze listeners : **un échec d'écriture de réplica ne fait pas échouer
> l'opération hôte.** Aucun n'est `ShouldQueue`, ils tournent dans la requête HTTP du socle ; faire
> échouer l'attachement d'un utilisateur à un groupe parce qu'une *copie* n'a pas pu être écrite
> inverserait le rapport entre la source de vérité et son réplica. Ils rattrapent et journalisent
> (`ToleratesGraphFailure`, `ReplicaFailureListenerTest`) — la dérive qui en résulte est le sujet
> d'E4.2, que ce lot débloque.
>
> Deux leçons de méthode au passage. **Faire lever révèle des erreurs nGQL préexistantes** : un post
> sans commentaire émettait `DELETE VERTEX  WITH EDGE`, invalide et absorbé depuis toujours — d'où le
> garde « liste vide ⇒ aucune requête », posé dans la couture et non chez les appelants. Et le
> contrat de retour d'`insertVertex` était **une valeur locale que succès et échec partageaient** :
> aucun appelant, si consciencieux fût-il, ne pouvait les distinguer — il n'y avait rien à
> distinguer. Les onze `if(!is_array($vertex))` qui prétendaient le faire ont été retirés.

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

## Bornes non fermées, connues

- **Amplification du hub star, par la somme des émetteurs.** Le produit `octets × fan-out` est
  désormais plafonné (`HUB_MAX_BYTES_PER_WINDOW`), mais **par émetteur** : N émetteurs honnêtes
  peuvent encore additionner leurs budgets. Un budget global du hub fermerait ce cas et en ouvrirait
  un pire — le premier à dépenser priverait les autres, soit un déni de service sur les pairs
  légitimes. Arbitrage assumé.
- **Backend** — fermés depuis l'audit : le `throttle` des 5 routes, la validation des payloads
  relayés, le `catch (\Exception $ex) { return $ex; }` qui renvoyait chemins de fichiers et trace au
  client indépendamment d'`APP_DEBUG`, le contrôle de relation émetteur ↔ destinataire,
  l'énumération par `firstOrFail()` sur ces cinq routes, et le bloc privé de chaque membre
  (`email`, `roles`, `permissions`, `groups`) que les quatre canaux de présence diffusaient à toute
  la room — désormais une liste blanche de six champs
  ([signalisation.md](../../architecture/signalisation.md#une-charge-utile-de-présence-est-fabriquée-par-son-propre-sujet)).
  **Reste ouvert** : la même énumération sur `getUsersList`, qui liste tous les utilisateurs actifs
  sans contrôle.
- **TURN** : `VITE_COTURN_USERNAME` / `VITE_COTURN_CREDENTIAL` sont compilés dans le bundle servi à
  tous — identifiants longue durée, partagés → relais ouvert, bande passante imputable au serveur.

Détail, ordre et critères de complétion :
[`work/webrtc2-securite-2026-08-14.md`](../../../work/webrtc2-securite-2026-08-14.md).
