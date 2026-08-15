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
E1, E2                        (indépendants)
F1                            (dernier)
```

`A` est bloquant. `B3`, `C1`, `C3`, `E1`, `E2` ne bloquent personne : à intercaler librement.

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

- [ ] **Dépend de :** rien. Peut partir en premier.

Aucun middleware `throttle` sur `routes.private.php` (vérifié, ainsi que le
`ServiceProvider`). Le limiteur client de `usePeerCore` est correctement décrit comme
anti-spam involontaire — mais un attaquant le contourne en une ligne, et rien ne le
remplace côté serveur. `sendAlertToUser` sans plafond = spam d'invitations d'appel vers
n'importe quel utilisateur.

- Groupe `throttle` sur `/ask-to-peer-id`, `/response-to-peer-id`, `/send-alert-to-user`,
  `/response-to-authorization-peer`, `/close-connection-to-peer-id`.

> ⚠️ Dimensionner **au-dessus** de la cadence légitime déjà documentée côté client : un
> join de room mesh émet jusqu'à **14 demandes dans le même tick** (7 pairs × type
> principal + écran, cf. `MAX_PEERS_PER_ROOM` et la note de `ASK_PEER_MAX_REQUESTS_PER_WINDOW`
> dans [`webrtc2.config.js`](../src/resources/js/socializer/components/WebRTC2/webrtc2.config.js)). Un plafond trop bas casse le join —
> c'est le piège pour lequel le plafond client est **par cible** et non global.

**Tests :** rafale au-delà du plafond ⇒ 429 · join mesh nominal (14 requêtes) ⇒ aucun 429.
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

- [ ] **Dépend de :** C3.

Aucun `validate()` sur les 5 méthodes : `room`, `type`, `connectionType`, `peerId` et
`options` sont relayés bruts vers le client destinataire.

- `$request->validate()` : `toUserSlug` requis + format slug · `type` et `connectionType`
  en liste blanche (miroir de `VALID_CONNECTION_TYPES`) · `peerId` en UUID · `room` borné
  en longueur · `options` en tableau à clés attendues.

> ⚠️ Conserver la liste blanche de champs déjà en place à l'émission — c'est elle que
> `__tests__/helpers/fakeSignalingServer.js` reproduit **à l'identique**. La desserrer
> fabriquerait un chemin impossible en production et rendrait le harnais menteur.

**Tests :** type hors liste ⇒ 422 · `peerId` non-UUID ⇒ 422 · payload nominal ⇒ 200.
**Commit :** `secu(socializer): valider les payloads de signalisation`

---

### C2 — Contrôle de relation émetteur ↔ destinataire `[M]` 🟠

- [ ] **Dépend de :** C4. Jumeau serveur de A2 — c'est la version **autoritative** du garde.

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

- **`askForPeerId` / `responseToPeerId`** — réutiliser `canJoinRoom` / `canJoinServer`, déjà
  utilisés par [`channels.php`](../src/routes/socializer/channels.php), sur la `room` du
  payload.
- **`sendAlertToUser` / `responseToPeerAuthorization` / `closeConnectionToPeerId`** — pas de
  room exploitable dans le payload (la `room` de l'appel direct est générée côté client,
  ce n'est pas un vertex). Il faut donc une **nouvelle requête Nebula** « ces deux users
  partagent-ils un vertex ? » — `MATCH (a:user)-[:registered_in]->(x)<-[:registered_in]-(b:user)`
  — plus la réciprocité du follow (arête `followed_by` du mur de chacun vers l'autre, cf.
  [`Users.php`](../src/app/Services/Users.php)). ⚠️ **C'est ce qui fait de C2 un `[M]` et
  non le `[S]` que la ligne « réutiliser canJoinRoom » laissait croire.**
- Poser le prédicat en **une seule méthode** sur `Socializable` (`mayReach`), pas cinq
  contrôles recopiés — convention « un seul système ».
- 403 + `Log::warning` traçant `auth_user_id`, `target_slug`, `ip`, `user_agent` — même
  format que le log d'usurpation déjà en place dans `closeConnectionToPeerId`.

**Tests :** inconnu (ni follow réciproque ni vertex commun) ⇒ 403 et **aucun broadcast
émis** · follow à sens unique ⇒ 403 · follow réciproque ⇒ 200 · membre de la même room
⇒ 200 · membre du même serveur ⇒ 200.
**Commit :** `secu(socializer): exiger une relation entre émetteur et destinataire`

---

### C5 — Aligner le bouton d'appel sur la règle C2 `[S]`

- [ ] **Dépend de :** C2.

Sans ça le bouton **ment** : [`components/User/Cover.vue`](../src/resources/js/socializer/components/User/Cover.vue)
affiche `CallRemotePeerBtn` dès que `user.connected`, sans rien savoir de la relation.
Après C2, tout appel hors relation part en 403 — l'utilisateur verrait un bouton qui
échoue silencieusement.

- Exposer le verdict de `mayReach` dans la charge utile du profil (à côté de
  `nb_followers` / `is_me`, déjà présents) et conditionner l'affichage du bouton.
- Le serveur reste l'autorité : ce masquage est de l'UX, **pas** un contrôle.

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

- [ ] **Dépend de :** C2 (même fichier, même garde).

`firstOrFail()` sur un slug arbitraire distingue 404 (utilisateur inexistant) de 200
(existant) → énumération. Aligner sur la réponse du garde de C2 (403 uniforme).

**Tests :** slug inexistant et slug existant hors relation ⇒ **même** code et même corps.
**Commit :** `secu(socializer): réponse uniforme sur slug inexistant ou non autorisé`

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

- `npx vitest run` après **chaque** tâche. Référence relue le 15/08/2026, après B3 :
  **645 tests / 36 fichiers, ~3,7 s**.
- **Backend** : `vendor/bin/phpunit` **depuis le paquet** (Orchestra Testbench, aucun serveur
  requis) — cf. [docs/architecture/tests.md](../docs/architecture/tests.md). Socle posé avec C3
  le 15/08/2026.
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
