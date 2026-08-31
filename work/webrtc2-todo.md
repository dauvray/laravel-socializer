# WebRTC2 — Todo

> Chantier ouvert. Les items **terminés** sont élagués : leur rationale vit dans
> [`docs/modules/webrtc2/`](../docs/modules/webrtc2/INDEX.md), leur récit dans `git log`.
> Tests : [webrtc2-tests-plan.md](webrtc2-tests-plan.md).
>
> Effort : `[S]` `[M]` `[L]`

---

## 🔓 Routage star — dégelé et SCINDÉ le 29/08/2026

> **À lire en entier avant d'y toucher.** Cet item a été gelé du 13/08 au 29/08 sous le titre
> « déplacer le routage star dans `usePeerTransport` `[L]` », sur trois affirmations dont **aucune
> ne tient à la relecture**. Elles sont conservées ci-dessous avec leur réfutation : les effacer
> ferait refaire l'analyse au prochain lecteur, qui retomberait sur le même plan.

### Ce que l'item disait, et ce que dit le code (mesuré le 29/08/2026)

| Affirmation d'origine | Vérification |
|---|---|
| « ~245 lignes avec les passthroughs média » | `initializePeerConnection` fait **98 lignes** (`usePeerOrchestrator.js:122-219`), et le routage star y occupe **18 lignes** (l.145-162). Les 80 autres sont trois wraps sans rapport : annonce de diffusion à l'ouverture, tracking de `remoteStreamsMap`, cleanup de flux en mode `stream`. Le chiffre datait d'avant l'extraction de `useCallManager`, `useStreamManager`, `useConnectionPool` et `useSignalingQueue`. |
| « attend que les scénarios servent de filet » | **Condition remplie.** 49 fichiers de test dont 8 scénarios bout-en-bout ; 1141 cas sur la suite entière du paquet (60 fichiers), re-mesuré le 29/08 après l'attestation. Le filet valait 8 fichiers le 13/08. |
| « bloque les tâches 6 et 7 » | **Un seul cas sur 27** en dépend : `initializePeerConnection … onDataReceived est wrappé` (tâche 6). Les 15 autres de la tâche 6 et les 11 de la tâche 7 ne touchent pas au routage star. |

> Ces chiffres se re-mesurent, ils ne se recopient pas : `wc -l` sur la fonction, `find __tests__
> -name '*.test.js' | wc -l`, et la sortie du runner.

### Le fait qui change le plan : on ne peut PAS déplacer le wrap

Le wrap `onDataReceived` **mixe trois couches**, et son commentaire le revendique (« SEUL endroit
où on mixe les couches ») :

- **transport** → `transport.forwardStarMessage(data, conn)` — devenu
  `transport.routeIncomingData(data, conn)` avec (a), la seule des trois qui soit descendue
- **présence** → `presence.handleBroadcastStateMessage(...)`
- **applicatif** → `originalOnDataReceived(...)`

Or `usePeerTransport` **ignore totalement `useBroadcastPresence`** (vérifié : zéro occurrence).
Déplacer « le routage star » au sens large y ferait donc entrer la couche présence — une inversion
de l'ordre des couches, pas une simplification. **Seule la DÉCISION star peut descendre ;
l'interception de présence et le passe-plat applicatif restent où ils sont.** L'item d'origine
demandait donc, en partie, quelque chose qu'on ne veut pas faire.

### Les deux travaux, désormais séparés

