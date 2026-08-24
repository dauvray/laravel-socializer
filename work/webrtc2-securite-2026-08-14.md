# 🔐 Sécurité WebRTC2 — plan issu de l'audit du 14 août 2026

> **Chantier ouvert.** Périmètre de l'audit : composables WebRTC2, orchestrateur, contexte,
> store `peers2`, `System/Notifications.vue`, `UserController` de signalisation, routes.
> Sévérité : 🔴 Critique · 🟠 Haute/Moyenne · 🟡 Faible · Effort : `[S]` `[M]` `[L]`
>
> **Le constat, la chaîne d'attaque et les décisions durables sont dans
> [`docs/modules/webrtc2/securite.md`](../docs/modules/webrtc2/securite.md).** Ce fichier ne
> porte que le plan d'exécution : tâches, dépendances, tests attendus, critères de complétion.

---

## Graphe de dépendances

```
A1 ──┬─> A2 ──┬─> A3
     │        └─> B2
     └─────────────┘
B0 ──> B1
C3 ──> C4 ──> C2 ──┬─> E3     (tous sur UserController — à sérialiser)
                   └─> C5     (front : le bouton d'appel)
B3, C1                        (indépendants)
D1 ──> D2
E7 ──> E4.2                   (les deux ✅ — E4.2 le 24/08, arbitrage rendu : voie B)
E1, E2, E5, E6, E8, E9        (indépendants)
F1                            (dernier)
```

`A` est bloquant. `B3`, `C1`, `C3`, `E1`, `E2`, `E6`, `E7`, `E8`, `E9` ne bloquent personne : à
intercaler librement. **E8 était la seule à toucher la charge utile `users`** : elle ne devait pas
être menée en parallèle du lot B, qui l'interprète — contrainte levée depuis, les deux sont finis.

