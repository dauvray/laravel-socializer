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

### `conn.metadata` : sanitisation restreinte à `type`

`Composables/utils/sanitizeMetadata.js` (`sanitizeMetadataType`) rejette toute valeur hors
`VALID_CONNECTION_TYPES` (retour `null`). Appliqué dans `createPeerContext.setUpConnectionListeners`
(clé de store et étiquette de log) et dans le dispatcher `peer.on('call')`.

Périmètre volontairement restreint à `metadata.type` : `from` est couvert par
`_isAuthorizedIncomingPeer`, `room`/`slug` sont no-op s'ils manquent. **Non couverts** :
`metadata.fromName` (affiché dans `MediaBroadcastPlayer.vue`) et la taille globale de l'objet
metadata — pas de XSS (aucun `v-html` ni `innerHTML` dans le module, Vue échappe l'interpolation),
mais dégradation de mise en page et pollution des logs possibles. Traitement prévu en lot E.

### Fuites mémoire fermées

Les fenêtres de rate-limiting purgent leur clé quand elle devient vide (sinon la Map grossit
indéfiniment au fil des rotations de room). La mécanique — fenêtre glissante + balayage throttlé —
vit dans `Composables/utils/createRateLimiter.js` : **un seul système** pour le hub star et pour
`/ask-to-peer-id`, avec des clés délibérément différentes.

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

### Deux pièges du graphe que ce garde contourne

**1. `canJoinRoom` / `canJoinServer` ne sont pas des prédicats d'appartenance.** Dans les deux, `u`
est *n'importe quel* utilisateur enregistré, pas l'appelant, dont le `vertexid` ne pèse que sur la
branche `privacy == 1`. Sur une room publique la requête renvoie une ligne dès qu'un membre
quelconque existe : **`true` pour tout le monde**. (Effet miroir : une room publique **vide** renvoie
`false`, même à son propriétaire.) Ce sont des gardes de **canal Reverb** ; les employer comme gardes
de relation rendrait le contrôle contournable en nommant une room publique.

**2. L'appartenance vit dans MariaDB, pas dans le graphe.** `GroupUserCreatedListener` (estarter) est
entièrement commenté : ajouter un utilisateur à un groupe ne propage **rien** dans NebulaGraph.
L'arête `user -[:registered_in]-> group` n'est écrite qu'à la création du compte
(`createUserAndNetwork`) et par `socializer:nebula-populate`. De même,
`user -[:registered_in]-> room` n'est posée que pour le **créateur** de la room — aucune route
« rejoindre une room » ne l'ajoute.

> **La leçon durable : le graphe est un réplica, pas une source de vérité.** Un garde qui l'interroge
> pour une donnée dont MySQL est le maître refuse des accès légitimes, sans motif visible, et dérive
> d'autant plus que le temps passe. Le follow y reste lu — c'est la seule donnée dont le graphe est
> bien le maître.

### 403 uniforme, et ce que le journal garde

Un slug inconnu et une absence de relation répondent **le même 403** : la différence était un oracle
d'énumération. Le `Log::warning`, lui, conserve `target_exists` — il n'est pas exposé.

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

- **Amplification du hub star** : les gardes sont par émetteur (`HUB_MAX_MESSAGES_PER_WINDOW`) et par
  message (`MAX_PAYLOAD_BYTES`), mais **leur produit par le fan-out ne l'est pas**. Or star est la
  topologie des grandes rooms : à 100 membres, un client d'apparence honnête fait sortir ~128 Mo/s
  du hub.
- **Backend** — fermés depuis l'audit : le `throttle` des 5 routes, la validation des payloads
  relayés, le `catch (\Exception $ex) { return $ex; }` qui renvoyait chemins de fichiers et trace au
  client indépendamment d'`APP_DEBUG`, le contrôle de relation émetteur ↔ destinataire, et
  l'énumération par `firstOrFail()` sur ces cinq routes. **Reste ouvert** : la même énumération sur
  `getUsersList`, qui liste tous les utilisateurs actifs sans contrôle.
- **TURN** : `VITE_COTURN_USERNAME` / `VITE_COTURN_CREDENTIAL` sont compilés dans le bundle servi à
  tous — identifiants longue durée, partagés → relais ouvert, bande passante imputable au serveur.

Détail, ordre et critères de complétion :
[`work/webrtc2-securite-2026-08-14.md`](../../../work/webrtc2-securite-2026-08-14.md).
