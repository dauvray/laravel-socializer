# WebRTC2 — Todo

> ## ⏸️ Chantier gelé le 30/10/2026 — il ne passe pas devant les autres
>
> Décision de David : le module sert en l'état, et aucun projet autre que le bac à sable
> `estarter-test` ne consomme le paquet. Ce qui reste est 🟠/🟢, **ne bloque rien**, et ne se prend
> qu'**au besoin** : quand un chantier prioritaire le croise, ou sur demande explicite. Y déposer un
> constat sans rouvrir le chantier est l'usage prévu.
>
> **Pour le rouvrir** : le micro perdu en cours d'appel (🟠 de « Ce que le lot caméra a ouvert »).
> David en a fait un lot séparé le 30/10 ; candidat dès ce jour-là, il est passé premier à la
> fermeture du 🔴 du même jour. Le 🟠 du spinner, ouvert ce jour-là aussi, n'a pas été classé face
> à lui.
>
> **Ce que le gel ne suspend pas** : les deux volets du §7 de
> [`work/deploiement-tiers.md`](../../../../work/deploiement-tiers.md) du projet hôte, qui porte
> l'état du lock et des tags. En dev, `composer install` ne touche pas le paquet tant que le lock et
> `vendor/composer/installed.json` désignent la même référence ; il ne lit pas le HEAD du clone. Le
> retour au lock vient d'un `vendor/` recréé, ou d'un lock qui change : Composer refuse alors si des
> commits ne sont pas poussés, et sinon remet la branche au sha du lock. Le geste du §7 (pousser,
> puis mettre à jour le lock) remet l'écart à zéro, jusqu'au commit suivant. Pour un
> tiers qui déploie la pile de l'hôte, le paquet installé est celui du lock : c'est le 🔴 du
> chantier de déploiement de l'hôte, qui n'est pas gelé.
>
> **Le jour où un déploiement portera le bundle porteur** — un projet consommateur, ou un tiers qui
> déploie la pile de l'hôte une fois le lock mis à jour : sa phase d'observation commence, et la
> bascule `SOCIALIZER_PEER_ATTESTATION_ENFORCE` ne vient qu'à son terme (section « Sécurité »
> ci-dessous).

> Les items **terminés** sont élagués : leur rationale vit dans
> [`docs/modules/webrtc2/`](../docs/modules/webrtc2/INDEX.md), leur récit dans `git log`.
> Tests : le harnais et ses pièges sont dans
> [`docs/modules/webrtc2/tests.md`](../docs/modules/webrtc2/tests.md) ; la méthode transverse dans
> [`docs/architecture/tests.md`](../docs/architecture/tests.md).
>
> Effort : `[S]` `[M]` `[L]`

---

## Ce que le lot « une capture qui rejette ne suspend plus l'appel » a ouvert — clos le 30/10/2026

> **Le 🔴 est clos le 30/10/2026**, sur la vérification de David en vrai navigateur, sur deux postes
> Windows : Chrome 156 et Edge 156, d'après `browser.log`. Le repli caméra a joué sous Chrome sur
> `NotReadableError` (étape 1, webcam tenue par Teams). Sous Edge, il a joué sur `AbortError` puis
> sur `NotAllowedError` (12:23:07 et 12:26:14 UTC). Leur rattachement aux étapes 2 et 6 n'est pas
> établi : l'étape 2 mettait Teams chez A, sous Chrome, et le journal ne garde que le nom de
> l'erreur, pas son message. La sortie propre a joué dans les deux rôles, appelé et appelant, sous
> Chrome 156 seulement. Aucune trace « [Notifications] réponse à une invitation ». Protocole : les
> étapes 1, 2, 3 et 6 ont tourné dans des onglets mis à jour à chaud à 12:08:39 UTC, sans le
> rechargement dur prescrit. Les replis attendus ont joué quand même, et le marqueur n'existe que
> dans le nouveau code. Le définitif est dans [`flux.md`](../docs/modules/webrtc2/flux.md),
> « Une capture qui REJETTE ne suspend plus l'appel », le récit dans `git log`. Une étape n'est
> pas passée, et ce n'est pas un rejet : le 🟠 ci-dessous.

