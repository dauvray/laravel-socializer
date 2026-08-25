# Dé-rustiner la doc — volet socializer

> **Chantier ouvert — lot 0 terminé.** Objectif : que `docs/`, `CLAUDE.md` et
> `resources/boost/guidelines/core.blade.php` ne contiennent plus de passage qui n'existe que pour
> compenser un défaut du code.
>
> **Quatre sorties** pour une annotation : **A** corriger le code · **B** supprimer (code mort ou
> annotation périmée) · **C** épingler par un test le comportement voulu mais contre-intuitif —
> la doc garde une ligne, le nom du test · **D** assumer par une décision datée.
>
> **Trois volets** par tâche, et elle n'est finie qu'aux trois : **code**, **doc** (retirée de
> *chaque* couche listée), **tests** (rouge d'abord, puis vert, suite complète verte).
>
> Après tout retrait dans `resources/boost/guidelines/`, côté projet hôte :
> `artisan boost:update` **puis** `grep 'laravel-socializer/core rules ===' CLAUDE.md`.

**Ce paquet est le seul à avoir un filet** : une suite JS fournie, plus une suite PHP sur la
signalisation. Il peut donc sortir en **C** là où les autres ne peuvent pas — c'est un avantage,
pas un détail. Les décomptes se relisent dans la sortie du runner ; ne pas les recopier ici.

```bash
npm run test:run                      # JS — DEPUIS LA RACINE DU PROJET HÔTE
composer install && vendor/bin/phpunit  # PHP — depuis ce paquet
```

> ⚠️ **Ne pas dupliquer les chantiers déjà ouverts.** Plusieurs rustines de la doc y sont déjà
> cadrées, avec leur analyse : [webrtc2-todo.md](webrtc2-todo.md) (renommage `usersInRoom`,
> sémantique de `peerInitPromise`, peerId fantôme),
> [webrtc2-tests-plan.md](webrtc2-tests-plan.md) (trous de couverture),
> [front-todo.md](front-todo.md) (directives de resize),
> [sass-todo.md](sass-todo.md) (thème sombre, `@extend`). Ce fichier y **renvoie** — une règle, un
> seul endroit.
>
> Le **chantier de sécurité d'août 2026 est clos** : ce qu'il portait (TURN, `getUsersList`, dérive
> du réplica, écritures muettes) est livré, et son durable est dans
> [`docs/modules/webrtc2/securite.md`](../docs/modules/webrtc2/securite.md). Les entrées de ce
> fichier qui lui renvoyaient renvoient désormais à cette doc.

---

## Ordre vis-à-vis du module WebRTC2

**Le chantier de sécurité est clos (F1, 25/08/2026), et ses collisions avec ce fichier sont levées.**
F1 a remonté son durable dans `securite.md`, `architecture.md` et `architecture/signalisation.md`,
**pas dans le `CLAUDE.md`** : les tâches ci-dessous ne le doublent pas, elles couvrent ce qu'il ne
couvrait pas.

Les cinq tâches du lot 0 ont été faites du 15 au 21/08 sans jamais croiser WebRTC2 — la doctrine
« le lot 0 se fait sans attendre » a tenu. **Le lot 0 n'a plus de tâche prête** : sa sixième entrée
attend, comme les autres lots.

### Collisions — toutes levées sauf une

| Tâche d'ici | État |
|---|---|
| ~~Renommer `canJoinRoom` / `canJoinServer` (lot 3)~~ | **Débloqué le 21/08** : E4.1 est livrée, les quatre gardes refusent par défaut et `canJoinchatRoom` exige l'appartenance. Le renommage ne touche plus au comportement, seulement aux noms et à leurs appelants |
| ~~Renommer `hasOpenConnection` / `isConnectionEstablished` (lot 4)~~ | **Débloqué** : les gardes des lots A et B sont livrés et épinglés. ⚠️ Reste un renommage sur un chemin de sécurité — les deux prédicats sont ce que lit le moteur de retry, et les confondre est la panne du 13/08 |
| ~~Renommer `remoteStreams` (lot 3)~~ | **Débloqué** : `createPeerContext` ne bouge plus |
| Convertir les 9 pièges de mock en tests (lot 4) | **Toujours bloqué** : le harnais bouge encore — [webrtc2-tests-plan.md](webrtc2-tests-plan.md) a des tâches ouvertes, dont 6 et 7 **gelées** |
| ~~Migrer les appelants v1 (lot 1)~~ | **Débloqué** : plus aucun audit en cours sur `Notifications.vue` ni `AlertComponent.vue` |

Le `[L]` **gelé** de [webrtc2-todo.md](webrtc2-todo.md) — déplacer le routage star dans
`usePeerTransport` — reste gelé. Rien ici ne le dégèle.

### Faisable en parallèle sans aucun risque

Aucun de ces éléments n'est dans l'arbre WebRTC2 : `EventBus/webrtc2Events.js` (mort), `sfu`,
`ACCESORS`, `Feed.vue` en Options API, la casse de `Widgets/`, et les quatre zones mortes
(`admin.php`, `console.php`, `table_names`, `SocializerUpgrade`).

### Le vrai risque de désynchronisation : les ancres, pas le code

Ce fichier cite une centaine de `fichier:ligne` dans `docs/`. Chaque édition de `securite.md`,
`architecture.md` ou `tests.md` en fait dériver une partie — **silencieusement**, puisqu'un numéro
de ligne faux ne casse rien, il égare.

Deux gestes qui suffisent :

- quand F1 remonte sa doc, **relire ce fichier dans la foulée** : ce que F1 vient d'écrire a pu
  rendre une tâche d'ici sans objet — c'est un gain, pas une perte ;
- ne jamais chercher une annotation par son numéro de ligne seul : le `grep` de son mot-clé est la
  source de vérité, la ligne n'est qu'un raccourci.

---

## Lot 0 — Annotations déjà fausses · sortie B — ✅ TERMINÉ

Les six entrées sont fermées. Ce qu'elles ont appris, et qui vaut pour les lots suivants, est dans
[`docs/ecrire-la-doc.md`](../docs/ecrire-la-doc.md) : une annotation qui décrit l'état d'une **classe
nommée** se vérifie sur le **câblage** (`artisan event:list`), une annotation qui décrit le
**comportement d'une requête** se vérifie contre un **vrai graphe** et jamais contre la doublure, et
une page de référence peut violer la convention que le paquet énonce ailleurs — ça se trouve au grep.

La dernière fermée est la divergence d'API de `use-reverb-channel.md`, née en corrigeant les imports
de la même page. Les quatre écarts sont corrigés dans la table de référence : les deux verbes de
whisper y figurent, l'optimisme d'`isConnected` hors présence est dit, le couplage entre `autoJoin`
et la réactivité du nom de canal est dit, et `stopListening` annonce qu'il coupe aussi les listeners
statiques — durablement pour un dynamique, temporairement pour un statique.

## Lot 1 — Code mort · sortie B

- [ ] **Migrer les 5 appelants de WebRTC v1, puis supprimer `components/WebRTC/`** · effort [L]
      **La tâche la plus rentable du paquet en volume de doc.** La v1 morte est annoncée dans
      **7 fichiers de doc**, dont le piège n°1 du `CLAUDE.md` et une ligne du `CLAUDE.md` de *tout
      projet hôte* — parce que deux arbres coexistent avec des fichiers homonymes
      (`MediaBroadcastProvider.vue`) et qu'un symbole trouvé au grep peut venir de la v1.

      **Vérifié : cinq appelants vivants**, plus un fichier désactivé. L'archive de lecture
      `work/webrtc-v1-notes.md` a été supprimée : sa condition de conservation — « le temps de
      vérifier qu'aucun appelant ne subsiste » — était remplie, et le recensement vit désormais
      dans la doc du module, avec la commande qui le recompte.

      | Appelant | Ce qu'il importe |
      |---|---|
      | `System/widgets/AlertComponent.vue:22-23` | `WebRTC/widgets/partials/AudioCallAlert.vue`, `VideoCallAlert.vue` |
      | `AudioRoom/AudioComponent.vue:28-29` | `WebRTC/widgets/MediaBroadcastProvider.vue`, `ui/AudioDefaultUserButtonUI.vue` |
      | `Application/ApplicationComponent.vue:44` | `WebRTC/widgets/DataUserPeerConnection.vue` |
      | `Whiteboard/WhiteboardComponent.vue:26` | idem |
      | `ClassRoom/ClassRoomComponent.vue:46` | idem |
      | `AudioRoom/__AudioComponent copy.vue:16` | `WebRTC/composables/usePeers.js` — fichier déjà désactivé (`__`) |

      La v1 n'est donc pas « morte en attente de confirmation » : elle est **vivante sous cinq
      composants**, dont un en `defineAsyncComponent`, invisible à une recherche d'`import`
      statique. C'est écrit dans
      [`docs/modules/webrtc2/INDEX.md`](../docs/modules/webrtc2/INDEX.md) — l'annotation qui la
      donnait pour simplement morte sous-estimait le problème, ce qui est pire que de l'ignorer.

      Périmètre : 13 fichiers `WebRTC/`, le store `stores/peers.js`, et la migration des cinq
      appelants vers `WebRTC2/`.
      Annotation (7 fichiers) : `CLAUDE.md:13-15` · `docs/INDEX.md:55-56` ·
      `docs/modules/webrtc2/INDEX.md:10-12` · `docs/modules/autres-modules.md:17-24` ·
      `docs/architecture/package.md:181-182` · `docs/modules/chat.md:27-30` ·
      `resources/boost/guidelines/core.blade.php:10-12` · plus le `CLAUDE.md` de tout projet hôte
      - [ ] Code — migrer les 5 appelants, puis supprimer `components/WebRTC/` et `stores/peers.js`
      - [ ] Doc — retirer la mention de la v1 des couches qui la portent encore, la dernière
            partant avec le code
      - [ ] Tests — la suite JS complète reste verte (`npm run test:run`) ; vérification manuelle
            des quatre modules touchés (audio, application, tableau blanc, classe virtuelle)

- [ ] **Supprimer `WebRTC2/EventBus/webrtc2Events.js`** · effort [S]
      « N'est consommé par personne » ; la seule mention dans le code est un commentaire de
      `Composables/utils/validators.js:17` (« le type était mort »). La doc demande de le traiter
      « comme la normalisation **visée**, pas comme le chemin en vigueur » — c'est-à-dire d'entretenir
      un fichier inutilisé et de l'expliquer à chaque lecteur.
      Décision à prendre : le brancher (sortie A) ou le supprimer (B). Ne pas le laisser en l'état.
      Annotation : `docs/modules/webrtc2/api.md:138-143`
      - [ ] Code · - [ ] Doc · - [ ] Tests

- [ ] **Vider les cinq poches mortes restantes** · effort [M]
      `docs/architecture/package.md:172-184` liste une section « Zones mortes connues » dont
      l'objet est « à savoir pour ne pas y chercher quelque chose ». Une section entière de doc pour
      compenser du code qu'il suffit de supprimer. **Vérifié**, restent vraies :

      | Zone | État |
      |---|---|
      | `src/routes/socializer/admin.php` | groupe de route vide, 6 lignes commentées |
      | `src/routes/socializer/console.php` | 16 lignes de docblock, zéro commande |
      | `src/config/socializer.php:171` | `table_names` vide |
      | `SocializerUpgrade` | 27 lignes non commentées sur 67 — commande enregistrée, inerte |
      | `__StreamUserButton.vue`, `__CaptureUserButton.vue`, `__AudioComponent copy.vue` | désactivés par convention `__` |

      ⚠️ `__AudioComponent copy.vue` porte « copy » dans son nom **et** un espace : à supprimer, pas
      à renommer.
      - [ ] Code — supprimer ou implémenter, poche par poche
      - [ ] Doc — la section « Zones mortes connues » disparaît à mesure ; la supprimer quand elle
            est vide
      - [ ] Tests — `artisan route:list` et `artisan list` inchangés ; suite JS verte

- [ ] **Retirer `sfu` de `options.topology`** · effort [S]
      « **`sfu` est accepté** dans `options.topology` et **branché dans le fan-out** de
      `syncUsersConnections`, **sans implémentation serveur** » — une option qui ne fait rien, mais
      qu'un intégrateur peut passer en croyant l'activer.
      Annotation : `docs/modules/webrtc2/api.md:191`
      - [ ] Code — refuser la valeur, ou l'implémenter · - [ ] Doc · - [ ] Tests

## Lot 3 — Noms qui mentent · sortie A

Le motif le plus dense du paquet. Un nom juste supprime son paragraphe d'explication — et, ici,
plusieurs de ces noms ont **déjà coûté des régressions**.

- [ ] **`remoteStreams` exclut les partages d'écran** · effort [M]
      « Consommer `remoteStreams` seul rend tout partage d'écran **invisible** »
      (`createPeerContext.js:201-202`). Le nom promet tous les flux distants alors que son jumeau
      `remoteScreens` existe et ne contient que les écrans. Conséquence côté tests : « asserter sur
      `remoteStreams` seul laisse passer toute régression d'écran » — le nom pourrit donc aussi le
      harnais.
      Renommer en `remoteCallStreams`, qui met les deux noms en symétrie
      (`remoteCallStreams` / `remoteScreens`) au lieu de laisser croire à un ensemble et son
      sous-ensemble. API publique du contexte : prévoir un alias de transition.
      Annotation : `docs/modules/webrtc2/api.md:71-72` · `docs/modules/webrtc2/tests.md:193-194`
      - [ ] Code · - [ ] Doc · - [ ] Tests

- [ ] **`type` vs `connectionType`** · effort [M]
      « C'est le piège n°1 … **il a coûté deux régressions** » : les confondre envoie la réponse
      dans une file que personne n'observe. Deux champs quasi-homonymes dans le même payload, plus
      un repli `connectionType` absent ⇒ `type` pour rétrocompatibilité avec un backend non déployé.
      Sortie A si le repli peut être retiré (le backend est déployé partout ?) ; sinon C, avec un
      test qui épingle le repli et une doc réduite à une ligne.
      Annotation : `docs/INDEX.md:59-60` · `docs/architecture/signalisation.md:86-105`
      - [ ] Code · - [ ] Doc · - [ ] Tests

- [ ] **`metadata.from` / `fromName` portent *mon* identité sur une connexion sortante** · effort [M]
      « Filtrer sur `metadata.from` **ne matche donc rien** côté initiateur » ; et afficher le nom du
      distant « demanderait un champ `fromUserName` dans les événements de `UserController` ».
      Le nom du champ ment sur son contenu selon le sens de la connexion — c'est-à-dire la moitié du
      temps. Renommer (`localFrom`) ou ajouter le champ manquant côté backend.
      Annotation : `docs/modules/webrtc2/api.md:116-121` · `docs/modules/webrtc2/architecture.md:326-330`
      - [ ] Code · - [ ] Doc · - [ ] Tests

- [ ] **`canJoinRoom` / `canJoinServer` ne sont pas des prédicats d'appartenance** · effort [L]
      « Sur une room publique la requête renvoie une ligne dès qu'un membre quelconque existe :
      **`true` pour tout le monde**. (Effet miroir : une room publique **vide** renvoie `false`,
      même à son propriétaire.) » Le nom ment dans les deux sens, sur un prédicat de sécurité.
      ✅ **E4.1 livrée le 21/08** : le comportement est corrigé et les gardes refusent par défaut,
      donc le renommage est débloqué et ne porte plus que sur ces deux méthodes —
      `canJoinchatRoom`, elle, exige désormais l'appartenance et son nom est juste.
      Annotation : `docs/modules/webrtc2/securite.md`, piège 1 (« ne sont pas des prédicats
      d'appartenance ») · `docs/architecture/signalisation.md`, note sous le tableau des canaux ·
      `docs/architecture/package.md`, liste des gardes · `Socializable.php`, en-tête
      `GARDES DE CANAL REVERB` + en-tête `GARDE DE RELATION`   (4 couches)
      - [ ] Code · - [ ] Doc · - [ ] Tests

- [ ] **`socializer:build` est l'installateur, pas un bundler** · effort [S]
      « **Ce n'est pas du bundling — c'est l'installateur** » : une série de `replaceInFile()` qui
      patchent les fichiers du projet hôte. Un commentaire d'en-tête et une ligne de `--help`
      suffisent à retirer le paragraphe.
      Lié : la garde et l'idempotence de ces patchs sont une tâche du socle
      (`vendor/innovation/laravel-estarter/work/doc-rustines.md`, lot 2) — ce paquet en hérite,
      **ne pas la dupliquer ici**. Les 7 `putInFile` sur `.env`
      (`SocializerInstall.php:250,277,306,316,326,336,374`) sont le principal bénéficiaire.
      Annotation : `docs/architecture/package.md:129-136`
      - [ ] Code · - [ ] Doc · - [ ] Tests

- [ ] **`ACCESORS` *(sic)*** · effort [S]
      Faute de frappe figée dans les squelettes de modèles (`Post.php`, `Page.php`,
      `DynAnswerMongo.php`), que `docs/architecture/conventions.md:20` entérine avec un « *(sic)* »
      au lieu de la corriger. C'est un commentaire de section : aucun risque.
      - [ ] Code · - [ ] Doc · - [ ] Tests — sans objet

- [ ] **Casse de `widgets/` incohérente** · effort [S]
      9 dossiers en minuscule, 2 en majuscule (`Users/Widgets/`, `WebRTC2/Widgets/`) —
      `conventions.md:64-65` et `autres-modules.md:42` le signalent chacun de leur côté.
      Uniformiser ; impacte les imports front.
      - [ ] Code · - [ ] Doc · - [ ] Tests — suite JS verte

- [ ] **`Feed.vue` encore en Options API** · effort [S]
      « ne pas les prendre pour modèle » (`conventions.md:77-78`, `autres-modules.md:36`). Migrer le
      seul reliquat supprime les deux mentions.
      - [ ] Code · - [ ] Doc · - [ ] Tests

- [ ] **Directives de resize : le suffixe décrit la poignée, pas l'axe** — déjà cadré dans
      [front-todo.md](front-todo.md). **Ne pas dupliquer** ; cocher là-bas.

- [ ] **`usersInRoom`** — déjà cadré dans [webrtc2-todo.md](webrtc2-todo.md) (150 occurrences /
      33 fichiers). **Ne pas dupliquer.**

## Lot 4 — Épingler par un test · sortie C

Ces comportements sont **voulus**. Le paquet a un filet : c'est le seul endroit du chantier où la
sortie C est immédiatement disponible, et elle vide beaucoup de doc.

- [ ] **Le routage des signaux ne pose aucune précondition** · effort [M]
      « C'est un invariant, **pas un oubli**. En ajouter une a déjà fait disparaître des flux » —
      cassé une fois par un `await ctx.waitForMeReady()` et un `if (ctx.isShuttingDown.value)
      return`, de façon intermittente. Le code *ressemble* à une garde manquante : c'est exactement
      ce qu'un relecteur « corrige ».
      Un test nommé `routing_does_not_gate_on_readiness` le protège mieux que trois paragraphes.
      Annotation : `docs/INDEX.md:61-62` · `docs/modules/webrtc2/architecture.md:363-378`
      - [ ] Code — sans objet · - [ ] Doc — trois paragraphes → une ligne · - [ ] Tests

- [ ] **`setLocalPeer` : async donc toujours truthy, et `undefined` même en succès** · effort [S]
      « Un `if (!ready) return` est **au mieux mort, au pire inversé** ». Deux tests le disent : un
      sur la valeur de retour, un sur le fait qu'aucun appelant ne la lit.
      Annotation : `docs/modules/webrtc2/architecture.md:337-340` · `docs/modules/webrtc2/flux.md:44-48`
      (le fait est déjà écrit **deux fois** — la sortie C en supprime une)
      - [ ] Code — sans objet · - [ ] Doc · - [ ] Tests

- [ ] **`connectToPeer` : `false` pour différer, `true` pour abandonner** · effort [S]
      Sémantique booléenne inversée par rapport à l'intuition : `true` signifie « pas d'erreur » et
      **annule** le retry — « plus aucune connexion ne se rétablit, silencieusement ».
      Sortie A envisageable (une énumération `RETRY` / `ABORT` au lieu d'un booléen) — à arbitrer.
      Annotation : `docs/modules/webrtc2/architecture.md:341-343` · `securite.md:62-65`
      - [ ] Code · - [ ] Doc · - [ ] Tests

- [ ] **`hasOpenConnection` ≠ `isConnectionEstablished`** · effort [M]
      « Les confondre a coûté une **panne définitive** » : un `peer.call()` jamais répondu laisse le
      `RTCPeerConnection` en `connecting` à vie — WebRTC ne bascule pas en `failed`, et PeerJS ne
      notifie pas le `close()` d'un appel non répondu. Résultat : écran noir chez le récepteur,
      **aucune erreur nulle part**.
      Le défaut est dans la lib tierce (sortie D pour la cause), mais les deux prédicats sont à nous :
      un test par prédicat, plus des noms plus contrastés, remplacent la section entière.
      Annotation : `docs/modules/webrtc2/architecture.md:156-182`
      - [ ] Code — renommer · - [ ] Doc · - [ ] Tests

- [ ] **`setTimeout(1000)` de `useStickyScroll`** · effort [S]
      Compense le chargement asynchrone des images ; « les simplifier réintroduit des sauts de
      scroll ». Cas d'école du « piège à ne PAS optimiser » — et cas d'école de sortie C.
      Annotation : `docs/modules/chat.md:43-45`
      - [ ] Code — sans objet · - [ ] Doc · - [ ] Tests

- [ ] **Les getters Pinia sont auto-déballés** · effort [S]
      « Un mock qui enveloppe un getter dans un `computed()` casse **silencieusement** » →
      `hasOpenConnection` renverrait **toujours `false`**, faux négatif muet. Le harnais a déjà
      produit cette panne.
      Sortie C au niveau du **harnais** : un test de conformité du mock (le paquet en a déjà un,
      `mockFidelity.test.js` — l'étendre plutôt que documenter).
      Annotation : `docs/architecture/conventions.md:96-98` · `docs/modules/webrtc2/tests.md:143-175`
      - [ ] Code — étendre `mockFidelity.test.js` · - [ ] Doc · - [ ] Tests

- [ ] **Les 9 « pièges de mock »** · effort [M]
      `docs/modules/webrtc2/tests.md:143-175` énumère neuf façons dont le harnais peut verdir pour
      la mauvaise raison (`_pushSignal` écrivant dans une structure que `getQueueForRoom` ne lit
      pas ; `handleRemoteDeparture` qui avale ses exceptions ; `setLocalPeer` mocké en
      `vi.fn(() => true)` fabriquant un booléen que la production ne produit jamais — « deux tests
      validaient ainsi une branche inexistante »).
      **Chacun de ces neuf pièges devrait être un test de conformité du mock, pas une puce de doc.**
      C'est la plus grosse conversion C du paquet : neuf assertions contre 33 lignes d'avertissement.
      - [ ] Code — étendre le test de conformité · - [ ] Doc · - [ ] Tests

- [ ] **`json_encode` échappe les `/`** · effort [S]
      Le sérialiseur transforme l'aiguille : l'assertion de non-fuite de chemin « a cessé de garder
      quoi que ce soit **sans virer au rouge** ». Un test mort et indétectable, trouvé seulement en
      contre-épreuve. À épingler par une contre-épreuve permanente, pas par un paragraphe.
      Annotation : `docs/architecture/tests.md:154-170`
      - [ ] Code · - [ ] Doc · - [ ] Tests

## Lot 5 — À arbitrer, et assumés · sortie D

Trois entrées fermées en sortie D par la clôture du chantier sécurité : la faille résiduelle du
chemin (a) et l'usurpation intra-room sont des **bornes assumées** inscrites dans
[« Bornes non fermées »](../docs/modules/webrtc2/securite.md#bornes-non-fermées-connues) ; les
écritures muettes du graphe sont devenues les trois régimes de la couture, avec leurs deux
arbitrages datés.

- [ ] **`destroy()` de PeerJS émet `disconnected` avant de poser `_destroyed`** — bug de dépendance
      tierce, vérifié dans `peerjs@1.5.4` (l.1810 avant l.1781). Trois gardes empilées le
      compensent. Sortie D : décision datée, plus un test de conformité du mock (déjà partiellement
      là). Un rapport amont serait la seule sortie A.
      Annotation : `docs/modules/webrtc2/architecture.md:240-292`

- [ ] **`contextRegistry` en portée module** — « c'est lui qui justifie encore le
      `vi.resetModules()` ». Dette assumée, mais elle contamine le harnais de tous les tests
      multi-pairs. Lié au `[L]` **gelé** de [webrtc2-todo.md](webrtc2-todo.md) : ne pas le dégeler
      ici.

- [ ] **Le graphe NebulaGraph est un réplica, pas une source de vérité** — *entrée réécrite le
      18/08 : son motif d'origine (« le listener du socle est commenté ») était faux, cf. lot 0.*
      Ce qui reste à assumer ou corriger : le réplica **est** synchronisé à l'attachement et au
      détachement, mais `group_user` porte `onDelete('cascade')` — supprimer un groupe ou un compte
      retire les lignes sans événement Eloquent et **laisse l'arête**. Un garde qui lit le graphe
      accorde alors un accès révoqué. **Arbitré et clos le 24/08** : les gardes ont **cessé de lire**
      l'appartenance dans le graphe plutôt que de le re-synchroniser — décision et raison dans
      [`securite.md`, piège 2](../docs/modules/webrtc2/securite.md#deux-pièges-du-graphe-que-ce-garde-contourne).
      Ce qui reste sous cette entrée n'est plus un sujet de sécurité mais de **données** :
      `Socializable::servers()`, `Server::getServers` et le compteur `nb_users` lisent encore
      `registered_in`.
      Annotation : `docs/modules/webrtc2/securite.md` (piège 2) ·
      `src/app/Helpers/ModelTraits/Socializable.php` (docblock de `sharesGroupWith`)

- [ ] **Deux listeners homonymes sur `GroupUserCreated`** — celui du socle est un `handle()`
      entièrement commenté, celui de ce paquet fait le travail. Deux avertissements ⚠️ existent
      **ici** uniquement pour empêcher la confusion que ce code mort provoque (elle a déjà coûté
      une tâche 🟠 fausse). ⚠️ **Le code mort est dans un autre paquet** : la tâche appartient au
      socle — [`vendor/innovation/laravel-estarter/work/doc-rustines.md`](../../../innovation/laravel-estarter/work/doc-rustines.md),
      lot 1. La signaler ici, la traiter là-bas ; les deux annotations tombent quand elle est faite.
      **Troisième copie retirée le 21/08** en condensant le docblock de `sharesGroupWith` ; restent
      `securite.md` et ce docblock, une ligne chacun.
      Annotation : `docs/modules/webrtc2/securite.md` (⚠️ après le piège 2) ·
      `src/app/Helpers/ModelTraits/Socializable.php` (docblock de `sharesGroupWith`)

- [ ] **Namespaces PSR-4 en casse mixte** (`Dauvray\Socializer\app\Models\Post`) et **`src/app/console/`
      en minuscule** alors que le namespace est `…\app\Console\…` — cette dernière est une
      **violation PSR-4 réelle** qui impose un `composer dump-autoload` à chaque nouvelle classe
      autochargée. Renommer le dossier casse les consommateurs ; ne pas le renommer coûte un piège
      permanent. Décision à écrire.
      Annotation : `CLAUDE.md:22-23` · `docs/architecture/conventions.md:14-17` ·
      `resources/boost/guidelines/core.blade.php:24-27`

- [ ] **Front en français en dur** (6 `$t()` dans tout le paquet), et
      `src/resources/lang/fr/network.php` mélangeant libellés d'UI **et slugs de routes traduits**.
      « Un chantier à part entière » — donc une décision datée, pas un avertissement récurrent dans
      trois fichiers.
      Annotation : `CLAUDE.md:103` · `docs/architecture/conventions.md:159-168` ·
      `resources/boost/guidelines/core.blade.php:28`

- [ ] **Pas de `package.json` dans le paquet** (tout l'outillage front vit chez l'hôte) — répété
      dans 4 fichiers. Structurel et voulu : une décision écrite une fois, et un pointeur depuis les
      trois autres.
      Annotation : `CLAUDE.md:16-18` · `docs/INDEX.md:57-58` · `docs/architecture/tests.md:19-20` ·
      `resources/boost/guidelines/core.blade.php:19-21`

- [ ] **Dépendances implicites non déclarées** (`Dauvray\Estarter\*`, Backpack, mongodb,
      formdesigner) — « pas dans le `composer.json` mais requises », parce que les déclarer mettrait
      une URL interne dans le manifeste d'un paquet publié sur GitHub public. Contrainte réelle :
      décision datée, avec la liste maintenue à un seul endroit.
      Annotation : `docs/architecture/package.md:142-153` · `docs/architecture/tests.md:80-86`

- [ ] **`FakeNebulaGraph` fait du `str_contains`, il ne parse pas le nGQL** — « une requête
      syntaxiquement invalide passe au vert ». Doublure qui ment par construction ; la remplacer est
      un chantier. Décision datée, et le dire **dans le harnais** (un commentaire à l'endroit du
      `str_contains`) plutôt que dans deux fichiers de doc.
      Annotation : `docs/architecture/tests.md:70-75` · `docs/modules/webrtc2/securite.md:329-340`

- [ ] **Trous de couverture** — « **Rien** pour Feed, Comment, Server, User, System, Application,
      Page, Whiteboard, les stores Pinia hors `peers2` ». C'est un état, pas une rustine : sa place
      est dans [chat-tests-plan.md](chat-tests-plan.md) et les plans de test, pas dans `docs/`.
      Annotation : `docs/architecture/tests.md:199-200`