- [x] **(a) Descendre le déballage d'enveloppe star dans `usePeerTransport`** `[S]` — **fait le
  29/08/2026.** `routeIncomingData(data, conn)` porte le prédicat (`star` ET `__starRoute` ET
  `isHub`, lu **par message**), `forwardStarMessage` n'est plus exporté, et le wrap de
  l'orchestrateur ne garde que le sort du payload.

  **Trois affirmations de l'énoncé, re-mesurées avant d'écrire** : « 18 lignes » ✅ exact ;
  « le wrap tombe à 3 » ❌ — la branche star tombe à **8 lignes, dont 5 de code** (le wrap entier :
  26 → 19), parce que l'arité 1 et l'interception de présence ne descendent pas ; « appelé de nulle
  part ailleurs » ✅ — **un seul** appelant de production.

  **Ce que l'énoncé ne chiffrait pas, et qui était le vrai coût** : désexporter voulait dire
  migrer **22 appels** de `usePeerTransport.forwardStar.test.js`. Gratuit, en fait — les 22
  passent déjà `__starRoute: true` et le harnais monte déjà `star` + `isHub`, donc le verbe a
  pu garder la signature `(data, conn)` : renommage mécanique, aucune assertion touchée.

  **Le nom interne `forwardStarMessage` est CONSERVÉ**, seul l'export part : 5 fichiers de
  production et 3 pages de `docs/` le citent, et le renommer aurait périmé dix références pour
  rien.

  Contre-épreuves mesurées, chaque moitié séparément : retransmission neutralisée ⇒ **17 cas**
  rougissent (dont les 2 neufs) ; remontée du payload neutralisée ⇒ **1** (l'arité 1) ; prédicat
  de topologie neutralisé ⇒ **1** (le fall-through hors cas hub). Et une borne apprise en
  passant, consignée dans l'en-tête du fichier de tests : forcer le harnais en `mesh` ne rougit
  que **15 cas sur 17** — les deux survivants n'assertent que des absences d'envoi, et une
  absence ne distingue pas « refusé » de « jamais exécuté ».

- [✅] **(b) Middleware/pipeline de données, ou composable `usePeerRouter`** `[L]` — **tranché le
  29/08/2026 : ne pas le construire. Sortie D, décision datée.**

  C'était la seconde moitié de l'item d'origine et c'est elle qui portait le `[L]` : une couche
  architecturale neuve par-dessus `createPeerContext` (934 lignes). La question qui la conditionnait
  a été posée et répondue (David, 29/08) : **pas de mode SFU pour l'instant, mais la porte doit
  rester ouverte pour une v2/v3.**

  **Garder la porte ouverte ne veut pas dire construire le routeur maintenant.** Une abstraction
  bâtie pour un besoin qui n'existe pas se fige sur les hypothèses du moment et devient l'obstacle
  qu'elle prétendait éviter — c'est déjà l'histoire de cet item, qui a gelé un chantier réel
  pendant seize jours pour une couche que personne n'a jamais réclamée. Ce qui tient la porte
  ouverte, c'est **la connaissance de la couture**, et elle est écrite ci-dessous.

### 🚪 Ce qui tient la porte ouverte pour un futur SFU

**Un SFU, dans ce module, c'est « star dont le hub est un serveur ».** Même question à répondre —
« à qui j'envoie, et qui retransmet pour moi » — avec une troisième réponse. Ce n'est pas une
topologie d'une autre nature.

**Conséquence directe, et c'est l'argument fort pour (a)** : tant que la décision de routage vit
dans le wrap `onDataReceived` de l'orchestrateur — l'étage qui mixe transport, présence et
applicatif — un mode SFU devrait s'y câbler aussi, dans la glue. Une fois (a) faite, la décision
vit dans le transport, et SFU y devient une troisième branche au même endroit que `mesh` et `star`.
**(a) n'est pas un nettoyage, c'est la préparation demandée.**

**La couture complète : la topologie n'est lue qu'à SEPT endroits, dans TROIS fichiers** (re-relevé
le 29/08/2026 APRÈS (a), `grep -rn topology` hors tests et hors `Debug.vue`). C'est la liste
exhaustive de ce qu'un mode SFU doit répondre, et la connaître dispense de la redécouvrir :

| Fichier | Ligne | Ce que la topologie y décide |
|---|---|---|
| `useConnectionPool.js` | 510, 527 | à qui je me connecte (mesh : tous ; star : le hub, ou tous si je suis le hub) |
| `usePeerTransport.js` | 1883, 1903 | à qui j'envoie, et sous quelle forme (nu ou enveloppé) |
| `usePeerTransport.js` | 1852 | ce qu'une donnée REÇUE est — enveloppe à retransmettre, ou message |
| `useBroadcastPresence.js` | 124, 182 | à qui j'annonce ma diffusion, et le cas du client vers son hub |

⚠️ **(a) n'a pas réduit le compte, elle a réduit le nombre de FICHIERS** — sept sites toujours, mais
`usePeerOrchestrator` n'en porte plus aucun. C'est ce qui change pour un futur SFU : les deux moitiés
de la question (« à qui j'envoie », « ce que je reçois ») se répondent désormais dans le même
fichier, et non plus l'une dans le transport et l'autre dans la glue qui mixe trois couches.

Rien d'autre. Un mode SFU se répond dans ces trois fichiers, et `useBroadcastPresence:124`
(`targets = mesh ? reachable : null`) est déjà écrit pour le supporter — il traite « pas mesh »
comme « le transport sait, laisse-le router ».

> ℹ️ **Les lignes de `usePeerTransport` ont bougé DEUX fois en deux jours** — 1451, 1471 au relevé
> d'origine, 1826, 1846 après le commit d'attestation (`ec5ee5b`), 1883, 1903 après (a). Les quatre
> autres sites n'ont pas bougé une seule fois. Ce qui se recopie sans risque, c'est **le fichier et
> la décision** ; le numéro de ligne se re-grep, toujours.

- [x] 🟠 **`topology: 'sfu'` produisait un contexte MORT, en silence** `[S]` — **fait le
  30/08/2026**, avec un jumeau que l'énoncé ne nommait pas : `star` **sans** `hubSlug`, même
  contexte mort, mêmes prédicats composés. `createPeerContext` lève désormais sur les deux, en
  distinguant **réservée** d'**inconnue**. Le durable est dans
  [`api.md § Topologies`](../docs/modules/webrtc2/api.md#topologies) — y compris la distinction que
  la passe a dû écrire noir sur blanc : **`hubSlug` fourni n'est pas hub présent**, un hub absent
  restant un état transitoire parfaitement légitime.

### Ce qui était réellement bloqué — plus rien depuis le 29/08/2026

**Un cas**, celui du wrap `onDataReceived` de la tâche 6, écrit dans la foulée de (a)
(`usePeerOrchestrator.broadcastPresence.test.js`, describe « branche hub »). Le reste des tâches 6
et 7 ne l'a jamais été et est fermé depuis.

⚠️ **Le montage de ce cas coûte trois préparations, et chacune est une raison de rougir** : un
contexte `star` dont le hub est moi ; `isHub` **résolu** (il vaut `null` au montage et n'est écrit
que par `waitForMeReady` — un tour de synchronisation sur une liste VIDE le déclenche sans rien
ouvrir) ; et une connexion sortante semée vers un tiers, car **les connexions entrantes ne sont pas
enregistrées dans le store** (le dispatcher n'y branche que ses listeners). Sans la troisième, le
hub n'a personne à qui retransmettre et le fan-out sort en silence — vert par vacuité.

### Pourquoi le gel avait raison en août, et n'a plus raison

Le 13/08, cinq extractions structurelles simultanées (callManager + StreamManager, pool
d'instances Vue, SignalingQueue, drainage de file) ont été livrées ; le 15/08 arrivait
`bug fix Régression : A diffuse, B ne voit rien` — le cas majoritaire cassé. Le gel a été écrit
depuis cette brûlure, et c'était le bon geste. Mais ce qu'il gèle aujourd'hui n'est pas cinq
extractions : c'est 18 lignes, sous un filet cinq fois plus dense.

---

## usePeerTransport

- [x] **`peerInitPromise` couvre jusqu'à `'open'`** `[M]` — **fermé le 29/08/2026**, sous tests verts
  (1034 → 1039 cas). `_doInit` `await` réellement l'`'open'` : résolution dans le handler existant,
  rejet dans `bind('error')`, et un délai `PEER_OPEN_TIMEOUT_MS` (8 s) qui **détruit** l'instance.
  Le contrat vit dans
  [architecture.md § L'init se termine à l'`'open'`](../docs/modules/webrtc2/architecture.md#linit-se-termine-à-lopen-jamais-à-la-construction) ;
  les trois verbes « lire / attendre » dans [flux.md](../docs/modules/webrtc2/flux.md) ; le versant
  harnais dans [tests.md](../docs/modules/webrtc2/tests.md).

  **Ce que la passe a réfuté ou appris, et qui ne se déduit ni du diff ni de l'énoncé :**

  1. **« permettre aux appelants de s'y raccrocher » est RÉFUTÉ, et les trois appels de production
     restent nus.** `acceptCallFromPeer` pose `addRemotePeerId` huit lignes sous son
     `setLocalPeer()`, et ce mapping doit précéder l'arrivée du `peer.call` de l'initiateur : un
     `await` intercalé fait refuser l'appel entrant par `_isAuthorizedIncomingPeer`, et **un refus
     ne revient jamais à l'émetteur**. `startCallWithPeer` est synchrone — l'awaiter déplacerait
     `callMachine.transition(CALLING)` après un point de suspension, donc deux clics rapides
     passeraient tous deux le garde. Le gain n'était pas là.
  2. **Le gain réel est ailleurs, et l'énoncé ne le nommait pas : le délai.** Un `Peer` dont la
     socket s'ouvre sans que le serveur envoie son `OPEN`, et sans erreur, restait vivant en phase
     `connecting` **pour la vie de l'onglet** — la garde d'instance respecte tout `Peer` vivant,
     donc plus aucune ré-init n'était possible, sans un log. Rien ne le bornait : le backoff ne
     part que d'un `'disconnected'`.
  3. **Le délai doit DÉTRUIRE, pas oublier.** Le `.catch` se contente de nuller `localPeer` ; sur
     une instance vivante, cela aurait fabriqué un peerId fantôme de plus — socket ouverte, pair
     enregistré côté serveur, hors d'atteinte de `_destroyPeerSingleton`. La famille de bugs la
     plus coûteuse du module, par un chemin neuf.
  4. **La preuve du 29/08 sur le `.catch` tombe, et elle est remplacée par un test.** « Aucun garde
     d'identité nécessaire, le seul `await` est celui de l'ICE » ne tient plus : un second point de
     suspension existe, avec deux sorties en échec. Le garde ajouté ne fait que LIRE
     `peerInitPromise` — ce n'est pas le piège du `resetPeerState()`, qui écrivait.
  5. **La couverture n'était qu'à MOITIÉ faite sans réordonner les gardes**, et c'est un test qui
     l'a montré : la garde d'instance précédait celle de la promesse, donc un second consommateur
     monté pendant l'init sortait sur un `undefined` immédiat alors que le pair n'était pas
     joignable — le mensonge exact que l'item supprime, à un endroit qu'il ne visait pas.
  6. **`expect(initB).toBe(initA)` n'est pas observable** : `setLocalPeer` est `async`, donc son
     `return peerStore.peerInitPromise` enveloppe la promesse du store dans une neuve qui l'adopte.
     L'observable est la DATE de règlement.
  7. **`_scheduleIceRefresh` reste AVANT l'`await`**, et c'est ce qui garde la passe petite : le
     corps post-`await` est vide, donc aucune seconde garde d'annulation à écrire. Le déplacer
     après aurait rendu **vacuement verts** les deux cas « n'arme aucun minuteur » d'`iceRefresh`.
  8. **Aucune liste d'`err.type` fatals à maintenir** : `_abort()` de PeerJS détruit l'instance
     lui-même avant l'`'open'` (`bundler.mjs:1761-1764`). Le seul type à exclure est
     `peer-unavailable`, qui nomme un pair distant.
  9. **Le préalable de harnais annoncé « fait » était incomplet.** `vi.waitFor` avance l'horloge
     **factice** de 50 ms par tour de sondage (`vi.DgezovHB.js:3591`), ce qu'`iceRefresh.test.js`
     ne supporte pas ; et attendre « une instance non nulle » rend l'ANCIENNE au second démarrage.
     D'où `waitForPeerInstance` et son paramètre `previous`.
  10. **~22 sites de test migrés, mais la facture est dans les 2 cas qui changent de SENS** —
      l'énoncé annonçait « une vingtaine de tests bloqués » et comptait les sites. Un remplacement
      mécanique les aurait laissés verts en ne prouvant plus rien. Les deux autres cas que le plan
      croyait devoir retourner se sont migrés mécaniquement.
  11. **Sept neutralisations mesurées**, chacune rougissant exactement ce qu'elle annonce — dont la
      septième, « la résolution déplacée au-dessus de la garde d'identité de `'open'` », qui ne
      rougit **rien** : le chemin est inatteignable, toute supplantation détachant les listeners
      avant. C'est consigné dans le fichier de test plutôt que gardé par du code qu'aucun test ne
      peut faire rougir.
- [x] **La machine à états du cycle de vie du Peer** `[L]` — **close le 29/08/2026.** Un seul fait
  déclaré (`peerPhase`, écrit par cinq transitions) remplace `localPeerReady` et l'usage de
  `peerInitPromise` COMME état ; `peerIdentity()` est le seul chemin de lecture de la production,
  et `getLocalPeerId` / `getLastLocalPeerId` / `getLocalPeerReady` sont supprimés — avec trois
  setters du store qui n'avaient aucun appelant. La substance est dans
  [flux.md](../docs/modules/webrtc2/flux.md#lire-létat-du-peer-local). Ce que la passe a **appris
  ou réfuté**, et qui ne se déduit pas du diff :
  - **La panne silencieuse était fermable seule**, et l'a été en premier (lot 1) :
    `waitForMeReady` lisait `lastLocalPeerId`, un fait HISTORIQUE, et répondait « prêt » sur un
    peer détruit ou déconnecté sans recours. Trois cas rouges d'abord, dans
    `createPeerContext.test.js`. La sémantique retenue n'est pas « répondre `false` » mais
    **attendre** : abandonner ferait sortir les quatre consommateurs par leur `if (!ready) return`
    pendant un backoff qui allait aboutir. Le timeout de 15 s reste le filet.
  - **La phase est appliquée même quand la transition est inattendue** — l'inverse de
    `useCallStateMachine`, qui refuse. Une phase qui refuserait de suivre PeerJS décrirait un peer
    qui n'existe plus : c'est la divergence même qu'elle supprime. L'arbitrage est dans l'en-tête
    de `stores/peers2/phases.js`, épinglé par `peers2Store.peerRuntime.test.js`.
  - **L'observation garde le dernier mot sur la déclaration** : `peerIdentity()` ne croit pas une
    phase `ready` sur un peer `destroyed`. Sans cette règle, la phase aurait été un septième
    prédicat, capable de mentir comme les six autres.
  - **68 cas de test annoncés, 10 assertions réellement à réécrire** — plus un décor. L'énoncé
    comptait les fichiers qui n'émettent pas `'open'` ; ce qui coûte n'est pas là, mais dans les
    fichiers qui asserted sur `localPeerReady` (`singleton`, `reconnect`, `iceRefresh`) et dans
    `usePeerCore.test.js`, dont TOUT le décor reposait sur un `getLocalPeerId` que le double
    servait par défaut et que le vrai store n'a jamais eu.
  - **Un mensonge du double, trouvé en chemin** : `localPeer` et `getLocalPeer` y étaient deux
    champs INDÉPENDANTS, alors que le store réel ne peut pas les faire diverger. Invisible tant
    que rien ne lisait les deux — les tests semaient l'un, la production a commencé à lire
    l'autre. Ce sont désormais deux accesseurs sur un seul objet, avec le garde structurel de
    `connection.remotePeers`.
  - **La surface de `setLocalPeer` n'a pas bougé**, comme prévu : `useCallManager.js` et
    `useCallManager.test.js` sont intacts. L'item voisin `peerInitPromise` a été traité à part et
    fermé le même jour — sa surface non plus n'a pas bougé, c'est la DATE de règlement de la
    promesse qui a changé.
- [x] **L'id historique survit à un échec d'init — contradiction désormais SUPPRIMABLE** `[S]` —
  **fermé le 29/08/2026**, une ligne dans le `.catch` de `_doInit` (`lastLocalPeerId = null`, sous
  le `localPeer = null` qui existait) et le code de violation conservé, comme prévu. Ce que la
  passe établit et qui ne se lit pas dans le diff :
  - **Un seul enchaînement de production y menait**, et le trouver a été l'essentiel du travail :
    TOUTE destruction passe par `_destroyPeerSingleton` → `resetPeerState()`, qui nulle déjà l'id.
    Il faut donc une instance abandonnée **par PeerJS lui-même** (`_abort()` → `destroy()`, sans
    passer par nous) pour qu'une ré-init reparte — le garde d'instance de `setLocalPeer` ne retient
    que les peers vivants — avec l'identité de la vie précédente encore publiée, puis que CETTE
    init échoue. C'est ce que reproduit le test, et rien d'autre.
  - **`resetPeerState()` dans le `.catch` aurait été le piège** : il nulle aussi `peerInitPromise`,
    donc le garde d'identité du `.finally` (`peerStore.peerInitPromise === initPromise`) échouerait
    — plus de nettoyage de la garde d'init, et **plus d'audit**, en silence. D'où l'affectation
    champ par champ.
  - **Le `.catch` n'a besoin d'aucun garde d'identité**, vérifié : le seul `await` du corps de
    `_doInit` est celui de l'ICE, suivi de la garde d'annulation. Tout ce qui peut jeter ensuite
    est synchrone, donc aucune init plus récente ne peut s'être intercalée — un `.catch` qui
    nullerait le peer de quelqu'un d'autre n'est pas atteignable.
  - **Le `.catch` n'était exercé par AUCUN test** — il en a un maintenant, dans
    `usePeerTransport.singleton.test.js`, vérifié rouge avant le correctif et sur la seule
    assertion visée (le reste du chemin était déjà juste). Le seuil d'échec est simulé en faisant
    jeter le premier verbe appelé après `new Peer` : la cause est indifférente, le `.catch` est un
    filet générique.
  - ⚠️ Le code de violation RESTE, comme annoncé : l'état demeure atteignable à la main, et c'est
    ce qui en détourne le prochain lecteur. Le cas de `peers2Store.peerObservability.test.js` reste
    lui aussi — il ne décrit plus « ce que le `.catch` laisse » mais « un id qui a survécu à son
    peer ».
  - Deux résumés périmés par la FSM, ramassés en chemin parce qu'ils portaient sur ce champ
    exactement : le docblock de `ME_READY_TIMEOUT_MS` et l'en-tête de `waitForMeReady` annonçaient
    tous deux une attente sur `lastLocalPeerId`.
- [ ] **Fidélité du mock : `disconnect()` ne met pas `_id` à `null`** `[S]`
  Le vrai `Peer.disconnect()` fait `this._id = null` (`bundler.mjs:1809`) ; le mock conserve
  l'id — écart assumé et documenté (le registre du bus est keyé sur `id`, et trois scénarios
  appellent `destroy()` directement). Conséquence : la divergence identité courante /
  identité historique, qui est le cœur de la panne silencieuse, n'est pas reproductible en
  test. Fermer cet écart demande de rekeyer le bus sur une clé stable.
  ℹ️ **Moins urgent depuis la FSM, et l'argument compte** : les gardes migrés décident sur la
  PHASE, qui est parfaitement observable en test — c'est ce qui a permis d'épingler la panne
  silencieuse sans jamais reproduire la nullification de `_id`.
- [ ] **Fidélité du mock : `open` des connexions est inscriptible** `[S]`
  `peerjsMockFidelity.descriptors.test.js` couvre les **sept accesseurs du `Peer`**. Les
  connexions (`DataConnection`, `MediaConnection`) exposent aussi `open` en lecture seule dans
  la vraie lib, et le mock le laisse inscriptible — 12 sites de test s'appuient sur
  `conn.open = true`. Aucun code de production n'y écrit aujourd'hui (vérifié au grep), donc la
  classe de bug est fermée côté production ; l'étendre demande un verbe de mock et la reprise
  des 12 sites.
- [ ] 🟢 **`sendData` ne contrôle pas la taille sur ses deux branches star** `[S]` — trouvé le
  29/08/2026 en écrivant `usePeerTransport.star.test.js`, où l'état actuel est **épinglé**.

  La branche mesh appelle `isPayloadWithinLimit` avant sa boucle ; ni la branche hub ni la branche
  client ne contrôlent quoi que ce soit. Même appel d'API, comportement différent selon la topologie.

  **Ce n'est pas une brèche, et c'est ce qui rend l'arbitrage possible** : `[Recv]`
  (`createPeerContext`) mesure chaque trame **avant** que l'orchestrateur ne déballe l'enveloppe
  star. Un payload hors limite est donc jeté à l'arrivée — le coût réel est un envoi de canal
  gaspillé, pas une amplification. À trancher :

  - **combler** — un `isPayloadWithinLimit` en tête de la branche star. Coût : une sérialisation par
    envoi sur le chemin chaud du hub, qui relaie déjà à N destinataires ;
  - **assumer** — écrire la décision et garder les deux cas épinglés comme sa trace.

  ⚠️ Les deux cas `[épinglé]` de `usePeerTransport.star.test.js` **rougiront** le jour où ce sera
  comblé : c'est le signal voulu. Les mettre à jour, jamais les supprimer.

- [ ] 🟠 **Le fichier concentre sept responsabilités, et l'item (a) veut lui en ajouter** `[L]` —
  relevé le 29/08/2026 au point d'étape QA. **Pas une action : un seuil, et une question à poser
  avant (a).**

  Mesuré : **797 → 1889 lignes du 13/08 au 29/08**, 25 fonctions. C'est le plus gros fichier du
  module et de loin — `createPeerContext` vient ensuite à 934. Ce qu'il porte :

  | Responsabilité | Ce qui l'a amenée |
  |---|---|
  | singleton `Peer` + cycle de vie (`peerPhase`, garde d'instance, `PEER_OPEN_TIMEOUT_MS`) | FSM du 29/08 |
  | rafraîchissement du credential TURN | 26/08 |
  | rafraîchissement de l'attestation | 29/08 |
  | admission entrante (garde, corroboration, `_settleAdmission`, `_concludeIncoming`) | mai → 29/08 |
  | dispatchers `connection` / `call` + registre de contextes | origine |
  | routage star (`forwardStarMessage`, plafonds du hub) | origine |
  | `sendData` et sa décision de topologie | origine |

  **Ce n'est pas de la rustine** — chaque bloc est composé, commenté et testé, et la densité de
  commentaires du fichier est de 52 %, donc ~900 lignes de code réel. C'est de la **concentration**,
  et elle a une conséquence datable : l'item **(a)** du routage star y fait descendre le déballage
  d'enveloppe. Le fichier grossit dans le même geste qui rétrécit l'orchestrateur.

  La question à trancher **avant** (a), et pas après : le **cycle de vie du `Peer`** (singleton +
  ICE + attestation, ≈400 lignes contiguës et sans lien avec le routage) est le candidat naturel à
  l'extraction, et il est **indépendant** de (a) — les deux passes ne se gênent pas, l'ordre est
  libre. Le faire d'abord garde le fichier sous les 1500 lignes pendant que (a) le complète.

  ✅ **Question posée et tranchée le 29/08/2026 — sortie D : on n'extrait pas maintenant.** Trois
  raisons, dans l'ordre de poids : (a) n'a ajouté que **+43 lignes nettes, dont 11 seulement de
  code** (le fichier est à 1949) — aucun seuil n'est franchi ; la contre-indication écrite quatre
  lignes plus bas s'applique telle quelle (« ce qui justifierait l'extraction, c'est un second consommateur ou
  une passe qui touche au cycle de vie — pas le nombre de lignes tout seul ») ; et la passe qui
  aurait justifié l'extraction, la FSM du cycle de vie, **vient d'être fermée** le même jour.

  **Le déclencheur, pour que la décision ne soit pas un simple report** : la PROCHAINE passe qui
  touche au cycle de vie extrait — ou le franchissement des **2000 lignes**, quelle qu'en soit la
  cause. En dessous, ce seuil ne se rouvre pas.

  ⚠️ **Ne pas extraire l'admission entrante** : elle lit le registre de contextes, le store et la
  `metadata` de la connexion dans le même souffle, et c'est un chemin de sécurité — la déplacer
  coûterait la relecture des quatre issues de corroboration pour un gain de lignes.
  ℹ️ Contre-indication générale, la même que pour (b) du routage star : **ne pas bâtir l'abstraction
  d'avance**. Ce qui justifierait l'extraction, c'est un second consommateur ou une passe qui touche
  au cycle de vie — pas le nombre de lignes tout seul.

---

## Chaîne de présence — ce qui reste en amont du bail

> Trouvés en posant **le bail des peerId** (livré le 26/08/2026), qui les rend non fatals sans les
> corriger : un mapping périmé n'est plus composé, mais une composition de room perdue reste perdue.
> D'où des items séparés — mélanger deux mécanismes dans une même passe rendrait indécidable lequel
> a fait le travail.
>
> **Quatre verrous sont fermés** : `syncUsersConnections` coalesce au lieu de jeter la composition
> reçue (27/08), le tour sur liste vide purge sans déclarer la présence connue (27/08), le fan-out
> réconcilie au lieu de differ (28/08), et **la perte d'une connexion est devenue un second
> déclencheur de composition** (28/08) — celui qui ferme le cas où aucun tour de présence n'a lieu.
> Les quatre invariants vivent dans
> [architecture.md § Conventions de code](../docs/modules/webrtc2/architecture.md#conventions-de-code).
> Ce qui suit ne s'en déduit pas : un tour qui a bien lieu peut encore ne rien voir.
- [x] **Le diff de présence est aveugle à un pair parti et revenu entre deux instantanés** `[M]` —
  fermé le 28/08/2026, mais **pas par le mécanisme que cet item nommait**, et c'est le résultat
  principal. Trois réfutations, consignées pour que personne ne les re-dérive :
  1. **le « même flush Vue » n'existe pas** — pusher-js émet un événement par frame
     (`pusher.ts:110-118`, `presence_channel.ts:74-95`), Echo les mappe 1:1, une frame WebSocket est
     une tâche et un flush `'pre'` est une microtâche : il est drainé entre deux frames ;
  2. **réfutation décisive, côté serveur** — Reverb supprime l'un des deux événements dès qu'ils se
     chevauchent (`InteractsWithPresenceChannels::userIsSubscribed` : pas de `member_added` si déjà
     abonné, pas de `member_removed` s'il reste une connexion). Un rechargement produit donc soit
     `(remove, add)` en deux frames — traité correctement — soit **rien du tout** ;
  3. **la branche coalescente de `syncUsersConnections` n'a aucun chemin d'entrée** — en régime
     établi un tour est borné aux microtâches, et la seule fenêtre large (`waitForMeReady` pendant)
     est celle où le diff n'a **rien** écrit, donc où `remotePeers` est vide et où personne n'est
     perdu. `lastLocalPeerId` ne tombe que quand le dernier consommateur se démonte.

  Les deux mécanismes qui produisaient réellement le dommage — **(a)** coupure de présence au
  reconnect Echo, `here()` rejoué avec la liste complète ; **(b)** rechargement chevauchant, zéro
  événement de présence — et la correction (« le fan-out réconcilie, il ne diffe pas ») sont dans
  [architecture.md](../docs/modules/webrtc2/architecture.md#conventions-de-code). ⚠️ Le cas **(b)**
  n'est réparé qu'au **prochain** tour de présence, quel qu'en soit le motif : aucun tour n'a lieu au
  moment du rechargement, donc aucune correction fondée sur la présence ne peut faire mieux. Le
  déclencheur structurellement juste serait la **fermeture de connexion** — item ci-dessous,
  **fermé le 28/08/2026**, ce qui clôt (b) du même geste.
- [x] **Re-composer sur fermeture de connexion, pas seulement sur tour de présence** `[M]` —
  **fermé le 28/08/2026.** `handleClose` publie `ctx.connectionLostSignal`, `useConnectionPool`
  l'observe : troisième « signal réactif de communication inverse », sur le motif exact de
  `peerUnavailableSignal`. Les cinq gardes et les deux décisions écartées vivent dans
  [architecture.md § Conventions de code](../docs/modules/webrtc2/architecture.md#conventions-de-code) ;
  la séparation perte / départ dans
  [§ Départ d'un pair](../docs/modules/webrtc2/architecture.md#départ-dun-pair--un-fait-métier-deux-transports).

  **Ce que la passe a RÉFUTÉ dans l'énoncé ci-dessus, et qui a rendu la tâche plus simple que
  prévu** — à ne pas re-dériver :

  1. **« le point d'entrée unique d'une disparition de pair est `handleRemoteDeparture` » est faux
     pour ce déclencheur.** Le wrap de `usePeerOrchestrator` (`:196-214`) n'existe que pour
     `type === 'stream'` et n'y route que les fermetures **entrantes** (`senderSlug !== mySlug`).
     Or ce qui tombe chez un diffuseur quand son pair recharge est sa connexion **sortante** —
     explicitement exclue ; et `data`/`visio` n'ont aucun chemin fermeture → départ. Le seul point
     d'entrée universel est `createPeerContext.handleClose`, un étage plus bas. Il n'y avait donc
     **aucune frontière de couche à traverser**, et le `try/catch` avaleur de `handleRemoteDeparture`
     n'était pas en jeu : une perte n'est pas un départ.
  2. **`hasPendingRetry` n'est pas qu'un anti-boucle, c'est le garde qui empêche de parler trop
     tôt** — et il a été retiré puis remis. Un rechargement dure une seconde pendant laquelle
     personne ne répond : composer alors pose un `waiting` de `SIGNALING_STALE_MS` qui **muselle la
     demande suivante**, y compris celle du tour de présence quand le pair est enfin là. Mesuré : sans
     lui, le scénario voisin « A recharge sans que B voie son départ » passe au rouge. Ce déclencheur
     ne vise donc **que le régime établi**, seul état où plus aucun moteur ne veille.
  3. **Le premier scénario écrit était vert pour la mauvaise raison** : il provoquait la perte juste
     après l'établissement, donc alors qu'une chaîne veillait encore (elle ne s'éteint qu'à son
     réveil, ≤ 1299 ms). Il a fallu une **attente réelle** de 1,5 s — `settle()` ne draine pas les
     minuteurs et `useFakeTimers` gèlerait le faux serveur. Le piège complet est dans
     [tests.md](../docs/modules/webrtc2/tests.md).
  4. **Écarté, et à ne pas rouvrir** : invalider le mapping peerId directement sur la fermeture pour
     économiser l'aller-retour mort. Une fermeture ne prouve pas que le peerId est mort, et
     `getRemotePeerId` est la source **anti-usurpation** du chemin (b) de `_isAuthorizedIncomingPeer`.
     La chaîne existante (`peer-unavailable` → `invalidateRemotePeerId` → watcher voisin) fait le
     travail sans toucher à un chemin de sécurité.
  5. **Un garde retiré parce qu'aucune contre-épreuve ne pouvait le faire rougir** : `isValidSlug`,
     déjà porté par `isAuthorizedPeer` en première ligne. Les quatre autres ont chacun été vus rouges,
     un par un.
- [x] **`roomMembers` n'a pas de contrat de fraîcheur** `[M]` — **fermé le 29/08/2026, et pas par le
  mécanisme que cet item cherchait.** Ce n'était pas un contrat de fraîcheur, c'était un contrat de
  **propriété** : *une entrée n'existe que tant que son auteur est vivant et détenteur de son
  `contextId`*. Deux règles, sur deux mécanismes qui existaient déjà — un contexte en arrêt n'écrit
  pas (`ctx.isShuttingDown` après la barrière `waitForMeReady`), seul le détenteur enregistré efface
  (`clearRoomMembers(contextId, owner)`, jumeau du garde de `unregisterContext`). Sous ces règles,
  toute entrée présente est le témoignage courant d'un contexte vivant : `isUserInAnyRoom` et
  `getRoomMembers` **n'ont pas été touchés**. La règle, les trois pistes écartées et la fenêtre
  assumée vivent dans [securite.md](../docs/modules/webrtc2/securite.md).

  **Quatre réfutations de l'énoncé, à ne pas re-dériver :**

  1. **Une mise en sourdine passe d'abord par un vidage.** `useReverbChannel.leave()` fait
     `users.value = []` **avant** de révoquer son jeton → tour de présence vide → composition
     purgée. L'entrée d'un contexte muet est **vide**, pas périmée. Le « contexte monté devenu
     muet » que l'item cherchait n'épingle donc rien.
  2. **L'exemple qui portait l'énoncé est faux.** `roomMembers['data-app']` n'existe **jamais** :
     `Notifications.vue` appelle `useMediaBroadcast()` sans jamais appeler `watchUsers`, dont le
     seul appelant de production est `MediaBroadcastProvider`. Ce contexte n'a jamais pu opposer de
     veto. Trois commentaires de test l'affirmaient comme « configuration réelle » — rustine héritée
     du prédicat `connections` ; corrigés du même geste.
  3. **Pendant une coupure pusher — le seul chemin qui périme sans vider — le veto est le
     comportement CORRECT** : rien n'y prouve un départ, tous les contextes de la même source
     périment ensemble, et `here()` répare au ré-abonnement avec la liste complète.
  4. **Un `removeRemotePeerId` plus agressif serait une RÉGRESSION.** Supprimer l'entrée prive
     `getSlugByRemotePeerId` de sa corroboration : l'admission bascule de « refusée sur
     contradiction » à « non corroborée ». `securite.md` interdit déjà toute péremption sur cette
     lecture (« un contournement planifiable »).

  **Le défaut réel, absent de l'énoncé — l'entrée fantôme.** La barrière `waitForMeReady` dure
  jusqu'à 15 s et son `effectScope` est détaché : `destroy()` ne l'annule pas, et `getRoomUsersDiff`
  ne lisait aucun garde de teardown. Un tour parti avant l'ouverture du peer local reprend après le
  démontage et **ressuscite** l'entrée que `destroy()` vient de retirer — que plus rien ne retirera,
  `clearRoomMembers` n'ayant qu'un appelant, déjà passé. C'était le seul épinglage réellement
  permanent du module, atteignable par une navigation SPA, et sans aucun rapport avec la présence.
  Son jumeau fail-**closed** : le démontage d'un homonyme emportait l'allowlist du vivant, qui
  refusait alors toute connexion entrante du chemin (a) en silence et sans rattrapage.

  **Deux écarts de harnais fermés en chemin** : le double ne portait pas le garde de propriété (il
  aurait été plus permissif que la production sur un chemin de sécurité), et son `getRemotePeerId`
  rendait `null` là où le store rend `undefined` — sept assertions épinglaient la valeur du double.

  **Puis la CAUSE RACINE, fermée dans la foulée** — parce que le premier correctif gardait un
  consommateur et pas le mécanisme. `waitForMeReady` a **quatre** consommateurs de production, et
  aucun n'est inerte sur un contexte mort : `handleStreamReceived` repeuple `remoteStreamsMap` que
  `destroy()` vient de vider et peut créer un player DOM, `handleStreamRemoved` appelle
  `handleRemoteDeparture` (qui avale ses exceptions). `destroy()` résout désormais les attentes en
  vol à `false` — les quatre sortent par le `if (!ready) return` qu'ils écrivent déjà, et qui est
  déjà testé chez chacun. Le garde de `getRoomUsersDiff` reste, comme second mécanisme.

  ⚠️ **Une asymétrie assumée, à ne pas prendre pour un oubli** : `clearSignalQueueRoom` n'a PAS
  reçu le garde de propriété. Ce n'est pas un verbe de témoignage — il a deux autres appelants de
  production en pleine session — et la collision d'homonymes y coûte au plus un signal tamponné :
  `dispatchSignal` recrée la file si elle manque, et `signalSeq` n'est pas supprimé, donc pas de
  rewind. Idem pour `clearWaitingRemotePeerIdsForContext`, dont la collision coûte un aller-retour
  de signalisation. Mesuré, puis écarté comme disproportionné.
- [x] **Le client star compose son hub même absent de la room** `[S]` — **fermé le 28/08/2026**, sous
  tests verts, comme la simplification annoncée. La branche client est devenue la branche mesh
  filtrée : `targets.includes(hubSlug)`, avec le même `preserveRetry`. Le couplage annoncé s'est
  **vérifié** — rien n'aurait pu être resserré avant que le fan-out réconcilie. La règle, sa borne
  (chemin (a) de l'autorisation seulement) et le récit du couplage vivent dans
  [architecture.md § Conventions de code](../docs/modules/webrtc2/architecture.md#conventions-de-code).

  **Deux écarts avec l'énoncé ci-dessus, à ne pas re-dériver :**

  1. **`ctx.isHubConnected` n'a PAS été utilisé**, alors que l'item le nommait comme « existant déjà
     pour l'exprimer ». Il ne dit que la moitié du prédicat — l'appartenance, pas l'établissement —
     et la disait alors via un computed compensatoire qui rajoutait mon slug pour rien dans une
     branche où `hubSlug !== mySlug` par construction (ce computed a disparu depuis, avec le
     renommage plus bas). `targets`, déjà calculé quinze lignes plus haut, porte
     les deux moitiés sans ajouter de seconde source de vérité.
  2. **Un second défaut au même site d'appel, absent de l'énoncé** : la branche client était la
     dernière du fan-out à ne pas passer `preserveRetry`. Un tour de présence est l'appelant
     PÉRIODIQUE type, et `scheduleRetry(slug, 0, …)` commence par `clearRetry` : `attempt` repartait
     de zéro à chaque tour, donc l'horizon d'abandon de ≈55 s ne tombait jamais. Corrigé du même
     geste, épinglé à part.

  La réécriture prévue de « star : un client ne se connecte qu'au hub » était bien nécessaire, et le
  **contrôle négatif l'a confirmée load-bearing** : pré-semis de `remotePeers` retiré, le cas
  rougit — sans lui il aurait verdi par absence du hub dans `targets`, soit pour la raison inverse
  de ce qu'il épingle.
- [ ] **Un canal de présence mémoïsé peut rendre `users` définitivement vide** `[S]` — piège latent,
  **aucun consommateur vivant ne l'atteint aujourd'hui**, d'où l'effort `[S]` et pas de correction
  dans la passe où il a été trouvé (28/08/2026).
  `useReverbChannel.leave()` saute `Echo.leave()` quand un autre consommateur tient le même nom (le
  compteur de consommateurs, qui est là pour ça) — mais Echo mémoïse ses canaux, donc le canal pusher
  sous-jacent reste `subscribed: true`. Un consommateur qui se démonte puis se remonte sur ce nom
  re-branche son `here()` sur un canal qui ne ré-émettra **jamais** `subscription_succeeded` : son
  `users` reste à `[]` pour de bon, alors que `leave()` vient de le vider. `remotePeers` étant
  l'allowlist des deux gardes d'autorisation, le contexte n'admettrait plus personne.
  Non joignable aujourd'hui : `Exemples/Home.vue` est le seul consommateur de présence de son canal,
  et `Server.vue`, `Room.vue`, `ChatComponent.vue` utilisent des noms distincts. Le jour où deux
  composants partagent un nom de canal de **présence**, c'est joignable.

---

## Annonce de diffusion — les quatre chemins, et ce qui reste après eux

> ✅ **Les trois fenêtres sont fermées le 28/08/2026** par un QUATRIÈME chemin d'annonce : un
> whisper sur le canal de présence Reverb, seul porteur indépendant de la signalisation P2P. Les deux
> 🔴 de cette section sont tombés. Ce qui reste ici est le résidu d'AFFICHAGE et les bornes de
> déploiement — plus aucune fenêtre de porteur.
>
> ℹ️ S'y cumulait **une vignette jamais visible** — défaut de rendu à l'étage CSS, fermé le 28/08
> (item plus bas). C'est ce cumul qui a obligé la mesure à instrumenter le DOM et la géométrie plutôt
> que l'écran.

- [x] **Les trois fenêtres résiduelles** `[M]` — **fermées le 28/08/2026** par le whisper de présence
  (`useBroadcastPresence.announceBroadcastStateOnChannel` / `handleBroadcastStateWhisper`), quatrième
  chemin d'annonce. Les quatre chemins et leurs bornes :
  [flux.md](../docs/modules/webrtc2/flux.md#comment-un-arrivant-sait-qui-diffuse).

  **Ce que la fenêtre 3 avait appris, et qui reste vrai** : les trois premiers chemins partagent une
  limite structurelle — ils ne disent rien quand il n'y a rien à demander.
  `useConnectionPool.requestOrConnectPeer` (`:263-279`) lit `getDialableRemotePeerId(userSlug)` et,
  bail valide, appelle `connectToPeer` directement : **aucun POST, donc aucun porteur**. Mesuré,
  navigation SPA ordinaire dans le bail de ≈55 s : zéro POST après le retour sur deux runs,
  `t_vignette = 8 811 ms` puis **`null`**. Le whisper est le seul porteur indépendant de la
  signalisation P2P, et il ferme du même geste le client non-hub en star (fenêtre 2), qui ne demande
  jamais le peerId d'un diffuseur autre que le hub.

  Épinglé par `scenarios/lateJoiner.test.js` § « le peerId d'A est déjà connu sous bail », dont la
  contre-épreuve — mêmes coupures, sans canal fourni — **est** la mesure du 28/08 sous forme de test.

  **Vérifié à deux onglets le 28/08/2026**, même protocole que la mesure qui avait trouvé la
  fenêtre 3, sous contrôle positif (`Remote users : ["admin"]`, présence synchronisée) :

  | Ce qui est mesuré | Avant | Après |
  |---|---|---|
  | navigation SPA, bail chaud (`history.back()`) | **8 811 ms**, puis **jamais** | **71 ms** |
  | frame portant le fait | aucune | `client-webrtc2-broadcast-state`, **68 ms** |
  | attribution par Reverb | — | `"user_id":"2"` sur l'enveloppe |
  | coût du front une fois le fait reçu | 15 ms | **3 ms** |
  | contre-épreuve : personne ne diffuse, sondage 250 ms sur 5 s | 0 vignette | **0 vignette** (20 échantillons) |

  ⚠️ **Une passe « régime établi » ne suffit pas à prouver le porteur** — piège rencontré : à son
  retour, A **redemande** parfois le peerId de B (départ observé ⇒ bail purgé de son côté), et sa
  demande porte `isBroadcasting`. Premier run : 6 POST à +133 ms. La passe décisive coupe donc
  `/ask-to-peer-id` **chez A** juste avant le retour — plus aucun `PEER_CONNECTION_REQUEST` n'atteint
  B, et A ne peut plus ni l'appeler ni lui ouvrir de canal. Le whisper arrive alors à 68 ms, la
  vignette à 71 ms, et le premier POST résiduel à **131 ms** — soit 60 ms *après* la vignette.

  ⚠️ **Le correctif écarté reste écarté** : forcer un POST à chaque tour rouvrirait « le client star
  compose son hub même absent de la room » et son plafond de cadence. Rien n'a été ajouté à la
  signalisation.

  **Trois choses apprises en le posant**, toutes vérifiées et toutes contre-intuitives :
  1. **`accept_client_events_from` absent de `config/reverb.php` vaut `'all'`, pas `'members'`** —
     `ConfigApplicationProvider` lit `?? 'all'`, à l'inverse du défaut du template. Sous `'all'`,
     Reverb ne contrôle **aucune** appartenance au canal (`EventDispatcher` publie sur le canal nommé
     par l'émetteur) et retransmet l'enveloppe brute, `user_id` forgeable compris. C'était l'état de
     l'hôte : le porteur invoqué par l'arbitrage n'existait pas. Corrigé côté projet, et consigné
     dans [le `work/` de l'hôte](../../../../work/deploiement-tiers.md).
  2. **Une course réelle entre l'annonce et l'annuaire** : le diffuseur re-annonce dès qu'il voit
     l'arrivant, or un client event ne se rejoue pas — si l'arrivant ne peut pas encore traduire le
     `user_id`, le fait est perdu **définitivement**. D'où `_rebuildSlugDirectory` écrit **devant** la
     barrière `waitForMeReady`, seule écriture de ce tour à la précéder. Elle ne concède rien : la
     garde d'affichage est l'intersection de `useAwaitedStreams` avec `remotePeers`, qui reste
     derrière.
  3. **`stopListeningForWhisper(event)` emportait les handlers de TOUS les consommateurs du canal** —
     même défaut de classe que `Echo.leave()`, un étage plus bas, et joignable dès qu'une page monte
     deux providers sur un canal (`Exemples/Home.vue` en monte trois). `useReverbChannel` désabonne
     désormais par callback, repli nu conservé pour `useChatSimple`.

  **Ce qui reste, et n'est plus une fenêtre de porteur** : le fait arrive avant que la vignette
  puisse s'afficher, parce que `awaitedPeers` intersecte `remotePeers` — écrit derrière
  `waitForMeReady`, mesuré à 592 ms. Borne d'affichage, pas d'annonce. La fermer voudrait dire
  toucher à l'intersection, ce qui rouvrirait les vignettes fantômes de pairs déjà partis : **non
  souhaitable, décision assumée.**

- [x] 🔴 **La vignette n'est JAMAIS visible : `.draggable-video` sans `<video>` s'effondre à 0 px**
  `[S]` — **fermé le 28/08/2026.** Un enfant unique en `position:absolute` ne contribue pas à la
  hauteur du parent : le cadre valait 0 px, `.video-loading` (`inset:0`) avec lui, et le label
  débordait dans le `.col.overflow-hidden` qui le clippait.

  Correctif : une classe d'intention `.video-awaited` sur le seul site sans `<video>`
  (`StreamSimpleUI.vue:42`), et dans `_socializer.scss` le gabarit de la règle `video` voisine
  (`width:100%; aspect-ratio:16/9`) — donc la vignette occupe déjà la place du flux, sans saut de
  mise en page à l'arrivée. Les players réels ne portent pas la classe : par construction, aucun
  effet sur eux. **Aucun `_variables.scss` n'a été nécessaire** — le couplage que cet item annonçait
  avec [sass-todo.md](sass-todo.md) n'existait pas, `aspect-ratio` ne demande aucune valeur en dur.

  ⚠️ **Piège de vérification à retenir** : `isVisible()` de Playwright rend **`true`** (boîte non
  vide, `visibility:visible`, `opacity:1`) — il ne teste pas le clipping par un ancêtre. Un test qui
  s'y fierait serait vert sur une vignette invisible. Ce qui tranche, c'est la géométrie comparée à
  celle de l'ancêtre, ou une capture d'écran relue.

  Vérifié sur la **CSS réellement compilée** (chaîne `app.scss` entière, viewport 1440×1000) dans un
  harnais reproduisant la chaîne d'ancêtres, à deux runs — contrôle sans la classe, puis avec :
  0 px → 391 px, label clippé → label centré dans le parent, captures relues. Le contrôle n'est pas
  décoratif : le **premier** harnais donnait la même valeur aux deux runs parce que `setContent()`
  part de `about:blank` et n'y charge aucun `<link href="file://">`. Sans run de contrôle, « h=51 dans
  les deux cas » se lisait comme « le correctif ne sert à rien » sur une page **sans aucune CSS**.
  Ce que le harnais ne couvre pas — que `awaitedPeers` rende bien un nœud — est ce que la mesure à
  deux onglets du 28/08 avait déjà établi (nœud DOM à 607 ms).

  ✅ **Épinglé le 30/08/2026, par ses deux moitiés — l'item n'est PAS rouvert.** Contrat DOM :
  `StreamSimpleUI.awaited.test.js` (la classe d'intention `.video-awaited`, l'absence de `<video>`,
  l'asymétrie avec `MediaBroadcastPlayer` épinglée des deux côtés, la règle SCSS encore présente).
  Géométrie : `tests/visual/check-awaited-thumbnail.mjs`, **à la main, sortie D** — `happy-dom` ne
  calcule aucune mise en page, la case ne sera jamais cochable dans la suite. Le harnais porte le
  sujet et le contrôle dans la même page et deux canaris de cascade ; mesuré le 30/08, le contrôle
  s'effondre à **0 px exactement**.

  ⚠️ **Les ~391 px ci-dessus ne sont pas un seuil réutilisable.** La largeur du conteneur de page
  est un réglage (`layout_class_container` par route, à défaut
  `config('estarter.bootstrap_container_type')` — `container-fluid` ici, `container` par défaut dans
  le paquet), donc toute cote absolue est vraie d'une configuration et fausse de l'autre. Le harnais
  mesure aux deux largeurs et n'asserte que ce qui n'en dépend pas. Arbitrage complet et bornes
  assumées : [webrtc2-tests-plan.md](webrtc2-tests-plan.md), tâche 8.

- [x] **Vérifier à la main que la vignette arrive tôt** `[S]` — **fait le 28/08/2026**, et le résultat
  n'est pas celui attendu : le correctif `10d634f` fonctionne, l'UI ne le montre pas, et le cas
  majoritaire n'est pas couvert. Les deux découvertes ont leurs items ci-dessus (fenêtre 3, rendu).

  Ce que la mesure a établi, chiffres relevés sur l'onglet de l'arrivant :

  | Ce qui est mesuré | Valeur |
  |---|---|
  | frame Reverb portant `isBroadcasting:true` (`.ResponseToPeerID`) | **592 ms** |
  | `announcedStreamsMap` peuplée **et** nœud DOM rendu | **607 ms** |
  | coût du front une fois le fait reçu | **15 ms** |
  | contre-épreuve : personne ne diffuse, sondage 250 ms sur 5 s | **0 vignette** |
  | navigation SPA, bail de peerId chaud | **8 811 ms**, puis **jamais** (2ᵉ run) |

  **Verdict sur `10d634f` : positif.** Le champ est sur le fil (frame brute capturée,
  `private-App.Models.User.35`), il arrive en 592 ms, et le front le rend en 15 ms. La contre-épreuve
  du 13/08 tient — et elle tient **sous contrôle positif**, ce qui est le point de méthode à garder :
  sans vérifier d'abord que B voit `["admin"]` dans `remotePeers` et que la présence est abonnée,
  « aucune vignette » aurait été vert par panne de présence, pas par correction.

  Trois pièges de harnais mesurés, à ne pas re-payer :
  - **`waitForSelector` sur un sélecteur filtré par texte (`:has-text`) a coûté 442 ms de latence
    propre** là où un sondage `evaluate` à 50 ms donne 15 ms. Le premier chiffre a failli être
    consigné comme un coût de l'application. Chronométrer par sondage, jamais par `waitForSelector`.
  - **`a[href="/app"]` (« Vue ready ») est une ancre simple, pas un `RouterLink`** : cliquer dessus
    provoque un vrai chargement de document et fait retomber la mesure sur le cas « premier
    chargement ». Pour une navigation SPA de retour, `history.back()` (popstate → vue-router).
  - **Le bac à sable sert par le dev server Vite** (`public/hot` présent), donc le working tree, et
    **pas** `public/build` — qui a 28 h de retard sur `10d634f` et ne contient pas
    `noteBroadcastFromSignal`. Aucun build n'est requis, mais si `public/hot` disparaît la mesure
    tourne en silence sur le code d'avant le correctif. `.env` non touché de bout en bout
    (horodatage relevé avant/après), suite JS verte après coup (52 fichiers, 940 tests).

---

## usePeerConnections

- [x] **`usersInRoom` : sémantique trompeuse (filtrage prématuré)** `[M]` — **fermé le 28/08/2026**,
  sous tests verts. `connection.remotePeers` remplace `usersInRoom` **partout**, y compris sur la
  surface publique (`api.remotePeers`) et dans les consts locales des trois fonctions de garde.
  Le nom vit dans [architecture.md](../docs/modules/webrtc2/architecture.md) et
  [securite.md](../docs/modules/webrtc2/securite.md) ; ce qui suit est ce que la passe a appris et
  qui ne se déduit ni du diff ni de l'énoncé.

  **Trois écarts avec l'énoncé ci-dessus, à ne pas re-dériver :**

  1. **La « liste neutre complète » n'a pas été exposée, et ne doit pas l'être.** L'énoncé prévoyait
     de garder `usersInRoom = [...remotePeers, mySlug]`. Mesuré : **aucun lecteur ne la voulait** —
     ni les trois `forEach` de l'orchestrateur, ni `useAwaitedStreams`, ni `StreamSimpleUI`. Elle
     n'aurait pas *supprimé* le computed compensatoire, elle lui aurait donné le nom qui signifiait
     jusque-là le contraire : même nom, sens inversé, zéro consommateur — le pire cas d'un
     renommage, parce qu'il ne lève aucune erreur.
  2. **`allUsersInRoom` n'avait qu'un seul lecteur réel, `isHubConnected`.** Il était bien destructuré
     par `useMediaBroadcast`, mais jamais ré-exporté ni utilisé. Le prédicat s'écrit maintenant en
     deux termes explicites — le hub est moi, ou le hub est dans `remotePeers` — ce qui a rendu le
     computed supprimable, pas seulement renommable.
  3. **Le filtre `!== mySlug` « à appliquer explicitement dans la logique de connexion » est devenu
     sans objet** : la liste ne me contient plus par construction, elle ne l'a d'ailleurs jamais fait.
     C'était le nom qui suggérait qu'un filtre manquait quelque part.

  **Le mode de panne de cette passe était silencieux**, et c'est le fait le plus réutilisable :
  `connection` est un `reactive` à spread d'overrides et les deux gardes lisent
  `Array.isArray(…) ? … : []`. Un site de test oublié n'aurait donc **pas** échoué — il aurait écrit
  une propriété orpheline, la garde aurait lu `[]`, et le verdict aurait basculé vers « refusé »,
  que la moitié des tests d'autorisation attend déjà. Parade employée : un accesseur jetant sur
  l'ancien nom, posé dans `createPeerContext` **et** `createMockContext` le temps de la migration,
  retiré avant le commit. À reprendre pour tout renommage d'un champ de `connection`.

  ⚠️ **La mention « le prédicat prévu en A2 de l'audit sécurité » était une référence pendante** :
  `securite.md` ne porte plus de section numérotée, et ce prédicat est **livré** depuis, sous la
  forme de `utils/isAuthorizedPeer.js`.
- [x] **Migrer `remotePeers` vers Pinia** `[M]` — **fermé le 29/08/2026**, sous tests verts
  (983 → 1015 cas). `roomMembers[contextId]` est la source unique ; `ctx.connection.remotePeers` est
  devenu un **accesseur en lecture seule** au-dessus d'elle, donc les ~25 lectures de production et
  les ~55 semis sur double n'ont pas bougé. L'écrivain de production est `peerStore.computeRoomDiff`,
  et `_diffLock` est parti. Le contrat, ses deux lecteurs de nature différente et l'invariant de
  réaffectation vivent dans
  [architecture.md](../docs/modules/webrtc2/architecture.md#propriétaires-uniques) ; le versant
  harnais dans [tests.md](../docs/modules/webrtc2/tests.md).

  **Quatre écarts avec l'énoncé ci-dessus, à ne pas re-dériver :**

  1. **« lecture + écriture atomique » était faux, et c'était la justification affichée.** Le couple
     lecture-puis-écriture n'a jamais eu de point de suspension entre ses deux moitiés — l'unique
     `await` de la fonction précède la lecture —, donc aucun TOCTOU n'y était possible et `_diffLock`
     n'a jamais rien gardé. Ce que la migration apporte est **un seul chemin d'écriture** vers
     l'allowlist, la valeur précédente étant lue là où la nouvelle est écrite. Rester synchrone est
     en revanche un vrai invariant, épinglé sans `await` : rendre l'action asynchrone fait rougir
     12 cas.
  2. **« rendrait la liste réactive dans les composants » : elle l'était déjà.** `connection` est un
     `reactive` et l'écriture était une réaffectation, donc `api.remotePeers` s'invalidait. Le gain
     réel est ailleurs : un domicile unique, et la composition lisible depuis le store sans `ctx`.
  3. **Les deux tests qui visaient le mutex n'étaient pas porteurs.** Celui qui affirmait « sans le
     mutex, les deux appels liraient le même `previousSlugs` vide » était vert par symétrie de
     microtâches et n'a pas rougi à son retrait ; ne pas le réécrire en test de FIFO, l'ordre étant
     garanti un étage au-dessus par le drain de `syncUsersConnections`. Les deux ont été remplacés
     par le seul énoncé qui survive et puisse rougir : un tour qui lève ne laisse pas la composition
     à moitié écrite.
  4. **La parade est devenue permanente au lieu d'être jetable.** La passe de renommage avait posé un
     accesseur jetant, retiré avant commit ; ici l'absence de setter en production **est** la parade
     (une écriture lève un `TypeError`), et `roomMembersSourceOfTruth.test.js` la fige avec ce qui
     ferme le seul risque du setter conservé dans le double : un grep sur les sources de production
     vérifiant qu'aucune n'assigne ni ne mute ce champ — la forme exacte de la panne de `Peer.id`,
     traitée à la source plutôt qu'en durcissant le double.

  ℹ️ **Deux constats de méthode, mesurés :** le seul mode de panne réellement silencieux était
  l'override `connection: { remotePeers }` du double, qui arrivait **après** l'accesseur par le
  spread et l'écrasait sans rien casser (clé extraite avant le spread, plus un garde structurel) ;
  et la réactivité de `_roomMembers` dans le double n'était exigée par **aucun** test existant — le
  proxy de `connection` déclenche même sur un index nu. Ce qu'un index nu casse est le chemin de
  production, que plus aucun test ne voyait depuis que la production a cessé d'écrire là. Le cas qui
  le prouve a été écrit et **vu rouge** avant d'être vert.
- [x] **`getNewUsersInRoom` est un export mort** `[S]` — **fermé le 28/08/2026, sortie B** : la
  fonction (un simple `await getRoomUsersDiff(users)` dont on ne garde que `newUsers`), son export
  et son unique test sont supprimés. Aucun appelant de production ne le lisait, dans le paquet
  comme dans l'hôte, donc rien d'observable n'a changé — un test de moins, et c'était le bon.
  ℹ️ **Ce qui cadrait la migration Pinia, et qui est fait depuis (29/08/2026)** : la duplication
  entre `ctx.connection.remotePeers` et sa projection `peerStore.roomMembers[contextId]` était
  assumée « tant que les deux écritures restent dans la même fonction ». `roomMembers` est
  maintenant la source et le miroir a disparu — sans troisième état.

---

## Sécurité — fermer le chemin (a), et ça se joue au backend

- [x] **L'identité déclarée du chemin (a) n'est corroborée par rien** `[L]` — **fermé le
  29/08/2026, sortie A**, par une **attestation signée portée par la `metadata`**. Le serveur signe
  `{peerId, slug, exp}` en HMAC-SHA256, le slug venant d'`Auth::user()` ; le porteur la transporte,
  le récepteur la fait vérifier. Décisions, schéma et bornes :
  [securite.md](../docs/modules/webrtc2/securite.md#lattestation-didentité--ce-qui-ferme-le-chemin-a).

  **L'énoncé proposait deux voies, et la passe a écarté les deux.**

  - **La voie 1 (annuaire) portait une course que l'énoncé ne voyait pas.** Sur le chemin présence,
    celui qui **ouvre** est celui qui a demandé — et `/ask-to-peer-id` **ne porte aucun peerId**.
    Son peerId peut n'avoir jamais atteint le backend quand sa connexion arrive : l'autorité
    répondrait « inconnu », qui n'est pas « non » mais « pas encore ». L'annuaire exigeait donc *en
    plus* une route de déclaration et un rafraîchissement de TTL — tout le coût, plus la course.
  - **Le raccourci tentant était un piège.** Relayer le peerId sur `.AskToPeerID` pour écrire
    `addRemotePeerId` remettait en service l'auto-inscription fermée par `authorizedCallPeers` ; et
    un peerId **auto-déclaré** est revendicable par deux personnes, donc empoisonnable en
    fail-closed (mallory revendique l'id d'alice, alice est refusée).
  - **La voie 2 était la bonne, à la couche près.** « Le backend l'émet et le signe » se fait
    **dans le paquet** : le client tirait déjà son UUID lui-même (`crypto.randomUUID()` dans
    `_doInit`, posé pour supprimer le peerId fantôme), donc il peut le faire attester **avant**
    `new Peer` — en parallèle de l'ICE, sans aucune fenêtre. Ce que l'énoncé plaçait hors du paquet
    est la seule moitié restante : que le serveur PeerJS **valide** l'inscription d'un id.

  **Trois choses que la passe a apprises, et qu'aucune ne figurait dans l'énoncé :**

  1. **Dans un échange mesh ordinaire, l'attestation ne sert à rien** — le mapping `slug → peerId`
     corrobore déjà. Mesuré : retirer son transport dans la `metadata` ne fait rougir qu'**un** cas,
     l'arrivant tardif. C'est structurellement le seul, et c'est celui pour lequel tout ceci existe
     (`incomingMappingInvariant.test.js` l'avait caractérisé un mois plus tôt).
  2. **Le verdict devait aller dans un registre DISTINCT du mapping.** Le verser dans
     `remotePeersId` aurait fait d'un pair attesté un interlocuteur d'appel vérifié sans qu'aucun
     appel n'ait été autorisé — la faille de mai, par une autre porte. Épinglé au grep.
  3. **Un vérificateur muet doit valoir ADMISSION, même sous `enforce`.** Sans la distinction
     refus / ignorance, rendre la route injoignable suffirait à fermer toutes les rooms.

  **Le harnais a menti deux fois, et les deux corrections comptent** : `createVirtualPeer` imposait
  un peerId à l'`'open'` **après** l'attestation, ce que la production ne fait jamais (elle reçoit
  l'id qu'elle a fourni) — tout pair de scénario portait donc une attestation périmée ; et les
  assertions du scénario portaient d'abord sur `getConnections`, qui ne contient **que les
  connexions sortantes** — trois cas de refus passaient sans rien prouver.

  ⚠️ **Reste ouvert, et c'est une borne assumée, pas un oubli** : le **rejeu** d'une attestation
  dont l'UUID a été repris après `alive_timeout`, borné par le seul `attestation.ttl` (5 min) — sa
  fermeture appartient au serveur PeerJS, hors paquet. Et `enforce` est **faux par défaut** : tant
  qu'un déploiement ne l'a pas activé, le garde compte au lieu de refuser. C'est l'ordre des
  opérations, pas une timidité — un refus entrant n'est jamais rattrapable, donc la mesure
  (`peerStore.uncorroboratedAdmissions`) précède la coupure.

- [x] **La mesure qui décide de la bascule d'`enforce` n'est observable NULLE PART** `[S]` —
  **fermé le 29/08/2026, sortie A.** Un `Log::warning` sur le verdict `null` de
  `verifyPeerAttestation`, trois compteurs rendus par `Debug.vue`, et la procédure de bascule écrite
  avec ses termes : [securite.md § « Ce qu'il faut regarder pour basculer
  `enforce` »](../docs/modules/webrtc2/securite.md#ce-quil-faut-regarder-pour-basculer-enforce).

  **L'énoncé disait « c'est la moitié serveur qui tranche ». C'est faux, et la mesure l'a montré
  avant le premier commit.** Un pair qui ne présente AUCUNE attestation — l'onglet resté sur un
  bundle antérieur, c'est-à-dire le risque même pour lequel `enforce` est faux — n'appelle jamais la
  route : `_admitIncoming` court-circuite sur `nothingToAsk`. Le journal serveur est donc
  structurellement aveugle au cas MAJORITAIRE de la phase d'observation. C'était déjà épinglé
  (`incomingAuth.test.js`, « REFUSE sous `enforce` un pair qui ne présente aucune attestation »,
  asserte zéro vérification) sans que la conséquence sur la mesure ait été tirée. La moitié client
  n'était donc pas le parent pauvre de l'item : sans elle, un journal muet ne veut rien dire.

  **Trois compteurs et non deux, et le troisième est celui qui n'était pas demandé.**
  `uncorroboratedAdmissions` (la décision : combien seraient refusés maintenant),
  `unattestedAdmissions` (son SOUS-ENSEMBLE, l'angle mort du serveur — un déploiement le vide, pas
  une enquête) et `unverifiableAdmissions` (serveur muet, disjoint, fail-open). Le second sépare
  deux populations que le même chiffre confondait et qui appellent des décisions **opposées** : une
  forge s'enquête, un onglet ancien s'attend.

  **La borne assumée, et elle est le prix de la sortie A** : le terme 2 n'est mesurable sur aucun
  serveur. Il ne s'établit que par un argument de déploiement (durée de vie d'onglet vs actifs
  hachés par Vite) corroboré par un échantillon au panneau. Écrit comme tel dans `securite.md`,
  plutôt que masqué derrière un chiffre unique — lequel n'existe pas : les deux moitiés n'ont aucun
  dénominateur commun, et en fabriquer un donnerait un nombre sur la mauvaise population.

  **Ce que la passe a appris en plus :** un `Log::spy()` répété est un **no-op silencieux**
  (`Facade::spy()` ne remplace que si la façade n'est pas déjà doublée), donc un helper qui
  re-double à chaque cas compte tous les précédents ; et le slug revendiqué est **choisi par
  l'appelant** tant que `hash_equals` n'est pas passé, ce qui place la frontière du journal à une
  ligne précise de la méthode et non à son bord — sans quoi un inconnu écrirait au journal le nom de
  qui il veut.

- [x] 🔴 **`/attest-peer-id` bouclait le rechargement de la page de login pour tout invité** `[S]` —
  **trouvé et fermé le 29/08/2026**, en allant simplement REGARDER le panneau que l'item ci-dessus
  venait d'ajouter. Il affichait « Mon attestation : absente » ; la trace disait 401.

  La chaîne : la coquille SPA est publique, `Notifications.vue` y monte `data-app` avant tout login,
  `_doInit` demande son attestation → route derrière `auth` → **401** → `AjaxService.load` fait
  `document.location.reload()` → recharge → redemande. **Mesuré sur `/identification` : 168
  navigations du frame principal en 20 s, 55 requêtes.** Personne ne pouvait se connecter. Après
  correction : **3 navigations, 1 requête**.

  **C'est mot pour mot la panne contre laquelle le docblock de `getIceServers` avait été écrit** —
  et `attestPeerId` s'en était dispensée sur une prémisse fausse : « un invité n'a pas d'identité à
  faire attester » est vrai de l'utilisateur, faux de son NAVIGATEUR. Le test
  `un_invite_n_atteint_pas_la_route` **épinglait le bug** : son commentaire citait `/get-ice-servers`
  et sa coquille publique, puis concluait l'inverse. Un test peut garder un défaut.

  ⚠️ **Trois choses à ne pas re-déduire.** Le défaut était invisible ici parce que
  `bootstrap/cache/routes-v7.php` datait du 25/08, d'avant ces routes : l'URI rendait 405, pas 401 —
  **un `route:cache` de déploiement l'aurait rendue en production**. La correction garde POST malgré
  le précédent GET de la route ICE, dont l'argument 419 ne se transpose pas : un invité reçoit une
  réponse sans `attestation_ttl`, donc `_scheduleAttestationRefresh` n'arme aucun minuteur et la page
  ne fait qu'une requête, à jeton frais. Et `/verify-peer-attestation` **reste privée** : la mesure
  a compté zéro vérification depuis une page de login, le seul chemin invité supposant de connaître
  un peerId que seules les routes privées publient — borne assumée, à rouvrir si un chemin d'invité
  publiait un peerId.

  **La leçon de méthode, et elle vaut au-delà de cet item : les deux suites étaient vertes, et le
  mécanisme n'avait jamais tourné une fois sur cette machine.** Aucun test PHP ne pouvait le voir —
  le harnais Testbench réduit le groupe `public` à `[]` et ne traverse donc jamais la pile de
  middlewares —, aucun test JS non plus, puisque la panne est un aller-retour réel. C'est en
  ouvrant la page que ça se voit.


---

## usePeerCore — le moteur de retry d'invitation

- [ ] 🟠 **La clé de minuteur de `usePeerRetry` périme, et la chaîne périmée vole la place de la
  vivante** `[M]` — trouvé le 29/08/2026 en écrivant les tests des trois annuleurs, où le
  comportement est **épinglé** (`usePeerCore.test.js`, describe « les trois annuleurs
  d'invitation »).

  La clé est `` `${ctx.currentType.value}:${ctx.currentRoom.value}:${userSlug}` ``
  (`utils/usePeerRetry.js`). Changer de room ou de type entre la planification et l'annulation fait
  donc calculer à `clearRetry` une clé qui ne désigne plus rien : **le minuteur survit**.

  Seul, il serait inoffensif — sa garde d'arrêt (`userSlugToInviteId.has`) le tuerait à son réveil.
  Il cesse de l'être dès qu'une nouvelle invitation existe pour le même pair, ce que la production
  produit sans rien d'exotique (annuler un appel, changer de room, rappeler la même personne) :

  1. l'entrée `userSlugToInviteId` est réécrite, donc la chaîne périmée **repasse sa garde d'arrêt**
     et POSTe une invitation portant la room ABANDONNÉE ;
  2. puis elle se replanifie — et `scheduleRetry` commence par `clearRetry` sous la clé **courante**,
     donc elle **efface le minuteur de la chaîne vivante**.

  Résultat : la chaîne survivante est la mauvaise. L'invitation en cours n'est plus jamais relancée,
  et c'est l'abandonnée qui occupe le créneau — mesuré, `['call-1', 'call-2', 'call-1', 'call-1', …]`.

  ⚠️ **Le cas est flaky sans neutraliser le jitter** (`Math.random → 0`) : à jitter libre, l'ordre
  de réveil décide qui écrase qui — 1 vert sur 3 exécutions avant neutralisation. Toute reprise de
  cet item doit garder cette neutralisation.

  ℹ️ `clearAll()` n'a pas le défaut : il itère la Map au lieu de recalculer une clé. Piste la plus
  simple : indexer `pendingTimers` sur le seul `userSlug`, ou faire porter au minuteur la clé sous
  laquelle il a été posé. ⚠️ Contrôle négatif **inversé** — le cas épinglé rougira à la correction.

---

## Observabilité

- [ ] 🟠 **En star, un client dont le hub est absent n'a AUCUN signal à l'écran** `[S]` — relevé le
  30/08/2026 en instruisant la garde de topologie, sur une question posée en revue.

  Le comportement du module est correct et délibéré : le client ne compose pas un hub absent (aucun
  POST, aucun jeton de cadence, aucun retry armé — épinglé par `useConnectionPool.test.js`), et le
  tour de présence qui voit arriver le hub rétablit tout. **C'est l'UI qui manque, pas la logique.**

  Le prédicat exact existe déjà et remonte jusqu'à l'UI : `isHubConnected`
  (`createPeerContext.js`, exposé par `usePeerOrchestrator` puis `useMediaBroadcast`). **Son seul
  lecteur est `Debug.vue`.** Pendant tout ce temps, chaque `sendData` du client jette son payload
  avec un `console.warn` — pas de file, pas de retry — et l'utilisateur voit une room d'apparence
  normale. Le geste est de câbler `isHubConnected` sur une UI d'attente, pas d'ajouter un état.

  ⚠️ Ne surtout pas transformer ça en refus : `hubSlug` fourni n'est pas hub présent, et un hub
  absent est un état transitoire légitime. La confusion entre les deux est écrite dans
  [`api.md § Topologies`](../docs/modules/webrtc2/api.md#topologies).

- [ ] 🟢 **En star, hub et client ouvrent CHACUN leur connexion sortante** `[S]` — deux
  `RTCPeerConnection` par paire, une dans chaque sens, en fonctionnement nominal. C'est structurel :
  les connexions **entrantes ne sont jamais enregistrées** dans le store (l'unique écrivain est le
  chemin sortant de `usePeerConnections`), donc `hasOpenConnection` ne voit que son propre côté et
  ne peut pas empêcher l'autre. Sans conséquence sur le routage — le client n'émet que sur sa
  sortante vers le hub, le hub ne relaie que sur les siennes — le coût est en ressources.

  **À décider, pas à corriger d'emblée** : le fait n'est aujourd'hui écrit **que dans un commentaire
  de test** (`usePeerOrchestrator.broadcastPresence.test.js`), jamais asserté ni dans `docs/`. Sortie
  C (l'épingler et l'assumer) ou A (dédoublonner), mais pas le laisser tacite — c'est lui qui oblige
  déjà tout harnais star à semer une connexion sortante sous peine d'un test vert par vacuité.

- [ ] **Logger centralisé** : remplacer les `console.log/warn/error` dispersés par un logger
  configuré par composable
- [ ] **État debug exposé** : computed readonly pour inspecter l'état interne (retries, connexions,
  flux) — `Widgets/UI/Report/Debug.vue` en consomme déjà une partie à la main
- [ ] **Events structurés** : `peer:connected`, `peer:disconnected`, `call:started`, `call:failed`.
  À croiser avec `EventBus/webrtc2Events.js`, écrit mais **pas encore consommé** (les appelants
  émettent toujours en direct).

---

## Robustesse

- [x] ✅ **`useRemotePeerState` : le garde inatteignable et le signal perdu sont FERMÉS le
  31/08/2026** — avec le lot C, comme prévu. Les deux moitiés de l'item ont tenu, et une troisième
  correction est sortie en chemin.

  - **Le garde `signal.roomId !== peerId` : SUPPRIMÉ (sortie B).** 0 cas rougis, mesuré trois fois,
    exactement comme l'item l'exigeait. Ce qui protège réellement d'une enveloppe serveur posée sur
    la même clé est le **`switch` sans `default`** — 7 cas, et un cas dédié l'épingle désormais.
  - **`immediate: true` : AJOUTÉ (sortie A), et la piste était juste.** Ce qui restait à établir
    l'a été : le datachannel s'ouvre avant l'arrivée du flux, `createSignalQueueRoom` **ne vide
    pas** une file existante (assertion dédiée dans `StreamSimpleUI.toggles.test.js`), et aucun
    `v-if` ne retarde le montage — le montage *est* l'arrivée du flux. Trois cas vus rouges avant
    le correctif. L'avertissement de l'item a été payé : les contrôles des **trois** fichiers ont
    été re-mesurés, et l'un d'eux est passé de 2 à 15 cas.
    ⚠️ Ce qui est repris est le **dernier signal, pas l'état** : micro puis caméra coupés avant
    notre arrivée ne restituent que la caméra. Borne assumée, épinglée par un cas.
  - **Défaut NEUF, trouvé en écrivant le test et corrigé dans la foulée (sortie A)** : un flux sans
    `peerId` — toutes les vignettes de partage d'écran — lisait la clé `"undefined"`, qui est
    **exactement celle qu'écrit `dispatchSignal` quand la connexion manque**. Tous les écrans
    partagés partageaient donc une file poubelle commune, qu'un seul signal sans connexion aurait
    fait basculer d'un coup. Garde `!peerId` dans le `computed` ; la surdité d'un écran est voulue
    (règle symétrique de `LocalMediaPlayer`), donc pas de `console.warn`.

- [ ] 🟢 **La coalescence tous types confondus, et l'affirmation qui la masquait** `[S]` — relevée
  et **mesurée** le 31/08/2026 avec le lot C. `getLastRoomSignal` ne rend que la dernière entrée et
  un `watch` sur un `computed` ne se réveille qu'une fois par flush : un `AUDIO_MUTE_TOGGLE` suivi
  d'un `VIDEO_ACTIVE_TOGGLE` **dans le même tick** perd le premier.

  `useSignalingQueue.js` déclarait « dernière valeur gagne » **correct** pour ces projections. Ce
  n'est vrai que **par clé de file** — et la clé est le peerId, pas le type : les deux pistes d'un
  même pair partagent un emplacement. Le commentaire est corrigé, et le comportement est épinglé
  comme statu quo par un cas de `useRemotePeerState.test.js`.

  **Pas de correctif de mécanisme ici, et c'est délibéré** : drainer la file par type change le
  modèle de consommation **partagé** avec `useSignalingQueue` (curseur, ré-entrance, rewind,
  détecteur de `seq`) ; le faire depuis un Widget découplerait les deux consommateurs de la même
  file. Ça appartient à l'item « Drainer réellement la file de signaux », pas à un lot de tests de
  présentation. Portée réelle : un clic utilisateur = un message = une tâche, donc la fenêtre
  existe (retransmission hub, rafale) mais elle est étroite. Le cas de test se **supprime** avec
  le correctif du drain.

- [ ] 🟢 **L'état initial d'un pair n'est jamais semé — sortie D, avec son piège écrit** `[S]` —
  relevée le 31/08/2026 avec le lot C, reportée sciemment. Un pair déjà en sourdine **avant**
  notre arrivée s'affiche micro ouvert : `immediate` ne rattrape qu'un signal, et s'il n'y en a
  jamais eu il n'y a rien à rattraper.

  L'information est pourtant **déjà sur le fil** : `isAudioMuted` / `isVideoEnabled` sont portés
  par la metadata d'appel (`usePeerConnections.js:594-595`) et déjà recopiés par
  `StreamSimpleUI.vue:207-208`. **Personne ne les lit.**

  ⚠️ **Le piège, et c'est lui qui a fait reporter** : `StreamSimpleUI.vue:208` écrit
  `isVideoEnabled: rs.metadata?.isVideoEnabled ?? false` — il a **déjà écrasé `undefined` en
  `false`**. Brancher naïvement un semis ferait basculer **tout le monde** sur la branche audio.
  Il faut d'abord aligner le producteur (`=== true` / `!== false`, comme `useStreamManager.js:199`
  le fait à moitié), soit un quatrième fichier de production touché et une re-mesure des trois
  fichiers de test. Déclencheur : le premier signalement « il apparaît micro ouvert alors qu'il
  est coupé ».

  ℹ️ **La moitié LOCALE est morte, elle, et c'est mesuré (lot E, 31/08/2026)** :
  `localStreamData` (`StreamSimpleUI.vue:170-171`) pose aussi `isAudioMuted` et `isVideoEnabled`,
  mais ces deux-là ne partent sur aucun fil — la vignette locale lit `api.isMuted` /
  `api.isVideoEnabled` directement. Les retirer rougit **0 cas sur 1417**, et aucun lecteur
  n'existe au grep. **Non retirés délibérément** : ce sont les mêmes noms que ceux dont cet item
  doit décider côté distant, et les supprimer d'un côté pendant que l'autre attend une décision
  rendrait la lecture de la metadata locale incohérente. **À trancher avec cet item, pas avant.**

- [ ] 🟢 **Pas de réinitialisation quand `peerIdSource` change — sortie D, épinglée** `[S]` — le
  composable suit bien une `Ref` qui change (`unref` à chaque lecture), mais ne remet pas `muted` /
  `videoActive` à leurs défauts. **Aucun des deux `v-for` de production ne l'atteint** : leurs
  `:key` ne recyclent une instance que lorsque le `peerId` est absent, cas où le garde `!peerId`
  rend le composable sourd de toute façon. Le comportement est épinglé par un cas ; le correctif
  coûterait trois lignes et une re-mesure des trois fichiers pour un défaut inatteignable.
  Déclencheur : un consommateur qui passe une `ref` de peerId mutable, ou un pool qui recycle un
  `RemoteMediaPlayer`.

- [x] 🟢 **`v-bind="$attrs"` redondant dans `LocalMediaPlayer.vue:6`** `[S]` — **fait le
  31/08/2026** au lot E, sortie B, après 0 cas rougis sur référence relue verte (79 fichiers,
  1417 cas). L'explication vit dans le `<script setup>`, jamais dans le `<template>`.

  **La mesure a rendu un fait que l'énoncé n'avait pas, et qui vaut plus que le retrait** : cette
  ligne ne faisait pas que doubler le fallthrough, elle **désarmait le contrôle du voisin**. Tant
  qu'elle était là, ajouter `inheritAttrs: false` rougissait **0** cas — le `v-bind` rendait les
  attributs de toute façon — contre 1 cas chez le jumeau, qui ne l'avait plus. Après retrait :
  1 des deux côtés. Conséquence de méthode, remontée dans
  [`docs/modules/webrtc2/tests.md`](../docs/modules/webrtc2/tests.md) : **un contrôle à 0 doit
  faire chercher quelle AUTRE ligne absorbe la mutation**, avant de conclure que le test est
  inutile.

- [ ] 🟠 **La présence de TOUS les providers dépend d'une réaffectation chez un autre fichier —
  0 cas sur 1417** `[S]` — relevé et **mesuré** le 31/08/2026 par le lot E.

  `MediaBroadcastProvider` suit la composition par `watch(() => props.users, …)`, **non profond** :
  seul un remplacement de tableau déclenche `api.watchUsers`. `useReverbChannel` le respecte
  partout — `users.value = [...users.value, user]` (l. 148) et deux autres réaffectations — mais
  **rien ne l'y oblige, et rien ne le garde**. Mesuré : y écrire `users.value.push(user)` rougit
  **0 cas sur 1417** alors que la synchronisation de présence de tous les providers s'arrête.

  Conséquence : `syncUsersConnections` n'est plus appelé, donc `remotePeers` — l'allowlist que
  lisent les deux gardes d'autorisation — cesse d'être écrite. Panne **fail-closed** (les
  arrivants ne sont jamais admis, aucune brèche) mais totalement muette.

  La moitié testable côté provider **est faite** : `MediaBroadcastProvider.test.js` épingle que le
  watch n'est pas profond, dans les deux sens. Ce qui reste est la moitié d'en face, et le paquet a
  déjà la forme qui convient : un **filet mécanique au grep** sur les sources de production, comme
  `roomMembersSourceOfTruth.test.js` en porte un pour interdire les setters de `roomMembers` —
  ici, interdire `users.value.push` / `.splice` dans `useReverbChannel.js`. À poser dans
  `components/System/composables/__tests__/useReverbChannel.test.js`, qui existe déjà.

  ⚠️ Piège de harnais déjà payé, écrit pour ne pas le re-payer : **un cas qui distingue watch
  superficiel et profond doit semer par un `ref`**. Écrit avec un tableau littéral, le cas est vert
  des deux côtés — pousser dans un tableau non réactif n'est vu par aucun watcher.

- [ ] 🟠 **Le bouton `Fullscreen` est un aller sans retour** `[S]` — relevé le 31/08/2026 par le lot
  D, qui a écarté pour ça la « moitié plein écran » de son propre énoncé.

  `useMediaControls` met en plein écran l'élément exposé en `nativeVideo`, donc la `<video>` **nue**.
  Or les trois boutons vivent dans un `.video-controls` qui en est le **frère** : en plein écran, ils
  ne sont pas peints. Et `VideoPlayer` est monté `:controls="false"`, donc il n'y a pas non plus de
  contrôles natifs. L'utilisateur n'a que Échap ou F11 — ce qui marche, mais que rien n'annonce.

  Conséquence mesurée, et c'est elle qui a bloqué la correction du lot D : **la branche `else` de
  `toggleFullscreen` est déjà inatteignable** depuis l'UI par défaut (rien d'autre dans l'app ne pose
  `fullscreenElement` — grep : seulement la v1 morte, `WebRTC/widgets/VideoComponent.vue:258`). Y
  ajouter la comparaison `!== el`, comme pour le PiP, l'aurait rendue **prouvablement** morte :
  aucune contre-épreuve sur un chemin atteignable ne peut la faire rougir. Laissée telle quelle.

  La piste, si ce ticket s'ouvre : mettre **le cadre** `.draggable-video` en plein écran plutôt que
  la `<video>`, ce qui embarquerait les contrôles — et alors la branche `else` reprendrait un sens,
  et `!== el` deviendrait nécessaire. ⚠️ Ce n'est pas gratuit : le cadre porte `v-resize` /
  `v-draggable`, dont la géométrie serait à réexaminer en plein écran.

- [ ] 🟠 **Dans le pool, un appel VOCAL prend la branche vidéo — donc le bouton PIP y est mort et
  muet** `[S]` — relevé le 31/08/2026 par le lot D.

  `PlayerHost.vue:23-32` ne câble **pas** `videoActive`, qui vaut donc `true` par défaut
  (`MediaBroadcastPlayer.vue`), et `useStreamManager` passe par `createVideoElement` pour tout
  `currentType !== 'stream'` — **vocal compris**. Une `<video>` sans piste vidéo est donc rendue,
  avec ses trois boutons : `requestPictureInPicture()` y **rejette**, et le rejet part dans un
  `console.error` que personne ne lit. Bouton visiblement mort, cadre noir à côté.

  Plus fréquent que le cas multi-vignette que le lot D vient de fermer, et écrit nulle part. La cause
  amont est l'item « l'état initial d'un pair n'est jamais semé » (`isVideoEnabled` porté par la
  metadata et lu par personne) ; **la conséquence sur les contrôles est celle-ci**, et elle se
  corrige indépendamment : câbler `videoActive` depuis le type du flux dans `PlayerHost`.

- [ ] 🟢 **Le slot `#controls` ne reçoit pas de quoi reproduire les gardes du repli — et il rouvre
  l'écho** `[S]` — relevé le 31/08/2026 par le lot D, qui l'a épinglé sans le corriger.

  `MediaBroadcastPlayer.vue` expose `:controls="controls"` mais ni `videoActive`, ni `nativeMuted`,
  ni un `isMe` dérivé. Un consommateur qui remplace les contrôles ne peut donc reproduire **aucune**
  des deux gardes du contenu par défaut. La seconde compte : `toggleNativeMute` sur son propre flux
  ré-ouvre l'écho déjà subi (`useCallManager` en garde la trace), et le mécanisme est le double
  écrivain de `el.muted` — l'écriture impérative du composable contre la prop `:muted` de Vue. Quand
  `isMe` est vrai, `isLocallyMuted` vaut constamment `true`, donc la prop ne change pas, donc **Vue
  ne repatche pas** : le démutage impératif tient.

  Épinglé en attendant : `MediaBroadcastPlayer.controls.test.js` couvre ce que le slot reçoit
  aujourd'hui (2 cas rougis si `:controls` est retiré). ⚠️ Trancher d'abord **si ce slot est un
  contrat** : le lot D a retiré deux clés de la charge utile en s'appuyant sur le fait que personne
  ne le fournit. Les deux réponses ne peuvent pas être vraies en même temps.

- [ ] 🟢 **`showSpinner` teste la FORME du slot, pas ce qui est monté** `[S]` — relevé le 31/08/2026
  par le lot D. Mesuré contre le Vue installé (3.5.24) : `renderSlot` passe par `ensureValidVNode`,
  qui rend `null` quand tous les enfants sont des `Comment`, **récursivement à travers les
  Fragments** — donc un slot `#video` ne contenant qu'un commentaire fait rendre **notre repli**, et
  nos écouteurs `can-play` **sont** branchés. Or `showSpinner` teste `!slots.video` : il éteint le
  spinner pour une raison qui a cessé d'exister.

  Sans symptôme aujourd'hui — aucun consommateur ne fournit `#video`, et les deux `#audio`
  commentés de `StreamSimpleUI.vue:23-24,53-54` ne sont pas lus par cette condition, qui exige
  `videoActive`. Correctif visé : la **sentinelle** elle-même, `!!player.value`, insensible à la
  forme du slot. ⚠️ À mesurer avant : les refs de template sont posées après le premier rendu, donc
  le spinner serait éteint pendant une frame au montage. Voisin immédiat : `slots.video` n'est pas
  une dépendance réactive — le `computed` ne se réévalue que parce que `isBuffering` en est une.

- [ ] 🟢 **`draggable.js` démarre un drag quand on appuie sur un bouton de contrôle** `[S]` — relevé
  le 31/08/2026 par le lot D. `draggable.js` attache son `pointerdown` sur le **wrapper**, et son
  seul garde est `.resize-grip` : les boutons `Mute` / `Fullscreen` / `PIP` en sont descendants, donc
  tout appui démarre un drag, et le moindre mouvement déplace la vignette. Atteignable — le pool fige
  `draggable: true` (`PlayerHost.vue:31`). Le fichier est hors du périmètre de la tâche 8 (c'est une
  directive, pas un widget) : consigné, pas élargi.

  ⚠️ Écrire un test qui l'exerce demande de monter la configuration du pool (`draggable: true`), et
  alors les vraies directives ne sortent plus en early-return : `resizable.js` insère un wrapper réel
  dans le DOM. Les fichiers de test actuels ne sont inoffensifs que parce que les défauts sont
  `false` — et les `directives` passées en `global` n'y changent rien, elles sont **inertes**.

- [ ] 🟢 **`onBringToFront` : z-index inline monotone, jamais remis à zéro** `[S]` — relevé le
  31/08/2026 par le lot D. `MediaBroadcastPlayer.vue` écrit `el.style.zIndex = maxZ + 1` à **chaque**
  `pointerdown`, boutons de contrôle compris : croissance sans borne, et le style inline n'est pas
  remis à zéro au recyclage du slot (le `watch` du flux ne le touche pas), donc un slot repris hérite
  du z-index du flux précédent. Accessoirement, `document.querySelectorAll('.is-draggable')` est
  **global** et fait un `getComputedStyle` par frère à chaque appui.

- [ ] 🟢 **Les deux `catch` de `useMediaControls` ne rendent rien à l'utilisateur** `[S]` — relevé le
  31/08/2026 par le lot D. `console.error` seul, alors que le lot B a établi la convention du toast
  pour un échec média (repli `inject('AWN', null)` + `window.AWN`, message portant `err.name`). Un
  PIP qui rejette — sur un vocal, cf. l'item ci-dessus, ou hors geste utilisateur — est totalement
  muet. Le filet existe déjà : deux cas de `useMediaControls.test.js` asservissent la **cause** tracée
  à la fonctionnalité (`'Fullscreen'` / `'PIP'`), ils passeront au toast sans être réécrits.

- [ ] 🟢 **`SpectrumAnalyzer` : deux défauts, et un fichier WebRTC2 que seule la v1 maintient en
  vie** `[S]` — relevés le 30/08/2026 en cadrant la tâche 8, qui l'a **exclu** de son périmètre.

  Le fait structurel d'abord : `Widgets/UI/Audio/SpectrumAnalyzer.vue` est un fichier **WebRTC2**
  dont les deux consommateurs WebRTC2 sont commentés, et dont **le seul consommateur vivant est la
  v1** — `components/WebRTC/widgets/ui/AudioDefaultUserButtonUI.vue:13`, atteint par la route
  `audio/:vertexId` via `AudioRoom/AudioComponent.vue`. C'est la direction inverse de celle que
  [doc-rustines.md](doc-rustines.md) lot 1 enregistre (« la v1 est morte mais cinq composants
  vivants l'importent ») : ici c'est **la v1 morte qui importe du v2 vivant**. À traiter avec la
  suppression de `components/WebRTC/`, pas avant.

  Les deux défauts, à corriger à ce moment-là ou à emporter avec le fichier :
  - `startVisualizer` (l. 111-114) connecte les sources initiales **sans les enregistrer dans
    `sourceMap`** : seules les sources ajoutées ensuite par `updateStreams` sont déconnectables ;
  - l'usage commenté de `StreamSimpleUI.vue:24,54` est **faux, pas seulement désactivé** :
    `v-bind="audioProps"` passe `{ streamData }` à un composant dont l'unique prop est
    `streams: { type: Array, required: true }`. Le décommenter lèverait à `mounted()` sur
    `streams.forEach`.

  ℹ️ **Pourquoi il n'est pas testé** : `happy-dom` n'a pas d'`AudioContext` (ni `createAnalyser`,
  ni `createMediaStreamSource`, ni `requestAnimationFrame` utilisable ici). Tout collaborateur
  serait fabriqué à la main, et le test prouverait sa propre doublure.

- [x] 🟠 **Un refus de permission caméra ne produit RIEN à l'écran** `[S]` — relevé le 29/08/2026 en
  fermant la tâche 7 des tests, **fermé le 30/08/2026** (lot B de la tâche 8).

  La moitié basse était faite : `useMediaBroadcast.getWebcamStream` / `getAudioStream` /
  `startCapture` **rendent la promesse** de leur verbe `async`. La moitié UI l'est maintenant : les
  trois démarrages de `GroupLocalStreamBtn` portent un `.catch` qui notifie par AWN. Le filet exigé
  est là — `GroupLocalStreamBtn.test.js` (18 cas) puis `.permission.test.js` (9 cas), le cas
  maître **vu rouge avant le correctif**.

  **Trois décisions, à ne pas rouvrir sans les relire** :
  - `inject('AWN', null)` **avec repli** sur `window.AWN`, sur le précédent de
    `MediaBroadcastProvider.vue:39` et non celui de `CallRemotePeerBtn.vue:31`. ⚠️ Ce défaut `null`
    n'évite **aucun plantage** — mesuré : un inject nu rend `undefined` et le repli marche pareil.
    Il n'évite qu'un « injection "AWN" not found » de Vue sur un chemin où l'absence est normale
    (les sous-apps de `usePeerMedia.js:118`). Le premier commentaire écrit ici affirmait un
    plantage : c'était faux ;
  - **le message porte `err.name`**, et `NotAllowedError` est distingué de `NotFoundError` : les
    deux appellent des gestes **opposés** de l'utilisateur. Seul précédent du dépôt qui le faisait :
    `callbacks/visioPlayerCallback.js:90`, dans la v1 — c'est ce que WebRTC2 avait perdu ;
  - **silence sur `NotAllowedError` pour `startCapture` seulement.** `getDisplayMedia` rejette avec
    la même erreur que l'utilisateur refuse la permission ou qu'il **ferme simplement le sélecteur
    de partage** : indiscernables, et se raviser est un geste normal. Décision assumée.

  **Non-objectifs, à ne pas croire oubliés** : aucun état réactif d'erreur, aucun `isLoading`. Le
  panneau notifie, et s'arrête là.

  ⚠️ **L'énoncé ci-dessus se trompait sur le mécanisme, et il faut le savoir avant de le citer.**
  Ce n'était pas un « rejet non traité » au sens de Node : le handler appelait le verbe **sans
  rendre** sa promesse, donc Vue ne la voyait jamais et `callWithAsyncErrorHandling` n'avait rien à
  rattraper. Mesuré : ni `app.config.errorHandler`, ni `console.error`, ni
  `process.on('unhandledRejection')` ne voyaient quoi que ce soit. Le symptôme décrit restait exact
  — pas de toast, pas de changement d'état, un bouton mort — mais l'erreur disparaissait **sans la
  moindre trace**, ce qui est pire. Et la propriété « le rejet s'échappe-t-il ? » est **intestable
  à travers un espion** (`vi.fn().mockRejectedValue()` attache son propre handler et absorbe le
  signal) : le cas qui la posait a été **supprimé, pas commenté**. Détail dans
  [webrtc2-tests-plan.md](webrtc2-tests-plan.md), tâche 8.

- [ ] 🟢 **Une remise à zéro en double dans `useCallManager`** `[S]` — mesuré le 29/08/2026 par
  contre-épreuve. `ctx.session.currentCallRoomId = null` (chemin `full` de `stopCallWithPeers`) est
  **strictement redondant** : `resetCallState()`, appelé juste après, refait le travail par
  `setCurrentCallRoomId(null)`. Neutraliser la ligne seule rougit **zéro** cas ; neutraliser le
  setter seul en rougit un ; neutraliser les deux en rougit quatre. Rien n'est cassé — c'est du
  code mort qui donne l'illusion d'un invariant tenu à deux endroits. Le supprimer, ou l'assumer
  par un commentaire disant qu'il est là pour l'ordre des opérations (il ne l'est pas : le setter
  du reset suit immédiatement).

- [ ] **Graceful degradation eventBus** : si l'eventBus est indisponible, logger au lieu de crasher.
  Partiellement en place (`createPeerContext` pose un no-op et warn) — reste à vérifier les
  widgets qui l'injectent directement.
- [ ] **Cleanup `AbortController`** : annuler les opérations longues à la destruction du contexte.

---

## Surveillance conditionnelle

- [ ] **Drainer réellement la file de signaux** `[M]` — **à n'ouvrir que si le warn
  `N signal(s) non routé(s) (seq x→y)` apparaît réellement en production.**

  Aujourd'hui seul `at(-1)` est consommé. **Vérifié sur le code, aucun chemin actuel ne produit la
  condition** (à ne pas revérifier) : producteur unique sans boucle, et un event Reverb = une frame
  WebSocket = une tâche de boucle d'événement, entre lesquelles les microtâches — donc le flush du
  `watch` — sont drainées. La machinerie nécessaire ne s'exercerait jamais en prod.

  Trois pièges à connaître avant de s'y remettre :

  1. **ne pas** ré-exposer la file via `computed(() => peerStore.getQueueForRoom(contextId))` — ce
     computed ne trace que la *clé*, qu'un `push` ne touche pas, donc il n'est jamais invalidé.
     C'est pourquoi `roomSignals` n'avait jamais pu être consommé et a été supprimé. Watcher un
     **scalaire** dérivé de la file (ex. `at(-1)?.seq`) ;
  2. `createMockContext._pushSignal` écrit dans `_signalQueue` (réactif) alors que
     `getQueueForRoom` lit `_signalQueueRooms` (objet nu) — **tout test de drain serait un faux
     positif** avant correction du mock ;
  3. `dispatchSignal` plafonne la file à **10** par room : avec une consommation réellement
     sérialisée, une room mesh à 8 pairs génère jusqu'à 14 signaux et le plafond évincerait des
     signaux non drainés → à porter dans `webrtc2.config.js` et redimensionner en même temps. Le
     plafond rend aussi tout curseur basé sur `length` faux, d'où le `seq`.

  `clearSignalQueueRoom` appelé en pleine session est un **rewind réel**, pas théorique.

---

## Contrôlé le 29/08/2026 et EXACT — ne pas re-mesurer

Le point d'étape QA a recoupé les affirmations vérifiables de la doc contre le code. **Quatre
étaient fausses** — corrigées le jour même : le compteur prétendu lisible dans `Debug.vue`
(item de sécurité ci-dessus), la table « quatre lecteurs » d'`isAuthorizedPeer` qui en compte
**cinq** depuis le 28/08, la règle d'imports « toujours l'alias » que 118 sites contredisent, et deux
chiffres de ce fichier (l.23, l.94).

Les suivantes ont été vérifiées **une par une et tiennent**. Elles sont listées ici pour que la
prochaine passe ne repaie pas la mesure :

- **trois écrivains d'`addRemotePeerId`** — `useCallManager:198`, `:289`, `usePeerConnections:375`.
  Aucun quatrième, aucune auto-inscription réintroduite ;
- **`computeRoomDiff` est bien le seul écrivain de production de `roomMembers`** — `setRoomMembers`
  porte son docblock de verbe de semis et n'a aucun appelant de production ; `clearRoomMembers`
  porte son garde de propriété ;
- **quatre points d'application de `payloadSize.js`** — émission mesh (`usePeerTransport:1831`),
  retransmission (`:1721`), réception (`createPeerContext:579`), et la `metadata` en **première**
  instruction des deux dispatchers (`:1358`, `:1393`) ;
- **`topology` lue à sept endroits dans quatre fichiers** — le compte tient, seules les lignes de
  `usePeerTransport` ont bougé ;
- **cinq composants vivants importent encore la v1 morte** — `ClassRoom`, `AudioRoom`,
  `Application`, `Whiteboard`, `System/widgets/AlertComponent` (ce dernier en
  `defineAsyncComponent`). Le compte de `docs/modules/webrtc2/INDEX.md` est juste ;
- **`config/reverb.php` de l'hôte porte `accept_client_events_from` avec `'members'` par défaut** —
  la borne de déploiement du whisper de présence est tenue sur cette machine ;
- **les deux suites sont vertes et n'ont ni `.skip` ni `.only`** — JS 61 fichiers / 1148 cas,
  PHP 286 tests / 678 assertions — mesuré après la fermeture de la mesure de bascule d'`enforce` et
  de la boucle de rechargement ; 60 / 1141 et 279 / 636 avant. Cinq cas `[épinglé]` au total, tous
  datés et rattachés à un item
  ouvert de ce fichier.

---

## Patterns proposés, non implémentés

### Injection protective

```javascript
const safeInject = (key, fallback = null) => {
    try {
        return inject(key) ?? fallback
    } catch {
        console.error(`[WebRTC2] inject('${key}') failed`)
        return fallback
    }
}
```

### Lifecycle cleanup manager

```javascript
const lifecycle = {
    watchers: [], timers: [],
    onWatch(stop) { this.watchers.push(stop) },
    onTimer(id) { this.timers.push(id) },
    cleanup() {
        this.watchers.forEach(w => w()); this.timers.forEach(t => clearTimeout(t))
        this.watchers = []; this.timers = []
    }
}
// const stop = watch(...); lifecycle.onWatch(stop)
// onUnmounted(() => lifecycle.cleanup())
```

Formaliserait la discipline déjà exigée par
[docs/modules/webrtc2/architecture.md § Cleanup obligatoire](../docs/modules/webrtc2/architecture.md#cleanup-obligatoire).
