# Chantiers en cours

> **Ce dossier n'est pas de la documentation.** Il porte le suivi de travail : todo, audits,
> plans de tests, notes de chantier. Cases à cocher, chiffres et dates y sont les bienvenus.
> Le définitif vit dans [`docs/`](../docs/INDEX.md) — la règle de partage et le geste de clôture
> d'un chantier sont dans [`docs/ecrire-la-doc.md`](../docs/ecrire-la-doc.md).

Rien ici n'est à charger par défaut. On l'ouvre quand on reprend le chantier concerné.

**Chaque ligne du tableau dit ce qu'il faut pour DÉCIDER d'ouvrir le fichier, et rien de plus.**
Le détail est dans le fichier ; le récit est dans `git log`.

---

## Ordre de priorité

Aucun chantier ne passe devant les autres. L'ordre par défaut, tant que rien n'est demandé
explicitement :

1. Le module WebRTC2 au fil de l'eau : [webrtc2-todo.md](webrtc2-todo.md),
   [webrtc2-tests-plan.md](webrtc2-tests-plan.md).
   > ✅ **Plus aucun 🔴 ouvert.** Trois sont tombés : la vignette invisible et la fenêtre 3 le 28/08,
   > puis le **29/08 la boucle de rechargement de `/attest-peer-id`** — un invité recevait 401 sur
   > la page de login, `AjaxService` rechargeait, et personne ne pouvait se connecter (168
   > navigations en 20 s, mesuré ; 3 après correction). Restent des items de pérennisation, 🟢/🟠.
   >
   > ⚠️ **Ce 🔴-là n'a été trouvé qu'en OUVRANT la page, les deux suites étant vertes** — et il ne
   > se voyait pas sur cette machine, dont le cache `route:cache` était antérieur aux routes
   > d'attestation. Un cache construit au déploiement l'aurait rendu en production.
   >
   > 👉 **Par quoi reprendre, au 29/08 — trois choses, dans cet ordre :**
   > 1. **La tâche 7 du plan de tests** (`useMediaBroadcast`), dernière zone non couverte **de la
   >    logique** du module. ✅ **La tâche 6 est fermée le 29/08** — `usePeerOrchestrator` est
   >    couvert en quatre fichiers, sauf sa branche star qui attend le point 2.
   >    ⚠️ **Avant d'écrire quoi que ce soit pour la tâche 7, relire le code** : l'énoncé de la
   >    tâche 6 décrivait un fichier d'avant l'extraction des couches, sept de ses cases étaient
   >    déjà vertes un étage plus bas, et il ne listait pas trois verbes qui n'avaient aucun test.
   > 2. **(a) du routage star** — un `[S]` de 18 lignes qui libère le dernier cas bloqué, **et** qui
   >    est la préparation d'un futur SFU (décision du 29/08 : pas de SFU maintenant, porte ouverte
   >    pour une v2/v3, sans bâtir l'abstraction d'avance). ⚠️ Poser d'abord la question du 🟠 de
   >    concentration de `usePeerTransport` : (a) fait grossir ce fichier-là.
   > 3. **Le 🟠 `topology: 'sfu'`** — valeur annoncée, acceptée, qui produit un contexte mort sans un
   >    log. Petit, et c'est lui qui empêche la v2 de partir sur une prémisse fausse.
   >
   > Les items de mock, d'observabilité et de robustesse peuvent attendre. **L'item de sécurité
   > `[L]` du chemin (a) est fermé le 29/08/2026** — attestation signée portée par la `metadata`,
   > les deux voies de l'énoncé écartées — **et sa mesure de bascule l'est aussi le même jour** :
   > journal serveur sur le verdict refusé, trois compteurs rendus par `Debug.vue`, procédure écrite.
   > Il ne reste qu'un geste de DÉPLOIEMENT, pas de code :
   > `SOCIALIZER_PEER_ATTESTATION_ENFORCE=true`, sur les trois termes de
   > [securite.md § « Ce qu'il faut regarder pour basculer »](../docs/modules/webrtc2/securite.md#ce-quil-faut-regarder-pour-basculer-enforce)
   > — dont un qui reste une **borne assumée**, non mesurable sur un serveur.
   >
   > ⚠️ **La tâche 8 du plan de tests est neuve (29/08) et n'est dans aucun des points ci-dessus** :
   > l'étage `Widgets/**` a 13 fichiers sur 15 sans aucun test, et c'est de là que venait le dernier
   > 🔴. Elle ne bloque rien, mais la santé de la suite ne dit rien de cet étage.
2. [doc-rustines.md](doc-rustines.md) — le volet de ce paquet dans le chantier transverse. L'ordre
   des lots est fixé par [le `work/` du projet hôte](../../../../work/README.md).

> ⏸️ **[projection-graphe-todo.md](projection-graphe-todo.md) est suspendu — au besoin seulement.**
> Ses items restants sont 🟢/🟠 et ne bloquent rien. **Ne pas le rouvrir parce qu'une lecture de code
> y ramène** : y verser un constat sans rouvrir le chantier est l'usage prévu. La raison de la
> prudence est dans son en-tête — chaque item y *paraît* petit et adjacent au précédent, et c'est
> exactement comme la dérive s'est produite.

---

## Hors chantier — la seule garantie qui manque au paquet

- [ ] 🟠 **Aucune CI : le seul filet est un hook local** `[S]` — relevé le 29/08/2026 au point
  d'étape QA. Il n'y a pas de fichier de chantier pour ça et il n'en faut pas ; l'item vit ici.

  Le hook [`hooks/pre-push`](../hooks/pre-push) est bon et il est actif sur cette machine
  (`core.hooksPath=hooks`, vérifié). Mais **deux propriétés le rendent insuffisant comme garantie** :
  c'est un `git config` **par clone** — un clone neuf n'a rien — et il **dégrade en autorisant le
  push** quand les dépendances manquent, ce qui est le bon comportement pour un hook et le mauvais
  pour une garantie. Rien n'empêche donc structurellement qu'une suite rouge parte sur `origin`.

  Ce que ça coûterait de poser : rejouer les deux suites, qui ne tournent pas au même endroit — PHP
  dans le paquet (Testbench, aucun serveur, `composer install && vendor/bin/phpunit`), **JS depuis un
  hôte** puisque le paquet n'a ni `package.json` ni `node_modules`. **C'est là qu'est le vrai coût**
  : la CI JS doit reconstituer un hôte minimal portant `vitest.config.js` et l'alias `~socializer`,
  ou vendre le paquet dans un hôte de test. À dimensionner avant de s'y mettre.

  ℹ️ Sans objet tant que le développement se fait à une seule main sur `refacto-webrtc` — le hook
  suffit alors. Ça cesse d'être vrai **le jour où quelqu'un d'autre clone**, ou le jour où un projet
  consommateur épingle un tag ; c'est à ce moment-là que cet item devient bloquant, pas avant.

---

| Fichier | État | En une phrase |
|---|---|---|
| [webrtc2-todo.md](webrtc2-todo.md) | ouvert, **aucun 🔴** | **La mesure de bascule d'`enforce` est CLOSE le 29/08/2026** — un `Log::warning` sur le verdict refusé (avec sa cause, jamais l'attestation), trois compteurs rendus par `Debug.vue`, et la procédure écrite. L'énoncé disait « c'est la moitié serveur qui tranche » et c'était **faux** : un pair sans attestation n'appelle jamais la route, donc le journal est structurellement aveugle au cas majoritaire de la phase d'observation — déjà épinglé par un test, sans que la conséquence ait été tirée. D'où trois compteurs et non deux, le neuf séparant deux populations qui appellent des décisions **opposées** (une forge s'enquête, un onglet ancien s'attend), et une borne assumée écrite plutôt qu'un chiffre unique, qui n'existe pas — les deux moitiés n'ont aucun dénominateur commun. Reste **le 🟠 `[L]` de concentration de `usePeerTransport`** (797 → 1889 lignes en 16 jours, sept responsabilités), question à poser **avant** (a) du routage star. Le fichier porte aussi désormais la liste de ce qui a été **contrôlé et tient**, pour ne pas re-payer la mesure. — items de pérennisation du module : deux écarts de fidélité du mock PeerJS, observabilité. **L'item de sécurité `[L]` du chemin (a) est CLOS le 29/08/2026** — attestation signée portée par la `metadata`, et les deux voies de l'énoncé écartées : l'annuaire portait une course invisible (`/ask-to-peer-id` ne porte aucun peerId, donc l'autorité répondrait « pas encore » et non « non »), et le raccourci qui la contournait rouvrait l'auto-inscription de mai. Ce que la voie « identité intrinsèque » plaçait hors du paquet ne l'était qu'à moitié : le client tirait DÉJÀ son UUID, donc il peut le faire attester avant `new Peer`, sans fenêtre. Trois découvertes hors énoncé — l'attestation ne sert à rien en mesh ordinaire (le mapping corrobore déjà, un seul cas la rend nécessaire), le verdict devait aller dans un registre distinct du mapping, et un vérificateur muet doit valoir ADMISSION même sous `enforce`. Restent deux bornes assumées : le rejeu borné par le TTL (fermeture hors paquet, côté serveur PeerJS) et `enforce` faux par défaut, qui est l'ordre des opérations et non une timidité. **Deux items neufs le 29/08, tous deux trouvés en écrivant des tests et tous deux épinglés avant d'être ouverts** : un 🟢 d'asymétrie (`sendData` ne contrôle la taille qu'en mesh, pas en star — sans brèche, la réception rattrape), et un 🟠 de correction réelle, la clé de minuteur de `usePeerRetry` qui périme sur changement de room et fait **survivre la mauvaise chaîne d'invitation** — l'abandonnée relance et efface le créneau de la vivante. **La sémantique de `peerInitPromise` est close le 29/08** : `_doInit` attend réellement l'`'open'`, donc « init terminée » veut enfin dire « pair joignable ». L'énoncé promettait de laisser les appelants s'y raccrocher — **réfuté** : `acceptCallFromPeer` doit poser `addRemotePeerId` avant l'arrivée du `peer.call` de l'initiateur, et un refus entrant ne revient jamais à l'émetteur ; les trois appels de production restent nus. Le gain réel n'était pas dans l'énoncé : le **délai** `PEER_OPEN_TIMEOUT_MS`, qui ferme un blocage définitif — un `Peer` dont la socket s'ouvre sans que le serveur envoie son `OPEN` restait vivant en `connecting` pour la vie de l'onglet, et la garde d'instance interdisait alors toute ré-init, sans un log ; seul un F5 réparait. Il **détruit** l'instance, sans quoi il aurait fabriqué un peerId fantôme de plus. La passe a fait tomber la preuve « le `.catch` n'a besoin d'aucune garde d'identité » et l'a remplacée par un test, découvert que la couverture n'était qu'à moitié faite sans réordonner les gardes (la garde d'instance précédait celle de la promesse, donc un second consommateur sortait sur un `undefined` immédiat), et corrigé un préalable de harnais annoncé fait : `vi.waitFor` avance l'horloge factice de 50 ms par tour. **L'id historique qu'un échec d'init laissait derrière lui est nettoyé le 29/08** : une ligne, et le premier test qui exerce ce `.catch`. Le seul chemin qui y menait suppose une instance abandonnée par PeerJS puis une ré-init échouée — toutes les autres destructions passent déjà par `resetPeerState()` ; et `resetPeerState()` dans le `.catch` aurait été le piège, il désarme l'audit du `.finally`. **La machine à états du cycle de vie du `Peer` est close le 29/08** : un fait déclaré unique (`peerPhase`, cinq transitions) remplace `localPeerReady` et l'usage de `peerInitPromise` comme état, `peerIdentity()` devient le seul chemin de lecture de la production, et trois getters plus trois setters sans appelant disparaissent. La panne silencieuse est tombée d'abord et seule — `waitForMeReady` lisait l'identité HISTORIQUE et répondait « prêt » sur un peer détruit ; la sémantique retenue est d'**attendre**, pas de répondre `false`, sinon un backoff en vol ferait abandonner les quatre consommateurs. Deux arbitrages portent la passe : une transition inattendue est **appliquée puis journalisée** (l'inverse de `useCallStateMachine`, qui arbitre des actions là où la phase ne fait que suivre PeerJS), et **l'observation l'emporte sur la déclaration** — sans quoi la phase serait un septième prédicat menteur. Elle a réfuté son propre chiffrage (68 cas annoncés, 10 assertions réelles) et sorti un mensonge du double : `localPeer` et `getLocalPeer` y étaient deux champs indépendants, que le store réel ne peut pas faire diverger. **La chaîne de présence est close le 29/08** avec son dernier item, la « fraîcheur de `roomMembers` » : la passe a réfuté l'énoncé sur les quatre points — une sourdine passe d'abord par un vidage, `roomMembers['data-app']` n'existe jamais, le veto est correct pendant une coupure pusher, et un `removeRemotePeerId` plus agressif serait une régression de sécurité. Ce n'était pas un contrat de fraîcheur mais un contrat de **propriété**, et le vrai défaut était ailleurs : un tour de présence en vol ressuscitait l'entrée d'un contexte détruit — le seul épinglage réellement permanent du module, atteignable par une navigation SPA — pendant que le démontage d'un homonyme emportait l'allowlist du vivant, fail-closed et sans rattrapage. Deux gardes sur des mécanismes déjà en place ferment les deux ; `isUserInAnyRoom` n'a pas été touché. **La migration de `remotePeers` vers Pinia est close le 29/08** : `roomMembers[contextId]` est la source unique, `connection.remotePeers` un accesseur en lecture seule au-dessus d'elle (donc ~25 lectures de production et ~55 semis de test inchangés), et `_diffLock` est parti. L'énoncé promettait l'atomicité et la réactivité : les deux étaient déjà là — le gain réel est un chemin d'écriture unique vers l'allowlist des deux gardes d'autorisation. La passe a réfuté la consigne de l'item de fraîcheur voisin, qui reste ouvert : un TTL sur l'entrée fermerait silencieusement l'allowlist d'une room calme, la péremption appartient à la lecture d'`isUserInAnyRoom`. Et la parade contre le mode de panne silencieux est devenue permanente — aucun setter en production, plus un grep qui interdit d'en réintroduire un. **Le renommage de `usersInRoom` en `remotePeers` est clos le 28/08** : le nom promettait « les membres de la room » et livrait les seuls pairs distants, à l'endroit précis où il sert d'allowlist aux deux gardes d'autorisation. L'énoncé voulait garder un `usersInRoom` neutre — écarté, aucun lecteur ne le voulait, et il aurait rendu au nom le sens inverse du sien sans lever d'erreur ; le computed compensatoire `allUsersInRoom` est supprimé, pas renommé. La passe garde sa parade au mode de panne silencieux d'un renommage de champ de `connection`. **Le client star qui composait un hub absent est clos le 28/08** : la branche client est devenue la branche mesh filtrée sur le hub, ce que seule la réconciliation du fan-out rendait possible — le couplage annoncé s'est vérifié. Elle a emporté un second défaut absent de l'énoncé, le `preserveRetry` manquant, et écarté `isHubConnected`, qui ne disait que la moitié du prédicat. La **re-composition sur perte de connexion** est close le 28/08 : elle ferme le dernier cas de la chaîne de présence, celui où aucun tour n'a lieu du tout, et elle a réfuté l'énoncé de son propre item — `handleRemoteDeparture` ne voit jamais une fermeture sortante, donc aucune frontière de couche n'était en jeu. La section « Annonce de diffusion » est **close le 28/08** : ses trois fenêtres sont fermées par un quatrième chemin, le whisper sur le canal de présence, seul porteur indépendant de la signalisation P2P. Elle garde les trois faits appris en le posant — dont « une clé `accept_client_events_from` absente vaut `'all'` » et la course annonce/annuaire — et nomme la seule borne restante, qui est d'affichage et assumée. **Le `[L]` « déplacer le routage star » est dégelé et SCINDÉ le 29/08**, après relecture de ses trois affirmations, dont aucune ne tenait : ce n'était pas 245 lignes mais **18**, le filet qu'il attendait existe (45 fichiers de test), et il ne bloquait pas deux tâches mais **un cas sur 27**. La relecture a surtout trouvé ce que l'item ne disait pas : le wrap `onDataReceived` mixe trois couches et `usePeerTransport` ignore `useBroadcastPresence` — **seule la décision star peut descendre, pas le wrap**. Reste **(a)**, un `[S]` mûr ; **(b)**, le routeur générique, est **tranché en sortie D le 29/08** — pas de SFU pour l'instant, la porte reste ouverte pour une v2/v3, mais on ne bâtit pas l'abstraction d'avance : ce qui tient la porte ouverte est la **couture**, relevée dans l'item (la topologie n'est lue qu'à **sept endroits, dans quatre fichiers**), et (a) elle-même, puisqu'un SFU est « star dont le hub est un serveur ». L'instruction de la question a sorti un 🟠 neuf : **`topology: 'sfu'` est annoncé dans trois docblocks, accepté, et produit un contexte mort SANS UN LOG** — ni connexion ni envoi. À faire échouer bruyamment, sans quoi la v2 partirait de « c'est déjà à moitié câblé ». |
| [webrtc2-tests-plan.md](webrtc2-tests-plan.md) | ouvert, **tâche 6 FERMÉE le 29/08 ; tâche 8 AJOUTÉE le 29/08** | **Tâche 6 close** — `usePeerOrchestrator` en quatre fichiers (`broadcastPresence`, `callbacks`, `teardown`, `media`), 41 cas, 28 contre-épreuves mesurées. Son énoncé décrivait un fichier d'avant l'extraction des couches : sept cases étaient déjà vertes chez `useConnectionPool` / `useStreamManager` / `useCallManager`, et il ne listait pas `toggleAudioState`, `toggleVideoState` ni `stopAudioStream`, qui n'avaient aucun test nulle part. Seule reste la branche hub du wrap `onDataReceived`, qui attend (a). **Quatre contre-épreuves ont rougi ZÉRO cas au premier passage, et les quatre fois la faute était dans le test** — un périmètre à un seul pair, une seule connexion ou un seul type ne distingue pas « cible précise » de « tout le monde » ; la leçon est remontée dans `docs/modules/webrtc2/tests.md`. Reste la **tâche 7**, et le même avertissement vaut pour elle : relire le code avant de croire l'énoncé. — **Tâche 8 neuve** : l'étage `Widgets/**` — 12 fichiers sur 15 sans aucun test, dont 10 des 12 composants `.vue` (`Debug` a été couvert par la bande le 29/08, sur son seul bloc de corroboration d'identité). Ce n'est le reste d'aucune tâche existante, et c'est de là que venait le dernier 🔴 (vignette à 0 px), invisible à une suite verte. Elle porte le piège déjà payé : `isVisible()` de Playwright rend `true` sur un élément clippé par un ancêtre. — les tâches 1 à 5 sont fermées (les quatre derniers trous — `sendData` star, câblage du rate-limit hub, taille du chemin hub, `contextRegistry` — l'ont été le 29/08). Restent 6 (`usePeerOrchestrator`) et 7 (`useMediaBroadcast`) : elles étaient déclarées bloquées par le `[L]` gelé, vérification faite **un seul cas sur 27** l'est réellement. C'est le plus gros volume de tests écrivable immédiatement du module. Porte les pièges de harnais mesurés — les lire avant d'écrire un test de ce module. |
| [doc-rustines.md](doc-rustines.md) | 🟠 démarré — **lot 0 terminé** | rendre la doc exempte d'annotations qui compensent un défaut du code. Le lot 0 (annotations déjà fausses) est fermé. Vient ensuite la v1 WebRTC, déclarée morte mais **encore importée par cinq composants vivants**. |
| [projection-graphe-todo.md](projection-graphe-todo.md) | ⏸️ **suspendu — au besoin seulement** | suites du correctif « un utilisateur = un mur + un feed ». Rien n'y bloque ; deux items portent une exigence d'exploitation (sauvegarder le space NebulaGraph, que rien ne reconstruira). |
| [chat-tests-plan.md](chat-tests-plan.md) | **non démarré** | plan de tests du Chat en 5 couches. Un seul fichier de test existe. Une décision en attente : helpers dédiés ou partagés (`mockEcho`, `mockRoute`, `seedChatStore`). |
| [front-todo.md](front-todo.md) | **non démarré** | deux items. Le ping d'ouverture de session part avant que pusher n'ait confirmé l'abonnement, et Reverb le rejette — l'utilisateur peut rester hors ligne deux minutes ; le correctif naïf (`subscribed(cb)`) ne part jamais sur un canal déjà confirmé. Et `isEmpty(element.store)` lève sur un commentaire de post chargé par la liste, **dans un listener Reverb donc en silence** — quatre appelants, deux étages possibles pour le correctif. |
| [sass-todo.md](sass-todo.md) | **non démarré** | de la dette de style, et seulement ça depuis que le 🔴 « vignette d'attente invisible » est parti dans le chantier WebRTC2 qui l'avait produit (fermé le 28/08, sans rien devoir à ce fichier). Restent : thème sombre cassé par des couleurs en dur, absence de `_variables.scss` propre au paquet (arbitrage A/B à trancher), URL d'image externe en prod, et les `@extend` de classes Bootstrap à migrer. |