- [ ] 🟠 **Webcam débranchée avec son seul micro : la capture ne rejette pas, et l'appel reste sur
  le spinner** `[M]` — classé 🟠 par David le 30/10/2026, bien que le symptôme soit celui du 🔴
  clos. Vu par David le même jour, sur un seul essai. B, sous Edge 156, accepte l'appel webcam
  débranchée, et les deux restent sur le spinner. La capture ne rejette qu'au
  rebranchement, en `AbortError` (12:43:36 UTC). Le repli caméra joue alors, et B part caméra
  coupée : son acceptation est arrivée chez A, et y a été consommée. Dans cet essai, la fin de
  l'appel est venue d'ailleurs : la capture de A (Chrome 156) a été refusée 286 ms plus tard, ses
  permissions étant restées bloquées depuis l'étape précédente, et A est sorti proprement. Que B
  ait reçu cette fin n'est attesté que par David : ni les toasts ni la fin d'un appel jamais
  connecté ne sont journalisés. Aucun code ne rattrape un rejet qui n'arrive pas. Le spinner a duré
  moins de 55 s : on ne sait pas si l'attente serait sans fin, ni si le navigateur finirait par
  rejeter seul. Déduit, non mesuré, au-delà de 55 s : A sort par l'abandon de sa relance
  (« n'a pas répondu »), et B reste en RECEIVING, où il peut « annuler ». Si sa capture aboutit
  ensuite, son acceptation arrive chez un appelant qui l'ignore : c'est la trace « acceptation
  d'appel sans invitation en vol — ignorée » de `browser.log` (10:50:05 UTC le 30/10), restée
  inexpliquée, sans que le lien soit établi. À mesurer d'abord : l'attente dure-t-elle sans fin,
  et que fait B quand la capture aboutit après l'abandon ? Piste : un délai maximal de capture.
  C'est une décision de David, car une invite de permission laissée ouverte retient la capture de
  la même façon, et un délai couperait l'utilisateur lent.

- [ ] 🟢 **L'appelant d'un appelé sans micro lit « est injoignable », sans la cause** `[S]` — la
  sortie propre de l'appelé est un refus ordinaire. Le serveur ne relaie d'une réponse que les clés
  de `RELAYED_OPTION_KEYS` : y transmettre la cause demande une clé de plus, côté PHP et côté
  `usePeerCore.sendAuthorizationRemotePeerId`.

- [ ] 🟢 **Caméra rallumée PENDANT l'invite, puis indisponible : le drapeau retombe sur « coupée »
  sans toast** `[S]` — mesuré par la relecture du 30/10/2026, en harnais. `startCurrentStream` lance
  `applyVideoState()` sans l'attendre, et personne ne lit son `false`. Aucun blocage : l'appel part
  caméra coupée, mais sans le dire.

## Ce que le lot caméra a ouvert — lot clos le 30/10/2026

> **« Couper la caméra éteint vraiment la webcam » est clos le 30/10/2026**, sur la vérification
> de David en vrai navigateur, rapportée ce jour-là : étapes 1 à 5 OK, webcam débranchée OK sous
> Chrome 156 après `132de96`. Sous Firefox, dans un flux avec micro, la réactivation ne redemande
> pas la permission, et l'aperçu local revoit la caméra (version non établie : 133 ou 148). Le
> définitif est dans [`flux.md`](../docs/modules/webrtc2/flux.md), « Couper la caméra l'éteint »,
> avec le repli fermé, décidé par David le même jour. Le récit est dans `git log`. Un seul cas n'est
> pas mesuré : la caméra prise par une autre application EN COURS d'appel. En le tentant, David a
> trouvé un 🔴 antérieur au lot, clos depuis (section ci-dessus). Le cas a été mesuré ensuite, le
> 30/10, sous Windows : Teams ne peut pas prendre la caméra tenue par le navigateur, sans message
> (`flux.md`).

- [ ] 🟢 **Observé une fois, non expliqué : Chrome 156 perd le serveur PeerJS pendant une séance**
  `[S]` — à 20:54:45 UTC le 29/10/2026 : « Lost connection to server », tentative **5/8**, sans
  trace des tentatives 2 à 4, hors de tout rechargement à chaud et sans redémarrage de conteneur
  (relecture du 29/10). Cause non établie, peut-être le réseau du poste. Un Chrome qui « décroche »
  pendant une vérification manuelle peut venir de là, et pas du lot vérifié.

- [ ] 🟠 **Sans clic dans l'onglet, aucun média distant ne joue sous Firefox, et la sonnerie se tait
  sous Firefox comme sous Chrome** `[M]` — constaté par David le 29/10/2026 (Firefox 148) : « si je
  clique, ça fonctionne ». Les players
  démarrent par l'attribut `autoplay` (`VideoPlayer.vue` et `AudioPlayer.vue` du socle). Déduit,
  non mesuré ici : Firefox bloque en silence l'`autoplay` d'un média avec du son tant que le
  document n'a reçu aucun geste, sans erreur, l'élément restant en pause. La sonnerie des alertes d'appel (`VideoCallAlert.vue`,
  `AudioCallAlert.vue`) appelle `ding.play()` chaque seconde. Les 4 `NotAllowedError` non
  rattrapées de `browser.log` (20:39:06–09 UTC, espacées d'une seconde, 14 s après un chargement
  de page) lui sont ATTRIBUÉES par déduction : ce sont les seuls `play()` explicites du code, et
  la ligne de journal ne porte pas de pile. Chrome bloque aussi la sonnerie, mesuré le 30/10/2026
  dans `browser.log` : Chrome 156, « play() failed because the user didn't interact with the
  document first », une fois par seconde de sonnerie, dans un onglet rechargé après un changement
  de permissions et jamais touché depuis. Le message nomme la politique de lecture automatique,
  et la cadence est celle de `ding.play()`. La déduction qui faisait passer Chrome grâce à
  l'historique du domaine est donc fausse pour la sonnerie ; pour les players, Chrome n'est pas
  mesuré. Un appel ordinaire porte son
  geste (« appeler », « accepter ») ; ce qui reste exposé : un spectateur de DIFFUSION qui arrive,
  un onglet rechargé pendant un appel, l'appel entrant qui sonne dans un onglet jamais touché.
  Antérieur au lot caméra. Piste, non mesurée : détecter le refus (`play()` explicite et son rejet)
  et proposer « cliquer pour lancer le son » ; rattraper le rejet de la sonnerie. Les players
  vivent dans le SOCLE : une correction là est une tâche d'estarter, à router.

- [ ] 🟢 **Diffusion : l'annonce « caméra active » part avant le verdict** `[S]` —
  `GroupLocalStreamBtn.onToggleVideoVisibility` envoie `VIDEO_ACTIVE_TOGGLE` aussitôt après la
  bascule, sans attendre `toggleVideoVisibility()`. Si la caméra ne peut pas être rallumée, les
  spectateurs ont reçu « active » et voient le bouche-trou noir ; et la diffusion n'a pas le toast
  de l'appel. Attendre la promesse, puis annoncer l'état final.

- [ ] 🟢 **Firefox, flux visio SANS micro : l'aperçu LOCAL ne suit plus la caméra** `[S]` — mesuré
  par la relecture du 29/10 (Firefox 151 headless). Retirer la seule piste rend le flux inactif, et
  le `<video>` passe en `ended`. Né avec la caméra, l'aperçu reste FIGÉ sur sa dernière image à la
  coupure (on se voit encore après avoir coupé) ; né caméra coupée, il reste noir à la
  réactivation. Le pair n'est pas touché. Parade mesurée dans les deux sens : réassigner
  `video.srcObject = flux` puis `play()`. `play()` seul ne suffit pas. Elle vit côté player et
  demande un signal de `usePeerMedia`, car un `addTrack` fait par script n'émet pas `addtrack`.
  **Inatteignable depuis l'UI du paquet aujourd'hui** (lu, non mesuré) : il faut un micro coupé
  AVANT la capture. Le raisonnement est dans `usePeerMedia._replaceVideoTrack`. L'item ne devient
  actif que si une UI permet de couper le micro avant la capture.

