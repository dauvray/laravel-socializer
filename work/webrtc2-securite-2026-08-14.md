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
E1, E2, E4, E5, E6            (indépendants)
F1                            (dernier)
```

`A` est bloquant. `B3`, `C1`, `C3`, `E1`, `E2`, `E4`, `E6` ne bloquent personne : à intercaler
librement.

Les lots A, B et C sont **terminés**, ainsi que **C5** (le bouton d'appel) et **E5** (le libellé
du refus) — 15 et 16/08. Restent : **D** (TURN, requiert une modif d'infra coturn), **E1**, **E2**,
la part `getUsersList` d'**E3**, **E4** — **requalifiée 🔴 le 18/08**, sa prémisse était fausse :
c'est la plus grave des tâches ouvertes et elle ne dépend de rien —, **E6** (périmètre estarter)
et **F1** en clôture.

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

### D1 — Endpoint de credentials TURN signés `[M]`

- [ ] **Dépend de :** rien (mais requiert une modification d'infra coturn).

`VITE_COTURN_USERNAME` / `VITE_COTURN_CREDENTIAL` sont **compilés dans le bundle JS** servi
à tous (`usePeerTransport.js`, config `iceServers` de `new Peer`). Identifiants longue
durée, partagés, lisibles par quiconque ouvre le fichier → **relais ouvert** : bande
passante gratuite, imputable au serveur.

- Basculer coturn sur `use-auth-secret` / `static-auth-secret` (`socializer.conf`).
- Route authentifiée renvoyant
  `{ username: "<expiry>:<userId>", credential: HMAC-SHA1(secret, username) }`, TTL court
  (~1 h) — TURN REST API.

**Tests :** credential expiré rejeté par coturn · format conforme à la RFC.
**Commit :** `secu(socializer): endpoint de credentials TURN éphémères`

---

### D2 — Consommer les credentials éphémères côté client `[S]`

- [ ] **Dépend de :** D1.

- `usePeerTransport._doInit` : récupérer les credentials avant `new Peer(...)` au lieu de
  lire `import.meta.env`. Prévoir l'échec (repli sur STUN seul + `console.warn`) — un TURN
  indisponible ne doit pas empêcher la création du Peer.
- Retirer `VITE_COTURN_USERNAME` / `VITE_COTURN_CREDENTIAL` de `.env`, `.env.example` et du
  bundle. **Considérer le secret actuel comme compromis : le tourner.**

> ⚠️ `_doInit` est déjà encadré par `_peerInitPromise` (garde de race contre deux contextes
> qui montent en même temps). L'appel réseau ajouté doit rester **à l'intérieur** de cette
> promesse, sinon deux contextes créeront deux `Peer` distincts.

**Tests :** credentials injectés dans `iceServers` · échec de récupération ⇒ le Peer se crée
quand même avec STUN.
**Commit :** `secu(webrtc2): consommer les credentials TURN éphémères`

---

# LOT E — Bornes résiduelles 🟡

### E1 — Borner l'amplification du hub star `[S]`

- [ ] **Dépend de :** rien.

Les gardes du hub sont par émetteur (`HUB_MAX_MESSAGES_PER_WINDOW` = 20/s) et par message
(`MAX_PAYLOAD_BYTES` = 64 Ko), mais **leur produit par le fan-out ne l'est pas** :
`20 × 64 Ko × N destinataires`. Or star est justement la topologie des grandes rooms — à
100 membres, un client d'apparence honnête fait sortir ~128 Mo/s du hub.

- Budget agrégé d'octets retransmis par fenêtre dans `forwardStarMessage`, constante
  `HUB_MAX_BYTES_PER_WINDOW` dans [`webrtc2.config.js`](../src/resources/js/socializer/components/WebRTC2/webrtc2.config.js), documentée
  comme les autres.
- Réutiliser `utils/createRateLimiter.js` si la mécanique s'y prête, sinon l'étendre —
  **pas de Map de timestamps ad hoc** (convention « un seul système »).

**Tests :** le budget coupe la retransmission · un trafic nominal ne le déclenche pas.
**Commit :** `secu(webrtc2): borner le débit agrégé retransmis par le hub star`

---

### E2 — Borner et sanitiser `conn.metadata` `[S]`

- [ ] **Dépend de :** rien.

Seules les frames data sont contrôlées en taille (`isPayloadWithinLimit` dans `handleData`).
`conn.metadata` est distant, non borné, et seul `type` est sanitisé
(`sanitizeMetadataType`). `fromName` est affiché dans l'UI
(`Widgets/Mediaplayer/MediaBroadcastPlayer.vue`).

> ✅ **Pas de XSS** — aucun `v-html` ni `innerHTML` dans tout le composant (vérifié), Vue
> échappe l'interpolation. Le risque est la dégradation de mise en page et la pollution des
> logs, pas l'exécution.

- Étendre `utils/sanitizeMetadata.js` : `sanitizeMetadataName` (longueur bornée) + contrôle
  de la taille globale de l'objet metadata à l'admission.

**Tests :** `utils/sanitizeMetadata.test.js` — nom trop long tronqué · metadata
surdimensionné rejeté.
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

### E4 — Les gardes de canal Reverb accordent ce qu'ils devraient refuser `[M]` 🔴

- [ ] **Dépend de :** rien. **Trouvée le 16/08/2026** en cadrant C2 — hors périmètre de l'audit
  du 14/08 (ce n'est pas WebRTC2), mais découverte par lui et trop concrète pour être perdue.
  **Requalifiée le 18/08/2026 : sa prémisse était fausse, ses conclusions étaient inversées.**

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

Ce qui reste, après vérification — trois défauts réels, dans l'ordre de gravité :

**1. 🔴 `canJoinchatRoom` renvoie *toujours* `true`.**
[`Socializable.php:97-110`](../src/app/Helpers/ModelTraits/Socializable.php) : son `OPTIONAL
MATCH` rend une ligne **même sans correspondance**, et le garde se contente de `if($result)`.
Or [`channels.php:15-19`](../src/routes/socializer/channels.php) n'autorise le canal privé
`chat.{chatId}` que par lui : **tout utilisateur authentifié peut s'abonner à n'importe quelle
conversation privée** et en recevoir les messages en temps réel. Ce n'est pas une dérive de
réplica, c'est une rupture de confidentialité — et elle ne dépend d'aucune donnée.

**2. 🟠 Les trois `canJoin*` sont *fail-open* sur panne du graphe.**
`execute()` → `responseJson()` renvoie `response()->json($erreur, 500)` — un **objet, donc
truthy** — quand nGQL échoue, sans jamais lever
([`NebulaGraphConnection.php:149-155`](../src/app/Helpers/NebulaGraphConnection.php)). Un
`if($result) return true;` transforme donc une erreur de graphe en autorisation.
`mayReach::followsMutually` se garde déjà exactement de ça (`! is_array($result)` ⇒ refus, avec
`Log::warning`) : c'est le motif à recopier, pas à réinventer.

**3. 🟡 Le réplica dérive encore, mais dans le sens qui accorde.**
[La migration](../../../innovation/laravel-estarter/src/database/migrations/3019_10_31_000025_create_user_group_table.php)
pose `onDelete('cascade')` sur les deux clés étrangères de `group_user` : supprimer un groupe ou
un compte retire les lignes **en SQL, sans événement Eloquent**, et l'arête `registered_in`
survit dans le graphe. S'y ajoutent les rattachements antérieurs aux listeners. Le symptôme
attendu est donc l'inverse de celui annoncé le 16/08 : un **faux positif** — l'ancien membre
d'un groupe supprimé garde l'accès au canal du serveur privé — donc personne ne le signale.

> **Corollaire, même famille que 2.** Les deux listeners **ignorent la valeur de retour** de
> `insertEdge` / `deleteEdge`, qui ne lève pas non plus : un échec d'écriture d'arête est
> totalement muet — pas d'arête, pas de log, pas d'exception. C'est *ce* chemin qui produit le
> faux négatif que E4 attribuait au listener commenté.

⚠️ **Constat annexe, déjà durable** : `canJoinRoom` / `canJoinServer` ne sont pas des prédicats
d'appartenance (sur `privacy == 0` la clause est vraie pour n'importe quel couple ⇒ `true` pour
tout le monde). Consigné dans
[`docs/modules/webrtc2/securite.md`](../docs/modules/webrtc2/securite.md) (« Deux pièges du
graphe que ce garde contourne ») — ne pas le recopier ici.

**Périmètre.** Les points 1 et 2 sont dans ce paquet, sans dépendance, et livrables seuls. Le
point 3 demande un arbitrage : re-synchroniser sur la suppression (observer sur `Group`/`User`,
ou `deleting` en cascade applicative), ou cesser de lire l'appartenance dans le graphe pour
`canJoinServer` comme `mayReach` l'a déjà fait pour `sharesGroupWith` — la seconde voie retire
le sujet au lieu de le maintenir.

**Tests :** `canJoinchatRoom` refuse un chat privé dont on n'est pas membre · les trois gardes
refusent quand `execute()` rend un `JsonResponse` (graphe muet) et non un tableau · un non-membre
ne rejoint pas le canal d'un serveur privé. Faisables dans la suite PHP existante : le harnais
double déjà `nebulaGraph` — cf. [tests.md](../docs/architecture/tests.md).
**Commit :** `secu(socializer): les gardes de canal Reverb refusent par défaut`

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

- `npx vitest run` après **chaque** tâche. Référence relue le 16/08/2026, après E5 :
  **649 tests / 37 fichiers, ~3,8 s**.
- **Backend** : `vendor/bin/phpunit` **depuis le paquet** (Orchestra Testbench, aucun serveur
  requis) — cf. [docs/architecture/tests.md](../docs/architecture/tests.md). Socle posé avec C3
  le 15/08/2026, référence après E5 : **81 tests / 210 assertions, ~4,6 s**.
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