Les lots A, B et C sont **terminés**, ainsi que **C5** (le bouton d'appel), **E5** (le libellé du
refus) — 15 et 16/08 —, **E4.1** le 21/08 : la plus grave des tâches ouvertes est fermée, puis le
22/08 **E8** (la présence ne diffuse plus le bloc privé de personne), **E9** dans la foulée (les
charges utiles d'auteur de message passent en liste blanche, diffusion **et** historique HTTP), et
**E7** le même jour — les écritures de graphe lèvent et se journalisent, ce qui **débloque E4.2**.
Puis **E1** et **E2** le 23/08, et le lot **D** en entier le même jour — **D0** (les identifiants
TURN sortent du bundle public, 2 occurrences → 0, servis par `GET /get-ice-servers`), puis **D1** et
**D2** : credentials éphémères signés par utilisateur, la bascule de coturn en `--use-auth-secret`
valant rotation du secret compromis.
Le 24/08, **E4.2** : arbitrage rendu — **les gardes cessent de lire l'appartenance dans le réplica**
plutôt que de le re-synchroniser, parce qu'une chaîne dont l'échec est toléré par décision ne peut
pas être resynchronisée sans laisser de fenêtre.
Restent : la part `getUsersList` d'**E3** (arbitrage produit), **E6** (périmètre estarter), **D3**
(rafraîchir le credential TURN, 🟡) et **F1** en clôture.

---

# LOT A — Fermer le sens sortant 🔴

> **La chaîne d'attaque**, tracée statiquement (non exploitée en live) :
>
> 1. un utilisateur authentifié quelconque POSTe `/response-to-peer-id` avec
>    `toUserSlug: <victime>`, **son propre** `peerId`, et `type`/`room` correspondant à un
>    contexte monté chez la victime ;
> 2. `UserController::responseToPeerId` relaie tel quel — `fromUserSlug` est bien
>    authentifié (correctif de mai), mais rien ne vérifie que l'émetteur a le droit de
>    parler à cette cible ;
> 3. `Notifications.vue:103` dispatche `PEER_CONNECT_TO_REMOTE_PEER` sur
>    `roomId = '<type>-<room>'` ;
> 4. `useSignalingQueue` route **sans aucune précondition** — choix délibéré et correct
>    (un signal abandonné dans le routage l'est définitivement), mais il n'y a de garde
>    nulle part ailleurs ;
> 5. `usePeerConnections.connectToPeer` enregistre `addRemotePeerId(attaquant, peerId)`
>    puis appelle `peer.call(peerIdAttaquant, ctx.media.currentStream)`.
>
> **Conséquence :** si la victime diffuse, **c'est elle qui ouvre la connexion média** et
> pousse sa webcam / son micro vers l'attaquant. `connectionType: 'screen'` donne le
> partage d'écran. `_isAuthorizedIncomingPeer` ne s'exécute pas : il ne garde que le sens
> entrant. **Aucune appartenance à la room n'est requise.**
>
> Variante `type: 'data'` : le contexte `data-app` est monté **en permanence** pour tout
> utilisateur connecté (`Notifications.vue:61`, `useMediaBroadcast()` sans argument). Le
> canal est donc disponible en continu — et l'écriture inconditionnelle `addRemotePeerId`
> **empoisonne le mapping qui sert d'allowlist au chemin (b) de
> `_isAuthorizedIncomingPeer`** : l'attaquant s'auto-inscrit comme « interlocuteur d'appel
> direct vérifié » sans qu'aucun appel n'ait jamais été autorisé.

### A1 — Registre des pairs d'appel autorisés `[S]`

- [x] **Dépend de :** rien. **Prérequis de A2 et B2.** — ✅ fait le 15/08/2026.

> **Delta assumé :** un quatrième accesseur, `clearAllAuthorizedCallPeers()`, a été ajouté
> pour `resetCallState` — les trois accesseurs prévus ne purgent qu'un slug, et itérer
> `currentCallUsers` pour vider le registre l'aurait recouplé à l'état d'affichage qu'on
> vient précisément d'écarter. Le marquage n'est pas conditionné à la présence de
> `options.peerId` : l'autorisation porte sur le pair, le mapping sur son identité PeerJS.

`ctx.session.currentCallUsers` **ne peut pas** servir d'allowlist : c'est un état UI (qui
voir / raccrocher), et `_isAuthorizedIncomingPeer` a déjà rejeté cet usage pour cette
raison exacte — cf. son en-tête, « réutiliser un état applicatif comme allowlist de
sécurité couple politique et affichage ». Il faut un registre dédié, à propriétaire unique.

- `createPeerContext.js` : `session.authorizedCallPeers` (Map `slug → { at }`) + accesseurs
  `markAuthorizedCallPeer` / `isAuthorizedCallPeer` / `clearAuthorizedCallPeer`, sur le
  modèle exact de `markAnnouncedStream` (validation `isValidSlug`, refus de son propre
  slug, écriture interdite en direct). Purge dans `destroy()`.
- `useCallManager.js` — **seul écrivain** : `acceptCallFromPeer` et `openCallBetweenPeer`
  marquent (au même endroit qu'ils appellent déjà `addRemotePeerId`) ;
  `handleRemoteDeparture` et `resetCallState` purgent.
- Inscrire la ligne dans la table des propriétaires uniques de [`docs/modules/webrtc2/architecture.md`](../docs/modules/webrtc2/architecture.md).

**Tests**
- `createPeerContext.test.js` : slug invalide refusé · auto-marquage refusé · purge par `destroy()`.
- `useCallManager.test.js` : `acceptCallFromPeer` (status vrai) marque · `openCallBetweenPeer`
  marque · `handleRemoteDeparture` purge · un refus (`status` faux) **ne marque pas**.

**Done :** aucun changement de comportement observable, suite verte.
**Commit :** `secu(webrtc2): registre des pairs d'appel autorisés dans le contexte`

---

### A2 — Garde d'autorisation sortante dans `connectToPeer` `[M]` 🔴

- [x] **Dépend de :** A1. — ✅ fait le 15/08/2026.

> **Delta assumé — placement du garde.** Ce plan demandait de le poser « après
> l'acquisition du verrou `inFlightConnections`, pour rester dans la section critique ».
> Il est en réalité posé **juste après la garde anti-self**, donc avant le verrou :
> `connectToPeer` est **entièrement synchrone** (aucun `await` de bout en bout), rien ne
> peut donc s'intercaler entre la lecture de `usersInRoom` et `peer.call()` — l'argument
> de section critique ne s'applique pas. L'exigence « avant `addRemotePeerId` », elle,
> est réelle : cette écriture vit **hors** du verrou, et c'est la seconde moitié de la
> faille. Le garde va donc au plus tôt.

- Nouveau `Composables/utils/isAuthorizedPeer.js` — prédicat pur, sans état, importable de
  partout (comme le reste de `utils/`) : `isAuthorizedPeer(userSlug, ctx)` =
  `isValidSlug(userSlug)` **ET** (`ctx.connection.usersInRoom.includes(userSlug)` **OU**
  `ctx.isAuthorizedCallPeer(userSlug)`). Réutilise `isValidSlug` de `utils/validators.js` —
  pas de regex locale (convention « un seul système »).
- `usePeerConnections.connectToPeer` : appeler le prédicat **avant**
  `ctx.peerStore.addRemotePeerId` — donc avant toute ouverture ET avant l'écriture du
  mapping. `return false` + `console.warn` détaillé sinon. Placer après la garde anti-self
  et **après l'acquisition du verrou** `inFlightConnections`, pour rester dans la section
  critique.

> ⚠️ **Ne pas** poser ce garde dans `useSignalingQueue`. L'absence de précondition dans le
> routage est un invariant documenté, déjà cassé une fois (régression du 13/08 : un
> `waitForMeReady` ajouté au routage a fait disparaître les flux chez les arrivants, de
> façon intermittente). Un signal abandonné au routage l'est définitivement.
>
> ⚠️ `return false` et **non** `true`. `true` signifie « pas d'erreur » et **annule** le
> retry ; `false` le diffère. C'est exactement le piège de l'item « Retry annulé alors
> qu'aucune connexion n'a été ouverte » de [`webrtc2-todo.md`](webrtc2-todo.md).

**Tests** — `usePeerConnections.test.js`, **cas négatifs d'abord** :
- pair ni membre de room ni appel autorisé ⇒ `false`, **et** `peer.call` / `peer.connect`
  jamais appelés, **et** `addRemotePeerId` jamais écrit (l'empoisonnement du mapping est la
  seconde moitié de la faille — cf. l'encadré du lot) ;
- les 4 types porteurs de flux (`stream`, `screen`, `visio`, `vocal`) ⇒ aucun flux émis ;
- membre de room ⇒ inchangé ;
- pair d'appel autorisé **hors room** ⇒ inchangé. Non-régression essentielle : c'est
  précisément le cas que le correctif entrant de mai avait cassé (visio 1-à-1 bloquée en
  « pending »).

**Done :** `npx vitest run` vert, **`scenarios/lateJoiner.test.js` inclus** — c'est lui qui
exerce le chemin signalisation → `connectToPeer` que ce garde durcit.
**Commit :** `secu(webrtc2): refuser une connexion sortante vers un pair non autorisé`

---

### A3 — Scénario bout en bout « mallory » `[M]`

- [x] **Dépend de :** A2. — ✅ fait le 15/08/2026 (`scenarios/outgoingAuth.test.js`).

> **Delta assumé — mallory doit désarmer son propre garde entrant.** Écrit tel que décrit
> ci-dessous, le scénario était **vert avant le correctif** : alice poussait bien son
> flux, mais `_isAuthorizedIncomingPeer` **chez mallory** le refusait — l'attaquant se
> protégeait tout seul. Exactement le faux positif que le protocole « rouge d'abord »
> sert à détecter, et il l'a détecté.
>
> Le fichier déclare donc `alice` dans le `usersInRoom` **local** de mallory
> (`claimLocally`, un `syncUsersConnections` sans aucune autorité : la vue qu'alice a de
> sa room est inchangée). C'est la seule façon, dans le harnais, de modéliser ce qu'un
> vrai attaquant obtient en supprimant ce garde de son bundle. Avec elle, les 3 cas
> offensifs échouent avant A2 (`receivedStreamsFrom()` = `['alice']`, mapping =
> `peer-mallory`) et passent après — contre-vérifié en neutralisant le garde.

Nouveau `__tests__/scenarios/outgoingAuth.test.js`, sur le harnais existant
(`createVirtualPeer` + `fakeSignalingServer` + `__mocks__/peerjs.js` en mode bus).

> ⚠️ **Protocole du paquet : écrire ce scénario AVANT A2 et vérifier qu'il est rouge.**
> Un scénario vert d'emblée est un mauvais signe — il ne teste pas ce qu'on croit. Il se
> **commite après** A2 pour ne jamais pousser en rouge (`hooks/pre-push`).

Cas, tous asserés sur le **fait métier** (`mallory.receivedStreamsFrom()`), jamais sur un
appel de fonction interne :

1. `alice` diffuse sa webcam ; `mallory`, **hors room**, injecte un faux `ResponseToPeerID`
   ⇒ ne reçoit **aucun** flux ;
2. idem avec `connectionType: 'screen'` ⇒ aucun écran ;
3. idem sur le contexte permanent `data-app` ⇒ aucun canal data ouvert **et**
   `peerStore.remotePeersId` ne contient pas `mallory` ;
4. non-régression : `bob`, membre de la room, reçoit bien le flux d'`alice`.

Respecter les trois invariants du harnais (cf. [`docs/modules/webrtc2/tests.md`](../docs/modules/webrtc2/tests.md)) :
`vi.resetModules()` par pair, montage séquentiel, une tâche de boucle d'événement par signal.

**Done :** les 3 premiers cas échouent si l'on retire le garde de A2.
**Commit :** `test(webrtc2): scénario — un tiers ne peut pas se faire pousser un flux`

---

# LOT B — Durcir le sens entrant 🟠

### B0 — Caractériser : le mapping peerId précède-t-il l'admission ? `[S]`

- [x] **Dépend de :** rien. **Prérequis de B1.** — ✅ fait le 15/08/2026
  (`scenarios/incomingMappingInvariant.test.js`).

> ## 🔴 VERDICT : le mapping est ABSENT sur le chemin présence
>
> | chemin d'admission | mapping posé quand la connexion arrive ? |
> |---|---|
> | arrivant tardif (`stream`) | ❌ **non** |
> | partage d'écran (`screen`) | ❌ **non** |
> | appel direct accepté (`visio`) | ✅ oui, et concordant |
>
> **La cause est structurelle, pas une course.** Le mapping du récepteur est écrit par
> **sa propre** `connectToPeer` — donc quand c'est LUI qui ouvre. Sur le chemin présence,
> le premier contact est l'appel **entrant** de l'autre : il arrive nécessairement avant.
> Sur l'appel direct, `acceptCallFromPeer` écrit le mapping **avant même de répondre** à
> l'invitation, et l'appel entrant ne vient qu'après. Les deux chemins sont opposés par
> construction — aucun réglage de timing ne les rapprochera.
>
> **B1 prend donc sa seconde forme** (cf. ci-dessous) : fusionner (a) et (b) fermerait
> toute diffusion en room. C'était exactement le pari que cette tâche servait à éviter.

L'anti-usurpation de `_isAuthorizedIncomingPeer` (règle 3) ne se déclenche que si
`_resolveSenderSlugFromIncomingConn` résout le peerId entrant. La rendre inconditionnelle
peut casser l'admission **légitime** si le mapping n'est pas encore posé à cet instant.
Il faut le savoir avant, pas le découvrir en régression.

Assertion sur l'invariant, dans `scenarios/lateJoiner.test.js` ou un fichier voisin : au
moment de `peer.on('connection'|'call')` chez le récepteur,
`peerStore.getRemotePeerId(metadata.from)` vaut-il `conn.peer` ? À mesurer sur les **trois**
chemins — arrivant tardif, appel direct accepté, partage d'écran.

> **Delta assumé — le harnais a dû apprendre l'invitation d'appel.** Le chemin « appel
> direct » n'était atteignable par aucun scénario : `fakeSignalingServer` journalisait
> `/send-alert-to-user` et `/response-to-authorization-peer` sans les router (choix
> explicite de l'époque, « hors périmètre tant qu'aucun scénario ne les vise »). Ils le
> sont désormais, sur un **second canal** : ces deux events arrivent sur le canal
> utilisateur Reverb, que `Notifications.vue` écoute — pas sur la file de signaux du
> store. Le harnais s'arrête au bord du composant (`bindUserChannel`) et laisse le test
> tenir son rôle, décision humaine du composant d'alerte comprise ; le router jusqu'au
> bout aurait demandé de monter le composant.
>
> **Delta assumé — le probe lit avant le garde, pas après.** Un `peer.on('connection')`
> posé par le test passerait **après** le handler de production (le mock appelle ses
> handlers dans l'ordre d'enregistrement, et `initializePeerConnection` a déjà branché le
> sien) : on mesurerait l'état d'après l'admission. Le probe est donc inséré en tête de
> `_handlers` — seul point d'observation qui réponde à la question posée.

**Done :** l'invariant est **documenté par un test**, vrai ou faux. S'il est faux sur un
chemin, B1 change de forme — ce test décide.
**Commit :** `test(webrtc2): caractériser la présence du mapping peerId à l'admission`

---

### B1 — Anti-usurpation inconditionnelle sur le chemin présence `[M]` 🟠

- [x] **Dépend de :** B0. — ✅ fait le 15/08/2026.

> ## ⚠️ Ce que B1 ferme — et ce qu'il ne ferme pas
>
> **La faille d'origine reste ouverte, et c'est structurel.** Après le verdict de B0, le cas
> **nominal** de la présence et l'usurpation ont la **même signature locale** : slug déclaré
> membre, peerId entrant inconnu. Aucun garde côté récepteur ne peut les distinguer — il lui
> manque la source de vérité. B1 fait donc les deux seules choses qu'un client puisse faire :
> rendre la règle 3 **inconditionnelle**, et **tracer** l'admission non corroborée. La
> fermeture revient à **C2**, seul détenteur du lien `Auth::user()` ↔ peerId relayé. Ne pas
> clore le lot B en lisant « anti-usurpation faite ».
>
> **Trouvaille — le chemin (b) était perméable dans l'autre sens.** La règle 3 était enfermée
> dans `if (isRoomMember)` au motif que (b) vérifie déjà la concordance. Mais (b) ne la
> vérifie que dans le sens **slug → peerId** : un pair hors room dont le mapping concorde
> était admis alors que ce **même peerId** était aussi mappé à un membre de la room. La
> résolution inverse, désormais hors du `if`, le refuse. C'est le seul durcissement de B1 qui
> change un verdict, et il a sa contre-épreuve (test rouge sans le correctif, vérifié).
>
> **Delta assumé — la liste de tests prévue datait de l'option morte.** Le premier cas écrit
> ici (« membre + peerId neuf ⇒ **rejet** ») est mot pour mot la lecture que B0 a écartée. Il
> est **inversé** : c'est une contre-épreuve d'admission, qui épingle en plus la trace de
> non-corroboration. Le laisser tel quel aurait fait implémenter la régression que B0 a servi
> à éviter.
>
> **Registre de la trace : `console.debug`, pas `warn`.** Sur le chemin présence la
> non-corroboration est **nominale** — elle arrive à chaque connexion entrante légitime. Au
> niveau `warn` elle noierait les vrais refus. Le logger centralisé reste un item de
> [webrtc2-todo.md](webrtc2-todo.md).

**Faille :** un membre de la room qui ouvre un **second** `new Peer()` (UUID neuf, donc non
mappé) obtient `resolvedSlug = null` → la règle 3 est **sautée** → il est admis sur la
seule foi d'un `metadata.from` déclaratif qui n'a qu'à nommer un membre de la room. Il
parle alors sous l'identité de l'usurpé : chat, `BROADCAST_STATE` et `AUDIO_MUTE_TOGGLE`
lisent tous `resolveRemoteSlug`, donc `metadata.from`.

Le commentaire du code qualifie ce contrôle de « défense-en-profondeur » alors qu'il est en
réalité **le seul** anti-usurpation du chemin (a) : le chemin (a) n'exige rien d'autre
qu'un slug déclaré présent dans `usersInRoom`.

*(Le hub star, lui, est sain : `forwardStarMessage` abandonne quand l'expéditeur n'est pas
résolu depuis la connexion — la retransmission n'est pas usurpable.)*

~~Selon le verdict de B0~~ — **tranché** : le mapping est **absent** à l'admission sur tout
le chemin présence (diffusion, écran), et c'est structurel. La première option est donc
**morte** ; elle aurait fermé toute diffusion en room.

- ~~**mapping toujours présent** ⇒ fusionner (a) et (b)~~ — exclu par B0.
- ✅ **Forme retenue** — conserver deux chemins, mais exiger sur (a) que le peerId entrant
  ne soit résolu à **aucun** autre slug, **et** journaliser l'admission non corroborée en
  préparation d'un durcissement ultérieur.

> ⚠️ Conséquence directe : `_resolveSenderSlugFromIncomingConn` renvoie `null` dans le cas
> **nominal** du chemin présence. Le durcissement porte donc sur « résolu à un AUTRE
> slug ⇒ rejet », jamais sur « non résolu ⇒ rejet » — cette seconde lecture est
> précisément celle que B0 vient d'écarter. Le test de non-régression qui l'épingle est
> le cas « arrivant tardif » de `scenarios/incomingMappingInvariant.test.js`.

**Tests** — `usePeerTransport.incomingAuth.test.js`, 3 cas ajoutés (20 dans le fichier) :
- ~~`from` = membre + peerId neuf non mappé ⇒ **rejet**~~ → **inversé** : ⇒ **admis**, et la
  trace « Admission entrante non corroborée » est émise. Contre-épreuve de la lecture que B0
  a écartée ;
- hors room + mapping concordant, **mais** ce peerId est aussi mappé à un membre de la room
  ⇒ **rejet**. C'est le cas que le `if (isRoomMember)` laissait passer — vérifié rouge en
  réintroduisant le garde d'avant ;
- peerId résolu au slug déclaré ⇒ admis **sans** trace de non-corroboration (sinon un garde
  qui tracerait tout passerait le premier cas sans rien mesurer) ;
- mapping concordant ⇒ admis · discordant ⇒ rejet · usurpation intra-room ⇒ rejet · appel
  direct vérifié ⇒ admis : non-régressions déjà couvertes, inchangées.

**Done :** suite complète verte — **35 fichiers, 630 tests** (15/08/2026), dont `lateJoiner`,
`peerDeparture` et `incomingMappingInvariant`.
**Commit :** `secu(webrtc2): anti-usurpation inconditionnelle à l'admission entrante`

---

### B2 — `responseRemotePeerConnection` ne répond qu'à un demandeur autorisé `[S]` 🟠

- [x] **Dépend de :** A1 + A2 (réutilise `utils/isAuthorizedPeer.js`). — ✅ fait le 15/08/2026.

> **Delta assumé — les tests nominaux préexistants ne l'étaient pas.** Les 5 cas du
> `describe('responseRemotePeerConnection')` répondaient à `bob` avec un `usersInRoom`
> **vide** : ils décrivaient donc, sans le dire, le chemin que ce garde ferme. Un
> `beforeEach` local déclare désormais `bob` présent. Ne pas le lire comme un
> assouplissement du test : c'est l'inverse, le chemin nominal a maintenant une
> précondition explicite, et les cas offensifs repartent d'une room vide.
>
> **Deux tests au-delà des trois prévus** : slug invalide (`undefined`, `''`, malformé,
> non-string — le payload vient du réseau, `isValidSlug` sort en premier) et une
> contre-épreuve de purge (autorisé ⇒ répond, `clearAuthorizedCallPeer` ⇒ refuse à
> nouveau). Sans elle, un garde qui lirait un état toujours vrai — `currentCallUsers`,
> précisément l'écueil qu'A1 a écarté — passerait le cas nominal (b).
>
> **Pourquoi ce garde ne peut pas casser un chemin légitime** que A2 n'ait pas déjà
> fermé : c'est le **même prédicat sur le même contexte**. Refuser de livrer son peerId à
> un pair vers qui `connectToPeer` refuserait déjà d'ouvrir ne retire rien. La symétrie
> tient parce que les deux chemins d'autorisation le sont : `usersInRoom` vient du même
> canal Reverb pour les deux parties, et `authorizedCallPeers` est marqué **des deux
> côtés** par `useCallManager` (`acceptCallFromPeer` chez l'appelé, `openCallBetweenPeer`
> chez l'appelant).
>
> **Reste vrai :** une demande légitime arrivée avant que la présence Reverb n'ait peuplé
> `usersInRoom` **de mon côté** est refusée. D'où `return false` et non `true` — le
> demandeur repart sur sa propre re-demande une fois `SIGNALING_STALE_MS` écoulé. Même
> arbitrage qu'en A2, pour la même raison.

`usePeerCore.responseRemotePeerConnection` renvoie le peerId local à **tout** demandeur,
sans vérifier son appartenance → récolte de peerId à la demande, qui alimente les deux
failles ci-dessus.

- Garde en tête, juste après la garde `localPeerId` existante :
  `isAuthorizedPeer(payload.fromUserSlug, ctx)` faux ⇒ `console.warn` + `return false`.

**Tests** — `usePeerCore.test.js` : demandeur hors room et hors appel autorisé ⇒ `false` et
**aucun POST** vers `RESPONSE_TO_PEER_ID` · membre de room ⇒ POST inchangé · pair d'appel
autorisé ⇒ POST inchangé.

**Commit :** `secu(webrtc2): ne répondre son peerId qu'à un demandeur autorisé`

---

### B2-fix — Régression : « A diffuse, B arrive, B ne voit rien » `[M]` 🔴

- [x] **Corrigé le 15/08/2026**, signalé en production juste après B0.

> **Le pari du « Reste vrai » ci-dessus était faux.** Le repli annoncé — « le demandeur
> repart sur sa propre re-demande après `SIGNALING_STALE_MS` » — n'a jamais lieu à temps :
> le premier retry qui peut re-demander est le 4ᵉ (backoff 1+2+4+8 s), et surtout le
> `peer.call` qui suivrait se heurterait au **second** garde, `_isAuthorizedIncomingPeer`,
> qui lit le même `usersInRoom` vide. Là, plus aucun filet : PeerJS ne notifie pas le
> `close()` d'un appel jamais répondu, et l'émetteur voit son `peerConnection` en
> `connecting` — donc `hasOpenConnection` vraie, donc son moteur de retry **s'arrête**.
> Écran noir définitif, sans une seule erreur console (seulement le `console.warn`
> « demandeur non autorisé » chez le récepteur).
>
> **Ce n'est pas une course symétrique.** L'ordre est structurel et joue toujours contre
> l'arrivant : son `usersInRoom` n'est écrit qu'après `waitForMeReady`, qui attend
> `lastLocalPeerId` — c'est-à-dire *après* la garde `getLocalPeerId` que
> `responseRemotePeerConnection` franchissait déjà avant B2. Le garde ajouté par B2 tombe
> donc pile dans la fenêtre que l'ancien laissait passer ; d'où « aléatoire » côté
> utilisateur, selon que la présence Reverb a battu ou non l'aller-retour HTTP du
> diffuseur.
>
> **Pourquoi le harnais ne l'a pas vu :** `connectRoom` livre la présence à tous les pairs
> dans le même tick (choix documenté, cf. son en-tête) — il referme la fenêtre avant de
> l'ouvrir. Le cas est désormais couvert en livrant la présence pair par pair.

**Correctif — une liste vide n'est pas une réponse.** `usersInRoom` vide ne dit pas « ce
pair n'est pas membre », il dit « je ne sais pas encore qui est membre ». Nouveau fait
`connection.presenceSynced` (même écrivain unique que `usersInRoom` :
`_doGetRoomUsersDiff`) et attente `ctx.waitForPresenceSync()` — mémoïsée par contexte, une
promesse et un timer pour sa vie entière, plafond `PRESENCE_SYNC_TIMEOUT_MS` (5 s, sous
`SIGNALING_STALE_MS` qui reste le filet extérieur).

Les deux gardes du chemin (a) attendent cette synchronisation **avant de refuser**, jamais
avant d'admettre : le chemin (b) reste immédiat, donc la visio n'est pas ralentie et
`data-app` — sans canal de présence — n'attend rien.

- `usePeerCore.responseRemotePeerConnection`
- `usePeerTransport` : `_admitIncoming`, qui enveloppe `_isAuthorizedIncomingPeer`
  (booléen quand la décision est immédiate, promesse dans le seul cas différé — un `async`
  inconditionnel repoussait `setUpConnectionListeners` d'une microtâche sur **tous** les
  chemins, ce que 20 tests ont immédiatement signalé). Option `quiet` sur le prédicat : un
  refus provisoire ne se journalise pas.

**Tests** (chacun contre-vérifié en neutralisant la ligne qui le porte) :
- `scenarios/lateJoiner.test.js` — « B reçoit le flux quand la demande de peerId d'A
  précède sa présence » : présence livrée à A **puis** à B ;
- `usePeerCore.test.js` — attend puis répond · attendre n'est pas admettre ;
- `usePeerTransport.incomingAuth.test.js` — diffère puis admet · refuse quand la présence
  arrive sans lui.

`createMockContext` déclare `presenceSynced: true` par défaut : un contexte de test qui se
voit attribuer un `usersInRoom` décrit une room qu'il **connaît**.

**Reste ouvert — même conflation, `connectToPeer` (A2).** Le garde sortant est
**synchrone** et son booléen est le contrat du moteur de retry : il ne peut pas attendre
sans changer ce contrat. Conséquence actuelle : un `PEER_CONNECT_TO_REMOTE_PEER` reçu avant
la présence est refusé **avant** `addRemotePeerId`, donc le peerId frais est perdu et le
contexte attend `SIGNALING_STALE_MS` avant de redemander. Sans effet sur le symptôme
rapporté (le récepteur n'a pas de flux à pousser), mais visible dès que **les deux** pairs
diffusent. À traiter avec B1.

**Commit :** `fix(webrtc2): ne pas conclure sur une présence pas encore connue`

> ### ⚠️ Suite — B2-fix ne suffisait pas, et la cause principale était ailleurs
>
> Le symptôme a persisté après le correctif ci-dessus, alors même que le dev server
> servait bien le nouveau code. Trois observations l'ont tranché : chez B, la carte Debug
> du contexte `stream` montrait bien alice dans `usersInRoom` (donc la présence était
> synchronisée, le garde n'était plus en cause) ; le « demandeur non autorisé » subsistait
> néanmoins ; et côté A, « Could not connect to peer &lt;uuid&gt; » apparaissait **une seule
> fois, puis plus rien**. Voir l'entrée suivante.
>
> Ce que B2-fix corrige reste juste et nécessaire — une fenêtre réelle, désormais fermée —
> mais ce n'était pas ce qui bloquait l'utilisateur. Le refus qu'il observait venait d'un
> AUTRE contexte (`data-app`), pour une raison sans rapport avec la présence.

---

### B2-fix-2 — La recovery ne profitait qu'au premier contexte inscrit `[M]` 🔴

- [x] **Corrigé le 15/08/2026.** Cause principale du « B ne voit rien » rapporté.

> **Défaut 1 — le retry conclut au succès sur un appel jamais répondu.**
> `_handleConnectionAttempt` testait son succès avec `hasOpenConnection`, qui admet une
> MediaConnection en `connecting` — l'état exact d'un `peer.call()` sans réponse, et dont
> WebRTC ne sort jamais seul. Le moteur s'arrêtait donc ~1 s après l'appel. Deux prédicats
> désormais, aux postures opposées : `hasOpenConnection` (« ne pas ouvrir en double »,
> optimiste) et `isConnectionEstablished` (« c'est fini », strict). Détail et table dans
> [docs/modules/webrtc2/architecture.md](../docs/modules/webrtc2/architecture.md).
>
> **Défaut 2 — la recovery `peer-unavailable` s'auto-aveuglait.** La résolution
> peerId → slug vivait DANS la boucle sur les contextes, et chaque tour invalidait un
> mapping **partagé par tout l'onglet** : le premier contexte itéré consommait le fait,
> tous les suivants sortaient sur `if (!targetSlug) return`. Or `Notifications.vue` crée
> `data-app` au tick 0 — premier dans le registre (Map, ordre d'insertion). C'est donc lui
> qui absorbait la relance, et le contexte de diffusion, seul à avoir un flux à repousser,
> n'était **jamais** relancé. La résolution se fait désormais une fois, avant toute
> mutation.
>
> Et comme `data-app` n'a aucun canal de présence, sa re-demande ne pouvait qu'être
> refusée en face : c'est l'origine exacte du « demandeur non autorisé » résiduel, qui a
> masqué le vrai problème pendant tout le cycle. La relance est maintenant réservée aux
> contextes pour qui le pair est quelque chose — `isAuthorizedPeer`, le même prédicat que
> les deux autres sorties du contexte, ce qui préserve la recovery de la visio 1-à-1 (elle
> n'a aucune room commune et ne tient qu'à `authorizedCallPeers`).
>
> **Défaut 3 — le mock PeerJS niait l'asymétrie de PeerJS**, et c'est pourquoi 613 tests
> verts n'avaient rien vu. Trois mensonges, tous corrigés : naissance en `connected`,
> propagation de `close()` sur une paire jamais ouverte, et orphelin `peer-unavailable`
> sans `conn.peer`. Ce dernier empêchait la purge de la connexion morte — le scénario de
> bout en bout ne convergeait pas tant qu'il subsistait.

**Tests** (chacun contre-vérifié en neutralisant la ligne qui le porte) :
- `useConnectionPool.test.js` — « ne conclut PAS sur un appel ouvert mais jamais répondu » ;
- `usePeerConnections.test.js` — `isConnectionEstablished`, dont « un canal data ouvert ne
  vaut PAS appel média établi » (contexte `stream` : deux connexions, un seul type) ;
- `usePeerTransport.peerUnavailable.test.js` — relance du contexte de diffusion inscrit
  APRÈS `data-app` · pas de relance pour un contexte à qui ce pair n'est rien · relance
  préservée pour un appel direct autorisé ;
- `scenarios/multiContext.test.js` — bout en bout, dans l'ordre de montage réel.

**Observabilité :** `Widgets/UI/Report/Debug.vue` affiche désormais `presenceSynced`, le
peerId local, le mapping slug → peerId de l'onglet, les demandes en vol du contexte et
l'état réel de chaque connexion. Ces quatre lignes auraient évité un aller-retour complet
de diagnostic.

**Commit :** `fix(webrtc2): le retry ne conclut plus sur une connexion non établie`

---

### B3 — Une acceptation non sollicitée ne doit rien inscrire `[S]` 🔴

- [x] **Dépend de :** rien. **Trouvé le 15/08/2026** en cadrant l'arbitrage de C2 — ✅ fait le
  15/08/2026.

> **Delta assumé — pas de contrôle du `contextId`, contrairement au plan initial.** Le
> troisième test prévu ici (« acceptation d'un autre contexte de l'onglet ⇒ n'autorise pas
> ce contexte-ci ») décrivait un durcissement qui aurait **fabriqué** une régression. En
> traçant les appelants : `openCallBetweenPeer` ne s'exécute que dans le contexte de
> `Notifications.vue` (`useMediaBroadcast()` sans argument ⇒ `data-app`), seul destinataire
> de `.ResponseToAuthorizationPeer`, alors que `startCallWithPeer` est exposé par **toute**
> instance de `useMediaBroadcast`. Une invitation émise par un provider de room porterait
> donc un `contextId` différent de celui qui traite l'acceptation. Le test est **inversé** :
> ce cas est admis, et il vire au rouge si un contrôle de `contextId` se glisse un jour.
> Aucune perte de sécurité — l'onglet a bien invité ce pair, c'est le seul fait qui compte.
>
> **Delta assumé — le `beforeEach` du bloc de tests n'était pas fidèle.** Il annonçait
> « l'ouverture suit toujours une invitation émise » et appelait bien `startCallWithPeer`,
> mais `core` était un mock nu : **aucune demande en vol n'était réellement enregistrée**.
> Les six cas « nominaux » du bloc décrivaient donc, sans le dire, le chemin que cette garde
> ferme. Le mock de `core.requestAuthorizationRemotePeerId` écrit désormais dans le store
> comme la production, et l'invitation impose sa room pour que la clé se referme sur celle
> qu'`answerPayload()` renvoie. Même nature que le delta relevé en B2 — ne pas le lire comme
> un assouplissement : le chemin nominal a maintenant une précondition explicite.
>
> **Durcissement joint** : `addRemotePeerId` est désormais conditionné à la présence de
> `options.peerId`, comme le fait déjà `acceptCallFromPeer`. L'écriture était
> inconditionnelle — `options` absent levait un TypeError dans un handler `async`, et un
> `peerId` absent mappait `undefined`. Même classe de défaut : le payload vient du réseau.
>
> **La branche `!payload.status`** (refus distant) est laissée telle quelle : morte en
> production, `Notifications.vue` traite le refus lui-même sans appeler cette fonction.

> **Les lots A et B sont contournables par la route de réponse.** Tracé statiquement, non
> exploité en live.
>
> Dans `useCallManager.openCallBetweenPeer`, `ctx.peerStore.addRemotePeerId(...)` et
> `ctx.markAuthorizedCallPeer(...)` s'exécutent **avant** la garde
> `ctx.callMachine.transition(CALL_STATES.CONNECTED)`. La machine refuse bien
> IDLE → CONNECTED (`utils/useCallStateMachine.js`, table `VALID_TRANSITIONS`) : aucune
> session ne démarre. **Mais les deux écritures ont déjà eu lieu.**
>
> Conséquence : un POST `/response-to-authorization-peer` avec `status: true` vers une
> victime **qui n'a jamais invité personne** inscrit l'attaquant dans
> `session.authorizedCallPeers` — précisément l'allowlist créée par A1 et lue par
> `utils/isAuthorizedPeer.js`. À partir de là, l'attaquant satisfait le prédicat aux
> **deux** sorties du contexte : B2 lui livre le peerId de la victime, A2 laisse
> `connectToPeer` lui ouvrir la connexion. Si la victime diffuse, son flux part.
>
> **Ce cas-là, le client PEUT le trancher seul** — contrairement à l'usurpation
> intra-room de B1. « Ai-je invité ce pair ? » est un fait purement local, déjà porté par
> `peerStore.waitingRemotePeerId`, que `requestAuthorizationRemotePeerId` écrit sur la clé
> exacte (slug, room d'appel, type). Aucune source de vérité serveur n'est nécessaire.
>
> ⚠️ **Ne pas se contenter de C2.** Le garde serveur réduira la surface aux seuls pairs en
> relation, mais un contact légitime resterait capable de s'auto-autoriser sans invitation.
> Les deux correctifs sont complémentaires, celui-ci est indépendant et immédiat.

- `openCallBetweenPeer` : exiger la demande en vol **avant** toute écriture — lire
  `waitingRemotePeerId` sur la clé (slug, `room || currentCallRoomId`, type) au lieu de la
  purger inconditionnellement, et sortir si elle est absente. Déplacer `addRemotePeerId` et
  `markAuthorizedCallPeer` **après** cette garde.

**Tests** — `useCallManager.test.js`, 5 cas ajoutés, négatifs d'abord :
- acceptation d'un pair jamais invité ⇒ **rien** n'est écrit : ni `remotePeersId`, ni
  `authorizedCallPeers`, aucune connexion ouverte, et l'invitation en cours vers un tiers
  n'est pas emportée ;
- acceptation sur une **autre** room ou un **autre** type que l'invitation ⇒ même refus
  (épingle la clé composite : un garde indexé sur le slug seul passerait sans rien voir) ;
- acceptation d'une invitation réellement émise ⇒ inchangé (non-régression de la visio
  1-à-1), et la demande est **consommée** — une seconde acceptation ne repasse pas ;
- invitation émise par un **autre** contexte de l'onglet ⇒ **admise** (contre-épreuve du
  delta assumé ci-dessus) ;
- acceptation sans `peerId` ⇒ le mapping n'est pas écrit.

**Done :** ✅ **645 tests / 36 fichiers** verts (15/08/2026). Les trois cas offensifs étaient
rouges avant la garde — contre-vérifié. `scenarios/incomingMappingInvariant.test.js`, qui
exerce l'appel direct avec le **vrai** `usePeerCore`, reste vert sans retouche : la clé se
referme donc aussi hors mock.
**Commit :** `secu(webrtc2): n'accepter une réponse d'appel que pour une invitation en vol`

---

# LOT C — Backend Laravel 🟠

> `UserController.php` — **C3 → C4 → C2 → E3 touchent tous le même fichier : à sérialiser**
> pour garder des diffs lisibles.

### C1 — `throttle` sur les 5 routes de signalisation `[S]`

- [x] **Dépend de :** rien. — ✅ fait le 15/08/2026.

Aucun middleware `throttle` sur `routes.private.php` (vérifié, ainsi que le
`ServiceProvider`). Le limiteur client de `usePeerCore` est correctement décrit comme
anti-spam involontaire — mais un attaquant le contourne en une ligne, et rien ne le
remplace côté serveur. `sendAlertToUser` sans plafond = spam d'invitations d'appel vers
n'importe quel utilisateur.

> ## ⚠️ Delta assumé — DEUX buckets, pas un. Un seul ne pouvait pas tenir les deux bouts.
>
> Cette tâche disait « groupe `throttle` sur les 5 routes ». Mesuré dans le code, les 5 routes
> n'ont pas la même cadence légitime, et l'écart est d'un ordre de grandeur :
>
> | | cadence légitime | source |
> |---|---|---|
> | `ask` / `response` / `close` | **14 requêtes dans le même tick** au join | `MAX_PEERS_PER_ROOM`, note de `ASK_PEER_MAX_REQUESTS_PER_WINDOW` |
> | `send-alert` / `response-authorization` | **~9 requêtes / 55 s vers UNE cible**, sur clic humain | `usePeerCore.js` + backoff 1-2-4-8-10-10-10 s de `utils/usePeerRetry.js` |
>
> Un plafond unique dimensionné pour le join (≥ 14/tick) laisse donc passer ~120 invitations
> d'appel par minute vers une victime : il **ne ferme pas l'abus que cette tâche nomme**.
> Contre-vérifié — en refusionnant les deux buckets, `l_invitation_est_plafonnee_par_cible`
> repasse à **200**.
>
> - **`socializer-signaling`** — `ask` / `response` / `close` — **120/min par utilisateur**.
>   8,5× la rafale de join ; couvre le hopping de rooms (3 rooms/min ≈ 84 requêtes). Écrête
>   volontairement la boucle de recovery dégénérée (`peer-unavailable` sur 14 clés × 3/10 s
>   ≈ 250/min) : c'est déjà la raison d'être du limiteur client, et un 429 sur
>   `/ask-to-peer-id` est rattrapé par la re-demande de `SIGNALING_STALE_MS`.
> - **`socializer-call-invite`** — `send-alert` / `response-authorization` — **deux limites
>   composées** : 20/min par (émetteur, cible) et 40/min par émetteur. La seconde n'est pas
>   décorative : sans elle, la limite par cible se contourne en arrosant N victimes.
>
> **Delta assumé — la clé est l'utilisateur, jamais l'IP.** Derrière le NAT d'une entreprise,
> une clé IP ferait que le join d'un collègue casse celui du voisin. `auth` s'exécute avant
> `throttle` (ordre garanti par `$middlewarePriority`), donc `user()` est toujours résolu.
>
> **Delta assumé — `/send-alert-to-user` a changé de section.** Il vivait sous « Users » ; ses
> seuls appelants sont `usePeerCore` et le module v1 mort. Déplacé dans la section WEBRTC pour
> que les deux buckets soient contigus et relisibles.
>
> **✅ La réserve laissée par C3 est levée — par construction.** C3 notait qu'un garde vivant
> dans la pile `web` échapperait au harnais (réduit à `['auth']`). Le throttle est posé sur les
> **routes elles-mêmes** : il est bien exercé, la réserve ne s'applique pas. Elle reste ouverte
> pour C2/C4, qui vivront dans le contrôleur.

- Groupe `throttle` sur les 5 routes, valeurs dans `config/socializer.php` →
  `signaling.throttle`, limiteurs dans `ServiceProvider::registerSignalingRateLimiters()`.

> ⚠️ Dimensionner **au-dessus** de la cadence légitime déjà documentée côté client : un
> join de room mesh émet jusqu'à **14 demandes dans le même tick** (7 pairs × type
> principal + écran, cf. `MAX_PEERS_PER_ROOM` et la note de `ASK_PEER_MAX_REQUESTS_PER_WINDOW`
> dans [`webrtc2.config.js`](../src/resources/js/socializer/components/WebRTC2/webrtc2.config.js)). Un plafond trop bas casse le join —
> c'est le piège pour lequel le plafond client est **par cible** et non global.
>
> ⚠️ **Les plafonds se lisent dans `config()` à chaque requête, jamais capturés au boot.** C'est
> ce qui les rend ajustables en prod *et* ce qui permet aux tests de rétrécir la limite au lieu
> d'émettre 121 requêtes HTTP. Les défauts sont répétés en second argument de `config()` :
> `mergeConfigFrom` est un `array_merge` **peu profond**, un hôte au `signaling` partiel
> écraserait toute la section du paquet.

**Tests :** ✅ `tests/Feature/Signaling/ThrottleTest.php` — 8 tests. Rafale de join (14 requêtes,
plafonds **réels**) ⇒ aucun 429 · au-delà du plafond ⇒ 429 **et aucun broadcast émis** · compteur
par utilisateur, pas par IP · invitation plafonnée **par cible** (saturer bob ne retire rien à
charlie) · plafond global contre le spam multi-cibles · les deux buckets sont indépendants · les
3 routes mesh partagent le même budget.

Trois contre-épreuves passées, chacune rouge sur le seul test qu'elle vise : plafond ramené sous
la rafale de join (14) ⇒ le garde-fou de dimensionnement rougit ; clé basculée sur l'IP ⇒ bob se
fait 429 sur le compteur d'alice ; buckets refusionnés ⇒ 4 tests rouges, dont le plafond par cible.

**Done :** ✅ **15 tests PHP / 67 assertions** verts (15/08/2026) ; suite JS inchangée
(645 tests / 36 fichiers).
**Commit :** `secu(socializer): rate limiting serveur sur les routes de signalisation`

---

### C3 — Ne plus renvoyer l'objet exception `[S]`

- [x] **Dépend de :** rien. À faire avant C4/C2 (même fichier). — ✅ fait le 15/08/2026, avec
  le **socle de tests PHP** qu'il a servi à valider.

Les 5 méthodes de signalisation font `catch (\Exception $ex) { return $ex; }`. Laravel
sérialise l'objet : message, chemins de fichiers et trace partent au client,
**indépendamment d'`APP_DEBUG`**.

- `Log::error(...)` + réponse neutre (`abort(500)` ou `response()->json(['ok' => false], 500)`).

> **La fuite était pire que « Laravel sérialise l'objet ».** Mesurée par le test avant
> correctif : le routeur ne sait pas quoi faire d'un objet quelconque, alors il le confie à
> `Response::setContent`, qui accepte tout ce qui est `__toString()`-able — et
> `Throwable::__toString()` rend le message, le chemin, la ligne **et la trace complète**. Le
> tout en **200**, donc le client croyait avoir signalé. `APP_DEBUG` n'y pouvait rien : il ne
> gouverne que le handler d'exceptions, jamais une valeur retournée volontairement par un
> contrôleur. D'où `APP_DEBUG=true` dans `phpunit.xml` — le mode debug ne doit rien changer au
> verdict.
>
> **Delta assumé — un point unique plutôt que cinq blocs.** `UserController::signalingFailure()`
> porte le log et la réponse ; le nom de la route suffit à discriminer, et un format de log
> unique reste lisible en production. Contexte calqué sur le `Log::warning` d'usurpation déjà
> en place dans `closeConnectionToPeerId`.
>
> **Delta assumé — la pile de middlewares du harnais n'est pas celle de production.**
> `['auth']` au lieu de `['web','auth','routeProtect','verified','restrictedMode']` : traverser
> `web` ferait résoudre `Dauvray\Estarter\...\UserActivity`, poussé dans ce groupe par le
> ServiceProvider, et obligerait à tirer un paquet privé dans le harnais. **À rouvrir en C1** :
> le throttle s'ajoutera sur les routes elles-mêmes, donc il sera bien exercé — mais tout garde
> qui vivrait dans la pile `web` échapperait à ces tests.

**Tests :** ✅ `tests/Feature/Signaling/ExceptionLeakTest.php` — 7 tests, 23 assertions. Les 5
routes en `dataProvider` (ni chemin, ni trace, ni classe d'exception dans le corps · statut
500) · l'échec est journalisé avec de quoi diagnostiquer · le chemin nominal est inchangé
(200 vide, broadcast bien émis). Contre-épreuve : avant le correctif, les 5 cas échouaient en
exhibant le chemin **et** la trace.
**Commit :** `secu(socializer): ne plus exposer les exceptions de signalisation`

---

### C4 — Validation des payloads relayés `[S]`

- [x] **Dépend de :** C3. — ✅ fait le 16/08/2026.

Aucun `validate()` sur les 5 méthodes : `room`, `type`, `connectionType`, `peerId` et
`options` sont relayés bruts vers le client destinataire.

- `$request->validate()` : `toUserSlug` requis + format slug · `type` et `connectionType`
  en liste blanche (miroir de `VALID_CONNECTION_TYPES`) · `peerId` en UUID · `room` borné
  en longueur · `options` en tableau à clés attendues.

> ⚠️ Conserver la liste blanche de champs déjà en place à l'émission — c'est elle que
> `__tests__/helpers/fakeSignalingServer.js` reproduit **à l'identique**. La desserrer
> fabriquerait un chemin impossible en production et rendrait le harnais menteur.
> ✅ **Respectée** : C4 ne fait que *resserrer* (réduction d'`options` à ses clés
> attendues), la liste blanche de premier niveau du `->with()` est intacte, et le client
> n'a jamais envoyé d'autre clé. Suite JS inchangée, 645 tests.

> ## ⚠️ La sévérité était le risque, pas la permissivité
>
> Un 422 sur `/ask-to-peer-id` ou `/response-to-peer-id` reproduit « A diffuse, B arrive, B
> ne voit rien ». Chaque règle est donc calquée sur une émission **relue dans le client**,
> jamais sur une intuition de forme. Trois nullables qui ressemblent à des oublis et n'en
> sont pas :
>
> - **`connectionType`** — le module v1 (mort mais encore appelé par `AudioRoom`) ne
>   l'envoie pas, et le repli `connectionType || type` est un choix documenté de
>   rétrocompatibilité. Le rendre requis couperait ces appelants.
> - **`options.action`, sur la route de RÉPONSE seulement** — un refus d'appel n'envoie que
>   `{ type }` (`sendAuthorizationRemotePeerId`). L'exiger des deux côtés casserait le refus.
>   D'où le paramètre `actionRequired` d'`optionsRules()`, unique point de divergence entre
>   les deux routes d'invitation.
> - **`options.peerId`** — `getLocalPeerId` peut être `null` quand l'invitation part avant
>   l'ouverture du peer local.
>
> **`room` est bornée en longueur mais sans motif** : elle vaut tantôt un
> `crypto.randomUUID()`, tantôt `'app'`, tantôt un `room.id` de l'hôte. Il n'y a pas de
> forme commune à exiger.

> ## Delta assumé — les listes blanches sont des CONSTANTES, pas de la config
>
> C1 avait mis ses plafonds dans `config/socializer.php`, et la symétrie invitait à y mettre
> aussi les types valides. Écarté : un plafond est un **réglage** (légitimement ajustable en
> prod), une liste blanche est un **contrat** partagé avec le front. En config, un hôte la
> desserre sans toucher au JS qui la reflète, et le `mergeConfigFrom` peu profond signalé par
> C1 en fait une arme à écrasement silencieux.
>
> Le prix de ce choix est une duplication JS ↔ PHP que rien dans le build ne rapproche. Elle
> est **épinglée par un test** (`la_liste_blanche_php_reflete_le_front`) qui relit
> `webrtc2.config.js`, en extrait `VALID_CONNECTION_TYPES` et `SLUG_PATTERN`, et compare aux
> constantes du contrôleur. Sans lui, ajouter un type côté client produirait un 422 en
> production dont la cause serait invisible.

> ## Delta assumé — `options` est réduit à ses clés, pas seulement validé
>
> La tâche disait « `options` en tableau à clés attendues ». Validé ne suffisait pas :
> `options` est le **seul champ relayé verbatim**, donc valider `options.type` sans réduire
> l'objet laissait passer tout le reste — n'importe quelle charge, de n'importe quelle
> taille, poussée chez la victime. Il est désormais réduit à
> `RELAYED_OPTION_KEYS = ['type','action','room','peerId','inviteId']`, qui sont exactement
> les clés lues côté client (`useCallManager`, `Notifications.vue`, `AlertComponent.vue` —
> vérifié, aucune autre).
>
> `Arr::only` est **redondant** avec `Factory::$excludeUnvalidatedArrayKeys` (vrai par
> défaut). Conservé quand même : un hôte qui appelle `Validator::includeUnvalidatedArrayKeys()`
> rouvrirait le relais en silence, et la liste blanche doit être lisible à côté du `->with()`
> qu'elle gouverne.
>
> Corollaire trouvé en chemin : **`options.action` en liste blanche n'est pas cosmétique.**
> `AlertComponent.vue` déréférence `mappingComponents[options.action][options.type]` sans
> garde — une action inconnue y lève un TypeError chez le destinataire.

> ## ⚠️ Le `validate()` va HORS du `try` de C3, et c'est structurel
>
> `ValidationException` étend `\Exception`. Posé à l'intérieur, il serait avalé par
> `signalingFailure()` : le client recevrait un 500 `{"ok":false}` — il croirait à une panne
> serveur, et la vraie cause (son propre payload) serait invisible des deux côtés. Le cas
> `une_erreur_de_validation_ne_tombe_pas_dans_le_handler_d_echec` épingle exactement ça.
>
> Ordre effectif de la pile : `throttle` (routes) → `validate()` (contrôleur) →
> `firstOrFail()` → broadcast. **La clé du limiteur porte donc un `toUserSlug` non validé et
> le restera** — sans conséquence, `ThrottleRequests` md5-hashe la clé, mais le commentaire
> du `ServiceProvider` a été corrigé pour ne plus laisser croire que C4 fermerait ce point.

> ## Dette payée en passant — deux tests devenus verts pour la mauvaise raison
>
> `ExceptionLeakTest` et `ThrottleTest` envoyaient `peerId: 'p1'` et `options: []`. Ces
> payloads partent maintenant en **422**, donc bien avant le `Broadcast::private` dont ces
> deux fichiers testent respectivement l'échec et la consommation de bucket : ils seraient
> restés verts en n'exerçant plus rien. Payloads rendus valides, avec le ⚠️ qui dit pourquoi
> ils doivent le rester.

**Tests :** ✅ `tests/Feature/Signaling/ValidationTest.php` — 24 cas. Nominal des 5 routes ⇒
200 **et** broadcast émis (le cas qui compte le plus) · refus d'appel `{ type }` seul ⇒ 200 ·
`connectionType` absent ⇒ 200 avec `null` relayé · type hors liste ⇒ 422 sur les 5 routes ·
`peerId` et `options.peerId` non-UUID ⇒ 422 · `action` inconnue ⇒ 422 · `toUserSlug` malformé
⇒ **422 et non 404**, donc avant le `firstOrFail()` · `room` de 101 caractères ⇒ 422 · clés
inconnues d'`options` non relayées · un 422 reste un 422 · miroir JS ↔ PHP. **Chaque cas
invalide asserte `assertNoBroadcastSent()`** : un refus qui laisserait partir le broadcast
n'en serait pas un.

Cinq contre-épreuves passées : `Rule::in` retiré des types ⇒ les 5 cas de type rougissent ;
`peerId` ramené à `string` ⇒ le cas UUID rougit, seul ; `Arr::only` court-circuité ⇒ le cas
de la liste blanche rougit, seul ; `validate()` déplacé DANS le `try` ⇒ 4 cas d'`ask` passent
en 500, dont celui qui vise ce point ; un type ajouté à la constante PHP ⇒ le miroir rougit,
seul. ⚠️ Les deux premières et la quatrième débordent sur
`une_erreur_de_validation_ne_tombe_pas_dans_le_handler_d_echec`, qui a besoin d'*une*
violation pour observer la **forme** de la réponse : le recouvrement est inhérent, pas un
défaut d'isolation.

**Done :** ✅ **39 tests PHP / 118 assertions** verts (16/08/2026) ; suite JS **inchangée**
(645 tests / 36 fichiers, 3,45 s).
**Commit :** `secu(socializer): valider les payloads de signalisation`

---

### C2 — Contrôle de relation émetteur ↔ destinataire `[M]` 🟠

- [x] **Dépend de :** C4 (✅ 16/08). Jumeau serveur de A2 — c'est la version **autoritative**
  du garde. — ✅ **fait le 16/08/2026**, avec **trois écarts assumés** par rapport à la lettre
  du plan ci-dessous : voir « Ce que la lecture du code a invalidé ».

N'importe quel authentifié peut aujourd'hui signaler n'importe quel autre utilisateur par
son slug. `fromUserSlug` est bien authentifié (correctif de mai), mais aucun lien n'est
exigé entre les deux parties.

> ## ✅ Arbitrage produit tranché le 15/08/2026 — « follow mutuel OU contexte partagé »
>
> **`mayReach($from, $to)` = les deux se suivent mutuellement **OU** ils partagent une
> room / un serveur.** Un seul prédicat pour les **5** routes, appliqué à
> `Auth::user()` → `toUserSlug`. Il est **symétrique**, ce qui règle la route de réponse
> sans traitement particulier (cf. ci-dessous).
>
> **Ce que la règle ferme :** l'appel « à froid » d'un inconnu total, qui est la règle de
> fait aujourd'hui — le bouton d'appel vit sur la cover de **n'importe quel** profil, dès
> que la personne est en ligne (`components/User/Cover.vue`, à côté de `FollowButton`).
>
> **Ce qu'elle préserve :** les deux seuls usages légitimes que le produit expose — appeler
> un contact (follow réciproque) et appeler un membre d'une room ou d'un serveur commun.
>
> **Pourquoi pas le chat 1-à-1 comme troisième voie** : `conversations()` serait un
> prédicat **auto-servi** — `/get-or-create-chat-room` crée une conversation avec
> n'importe qui, donc un attaquant s'octroie la relation en une requête. Écarté.
>
> **Pourquoi une relation symétrique, et pas le follow simple.** L'invitation d'appel est
> un broadcast *fire-and-forget* : **aucune invitation n'est persistée côté serveur**, donc
> `responseToPeerAuthorization` n'a rien contre quoi se valider. Avec une relation
> asymétrique il aurait fallu l'inverser (« mon interlocuteur aurait-il eu le droit de
> m'appeler ? ») — une seconde règle à tenir juste. La symétrie l'évite.

> ## ⚠️ Ce que la lecture du code a invalidé — la jambe « contexte partagé » devient « même groupe MariaDB »
>
> Le plan prévoyait `canJoinRoom` / `canJoinServer` sur la `room` du payload, plus une requête
> Nebula à vertex partagé. **Les deux sont infaisables**, pour trois raisons vérifiées :
>
> **1. `canJoinRoom` / `canJoinServer` ne sont pas des prédicats d'appartenance.** Dans
> [`Socializable.php`](../src/app/Helpers/ModelTraits/Socializable.php), `u` n'est pas
> l'appelant mais *n'importe quel* utilisateur enregistré ; le `vertexid` de l'appelant ne
> pèse que sur la branche `privacy == 1`. Sur une room publique la requête renvoie une ligne
> dès qu'un membre quelconque existe ⇒ **`true` pour tout le monde**. Le garde aurait été
> contournable en nommant une room publique. (Effet miroir : une room publique **vide**
> renvoie `false`, même à son propriétaire.) Ils restent inchangés — ce sont les gardes de
> canal Reverb.
>
> **2. Le graphe ne connaît pas l'appartenance aux rooms.**
> `user -[:registered_in]-> room` n'est écrite qu'en un seul endroit,
> [`Server.php:532`](../src/app/Services/Server.php) dans `createRoomServer()` — donc pour le
> **créateur** seulement. Aucune route « rejoindre une room ». La jambe aurait été morte.
>
> **3. La copie graphe de l'appartenance aux groupes dérive.** **MariaDB est la source de
> vérité, le graphe un réplica.**
>
> ⛔ **Le motif donné ici le 16/08 était faux — corrigé le 18/08.** Il disait
> « `GroupUserCreatedListener` (estarter) est entièrement commenté, donc rien ne se propage ».
> **Deux classes homonymes** sont abonnées à `GroupUserCreated`, une par paquet : celle du socle
> est effectivement un `Log::info` mort, celle de **ce** paquet
> ([`GroupUserCreatedListener.php`](../src/app/Listeners/GroupUserCreatedListener.php)) écrit
> l'arête, et son pendant `Deleted` la retire. Le pivot dispatche bien, `->using()` est déclaré
> des deux côtés de la relation : la chaîne est complète. Le choix de lire MariaDB reste bon,
> mais pour les motifs que le code donne déjà — SQL indexé contre aller-retour Thrift, et le
> harnais de tests qui stube `EstarterUser`. Détail et dérive réelle (cascade FK) : **E4**,
> réécrite.
>
> Ce n'est pas un affaiblissement : `canJoinServer` définit *déjà* l'accès serveur **par le
> groupe**. On lit la même notion, à la bonne source — une requête SQL indexée
> (`unique(['user_id','group_id'])`) au lieu d'un aller-retour Thrift.
>
> **Arbitrages tranchés avec le porteur produit (16/08)** : granularité = **même `group_id`
> exactement**, pas de remontée dans le nested set · **pas** de co-présence Redis, deux jambes
> suffisent · slug inconnu ⇒ **403 uniforme**, ce qui fait d'avance le travail de E3 sur ces
> cinq routes · appel à soi-même autorisé (multi-onglet) · graphe muet ⇒ refus, jamais 500.

- Prédicat en **une seule méthode** sur `Socializable` (`mayReach`), pas cinq contrôles
  recopiés — convention « un seul système ». Deux jambes, évaluées dans cet ordre : le groupe
  (SQL indexé, connexion déjà ouverte), puis le follow réciproque (Nebula, dernier recours).
- Une **seule** requête nGQL pour le follow mutuel, n'employant que des constructions attestées
  en production (`MATCH` multi-motifs par virgule, `RETURN count(*) > 0 AS x`). Évite
  délibérément `wall()`, qui fait `return $wall[0]` et plante sur un utilisateur sans mur.
- Verdict mémorisé par **paire non ordonnée** — `mayReach` est symétrique. Invalidé
  explicitement par `Users::followUser`/`unfollowUser` : une autorisation périmée n'est qu'une
  fenêtre bornée, un refus périmé est un bouton qui échoue juste après qu'on s'est abonné.
- 403 + `Log::warning` traçant `auth_user_id`, `target_slug`, `ip`, `user_agent` — même
  format que le log d'usurpation déjà en place dans `closeConnectionToPeerId`. Le journal garde
  `target_exists`, que la réponse HTTP tait.

**Tests :** ✅ `tests/Feature/Signaling/RelationGuardTest.php` — 34 cas. Sur les 5 routes :
inconnus ⇒ 403 · follow à sens unique ⇒ 403 · groupes différents ⇒ 403 · groupe commun ⇒ 200
et broadcast émis · follow réciproque ⇒ 200 et broadcast émis. Puis : slug inexistant ⇒ **403
et non 404**, sans toucher au graphe · soi-même ⇒ 200 sans toucher au graphe · groupe commun
⇒ graphe non interrogé · mémorisation dans les deux sens ⇒ une seule requête nGQL · graphe
muet (JsonResponse d'erreur **et** zéro ligne) ⇒ 403 · refus journalisé · le garde précède le
journal d'usurpation. **Chaque refus asserte `assertNoBroadcastSent()`.**

Quatre contre-épreuves passées : garde retiré de `sendAlertToUser` seul ⇒ 3 cas rougissent,
tous sur cette route (le fournisseur couvre bien les 5) · `mayReach` renvoyant `true` ⇒ 21 cas
· `sharesGroupWith` sans le filtre sur le destinataire ⇒ 5 cas, exactement « groupes
différents » · court-circuit d'identité retiré ⇒ 1 cas, celui du multi-onglet.

⚠️ **Ce que ces tests ne prouvent pas.** `FakeNebulaGraph` fait du `str_contains`, il ne parse
pas le nGQL : les cas « follow » testent « le graphe a répondu vrai/faux », jamais la
réciprocité. **Une requête syntaxiquement invalide passerait au vert.** Reste à contre-vérifier
sur l'environnement Docker (hors de portée du shell de dev, base sur l'hôte `mariadb`) :
1. la requête de `followsMutually` contre un vrai Nebula, sur trois paires connues, **plus** la
   contre-épreuve par retrait d'un des deux motifs `followed_by` ;
2. `SELECT g.id, g.name, COUNT(*) n FROM group_user gu JOIN groups g ON g.id = gu.group_id
   GROUP BY g.id ORDER BY n DESC LIMIT 5` — écarter le groupe racine universel, qui rendrait la
   jambe groupe **vacante**.

### La borne connue de C2 : la room publique

Mesuré le 16/08 sur `estarter_test` : **un seul groupe** (`Innovation`, 2 membres), **10
comptes sur 12 sans aucun groupe**. Le risque redouté — un groupe racine coiffant tout le monde,
qui aurait rendu le prédicat vacant — est donc **écarté**.

Un compte sans groupe ni follow ne joint personne : c'est la règle, pas un défaut. Une seule
exception mérite d'être suivie.

> **`Server::getRoom()` ouvre une room `privacy == 0` à n'importe quel authentifié**, sans
> exiger ni groupe ni follow ([`Server.php:629`](../src/app/Services/Server.php)). Deux comptes
> sans relation peuvent donc se retrouver **légitimement** dans la même room, et leur mesh est
> désormais refusé. Les rooms `privacy == 1` et `2` ne posent pas la question : leur accès
> exige déjà d'être enregistré dans la room ou d'en être le créateur.

À vérifier avant mise en production — `MATCH (r:room) RETURN r.room.privacy AS privacy,
count(*) AS n`. Aucune room à `privacy == 0` ⇒ rien à faire. Sinon, le correctif ciblé est une
**troisième jambe de co-présence** dans `mayReach` : `presence:room:*` / `presence:server:*`
sont écrits côté serveur par `getRoom()`/`getServer()` (donc non forgeables depuis le payload),
lus en O(1) par le singleton `redisService` — la même couture testable que `nebulaGraph`.
Écartée sciemment à la livraison : deux jambes, deux sources, et la rafale de join ne la
justifiait pas à elle seule.

⚠️ Si elle est ajoutée, **ne pas la mettre en cache** : la co-présence est volatile, un verdict
mémorisé 60 s survivrait au départ de la room. Le cache doit rester sur ce qui est cher et lent
à bouger — groupe et follow.

⚠️ Ne PAS intersecter `presence:chat:*` : l'arbitrage du 15/08 a écarté le chat parce que
`/get-or-create-chat-room` permet à un attaquant de s'octroyer la relation en une requête. Une
intersection non typée la ferait rentrer par la porte de derrière.

**Done :** ✅ **73 tests PHP / 190 assertions** verts (16/08/2026, contre 39 avant) ; suite JS
**inchangée** (645 tests / 36 fichiers).
**Commit :** `secu(socializer): exiger une relation entre émetteur et destinataire`

---

### C5 — Aligner le bouton d'appel sur la règle C2 `[S]` 🟠

- [x] **Dépend de :** C2 (✅ 16/08). — ✅ fait le 16/08/2026.

Le bouton **mentait** : [`components/User/Cover.vue`](../src/resources/js/socializer/components/User/Cover.vue)
affichait `CallRemotePeerBtn` dès que `user.connected`, sans rien savoir de la relation.
Tout appel hors relation part en 403 — et **aucun composable WebRTC2 n'inspecte le statut
HTTP**, tous ces appels sont dans un `catch` nu. L'utilisateur voyait donc un bouton qui ne
faisait strictement rien, sans le moindre retour.

- ✅ `Users::getGraphUser` calcule `mayReach` et le pose dans la charge utile du mur
  (`may_reach`), à côté de `nb_followers` / `follow_status` ; `Http/Resources/User` le
  sérialise ; `Cover.vue` conditionne le bouton sur `user.connected && user.may_reach`.
- Le serveur reste l'autorité : ce masquage est de l'UX, **pas** un contrôle.

> **Fail-closed sur l'ABSENCE de clé, et c'est délibéré.** Une charge utile sans `may_reach`
> masque le bouton. La ressource n'émet la clé que si elle est posée (`when(isset(...))`), et
> seul `getGraphUser` la pose : tout autre producteur de profil (`getUsersList`, les ressources
> `Post` / `Server`) ne porte pas le verdict. Traiter l'absence comme une autorisation aurait
> rendu le correctif vide dès qu'un second chemin alimenterait `Cover`.
>
> **Le calcul est fait au chargement du profil, pas au clic.** S'abonner depuis le mur peut
> créer la réciprocité qui rend l'appel légitime : le serveur oublie bien son verdict mémorisé
> (`Users::forgetRelationVerdict`, posé en C2), mais le bouton n'apparaîtra qu'au rechargement.
> Écarté sciemment — rafraîchir le verdict après un follow demanderait soit un second appel,
> soit de le renvoyer dans la réponse de `/follow-user`.
>
> **`$user` est écrasé au milieu de `getGraphUser`** par la réponse du graphe : le verdict est
> calculé AVANT, sinon `mayReach` recevrait un tableau.

**Tests :** ✅ `tests/Feature/Profile/RelationVerdictTest.php` — les deux jambes du prédicat
vues du profil, le refus, le court-circuit d'identité, et le fait que le verdict ne paie pas
d'aller-retour au graphe quand le groupe a déjà tranché. ✅
`components/User/__tests__/coverCallButton.test.js` — le bouton n'apparaît que
`connected && may_reach`, le verdict absent masque, et le masquage vise le bouton d'appel et
non la zone d'outils (`FollowButton` reste là). Contre-épreuve faite dans les deux sens :
ligne de production neutralisée ⇒ 4 tests PHP et 2 tests JS rouges.

⚠️ **Le dernier maillon n'est pas testé** : `Http/Resources/User` étend la ressource d'estarter
et appelle `revealIdentifier()`, et `WallController` référence `App\Models\User` **en dur** (et
non `config('estarter.models.user')`) — deux raisons pour lesquelles ni la ressource ni la
route `/wall/{slug}` n'entrent dans le harnais Testbench. La chaîne service → ressource → HTTP
se contre-vérifie dans l'application.

**Commit :** `feat(socializer): n'afficher le bouton d'appel que si la relation le permet`

---

# LOT D — Identifiants TURN éphémères 🟠

### D0 — Sortir les identifiants TURN du bundle `[M]` ✅ 23/08/2026

- [x] **Dépend de :** rien. **Extraite de D1/D2 le 23/08/2026** — la moitié qui ne demandait
      aucune décision d'infra, donc aucune raison d'attendre l'arbitrage TURN REST.

**Ce que D1/D2 mélangeaient, et qu'il fallait séparer.** Le plan d'origine liait « sortir le secret
du bundle » à « le rendre éphémère ». Or seule la seconde exige une bascule coturn et une rotation
de secret ; la première est un déplacement de la lecture du `.env`, de Vite vers PHP. Faite seule,
elle règle la fuite et **rend vraie** la promesse d'installation du paquet — voir plus bas.

- [x] `config/socializer.php` → `signaling.ice` : `stun_urls`, `turn.{host,port,username,password}`.
      **Aucune variable nouvelle obligatoire** : `username`/`password` lisent `COTURN_USER` /
      `COTURN_PASS`, celles-là mêmes que le `docker-compose` passe au conteneur. Deux couples pour
      un seul compte, c'est la panne muette le jour où l'on n'en tourne qu'un.
- [x] `WebRTCController::getIceServers` + `GET /get-ice-servers`, groupe **public**, **toujours
      200** : STUN seul pour un invité, STUN + TURN pour un authentifié. Liste blanche de trois
      clés, jamais un splat de la config. `Cache-Control: no-store`.
- [x] `Composables/utils/fetchIceServers.js` : ne jette jamais, rend toujours un tableau non vide,
      timeout par `Promise.race`. `_doInit` l'`await`e avant `new Peer`.
- [x] Le **second site** : `stores/peers/actions.js` (v1 morte) lisait les mêmes variables.
- [x] `.env`, `.env.app`, `.env.docker` nettoyés ; bundle reconstruit.
- [x] Tests : `IceServersTest` (9 cas), `fetchIceServers.test.js` (12), `describe('configuration
      ICE')` (4), `noInlinedTurnSecret.test.js` (4). Contre-épreuves faites sur les quatre.

#### Trois choses apprises, dont deux qui n'étaient pas au plan

**1. `import.meta.env.VITE_*` n'est pas de la configuration, c'est du code source.** Vite remplace
l'expression par sa valeur **au build**. Conséquences en chaîne : le secret était en clair dans
`public/build/assets/js/*.js` ; il y était **deux fois**, le second site appartenant à la v1 morte
(Vite ne se soucie pas de l'atteignabilité) ; et « il n'y a qu'à adapter le `.env` » était **faux**,
puisqu'il fallait aussi un `npm run build` que rien ne documente. La correction rend cette phrase
vraie. Preuve empirique, la seule qui compte : `credential:"…"` passait de **2 occurrences à 0** dans
le bundle reconstruit — un `grep` sur les sources ne l'aurait pas montré.

**2. La route DOIT être publique et rendre 200.** La coquille SPA `/app/{any}` est publique
(`vue_router_auth_protect` n'est définie nulle part), `Notifications.vue` monte le contexte
`data-app` avant tout login, et `AjaxService.load` fait `document.location.reload()` sur un 401 :
un garde par middleware aurait produit une **boucle de rechargement sur la page de login**. La garde
est donc `Auth::check()`, dans le contrôleur. Même famille que C5 et E5 — un garde n'est fini que
lorsqu'on a suivi son refus jusqu'au pixel.

**3. ⚠️ L'`await` ouvre une fenêtre inédite, et la note de D2 ne suffisait pas.** Elle disait
« l'appel réseau doit rester à l'intérieur de `peerInitPromise` » : nécessaire, **pas suffisant**.
Pendant le vol, le store est dans un état qui n'existait pas — `localPeer === null` ALORS QUE
`peerInitPromise` est posée. Si le timer de destruction différée se déclenche là,
`_destroyPeerSingleton` prend sa branche « peer déjà absent », consomme le timer, et le `new Peer`
qui suit naît **orphelin** : store à 0 consommateur, hors d'atteinte de toute destruction. C'est le
« peerId fantôme » du 14/08 par un chemin neuf. D'où une **garde d'annulation** après l'`await`
(`peerStore.peerInitPromise !== initPromise`), qui discrimine les trois évolutions possibles là où
un `peerConsumerCount === 0` se serait trompé sur la première. La leçon générale : **insérer un
`await` dans une séquence jusque-là synchrone crée un état intermédiaire observable, et tout ce qui
lit cet état pendant la fenêtre doit être réexaminé** — pas seulement ce qui l'écrit.

Côté tests, trois assertions mesuraient l'invariant « un seul Peer par onglet » **indirectement**,
en comparant `lastPeer()` avant et après. Sous le nouveau code elles seraient devenues vertes pour
rien (`null === null`). Remplacées par un compteur de constructions dans le mock — strictement plus
fort : deux constructions écrasent `_lastInstance` **et** `peerStore.localPeer`, donc aucune
comparaison d'identité ne peut les distinguer.

**Commit :** `secu(socializer): servir la configuration ICE depuis le serveur`

---

### D1 — Endpoint de credentials TURN signés `[M]` ✅ 23/08/2026

- [x] **Dépend de :** rien. **Périmètre réduit par D0 (23/08)** : la route, la config et la
      consommation côté client existaient déjà. Ne restait que le mécanisme de signature.

- [x] `config/socializer.php` → `signaling.ice.turn` : `static_auth_secret`
      (`COTURN_STATIC_AUTH_SECRET`) et `credential_ttl` (`COTURN_CREDENTIAL_TTL`, 86400).
      **Une seule variable, lue des deux côtés** — le `docker-compose` de l'hôte l'interpole dans
      `--static-auth-secret`. C'est la règle qui imposait déjà `COTURN_USER`/`COTURN_PASS`, et elle
      compte plus encore ici : la panne d'un secret désaccordé est silencieuse **des deux côtés**.
- [x] `WebRTCController::turnServer()` : deux modes, commutés par la **présence** du secret et non
      par une clé de mode. Le couple statique reste servi à défaut — chemin de compatibilité, pas
      décoration : un tiers dont le coturn tourne encore en `--user` ne doit pas perdre son relais
      sur un `composer update`.
- [x] Tests : 14 cas (5 neufs, 2 réécrits, 1 renommé), **8 contre-épreuves par mutation**.
- [x] Hôte : `docker-compose.yml` basculé, `.env`/`.env.app`/`.env.docker`/`.env.example`.
- [x] Rotation du secret compromis : **la bascule en `--use-auth-secret` EST la rotation** — le
      couple `COTURN_USER:COTURN_PASS` cesse d'authentifier quoi que ce soit.

**Décision datée du 23/08 — aucune réécriture de l'historique git.** Le secret était réputé
compromis (servi dans le bundle public, versionné dans `.env.app`/`.env.docker`). Vérification faite
plutôt que supposée : `git log -p --all -S 'COTURN_PASS'` montre que **la seule valeur que
l'historique ait jamais contenue est la chaîne littérale `secret`** — zéro entropie, et rendue
inerte par construction dès la bascule. Un `filter-repo` + force-push coordonné pour retirer un mot
du dictionnaire n'est pas un arbitrage raisonnable. Ce qui compte n'est pas d'effacer l'ancien
secret mais **que le nouveau n'entre jamais dans git** : il ne vit que dans `.env` (gitignoré), et
les gabarits versionnés portent une valeur **vide**.

#### Trois choses apprises, dont deux qui n'étaient pas au plan

**1. ⚠️ La ligne « Basculer coturn (`socializer.conf`) » de ce plan était FAUSSE, et c'est la
deuxième fois que ce fichier ment sur ce point.** `socializer.conf` est un **vhost Nginx** livré par
le paquet, sans un seul bloc TURN — ce que `docs/architecture/package.md` rectifiait déjà le 23/08.
Il n'existe **aucun fichier de configuration coturn** sur la machine (`find / -name turnserver.conf`
→ rien, aucun volume monté sur le service) : coturn est configuré **entièrement en drapeaux CLI**
dans le `docker-compose` de l'hôte. Corollaire de méthode : une tâche qui nomme un fichier d'infra
se vérifie sur le fichier, pas sur le souvenir qu'on en a.

**2. Le TTL de « ~1 h » qu'écrivait ce plan était trop court, et la raison est côté client.** Le
navigateur ne demande la configuration ICE **qu'une fois par cycle de vie du `Peer`** — lequel est
un singleton d'onglet monté au tick 0 par le contexte permanent `data-app`, dont
`PEER_DESTROY_DELAY_MS` n'est jamais atteint tant que la SPA vit, et dont `peer.reconnect()`
réutilise le même `_options.config`. Un TTL d'une heure expirerait donc dans le dos d'un onglet
ouvert : l'appel en cours tient, mais toute **nouvelle** allocation échoue — « la visio ne passe
plus, un F5 la répare ». D'où 24 h, et la borne écrite dans `securite.md`. Le gain de D1 n'était
jamais la brièveté : c'est que le credential devienne **par-utilisateur** — attribuable dans les
journaux coturn, plafonnable par `--user-quota`, révocable en bloc par rotation du secret. Le
rafraîchissement est **cadré en D3**, pas laissé à re-chercher.

**3. ⚠️ Une contre-épreuve a démoli une affirmation que je venais d'écrire dans le code.** Le
docblock disait « l'ordre des instructions est un garde : `Auth::check()` avant la lecture du
secret, et `IceServersTest` l'épingle ». La mutation correspondante — déplacer le garde après le
calcul du HMAC — laisse **la suite entière verte**, parce que le garde rend `null` de toute façon et
qu'aucune fuite n'atteint le corps de la réponse. Une fuite par **journal** n'est pas observable
dans une réponse HTTP : aucun test ne peut épingler cet ordre. Le docblock a été corrigé pour dire
ce qui est vrai (l'ordre est une convention de relecture) et nommer ce qui est réellement épinglé
(le secret n'atteint pas la réponse, contre-épreuve : un splat de `config('...turn')`). La leçon
générale : **écrire « tel test l'épingle » est une affirmation vérifiable — et elle se vérifie en
cassant le code, pas en relisant le test.**

**Une quatrième, mineure mais coûteuse en revue** : `src/config/socializer.php` n'était pas
pint-clean, et `pint` y reformate 283 lignes sans rapport avec D1 (imports hissés, virgules
traînantes, `(int)env` → `(int) env`). Le reformat a été isolé dans son **propre commit**, avant
celui de D1 : `pint(HEAD)` et `pint(HEAD + les edits)` ne diffèrent que des deux hunks voulus, ce
qui rend le découpage mécaniquement sûr.

**Tests :** `IceServersTest` (14 cas) · les quatre contre-épreuves qui exigent un vrai coturn sont
dans la bannière du fichier de test — le format est vert avec un mauvais ordre de champs, seul le
relais tranche.
**Commit :** `secu(socializer): endpoint de credentials TURN éphémères`

---

### D2 — Consommer les credentials éphémères côté client `[S]` ✅ 23/08/2026

- [x] **Dépend de :** D1.

**✅ Intégralement livrée par D0 le 23/08/2026**, et **confirmée par D1 le même jour** : le passage
au credential signé n'a demandé aucune ligne de JavaScript. `_doInit` récupère la configuration ICE
avant `new Peer(...)`, avec repli STUN et timeout ; les variables `VITE_COTURN_*` ont disparu des
trois `.env` et du bundle (vérifié : 2 occurrences → 0 après reconstruction). `isUsableEntry`
n'exige que `urls`, et le tableau est passé opaque à PeerJS — c'est ce qui a rendu D1 confinée au
PHP.

> ⚠️ **La note d'origine de cette tâche était insuffisante, et c'est le principal enseignement du
> lot.** Elle disait : « l'appel réseau doit rester à l'intérieur de `peerInitPromise`, sinon deux
> contextes créeront deux `Peer` ». Vrai, mais il manquait la **garde d'annulation** : voir le point
> 3 de D0. Ne pas retirer ce paragraphe en croyant qu'il fait doublon.

---

### D3 — Rafraîchir le credential avant qu'il n'expire `[M]` 🟡 — ouverte le 23/08/2026

- [ ] **Dépend de :** D1 (livrée). **N'est pas un prérequis de quoi que ce soit** : la borne qu'elle
      ferme est assumée et documentée dans `docs/modules/webrtc2/securite.md`.

**Le problème, tel que D1 l'a mesuré.** Le navigateur ne demande la configuration ICE **qu'une fois
par cycle de vie du `Peer`**, et le `Peer` est un singleton d'onglet que rien ne détruit tant que la
coquille SPA vit (contexte permanent `data-app` monté au tick 0 ; `PEER_DESTROY_DELAY_MS` ne se
déclenche qu'au départ du **dernier** consommateur ; `peer.reconnect()` réutilise la même instance,
donc le même `_options.config`). Passé le TTL, l'appel en cours tient — coturn a déjà sa clé de
session — mais **toute nouvelle allocation échoue** : nouvel appel, ICE restart, nouveau flux.
Symptôme utilisateur : « la visio ne passe plus, un F5 la répare ». Le TTL de 24 h rend le cas rare,
il ne le supprime pas.

**Le mécanisme est déjà repéré, et il est petit.** `node_modules/peerjs/dist/bundler.mjs` fait
`new RTCPeerConnection(this.connection.provider.options.config)` — relu à **chaque** connexion — et
`options` est un getter vivant sur `_options`. Réécrire `peerStore.localPeer.options.config`
suffirait donc pour toutes les connexions futures, sans `setConfiguration()` ni chirurgie sur les
connexions ouvertes.

**Ce qui reste à trancher, et qui est tout le coût de la tâche :**

- **le déclencheur** — timer aligné sur le TTL, ou paresseux avant chaque `connectToPeer` ? Le
  paresseux ne dépend d'aucune horloge et ne travaille que si l'on appelle, mais il ajoute un
  `await` sur un chemin d'appel : relire l'enseignement 3 de D0 avant de l'écrire (**insérer un
  `await` dans une séquence synchrone crée un état intermédiaire observable**, et ici l'état en
  question est celui d'un `Peer` déjà vivant).
- **`options.config` est un interne PeerJS non contractuel** : à épingler par un test qui casse si
  une mise à jour de PeerJS le renomme, faute de quoi le rafraîchissement deviendra muet.
- **La condition de réouverture du `throttle`** énoncée dans `routes.public.php` : si D3 permet de
  descendre le TTL à l'échelle de l'heure, la route se met à être re-appelée et la question du
  plafond se rouvre — bucket dédié rendant `Limit::none()` pour l'invité, jamais une clé IP.

**Tests :** le credential est re-demandé après expiration simulée · une connexion ouverte n'est pas
perturbée · `options.config` existe toujours (garde anti-renommage).
**Commit :** `secu(socializer): rafraichir le credential TURN avant expiration`

---

# LOT E — Bornes résiduelles 🟡

### E1 — Borner l'amplification du hub star `[S]` ✅ 23/08/2026

- [x] **Dépend de :** rien.

Les gardes du hub sont par émetteur (`HUB_MAX_MESSAGES_PER_WINDOW` = 20/s) et par message
(`MAX_PAYLOAD_BYTES` = 64 Ko), mais **leur produit par le fan-out ne l'est pas** :
`20 × 64 Ko × N destinataires`. Or star est justement la topologie des grandes rooms — à
100 membres, un client d'apparence honnête fait sortir ~128 Mo/s du hub.

- [x] Budget agrégé d'octets retransmis par fenêtre dans `forwardStarMessage`, constante
  `HUB_MAX_BYTES_PER_WINDOW` = 1 Mio dans [`webrtc2.config.js`](../src/resources/js/socializer/components/WebRTC2/webrtc2.config.js), documentée
  comme les autres. Posé **après le calcul de `targets`** — le seul endroit où le fan-out est connu —
  et le coût plafonné est `payloadSize.bytes × targets.length`.
- [x] `utils/createRateLimiter.js` **étendu** plutôt que doublé : `isLimited(key, weight = 1)`, le
  plafond portant sur la somme des poids. Compter des appels devient le cas particulier « tous les
  poids valent 1 », donc les deux consommateurs existants et leurs 9 tests sont inchangés.

**La sémantique valait la moitié de la tâche.** Le contrôle porte sur le total **déjà dépensé**,
jamais sur `total + poids du message courant`. Un fan-out isolé dont le coût dépasse à lui seul le
budget passe donc, et consomme sa fenêtre. L'autre écriture — refuser d'emblée — aurait rejeté le
**premier** message d'une grande room (64 Ko × 100 membres = 6,4 Mio) au lieu du centième : elle
transformait un garde anti-abus en plafond de taille de room. C'est l'amplification *soutenue* qui
est le risque, et c'est elle seule qui est coupée. Épinglé par
`laisse passer un premier fan-out dont le coût dépasse à lui seul le budget`.

Deux points relevés en passant :

- Le budget est **par émetteur**, pas global au hub. Un budget partagé fermerait la somme des N mais
  créerait une famine : le premier à dépenser prive les autres, soit un déni de service sur les pairs
  honnêtes. La somme de N émetteurs reste donc une borne connue — réécrite comme telle dans
  « Bornes non fermées » de [securite.md](../docs/modules/webrtc2/securite.md).
- Le docblock de `MAX_PAYLOAD_BYTES` ne décrivait qu'un seul de ses **trois** points d'application
  (« un payload retransmis par le hub »), alors que `securite.md` en documente trois depuis C3.
  Corrigé dans la config.

**Tests :** 13 ajoutés (8 sur le limiteur pondéré, 5 sur le budget du hub). Contrôle de harnais fait
dans les deux sens — poids forcé à 1 dans le limiteur, garde court-circuité dans `forwardStarMessage`
— les 8 tests visés rougissent, les autres non. ⚠️ Les limiteurs sont **module-level** : reprendre le
`SENDER_PEER_ID` unique par test (`_peerSeq++`) déjà en place dans le fichier, sans quoi l'état d'un
test fuit dans le suivant.
**Commit :** `secu(webrtc2): borner le débit agrégé retransmis par le hub star`

---

### E2 — Borner et sanitiser `conn.metadata` `[S]` ✅ 23/08/2026

- [x] **Dépend de :** rien.

Seules les frames data sont contrôlées en taille (`isPayloadWithinLimit` dans `handleData`).
`conn.metadata` est distant, non borné, et seul `type` est sanitisé
(`sanitizeMetadataType`). `fromName` est affiché dans l'UI
(`Widgets/Mediaplayer/MediaBroadcastPlayer.vue`).

> ✅ **Pas de XSS** — aucun `v-html` ni `innerHTML` dans tout le composant (vérifié), Vue
> échappe l'interpolation. Le risque est la dégradation de mise en page et la pollution des
> logs, pas l'exécution.

- [x] `utils/sanitizeMetadata.js` étendu : `sanitizeMetadataName`, qui **tronque** au lieu de
  rejeter — un type hors liste blanche n'a aucun repli utilisable, un nom trop long en a un,
  lui-même coupé.
- [x] Contrôle de la taille globale à l'admission, `MAX_METADATA_BYTES` = 4 Ko. Il réutilise
  `payloadSize.js` par un paramètre `maxBytes` optionnel : quatrième point d'application de la
  mécanique, pas une seconde mécanique (`securite.md` en documentait trois).

**Ce que la position du garde valait.** Les deux `console.warn` de non-résolution de contexte
(`usePeerTransport:609/646`) journalisent l'objet metadata **ENTIER**, et c'est le pair distant qui
décide de les déclencher : il contrôle `callbackKey`, donc le fait qu'aucun contexte ne se résolve.
Un garde de taille placé après eux aurait été vide de son objet — il est donc la **première
instruction** des deux dispatchers. Épinglé par
`ne journalise pas l'objet quand il est surdimensionné, même sur un contexte introuvable`.

**Ce qui n'était pas au plan, et qui était le vrai trou.** `useStreamManager:175` recopiait la
metadata distante par un spread `...meta` : **toute** clé du pair distant traversait jusqu'à
`streamData.metadata`, et ce que le player en fait n'est pas inerte — `countViewers` y est **rendu
en texte** (`MediaBroadcastPlayer:52`) et `roomId` devient le `wrapperId` de la directive `v-resize`
(`:170`). Vérifié : **aucun producteur local ne pose ces deux clés sur ce chemin**, elles ne
pouvaient venir que du réseau. Borner `fromName` sans fermer le spread aurait laissé deux champs
libres juste à côté de lui. Sept champs explicites les remplacent, `roomId` **dérivé** de `room`,
les deux drapeaux coercés en booléens, et `type` passé par `sanitizeMetadataType` — c'était l'un des
deux derniers sites qui le lisaient brut, alors qu'il compose la clé `remoteStreamsMap` et le
`videoId`.

Effet visible et voulu : **plus de compteur d'audience sur les vignettes visio/vocal/écran.** C'est
ce que le composant documente déjà (`MediaBroadcastPlayer:44-49` : le compteur n'a de sens qu'en
diffusion), et la diffusion le calcule localement.

**Un second chemin de rendu, trouvé en fermant le premier.** `remoteStreamsMap` conserve la metadata
**brute**, et le mode diffusion ne passe pas par `createVideoElement` : il rend le registre
directement via `StreamSimpleUI`, qui lisait donc `fromName` sans borne malgré sa propre liste
blanche de sept champs. Borné là aussi. **Deux chemins de rendu, deux points à tenir** — c'est
consigné dans `securite.md`.

**Tests :** 19 ajoutés (6 sur `sanitizeMetadataName`, 4 sur le plafond paramétrable de
`payloadSize`, 3 sur l'admission, 6 sur la liste blanche). Contrôle de harnais fait sur les quatre
lignes de production (troncature, plafond paramétrable, les deux gardes d'admission, le spread) :
seuls les tests visés rougissent. Suite complète **694 tests / 38 fichiers**, verte.
**Commit :** `secu(webrtc2): borner les métadonnées de connexion entrantes`

---

### E3 — Ne plus énumérer les utilisateurs `[S]`

- [ ] **Dépend de :** C2 (✅ 16/08). **Périmètre réduit** — voir ci-dessous.

> ✅ **Fait sur les 5 routes de signalisation** (16/08, avec C2) : `firstOrFail()` y est
> remplacé par `first()`, et un slug inexistant reçoit le **même 403, même corps**
> (`{"ok": false}`) qu'un slug existant hors relation. Couvert par
> `RelationGuardTest::un_slug_inexistant_repond_403_et_non_404`.

**Reste à faire** : `getUsersList` ([`UserController.php`](../src/app/Http/Controllers/Front/UserController.php)),
qui liste **tous** les utilisateurs actifs — son contrôle de permission `list_users` est
commenté. C'est une énumération bien plus directe que le sondage de slugs, et elle ne partage
ni le garde ni le fichier avec ce qui vient d'être fait : elle sert la liste de contacts du
produit, donc son arbitrage est produit, pas technique.

**Tests :** ✅ pour les 5 routes. Reste : la liste ne renvoie que les utilisateurs joignables,
ou exige `list_users`.
**Commit :** `secu(socializer): réponse uniforme sur slug inexistant ou non autorisé`

---

### E4 — Les gardes de canal Reverb accordent ce qu'ils devraient refuser `[M]` — scindée le 21/08/2026

**Trouvée le 16/08/2026** en cadrant C2 — hors périmètre de l'audit du 14/08 (ce n'est pas WebRTC2),
mais découverte par lui et trop concrète pour être perdue.
**Requalifiée le 18/08/2026 : sa prémisse était fausse, ses conclusions étaient inversées.**
**Scindée le 21/08/2026** : le code est livré (E4.1), l'arbitrage du réplica ne l'est pas (E4.2), et
le corollaire des écritures muettes est sorti en tâche propre (E7). Cocher l'ensemble aurait menti ;
le laisser vide aurait fait relire 70 lignes à chaque passage.

> ⛔ **Ce qu'elle disait, et pourquoi c'était faux.** « `GroupUserCreatedListener` (estarter) est
> entièrement commenté, donc ajouter quelqu'un à un groupe ne propage rien » ⇒ faux négatif
> silencieux, à corriger en décommentant le listener du socle.
>
> **Deux classes homonymes** sont abonnées à `GroupUserCreated`, une par paquet. Celle du socle
> est bien un `Log::info` mort — mais celle de **ce** paquet
> ([`GroupUserCreatedListener.php:25-37`](../src/app/Listeners/GroupUserCreatedListener.php))
> écrit l'arête, et [son pendant `Deleted`](../src/app/Listeners/GroupUserDeletedListener.php) la
> retire. La chaîne est complète et vérifiée de bout en bout :
> `GroupUser::booted()` dispatche · `->using(GroupUser::class)` est déclaré **des deux côtés** de
> la relation (`Group::users()`, `EstarterUser::groups()`) — condition sans laquelle aucun
> événement de pivot ne partirait, listener décommenté ou pas · les deux providers enregistrent
> leur listener respectif.
>
> **Leçon de méthode** : deux paquets peuvent abonner deux classes **de même nom** au même
> événement. Ouvrir la première que rend le `find` prouve son état, pas celui du câblage. La
> question qui tranche n'était même pas « le listener est-il commenté ? » mais « la relation
> déclare-t-elle `using()` ? ».

Ce qui restait, après vérification — trois défauts réels, dans l'ordre de gravité. Les deux premiers
sont livrés (E4.1), le troisième reste ouvert (E4.2).

---

#### E4.1 — `canJoinchatRoom` exige l'appartenance, et les gardes refusent par défaut `[M]` 🔴

- [x] **Dépend de :** rien. — ✅ **fait le 21/08/2026.**

**1. ✅ `canJoinchatRoom` renvoyait *toujours* `true` — mais pas pour la raison écrite ici.**
Le plan disait : « son `OPTIONAL MATCH` rend une ligne même sans correspondance ». La
contre-épreuve contre le cluster de dev a tranché autrement, et c'est plus grave : **NebulaGraph
3.8 refuse cette requête**, `[ERROR (-1004)]: SyntaxError: Where clause in optional match is not
supported`. Elle ne s'est donc **jamais exécutée**. Et comme `execute()` rend un `JsonResponse`
truthy sur erreur, le `if($result)` en faisait une **autorisation permanente** : `channels.php`
n'autorisant le canal `chat.{chatId}` que par ce garde, tout authentifié pouvait s'abonner à
n'importe quelle conversation privée. Corrigé en retirant le mot `OPTIONAL` — forme déjà attestée
en production par les deux gardes jumeaux.

> **Leçon, la même famille que celle du 18/08 mais sur l'autre axe.** Le 18, l'annotation fausse
> décrivait l'état d'une *classe nommée* et se vérifiait sur le câblage. Ici elle décrivait le
> *comportement d'une requête* — et une requête ne se vérifie ni à la lecture, ni contre
> `FakeNebulaGraph`, qui fait du `str_contains` et ne parse rien. **Elle se vérifie contre un vrai
> graphe.** Le harnais aurait avalé les deux formes sans broncher.

**2. ✅ Les trois `canJoin*` — et `_checkIsOwner` — n'encaissaient pas la panne du graphe.**
`execute()` → `responseJson()` renvoie `response()->json($erreur, 500)` — un **objet, donc
truthy** — quand nGQL échoue, sans jamais lever
([`NebulaGraphConnection.php:149-155`](../src/app/Helpers/NebulaGraphConnection.php)). Un
`if($result) return true;` transformait donc une erreur de graphe en autorisation, et le
`count($result)` de `_checkIsOwner` levait un `TypeError` sur ce même objet — soit un 500 à la
place d'un refus. Motif de `followsMutually` recopié : réponse inexploitable ⇒ refus +
`Log::warning`. **`_checkIsOwner` n'était pas optionnel** : sur les canaux `room.` et
`questionnaire.`, `isCreator` est le second terme d'un `||` que le fail-open de `canJoinRoom`
n'atteignait jamais — durcir le premier sans le second aurait échangé un accès accordé à tort
contre une erreur 500.

Le refus par défaut n'est donc pas une ceinture posée à côté du correctif du point 1 : **c'en est
le correctif**, puisque la requête n'était pas valide.

**3. ✅ Le contournement qui vidait tout le reste — trouvé en livrant.**
`Chat::checkRegistration`, appelée par `/send-chat-message` et `/send-chat-audio`, **inscrivait son
appelant dans n'importe quel chat qu'il nommait**, sans aucune garde. Un seul POST, et l'attaquant
devenait un membre *légitime* : `canJoinchatRoom` répondait alors `true` à bon droit, et
l'abonnement au canal suivait, de façon permanente. Gardée sur `canJoinchatRoom`, avec le
court-circuit « déjà inscrit » d'abord pour ne pas payer un aller-retour Thrift par message.
**Leçon : un garde n'est fermé que quand tous les chemins qui écrivent son état le sont aussi.**

**4. ✅ Le verrou que le point 3 aurait créé, et sa sortie.**
`getOrcreateChatVertice` n'inscrit que dans sa branche de **création**, et
`ChatController::getOrcreateChatVertice` l'appelle **sans valeurs** ⇒ `createConversation` retombe
sur `privacy => 1`. Tout chat de salon est donc privé avec le créateur seul inscrit : il ne
fonctionnait que grâce au bug du point 1. Fermer le point 3 sans plus l'aurait verrouillé
définitivement pour tous les autres participants. D'où `Chat::registerInRoomChat` : **le chat d'un
salon hérite de la décision de son salon** (`canJoinRoom || isCreator`, le garde que `channels.php`
applique déjà au canal `room.{roomId}`). Aucune reprise des données existantes — décision du
21/08 : environnement de dev, aucun chat créé.

**Tests :** `tests/Feature/Channels/ChannelGuardTest.php` et
`tests/Feature/Chat/ChatRegistrationTest.php` — premiers tests de garde `Broadcast::channel` du
paquet. Ils ont demandé trois pièces de harnais : un stub `App\Models\User` (les closures de
`channels.php` sont typées sur la classe de l'hôte, **en dur**), `insertEdge()` sur
`FakeNebulaGraph` (les helpers d'arête n'écrivent pas par `execute()`), et une doublure
`onlineUsers` (sans quoi `new Chat()` n'est pas constructible). Les callbacks sont invoqués par
`Broadcast::getChannels()` et jamais par `Broadcaster::auth()` : les drivers qui y descendent
sérialisent le `UserResource`, ce qui explose faute des dépendances estarter.
**Contrôle de harnais :** 18 mutations rejouées une par une, toutes rougissent.
**Contre-épreuve nGQL** contre le cluster de dev : les quatre branches de la requête réécrite
(privé/membre, privé/intrus, public/intrus, public sans membre) rendent 1, 0, 1 et 0 lignes.
**Doc :** `securite.md` (piège 1, piège 2, la leçon du réplica) · `signalisation.md` (tableau des
canaux — `questionnaire` y était annoncé « présence » et est **privé** aux deux bouts) ·
`package.md` (les deux familles de gardes, `mayReach` y manquait) · `tests.md` · `CLAUDE.md:104` ·
`Socializable.php` (en-tête de section créé, deux blocs condensés) · `Chat.php` (docblocks créés).
`core.blade.php` : zéro occurrence, donc **pas de `boost:update`**.
**Commit :** `secu(socializer): les gardes de canal Reverb refusent par défaut`

---

#### E4.2 — Le réplica graphe dérive dans le sens qui accorde `[M]` ✅ 24/08/2026

- [x] **Dépendait d'** un arbitrage produit. **Rendu le 24/08/2026 : voie B — cesser de lire, plutôt
  que re-synchroniser.**

**L'arbitrage, et son argument.** Deux voies étaient ouvertes : re-synchroniser le réplica (observer
`Group`/`User`, cascade applicative, étape de réconciliation), ou cesser de lire l'appartenance dans
le graphe comme `mayReach` l'avait fait le 15/08 pour `sharesGroupWith`. C'est la seconde.
**Re-synchroniser aurait ajouté des événements à une chaîne dont l'échec est toléré PAR DÉCISION**
(`ToleratesGraphFailure`, arbitrage d'E7 : une copie ratée ne doit pas faire échouer l'opération
hôte). Elle aurait donc raccourci la fenêtre de dérive sans la supprimer. Router la question vers le
maître ne laisse aucune fenêtre — et prolonge une décision déjà prise au lieu d'en créer une.

**La prémisse de cette tâche était fausse, et c'est l'instruction qui l'a montré.** Le titre parlait
d'« un groupe supprimé » : or `Users::deleteGroup` fait `deleteVertex(…, WITH EDGE)`, qui emporte
les `registered_in` entrantes. De même `attach`/`detach`/`sync` passent tous par le modèle de pivot
sur Laravel 13 — `detach()` sans argument compris. Après E4.1 et E7, **tout chemin encore
exploitable passait par un échec d'écriture graphe**, c'est-à-dire par un événement que E7 rend
bruyant. Le défaut restait réel ; son urgence, non.

**La mesure, faite avant de trancher.** `LOG_STACK=single`, fichier jamais roté, continu du 28/05 au
23/08 : **0 entrée** `Réplica NebulaGraph désynchronisé`, **2** arêtes `user → group` pour **2**
lignes `group_user`, **12** sommets `user` pour **12** lignes. Le réplica est exact — sur un banc
qui porte 1 groupe et 2 attachements figés depuis le 28/05, donc **aucun chemin de dérive n'y a été
exercé**. `securite.md` écrit déjà que sur des données clairsemées la statistique ne prouve rien ; la
réciproque valait ici, et c'est ce qui a évité de conclure « pas de dérive, pas de sujet ».

**Trois trouvailles qui n'étaient pas au plan.**

1. **Le vid d'un serveur n'est pas toujours dérivable.** Le serveur du cluster de dev porte
   `0e64e1713d940`, un `uniqidReal()` d'avant l'id dérivé. Résoudre le groupe en décomposant le vid
   du serveur — la voie évidente — aurait donc refusé le seul serveur existant. Le garde demande
   `id(g)` au graphe, qui répond de ce dont il est maître.
2. **`nb_users` valait toujours 1 pour la MÊME cause que la faille.** La clause de confidentialité
   pendait au motif `(u:user)-[:registered_in]->(g)` qui sert aussi à `count(distinct u)` : elle
   filtrait ET décidait. Sortir la décision répare le compteur — contre-épreuve sur le cluster de
   dev, `nb_users` rend **2** là où l'ancienne requête rendait 1. Ferme l'item de
   [`serveur-todo.md`](serveur-todo.md).
3. **Un test écrit trop vite ne gardait rien.** `get_server_refuse_avant_de_toucher_au_graphe`
   comptait les requêtes émises — or sans garde il n'en part qu'une aussi, la grosse. Il restait
   vert alors qu'on venait de retirer ce qu'il prétendait garder. C'est l'**identité** de la requête
   qui distingue les deux mondes, pas leur nombre. Trouvé par la contre-épreuve, pas à la relecture.

> 🔴 **Régression signalée en production le 24/08, corrigée le jour même : chaque salon s'affichait
> en double.** La clause retirée faisait un **troisième** métier que ni le plan ni la contre-épreuve
> n'avaient vu : en épinglant `u` à un seul utilisateur, elle garantissait UNE ligne par salon avant
> l'agrégation. Sans elle, le produit cartésien en rend `nb_users` — et **`collect()` ne dédoublonne
> pas**, contrairement au `count(distinct u)` juste à côté, qui était déjà protégé. Deux membres ⇒
> deux exemplaires de chaque salon. Corrigé en `collect(distinct r)`, mesuré contre le cluster de
> dev (`size(rooms)` : 2 sans le `distinct`, 1 avec), épinglé par
> `get_server_ne_collecte_pas_un_salon_par_membre`.
>
> **La leçon, et elle est générale — c'est la jumelle de celle de D0 sur l'`await`.** Retirer une
> clause de filtrage ne change pas seulement ce qu'elle filtrait : elle change la **cardinalité du
> jeu de lignes que consomment TOUS les agrégats de la requête**. Chacun doit être réexaminé, pas
> seulement celui qu'on voulait réparer. Ici l'un des deux était `distinct` et l'autre non — la
> différence ne se voyait pas tant que la clause tenait les deux.
>
> **Ce que le harnais ne pouvait pas voir**, et il faut le dire : `FakeNebulaGraph` rend la liste
> qu'on lui script, il ne produit aucun produit cartésien. Aucun test de la suite ne pouvait
> rougir. La contre-épreuve nGQL, elle, aurait pu — mais elle avait porté sur `nb_users`, la valeur
> qu'on venait de réparer, et pas sur `rooms`. **Contre-épreuver la ligne qu'on corrige ne suffit
> pas : il faut contre-épreuver la requête entière.**

**Code :** `Socializable::canJoinServer` (requête à **deux colonnes** — une seule et `formatValues`
effondrerait la ligne) + `isMemberOfGroup` · `Server::getServer` (garde en amont, clause retirée du
motif de comptage) · `Server::checkServerAccess` (le miroir d'interface du garde, leçon de C5 :
trois copies d'une règle d'accès divergent). `_checkCanJoin` a rendu son journal à
`_refusSansReponse`, partagé.

**Tests :** 6 cas neufs dans `ChannelGuardTest` (dont *un ancien membre dont l'arête a survécu ne
rejoint pas le serveur privé*, celui que cette tâche nommait) et `tests/Feature/Server/ServerAccessTest.php`,
**neuf** contre-épreuves par mutation rejouées une par une, toutes ciblées. **Contre-épreuve nGQL
des deux requêtes réécrites contre le cluster de dev** — la leçon d'E4.1 : `FakeNebulaGraph` fait du
`str_contains` et ne parse rien. Harnais : `PresencePayloadTest` scripte désormais un serveur
public, et le commentaire de `makeChannelUser` qui affirmait « aucun garde de canal ne lit
l'appartenance MariaDB » est devenu faux — corrigé.

**Doc :** `securite.md` (pièges 1 et 2 réécrits, la leçon du réplica augmentée du corollaire de
méthode) · `package.md` (liste des gardes) · `Socializable.php` (en-tête de section, docblocks) ·
`ToleratesGraphFailure.php` (ce qu'il ne règle pas, et pourquoi ça restera ainsi) · `CLAUDE.md`.
Décompte « onze listeners » corrigé en **douze** (`ArticleRestoredListener`, 23/08).
`core.blade.php` : zéro occurrence, donc **pas de `boost:update`**.

**Ce qui reste, et qui n'est plus de la sécurité.** Les listings (`Socializable::servers()`,
`Server::getServers`, `nb_users`) lisent encore `registered_in` : la qualité du réplica est un sujet
de **données**, arbitrable plus tard sans échéance. Deux constats annexes sont sortis en tâches
propres dans [`projection-graphe-todo.md`](projection-graphe-todo.md) : **aucun listener n'est
abonné à `UserDeleted`** (le sommet d'un compte supprimé et ses arêtes survivent), et le helper
global `checkServerAccess` n'a plus qu'un appelant, qui l'utilise avec le tag `room` sur un motif
`owned_by → group` que les salons ne portent pas.

**Commit :** `secu(socializer): l'appartenance à un groupe se lit dans MySQL`

---

### E7 — Les écritures dans le graphe échouent en silence `[M]` 🟠

- [x] **Dépend de :** rien. **Extraite d'E4 le 21/08/2026.** — ✅ **fait le 22/08/2026.**

**La correction, en deux couches qui partageaient le même code par accident.** Le principe :
*une lecture ratée doit se dégrader en refus, une écriture ratée ne doit pas se dégrader du tout.*

| Chemin | Journalise | Lève |
|---|---|---|
| lectures | ✅ | ❌ — contrat E4.1 intact, **aucun test à réécrire** |
| écritures DML (6 méthodes) | ✅ | ✅ `NebulaGraphException` |
| DDL | ✅ | ❌ — schéma asynchrone, migration rejouable |

La journalisation au point de couture (`errorIn`) est ce qui ferme réellement le trou : les ~80
sites d'écriture muets deviennent visibles d'un coup, sans qu'un seul change. La levée
(`executeWrite`) est ce qui donne un contrat aux appelants — une valeur de retour, ça s'ignore,
c'était tout le bug.

**Quatre choses que le plan n'avait pas vues, et qui valaient chacune le détour.**

1. **`insertVertex` masquait activement.** `return is_array($result) && count($result) ? $result :
   $items` retombait sur `$items` en SUCCÈS (un INSERT ne rend aucune ligne) **comme** en échec.
   Succès et échec rendaient la même valeur : les 11 `if(!is_array($vertex))` des appelants
   n'étaient pas seulement morts, ils étaient **inatteignables par construction**. Retirés.
2. **Faire lever révèle des erreurs nGQL préexistantes.** `Feed::deleteFeedPost` appelle
   `deleteVertex($comments)` sans garder la liste, alors que la ligne d'à côté garde bien son
   `count($share_ids)` : un post **sans commentaire** émettait `DELETE VERTEX  WITH EDGE` — invalide,
   absorbé depuis toujours, et qui serait devenu un 500 systématique. D'où le garde « liste vide ⇒
   aucune requête », posé **dans la couture** (4 méthodes d'un coup) et non chez l'appelant.
3. **Onze listeners, pas huit.** `UserCreatedListener`, `GroupCreatedListener` et
   `GroupDeletedListener` atteignent le DML *indirectement*, par les services. Et le `try` de
   `GroupUpdatedListener` devait couvrir **deux** lignes : `setGroupHasParentRelation` finit par
   `insertEdge`.
4. **Une réponse illisible passait pour un succès vide.** `json_decode` rendant `null`,
   `null->errors[0]->code` cascadait en warnings puis concluait `code == 0`. Couvert par `errorIn`.

**Arbitrages datés, à ne pas relire comme des oublis** — DDL non-levant (schéma asynchrone,
`IF NOT EXISTS`, pas de rollback exploitable) · les 11 listeners rattrapent au lieu de laisser
remonter (aucun n'est `ShouldQueue`, MySQL est la source de vérité) · `OnlineUsersService` rattrape
**en silence** (la couture a déjà journalisé, et c'est le battement de présence) · ni le nGQL ni le
message du graphe dans `getMessage()` (leçon C3 : il porte du contenu utilisateur, et aucun
contrôleur hors `UserController` n'a de `try/catch`).

**Tests :** `tests/Feature/Graph/NebulaGraphSeamTest.php` (25 cas) et `ReplicaFailureListenerTest`,
plus 4 cas greffés sur `ChatRegistrationTest` et `FollowVerdictTest`. **20 rouges vus avant le
correctif.** Nouveau harnais : `FakeThriftClient` double le client Thrift pour exercer la **vraie**
`NebulaGraphConnection` — la première fois que le décodage, la levée et la NON-levée sont
démontrables ; `fakeNebulaGraphConnection()` et `grapheMuet()` remontés dans `TestCase` (3
duplications supprimées) ; `throwsOn()` sur `FakeNebulaGraph`.
**Contrôles de harnais :** 4 neutralisations rejouées (le `throw`, le `Log::error`, le `catch` du
trait, le garde de liste vide) — toutes rougissent. Et le contrôle qui compte le plus : **les 139
tests antérieurs sont restés verts de bout en bout**, ce qui prouve qu'E4.1 n'a pas été inversée.
**Doc :** `securite.md` (corollaire symétrique daté) · `signalisation.md` (tableau des trois
régimes) · `tests.md` (décision 3 réécrite : deux niveaux de doublure, et lequel prouve quoi) ·
`Socializable.php` (en-tête qualifié) · `ChannelGuardTest` (ce que sa frontière garde désormais).
`core.blade.php` : zéro occurrence, donc **pas de `boost:update`**.
**Commit :** `fix(socializer): une écriture de graphe qui échoue ne se tait plus`

⚠️ **Avant de livrer en production — le relevé qui manque.** Le pari d'E7 est qu'un échec nGQL est
rare et anormal. Si une famille de requêtes échoue en permanence — hypothèse crédible,
`canJoinchatRoom` était un `SyntaxError` depuis toujours —, la levée transforme un bug muet en panne
visible immédiate. **Poser la couture seule en dev et lire le journal 24 h** avant d'aller plus loin.
Et cinq formes à contre-vérifier contre le cluster, listées au bas de `NebulaGraphSeamTest` : d'abord
que `DELETE VERTEX` / `DELETE EDGE` à liste vide sont bien une erreur (le postulat du garde), et que
`INSERT EDGE x () VALUES "a" -> "b":()` — la forme de tous les `props => []` de la config — passe,
faute de quoi **tout** le paquet lèverait.

---

### E5 — Un refus de signalisation s'affiche vide `[S]` 🟡

- [x] **Dépend de :** rien. **Trouvé le 16/08/2026** en livrant C5 — le masquage du bouton
  retire le cas nominal, il ne répare pas le retour d'erreur des autres chemins. — ✅ fait le
  16/08/2026.

Le diagnostic de C5 disait « aucun composable WebRTC2 n'inspecte le statut HTTP ». C'est vrai
— `usePeerCore` fait `console.error` et retourne `false` — mais **incomplet**, et la moitié
manquante change le correctif :

`AjaxService.load` (estarter), lui, inspecte bien le statut. Sur un 403 il émet `httpError`,
que `widgets/Alert.vue` transforme en `AWN.alert(msg)`. **Un toast part donc déjà.** Son
message vaut `data.message || toaster.err` — or `UserController::signalingDenied` renvoie
`response()->json(['ok' => false], 403)`, **sans clé `message`**, et les appels WebRTC2 ne
passent aucun `toaster`. L'utilisateur reçoit une alerte **au contenu nul**.

> ⚠️ Le `'Accès interdit'` passé en 4e argument dans `AjaxService` est **mort** : `EmitEvent`
> n'a que trois paramètres. Ne pas le lire comme le libellé en vigueur.

- Donner un `message` à la réponse de `signalingDenied` — **le même dans les deux cas** (slug
  inconnu et absence de relation), sinon on rouvre l'oracle d'énumération que C2 a fermé.
- Vérifier au passage les autres refus de ce contrôleur : `signalingFailure` (C3) renvoie
  `['ok' => false]` en 500, même symptôme.

**Livré** : deux constantes de classe (`DENIED_MESSAGE`, `FAILURE_MESSAGE`) et les deux retours.
Français en dur plutôt que `trans()` : le paquet n'a qu'un `resources/lang/fr/` sans `fallback`
correspondant, donc un hôte en `APP_LOCALE=en` afficherait la **clé brute** dans le toast — pire
que le cadre vide qu'on corrige. L'i18n reste un chantier à part.

> **La leçon d'E5 tient en une phrase** : le corps d'une réponse de signalisation est du **texte
> affiché**, pas seulement une donnée de protocole. Le docblock de `signalingDenied` concluait
> « aucun composable WebRTC2 n'inspecte le statut HTTP, donc le passage de 404 à 403 est invisible
> côté client » — vrai des composables, faux de la chaîne, parce qu'`AjaxService` s'intercale entre
> les deux. **Un garde n'est fini que lorsqu'on a suivi son refus jusqu'au pixel.**

#### Ce que la contre-épreuve a trouvé : l'assertion de fuite de C3 était vide de sens

En faisant volontairement fuiter `$ex->getMessage()` dans la réponse 500, les **cinq** cas de
`ExceptionLeakTest::la_reponse_ne_contient_ni_chemin_ni_trace_quand_le_broadcast_echoue` sont
restés **verts** — alors que le corps contenait le chemin complet.

Cause : `json_encode` échappe les `/` en `\/`. Chercher `/var/www/…` dans un corps JSON brut ne
peut **jamais** matcher. Le test ne fonctionnait que contre la forme ORIGINALE du bug de C3 — un
`return $ex;` rendu en texte brut par `Response::setContent` — et dès que C3 a converti la réponse
en JSON, il a cessé de garder quoi que ce soit sur le chemin, sans virer au rouge. Les assertions
sur `'#0 '` et `'RuntimeException'`, elles, tenaient toujours : aucune ne contient de `/`.

Corrigé sur place (`str_replace('\\/', '/', …)` avant les recherches). Contre-épreuve refaite :
les 6 tests passent au rouge.

⚠️ **À retenir pour tout test de non-fuite sur un corps JSON** : le sérialiseur transforme la
chaîne qu'on cherche. Un `assertStringNotContainsString` sur un chemin, une URL ou tout ce qui
porte un `/` est vert par construction s'il lit le JSON brut.

**Tests :** ✅ `RelationGuardTest::le_refus_porte_un_message_lisible` ·
`::le_message_ne_distingue_pas_le_slug_inconnu_de_l_absence_de_relation` (compare les corps
**entiers**, pas seulement `message` : toute clé future ajoutée d'un seul côté serait un oracle de
plus) · `ExceptionLeakTest::la_reponse_500_porte_un_message_sans_rien_divulguer`.
Contre-épreuve faite dans les trois sens — clé retirée, libellés divergents, message d'exception
relayé — chaque fois rouge, et rouge sur le bon test.

**Done :** ✅ **81 tests PHP / 210 assertions** verts (16/08/2026, contre 78/199 avant — la
référence de 73/190 citée plus haut datait d'avant C5). Suite JS **inchangée à 649 tests / 37
fichiers** : la modif est backend, et `__tests__/helpers/fakeSignalingServer.js` ne modélise aucun
refus — il ne devient donc pas menteur. (La référence de 645/36 citée en « Vérification globale »
datait elle aussi d'avant C5.)
**Commit :** `fix(socializer): un refus de signalisation dit pourquoi`

---

### E6 — L'interface répète la même erreur N fois, et se tait sur 429 `[M]` 🟡

- [ ] **Dépend de :** rien. **Périmètre : estarter, pas socializer.** Trouvé le 16/08/2026 en
  cadrant E5 — écarté sciemment de sa livraison, qui devait rester un commit dans un dépôt.

E5 rend les refus lisibles ; il ne dit rien de leur **nombre**. Le toast part sur **chaque** 403,
y compris sur les chemins automatiques : `requestRemotePeerConnection` autorise 3 demandes/10 s par
cible (`ASK_PEER_MAX_REQUESTS_PER_WINDOW`) et une rafale de join en émet jusqu'à 14 dans le même
tick ; l'invitation d'appel est réémise ~9 fois en 55 s par `inviteRetryManager`. Dans une room
`privacy == 0` peuplée d'inconnus — la borne connue de C2, ci-dessus — ça fait plusieurs toasts par
pair.

> **E5 ne dégrade rien** : ces toasts partaient déjà, vides. Il les rend lisibles, donc voyants.
> C'est une raison de traiter le volume, pas de regretter le message.

**Le bon endroit est le rendu, pas le transport.** Un dédoublonnage « même message dans les N
dernières secondes » posé dans `widgets/Alert.vue::handleError` couvre **tous** les producteurs de
`httpError`, y compris ceux qui court-circuitent `AjaxService` — formdesigner émet directement sur
l'eventBus (`VersionManager.vue:70`, `FieldOtherAnswersModal.vue:111`). Un flag `toaster.silent`
dans `AjaxService`, à l'inverse, ne servirait qu'aux appelants qui pensent à le passer, et rendrait
à nouveau muets les refus qu'E5 vient de rendre lisibles.

**Angle mort voisin, même fichier.** `AjaxService` **n'a pas de branche 429** : un appel étranglé
par le `throttle` de C1 tombe dans le `else` final, qui ne teste que
`error.response.data.error === 'passwords.token'` → **aucun toast, aucune trace**. Or Laravel met
déjà un `message` dans le corps d'un 429 : la branche manquante suffirait.

**Ce que ça coûte.** estarter a son propre dépôt (`.git`, branche `laravel13`), donc la modif est
versionnable — mais elle n'a **aucun filet** : le `vitest.config.js` de l'hôte restreint `include`
à socializer, et la couverture JS d'estarter est un chantier à part entière (les
`stores/__tests__/notifications/*.spec.js` de mai 2025 sont obsolètes). Couvrir demande d'élargir
`include` dans un fichier qui n'appartient à aucun des deux paquets. Rayon d'impact : toutes les
pages de l'application.

⚠️ Levier plus faible, pour mémoire : AWN accepte `maxNotifications`, configuré dans
`resources/js/vue.js` de l'hôte. Ça plafonne l'affichage sans dédoublonner — masque plutôt que
corrige.

**Tests :** deux toasts identiques dans la fenêtre ⇒ un seul affiché · deux messages différents
⇒ deux affichés · un 429 produit un toast. Nécessite d'élargir `include` côté hôte.
**Commit :** `fix(estarter): ne pas répéter le même toast, et ne plus taire un 429`

---

### E8 — La présence Reverb diffuse le bloc privé de chaque membre `[M]` 🟠 — ajoutée le 21/08/2026

- [x] **Dépend de :** rien. Mais elle modifie la charge utile `users` que consomme WebRTC2 :
      **ne pas la mener en parallèle d'une tâche du lot B**. — ✅ fait le 22/08/2026.

Les trois canaux de présence — `server.{serverId}`, `room.{roomId}`, `chat.{chatId}` — renvoient
`new UserResource($user)` depuis [`channels.php`](../src/routes/socializer/channels.php). Cette
ressource délègue à `EstarterUserResource`, qui garde bien son bloc privé derrière
`if ($this->id === Auth::user()?->id)`.

**Le garde n'est pas faux : c'est le contexte qui le désarme.** La ressource est construite pendant
la requête `/broadcasting/auth` **du membre lui-même**, donc `Auth::user()` y est toujours ce
membre — la branche privée gagne systématiquement. Reverb stocke ce `user_info` par connexion, puis
le diffuse à **tous les autres membres** via `here` et `member_added`.

Mesuré le 21/08 sur `presence-server.0e64e1713d940` — charge utile de `joe bar` telle que la reçoit
`admin` :

```
email               => 'utilisateur@estarter.com'
roles               => ["Utilisateur"]
permissions         => ["display_user_questionnaire","update_user_questionnaire"]
groups              => [{"name":"Innovation","is_leader":false,"server_id":"0e64e1713d940"}]
unreadNotifications => 0
```

C'est le même motif que C2 et E4.1, une marche plus loin : **un garde qui dépend de
`Auth::user()` ne veut plus rien dire dans un contexte où `Auth::user()` est toujours le sujet de
la donnée.** Le périmètre d'une ressource de diffusion doit être décidé par la ressource, pas par
l'identité de la requête qui l'a fabriquée.

Corollaire sans gravité mais piégeur : **`is_me` vaut `true` pour toutes les entrées** d'une liste
de présence. Il reste juste sur une charge utile **HTTP** (`ThumbnailWidget`, `Cover` s'en servent
légitimement) — c'est la présence, et elle seule, qui le retourne. Consigné dans
[`docs/architecture/signalisation.md`](../docs/architecture/signalisation.md).

- Ressource de présence dédiée (`PresenceUserResource`) dont le périmètre ne dépend d'aucune
  identité de requête, au lieu de dériver d'une ressource à géométrie variable.
- ⚠️ **Inventorier les consommateurs avant de retirer un champ.** Relevé du 21/08 sur les listes
  de présence : `slug` (10 lectures), `id` (5), `name` (1) — plus `Gravatar`, qui lit `image` et
  `gravatar`. `slug` est le pivot de l'admission des pairs WebRTC2 : un champ retiré à l'aveugle
  casse une poignée de main, pas seulement un affichage.

**Livré** : `Resources/PresenceUser` (liste blanche : `id`, `name`, `slug`, `image`, `function`,
`connected`) sur les **quatre** canaux, épinglée par `tests/Feature/Channels/PresencePayloadTest`
(17 cas).

Quatre écarts par rapport au plan ci-dessus, tous mesurés en le livrant :

1. **Quatre canaux, pas trois.** `questionnaire.{roomId}` renvoyait la même ressource — le
   `DataProvider` du test le couvre, et c'est lui qui aurait rougi si on l'avait oublié.
2. **Deux sources, pas une.** Le bloc privé venait d'estarter, mais `Resources\User` ajoutait
   *aussi* son propre `groups` (avec `server_id`) **sans condition**. D'où le choix d'une **liste
   blanche** : une liste noire aurait fermé la première, manqué la seconde, et n'aurait rien dit du
   champ ajouté demain en amont. C'est la leçon d'E8 la plus réutilisable.
3. **`connected` gardé**, contrairement à ce que « `slug`/`id`/`name`/`image` » laissait entendre :
   `GravatarStatus` le lit dès qu'aucun listener `users-status.{slug}` n'existe, c'est-à-dire dans
   le cas ordinaire. `function` gardé pour la même raison (`WallLink`, `ApplicationComponent`).
   `gravatar` retiré en revanche — son seul lecteur est `AvatarCropper`, sur un profil HTTP, et
   `Gravatar.vue` prend son icône de repli dans le store `me`.
4. **Le harnais a dû s'ouvrir d'un cran** : `FakeOnlineUsers::isOnlineUser` ne lève plus, elle
   répond sur un état déclaré par `pretendOnline()` — et les deux réponses sont assertées, pour ne
   pas remplacer un service qui lève par un service qui rend 0 en silence.

Effet visible assumé : le dropdown de `WallLink` ouvert depuis une liste de présence n'affiche plus
la ligne e-mail (`v-if="user.email"`). C'est exactement la fuite qu'on ferme.

> **La leçon d'E8** : le périmètre d'une ressource de **diffusion** se décide dans la ressource,
> jamais dans l'identité de la requête qui l'a fabriquée. Corollaire de méthode, valable au-delà de
> ce cas : sur un chemin de diffusion, **une liste blanche est le seul filtre qui vieillisse bien**.

**Commit :** `secu(socializer): ressource de présence sans bloc privé`

---

### E9 — La liste noire des charges utiles d'auteur laisse passer deux champs `[S]` 🟡 — ajoutée le 22/08/2026

- [x] **Dépend de :** rien. **Trouvée en livrant E8**, même famille et autre vecteur.
      — ✅ fait le 22/08/2026.

`filterSensibleDataUserRessource()` (`src/app/Helpers/Socializer.php`) retirait `email`,
`created_at`, `roles`, `permissions` et `channel` d'une `Resources\User` avant diffusion — mais
**laissait `groups` (avec `server_id`) et `unreadNotifications`**, vers tous les membres du chat.

C'est le défaut qu'E8 a évité en choisissant une liste blanche : **une liste noire ferme les champs
du jour où on l'écrit.** Ici elle a été écrite avant que `Resources\User` n'ajoute son `groups`.

**Livré** : `Resources/MessageAuthor` (liste blanche : `id`, `name`, `slug`, `image`, `function`,
`connected`), câblée sur **trois** sites, `filterSensibleDataUserRessource()` supprimée. Épinglée
par `tests/Feature/Chat/AuthorPayloadTest` (18 cas).

Trois écarts par rapport au plan ci-dessus, tous mesurés en le livrant :

1. **Trois sites, pas deux.** L'inventaire a trouvé la même fuite sur l'**historique HTTP** :
   `Resources/Message.php:23` renvoyait `Resources\User` **sans aucun filtre**, donc `groups` avec
   son `server_id` sortait à chaque `load-conversation`. Le front rend l'historique et le temps réel
   par les mêmes bindings (`item.author`) : ne resserrer que la diffusion aurait laissé la surface
   la plus permissive faire foi. Les deux sites de diffusion (`Chat.php:255`, `:364`) fanent
   d'ailleurs sur **trois** canaux, `NewChatMessageNotification` compris.
2. **Le relevé du 21/08 sur `ThumbnailWidget` était inexact** : il lit bien `user.groups`, mais sur
   la charge utile de `POST /get-user-list` (liste des membres), pas sur un mur. Le mur passe par
   `Cover.vue`, qui ne lit jamais `groups`. Conclusion inchangée — **aucun** composant atteignable
   depuis un auteur de message ne lit `groups` ni `unreadNotifications` — mais par un autre chemin.
3. **La voie courte n'était pas seulement moins bonne, elle était intestable.** Deux `unset()` de
   plus auraient laissé le test traverser `EstarterUserResource` : il aurait fallu doubler la
   ressource d'un autre paquet, `revealIdentifier`/`hideIdentifier` et une table `groups` — un mock
   qui ment, ce que `docs/architecture/tests.md` interdit. La liste blanche se teste sans Mongo,
   sans graphe et sans `fakeBroadcasts()`.

Deux limites assumées, écrites dans le docblock du test : il n'atteste pas le câblage des **deux
sites de diffusion** (`createAndDispatchMessage` est privée, `updateMessage` exige Mongo + graphe +
Redis — même mur que pour `getOrcreateChatVertice` dans `ChatRegistrationTest`), et il ne
**démontre pas** l'ancienne fuite : écrit contre l'ancien helper, il aurait planté en
`Class … not found` au lieu d'échouer, exactement comme E8. La démonstration est le relevé, pas un
rouge. Seul le troisième site, l'historique HTTP, est épinglé bout en bout.

*Gain incident :* `Resources\User` chargeait `$current_user->groups` — une requête — à **chaque**
message diffusé.

**Commit :** `secu(socializer): charge utile d'auteur en liste blanche`

> **La leçon d'E9**, en une phrase de plus qu'E8 : une liste noire ne ferme pas les champs, elle
> ferme les **sources qu'on connaissait le jour où on l'a écrite**. Ce n'est pas le champ oublié qui
> coûte, c'est celui qu'un paquet en amont ajoutera sans le dire.

---

# LOT F — Documentation

### F1 — Consigner le périmètre réel `[S]`

- [ ] **Dépend de :** tout le reste (clôture).

> ✅ **La moitié « constat » de F1 est déjà faite** :
> [`docs/modules/webrtc2/securite.md`](../docs/modules/webrtc2/securite.md) énonce le périmètre
> réel des deux audits et la leçon des deux sens. Reste ce qui dépend de l'exécution :

- [`docs/modules/webrtc2/securite.md`](../docs/modules/webrtc2/securite.md) : basculer le sens
  sortant de « 🔴 aucun contrôle » à durci ; documenter le prédicat unique
  `utils/isAuthorizedPeer.js` ; retirer de « Bornes non fermées » ce qui a été fermé.
  ✅ **Déjà fait pour le backend** (16/08, avec C4) : la ligne « Backend » du périmètre et
  l'entrée « Bornes non fermées » ne mentionnent plus le `throttle`, le `validate()` ni la
  fuite d'exception — seuls restent l'énumération et le contrôle de relation. Idem pour le
  ⚠️ de [`docs/architecture/signalisation.md`](../docs/architecture/signalisation.md), devenu
  un **troisième invariant backend** (validation dans le contrôleur, hors du `try`).
  Ne pas re-décrire ces trois points, vérifier qu'ils sont exacts.
- [`docs/modules/webrtc2/architecture.md`](../docs/modules/webrtc2/architecture.md) : ajouter la
  ligne `authorizedCallPeers` dans la table des propriétaires uniques (posée en A1), et la règle
  **tout chemin qui ouvre une connexion porte un garde d'autorisation, dans les deux sens**.
  Y joindre le corollaire de B3 : **tout chemin qui ÉCRIT dans cette allowlist en porte un
  aussi** — une acceptation d'appel ne vaut que pour une invitation en vol, et la garde va
  avant l'écriture, pas après (la FSM ne protège que ce qui la suit).
- Ce fichier : consigner les deltas assumés, puis le **supprimer** s'il ne reste rien
  (cf. [`docs/ecrire-la-doc.md`](../docs/ecrire-la-doc.md)).

**Commit :** `docs(webrtc2): périmètre réel de l'audit de mai + règle des deux sens`

---

## Vérification globale

- `npx vitest run` après **chaque** tâche. Référence relue le 23/08/2026, après E1 et E2 :
  **694 tests / 38 fichiers, ~3,9 s**. ⚠️ Relire la référence au runner, ne jamais la déduire d'un
  delta : celle qui figurait ici (655, « après E8 ») était déjà fausse de 7 tests avant E1.
- **Backend** : `vendor/bin/phpunit` **depuis le paquet** (Orchestra Testbench, aucun serveur
  requis) — cf. [docs/architecture/tests.md](../docs/architecture/tests.md). Socle posé avec C3
  le 15/08/2026, référence après E9 : **139 tests / 335 assertions, ~7 s**. ⚠️ Le décompte qui
  figurait ici (81/210, « après E5 ») n'avait pas été remis à jour par E4.1 : relire la référence,
  ne pas la déduire d'un delta.
- `hooks/pre-push` rejoue **les deux** suites. ⚠️ Il n'y a **pas** de CI : la mention d'un
  `.github/workflows/webrtc2-tests.yml` qui figurait ici était fausse — ce dépôt n'a pas de
  `.github/`, et l'activation du hook est une config locale, jamais versionnée.
- Les scénarios sont le filet qui compte : `lateJoiner`, `peerDeparture`,
  `broadcastLifecycle` doivent rester verts sur A2, B1 et D2 — ce sont eux qui observent le
  seul symptôme qui casse (« A diffuse, B arrive, B ne voit rien »).
- ~~Backend : `php artisan test`~~ — le paquet n'a pas d'app : c'est `vendor/bin/phpunit`
  depuis le paquet (cf. ci-dessus) sur C1 → C4 et E3.
- Recette manuelle après le lot A : visio 1-à-1, diffusion + arrivant tardif, partage
  d'écran seul — les trois chemins que le garde sortant traverse.