- [ ] 🟠 **Un micro perdu en cours d'appel ne revient pas, et l'UI le dit ouvert** `[M]` — lu,
  non mesuré. La webcam débranchée emporte son micro intégré (vu par David le 30/10/2026,
  `flux.md`), et rien ne suit la fin d'une piste audio. Le pair n'entend plus rien jusqu'au
  raccroché, le bouton reste sur « micro ouvert », et « couper » puis « activer » ne fait que
  basculer `enabled` sur une piste morte. Le remède suivrait la caméra : drapeau à « coupé », puis
  recapture du micro à l'activation et `replaceTrack` sur les senders audio. Lot séparé, décidé par
  David le 30/10. La recapture ne sert qu'à ressusciter une piste morte : couper le micro reste un
  `enabled = false`, par décision du 30/10 (`flux.md`).

- [ ] 🟠 **Firefox antérieur à la correction DTLS 1.3 : aucun média avec Chrome ou Edge** — le fait
  est dans `flux.md` (« Où ça casse »), confirmé sur un poste du GHU le 30/10/2026 (Firefox 133).
  Le parc mêle les versions (133 et 148, sur deux postes d'après David). Trois suites :
  - [ ] **Mesurer la première version corrigée** `[S]`, entre 134 et 148, avec la sonde de la
    relecture (Firefox officiel face à Chromium headless, ordre PeerJS). C'est elle qui fixerait
    le seuil d'un avertissement.
  - [ ] **Avertir dans l'application** `[S]` — à trancher par David : en dessous du seuil, dire à
    l'utilisateur Firefox que son navigateur ne recevra ni n'enverra d'image.
  - [ ] **Versions de Firefox sur les postes du GHU** — question pour la DSI. Notée et laissée
    de côté par David le 30/10.

- [ ] 🟢 **Raccrocher pendant le PREMIER montage de l'aperçu local le laisse orphelin** `[S]` —
  mesuré par la relecture du 30/10/2026, et préexistant (même résultat sur `b12a8b5`).
  `createVideoElement('local-webcam')` est lancé sans être attendu, et le raccroché tombe pendant
  son `await _ensureHost`. `removeVideoElement` ne trouve pas encore le player (`addPlayer` vient
  après l'`await`) et sort sans rien faire : l'aperçu reste inscrit. Déduit, non mesuré : l'appel
  suivant sort tôt (`slotIndex.has`) et son aperçu reste sur l'ancien flux mort. La fenêtre n'existe
  qu'au premier montage par conteneur (import dynamique de `PlayerHost.vue`). Piste :
  `removeVideoElement` note une suppression en attente si `creatingVideoIds.has(id)`, et
  `createVideoElement` la relit après l'`await`.

- [ ] 🟢 **coturn : `--user-quota=12` atteint par un seul onglet** `[S]` — mesuré le 30/10/2026 dans
  `about:webrtc` (Firefox 133, poste du site). L'onglet tenait environ huit `RTCPeerConnection`, les
  connexions de données des rooms ouvertes en plus de celle du flux. Chacune tente une allocation
  sur l'URL UDP et sur l'URL TCP (README, non mesuré ici). La connexion du flux a reçu
  `486 Allocation Quota Reached` sur les deux et n'a obtenu aucun candidat relais. Côté serveur,
  rien ne le confirme ni ne le réfute : coturn ne journalise pas les allocations à sa verbosité
  actuelle (relecture du 30/10). Sans effet ce jour-là (pairs en direct). Un poste qui a besoin du
  relais, en VPN par exemple, perdrait son flux. Le README (« Réseaux qui ferment l'UDP ») compte
  environ huit allocations pour un appel à deux, sans les connexions de données des autres rooms.
  Le quota est posé par le `docker-compose.yml` de l'hôte. À trancher : le relever, ou réduire ce
  qui alloue.

---

## usePeerTransport

- [ ] 🟢 **Le commentaire « ce qui RESTE au niveau du module » en oublie la moitié** `[S]` — relevé
  le 31/08/2026 en clôturant le plan de tests, et **il a déjà menti une fois par ricochet.**

  `usePeerTransport.js:76-78` énumère ce qui demeure volontairement de portée module et ne nomme que
  `_hubRateLimiter`. Il y en a **deux** : `_hubRateLimiter` (l.482) et `_hubByteLimiter` (l.491), et
  ce sont les deux seules déclarations de portée module du fichier. `docs/modules/webrtc2/tests.md`
  avait hérité de l'omission — c'est corrigé côté doc, pas côté code.

  Pourquoi ça compte : cette liste est ce qu'un lecteur consulte pour savoir ce que
  `vi.resetModules()` doit isoler. Un limiteur oublié fait partager une fenêtre de débit entre deux
  pairs d'un scénario, ce qui ne rougit rien — ça verdit au mauvais endroit.

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

## Sécurité — fermer le chemin (a), et ça se joue au backend

- [ ] 🟠 **Basculer `SOCIALIZER_PEER_ATTESTATION_ENFORCE=true` chez chaque déploiement qui porte le bundle** `[S]` —
  **le code est prêt, et la bascule est FAITE EN DEV le 28/10/2026** : `.env` du bac à sable
  `estarter-test`, mode strict en continu. Le mécanisme a tourné en vrai, à deux navigateurs, sur
  ses quatre issues : nominal admis, sans attestation refusé sans que le serveur le voie, serveur
  muet admis en fail-open et compté, attestation périmée refusée **et journalisée** (`reason:
  expired`, `attested_slug` du diffuseur, `auth_user_slug` du récepteur). Ce qui reste est un geste
  de DÉPLOIEMENT chez chaque déploiement qui porte le bundle, après sa phase d'observation — et
  aucun déploiement autre que le bac à sable n'a encore le bundle porteur (cf. l'en-tête de ce fichier, et le §7 de `work/deploiement-tiers.md`
  de l'hôte).

  La procédure, ses **trois termes** et la **recette de vérification manuelle** (rôles, blocages,
  attendus) sont dans
  [`securite.md` § « Ce qu'il faut regarder pour basculer »](../docs/modules/webrtc2/securite.md#ce-quil-faut-regarder-pour-basculer-enforce).
  Deux avertissements qui décident du résultat :

  - ⚠️ **Ne jamais basculer sur un seul des deux indicateurs.** Le journal serveur ne voit QUE les
    attestations *présentées* — il est structurellement aveugle au cas majoritaire de la phase
    d'observation (un onglet resté sur un bundle antérieur n'appelle jamais la route). Les trois
    compteurs de `Debug.vue`, eux, ne voient qu'un onglet.
  - ⚠️ **Un refus entrant n'est jamais rattrapable** : il ne revient pas à l'émetteur. Une bascule
    trop tôt coupe des pairs légitimes en silence, de leur point de vue comme du nôtre.

  **Ce que la vérification du 28/10 a appris, et que le harnais ne pouvait pas montrer** — le
  durable est remonté dans `securite.md`, ceci n'est que l'index :

  - **le mapping gagne la course en conditions réelles.** `connectToPeer` écrit le mapping avant de
    décider s'il ouvre, et la réponse à `/ask-to-peer-id` de l'arrivant revient avant l'appel du
    diffuseur. L'attestation n'est consultée que si la signalisation a échoué, ou pour un peerId
    qu'elle n'a jamais nommé — l'usurpateur. Rien ne change à la sécurité ; les compteurs du panneau
    ne bougeront presque jamais en usage nominal, et la fenêtre de déploiement mixte est plus
    étroite que la doc ne le craignait. `incomingMappingInvariant.test.js` mesure l'ordre inverse :
    à relire comme un invariant du harnais, pas de la production ;
  - **un émetteur refusé réessaie toutes les quelques secondes**, chaque tentative refusée, sans en
    être informé ;
  - **le journal serveur compte des vérifications, pas des tentatives** : verdict mémorisé
    `ATTESTATION_REFRESH_MARGIN_MS` par peerId chez le récepteur ;
  - **toute initialisation neuve du `Peer` vide l'attestation et en redemande une.** Une observation
    commence une fois l'onglet installé dans sa room. ⚠️ Observé une fois : une init neuve a suivi
    l'entrée dans la room **sans** rechargement ni redémarrage de Vite (journal du conteneur
    relu) — cause non tranchée, démontage du dernier contexte probable. À remesurer avant d'en
    faire une règle.

  Le terme 2 reste une **borne assumée**, non mesurable sur un serveur : il s'établit par un
  argument de déploiement (durée de vie d'onglet vs actifs hachés par Vite), corroboré par un
  échantillon au panneau.

---

## Observabilité

- [ ] 🟠 **En star, un client dont le hub est absent n'a AUCUN signal à l'écran** `[S]` — relevé le
  30/08/2026 en instruisant la garde de topologie, sur une question posée en revue.

  Le comportement du module est correct et délibéré : le client ne compose pas un hub absent (aucun
  POST, aucun jeton de cadence, aucun retry armé — épinglé par `useConnectionPool.test.js`), et le
  tour de présence qui voit arriver le hub rétablit tout. **C'est l'UI qui manque, pas la logique.**

  Un prédicat existe déjà et remonte jusqu'à l'UI : `isHubConnected`
  (`createPeerContext.js`, exposé par `usePeerOrchestrator` puis `useMediaBroadcast`). **Son seul
  lecteur est `Debug.vue`.** Pendant tout ce temps, chaque `sendData` du client jette son payload
  avec un `console.warn` — pas de file, pas de retry — et l'utilisateur voit une room d'apparence
  normale. Le geste est de câbler `isHubConnected` sur une UI d'attente, pas d'ajouter un état.

  ⚠️ **Mais `isHubConnected` dit PRÉSENT, pas JOIGNABLE** — mesuré par la relecture du 26/10/2026.
  C'est « hub === moi, ou hub ∈ `remotePeers` » : il passe à vrai au tour de présence, avant que
  la sortante du client vers le hub soit ouverte, alors que le client n'émet que sur elle. Il vaut
  donc vrai pendant que `sendData` jette, dans la fenêtre nominale avant ouverture, et pendant
  15,8 s sous l'ancien appel inconditionnel. Une UI d'attente câblée dessus afficherait
  « connecté » pendant que tout est jeté. **Le choix du prédicat est à trancher avant ce câblage.**

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
  **À écrire de zéro** : il n'y a plus rien à recycler depuis le 31/08/2026, `EventBus/webrtc2Events.js`
  ayant été supprimé (sortie B du lot 1 de `doc-rustines.md` ; le rationale est dans `api.md`, le
  code dans `git log`). Ce qui existe aujourd'hui, et qui est le point de départ : les deux seuls
  événements réels — `call-user` et `close-call` — transitent sur l'eventBus injecté **en forme
  brute**, et c'est cette forme que les tests épinglent des deux côtés. Un jeu d'events structurés
  devra donc soit coexister avec elle, soit changer les émetteurs ET leurs tests.

---

## Robustesse

- [ ] 🟢 **Intermittent : `usePeerOrchestrator.callbacks.test.js` fait parfois sortir la suite en
  exit 1, tous ses cas verts** `[S]` — mesuré le 29/10/2026 par la relecture, **cause lue, non
  éprouvée**. Deux rejets non traités, « ReferenceError: document is not defined » dans `_mountHost`
  (`usePeerMedia.js:133`), « caught after test environment was torn down » : un montage de player
  resté en vol reprend après le démontage de l'environnement du fichier. Taux : 1 run sur 12 avec le
  lot « un appel démarre micro ouvert », 0 sur 11 sans — non concluant, le lot ne touche ni ce
  fichier ni `usePeerMedia`. Piste : le fichier pose bien le conteneur (l. 165), mais un `_mountHost`
  qui attend l'import dynamique de `PlayerHost.vue` peut survivre au dernier cas. **Pourquoi ça
  compte** : le hook `pre-push` juge sur un seul run (`docs/architecture/tests.md`, « Le filet
  automatique ») — il peut refuser un push au hasard. Un refus sur « Errors » venant de ce fichier :
  relancer, jamais `--no-verify`.

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
  `currentType !== 'stream'` — **vocal compris**. Une `<video>` est donc rendue avec ses trois
  boutons : `requestPictureInPicture()` y **rejette**, et le rejet part dans un `console.error` que
  personne ne lit. Bouton visiblement mort, cadre noir à côté.

  ⚠️ **La prémisse de cet énoncé était FAUSSE, corrigée le 31/08/2026 par le lot F.** Il disait
  « une `<video>` **sans piste vidéo** » : la piste était bien là. `_enterCallSession` appelait
  `media.startCurrentStream(true)` alors que la fonction ne prenait **aucun paramètre** — l'argument
  était ignoré et les contraintes lisaient `isVideoEnabled`, vrai par défaut. Un appel « vocal »
  capturait donc une piste vidéo **et la transmettait**, `peer.call` passant le flux tel quel : la
  caméra s'allumait sur un appel où personne ne l'avait demandée. **Corrigé** (le type descend
  jusqu'aux contraintes, avec un pouvoir de veto seulement ; depuis le 29/10/2026, il décide seul
  de la capture vidéo, `isVideoEnabled` ne faisant plus que désactiver la piste), et épinglé par un 0 croisé —
  `usePeerMedia.streams.test.js` pour le veto, `useCallManager.test.js` pour la transmission du type.

  Ce qui reste ouvert ici est donc l'autre moitié, inchangée : `videoActive` non câblé par
  `PlayerHost`, donc une `<video>` rendue et un bouton PIP qui rejette en silence. Le flux vocal
  n'a maintenant plus de piste vidéo, ce qui rend le cadre noir **certain** au lieu de probable.

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

- [ ] 🟢 **`StreamSimpleUI` attribue mon nom au flux de réponse d'un pair** `[S]` — relevé le
  26/10/2026 au lot E, lu dans le code, non reproduit. En mode `stream`, le flux de RÉPONSE de B arrive
  sur la connexion sortante de A, dont la metadata est celle de A ; le registre gardant la première
  entrée par clé, `rs.metadata.fromName` peut valoir **mon** nom. `StreamSimpleUI` le lit brut (la
  règle `from === remoteSlug` vit dans `useStreamManager._resolveRemoteName`, qui ne sert que les
  players du pool). Exemples seulement ; AudioRoom résout le nom par la présence et `remoteSlug`.

- [ ] 🟢 **Décision à acter : le FIFO de `MAX_REMOTE_STREAMS` ignore la vivacité** — relevé par la
  relecture d'E0a le 26/10/2026. Plein, le registre évince le plus ancien inséré, vivant ou non ; il
  pourrait évincer d'abord les entrées mortes. Borne de capacité (12), pas un défaut.

- [ ] ℹ️ **Non mesuré, conséquence d'E0a** : le TTL ne ramasse plus un flux distant resté
  `readyState: 'live'` après un départ brutal sans `close` PeerJS. **Le seul filet qui reste est la
  fermeture ICE** — PeerJS 1.5.4 ferme la connexion sur `iceConnectionState === 'failed'`. La
  présence n'en est pas un (item suivant). La question « une piste distante peut-elle rester `live`
  après la disparition du pair ? » n'a pas de réponse sous happy-dom. Mesure : deux navigateurs,
  couper le RÉSEAU de B sans fermer son onglet, attendre plus de `STREAM_STALE_MS`, faire entrer C,
  lire `Debug.vue` et la vignette de B. Coût borné par le FIFO (12).

- [ ] 🟢 **Le `leaving` de présence OUBLIE les connexions du pair sans les FERMER — et son
  commentaire dit « Fermer »** `[S]` — 🟠 à l'ouverture, ramené à 🟢 le 26/10/2026 (voir ✅). Relevé le
  26/10/2026 par la relecture du lot E, lu et énuméré, non exécuté ; **antérieur au lot**. La branche
  `removedUsers` de `useConnectionPool.syncUsersConnections` appelle `clearConnectionsRoom`, qui est un
  simple `delete` dans le store : aucun `close()`, aucune purge de `remoteStreamsMap`. La
  MediaConnection vers le partant sort donc du store sans que CE chemin la ferme — en départ
  brutal, elle reste orpheline jusqu'à l'échec ICE (en départ propre, PeerJS la ferme : ✅ plus bas) ; et
  `handleRemoteDeparture` n'a que deux appelants, `remoteStopCall` (signal serveur) et
  `handleStreamRemoved` (fermeture PeerJS) — **aucun ne vient de la présence**.
  ⚠️ **Le commentaire du site le dit autrement** : « Fermer aussi la connexion 'screen' si elle
  existe », au-dessus d'un `clearConnectionsRoom`. Même espèce que l'« arrêt des flux, etc. » d'E0b —
  une phrase d'intention sur une ligne qui ne la tient pas.
  Correctif candidat : fermer — le `closePeerConnection` du store ferme les instances du type — au
  lieu d'effacer seulement ; ce qu'il fait ensuite du store est à lire avant d'écrire le
  correctif.
  ✅ **Mesuré par la vérif d'E (David, 26/10/2026) : en départ PROPRE, le player de B disparaît chez
  A immédiatement**, et aucun symptôme n'a été constaté. B ferme ses connexions à son démontage
  (`cleanupPeerConnection`, antérieur au lot E) ; A le voit par la fin de pistes ou la fermeture
  PeerJS, sans instrumentation pour dire laquelle. Et les MediaConnection que le `leaving` retire du
  store chez A sont **fermées par PeerJS lui-même d'après la source, non observé** : peerjs 1.5.4
  ouvre un canal interne pour toute MediaConnection et fait `dataChannel.onclose = () =>
  this.close()` (`dist/bundler.mjs`, l.1032). D'où le 🟢 : en départ propre, plus de défaut
  constaté ; le départ brutal est l'item « Non mesuré » ci-dessus ; reste le commentaire faux.

- [ ] 🟢 **Une remise à zéro en double dans `useCallManager`** `[S]` — mesuré le 29/08/2026 par
  contre-épreuve. `ctx.session.currentCallRoomId = null` (chemin `full` de `stopCallWithPeers`) est
  **strictement redondant** : `resetCallState()`, appelé juste après, refait le travail par
  `setCurrentCallRoomId(null)`. Neutraliser la ligne seule rougit **zéro** cas ; neutraliser le
  setter seul en rougit un ; neutraliser les deux en rougit quatre. Rien n'est cassé — c'est du
  code mort qui donne l'illusion d'un invariant tenu à deux endroits. Le supprimer, ou l'assumer
  par un commentaire disant qu'il est là pour l'ordre des opérations (il ne l'est pas : le setter
  du reset suit immédiatement).

- [ ] **Cleanup `AbortController`** : annuler les opérations longues à la destruction du contexte.

---

## Les boutons d'appel — ce que le lot F a ouvert le 31/08/2026

Tous mesurés **avant** d'être écrits ici, aucun n'est une impression de lecture.

- [ ] 🟠 **Le mute et la caméra ne sont annoncés à personne dans un appel 1-à-1** `[M]`

  `CallManagerBtn` bascule bien les pistes — `toggleAudioState` pose `track.enabled = false`, donc le
  pair entend du silence immédiatement — mais **aucune annonce ne part**, donc aucun badge « micro
  coupé » n'apparaît de son côté. `GroupLocalStreamBtn` le fait par `sendData`, ce qui est hors de
  portée ici, et pas pour une raison de câblage : **quatre pièces manquent**, toutes vérifiées.

  1. `usePeerConnections.js` n'ouvre `peer.connect()` que sur la branche `stream` — la branche
     `visio`/`vocal` n'a **aucun canal de données** (comparer `:454-467` et `:487-500`) ;
  2. `sendData` lit `session.onAirRoom`, figé à `'app'` à la construction du contexte, alors que les
     connexions d'appel sont rangées sous `currentCallRoomId` — et `sendData` n'accepte pas de room ;
  3. `Notifications.vue` ne passe **pas** d'`onDataReceived` à `initialize`, donc rien ne recevrait ;
  4. `PlayerHost.vue:23-32` ne câble ni `muted` ni `videoActive` : ils valent `false`/`true` pour
     toujours, si bien que le badge de `MediaBroadcastPlayer` n'est **jamais** rendu dans un appel,
     des deux côtés.

  Conséquence pour qui reprendrait : ce n'est pas « ajouter un `sendData` », c'est ouvrir un canal de
  données sur la branche d'appel. À dimensionner avant. En attendant, la borne est écrite dans
  `docs/modules/webrtc2/api.md`.

- [ ] 🟠 **En appel VOCAL, la barre offre un bouton caméra qui ne commande rien** `[S]` — sondé le
  29/10/2026 par la relecture (le drapeau bascule, aucune piste vidéo n'existe).
  `CallManagerBtn` affiche le bouton caméra quel que soit le type, et `isVideoEnabled` vaut `true`
  par défaut : la barre affiche « couper la caméra », alors que `vocal` interdit la capture vidéo.
  Le clic bascule le drapeau sans piste, puis « activer la caméra » ne rallume rien. On se croit
  vu, on ne l'est pas. Le bouton ne connaît pas le type d'appel (props : `status`, `isMuted`,
  `isVideoEnabled`) : le masquer en vocal demande de le lui passer.

  C'est aussi par ce bouton qu'un poste SANS caméra peut entrer dans un appel visio avec la caméra
  « coupée ». Depuis le lot caméra (29/10), une caméra coupée n'est plus demandée : un bouche-trou
  tient sa place, et la capture passe. Le repli fermé, sans bouche-trou possible, fait exception :
  il la demande encore, et son échec sort l'appel proprement (`flux.md`). Le cas
  voisin en VISIO (caméra coupée reportée qui ne se rallumait plus, appelant privé de la vidéo de
  l'appelé) est corrigé le même jour : `flux.md`, « Ce qu'un appel hérite du précédent ».

- [ ] 🟢 **Une caméra rallumée pendant l'invite est recapturée pour un appel annulé pendant
  l'invite** `[S]` — mesuré le 30/10/2026 par la relecture de la clôture du lot caméra, en harnais
  happy-dom, côté appelant, dont la barre offre ses bascules dès CONNECTED. Le repli audio qui
  faisait la double capture du 29/10 a disparu avec le lot. Mais `startCurrentStream` lance
  `applyVideoState()` sans l'attendre, AVANT la garde de room d'`_enterCallSession`. Caméra coupée,
  rallumée pendant l'invite, appel annulé pendant l'invite : deux captures, `{ video: false,
  audio: true }` puis `{ video: true }`. La caméra est arrêtée dès son arrivée, et l'état final
  est propre (IDLE, aucun flux). Mais la première capture ne demandait PAS la caméra : en vrai
  navigateur, la seconde peut ouvrir une invite de permission caméra pour un appel annulé (non
  mesuré). Piste : n'aligner la caméra qu'après la garde de room, ou passer à `startCurrentStream`
  un prédicat « encore voulue ? ».

- [ ] 🟠 **`isValidCallType` reste trop permissif sur les trois chemins ENTRANTS** `[S]`

  Le chemin sortant normalise depuis le lot F (`normalizeDirectCallType`), mais `useCallManager.js`
  garde `isValidCallType` dans `acceptCallFromPeer`, `openCallBetweenPeer` et `remoteStopCall` —
  délibérément : ils sont symétriques de ce que les autres onglets émettent, et les durcir sans
  mesurer casserait la compatibilité entre deux versions du bundle. Le constat reste : un `type: 'screen'` **forgé** y pose `session.currentType = 'screen'`
  chez le récepteur. C'est un arbitrage de sécurité, pas un correctif de widget — à traiter avec
  `docs/modules/webrtc2/securite.md`, jamais séparément.

- [ ] 🟢 **Une relance partie avant une annulation peut poser une alerte morte** `[S]` — lu le
  27/10/2026 par le lot du bouton « annuler », non sondé. Une relance d'invitation partie avant
  l'arrêt, arrivée après l'annulation chez un appelé qui n'avait pas vu la première, pose une alerte
  pour une invitation morte. S'il accepte, il passe en RECEIVING sans personne en face — et en sort
  par « annuler », depuis le bouton.

- [ ] 🟢 **Cosmétique : une alerte remplacée pendant que son chunk pend journalise « Async component
  timed out »** `[S]` — mesuré le 27/10/2026 par la relecture du refus discriminant. Le minuteur de
  `defineAsyncComponent` survit à l'instance remplacée et journalise à son ancienne échéance. Sans
  effet fonctionnel.

- [ ] 🟢 **Observé une fois, non reproduit : une alerte sœur encore cliquable 2,8 s après la réponse
  d'un autre appareil** `[S]` — vu le 29/10/2026 pendant la vérif « décroché ailleurs », sur deux PC
  (bob : Edge sur `.12` et Edge sur `.11`, alice : Chrome sur `.11`). Heures du journal nginx :
  invitation à 15:46:38Z, réponse de `.12` à **+10,15 s** — la signature d'un auto-refus (même écart
  qu'à 15:55:35Z, où les deux appareils ont auto-refusé à 15 ms d'écart), sans preuve ; puis
  **acceptation** de `.11` à 15:46:51Z, donc un clic sur une alerte encore affichée, qu'alice a
  ignorée (« acceptation d'appel sans invitation en vol »). `.11` n'a envoyé aucun auto-refus vers
  +10 s : son alerte est montée **après** 15:46:41Z, plus tard que celle de `.12`. Son WebSocket est
  resté ouvert tout du long ; `laravel.log` ne montre aucun échec de diffusion ; Reverb ne journalise
  pas les messages, donc la livraison de `.InvitationAnswered` à `.11` n'est pas établie.
  **Non reproduit en trois essais le même jour** — acceptation sur `.12` à 15:55:54Z et 15:56:56Z,
  refus sur `.12` à 16:00:24Z : à chaque fois une seule réponse au serveur, et l'alerte de `.11`
  tombée. Seule condition propre à 15:46 : l'Edge de `.11` s'était **connecté** (login, pas un
  rechargement) 10 s avant l'appel. Parent possible de l'item « relance … alerte morte » ci-dessus,
  si cette alerte tardive venait d'une relance. **À la prochaine occurrence** : noter l'heure du
  login de l'appareil sœur, et lire sa console avant de cliquer.

- [ ] 🟢 **`acceptCallFromPeer` écrit l'allowlist AVANT une transition qui peut refuser, sans
  répondre** `[S]` — lu le 27/10/2026 en posant la garde du flux tardif, non sondé.

  Le commentaire disait la réponse `status: true` partie « transition refusée comprise » : faux,
  le `return` de la transition la précède (corrigé côté commentaire, pas côté code). Donc un appelé
  **déjà en appel** qui accepte une seconde alerte — le garde « occupé » ne porte que sur les
  alertes, pas sur les appels — inscrit l'appelant dans son allowlist et son mapping peerId, ne lui
  répond pas, et l'y laisse jusqu'à la fin de l'appel en cours ; l'appelant attend son abandon
  (≈55 s). Même classe que « la FSM ne protège que ce qui la suit » de `securite.md`. À trancher :
  refuser explicitement (répondre `false`) et ne marquer qu'après la transition, ou refuser en
  amont, dès l'alerte, quand un appel est en cours.

- [ ] 🟢 **Les appels depuis une room : voulus, différés — et la garde aveugle au `contextId` attend
  ce chantier** `[L]` — mesuré le 27/10/2026 par la relecture du lot « l'arrêt complet éteint
  l'invitation », **décidé le même jour (David) : les appels devront fonctionner dans les rooms,
  mais pas maintenant.**

  `securite.md` justifie l'absence de contrôle du `contextId` dans `openCallBetweenPeer` par
  « l'exiger casserait un appel initié depuis un provider de room ». Ce chemin est déjà cassé.
  Sonde, store partagé : un provider `visio-room42` invite, l'acceptation arrive au contexte de
  `Notifications` (`data-app`), qui reste IDLE et écrit alice dans SON allowlist, hors appel ; le
  provider reste en `calling`, sa chaîne va jusqu'à l'abandon (9 envois), et l'abandon tombe sur
  son signal, que personne n'observe. Raccrocher côté `Notifications` ne le touche pas.

  Inatteignable aujourd'hui : le seul appelant de `startCallWithPeer` est
  `Notifications.onStartCall`, et l'hôte n'en a aucun. **Donc `startCallWithPeer` reste sur la
  surface du provider** : la retirer fermerait un chemin voulu. Le chantier qui le fera marcher
  devra revoir ensemble quatre choses, qui supposent toutes qu'un appel vit dans le contexte de
  `Notifications` : la garde aveugle au `contextId`, la portée par contexte de
  `clearCallInvitesForContext`, le fait que la réponse n'arrive qu'à `Notifications` alors que
  la FSM et la chaîne vivent dans le provider — et, depuis le lot « une réponse ne vaut que pour
  SON invitation », une **collision de clé** : `invalidateRemotePeerId` garde les invitations,
  donc une invitation dont la room vaut l'`onAirRoom` du contexte (la forme même d'un appel depuis
  une room, `startCallWithPeer` posant `session.currentType` au type d'appel) étrangle la
  re-demande de peerId de ce contexte — mesuré par la relecture, 0 POST contre 1 avant.
  Inatteignable tant que `onStartCall` ne passe pas de room (room d'appel en UUID). Borne voisine,
  raisonnée et non mesurée : un `contextId` n'est pas unique par FSM (deux homonymes se chevauchent
  au remontage, `createPeerContext`), donc cette purge traverserait leurs deux FSM — inatteignable
  tant que `Notifications` n'est monté qu'une fois, même borne que la purge au démontage.

  ⚠️ **Cinquième chose à revoir, ajoutée le 27/10 par le lot du bouton « annuler » : trois
  discriminants supposent qu'une room n'est JAMAIS réutilisée** — le troisième ajouté le 29/10.
  Ce n'est vrai que parce que
  l'arrêt complet la vide et que `onStartCall` n'en impose aucune — `ensureCurrentCallRoomId`
  conserve ou impose autant qu'il tire. Si ce chantier passe la room de la salle à
  `startCallWithPeer({ room })` : (1) `Notifications.isCancelOfRingingInvitation` — A tab1 en appel
  établi avec moi dans la salle S raccroche pendant que l'alerte de A tab2 (room S) sonne →
  l'alerte tombe et le départ n'est PAS appliqué, l'appel établi n'est pas démonté (relecture,
  raisonné sur le code) ; (2) le garde du flux tardif de `_enterCallSession` — annuler puis
  rappeler dans la même salle laisse passer le flux de l'appel annulé ; (3) la garde de room de
  `handleRemoteDeparture` — raccrocher puis rappeler dans la même salle, et le raccroché tardif du
  premier appel coupe le second, le défaut même qu'elle ferme (raisonné). Remède commun : porter
  l'`inviteId` sur `.CloseConnectionToPeerID` (le serveur ne le relaie pas aujourd'hui) et le
  comparer, ou garder une room d'appel distincte de celle de la salle.

- [ ] 🟢 **Un arrêt complet qui lève laisse la room d'appel en place** `[S]` — relevé le 27/10/2026
  par la relecture du bouton « annuler », lu, non mesuré.

  Le `finally` de `stopCallWithPeers` remet la FSM à IDLE (`callMachine.reset()`) quand une
  exception a précédé `resetCallState` — par exemple dans `closePeerConnection` —, mais ne touche
  ni à `currentCallRoomId` ni au reste de la session (participants, allowlist). Conséquence
  nommée : le garde du flux tardif de `_enterCallSession` compare la room, qui n'a pas bougé — un
  flux arrivé après cet arrêt-là ouvrirait caméra et micro en IDLE, le défaut même que le garde
  ferme (borne écrite au garde). À trancher : vider la room avant `closePeerConnection`, ou faire
  du filet un `resetCallState` complet.

- [ ] 🟢 **`startCallWithPeer` ne distingue pas ses quatre refus** `[S]`

  Elle rend `null` sans dire pourquoi, alors que les causes appellent des messages **opposés** :
  « vous êtes déjà en appel » n'est pas « votre connexion n'est pas prête ». Le toast actuel
  (« Appel vers X impossible pour l'instant ») est donc volontairement vague. Un code de raison
  rendrait le message juste. Reporté sciemment : le lot F avait à fermer le cul-de-sac, pas à
  fignoler son libellé.

- [ ] 🟢 **Le bouton « raccrocher » reste cliquable pendant `closing`** `[S]` — **sortie D, avec son
  déclencheur écrit.**

  Mesuré : **`closing` n'est jamais peint.** `stopCallWithPeers` (l.308-383) ne contient aucun
  `await`, et ni `stopCurrentStream` ni `cleanupCallPlayers` n'en ont : CONNECTED → CLOSING → IDLE
  tient dans un seul bloc synchrone que l'ordonnanceur de Vue ne coupe pas. Ajouter
  `:disabled="status === 'closing'"` créerait donc un binding **prouvablement mort** — exactement ce
  que le lot D a refusé pour la branche `else` de `toggleFullscreen`. Et le second clic est inoffensif :
  `close-call` est idempotent par contrat, et la FSM refuse la transition avec un warn nommé.

  **Déclencheur** : si un `await` apparaît un jour dans `stopCallWithPeers` — l'item « drainer la
  file » en met un sur la trajectoire — alors `closing` devient peignable et l'arbitrage se rouvre.

- [ ] **Vérifier à l'écran la moitié visuelle du câblage** `[S]` — la classe `.btn-toggle-on` et sa
  spécificité. **Ce n'est pas un test et ça ne le sera pas** : `happy-dom` ne calcule aucune mise en
  page, et c'est la copie **hôte** du SCSS qui est compilée. Le contrôle est un rendu réel après
  `socializer:build`. Même nature que la géométrie de la vignette, et même arbitrage —
  [`docs/architecture/tests.md`](../docs/architecture/tests.md#cette-suite-ne-calcule-aucune-mise-en-page).

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

- [ ] **Extraire le cycle de vie du `Peer` de `usePeerTransport.js`** `[L]` — **à n'ouvrir qu'au
  déclencheur** : la prochaine passe qui touche au cycle de vie, ou le franchissement des **2000
  lignes** du fichier, quelle qu'en soit la cause (`wc -l` : 1988 le 30/10/2026). En dessous, ce
  seuil ne se rouvre pas.

  La décision du 29/08/2026 (sortie D), ses trois raisons et le ⚠️ « ne pas extraire l'admission
  entrante » sont dans
  [architecture.md § Ordre des couches](../docs/modules/webrtc2/architecture.md#ordre-des-couches).
  Le candidat : singleton `Peer` + rafraîchissement ICE + rafraîchissement de l'attestation, un
  bloc contigu sans lien avec le routage.

---

## Patterns proposés, non implémentés

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
