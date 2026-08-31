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
   > ✅ **(a) du routage star est FAITE le 29/08** — `routeIncomingData` porte le prédicat dans le
   > transport, `forwardStarMessage` n'est plus exporté, et le dernier cas bloqué du plan de tests
   > est écrit (il en a donné trois). Le 🟠 de concentration de `usePeerTransport` a été tranché
   > **avant**, en sortie D : pas d'extraction maintenant, déclencheur écrit (prochaine passe sur le
   > cycle de vie, ou 2000 lignes).
   >
   > ✅ **Le 🟠 `topology: 'sfu'` est FAIT le 30/08** — et il a fermé son jumeau de
   > [doc-rustines.md](doc-rustines.md) (lot 1) dans la même passe, comme annoncé. Il a aussi fermé
   > un second contexte mort que son énoncé ne nommait pas, `star` **sans** `hubSlug` : mêmes
   > prédicats composés, même silence. La passe a surtout trouvé que **trois tests épinglaient ces
   > états morts comme s'ils étaient voulus** — tous verts, tous via des doubles, donc invisibles à
   > une suite verte ; requalifiés, pas supprimés.
   >
   > ✅ **Les lots A, B et V de la tâche 8 sont FAITS le 30/08** — l'étage `Widgets/**` passe de 4 à
   > 8 fichiers couverts sur 15, et **le 🟠 du refus de permission caméra est fermé** : les trois
   > démarrages notifient par AWN, le cas maître vu rouge avant le correctif. La passe a fermé deux
   > défauts en passant (`api` déclaré optionnel alors que le template le déréférence ; le câblage
   > `@stop_audio` mort des deux côtés) et **corrigé trois affirmations fausses** — dont le
   > décompte « 3 couverts » de l'énoncé, qui en valait 4, et le périmètre `Widgets/**`, alors que
   > le site du 🔴 vit sous `Exemples/` (qui est de la production, le nom du dossier ment).
   >
   > ⚠️ **Trois contre-épreuves ont rougi ZÉRO cas, et les trois fois la faute était dans le
   > test.** C'est la troisième passe consécutive où ce motif revient. L'une d'elles a fait
   > supprimer un cas plutôt que le commenter : « le rejet s'échappe-t-il ? » est **intestable à
   > travers un espion**, qui absorbe le signal `unhandledRejection`.
   >
   > ✅ **Le lot C est FAIT le 31/08** — la boucle `AUDIO_MUTE_TOGGLE`/`VIDEO_ACTIVE_TOGGLE` est
   > épinglée de bout en bout, en trois fichiers, et l'étage `Widgets/**` passe à 10 couverts sur
   > 15. **Ce n'était pas qu'un lot de tests : trois corrections de production en sont sorties** —
   > le garde inatteignable supprimé (0 cas, trois passes), `immediate: true` ajouté (trois cas vus
   > rouges d'abord), et un défaut neuf, une **file poubelle `"undefined"` commune à tous les
   > partages d'écran**, dont la clé était exactement celle qu'écrit un dispatch sans connexion.
   >
   > ⭐ **Le chiffre qui vaut le lot est un 0 croisé** : casser l'un ou l'autre bout du joint
   > `conn.peer` rougit 3 et 2 cas du fichier de bout en bout, et **0 cas** des deux fichiers
   > d'étage. La boucle peut mourir entièrement pendant que les deux couches restent vertes — c'est
   > le mode de panne que ce lot ferme, et la raison pour laquelle un test par étage n'aurait rien
   > donné.
   >
   > ⚠️ **L'énoncé se trompait de périmètre, et le suivre aurait mélangé deux harnais** :
   > `useMediaControls` n'est **pas** dans la boucle (composable purement DOM). Il part au lot D.
   > Deuxième piège payé cash : **un commentaire HTML en tête de `<template>` coupe le fallthrough
   > des attributs** — l'explication d'un retrait, écrite là, a cassé ce qu'elle expliquait, et le
   > contrôle mesuré juste après a rendu un chiffre qui n'était pas le sien. D'où la règle : **un
   > contrôle dont la référence n'a pas été relue à 0 ne mesure rien.**
   >
   > ✅ **Le lot D est FAIT le 31/08** — les contrôles de la vignette (plein écran, PiP, mute natif)
   > sont épinglés en deux fichiers plus un helper, l'étage `Widgets/**` passe à 12 couverts sur 15,
   > et **quatre corrections de production en sont sorties, dont DEUX que l'énoncé ne nommait pas** :
   > le recyclage d'un slot laissait la fenêtre PiP ouverte, qui affichait alors le flux suivant sous
   > l'identité du précédent — sans bandeau, et sans aucun bouton pour la fermer puisque la vignette
   > est masquée ; et le mute natif ne suivait pas sur la branche audio, donc **un pair qu'on avait
   > coupé se faisait réentendre dès qu'il éteignait sa caméra**. Plus la comparaison manquante du
   > PiP (deux vignettes, le PiP d'un tiers volé) et la sortie B des deux drapeaux menteurs, qui a
   > laissé le composable **sans aucun import de Vue**.
   >
   > ⭐ **Le chiffre qui vaut le lot : renommer `nativeVideo` chez `~estarter` rougit 8 cas du
   > fichier qui monte le vrai lecteur, et 0 du fichier composable.** Le joint testé EST le nom : un
   > stub qui expose `nativeVideo` valide sa propre orthographe — et le dépôt en avait le cadavre,
   > `AudioPlayer` exposant `nativeAudio`. C'est cette mesure qui interdit de stuber le lecteur, pas
   > une préférence de style. Second 0 utile : le `v-if="videoActive"` des contrôles rougit 0 cas ici
   > et **2 dans deux fichiers antérieurs**, ce qui prouve qu'il ne fallait pas les dupliquer.
   >
   > ⚠️ **Deux affirmations de l'énoncé ne tenaient pas.** La comparaison à `el` n'était un défaut
   > que pour le **PiP** : côté plein écran, `el` est la `<video>` nue et nos boutons sont ses frères,
   > donc non peints — la branche `else` est **déjà** morte, et « corriger » l'aurait rendue
   > prouvablement morte. Et la sentinelle `null` par slot `#video` est une **capacité du contrat**,
   > pas un chemin existant : le chemin atteignable, que l'énoncé ne nommait pas, est toute la
   > branche audio. Piège payé sur les contrôles eux-mêmes : **pour mesurer un `catch`, il faut
   > retirer le `try` avec lui** — sinon la suite ne compile plus et le 0 se lit « inutile ».
   >
   > 👉 **Par quoi reprendre : le lot E** — `LocalMediaPlayer` + `MediaBroadcastProvider`. Il arrive
   > avec son item déjà mesuré (`v-bind="$attrs"` redondant, 0 cas rougis sur le jumeau) et son
   > piège écrit (un commentaire HTML avant la racine coupe le fallthrough : l'explication du retrait
   > va dans le `<script setup>`). Le harnais du lot D est réutilisable tel quel :
   > `helpers/fakeFullscreen.js` pour le plein écran / PiP, et le précédent « monter les vrais
   > lecteurs `~estarter` » plutôt que des stubs.
   >
   > ⚠️ **Rien de tout cela n'est livré** : le paquet n'a **aucun tag** et le `composer.lock` de
   > l'hôte épingle un commit du 29/05, plus de cent commits derrière. C'est le 🔴 restant de
   > [`work/deploiement-tiers.md`](../../../../work/deploiement-tiers.md) du projet hôte.
   >
   > ✅ **Les tâches 6 et 7 du plan de tests sont fermées les 29/08.** La 7 confirme la leçon de la
   > 6, en plus dur : **son énoncé demandait un test qui aurait fait régresser le code.** Huit de
   > ses onze cases étaient des doublons stricts un étage plus bas, trois n'étaient couvertes que
   > par morceaux, et la dixième affirmait un comportement que `useStreamManager.test.js` épingle à
   > l'envers depuis l'extraction des couches. Ce qui restait n'était dans aucune case. **Relire le code avant de croire un énoncé n'est pas une précaution,
   > c'est la première étape de la tâche.**
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
   > ⚠️ **La tâche 8 reste la seule ouverte au plan de tests**, mais elle ne bloque plus rien depuis
   > le 30/08. Restent les lots **E et F** — trois fichiers, aucun sur un chemin critique.
   >
   > ✅ **Le 🔴 de la vignette est désormais épinglé par ses deux moitiés** : le contrat DOM dans la
   > suite (`StreamSimpleUI.awaited.test.js`), la géométrie dans un harnais versionné lancé à la
   > main (`tests/visual/`, **sortie D** — `happy-dom` ne calcule aucune mise en page, la case ne
   > sera jamais cochable dans la suite). Pas de `@playwright/test` dans les dépendances de l'hôte :
   > sans CI, une suite Playwright et un script `node` ont la même couverture réelle.
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
| [webrtc2-todo.md](webrtc2-todo.md) | ouvert, **aucun 🔴** | **Sept items neufs le 31/08/2026, ouverts par le lot D et tous mesurés avant de l'être** : deux 🟠 — le bouton `Fullscreen` est un **aller sans retour** (`el` est la `<video>` nue, nos contrôles sont ses frères et ne sont pas peints ; c'est pourquoi sa branche `else` est déjà morte et n'a PAS été « corrigée »), et dans le pool un appel **vocal** prend la branche vidéo, donc le bouton PIP y rejette en silence — plus cinq 🟢 : le slot `#controls` qui ne permet pas de reproduire ses propres gardes (et rouvre l'écho), `showSpinner` qui teste la forme du slot au lieu de la sentinelle (mesuré contre `ensureValidVNode`), le drag qui démarre sur un appui sur les boutons, le z-index inline monotone de `onBringToFront`, et les deux `catch` muets face à la convention du toast établie par le lot B. — **L'item `useRemotePeerState` est CLOS le 31/08/2026** — ses deux moitiés ont tenu (garde inatteignable supprimé après 0 cas mesuré trois fois ; `immediate: true` ajouté, la piste non vérifiée était juste), et une troisième correction est sortie en chemin : la file poubelle `"undefined"` des partages d'écran. Quatre items neufs, tous 🟢 et tous **mesurés avant d'être ouverts** : la coalescence tous types confondus (renvoyée au drain de la file, pas un item neuf), l'état initial jamais semé (sortie D, avec son piège `?? false` écrit — un semis naïf basculerait tout le monde sur la branche audio), l'absence de réinitialisation au changement de `peerIdSource` (sortie D, inatteignable en production), et le `v-bind="$attrs"` redondant restant dans `LocalMediaPlayer`. — **La mesure de bascule d'`enforce` est CLOSE le 29/08/2026** — un `Log::warning` sur le verdict refusé (avec sa cause, jamais l'attestation), trois compteurs rendus par `Debug.vue`, et la procédure écrite. L'énoncé disait « c'est la moitié serveur qui tranche » et c'était **faux** : un pair sans attestation n'appelle jamais la route, donc le journal est structurellement aveugle au cas majoritaire de la phase d'observation — déjà épinglé par un test, sans que la conséquence ait été tirée. D'où trois compteurs et non deux, le neuf séparant deux populations qui appellent des décisions **opposées** (une forge s'enquête, un onglet ancien s'attend), et une borne assumée écrite plutôt qu'un chiffre unique, qui n'existe pas — les deux moitiés n'ont aucun dénominateur commun. Le 🟠 `[L]` de concentration de `usePeerTransport` (797 → 1949 lignes, sept responsabilités) est **tranché en sortie D le 29/08**, comme sa consigne le demandait — avant (a) et non après : pas d'extraction du cycle de vie maintenant, (a) n'ayant ajouté que 11 lignes de code, et un déclencheur écrit (prochaine passe sur le cycle de vie, ou 2000 lignes). Le fichier porte aussi désormais la liste de ce qui a été **contrôlé et tient**, pour ne pas re-payer la mesure. — items de pérennisation du module : deux écarts de fidélité du mock PeerJS, observabilité. **L'item de sécurité `[L]` du chemin (a) est CLOS le 29/08/2026** — attestation signée portée par la `metadata`, et les deux voies de l'énoncé écartées : l'annuaire portait une course invisible (`/ask-to-peer-id` ne porte aucun peerId, donc l'autorité répondrait « pas encore » et non « non »), et le raccourci qui la contournait rouvrait l'auto-inscription de mai. Ce que la voie « identité intrinsèque » plaçait hors du paquet ne l'était qu'à moitié : le client tirait DÉJÀ son UUID, donc il peut le faire attester avant `new Peer`, sans fenêtre. Trois découvertes hors énoncé — l'attestation ne sert à rien en mesh ordinaire (le mapping corrobore déjà, un seul cas la rend nécessaire), le verdict devait aller dans un registre distinct du mapping, et un vérificateur muet doit valoir ADMISSION même sous `enforce`. Restent deux bornes assumées : le rejeu borné par le TTL (fermeture hors paquet, côté serveur PeerJS) et `enforce` faux par défaut, qui est l'ordre des opérations et non une timidité. **Deux items neufs le 29/08, tous deux trouvés en écrivant des tests et tous deux épinglés avant d'être ouverts** : un 🟢 d'asymétrie (`sendData` ne contrôle la taille qu'en mesh, pas en star — sans brèche, la réception rattrape), et un 🟠 de correction réelle, la clé de minuteur de `usePeerRetry` qui périme sur changement de room et fait **survivre la mauvaise chaîne d'invitation** — l'abandonnée relance et efface le créneau de la vivante. **La sémantique de `peerInitPromise` est close le 29/08** : `_doInit` attend réellement l'`'open'`, donc « init terminée » veut enfin dire « pair joignable ». L'énoncé promettait de laisser les appelants s'y raccrocher — **réfuté** : `acceptCallFromPeer` doit poser `addRemotePeerId` avant l'arrivée du `peer.call` de l'initiateur, et un refus entrant ne revient jamais à l'émetteur ; les trois appels de production restent nus. Le gain réel n'était pas dans l'énoncé : le **délai** `PEER_OPEN_TIMEOUT_MS`, qui ferme un blocage définitif — un `Peer` dont la socket s'ouvre sans que le serveur envoie son `OPEN` restait vivant en `connecting` pour la vie de l'onglet, et la garde d'instance interdisait alors toute ré-init, sans un log ; seul un F5 réparait. Il **détruit** l'instance, sans quoi il aurait fabriqué un peerId fantôme de plus. La passe a fait tomber la preuve « le `.catch` n'a besoin d'aucune garde d'identité » et l'a remplacée par un test, découvert que la couverture n'était qu'à moitié faite sans réordonner les gardes (la garde d'instance précédait celle de la promesse, donc un second consommateur sortait sur un `undefined` immédiat), et corrigé un préalable de harnais annoncé fait : `vi.waitFor` avance l'horloge factice de 50 ms par tour. **L'id historique qu'un échec d'init laissait derrière lui est nettoyé le 29/08** : une ligne, et le premier test qui exerce ce `.catch`. Le seul chemin qui y menait suppose une instance abandonnée par PeerJS puis une ré-init échouée — toutes les autres destructions passent déjà par `resetPeerState()` ; et `resetPeerState()` dans le `.catch` aurait été le piège, il désarme l'audit du `.finally`. **La machine à états du cycle de vie du `Peer` est close le 29/08** : un fait déclaré unique (`peerPhase`, cinq transitions) remplace `localPeerReady` et l'usage de `peerInitPromise` comme état, `peerIdentity()` devient le seul chemin de lecture de la production, et trois getters plus trois setters sans appelant disparaissent. La panne silencieuse est tombée d'abord et seule — `waitForMeReady` lisait l'identité HISTORIQUE et répondait « prêt » sur un peer détruit ; la sémantique retenue est d'**attendre**, pas de répondre `false`, sinon un backoff en vol ferait abandonner les quatre consommateurs. Deux arbitrages portent la passe : une transition inattendue est **appliquée puis journalisée** (l'inverse de `useCallStateMachine`, qui arbitre des actions là où la phase ne fait que suivre PeerJS), et **l'observation l'emporte sur la déclaration** — sans quoi la phase serait un septième prédicat menteur. Elle a réfuté son propre chiffrage (68 cas annoncés, 10 assertions réelles) et sorti un mensonge du double : `localPeer` et `getLocalPeer` y étaient deux champs indépendants, que le store réel ne peut pas faire diverger. **La chaîne de présence est close le 29/08** avec son dernier item, la « fraîcheur de `roomMembers` » : la passe a réfuté l'énoncé sur les quatre points — une sourdine passe d'abord par un vidage, `roomMembers['data-app']` n'existe jamais, le veto est correct pendant une coupure pusher, et un `removeRemotePeerId` plus agressif serait une régression de sécurité. Ce n'était pas un contrat de fraîcheur mais un contrat de **propriété**, et le vrai défaut était ailleurs : un tour de présence en vol ressuscitait l'entrée d'un contexte détruit — le seul épinglage réellement permanent du module, atteignable par une navigation SPA — pendant que le démontage d'un homonyme emportait l'allowlist du vivant, fail-closed et sans rattrapage. Deux gardes sur des mécanismes déjà en place ferment les deux ; `isUserInAnyRoom` n'a pas été touché. **La migration de `remotePeers` vers Pinia est close le 29/08** : `roomMembers[contextId]` est la source unique, `connection.remotePeers` un accesseur en lecture seule au-dessus d'elle (donc ~25 lectures de production et ~55 semis de test inchangés), et `_diffLock` est parti. L'énoncé promettait l'atomicité et la réactivité : les deux étaient déjà là — le gain réel est un chemin d'écriture unique vers l'allowlist des deux gardes d'autorisation. La passe a réfuté la consigne de l'item de fraîcheur voisin, qui reste ouvert : un TTL sur l'entrée fermerait silencieusement l'allowlist d'une room calme, la péremption appartient à la lecture d'`isUserInAnyRoom`. Et la parade contre le mode de panne silencieux est devenue permanente — aucun setter en production, plus un grep qui interdit d'en réintroduire un. **Le renommage de `usersInRoom` en `remotePeers` est clos le 28/08** : le nom promettait « les membres de la room » et livrait les seuls pairs distants, à l'endroit précis où il sert d'allowlist aux deux gardes d'autorisation. L'énoncé voulait garder un `usersInRoom` neutre — écarté, aucun lecteur ne le voulait, et il aurait rendu au nom le sens inverse du sien sans lever d'erreur ; le computed compensatoire `allUsersInRoom` est supprimé, pas renommé. La passe garde sa parade au mode de panne silencieux d'un renommage de champ de `connection`. **Le client star qui composait un hub absent est clos le 28/08** : la branche client est devenue la branche mesh filtrée sur le hub, ce que seule la réconciliation du fan-out rendait possible — le couplage annoncé s'est vérifié. Elle a emporté un second défaut absent de l'énoncé, le `preserveRetry` manquant, et écarté `isHubConnected`, qui ne disait que la moitié du prédicat. La **re-composition sur perte de connexion** est close le 28/08 : elle ferme le dernier cas de la chaîne de présence, celui où aucun tour n'a lieu du tout, et elle a réfuté l'énoncé de son propre item — `handleRemoteDeparture` ne voit jamais une fermeture sortante, donc aucune frontière de couche n'était en jeu. La section « Annonce de diffusion » est **close le 28/08** : ses trois fenêtres sont fermées par un quatrième chemin, le whisper sur le canal de présence, seul porteur indépendant de la signalisation P2P. Elle garde les trois faits appris en le posant — dont « une clé `accept_client_events_from` absente vaut `'all'` » et la course annonce/annuaire — et nomme la seule borne restante, qui est d'affichage et assumée. **Le `[L]` « déplacer le routage star » est dégelé et SCINDÉ le 29/08**, après relecture de ses trois affirmations, dont aucune ne tenait : ce n'était pas 245 lignes mais **18**, le filet qu'il attendait existe (45 fichiers de test), et il ne bloquait pas deux tâches mais **un cas sur 27**. La relecture a surtout trouvé ce que l'item ne disait pas : le wrap `onDataReceived` mixe trois couches et `usePeerTransport` ignore `useBroadcastPresence` — **seule la décision star peut descendre, pas le wrap**. **(a) est FAITE le 29/08** : `routeIncomingData` porte le prédicat (`star` ET `__starRoute` ET `isHub`, lu **par message**), `forwardStarMessage` n'est plus exporté, et le wrap tombe de 26 à 19 lignes — sa branche star de 18 à 8. Deux mesures que l'énoncé n'avait pas : désexporter voulait dire migrer **22 appels de test**, gratuits en fait (même signature, harnais déjà en star) ; et la couture est passée de quatre fichiers à **trois**, sans perdre un site — les deux moitiés de la question de routage (« à qui j'envoie », « ce que je reçois ») vivent désormais dans le même fichier. **(b)**, le routeur générique, est **tranché en sortie D le 29/08** — pas de SFU pour l'instant, la porte reste ouverte pour une v2/v3, mais on ne bâtit pas l'abstraction d'avance : ce qui tient la porte ouverte est la **couture** (sept endroits, trois fichiers) et (a) elle-même, puisqu'un SFU est « star dont le hub est un serveur ». L'instruction de la question a sorti un 🟠 neuf : **`topology: 'sfu'` est annoncé dans trois docblocks, accepté, et produit un contexte mort SANS UN LOG** — ni connexion ni envoi. À faire échouer bruyamment, sans quoi la v2 partirait de « c'est déjà à moitié câblé ». |
| [webrtc2-tests-plan.md](webrtc2-tests-plan.md) | ouvert, **ne reste que la tâche 8, dont les lots A, B, V, C et D sont faits** | **Lot D clos le 31/08** — les contrôles de la vignette, 28 cas en deux fichiers plus `helpers/fakeFullscreen.js`, 12 fichiers couverts sur 15, et **quatre corrections de production dont deux hors énoncé** : la fenêtre PiP qui survivait au recyclage d'un slot et changeait d'identité sans le dire, et le mute natif qui ne suivait pas sur la branche audio (un pair coupé se faisait réentendre en éteignant sa caméra). Plus la comparaison manquante du PiP et la sortie B des deux drapeaux menteurs — après quoi le composable n'importe plus rien de Vue. Le chiffre qui compte est un **0 asymétrique** : renommer `nativeVideo` chez `~estarter` rougit 8 cas du fichier qui monte le vrai lecteur et **0** du fichier composable, ce qui interdit de stuber le lecteur — un stub validerait sa propre orthographe. La coupe en deux fichiers est elle aussi une mesure : au niveau composant `console.error` n'est pas discriminant, `callWithAsyncErrorHandling` journalisant déjà le rejet d'un handler, donc tout cas d'échec appartient à l'étage nu. Deux affirmations de l'énoncé réfutées (la moitié plein écran de la comparaison porte sur une branche **déjà** morte ; la sentinelle `null` par slot `#video` est une capacité du contrat, pas un chemin — le vrai est la branche audio, structurelle). Piège payé sur les contrôles eux-mêmes : **pour mesurer un `catch`, retirer le `try` avec lui**, sinon la suite ne compile plus et le 0 se lit « inutile ». Sept items neufs, tous mesurés. — **Lot C clos le 31/08** — la boucle des toggles épinglée de bout en bout (3 fichiers), 10 fichiers couverts sur 15, et **trois corrections de production** : un garde inatteignable supprimé, `immediate: true` ajouté, et une file poubelle `"undefined"` commune à tous les partages d'écran fermée. Le chiffre qui compte est un **0 croisé** : casser un bout du joint `conn.peer` ne rougit que le fichier de bout en bout, jamais les deux étages en dessous. L'énoncé se trompait de périmètre (`useMediaControls` n'est pas dans la boucle, il part au lot D), et les lots restants sont enfin **nommés** — D, E, F. Deux pièges payés : la coalescence a rougi le test avant d'être écrite en pin, et **un commentaire HTML en tête de `<template>` coupe le fallthrough des attributs**, ce qui a fait rendre à un contrôle un chiffre qui n'était pas le sien. — **Tâche 8, lots A+B+V clos le 30/08** — l'étage `Widgets/**` passe de 4 à 8 fichiers couverts sur 15 (l'énoncé annonçait « 3 couverts » : c'était 4, `PlayerHost` étant testé sous le nom du composable). Le 🟠 du refus de permission caméra est fermé, avec ses trois décisions écrites — repli `inject('AWN', null)` + `window.AWN`, message portant `err.name`, et **silence sur `NotAllowedError` pour `startCapture` seul**, puisque `getDisplayMedia` rejette pareil qu'on refuse ou qu'on ferme le sélecteur. Deux sorties en passant : `api` déclaré `required: false` alors que le template le déréférence au rendu (A), et le câblage `@stop_audio` **mort des deux côtés** (B, supprimé après avoir vu rouge la négative qui le gardait — `stopAudio` n'est qu'un alias de `stopStream` en aval). Le 🔴 de la vignette est épinglé par ses deux moitiés : contrat DOM dans la suite, géométrie dans `tests/visual/` **en sortie D assumée**. ⚠️ **Trois contre-épreuves ont rougi ZÉRO cas, les trois fois par faute du test** — et l'une a fait supprimer son cas : « le rejet s'échappe-t-il ? » est intestable à travers un espion, `vi.fn().mockRejectedValue()` absorbant le signal `unhandledRejection`. L'énoncé se trompait aussi sur le mécanisme du défaut (ce n'était pas un rejet non traité : l'erreur disparaissait **sans aucune trace**) et sur son périmètre (`Widgets/**`, alors que le site du 🔴 est sous `Exemples/`, qui est de la production). Reste **aucune hauteur de référence à viser** : la largeur du conteneur est un réglage, donc toute cote absolue est fausse d'une configuration sur deux. — **Tâche 7 close** — deux fichiers, et la séparation est une mesure, pas un rangement : celui qui asserte le comportement double l'orchestrateur (il n'y a derrière que des passthroughs), et **un double définit la surface**, donc il est aveugle par construction à un renommage en amont — mesuré, renommer `remotePeers` en `peers` dans le `return` de l'orchestrateur ne rougit QUE le second fichier, celui qui monte l'orchestrateur réel. Son énoncé était le pire rencontré jusqu'ici : il décrivait un test « bout en bout » de flux d'appel là où le fichier est une façade de 288 lignes dont ~200 sont de la déstructuration et du `return`. **huit cases sur onze déjà vertes à l'identique, trois par morceaux, et la dixième FAUSSE** — « `handleStreamRemoved` supprime le videoElement » est exactement ce que `useStreamManager.test.js` interdit depuis l'extraction des couches : l'écrire aurait demandé au code de régresser pour faire passer le test. Ce qui restait n'était dans aucune case : la mémoire d'invitations (`isInviteDuplicate`, seule vraie logique du fichier, et le seul rempart contre N modales empilées puisque le moteur de retry renvoie le MÊME `inviteId`), et trois wrappers qui **jetaient la promesse** d'un verbe `async` — un refus de permission caméra partait en rejet non traité, bouton mort et sans trace. Corrigé (sortie A) ; la moitié UI est un item de [webrtc2-todo.md](webrtc2-todo.md), bloqué par la tâche 8. Deux cas d'enchaînement FSM ajoutés chez `useCallManager`, et une contre-épreuve y a trouvé une remise à zéro en double (0 cas rougis seule, 4 avec son jumeau) — l'illustration exacte de la règle « neutraliser les DEUX mécanismes ». — **Tâche 6 close** — `usePeerOrchestrator` en quatre fichiers (`broadcastPresence`, `callbacks`, `teardown`, `media`), 41 cas, 28 contre-épreuves mesurées. Son énoncé décrivait un fichier d'avant l'extraction des couches : sept cases étaient déjà vertes chez `useConnectionPool` / `useStreamManager` / `useCallManager`, et il ne listait pas `toggleAudioState`, `toggleVideoState` ni `stopAudioStream`, qui n'avaient aucun test nulle part. La branche hub du wrap `onDataReceived` — son seul reste — est écrite le 29/08 dans la foulée de (a), et elle a donné **trois** cas et non un : la retransmission avec sa remontée en arité 1, une annonce retransmise qui ne remonte jamais à l'app, et le fall-through hors cas hub, seul à épingler le prédicat de topologie. ⚠️ Deux préparations du montage fabriquent un test **vert par vacuité** si on les oublie — `isHub` vaut `null` tant que `waitForMeReady` n'a pas tourné, et une connexion entrante n'est pas enregistrée dans le store. **Quatre contre-épreuves ont rougi ZÉRO cas au premier passage, et les quatre fois la faute était dans le test** — un périmètre à un seul pair, une seule connexion ou un seul type ne distingue pas « cible précise » de « tout le monde » ; la leçon est remontée dans `docs/modules/webrtc2/tests.md`. Reste la **tâche 7**, et le même avertissement vaut pour elle : relire le code avant de croire l'énoncé. — **Tâche 8 neuve** : l'étage `Widgets/**` — 12 fichiers sur 15 sans aucun test, dont 10 des 12 composants `.vue` (`Debug` a été couvert par la bande le 29/08, sur son seul bloc de corroboration d'identité). Ce n'est le reste d'aucune tâche existante, et c'est de là que venait le dernier 🔴 (vignette à 0 px), invisible à une suite verte. Elle porte le piège déjà payé : `isVisible()` de Playwright rend `true` sur un élément clippé par un ancêtre. — les tâches 1 à 5 sont fermées (les quatre derniers trous — `sendData` star, câblage du rate-limit hub, taille du chemin hub, `contextRegistry` — l'ont été le 29/08). Restent 6 (`usePeerOrchestrator`) et 7 (`useMediaBroadcast`) : elles étaient déclarées bloquées par le `[L]` gelé, vérification faite **un seul cas sur 27** l'est réellement. C'est le plus gros volume de tests écrivable immédiatement du module. Porte les pièges de harnais mesurés — les lire avant d'écrire un test de ce module. |
| [doc-rustines.md](doc-rustines.md) | 🟠 démarré — **lot 0 terminé** | rendre la doc exempte d'annotations qui compensent un défaut du code. Le lot 0 (annotations déjà fausses) est fermé. Vient ensuite la v1 WebRTC, déclarée morte mais **encore importée par cinq composants vivants**. |
| [projection-graphe-todo.md](projection-graphe-todo.md) | ⏸️ **suspendu — au besoin seulement** | suites du correctif « un utilisateur = un mur + un feed ». Rien n'y bloque ; deux items portent une exigence d'exploitation (sauvegarder le space NebulaGraph, que rien ne reconstruira). |
| [chat-tests-plan.md](chat-tests-plan.md) | **non démarré** | plan de tests du Chat en 5 couches. Un seul fichier de test existe. Une décision en attente : helpers dédiés ou partagés (`mockEcho`, `mockRoute`, `seedChatStore`). |
| [front-todo.md](front-todo.md) | **non démarré** | deux items. Le ping d'ouverture de session part avant que pusher n'ait confirmé l'abonnement, et Reverb le rejette — l'utilisateur peut rester hors ligne deux minutes ; le correctif naïf (`subscribed(cb)`) ne part jamais sur un canal déjà confirmé. Et `isEmpty(element.store)` lève sur un commentaire de post chargé par la liste, **dans un listener Reverb donc en silence** — quatre appelants, deux étages possibles pour le correctif. |
| [sass-todo.md](sass-todo.md) | **non démarré** | de la dette de style, et seulement ça depuis que le 🔴 « vignette d'attente invisible » est parti dans le chantier WebRTC2 qui l'avait produit (fermé le 28/08, sans rien devoir à ce fichier). Restent : thème sombre cassé par des couleurs en dur, absence de `_variables.scss` propre au paquet (arbitrage A/B à trancher), URL d'image externe en prod, et les `@extend` de classes Bootstrap à migrer. |
