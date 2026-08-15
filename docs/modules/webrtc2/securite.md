# WebRTC2 — Sécurité

> **À quoi ça sert :** le modèle de confiance, les décisions d'architecture sécurité et leur
> justification, et le **périmètre réel** de ce qui est durci aujourd'hui.
> **Quand le lire :** avant d'ouvrir un chemin de connexion, de relayer un payload, ou de
> conclure que « la sécu est faite ».

---

## Périmètre réel — à lire en premier

| Direction | État | Détail |
|---|---|---|
| **Entrant** (`peer.on('connection')`, `peer.on('call')`) | durci — audit du 20/05/2026 | garde `_isAuthorizedIncomingPeer`, anti-usurpation, gardes de taille, sanitisation |
| **Sortant** (`connectToPeer`, `responseRemotePeerConnection`) | durci **côté client** — audit du 14/08/2026 | prédicat unique `utils/isAuthorizedPeer.js` : membre de la room **ou** interlocuteur d'appel marqué. Le garde autoritatif, côté serveur, reste à écrire |
| **Backend** (`UserController`, routes) | partiel | `fromUserSlug` authentifié + liste blanche de champs ; ni `throttle`, ni `validate()`, ni contrôle de relation |
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

Un pair entrant est admis par **(a)** appartenance à `ctx.connection.usersInRoom` (présence Reverb)
avec anti-usurpation conditionnelle, **ou** **(b)** appel direct vérifié :
`peerStore.getRemotePeerId(from)` existe **et** correspond à `conn.peer` — allowlist et
anti-usurpation fusionnées en une seule condition stricte.

⚠️ **`ctx.session.currentCallUsers` ne peut pas servir d'allowlist.** C'est un état **UI** (qui voir,
qui raccrocher) ; le réutiliser comme politique de sécurité couplerait affichage et autorisation.
Cet usage a été explicitement retiré. Le chemin (b) l'a remplacé.

Historique utile : la règle (a) seule fermait les appels **directs** 1-à-1 entre users sans room
commune — remote bloqué en « pending ». C'est la non-régression à ne jamais casser en durcissant
l'admission.

**Faille résiduelle connue, chemin (a)** : un membre de la room qui ouvre un **second** `new Peer()`
(UUID neuf, donc non mappé) obtient `resolvedSlug = null`, l'anti-usurpation est sautée, et il est
admis sur la seule foi d'un `metadata.from` déclaratif qui n'a qu'à nommer un membre. Il parle alors
sous l'identité de l'usurpé : chat, `BROADCAST_STATE` et `AUDIO_MUTE_TOGGLE` lisent tous
`resolveRemoteSlug`. Le commentaire du code qualifie ce contrôle de « défense-en-profondeur » alors
qu'il est en réalité **le seul** anti-usurpation de ce chemin. Traitement prévu en lot B.

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

## Bornes non fermées, connues

- **Amplification du hub star** : les gardes sont par émetteur (`HUB_MAX_MESSAGES_PER_WINDOW`) et par
  message (`MAX_PAYLOAD_BYTES`), mais **leur produit par le fan-out ne l'est pas**. Or star est la
  topologie des grandes rooms : à 100 membres, un client d'apparence honnête fait sortir ~128 Mo/s
  du hub.
- **Backend** : aucun `throttle` sur les 5 routes de signalisation, aucun `validate()` sur les
  payloads relayés, `catch (\Exception $ex) { return $ex; }` qui renvoie chemins de fichiers et trace
  au client **indépendamment d'`APP_DEBUG`**, `firstOrFail()` sur un slug arbitraire qui permet
  l'énumération d'utilisateurs, et aucun contrôle de relation entre émetteur et destinataire.
- **TURN** : `VITE_COTURN_USERNAME` / `VITE_COTURN_CREDENTIAL` sont compilés dans le bundle servi à
  tous — identifiants longue durée, partagés → relais ouvert, bande passante imputable au serveur.

Détail, ordre et critères de complétion :
[`work/webrtc2-securite-2026-08-14.md`](../../../work/webrtc2-securite-2026-08-14.md).
