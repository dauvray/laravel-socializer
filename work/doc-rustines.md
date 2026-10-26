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
> cadrées, avec leur analyse : [webrtc2-todo.md](webrtc2-todo.md) et
> [sass-todo.md](sass-todo.md) (thème sombre, `@extend`). Ce fichier y **renvoie** — une règle, un
> seul endroit.
>
> ℹ️ **Le plan de tests WebRTC2 est clos et son fichier supprimé.** Son durable est remonté dans
> [`docs/architecture/tests.md`](../docs/architecture/tests.md) — la méthode : comment lire un
> contrôle à 0, et le 0 croisé qui décide du découpage en fichiers — et dans
> [`docs/modules/webrtc2/tests.md`](../docs/modules/webrtc2/tests.md) pour le harnais. Ne pas le
> chercher, ne pas le recréer.
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
| ~~Convertir les 9 pièges de mock en tests (lot 4)~~ | **Débloqué** : le plan de tests est clos, le harnais a cessé de bouger. C'était la dernière collision |
| ~~Migrer les appelants v1 (lot 1)~~ | **Débloqué** : plus aucun audit en cours sur `Notifications.vue` ni `AlertComponent.vue` |

ℹ️ Le `[L]` « déplacer le routage star », longtemps gelé, **ne l'est plus** : (a) est faite — la
décision de routage vit dans `usePeerTransport.routeIncomingData` — et (b), le routeur générique, est
tranchée en **sortie D** (pas de SFU maintenant ; la couture est recensée dans
[webrtc2-todo.md](webrtc2-todo.md)). Plus aucune collision ouverte avec le module WebRTC2.

### Faisable en parallèle sans aucun risque

Aucun de ces éléments n'est dans l'arbre WebRTC2 : `ACCESORS`, la casse de `Widgets/`, et les
quatre zones mortes (`admin.php`, `console.php`, `table_names`, `SocializerUpgrade`).
`EventBus/webrtc2Events.js` en faisait partie — fait le 31/08, et la prédiction a tenu : la
suppression n'a touché aucun fichier de l'arbre WebRTC2 vivant, hors deux commentaires.

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

- [x] **Migrer les appelants de WebRTC v1 — tous migrés au 26/10/2026 —, puis supprimer `components/WebRTC/`** ·
      effort [L] — **CLOSE le 26/10/2026 : la v1 n'est plus ni dans l'arbre (lot F) ni dans la doc (lot G).**
      **Découpé en sept lots le 31/08/2026 — le plan est plus bas, après le recensement.**
      **La tâche la plus rentable du paquet en volume de doc.** La v1 morte est annoncée dans
      **7 fichiers de doc**, dont le piège n°1 du `CLAUDE.md` et une ligne du `CLAUDE.md` de *tout
      projet hôte* — parce que deux arbres coexistent avec des fichiers homonymes
      (`MediaBroadcastProvider.vue`) et qu'un symbole trouvé au grep peut venir de la v1.

      **Vérifié : cinq appelants vivants au cadrage, quatre depuis le lot C, trois depuis D1, deux
      depuis D2, un depuis D3, ZÉRO depuis E1 (26/10/2026)** — reste un fichier désactivé, et `Server.vue`
      qui n'importe que le store v1, sans le lire (F1). **Plus rien depuis F (26/10/2026) : les deux
      greps rendent zéro.** L'archive de lecture
      `work/webrtc-v1-notes.md` a été supprimée : sa condition de conservation — « le temps de
      vérifier qu'aucun appelant ne subsiste » — était remplie, et le recensement vit désormais
      dans la doc du module, avec la commande qui le recompte.

      | Appelant | Ce qu'il importe |
      |---|---|
      | ~~`System/widgets/AlertComponent.vue`~~ | ✅ **migré le 31/08/2026 (lot C)** — les deux alertes vivent dans `WebRTC2/Widgets/UI/Alerts/` |
      | ~~`AudioRoom/AudioComponent.vue`~~ | ✅ **migré le 26/10/2026 (lot E1)** — `WebRTC2/Widgets/Mediaplayer/MediaBroadcastProvider.vue` en mode `stream`. **Dernier appelant de la v1** ; `ui/AudioDefaultUserButtonUI.vue` est parti avec `SpectrumAnalyzer` (E2) |
      | ~~`Application/ApplicationComponent.vue`~~ | ✅ **migré le 01/09/2026 (lot D2)** — `WebRTC2/Widgets/Mediaplayer/MediaBroadcastProvider.vue`, store v1 débranché |
      | ~~`Whiteboard/WhiteboardComponent.vue`~~ | ✅ **migré le 01/09/2026 (lot D1)** — `WebRTC2/Widgets/Mediaplayer/MediaBroadcastProvider.vue`, store v1 débranché |
      | ~~`ClassRoom/ClassRoomComponent.vue`~~ | ✅ **migré le 01/09/2026 (lot D3)** — `WebRTC2/Widgets/Mediaplayer/MediaBroadcastProvider.vue`, store v1 débranché. **Dernier appelant du canal data** ; `DataUserPeerConnection.vue` n'a donc plus aucun importateur vivant |
      | ~~`AudioRoom/__AudioComponent copy.vue`~~ | ✅ **supprimé le 26/10/2026 (lot F2)** — il importait `WebRTC/composables/usePeers.js` |
      | ~~**`Server/Server.vue`**~~ | ✅ **débranché le 26/10/2026 (lot F1)** — il importait `stores/peers.js` seul, jamais `WebRTC/` |

      ⚠️ **Le recensement par `grep -rn "WebRTC/"` rate un consommateur, et c'est un défaut de la
      commande, pas du recensement.** `Server/Server.vue` n'importe aucun fichier de `WebRTC/` : il
      importe le **store v1** `stores/peers.js`, dont il lit deux getters (`getIsStreaming`,
      `getIsCapturing`). Or le périmètre annonce la suppression de ce store. Le recompte demande
      donc **deux** greps, `WebRTC/` **et** `stores/peers.js` — ✅ **la commande de
      `docs/modules/webrtc2/INDEX.md` est corrigée depuis le lot C** (31/08), et ce fait y a été
      remonté avec elle plutôt que de rester ici.

      Corollaire sur les trois appelants data : ils prennent aussi `sendData` du store v1 par
      `mapActions(usePeerStore, ['sendData'])`. Leur migration n'est donc pas une substitution de
      balise — elle débranche aussi le store. ✅ **Les trois sont faits le 01/09/2026** : Whiteboard
      (D1), Application (D2), ClassRoom (D3). **Plus aucun appelant du canal data n'est branché sur
      le store v1** — ce qui reste de `stores/peers.js` est lu par `Server/Server.vue` (deux getters,
      lot F1) et par deux fichiers de `WebRTC/` qui partent avec le dossier. ✅ *Store supprimé le
      26/10/2026 (lot F2).*

      La v1 n'est donc pas « morte en attente de confirmation » : elle était **vivante sous cinq
      composants** au cadrage, dont un en `defineAsyncComponent`, invisible à une recherche d'`import`
      statique. C'est écrit dans
      [`docs/modules/webrtc2/INDEX.md`](../docs/modules/webrtc2/INDEX.md) — l'annotation qui la
      donnait pour simplement morte sous-estimait le problème, ce qui est pire que de l'ignorer.

      ✅ *Résolu le 26/10/2026 par E2 — `SpectrumAnalyzer` et son importeur v1 sont supprimés ; le
      paragraphe reste comme trace du raisonnement qui a mis la décision dans ce lot.*
      ⚠️ **Le couplage va aussi dans l'AUTRE sens, et ce tableau ne le disait pas** — relevé le
      30/08/2026 en cadrant la tâche 8 des tests. `WebRTC/widgets/ui/AudioDefaultUserButtonUI.vue:13`
      importe `WebRTC2/Widgets/UI/Audio/SpectrumAnalyzer.vue` : un fichier **v2** dont le seul
      consommateur vivant est la **v1**. Ses deux consommateurs WebRTC2 sont commentés — et l'un des
      deux usages commentés est *faux* (`v-bind="audioProps"` passe `{streamData}` à une prop
      `streams: Array required`). Conséquences pour cette tâche : supprimer `components/WebRTC/`
      rend `SpectrumAnalyzer` orphelin, **et c'est le bon moment pour trancher son sort** plutôt que
      de le laisser en v2 sans appelant. Ses deux défauts propres sont classés dans
      [webrtc2-todo.md](webrtc2-todo.md) ; il n'a aucun test, et n'en aura pas (`happy-dom` n'a pas
      d'`AudioContext`).

      Périmètre : **10** fichiers `WebRTC/` (13 au cadrage — le lot C en a sorti deux, E2 un), le store
      `stores/peers.js` (+ son dossier `stores/peers/`) et ses **trois** consommateurs restants (six
      au cadrage ; D1, D2 et D3 en ont débranché un chacun — restent
      `WebRTC/composables/usePeers.js`, `WebRTC/widgets/VideoComponent.vue` et `Server/Server.vue`,
      dont **les deux premiers partent avec le dossier** : le seul à toucher est `Server.vue`, c'est
      F1 — une suppression, ses getters ne sont jamais lus). ~~La migration de l'appelant restant
      (`AudioRoom`, lot E) et le sort de `SpectrumAnalyzer`~~ : **faits le 26/10/2026** (E1, E2).
      ✅ **Périmètre supprimé le 26/10/2026 (lot F)** — les 10 fichiers, le store, `Server.vue`
      débranché, plus un fichier que ce périmètre omettait (F2).
      Annotation (7 fichiers) : `CLAUDE.md` · `docs/INDEX.md` ·
      `docs/modules/webrtc2/INDEX.md` · `docs/modules/autres-modules.md` ·
      `docs/architecture/package.md` · `docs/modules/chat.md` ·
      `resources/boost/guidelines/core.blade.php` · plus le `CLAUDE.md` de tout projet hôte

      **Deux faits relevés le 31/08/2026 en cadrant la tâche, et qui changent le plan.**

      **1. Il n'y a pas de composant à écrire : `WebRTC2/Widgets/Mediaplayer/MediaBroadcastProvider.vue`
      EST le provider data** — `mode` a `'data'` pour défaut, il fait `watchUsers` sur les `users`,
      `initialize(callbacks)` si on lui en passe, et surtout `cleanup()` au démontage, que la v1 ne
      faisait pas. Il a son test. Toute proposition d'un `DataPeerProvider` neuf est de la
      sur-ingénierie : l'exemple d'usage exact est `WebRTC2/Exemples/Home.vue`.

      **2. Mais le contrat du callback n'est PAS mappable 1 pour 1, et c'est là qu'est le travail.**
      En v1, `callbackConnection` reçoit la `DataConnection` **brute** et l'appelant y branche
      lui-même ses `conn.on("data")` / `conn.on("open")`. En v2 c'est le transport qui possède les
      listeners et rappelle `onDataReceived(data, conn, metadata)`
      (`createPeerContext.js`, garde de taille en amont) et `onConnectionOpen(conn)`. Chaque
      appelant se **réécrit** donc.
      ⚠️ **La « bonne nouvelle » écrite ici — « v2 ne parse pas le payload non plus, les `JSON.parse`
      des trois appelants restent valables tels quels » — était FAUSSE, et D0 l'a mesurée le
      01/09/2026.** v1 **sérialise avant d'émettre** (`stores/peers/actions.js`, `safeStringify(message.data)` :
      c'est une **chaîne** qui part sur le fil, d'où le `JSON.parse` de chaque récepteur), alors que
      v2 émet l'**objet** brut (`usePeerTransport.sendData` → `conn.send(data)`) et qu'aucun
      consommateur v2 ne parse quoi que ce soit. Les trois `JSON.parse` doivent donc **disparaître** :
      laissés en place, ils reçoivent un objet et lèvent. La table complète est dans
      `webrtc-data-v1-v2.md`.

      ℹ️ Le watch de `users` du provider v2 **n'est pas profond, et c'est un contrat épinglé**
      (`MediaBroadcastProvider.test.js`, « une composition mutée en place n'est pas vue »). Si un
      appelant mute sa liste en place, c'est **l'appelant** qui s'adapte — jamais le provider.
      **A2 a tranché le 01/09/2026 : aucun ne mute, la liste est réaffectée** ⇒ rien à adapter en D,
      ni chez les appelants ni chez le provider. Le détail est dans A2 ci-dessous.

      **Découpage — sept lots, chacun committable et vérifiable seul.**

      Trois règles, qui expliquent l'ordre :

      - **aucun lot ne change un comportement ET ne déplace un fichier** — on corrige en place, on
        prouve, on déplace ensuite : la preuve du déplacement est le même test resté vert ;
      - **on peut s'arrêter après n'importe quel lot** sans laisser l'arbre à moitié migré ;
      - **la suppression est le dernier lot, jamais un effet de bord** — et sa preuve n'est pas
        Vitest : un fichier que plus rien n'importe n'entre dans aucune suite. C'est `npm run build`.

      - [x] **A. Poser le filet — zéro changement de comportement** `[S]` — **lot clos le
            01/09/2026** : A1 (21 cas), A2 (la lecture qui débloque D) et A3 (le filet à la source
            de la présence, 3 cas). Le filet promis est en place aux deux bouts du contrat de
            présence.
            - [x] A1 — **fait le 31/08/2026. Deux fichiers, 21 cas, dont 4 ROUGES refermés par B1
                  sans qu'une ASSERTION change** :
                  `System/__tests__/AlertComponent.test.js` (12 cas, 3 rouges — la branche vocale
                  et l'énumération du vocabulaire) et `System/__tests__/Notifications.alerts.test.js`
                  (9 cas, 1 rouge — le symptôme utilisateur, à l'altitude où c'en est un).
                  Chaque rouge était précédé d'un garde-fou de présence : le message était « le verbe
                  n'est pas atteint », jamais « bouton introuvable ».
                  ⚠️ **La promesse « sans toucher une ligne de test » était trop large, et B1 l'a
                  mesuré** : les assertions n'ont pas bougé, mais **6 titres et les 2 docblocks**
                  portaient l'annotation « rouge jusqu'à B1 » et sont devenus faux à la seconde où
                  le correctif est passé. Une prose de test est une couche du volet doc comme une
                  autre — à énumérer d'avance, comme les autres.
                  **Trois acquis qui servent aux lots suivants :**
                  · **le lot C n'aura AUCUNE ligne de test à modifier** — les deux fichiers
                  n'importent que `AlertComponent` et atteignent les alertes par leur `name` et
                  leur titre rendu, deux identités qu'un `git mv` ne touche pas. Sa preuve
                  annoncée (« sans autre modification que le chemin d'import ») est donc plus
                  forte : seuls les deux `defineAsyncComponent` d'`AlertComponent.vue` changent.
                  · **le second fichier est justifié par la mesure, pas par le rangement** : les
                  huit contrôles de couture de `Notifications.vue` rougissent là-bas et **0 cas**
                  des trois autres fichiers. `.AlertToUser` et `onResponseAlert` n'étaient
                  couverts nulle part.
                  · **`flushPromises` n'est pas un substitut de `dynamicImportSettled`, et la
                  profondeur de la chaîne de modules décide** : au fichier unitaire (un niveau
                  d'asynchrone) il passe, au fichier de couture (deux niveaux) il laisse 2 cas
                  rouges. Mesuré des deux côtés, écrit dans les deux docblocks — ne pas re-mesurer.
            - [x] A2 — **fait le 01/09/2026. Réponse : `users` est REMPLACÉ, jamais muté en
                  place** ⇒ c'est la branche « rien à faire » — **l'appelant ne passe pas de copie et
                  le provider ne bouge pas**. D0 peut s'écrire tel qu'il est cadré.
                  **La question ne se pose pas appelant par appelant, et c'est le vrai résultat de
                  la lecture** : les trois ne possèdent pas leur liste, ils la reçoivent en **prop**.
                  Source unique, et unique par construction — le `<router-view :users="users">` de
                  `Server/Room.vue:23-28`, seul endroit où les trois sont montés (arbre de routes :
                  `Server.vue` → `room/:roomId` = `Room.vue` → `whiteboard` / `classroom` /
                  `application`). `ClassRoom` repasse la **même** référence à `Whiteboard`. Le `grep`
                  des trois noms de composants dans le projet hôte et les autres paquets maison rend
                  **zéro** : aucun montage hors de ce chemin.
                  La liste vient donc d'`useReverbChannel(channelName, { type: 'presence' })`, qui
                  **réaffecte sur ses quatre chemins d'écriture** — `here` (l.128,
                  `users.value = presentUsers`), `joining` (l.148, spread), `leaving` (l.153,
                  `filter`), `leave()` (l.119, `[]`). Aucun `push`/`splice` sur une liste
                  d'utilisateurs dans tout le paquet, hors tests.
                  **Trois faits adjacents, à consommer dans les lots qui les concernent :**
                  · **le `deep: true // keep this` de `DataUserPeerConnection.vue:65` ne garde rien
                  de plus que le superficiel** — rien ne mute un objet `user` en place
                  (`useStatusUsersObserver` écrit dans `applicationStore` par slug, pas dans la
                  liste) : sortie **B** à consommer au lot F, quand le widget disparaît. Ne pas le
                  recopier en v2.
                  · **le garde `if (newVal.length === 0) return` de v1 n'a pas d'équivalent à écrire
                  en v2** : le premier tour à vide est traité par conception et déjà documenté
                  (`useMediaBroadcast.js:143-151` — `getRoomUsersDiff` ne passe `presenceSynced` à
                  `true` que sur un tour qui a OBSERVÉ un membre). Rien à porter en D.
                  · **le contrat « le fournisseur réaffecte » n'était épinglé à AUCUN bout** — d'où
                  A3. Le cas provider (`MediaBroadcastProvider.test.js`, « le watch n'est PAS
                  profond ») tient la moitié consommateur et **son commentaire annonçait déjà
                  l'autre : « l'autre moitié est un item de `work/` »**.
                  Annotation : **aucune couche injectée**, vérifié — les deux occurrences de
                  `core.blade.php` sur `users`/`watch` parlent d'autre chose (`Users::visibleUsers`,
                  le fil d'Ariane) et le `CLAUDE.md` du paquet rend zéro. **Aucun `boost:update`** ;
                  cinquième tâche d'affilée dans cette configuration, après `sfu`, `webrtc2Events`,
                  B1 et B2.
                  - [x] Code — **aucun, par définition** : A2 est une lecture · - [x] Doc — le `ℹ️`
                        du cadrage ci-dessus (la question qu'il posait est tranchée), cet item, et
                        les deux `work/README.md` · - [x] Tests — **aucun dans la lecture**. Ce
                        qu'elle a trouvé à épingler est A3, une tâche à part entière et non un effet
                        de bord
            - [x] A3 — **fait le 01/09/2026, sortie C.** Épingler la réaffectation **à la source**,
                  la moitié que le cas provider ne peut pas tenir. Trois cas dans le `describe`
                  « liste de présence » d'`useReverbChannel.test.js`, un par chemin d'écriture
                  réactif, chacun assérant une **nouvelle référence** — le harnais existait, rien à
                  écrire pour l'accueillir.
                  ⚠️ **Les trois naissent VERTS, et c'est le cas prévu** : ce sont des gardes de
                  non-régression, pas la contre-épreuve d'un défaut. **La règle du paquet ne tombe
                  pas pour autant** — ce qui remplace le rouge de naissance est le **contrôle de
                  harnais**, sans lequel ces trois cas ne valent rien : `here` → `push(...présents)`,
                  `joining` → `push(user)`, `leaving` → `findIndex` + `splice` rougissent **chacune
                  le cas correspondant et lui seul**, et aucune ne fait bouger les six cas de valeur
                  du `describe` — ils assèrent en `toEqual`, qui ne voit pas l'identité. C'est
                  exactement ce qui laissait passer la panne. Référence relue à 24/24 entre chaque
                  mutation, et `git status` contrôlé après restauration.
                  Hors périmètre assumé, écrit dans le docblock : la remise à `[]` de `leave()` —
                  son seul consommateur est le démontage, où le provider part avec le canal.
                  - [x] Code — **aucun** : le composable était déjà correct, c'est un filet
                        · - [x] Doc — **deux mesures devenues fausses à la seconde où les cas sont
                        passés au vert**, toutes deux corrigées en sortie C (l'avertissement
                        remplacé par un nom de test) : le commentaire de
                        `MediaBroadcastProvider.test.js` (« rougit 0 cas sur 1416 », « l'autre moitié
                        est un item de `work/` ») et `docs/modules/webrtc2/tests.md` § « Pousser dans
                        un tableau NU » (« rougit 0 cas sur 1417 »). ⚠️ **Une prose de test est une
                        couche du volet doc** — la leçon de B1, et c'est la deuxième fois qu'elle
                        mord. Le reste de `docs/` attend le lot G, décidé · - [x] Tests — 3 cas,
                        3 mutations mesurées. Suite JS **85 fichiers / 1501 cas, 0 échec**
                        (85 / 1498 avant) ; PHP non rejouée, aucun `.php` touché
      - [x] **B. Les défauts propres aux deux alertes — indépendants de la migration, livrables
            seuls** `[S]` — **CLOS le 26/10/2026** : B1 et B2 le 31/08, B3, B4 et B5 le 26/10
            - [x] B1 — **fait le 31/08/2026, sortie A.** `AudioCallAlert` émettait `response-call`
                  quand tout le monde écoute `response-alert` : **zéro écouteur dans le paquet**,
                  donc Accepter et Refuser étaient morts sur un appel VOCAL entrant, et l'auto-refus
                  à 20 s aussi ; l'appelant attendait l'abandon du moteur de retry. Trois lignes
                  (`emits` + les deux `$emit`) ⇒ les 4 rouges de A1 au vert.
                  **La forme était contrainte par un test**, et c'est ce qui rend le lot C possible :
                  un seul vocabulaire pour les deux alertes, pas un second écouteur chez le parent —
                  elles restent interchangeables vues d'`AlertComponent`.
                  ⚠️ **Effet de bord à connaître avant B2 : B1 a ARMÉ le timer d'auto-refus vocal.**
                  Il émettait dans le vide, il émet désormais un vrai refus. Les deux alertes sont
                  donc également exposées au défaut B2, là où une seule l'était.
                  Annotation : **aucune couche de `docs/`** — le 🔴 n'y avait jamais été rustiné, il
                  y était *ignoré* (`docs/modules/webrtc2/flux.md` décrivait la chaîne d'appel
                  entrant comme fonctionnelle pour les deux types, et B1 la rend vraie **sans une
                  ligne d'édition**). Une doc fausse par omission, cas que le chantier ne prévoit
                  pas. En revanche **deux docblocks de test** la portaient. **Aucun `boost:update`
                  requis**, vérifié : ni le `CLAUDE.md` du paquet ni `core.blade.php` ne citaient
                  `response-call` — troisième tâche d'affilée dans cette configuration, après `sfu`
                  et `webrtc2Events` : la frontière est nette, `core.blade.php` ne descend jamais au
                  niveau du widget.
                  - [x] Code — 3 lignes dans `AudioCallAlert.vue` · - [x] Doc — les 2 docblocks
                        (bannières requalifiées en sortie C, l'exemple périmé reformulé sans exemple
                        nommé, la contrainte de forme promue en garde de non-régression, les caveats
                        des contrôles de harnais requalifiés — chiffres **non re-mesurés**, dette
                        nommée pour le lot C : ils ne se convertissent pas en écarts par
                        soustraction) + `webrtc2-todo.md`, les deux `work/README.md` et une ligne de
                        `docs/architecture/tests.md` · - [x] Tests — aucun à écrire, A1 les avait
                        posés : 21/21 verts, **aucune assertion touchée**, 6 titres requalifiés.
                        Suites inchangées par ailleurs — JS 84 fichiers, 0 échec (4 avant) ; PHP 286
                        OK
            - [x] B2 — **fait le 31/08/2026, sortie A + sortie B.** Dans les **deux** alertes, le
                  handle du `setTimeout` d'auto-refus n'était pas stocké — `beforeUnmount` n'annulait
                  que l'`interval` — et `pickedUp` n'était jamais écrit à `true`. Un seul
                  `clearTimeout`, posé sur le chemin commun aux TROIS sorties (accepter, refuser,
                  quitter l'écran), ferme les deux moitiés : l'ensemble des chemins qui auraient posé
                  `pickedUp = true` est exactement celui qui appelle la méthode d'arrêt. `pickedUp`
                  devient donc mort au sens strict ⇒ **supprimé** (sortie B), et `stopDing` est
                  renommé `stopAlert` — y absorber `clearTimeout` sans renommer aurait fabriqué un
                  nom qui ment. Le `ding.pause()` en double du `beforeUnmount` part par construction.
                  ⚠️ **Ne PAS livrer les deux gardes ensemble** : `pickedUp` et `clearTimeout`
                  tiendraient la même propriété par deux mécanismes, et la mutation n° 2 ne
                  rougirait plus que 2 cas au lieu de 5 — le contrôle de harnais mentirait.
                  ⚠️ **Le rouge annoncé ici (« accepter à 5 s n'émet pas de refus à 10 s ») serait né
                  VERT à l'étage de couture**, et c'est ce qui a décidé du fichier : `Notifications`
                  démonte l'alerte en première ligne d'`onResponseAlert`, et Vue 3.5.24 **avale
                  l'émission d'une instance démontée** (`runtime-core.cjs.js:6367`) — VTU supprimant
                  par ailleurs l'historique au démontage. Le cas vit donc à l'étage `AlertComponent`,
                  qui ne démonte jamais l'alerte. **Le `describe` local est écarté**, pour trois
                  raisons dont deux non anticipées : l'`afterEach` d'un `describe` imbriqué tourne
                  AVANT celui du parent, donc `useRealTimers()` passerait avant `unmount()` ; et il
                  aurait fallu réécrire la section « hors périmètre » de `AlertComponent.test.js`,
                  qui déclare ne pas appeler `vi.useFakeTimers()`.
                  Annotation : **aucune couche injectée** — `grep` sur `core.blade.php` et le
                  `CLAUDE.md` du paquet rend zéro, donc **aucun `boost:update`** ; quatrième tâche
                  d'affilée dans cette configuration, après `sfu`, `webrtc2Events` et B1.
                  - [x] Code — ~9 lignes dans chacune des deux alertes, `diff` des deux fichiers
                        **toujours à 4 lignes** (titre, `name:`, 20000/10000) : le lot C est intact
                        · - [x] Doc — une ligne de `docs/modules/webrtc2/flux.md` (l'auto-refus n'y
                        nommait que la branche visio, fausse par omission depuis que B1 a armé la
                        vocale) + les deux docblocks de A1 (les **deux bornes de durée chiffrées
                        partent AVEC leur cause** — le démontage annule désormais le minuteur —,
                        `stopDing` renommé, le commentaire d'`afterEach` requalifié en contrat du
                        composant, `pickedUp` retiré de l'énumération hors-périmètre) + un
                        commentaire de constat sur le voisin non couvert (B5) + `webrtc2-todo.md`
                        (item élagué, B5 posé, la ligne des « deux filets » corrigée) + les deux
                        `work/README.md`. ⚠️ Les 11 + 11 contrôles de harnais de A1 **non
                        re-mesurés** : ce sont des mutations d'`AlertComponent.vue`, que B2 ne touche
                        pas — la dette reste propriété du lot C · - [x] Tests —
                        `AlertComponent.timers.test.js`, **le troisième harnais et le premier montage
                        de composant Vue sous horloge factice du paquet** : 9 cas dont **5 rouges
                        d'abord**, verts au correctif sans qu'une assertion change. 12 mutations
                        mesurées, référence relue à 0 avant chacune. Suites : JS **85 fichiers /
                        1498 cas, 0 échec** (84 / 1489 avant) ; PHP 286 OK
            - [x] B3 — **fait le 26/10/2026, sortie A — garde + repli (décision de David).** Le
                  double déréférencement d'`AlertComponent.created()` passe en chaînage optionnel, et
                  un couple `(action, type)` sans alerte **se refuse d'office** : `response-alert(…,
                  false)` dès le `created()`, avec un `console.warn`. ⚠️ **Le repli ne pouvait pas
                  être « ne rien afficher »**, et c'est B5 qui l'a montré : une alerte invisible
                  GARDE le créneau de `Notifications`, que rien ne libère sans réponse. Mesuré avant
                  le correctif : après une invitation `screen`, que le backend laisse passer, l'appel
                  suivant d'un autre utilisateur était **invisible** — le patch ne rejouait pas le
                  `created()`. Avec le garde de B5 seul, il aurait été **refusé** : B5 sans B3
                  changeait un défaut silencieux en refus systématique. Le garde PHP
                  (`VALID_INVITE_ACTIONS`) reste la première ligne ; le commentaire de son test, qui
                  disait le JS « sans garde », est requalifié.
                  🔴 **La relecture a réfuté le docblock que ce lot venait d'écrire** (« le refus
                  libère le créneau ») : une alerte CONNUE dont le chunk ne se charge pas — un onglet
                  ouvert avant un déploiement — ne rendait rien, ne répondait rien, et `currentComponent`
                  valait la chaîne `'VideoCallAlert'`, vraie, donc le repli ne la voyait pas. Le garde de
                  B5 refusait alors tous les appelants suivants, avec un toast parlant d'un appel que
                  personne ne voyait. Pas une régression — sur HEAD, ces appels étaient invisibles —,
                  mais l'affirmation était fausse. Corrigé par un `errorComponent` sur les **deux**
                  `defineAsyncComponent` de la chaîne, qui se refuse dès son montage — et, second trou
                  trouvé par la même relecture, un **`timeout`** (`ALERT_LOAD_TIMEOUT_MS`, 10 s) : un
                  chunk qui PEND n'atteint le composant d'erreur que par lui.
                  - [x] Code — le `created()` d'`AlertComponent.vue`, les deux `errorComponent` et
                        `ALERT_LOAD_TIMEOUT_MS` dans `system.config.js` · - [x] Doc — `flux.md` (le
                        schéma et deux paragraphes de l'appel entrant), une incise d'`api.md`, l'en-tête
                        d'`AlertComponent.test.js` (B3 sort du « hors périmètre ») et le commentaire
                        de `ValidationTest.php` · - [x] Tests — 3 cas rouges d'abord : 2 unitaires (le
                        `type`, l'`action` qui levait), 1 de couture (le créneau rendu) ; puis
                        `AlertComponent.loadError.test.js` et `Notifications.alerts.loadError.test.js`,
                        un par niveau, 5 cas : rejet et pendu à chaque niveau, plus « l'appelant
                        suivant n'est pas refusé comme occupé » — les cas de rejet rouges d'abord, les
                        cas pendus rouges sans `timeout`
            - [x] B4 — **fait le 26/10/2026, sortie A.** `shallowRef` au lieu de `ref` : une ligne,
                  aucun comportement. Épinglé par un cas qui lit `console.warn` pendant un montage
                  réel d'alerte — rouge d'abord, et la mutation inverse ne rougit que lui.
                  - [x] Code — `Notifications.vue` · - [x] Doc — le paragraphe « nommé, pas
                        corrigé » de `Notifications.alerts.test.js` · - [x] Tests — 1 cas
            - [x] B5 — **fait le 26/10/2026, sortie A — décision produit : occupé ⇒ refus**
                  (David). Une invitation reçue pendant qu'une alerte attend la réponse d'un AUTRE
                  appelant est refusée d'office : un toast chez l'appelé, et chez l'appelant le refus
                  du bouton « Refuser » (`acceptCallFromPeer`, `status: false`), qui arrête son retry
                  tout de suite. **Pas de `key`** : c'était le correctif de l'autre réponse, « le
                  dernier gagne ». `onResponseAlert` est scindé pour que le refus d'office prenne le
                  MÊME verbe que le clic (`respondToInvitation`).
                  ⚠️ **Le garde compare l'appelant, et ce n'est pas une politesse** — mais pas pour la
                  raison écrite d'abord. Une relance du moteur de retry réutilise son `inviteId`, et
                  `isInviteDuplicate` l'élimine avant le garde (relecture). Ce qui lui échappe et vient
                  du même compte : un client sans `inviteId` (`nullable` côté serveur), ou un **second
                  onglet / appareil**, avec un id neuf. Le refuser partirait sur le canal de
                  l'appelant, vers tous ses onglets, et y couperait l'appel qui sonne ici — mesuré
                  par la relecture : la charge du refus ne porte pas d'`inviteId`, et
                  `useCallManager.test.js` mène un tel refus de CALLING à IDLE. Le patch ne fait que
                  reporter cette coupure à la réponse finale. `fromUserSlug` est posé par le serveur depuis l'utilisateur authentifié.
                  **Bornes assumées, écrites dans `flux.md`** : le même compte repasse par le patch —
                  un *nouvel* appel de sa part pendant que son alerte sonne (second onglet, autre
                  appareil, ou rechargement ; la première version disait « seulement en rechargeant »,
                  réfuté par la relecture) hérite du type affiché et du reliquat de minuteur, 20 s au
                  plus, mesuré par la relecture à 4 s du refus. Et pendant qu'une alerte se CHARGE, un
                  autre appelant est refusé avec un toast qui parlait d'un appel encore invisible
                  (reformulé le même jour, voir plus bas),
                  2 × `ALERT_LOAD_TIMEOUT_MS` au plus — les deux niveaux sont en série (première
                  version : « au plus 1× », réfuté par la relecture, 20,5 s mesurés). Et
                  `CallAlertUnavailable` ne couvre que le chargement : une exception dans le `data()`
                  d'une alerte garderait le créneau — aucun chemin réaliste aujourd'hui.
                  - [x] Code — `Notifications.vue` : le garde, `isAwaitingAnotherCaller`,
                        `respondToInvitation` · - [x] Doc — `flux.md`, la table des événements de
                        `signalisation.md`, le commentaire du cas voisin dans
                        `Notifications.alerts.test.js`, la puce « face vive » de
                        `AlertComponent.timers.test.js`, `webrtc2-todo.md` (item élagué) et les deux
                        `work/README.md` · - [x] Tests — 4 cas, dont 2 rouges d'abord ; les deux nés
                        verts gardent les deux façons fausses d'écrire le garde — sans comparaison
                        d'appelant, « occupé » lu sur les props — et chacune est mesurée par mutation
            ⚠️ **Ce que le lot B ajoute à la doctrine en se fermant : deux tâches d'une même famille se
            cadrent ensemble, même quand elles se livrent séparément.** Lu seul, B3 offrait « garde +
            repli, ou sortie D », et le repli évident — ne rien afficher — était faux : il a fallu
            poser le garde de B5 à côté pour voir que l'alerte vide gardait le créneau.
            ⚠️ **Et ce que la relecture y ajoute** : une phrase qui promet « pour toujours » ou « le
            libère » se falsifie en cherchant le chemin qui **n'atteint pas** le code qui la tient —
            ici, une alerte qui ne monte jamais, donc dont aucun minuteur ne naît. Le repli de B3
            couvrait « ne sait pas afficher » ; il fallait aussi « ne peut pas charger », et deux
            pannes pour le dire : le rejet ET l'attente sans fin.
            **Puis, le même jour, les quatre décisions que la relecture avait laissées à David** :
            le délai reste à 10 s ; l'appelé est prévenu par un toast PERSISTANT qui l'invite à
            recharger (`missedCallMessage`, partagé par les deux composants de repli — rouge d'abord,
            5 assertions) ; le toast « occupé » devient « un autre appel arrivait déjà », vrai même
            pendant un chargement ; et `vite:preloadError`, la cause amont, part dans le `work/`
            d'estarter — elle touche tous les chunks de tous les paquets, et le geste habituel, un
            rechargement forcé, couperait un appel en cours. L'item 🟠 de `webrtc2-todo.md` est élagué.
            Clôture : 18 mutations et 2 contrôles de harnais mesurés sur une référence verte, aucun
            à 0 sur le fichier qui porte son cas. Suites : JS **89 fichiers / 1537 cas, 0 échec**
            (87 / 1525 avant) ; PHP 286 OK ; build vert. **Aucun `boost:update`** : `grep` à zéro sur
            `core.blade.php` et le `CLAUDE.md` du paquet. Relevés en passant, non corrigés, périmés
            AVANT ce lot : les renvois `Notifications.vue:42` et `:71` de
            `Notifications.callControls.test.js`, et `Notifications.vue:71` de
            `helpers/createCallPeersDouble.js`.
      - [x] **C. Déplacer les deux alertes** `[S]` — **fait le 31/08/2026, sortie B.** `git mv` vers
            `WebRTC2/Widgets/UI/Alerts/` + les deux `defineAsyncComponent` d'`AlertComponent`. Elles
            étaient v1 **par leur chemin, pas par leurs dépendances** : elles n'importent que
            `IconWidget` (par alias, donc insensible au chemin) et leur consommateur était déjà
            branché sur la v2 (`Notifications.onResponseAlert` → `peers.acceptCallFromPeer`).
            La preuve annoncée a tenu **exactement** : `git status` montre trois entrées — deux
            renommages (`R`) et **une seule ligne modifiée ailleurs**, la paire d'imports
            d'`AlertComponent.vue`. Zéro fichier de test touché, suite JS **85 fichiers / 1498 cas,
            0 échec** — identique à la baseline de B2 — et `npm run build` vert, seul contrôle qui
            voie la résolution Rollup d'un import dynamique.
            ℹ️ **Ce que le lot a coûté en plus de son diff : trois lignes de doc devenues fausses au
            même instant**, toutes des *comptes* — les appelants v1 passent de cinq à quatre, les
            fichiers de `WebRTC/` de 13 à 11, et `Widgets/UI/` gagne un sous-dossier. Le
            déplacement le plus mécanique du chantier avait quand même un volet doc : un lot qui ne
            change aucun comportement peut périmer un décompte, et un décompte est une annotation
            comme une autre.
            - [x] Code — 2 `git mv` + 2 lignes ; `WebRTC/widgets/partials/` disparaît, vide
            - [x] Doc — `docs/modules/webrtc2/INDEX.md` (le compte, l'arborescence, **et** la
                  commande de recompte, corrigée ici au lieu du lot G) et
                  `docs/modules/webrtc2/api.md` (l'inventaire `Widgets/UI/` omettait deux widgets du
                  module). **Aucun `boost:update` requis**, vérifié : ni le `CLAUDE.md` du paquet ni
                  `core.blade.php` ne contiennent la chaîne `alert` — même configuration que `sfu`
                  et `EventBus`
            - [x] Tests — **aucun**, et c'est le contrat du lot : les trois fichiers d'alerte
                  atteignent les composants par leur `name` d'option et leur titre rendu, deux
                  identités qu'un `git mv` ne touche pas. Un rouge chez eux aurait dit « chemin
                  d'import faux », rien d'autre
      - [ ] **D. Le canal data, un module à la fois** `[L]`
            - [x] D0 — **fait le 01/09/2026.** La correspondance est écrite une fois, et **partagée
                  en deux** : le contrat v2 — signatures des quatre callbacks,
                  `sendData(data, destUserSlugs)`, les quatre cas où `onDataReceived` n'arrive pas ou
                  arrive en **arité 1** — est allé dans `docs/modules/webrtc2/api.md`, qui n'en
                  listait que les **clés** ; le delta v1→v2 et les spécificités des trois modules dans
                  `webrtc-data-v1-v2.md`, qui **pointe** `api.md` au lieu de le
                  recopier et porte sa condition de suppression en tête (il part avec la v1, au lot
                  F/G — précédent : `webrtc-v1-notes.md`).
                  **La lecture a rapporté plus que la table**, et c'est le résultat du lot :
                  · **une ligne du cadrage était fausse** — les `JSON.parse` (⚠️ ci-dessus), corrigée
                  à sa source plutôt que contournée ;
                  · **l'avertissement d'`api.md` sur `callbacks` était faux aussi**, et sur un piège
                  vécu : « passer `callbacks`
                  **et** initialiser dans l'enfant initialiserait deux fois ». Non — le stockage est
                  **write-once par clé**, le second jeu est **perdu en silence** et les callbacks de
                  l'enfant ne prennent jamais effet. `usePeerOrchestrator.callbacks.test.js` le disait
                  déjà mot pour mot ; l'avertissement porte désormais le nom de son test ;
                  · **`exclude` n'a AUCUN équivalent v2** (`destUserSlugs` ne rend qu'`include`) : un
                  message v1 portant `include` passerait en v2 comme un champ de payload, **sans
                  filtrer personne et sans erreur**. Application en est le seul consommateur ⇒ point
                  ouvert rattaché à **D2**, pas au lot D en général.
                  ℹ️ **L'écart de sérialisation est la seule affirmation structurante que rien
                  n'épingle** : `usePeerTransport.mesh.test.js` tient bien l'absence de transformation
                  à l'émission, mais tous ses cas passent une chaîne ou un `ArrayBuffer`, jamais un
                  objet. Écrit comme tel dans le fichier de delta.
                  - [x] Code — **aucun, par définition** : D0 est une écriture, comme A2
                  - [x] Doc — les cinq couches, énumérées d'avance : `docs/modules/webrtc2/api.md`
                        (substance + la correction) · `work/webrtc-data-v1-v2.md` (neuf) · cet item et
                        le ⚠️ du cadrage · `work/README.md` du paquet · le `work/README.md` de l'hôte.
                        **Aucun `boost:update`** — vérifié : `sendData`, `callbacks`, `onData` et
                        `initialize` rendent **zéro** sur le `CLAUDE.md` du paquet **et** sur
                        `core.blade.php`. Sixième tâche d'affilée dans cette configuration, après
                        `sfu`, `webrtc2Events`, B1, B2 et A2
                  - [x] Tests — **aucun**, volet code vide. Ce qui remplace le rouge de naissance :
                        chaque affirmation du contrat v2 nomme le test qui l'épingle, ou dit qu'aucun
                        ne le tient (le cas de la sérialisation, ci-dessus)
            - [x] D1 — **Whiteboard** — **fait le 01/09/2026.** Un seul fichier de code, exactement
                  ce que la recette annonçait : balise, callbacks, deux émissions, débranchement du
                  store v1. Le décompte des appelants v1 vivants passe de **quatre à trois**, vérifié
                  aux deux greps du recompte. Suite JS **85 fichiers / 1501 cas, 0 échec** —
                  identique à la baseline d'A3, mesurée avant l'édition — et `npm run build` vert.
                  **La recette de D0 s'est trompée deux fois, et les deux corrections servent D2 et
                  D3 :**
                  · ⚠️ **`onConnectionOpen` tire dans les DEUX SENS** — `setUpConnectionListeners`
                  est appelé par `usePeerConnections` sur la sortante **et** par `usePeerTransport`
                  sur l'entrante — là où le `callbackConnection` de la v1 ne tirait que sur
                  l'entrante. La recette disait bien « seulement pour les connexions entrantes » de
                  la v1, mais n'en tirait pas la conséquence : **« préserver l'effet de bord » ne
                  peut pas se faire par substitution**. Sans garde, chaque pair renvoyait sa scène
                  **deux fois** par arrivant. Le sens se lit sur `conn.metadata.from` — mon slug sur
                  une sortante, celui du pair sur une entrante — parce que la metadata est construite
                  par l'émetteur de la connexion. **Et ce n'est pas cosmétique chez D2** : son
                  `on('open')` poste `connectionEnabled { slug: conn.metadata.from }` à l'iframe, qui
                  recevrait donc une annonce de pair **me désignant moi**, sans erreur ni trace ;
                  · ⚠️ **le plafond de 64 Ko est une RÉGRESSION, pas une borne native** : le
                  `sendData` du store v1 n'avait **aucune** limite (`safeStringify` puis `conn.send`,
                  PeerJS chunkant lui-même), celui de la v2 abandonne l'envoi **sans un mot**. Or
                  `update_scene` transporte la scène Excalidraw entière — le plus gros payload du
                  paquet et le seul dont la taille est pilotée par l'utilisateur : une image collée
                  suffit. **Assumé ici** (relever `MAX_PAYLOAD_BYTES` ou découper la scène touche la
                  surface anti-DoS de `securite.md`, ce n'est pas un détail de migration) et ouvert
                  en tâche propre, ci-dessous.
                  ℹ️ **Un mode de panne neuf, propre au changement d'accès et vrai pour les trois
                  modules** : `sendData` était une action de store, toujours appelable, alors que
                  `$refs.dataBroadcast` vaut `undefined` quand le `v-if` du provider est faux — et
                  les listeners DOM, eux, sont posés inconditionnellement en `mounted()`. D'où le
                  `?.` aux deux émissions.
                  - [x] Code — `WhiteboardComponent.vue`, **le seul fichier**. `mapActions` reste
                        importé : `useServerStore` s'en sert encore, seul le `mapActions(usePeerStore,
                        …)` part
                  - [x] Doc — **quatre couches.** `docs/modules/webrtc2/INDEX.md` (le décompte,
                        quatre → trois) · `docs/modules/webrtc2/api.md` (**les deux faits durables
                        que D1 a mis au jour** : le double sens d'`onConnectionOpen` avec son test,
                        et la scène Excalidraw comme payload qui frôle le plafond) ·
                        `work/webrtc-data-v1-v2.md` (le périssable : le « c'était mieux avant » de
                        l'écart 5, le piège de D2, et l'en-tête qui dit que la recette s'est trompée)
                        · cet item, le `work/README.md` du paquet et celui de l'hôte.
                        **Aucun `boost:update` requis**, vérifié : `Whiteboard`,
                        `DataUserPeerConnection`, `onConnectionOpen` et `sendData` rendent **zéro**
                        sur `core.blade.php` **et** sur le `CLAUDE.md` du paquet. ⚠️ `quatre` y rend
                        **un** hit, et il fallait le lire au lieu de le compter : c'est le titre
                        « Les quatre pièges qui coûtent cher », sans rapport avec le décompte des
                        appelants — et le piège n°1, « `WebRTC/` est mort », ne porte aucun nombre et
                        reste vrai jusqu'au lot F. **Septième tâche d'affilée** dans cette
                        configuration
                  - [x] Tests — **aucun**, et c'est le contrat du lot D : composant métier hors du
                        filet, aucun test ne l'importe (d'où la suite strictement inchangée).
                        `npm run build` est le seul contrôle qui voie la résolution de l'import neuf
                  - [x] **Vérif manuelle — PASSÉE le 01/09, et elle a trouvé un 🔴.** Curseurs
                        distants OK avec leur pseudo (`pointer_move`), mais **aucun élément dessiné
                        ne se propageait** : `Uncaught Error: Type "function Map() { [native code] }"
                        not yet supported`, à chaque `mouseup`, depuis `conn.send`.
                        **Cause** : PeerJS sérialise en **BinaryPack**, qui LÈVE sur une `Map` — et
                        `getAppState()` d'Excalidraw 0.18 en porte une, `collaborators`. La v1 ne le
                        voyait pas : `safeStringify` aplatissait tout en chaîne et la `Map` y devenait
                        `{}` **par accident**. La v2 émet l'objet tel quel, c'est le contrat, donc
                        BinaryPack la rencontre.
                        ⚠️ **Le throw coûtait deux choses de plus que le symptôme visible** : il est
                        synchrone dans le `forEach` de diffusion, donc les pairs suivants ne
                        recevaient rien — et il remontait à l'appelant, sautant le `saveScene` placé
                        après, donc **D1 avait aussi cassé la persistance du dessin** sur un tableau
                        `isSavable`.
                        ⚠️ **Le garde de taille ne pouvait pas l'attraper** : il mesure via
                        `JSON.stringify`, qui accepte une `Map`. Il rejette une **fonction nue**, ce
                        qui donnait l'illusion d'une couverture. Le trou est précis — **un conteneur
                        que JSON accepte et que BinaryPack refuse**.
                        ✅ **Correctif, et il ne coûte rien** : ne plus émettre l'`appState`.
                        `ExcalidrawElement.updateScene` lit **`data.state`**, une clé que **personne
                        n'émet** — ni ce composant, ni le serveur. L'`appState` transmis n'a donc
                        **jamais** été appliqué, en v1 comme en v2. Le retirer enlève la `Map`, la
                        plus grosse part inutile du payload, et **rien** à personne. `saveScene`
                        reçoit toujours l'objet entier : le format stocké ne change pas.
                        ℹ️ **Ce qui a rendu le correctif sûr est une méthode, pas la chance** : avant
                        de choisir comment sérialiser (round-trip JSON ? retirer `collaborators` ?),
                        on a lu le **récepteur**. « Quoi émettre » n'avait pas de réponse tant qu'on
                        ignorait ce qui était lu en face. Les deux correctifs « évidents » étaient
                        tous deux moins bons, et le round-trip aurait livré `collaborators: {}` à un
                        Excalidraw qui appelle `.get()`, `.forEach()` et `.size` dessus.
                        - [x] Tests — **un cas neuf, plus une contre-épreuve annotée**, dans
                              `usePeerTransport.mesh.test.js`. Le premier ferme le trou que **D0
                              avait lui-même signalé** : l'objet imbriqué ressort **identique**
                              (`toBe`, identité référentielle — la différence exacte avec la v1),
                              alors que tous les cas existants passaient une chaîne, un `ArrayBuffer`
                              ou une fonction. La seconde épingle que le garde **laisse passer** une
                              `Map`, avec l'avertissement de ne pas la lire comme « les `Map` sont
                              supportées » : elle rougira le jour où le garde de transportabilité
                              sera posé.
                              ⚠️ **Et le fait le plus utile du correctif : AUCUN test de la suite ne
                              pouvait voir ce bug, ni ne le pourra** — `conn.send` est un `vi.fn()`,
                              le harnais n'a pas de BinaryPack. Écrit dans
                              `docs/modules/webrtc2/tests.md`, en tête des pièges de mock. **La
                              vérification manuelle n'est donc pas une formalité de fin de lot : sur
                              ce module, c'est le seul contrôle qui exerce le transport réel.**
                        - [x] Doc — `api.md` (**section neuve** : `sendData` peut LEVER, le garde ne
                              l'attrape pas, le throw abandonne les pairs suivants ; plus la
                              correction du ⚠️ de D1, la scène n'est plus `elements + appState +
                              files`) · `docs/modules/webrtc2/tests.md` (le piège de mock) ·
                              `work/webrtc-data-v1-v2.md` (§C écart 5 et §D1) · cet item · les deux
                              `work/README.md`. **Deux tâches ouvertes**, ci-dessous et au lot 5
                        - [x] **Re-vérif à deux navigateurs — PASSÉE le 01/09.** Traits et curseurs
                              propagés, **aucune erreur des deux côtés** : le 🔴 est fermé, et le
                              contrat de D1 est tenu.
                              ℹ️ **Le cas de l'image collée reste rouge, et il est HORS de D1** — il
                              l'était déjà en v1. Il a fait sortir **deux** défauts antérieurs à la
                              migration, chacun devenu une tâche du lot 5 : le collage ne propage
                              rien (aucun `pointerup`, donc aucune émission — d'où le silence des
                              deux côtés qui a fait croire un moment à autre chose), et une scène
                              portant une image pèse **294 409 octets**, mesurés, soit **4,5×** le
                              plafond. Les deux se tiennent : traiter l'un sans l'autre ne fait rien
                              apparaître chez le pair.
                              ⚠️ **Ce que cette re-vérif apprend sur la méthode** : le premier
                              symptôme (« aucun message d'erreur des deux côtés ») désignait deux
                              défauts empilés, dont un **silencieux par conception** — le second
                              n'était lisible qu'en `console.warn`, jamais en erreur. Le geste qui a
                              tranché n'était pas une relecture mais **un test discriminant demandé
                              à l'utilisateur** : tracer un trait après le collage sépare « rien
                              n'est émis » de « l'émission est refusée ».
            - [x] D2 — **Application** — **fait le 01/09/2026.** Un seul fichier de code, comme D1.
                  Le décompte des appelants v1 vivants passe de **trois à deux**, et les
                  consommateurs de `stores/peers.js` de **cinq à quatre** — vérifié aux deux greps du
                  recompte. `npm run build` vert (exit 0, chunk `ApplicationComponent` reconstruit),
                  suite JS **0 échec**.
                  ⚠️ **Le chiffre de suite n'est PAS une preuve utilisable ce jour-là, et il faut le
                  dire** : un second agent travaillait en parallèle sur le même arbre (le verbe
                  `sendDataOnConnection` et le suivi du Whiteboard). La baseline mesurée avant
                  édition était 85 fichiers / 1503 cas ; après, 87 / 1518 — **tout le delta est le
                  sien**. Ce que D2 peut prouver n'est donc pas « suite inchangée » mais « aucun
                  échec imputable à ce fichier », et c'est vérifiable plutôt que déclaratif : aucun
                  test du paquet n'importe `ApplicationComponent`. Le vrai contrôle reste
                  `npm run build`.
                  **Ce que D2 a corrigé dans la recette de D0 — un mot de trop, et un fait neuf :**
                  · ⚠️ **`onConnectionClose` était donné pour « indemne » du problème de sens. Il ne
                  l'est pas.** Le garde `customCloseEmitted` ne promet qu'une notification **par
                  connexion** — or la paire en a deux. Sans garde, la fermeture de ma sortante retire
                  de l'iframe un pair désigné par **mon propre** slug. Un seul prédicat sert les deux
                  sites, `isIncomingConnection`. **Vrai pour D3.**
                  · 🔴 **Et le fait que ni D0 ni D1 ne pouvaient voir** : sur une entrante,
                  `connectionEnabled` signifie « ce pair m'a joint », **pas** « je peux lui
                  répondre ». `sendData` résout par slug dans une map qui ne contient que mes
                  sortantes, et le mapping `slug → peerId` est écrit par ma **propre**
                  `connectToPeer` : sur le chemin présence, l'entrante de l'autre arrive la première,
                  avec des **secondes** d'avance (`scenarios/incomingMappingInvariant.test.js`). Le
                  ✅ de l'iframe est donc un indicateur d'**affichage** — s'en servir pour décider
                  d'émettre serait un faux vert. Rien n'est cassé aujourd'hui : le protocole
                  documenté ne l'utilise que pour afficher. **C'est le piège qui est écrit, pas un
                  défaut.** ℹ️ Ce fait vient du travail de l'autre agent, pas de D2 — vérifié dans
                  le test avant d'être repris, et non cru sur parole.
                  ✅ **L'écart 4 est fermé et le ciblage survit en entier** : `include` → `destUserSlugs`,
                  complément d'`exclude` depuis `api.remotePeers.value`, les deux filtres cumulés
                  comme le store v1. Deux fidélités qui ne se devinent pas — un tableau **vide** vaut
                  **personne** (`destUserSlugs || remotePeers` voit `[]` comme *truthy*), et la base
                  de calcul passe des connexions **ouvertes** aux membres **présents** (écart assumé,
                  même livraison, un `console.warn` de plus). L'alternative — descendre `exclude` dans
                  `sendData` — est **écartée et argumentée** dans la recette : un lot de migration ne
                  s'élargit pas à l'API du transport.
                  ✅ **La régression de sérialisation est REFERMÉE ici, là où D1 l'avait assumée**, et
                  c'est le seul des trois modules où le choix se posait : le payload ne vient pas du
                  paquet mais d'une **app d'iframe**, écrite hors de tout contrôle. `toTransportable`
                  normalise en données plates avant émission — ce qui part reste un **objet**,
                  conforme au contrat v2. ℹ️ **Et ça ne retire rien à personne** : le récepteur
                  JSON-round-trip **déjà** le message dans `sendMessageToIframe`. Rien de non-JSON n'a
                  jamais pu être lu en face. **C'est la méthode de D1 appliquée une seconde fois** —
                  lire le récepteur avant de choisir quoi émettre — et elle répond une seconde fois.
                  - [x] Code — `ApplicationComponent.vue`, **le seul fichier**. `mapActions` reste
                        importé (`useApplicationAIStore` s'en sert), seul le `mapActions(usePeerStore,
                        …)` part avec son import. Le `<div>` du provider est placé en **fin** de
                        wrapper, après le `div.error` : la v1 ne rendait aucun nœud, la v2 en rend un,
                        et le voisin est un iframe en `height: 100%`
                  - [x] Doc — **quatre couches.** `work/webrtc-data-v1-v2.md` (§D2 rempli, l'en-tête
                        qui dit le troisième point où la recette s'est trompée, §B le double sens
                        étendu à `onConnectionClose` et l'avertissement neuf sur la sortante absente,
                        §C écarts 2 et 4) · cet item · le `work/README.md` du paquet et celui de
                        l'hôte · **`docs/modules/webrtc2/INDEX.md`** (les décomptes) et
                        **`docs/modules/webrtc2/api.md`** (les faits durables) — ces deux-là **en
                        dernier et en coordination** : l'autre agent édite le même encadré
                        `onConnectionOpen` d'`api.md`, il passe en premier.
                        **Aucun `boost:update` requis**, à re-vérifier avant de cocher :
                        `Application`, `DataUserPeerConnection`, `sendData` et `exclude` rendent
                        **zéro** sur `core.blade.php` et sur le `CLAUDE.md` du paquet — le seul hit
                        sur `Application` étant `ConfigApplicationProvider`, **lu et non compté** (la
                        leçon du `quatre` de D1). **Huitième tâche d'affilée** dans cette
                        configuration
                  - [x] Tests — **aucun**, et c'est le contrat du lot D : composant métier hors du
                        filet, aucun test ne l'importe. `npm run build` est le seul contrôle
                        automatique
                  - [x] **Vérif manuelle à deux navigateurs — PASSÉE le 26/10/2026** (David),
                        console propre des deux côtés. ℹ️ **Elle exige une app qui émet** : l'app de
                        la room était le squelette « Bonjour », il a fallu y coller l'exemple du
                        paquet `Application/Exemples/WebrtcDataConnection.txt` (onglet Code,
                        Template + Script). Dans cette app, la case n'est **pas** un indicateur : elle
                        choisit les destinataires, seul le ✅ dit « connecté ». Le
                        scénario est écrit pour être discriminant, pas pour être coché : ✅ en face de
                        l'**autre** et jamais de soi (le garde de sens sur `open`) · « Envoyer à
                        tous » reçu par l'autre seul · « uniquement à » l'autre reçu, « uniquement à »
                        **personne** ⇒ personne · « sauf à » l'autre ⇒ personne, « sauf à » personne
                        ⇒ l'autre reçoit (le complément ne dégénère pas) · fermer un onglet ⇒ le ✅
                        disparaît **une seule fois** (le garde de sens sur `close`). Console des deux
                        côtés : aucun `Type "function Map()…"`, aucune erreur de `JSON.parse`.
                        ⚠️ **Ne pas cocher sur la foi du vert** — D1 a livré suite verte, build vert
                        et trois relectures sur une fonctionnalité qui ne marchait pas
            - [x] D3 — **ClassRoom** — **fait le 01/09/2026.** Un seul fichier de code, comme D1 et
                  D2. Le décompte des appelants v1 vivants passe de **deux à un** (`AudioRoom`, plus
                  un fichier désactivé), et les consommateurs de `stores/peers.js` de **quatre à
                  trois** — vérifié aux deux greps du recompte. `npm run build` vert (exit 0, chunk
                  `ClassRoomComponent` reconstruit), suite JS **87 fichiers / 1518 cas, 0 échec**,
                  identique à la baseline post-D2 — cohérent avec le fait qu'aucun test n'importe ce
                  composant, **vérifié** : le seul fichier de la suite qui le nomme est un
                  *commentaire* de `directives/__tests__/resizableNaming.test.js`.
                  **✅ Le plus petit des trois, et ça se mesure : sa v1 ne portait AUCUN effet de bord
                  de connexion.** Trois `console.log`, non reportés. Donc `onDataReceived` seule clé
                  du jeu, et **aucun garde `isIncomingConnection` à écrire** — le piège qui a coûté un
                  correctif à D1 et un à D2 ne le concernait pas. C'est le seul des trois dans ce cas.
                  **Ce que D3 a corrigé dans la recette — une quatrième erreur, et une espèce
                  nouvelle :**
                  · ⚠️ **Un fait EXACT mais SANS OBJET.** La recette instruisait « lit
                  `conn.connectionId` (journalisation) : inchangé en v2 ». Vérifiable, vrai — et
                  portant sur une ligne que le lot allait **supprimer**. Après le *décompte*, la
                  *mesure à 0*, la *bonne nouvelle* et la *caractérisation fausse*, voici l'annotation
                  qui n'est pas fausse du tout : elle est **hors sujet**, et elle coûte quand même,
                  parce qu'on l'instruit avant de découvrir qu'elle ne survit pas.
                  · ✅ **Le piège de grep de D2 ne s'est PAS reproduit** : un seul `JSON.parse` dans
                  tout `ClassRoom/`, et c'était le bon. Mais ça se vérifie et ne se suppose pas — un
                  lot qui aurait fait confiance au décompte aurait eu raison ici et tort à D2.
                  · ✅ **`mapActions` part en entier**, à l'inverse de D2 où il devait rester importé :
                  ici son unique site était le `mapActions(usePeerStore, …)` lui-même.
                  🔴 **Et la trouvaille qui ne vient pas du code du lot** : `docs/modules/autres-modules.md`
                  affirmait que ClassRoom est « le cas d'usage type de la topologie **star** ». C'est
                  faux, et ça l'a toujours été — la v1 qu'il utilisait (`DataUserPeerConnection` →
                  `usePeers`) n'a **aucune notion de topologie**. Une ligne qui aurait poussé celui
                  qui fait cette migration à passer `:options="{ topology: 'star' }"`, ce que la
                  recette signale comme **effaçant le défaut EN BLOC**. Corrigée.
                  ⚠️ **Et le grep qui l'instruit a un piège qui vaut d'être écrit** :
                  `grep -rn "star" src/config/` rend trois hits, **tous faux** — ils sont dans
                  `Dauvray\E`**`star`**`ter`. Le nom du paquet socle contient le mot cherché. Une
                  vérification à un seul grep aurait conclu « c'est configuré quelque part » et
                  laissé la ligne en place. Le contrôle qui tranche est `topology`, pas `star` :
                  il rend **zéro** hors `WebRTC2/`, à l'exception des trois commentaires de
                  migration écrits par D1, D2 et D3 eux-mêmes.
                  - [x] Code — `ClassRoomComponent.vue`, **le seul fichier**. Le `<div>` du provider
                        est placé en **fin de `.classroom-wrapper`** : le composant est multi-racine
                        (`.classroom-wrapper` + `<Teleport>`) et la v1 y ajoutait un troisième nœud
                        qui ne rendait **rien** — le mettre à la racine ferait passer le composant de
                        **un** à **deux** nœuds racine *rendus*. Troisième emplacement différent des
                        trois lots. ℹ️ Mesuré au passage : le `<router-view>` de `Server/Room.vue`
                        ne passe que trois props **déclarées**, aucun attribut de fallthrough
                  - [x] Doc — `work/webrtc-data-v1-v2.md` (§D3 rempli, l'en-tête qui dit la quatrième
                        erreur, §B et §C fermés sur leurs renvois à D3) · cet item ·
                        `docs/modules/webrtc2/INDEX.md` (le décompte — **l'ordinal a été retiré**, pas
                        mis à jour : le paragraphe voisin avait déjà appris cette leçon) ·
                        `docs/modules/autres-modules.md` (la ligne star fausse) · le `work/README.md`
                        du paquet et celui de l'hôte.
                        **Aucun `boost:update` requis, et c'est mesuré sur CINQ couches** :
                        `ClassRoom`, `DataUserPeerConnection`, `appelant`, `consommateur` et
                        `peers.js` rendent **zéro** sur `core.blade.php`, le `CLAUDE.md` du paquet,
                        `docs/INDEX.md`, `docs/architecture/package.md` et `docs/modules/chat.md`.
                        **Neuvième tâche d'affilée** dans cette configuration
                  - [x] Tests — **aucun**, et c'est le contrat du lot D : composant métier hors du
                        filet. `npm run build` est le seul contrôle automatique
                  - [x] **Vérif manuelle à deux navigateurs — PASSÉE le 26/10/2026** (David).
                        Scénario discriminant : bascule **whiteboard** propagée à l'autre onglet ·
                        bascule **chat** propagée · **puis la bascule whiteboard off→on**, et le
                        tableau imbriqué doit refonctionner (traits propagés) — c'est le seul geste
                        qui exerce pour de vrai le cycle démonter/remonter d'un contexte data, et
                        **ni D1 ni D2 ne l'ont jamais parcouru**. Console des deux côtés : aucune
                        erreur de `JSON.parse`, aucun `Type "function Map()…"`.
                        ⚠️ **Ne pas cocher sur la foi du vert** — D1 a livré suite verte, build vert
                        et trois relectures sur une fonctionnalité qui ne marchait pas
                        🔴 **Cette vérif était BLOQUÉE par deux défauts antérieurs, trouvés en
                        essayant de la faire, et corrigés le 01/09/2026** : créer une room ClassRoom
                        levait « Undefined array key 0 » (`createClassroomVertice` passait l'id de
                        son vertex `classroom` à `getOrcreateChatVertice`, dont la requête ne matche
                        que `(r:room)`), et le salon né sans sous-contenu était **inouvrable** —
                        `getRoom` rend `subcontent: null` par conception, et les deux computed du
                        front testaient `hasOwnProperty`, **vrai pour une clé valant `null`**.
                        **Dixième enseignement du chantier, et il porte sur le gabarit lui-même :
                        une case « vérif manuelle » peut être infaisable pour une raison qui n'a
                        rien à voir avec le lot.** Les trois volets Code/Doc/Tests ne prévoient pas
                        ça — ici la fonctionnalité à vérifier ne pouvait pas seulement *exister*.
                        Corollaire pour le lot E : **ouvrir la vérif tôt**, pas à la fin, parce
                        qu'elle peut révéler qu'il faut d'abord réparer autre chose.
                        ℹ️ Contre-épreuve de méthode : les deux défauts sont **antérieurs**
                        (`git show e4acd4a:` rend le même code fautif), donc D3 les a *croisés*, pas
                        *causés* — la règle de D1 sur l'image collée, appliquée une troisième fois.
                        Le second défaut du site d'appel PHP (la confidentialité passée en entier au
                        lieu d'un tableau, donc **ignorée**) n'aurait pas été vu en corrigeant le
                        seul crash
      - [x] **E. AudioRoom** `[M]` — **CLOS le 26/10/2026** : quatre commits, et la vérif à deux
            navigateurs passée le même jour (David), cinq étapes sur cinq. **AudioRoom est le premier consommateur de
            production du mode `stream`** — jusqu'ici seul `Exemples/Home.vue` l'employait —, et c'est
            ce qui a décidé du lot : la méthode de D1 (lire le chemin de RÉCEPTION avant de choisir
            quoi émettre) a trouvé **deux défauts du cœur v2** qu'AudioRoom aurait rencontrés le
            premier, et qu'aucun test ne voyait. Ils sont passés en prérequis, chacun son commit,
            sur décision de David.
            - [x] E0a — 🔴 **le TTL du registre des flux distants évinçait un flux VIVANT** — sortie A,
                  `42dfd4b`. `createdAt` date la réception, jamais rafraîchi ; l'arrivée de tout flux
                  de clé nouvelle évinçait tout flux de plus de 5 min. Dans un salon audio : A et B
                  parlent 6 min, C arrive ⇒ A cesse d'entendre B **pour de bon**. Le docblock de
                  `STREAM_STALE_MS` disait « sans activité » : **le nom de l'intention, pas du code**.
                  Le TTL ne vise plus que les entrées sans piste vivante. 3 cas, le ⭐ né rouge ;
                  4 mutations mesurées sur la suite complète, dont `.every` — **trouvée par la
                  relecture**, qui survivait au premier jeu de cas. Doc : « éviction LRU », faux deux
                  fois (c'est un FIFO par insertion), dans `api.md` et `INDEX.md`
            - [x] E0b — 🔴 **le teardown du provider n'arrêtait AUCUN flux local** — sortie A,
                  `92ea831`. Seuls
                  `stopCurrentStream` / `stopScreenCapture` arrêtent des pistes, et `cleanupPeerConnection`
                  n'appelait ni l'un ni l'autre ; le commentaire du provider annonçait pourtant « arrêt
                  des flux, etc. » — **l'« etc. » cachait le trou**. Quitter une page en diffusion
                  laissait micro, caméra ou écran capturés, sur un contexte que plus rien n'atteint. La
                  v1 d'AudioRoom, elle, coupait le micro au démontage : sans E0b, migrer était une
                  régression de vie privée. 3 cas nés rouges, plus un cas d'isolation entre contextes
                  (né vert, contrôlé par un harnais à flux partagé) ; 4 mutations mesurées.
                  🔴 **La première version de ce correctif était fausse, et c'est la relecture qui l'a
                  vu** : elle arrêtait l'écran par le verbe de `media`, en écrivant « les connexions
                  viennent d'être fermées juste au-dessus ». Faux pour l'écran — la fermeture du
                  dessus ne vise que le type de session, et la MediaConnection `screen` restait
                  ouverte, rangée dans le store d'un contexte mort. Le verbe de l'orchestrateur la
                  ferme ; c'est un mot. **La phrase fausse était une justification, pas une
                  description** : elle disait pourquoi le code pouvait se dispenser de quelque chose.
                  C'est l'espèce que ce lot a documentée, produite par l'auteur du lot lui-même.
                  ⚠️ **Retirer une ligne PAR NUMÉRO, pas par motif** : `media.stopScreenCapture()`
                  existe deux fois à la même indentation, et la mutation par motif a rougi 4 cas dont 3
                  hors sujet — écrit dans le docblock du test
            - [x] E1 — `AudioComponent` sur le provider v2, **un seul fichier de code** — `0d3393f`.
                  Le delta media
                  v1→v2 — que D0 renvoyait ici — tient en six lignes, et aucune n'est une substitution :
                  · **mode `stream`**, pas `vocal` : `visio`/`vocal` sont les appels directs sous FSM ;
                  · **le rendu des flux distants passe à l'appelant** — la v1 les injectait dans le
                  `#videoContainer` de `Notifications` (`streamPlayerCallback`), le mode `stream` v2 ne
                  crée **aucun** player. Sans ce rendu, la migration « marchait » sans un son.
                  `MediaBroadcastPlayer` en `:videoActive="false"` : `RemoteMediaPlayer` rendrait un
                  `<video>` noir, son `videoActive` valant `true` tant que le pair n'annonce rien ;
                  · **les noms viennent de la présence**, par `remoteSlug` — en `stream`, le flux de
                  réponse d'un pair arrive sur MA sortante, dont la metadata porte MON nom ;
                  · démarrage `getAudioStream()` en `mounted()` **avec `.catch`** (la v1 n'en avait pas :
                  un refus de micro était un rejet non traité) ; arrêt par E0b, rien côté appelant ;
                  · slot v1 à 20 clés à plat → une clé `api` portant des `ref` ; `started-stream` /
                  `stoped-stream` sans équivalent v2, et **personne ne les écoutait** ;
                  · **pas de player local** — `LocalMediaPlayer` lit `api.isMuted`, que
                  `startAudioStream` pose à `true` sur un micro ouvert (item ouvert dans
                  [webrtc2-todo.md](webrtc2-todo.md)) : il afficherait « muet » à quelqu'un qu'on entend.
                  Appelants v1 vivants : **un → zéro au premier grep** ; au second reste
                  `Server/Server.vue:105`, import mort du store v1 — c'est F1. Build vert.
                  ❓ **Décision produit laissée ouverte** (relevée en relecture) : **pas de bouton
                  Mute** — parité v1 stricte, mais le seul moyen de couper son micro est de quitter le
                  salon. Ajouter le bouton demande d'abord l'item `startAudioStream` de
                  [webrtc2-todo.md](webrtc2-todo.md), sans quoi son premier clic serait sans effet.
                  ℹ️ `this.$refs.audioBroadcast?.api.getAudioStream()` s'éteindrait **en silence** si le
                  provider n'était pas monté ; inatteignable aujourd'hui (`Room.vue` ne rend la route
                  que sous `v-if="currentRoom"`, et `users` vaut `[]` dès le départ).
            - [x] E2 — **`SpectrumAnalyzer` SUPPRIMÉ — décision du 26/10/2026 (David), sortie B**,
                  `cd8aae1`. Il
                  mixait tous les flux en un spectre (il ne dit pas *qui* parle), et la lecture lui a
                  trouvé trois défauts : sources initiales hors de `sourceMap`, boucle
                  `requestAnimationFrame` jamais annulée (elle tourne à vie après le démontage), et
                  mixer branché sur `audioContext.destination` — **il rejouait l'audio distant une
                  seconde fois** par-dessus les players de la v1. Partent avec lui son seul importeur,
                  `WebRTC/widgets/ui/AudioDefaultUserButtonUI.vue` (orphelin depuis E1), et dans
                  `StreamSimpleUI` le `defineAsyncComponent` mort et les deux usages commentés — faux,
                  ils passaient `{streamData}` à une prop `streams: Array`. Un indicateur « qui parle »,
                  s'il revient, se fera **par participant**
            - [x] **Vérif manuelle à deux navigateurs — PASSÉE le 26/10/2026** (David), **cinq
                  étapes sur cinq**. Son retour, tel quel : « vérification faite : 1 à 5 : ok » — c'est
                  le grain de la preuve : aucun détail par étape, ni console, ni réseau. L'étape 5
                  demandait un troisième participant ; comment il a été obtenu n'est pas rapporté.
                  L'étape 5 est le premier exercice d'E0a en transport réel : un flux de plus de
                  5 min a survécu à l'arrivée d'un troisième membre. **Délai de l'étape 2 : immédiat**
                  (rapporté par David le 26/10, en complément) — en départ PROPRE, A apprend le
                  départ de B par le TRANSPORT — fin de pistes ou fermeture PeerJS, rien n'a été
                  instrumenté chez A pour dire laquelle ; la présence ne touche pas au registre. Un
                  chemin immédiat existe d'après la source : peerjs 1.5.4 ouvre un canal de données
                  interne pour toute MediaConnection, et `dataChannel.onclose = () => this.close()`
                  (`dist/bundler.mjs`, l.1032) — le `close()` de B se propage sans attendre l'ICE.
                  Ce que ça ne mesure pas : le départ BRUTAL — item « Non mesuré » de
                  [webrtc2-todo.md](webrtc2-todo.md).
                  Le protocole suivi : rechargement dur des deux côtés,
                  aucune écriture dans `.env` pendant la mesure (`.ai/rules/web-r-t-c2.md`). Créer un
                  contenu « Audio » dans un salon dont A et B sont membres.
                  1. A puis B entrent : invite micro des deux côtés ; chacun voit un player au **nom de
                     l'autre** (jamais le sien) et **l'entend**. Console : aucune erreur.
                  2. B quitte le salon : **le voyant micro du navigateur de B s'éteint** (E0b) ; chez A,
                     le player de B disparaît — **noter le DÉLAI observé**. A ne l'apprend que par la
                     fermeture côté PeerJS (fin de pistes ou ICE), jamais par la présence : le
                     `leaving` n'oublie que des références du store. Délai réel jamais mesuré.
                  3. B revient : ils s'entendent à nouveau — cycle démonter/remonter du contexte.
                  4. Refuser le micro (paramètres du site) puis entrer : un toast `NotAllowedError`.
                  5. *Long, mais seul exercice réel d'E0a* : A et B restent plus de 5 min, puis C
                     entre — A entend toujours B.
                  ⚠️ **Ne pas cocher sur la foi du vert** — la leçon de D1 vaut double ici : c'est le
                  premier usage réel du mode `stream`, et le transport n'est exercé par aucun test
      - [x] **F. La suppression** `[M]` — **fait le 26/10/2026**, un commit, `8f85d00`
            - [x] F1 — `Server/Server.vue` : **retirer** l'import du store v1 et la ligne 147.
                  Relevé le 26/10/2026 : les deux getters y sont **destructurés et jamais lus** — ni dans
                  le script ni dans le template. Ce n'est donc pas une migration vers `peers2` : il n'y a
                  rien à exposer.
                  **Trois lignes, pas deux** : l'instance `const peerStore = usePeerStore()` n'était lue
                  que par la destructuration — la laisser gardait un appel à un store supprimé.
            - [x] F2 — supprimer `components/WebRTC/`, `stores/peers.js` et `stores/peers/`.
                  Preuve : les **deux** greps rendent zéro · suite JS verte · **`npm run build`**,
                  seul contrôle qui voie un import cassé dans un fichier qu'aucun test n'importe.
                  🔴 **Le périmètre écrit ne pouvait pas tenir sa propre preuve** :
                  `AudioRoom/__AudioComponent copy.vue` importait `WebRTC/composables/usePeers.js`, donc
                  le grep n°1 rendait encore une ligne une fois le périmètre supprimé. Le fichier était
                  recensé (table plus haut, et « Vider les poches mortes ») mais **aucun lot ne le
                  supprimait**. Supprimé ici : aucun importeur, aucun glob de production ne l'atteint, et il importait
                  déjà un `./widgets/SpectrumAnalyzer.vue` absent de l'arbre. Mesuré : les deux greps
                  rendent zéro ; suite JS **87 fichiers / 1525 cas, identique avant et après** ;
                  `npm run build` vert — **pas inchangé** : le chunk `Server` passe de 30 217 à
                  19 185 octets (il embarquait le store v1, faute de chunk v1 à part) et les 8 chunks de
                  `callbacks/` disparaissent. La preuve que la v1 a quitté le bundle est un **témoin** :
                  `remoteOpenedConnections`, `isStreamingWebcam`… — chaînes propres au store v1 —
                  présentes avant, absentes de tout le build après. Le docblock de
                  `noInlinedTurnSecret.test.js` cite `stores/peers/actions.js` comme cas historique :
                  daté supprimé, la leçon reste.
                  ℹ️ **Ce que la suppression laisse orphelin hors du périmètre** : `callbacks/`
                  **entier** (8 fichiers). **Les 8 ont perdu leur importeur avec F** — le store v1 les
                  atteignait tous par deux `import()` à gabarit (`actions.js:327` et `:404`,
                  `` `~socializer/callbacks/${…}.js` ``, dont Vite fait un glob), et
                  `vocalPlayerCallback` en plus par `__AudioComponent copy.vue`. Non supprimé ici,
                  consigné dans « Vider les poches mortes ». Le reste (directives, `RoomUsersList`,
                  helpers, stores, `peerjs`) garde des importeurs vivants.
                  🔴 **La première version de ce paragraphe était fausse, et c'est la relecture qui l'a
                  vu** : « cinq n'en avaient déjà aucun avant F ». Elle venait d'une liste des imports
                  sortants extraite par un motif **entre guillemets** — aveugle aux backticks, donc aux
                  deux imports à gabarit : la leçon `defineAsyncComponent` du cadrage, refaite. Ce qui
                  les a vus est le **diff de la liste des chunks** entre le build d'avant et celui
                  d'après (19 fichiers disparus, tous de `callbacks/`, aucun apparu)
      - [x] **G. La doc, en dernier** `[M]` — les 7 fichiers listés plus haut **+ un huitième,
            `docs/architecture/conventions.md` (cf. « Ce que F transmet à G » ci-dessous)**, dans l'ordre imposé
            par [le `work/` du projet hôte](../../../../work/README.md), puis `boost:update`, puis
            `grep 'laravel-socializer/core rules ===' CLAUDE.md`. **Une** correction à y porter au
            passage : la doc annonce **un** homonyme alors qu'il y en a deux —
            `composables/useMediaBroadcast.js` (v1) / `Composables/useMediaBroadcast.js` (v2), qui ne
            diffèrent que par la casse du dossier. *(La seconde — la commande de recompte à deux
            greps — a été faite au lot C, dans le paragraphe qu'il réécrivait de toute façon.)*
            **Ce que F transmet à G (26/10/2026)** :
            · depuis F, l'annotation n'est plus seulement à retirer, elle est **fausse** — les trois
              paragraphes v1 de `docs/modules/webrtc2/INDEX.md` (« toujours dans l'arbre »,
              `Server.vue` qui importe le store, la commande de recompte), les deux puces v1 / `__`
              des « Zones mortes connues » de `docs/architecture/package.md`, et « les deux
              coexistent » dans `CLAUDE.md`, `resources/boost/guidelines/core.blade.php` et
              `docs/modules/autres-modules.md`. Le plus coûteux est `core.blade.php` : il part dans le
              `CLAUDE.md` de chaque hôte au `boost:update`. G ne doit pas traîner, et
              ⚠️ **aucun tag entre F et G** — la guideline livrée affirmerait dans chaque hôte une v1
              qui n'existe plus ;
            · **un huitième fichier, HORS de la liste des sept** : `docs/architecture/conventions.md`
              donne `__StreamUserButton.vue` pour exemple de la convention `__`. F supprime l'exemple,
              et il ne reste **aucun** fichier `__` dans le paquet : retirer l'exemple, ou trancher si
              la convention survit sans fichier ;
            · si G garde une commande de recompte, l'élargir (relevé par la relecture de F) : dans
              `INDEX.md`, le grep n°1 ne couvre que `components/`, le n°2 couvre `socializer/` mais ne
              cherche que `stores/peers.js`, et aucun ne couvre `socializer_custom_elements/` ;
            · la correction « un homonyme → deux » ci-dessus est devenue **sans objet** : le
              `composables/useMediaBroadcast.js` v1 est supprimé, il ne reste **aucun** homonyme. G
              retire l'avertissement au lieu de le corriger ;
            · `webrtc-data-v1-v2.md` a rempli sa condition de suppression
              (« part avec `components/WebRTC/` »). Avant de le supprimer, reloger ce qui pointe vers
              lui — dont `WhiteboardComponent.vue`, dont un commentaire y renvoie pour la borne de
              64 Ko **assumée** : une décision a besoin d'un foyer qui survive à la recette ; puis
              `whiteboard-todo.md` (section à date de fin), `work/README.md` et ce fichier.
            **✅ Fait le 26/10/2026, `76c6909`** — sortie B partout : la v1 n'existe plus, rien ne reste
            à sa place. Dans l'ordre de la doctrine : `docs/` (webrtc2/`INDEX.md`, `autres-modules.md`,
            `package.md`, `conventions.md`, `INDEX.md`, `chat.md`, `signalisation.md`, plus `api.md`
            en remontée), `CLAUDE.md` (trois pièges au lieu de quatre — aucun renvoi numéroté ne visait
            leur numéro), `core.blade.php`, puis `boost:update`, puis le contrôle :
            `grep 'laravel-socializer/core rules ==='` présent, 11 sections avant et après, le diff du
            `CLAUDE.md` hôte se réduit aux **trois** lignes v1, et `.ai/` est identique à l'octet.
            Point par point de la passation :
            · `conventions.md` : la ligne `__` est **retirée**, la convention ne survit pas — zéro
              fichier, et ce chantier **supprime** le code mort au lieu de le mettre de côté (git garde
              l'historique) ;
            · la commande de recompte n'est **pas gardée** : il n'y a plus rien à compter, et un import
              **statique** réintroduit vers un chemin supprimé casse `npm run build` — un `import()` à
              gabarit, lui, se développe en vide sans rien dire (la leçon de F) ;
            · l'avertissement d'homonymes est **retiré**, il n'en reste aucun ;
            · la recette est **supprimée** ; le commentaire de `WhiteboardComponent.vue` renvoie à
              `api.md` (§ `api.sendData`), qui possède la borne de 64 Ko et la dit assumée ; le bloc
              ⚓ de `whiteboard-todo.md` est levé — rien d'autre ne pointait sa section ; les liens
              d'ici et de `README.md` sont devenus du texte.
            🔴 **La recette se disait vide de contrat v2 — « tout ce qui concerne la v2 est dans
            `api.md` et n'est pas recopié ici » — et c'était faux.** Vérifié fait par fait avant de la
            supprimer : **quatre** contrats v2 n'existaient qu'en elle — un `options` partiel remplace
            le défaut en bloc (épinglé par `MediaBroadcastProvider.test.js`, jamais écrit dans
            `api.md`), sans `room` le contexte tombe sur le `data-app` permanent de
            `Notifications.vue` sous un registre last-write-wins, le provider rend un `<div>`, et
            `users` se **réaffecte**, jamais ne se mute — le watch suit la référence, épinglé aux deux
            bouts depuis A3 mais écrit nulle part, et le commentaire du provider disait « à chaque
            changement ». **Ce quatrième, c'est la relecture qui l'a trouvé** : l'auteur en avait vu
            trois. Plus un fait à préciser : les états de l'api sont des `ref`, `.value` y compris en
            template. Tous remontés dans `api.md`. **C'est la « bonne nouvelle » de D0, au moment de la
            suppression** : la phrase par laquelle un fichier se déclare sans substance est celle
            qui autorise à le supprimer sans le relire.
            ⚠️ **Un neuvième fichier, hors de toutes les listes** : `docs/architecture/signalisation.md`
            justifiait le `nullable` de `connectionType` par « la v1 morte mais encore appelée ne
            l'envoie pas » — faux depuis F. Même justification dans le commentaire de
            `UserController.php` et le docblock de `ValidationTest.php`. Les trois sont réécrits ; **la
            règle reste `nullable`** : tous les émetteurs vivants envoient le champ, mais le client
            garde son repli `connectionType || type`, un onglet sur un bundle antérieur doit passer,
            et sur ce chemin la doc pose que la sévérité est le risque.
            ⚠️ **La relecture a trouvé deux commentaires au PRÉSENT que l'inventaire de l'auteur ne
            pouvait pas voir** — `routes.private.php` (« ses seuls appelants sont usePeerCore et le
            module v1 mort ») et le corps de `connection_type_absent_reste_accepte`, quatrième site de
            la justification `nullable`. L'inventaire grepait `docs/`, les `CLAUDE.md` et la guideline ;
            la relecture, **tous les fichiers suivis**. Une annotation ne vit pas que dans la doc : un
            commentaire de code en est une, et l'inventaire d'un lot doc se fait sur `git ls-files`.
            Laissés exprès : `securite.md` (la v1 y est l'histoire, au passé, d'un secret présent deux
            fois dans le bundle — la leçon tient). `callbacks/` n'est pas supprimé (poches mortes),
            mais nommé dans les « Zones mortes connues » de `package.md` : l'arborescence le
            présentait comme vivant (relevé par la relecture). Mesuré : suite JS 87 fichiers / 1525 cas ; `npm run build` vert ; suite PHP 286 tests / 678
            assertions (un docblock de test et un commentaire de contrôleur touchés, Pint non lancé)

      **Les trois volets du gabarit, répartis** : *code* = B → F · *tests* = A et B, plus les
      vérifications manuelles nommées de D et E (aucun des appelants restants n'a de test, et aucun
      n'en recevra : ce sont des composants métier hors du filet — la vérification à deux navigateurs
      les remplace, et elle est nommée lot par lot) · *doc* = G, **plus les décomptes que chaque lot
      périme au passage** — le lot C l'a montré, et le gabarit ne l'annonçait pas.
      **Chemin critique** : A → B → C sont livrables tout de suite et indépendants du reste ; F ne
      part pas avant que D et E soient prouvés à la main.
      **État au 01/09/2026** : **le lot A est CLOS** (A1, A2, A3), **B1, B2 et C sont faits**, et
      **le lot D est fait EN ENTIER** — D0, D1, D2, D3. La table de traduction existe
      (`webrtc-data-v1-v2.md`, le contrat v2 dans
      `docs/modules/webrtc2/api.md`), **les trois appelants du canal data sont migrés**, et les
      appelants v1 vivants passent de **quatre à un** — `AudioRoom`, qui est un provider **media**
      et relève du lot E. D1 est **clos** (sa vérif à deux navigateurs a passé, après avoir trouvé un
      🔴 réel) ; **les vérifs de D2 et de D3 ont passé le 26/10 : le lot D est prouvé à la main en
      entier**.
      ⚠️ **Le chiffre de suite de D1 écrit ici — « 85 fichiers / 1501 cas » — était un décompte
      périmé à l'intérieur de son propre lot** : le correctif de D1 a ajouté deux cas après que la
      phrase a été écrite, donc D1 s'est clos à **1503**. Neuvième espèce d'annotation fausse du
      chantier, et la plus retorse : un décompte qui vieillit **entre deux étapes d'une même tâche**.
      **La suite est le lot E** (AudioRoom), qui migre un provider **media** et dont le delta n'est
      pas écrit : il l'écrira avec le code sous les yeux. F ne part pas avant que D et E soient
      prouvés **à la main** — D et E le sont depuis le 26/10. B5 reste ouvert en
      parallèle, sans dépendance : il ferme un 🟠 qui mord aujourd'hui, mais demande de trancher une
      question produit avant d'écrire la `key` *(fermé le 26/10, sans `key` : occupé ⇒ refus)*.
      **État au 26/10/2026** : **le code du lot E est fait** — E0a, E0b, E1, E2, quatre commits —
      et **aucun composant n'importe plus `components/WebRTC/`** ; seul `Server.vue` importe encore
      le store v1, sans le lire (F1). **Vérif à deux navigateurs passée le même jour : le lot E est
      CLOS, et F peut partir.** F1 rétrécit : `Server.vue` ne lit pas les getters qu'il importe,
      c'est une suppression de deux lignes *(trois, mesuré par F)*.
      **Puis F le même jour : la v1 n'est plus dans l'arbre** — les deux greps rendent zéro, suite
      inchangée, build vert (le chunk `Server` perd le store v1, 30 → 19 Ko, et les 8 chunks
      `callbacks/` disparaissent). **Reste G**, et il presse : la doc qui annonçait la v1 « toujours
      là » est fausse depuis ce commit.
      ⚠️ **Ce que F ajoute à la doctrine : une recette de suppression se vérifie par sa PREUVE, pas
      par sa liste.** Le périmètre de F2 était écrit, sa preuve aussi (« les deux greps rendent
      zéro ») — et les deux ne concordaient pas : un fichier recensé dans la table, qu'aucun lot ne
      supprimait, gardait le grep n°1 non vide. Exécuter la preuve **avant** de croire la liste l'a
      montré en une commande. Corollaire, et c'est la relecture qui l'a établi : une suppression ne
      se borne pas à ce qu'elle supprime. **Une extraction des chemins importés entre guillemets ne
      voit pas un `import()` à gabarit ; un grep des backticks le trouve (`` import\(\s*\` ``, une
      seconde), mais seul le build dit ce qu'il atteint** — Vite développe le gabarit en glob. D'où
      le **diff de la liste des chunks** entre le build d'avant et celui d'après : il a trouvé
      `callbacks/` orphelin en entier là où l'extraction de l'auteur n'en voyait que trois sur huit.
      **Puis G le même jour : la doc ne parle plus de la v1 — la tâche est CLOSE.** Neuf fichiers de
      doc et la guideline livrée, la recette supprimée après en avoir remonté quatre contrats v2 qu'elle
      seule portait — détail et leçon dans l'item G.
      ⚠️ **Ce que E ajoute à la doctrine : la migration est le premier USAGE RÉEL d'un chemin
      que seul un exemple exerçait.** AudioRoom est le premier consommateur de production du mode
      `stream` ; ses deux 🔴 (E0a, E0b) ne sont pas des défauts de la migration mais du **cœur v2**,
      invisibles tant que `Exemples/Home.vue` était seul à le monter — un exemple ne dure pas
      5 minutes et ne quitte pas sa page. Les deux étaient pourtant **écrits** : « sans activité »
      dans un docblock, « arrêt des flux, etc. » dans un commentaire. **Une phrase d'intention
      posée sur un code qui ne la tient pas est une annotation fausse dès sa naissance** — voisine
      de la *caractérisation fausse* de D3, mais sur le code d'à côté et non sur un module — et la seule que la relecture du
      code d'à côté démasque, parce qu'elle ressemble à de la doc et non à une promesse. Le test
      qui la repère : **« quelle ligne fait ce que cette phrase dit ? »** — pour « etc. », aucune.
      ℹ️ **La relecture par une seconde session a payé dès le premier commit** : le mutant `.every`
      survivait au jeu de cas d'E0a, et l'auteur ne l'avait pas essayé. Un contrôle de harnais
      mesure les mutations qu'on pense à faire ; la relecture en fait d'autres.
      ⚠️ **Ce que D3 ajoute à la doctrine, et c'est une espèce d'annotation qu'aucun lot n'avait
      rencontrée : le fait EXACT mais SANS OBJET.** La recette instruisait « ClassRoom lit
      `conn.connectionId` (journalisation) : inchangé en v2 ». Vérifiable, vrai — et portant sur une
      ligne que le lot allait **supprimer**. Après le *décompte* (lot C), la *mesure de contrôle à 0*
      (A3), la *bonne nouvelle* (D0) et la *caractérisation fausse* (la ligne « topologie star » de
      `autres-modules.md`, trouvée ici), voici l'annotation qui n'est fausse en rien : elle est
      **hors sujet**, et elle coûte quand même — on l'instruit avant de découvrir qu'elle ne survit
      pas à la migration qu'elle décrit. **Le test qui la repère : « cette phrase parle-t-elle d'un
      code qui existera encore après le lot ? »**
      ⚠️ **Et la trouvaille la plus utile de D3 ne vient pas de son code.** `docs/modules/autres-modules.md`
      donnait ClassRoom pour « le cas d'usage type de la topologie **star** ». Faux depuis toujours :
      la v1 qu'il utilisait n'a **aucune notion de topologie**. Le coût potentiel était réel et daté —
      cette ligne poussait celui qui fait *cette* migration à écrire `:options="{ topology: 'star' }"`,
      or passer un objet `options` **efface le défaut EN BLOC** et fait disparaître `topology`. Une
      caractérisation fausse est plus dangereuse qu'un décompte faux : **elle ne se périme pas, elle
      n'a jamais été vraie**, donc aucune relecture de décomptes ne la rattrape.
      ⚠️ **Ce que D2 ajoute à la méthode du chantier, et qui n'était pas dans le gabarit : deux
      agents sur un seul arbre de travail.** Le paquet est développé en place dans `vendor/`, donc
      une branche par lot n'isole **rien** — les fichiers sur le disque restent partagés, et un
      `git checkout` écraserait le travail non committé de l'autre. Un `git worktree` isolerait
      vraiment mais serait **intestable** : l'hôte résout `~socializer` sur `vendor/`, donc ni la
      suite ni `npm run build` ne verraient le code du worktree — le remède est pire. Ce qui protège
      réellement : **jeux de fichiers disjoints, commit par chemins explicites, jamais `git commit -a`**.
      Corollaire sur les mesures : un décompte de suite mesuré à deux n'est **pas** une preuve de
      non-régression. Ce qui reste prouvable est « aucun échec imputable à ce fichier », et il faut
      pouvoir le justifier autrement que par un chiffre.
      ⚠️ **Ce que A2, A3, D0 et D1 ajoutent au gabarit** : une tâche **sans volet code** peut avoir le
      volet doc le plus lourd du lot. A2 n'a touché aucun fichier de code et a réécrit quatre
      endroits ; A3 n'a écrit que du test et a **périmé deux mesures** — dont une dans `docs/` ;
      **D0 n'a écrit que de la prose et a retourné deux affirmations fausses**, une dans ce fichier et
      une dans `docs/`. Le lot C avait montré qu'un décompte est une annotation ; A3 y a ajouté la
      **mesure de contrôle à 0** ; D0 y ajoute la **« bonne nouvelle »** — une phrase qui dit qu'il
      n'y a rien à faire est la plus coûteuse des annotations fausses, parce qu'elle est écrite pour
      être crue sans être revérifiée. Les chercher dès qu'un lot lit du code.
      ⚠️ **Et ce que D1 ajoute, en propre : une recette écrite par LECTURE n'est vérifiée que par le
      premier lot qui l'exécute.** D0 avait lu tout le code du canal data et écrit une table juste
      sur presque tout ; il a fallu *écrire* D1 pour découvrir ses deux trous — un fait qu'elle
      énonçait sans en tirer la conséquence (`onConnectionOpen` dans les deux sens : « préserver
      l'effet de bord » n'est pas une substitution), et un fait qu'elle n'avait pas cherché parce
      qu'elle comparait deux **contrats** et non deux **implémentations** (le plafond de 64 Ko, que la
      v1 n'avait pas). Corollaire pour D2, D3 et E : **la recette n'est pas une autorité, c'est un
      point de départ** — chaque lot la corrige, et sa correction est un livrable du lot.

- [x] **Supprimer `WebRTC2/EventBus/webrtc2Events.js`** · effort [S] — **fermé le 31/08/2026,
  sortie B.**

  La question « le brancher (A) ou le supprimer (B) » avait été réglée par le fait, pas par un
  arbitrage de goût : **la seule fonction du module qui valait quelque chose, `normalizeType`, avait
  déjà été récupérée** dans `Composables/utils/validators.js` sous le nom `normalizeDirectCallType` —
  le prédicat « les deux types d'un appel direct » qui manquait au paquet, et dont l'absence
  fabriquait un cul-de-sac (`isValidCallType` acceptant `screen`). Le reste du module normalisait un
  payload à six champs que personne n'émet, les tests des boutons d'appel épinglant la **forme
  brute** des deux côtés : le brancher aurait demandé de changer quatre émetteurs pour gagner zéro
  fait.
      Annotation : `docs/modules/webrtc2/api.md` — **remplacée**, pas supprimée : le bloc ⚠️ portait
      aussi deux faits qui ne sont pas des rustines (les appelants émettent en forme brute ; le type
      est normalisé par `normalizeDirectCallType`), et le second n'était documenté nulle part dans
      `docs/`. La ligne qui remplace l'avertissement est un contrat — et elle a corrigé au passage un
      énoncé faux : la normalisation a lieu **aux deux bouts**, pas seulement à la réception.
      - [x] Code — `EventBus/` disparaît (186 lignes) ; deux commentaires de `validators.js`
            requalifiés — le module y reste nommé **comme supprimé**, pour que l'argument « le type
            `'audio'` était mort » reste vérifiable dans `git log` au lieu d'égarer
      - [x] Doc — `api.md` (remplacée) et `INDEX.md` (ligne d'arborescence retirée). **Aucun
            `boost:update` requis**, vérifié : ni le `CLAUDE.md` du paquet ni `core.blade.php` ne
            citaient `EventBus` — même configuration que la tâche `sfu`
      - [x] Tests — aucun test à écrire : rien à épingler dans la suppression d'un module que
            personne n'importe, et un test neuf ici serait vert par vacuité. Contrôle : suite JS
            **82 fichiers / 1468 tests, inchangée** avant et après

- [ ] **Vider les cinq poches mortes restantes** · effort [M]
      `docs/architecture/package.md` liste une section « Zones mortes connues » dont
      l'objet est « à savoir pour ne pas y chercher quelque chose ». Une section entière de doc pour
      compenser du code qu'il suffit de supprimer. **Vérifié**, restent vraies :

      | Zone | État |
      |---|---|
      | `src/routes/socializer/admin.php` | groupe de route vide, 6 lignes commentées |
      | `src/routes/socializer/console.php` | 16 lignes de docblock, zéro commande |
      | `src/config/socializer.php` | `table_names` vide |
      | `SocializerUpgrade` | 27 lignes non commentées sur 67 — commande enregistrée, inerte |
      | ~~`__StreamUserButton.vue`, `__CaptureUserButton.vue`, `__AudioComponent copy.vue`~~ | ✅ **supprimés le 26/10/2026 (lot F2)** — les deux premiers avec `components/WebRTC/`, le troisième parce qu'il importait la v1. Plus aucun fichier `__` dans le paquet hors `__tests__` / `__mocks__` |
      | `src/resources/js/socializer/callbacks/` (8 fichiers) | **ajouté le 26/10/2026 (lot F)** — aucun importeur depuis F, qui a supprimé les deux `import()` à gabarit du store v1 qui les atteignaient tous. Depuis F, le seul import à gabarit du paquet (`socializer_custom_elements/routes/application.js`) vise `rooms/components/` ; le build n'émet plus aucun chunk `callbacks/` — c'est la preuve à rejouer avant de supprimer. nommé dans les « Zones mortes connues » de `docs/architecture/package.md` depuis le lot G (relevé par sa relecture : l'arborescence l'y présentait comme vivant) |
      - [ ] Code — supprimer ou implémenter, poche par poche
      - [ ] Doc — la section « Zones mortes connues » disparaît à mesure ; la supprimer quand elle
            est vide
      - [ ] Tests — `artisan route:list` et `artisan list` inchangés ; suite JS verte

- [x] **Retirer `sfu` de `options.topology`** · effort [S] — **fermé le 30/08/2026, sortie A.**
      La valeur est refusée à la construction (`createPeerContext` lève), et `sfu` reste nommé dans
      la doc et le code comme **réservé, non implémenté** plutôt qu'effacé : le supprimer aurait
      retiré au lecteur du code le seul signal que la question avait été instruite, alors que la
      sortie D du 29/08 tient justement la porte ouverte pour une v2.
      Annotation : `docs/modules/webrtc2/api.md` — **remplacée**, pas supprimée (sortie C sur le
      volet doc : la ligne nomme le test qui épingle le refus).
      - [x] Code — `IMPLEMENTED_TOPOLOGIES` / `RESERVED_TOPOLOGIES` + garde en tête de fabrique
      - [x] Doc — `api.md` et `INDEX.md` (aucune autre couche ne citait `sfu` : ni le `CLAUDE.md`
            du paquet, ni `core.blade.php`, donc **aucun `boost:update` requis**)
      - [x] Tests — 5 cas neufs dans `createPeerContext.test.js`, rouges d'abord ; contre-épreuves
            mesurées garde par garde (3 cas / 1 cas) ; 3 tests requalifiés qui épinglaient les
            états morts comme voulus

## Lot 3 — Noms qui mentent · sortie A

Le motif le plus dense du paquet. Un nom juste supprime son paragraphe d'explication — et, ici,
plusieurs de ces noms ont **déjà coûté des régressions**.

- [ ] **`remoteStreams` exclut les partages d'écran** · effort [M]
      « Consommer `remoteStreams` seul rend tout partage d'écran **invisible** »
      (`createPeerContext.js`). Le nom promet tous les flux distants alors que son jumeau
      `remoteScreens` existe et ne contient que les écrans. Conséquence côté tests : « asserter sur
      `remoteStreams` seul laisse passer toute régression d'écran » — le nom pourrit donc aussi le
      harnais.
      Renommer en `remoteCallStreams`, qui met les deux noms en symétrie
      (`remoteCallStreams` / `remoteScreens`) au lieu de laisser croire à un ensemble et son
      sous-ensemble. API publique du contexte : prévoir un alias de transition.
      Annotation : `docs/modules/webrtc2/api.md` · `docs/modules/webrtc2/tests.md`
      - [ ] Code · - [ ] Doc · - [ ] Tests

- [ ] **`type` vs `connectionType`** · effort [M]
      « C'est le piège n°1 … **il a coûté deux régressions** » : les confondre envoie la réponse
      dans une file que personne n'observe. Deux champs quasi-homonymes dans le même payload, plus
      un repli `connectionType` absent ⇒ `type` pour rétrocompatibilité avec un backend non déployé.
      Sortie A si le repli peut être retiré (le backend est déployé partout ?) ; sinon C, avec un
      test qui épingle le repli et une doc réduite à une ligne.
      Annotation : `docs/INDEX.md` · `docs/architecture/signalisation.md`
      - [ ] Code · - [ ] Doc · - [ ] Tests

- [ ] **`metadata.from` / `fromName` portent *mon* identité sur une connexion sortante** · effort [M]
      « Filtrer sur `metadata.from` **ne matche donc rien** côté initiateur » ; et afficher le nom du
      distant « demanderait un champ `fromUserName` dans les événements de `UserController` ».
      Le nom du champ ment sur son contenu selon le sens de la connexion — c'est-à-dire la moitié du
      temps. Renommer (`localFrom`) ou ajouter le champ manquant côté backend.
      ⚠️ **Cette entrée a gagné un consommateur le 01/09, et c'est ce qui la rend délicate à traiter
      maintenant** : D1 se sert de ce défaut **comme d'un contrat** — `conn.metadata.from === mon
      slug` est le seul discriminant disponible pour savoir si une connexion est sortante, et
      `WhiteboardComponent#handleConnectionOpen` en dépend pour ne pas renvoyer sa scène deux fois
      (D2 en dépendra aussi, cf. lot 1 · D). Un renommage en `localFrom` **casserait ce garde en
      silence** : le champ absent rend `undefined`, jamais égal à mon slug, donc la comparaison
      redevient vraie partout et le double envoi revient sans une erreur. Préalable à cette entrée :
      exposer le sens de la connexion **explicitement** (un champ, ou un argument de callback) et y
      brancher les consommateurs, AVANT de toucher au nom.
      Annotation : `docs/modules/webrtc2/api.md` · `docs/modules/webrtc2/architecture.md`
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
      **ne pas la dupliquer ici**. Les `putInFile` sur `.env`
      de `SocializerInstall.php` sont le principal bénéficiaire.
      Annotation : `docs/architecture/package.md`
      - [ ] Code · - [ ] Doc · - [ ] Tests

- [ ] **`ACCESORS` *(sic)*** · effort [S]
      Faute de frappe figée dans les squelettes de modèles (`Post.php`, `Page.php`,
      `DynAnswerMongo.php`), que `docs/architecture/conventions.md` entérine avec un « *(sic)* »
      au lieu de la corriger. C'est un commentaire de section : aucun risque.
      - [ ] Code · - [ ] Doc · - [ ] Tests — sans objet

- [ ] **Casse de `widgets/` incohérente** · effort [S]
      9 dossiers en minuscule, 2 en majuscule (`Users/Widgets/`, `WebRTC2/Widgets/`) —
      `conventions.md` et `autres-modules.md` le signalent chacun de leur côté.
      Uniformiser ; impacte les imports front.
      - [ ] Code · - [ ] Doc · - [ ] Tests — suite JS verte

- [x] **`Feed.vue` encore en Options API** — migré en `<script setup>`, sur le modèle de
      `Chat/ChatComponent.vue`. Les options ont été vidées **dans** le `setup()` existant, sans le
      défaire : le whisper `leave-feed` reste enregistré AVANT l'appel à `useReverbChannel`, le
      `watch(feedId)` reste SOUS les deux appels, et `resetFeed()` est passé en `onUnmounted`
      (position de dernier qu'il tenait en Options API).
      - [x] Code · - [x] Doc — les trois mentions « Feed.vue en Options API » sont retirées de
      `conventions.md`, `autres-modules.md` et `use-reverb-channel.md`, la règle qu'elles portaient
      étant reformulée sans exemple nommé · - [x] Tests — `components/Feed/__tests__/feedLifecycle.test.js`
      (13 cas) épingle le câblage : ordre de démontage (whisper `leave-feed` → `leave()` → reset),
      join du canal avant le chargement des posts, routage des quatre listeners Reverb vers les
      actions du store, `feed-loaded`, et `feedId` porté par les actions de la liste. Les quatre
      invariants ont été vérifiés par mutation — chacun casse son test et seulement le sien.
      La doublure d'`Echo` est passée en helper partagé
      (`System/composables/__tests__/helpers/createEchoDouble.js`) plutôt que dupliquée, et la
      docstring de `mountOptionsApiLeaver` dans `useReverbChannel.test.js` ne cite plus `Feed.vue`
      (ce test monte un composant synthétique et reste un garde valide pour tout composant non migré).

- [ ] **Le `PublishButton` téléporté d'une room recevait `feedId: null`** · effort [S] — **à
      vérifier à l'écran**
      L'`emit('feed-loaded')` de `Feed.vue` était **commenté** alors que `User/Wall.vue` et
      `WallRoom/WallComponent.vue` branchent tous deux `@feed-loaded` : le `onFeedLoaded` de
      `WallComponent.vue` ne partait jamais, donc son `PublishButton` téléporté dans
      `#room-header-tools` gardait `feedId: null` / `feedFormId: null`. L'emit a été réactivé
      pendant la migration ci-dessus. `Wall.vue` était indemne — son `feedOptions` et son `loaded`
      ne sont lus par rien.
      - [ ] Ouvrir une room, onglet mur, et publier depuis le bouton de l'en-tête.

- [x] **Directives de resize : le suffixe décrit la poignée, pas l'axe** — fait par `989b360`
      (`resizable_height.js` / `resizable_width.js`, épinglé par
      `directives/__tests__/resizableNaming.test.js`).

- [x] **`usersInRoom`** — **fermé le 28/08/2026** : renommé en `connection.remotePeers`, partout
      y compris sur la surface publique. Le récit et les trois écarts avec l'énoncé sont dans
      [webrtc2-todo.md](webrtc2-todo.md) — **ne pas dupliquer ici.**

## Lot 4 — Épingler par un test · sortie C

Ces comportements sont **voulus**. Le paquet a un filet : c'est le seul endroit du chantier où la
sortie C est immédiatement disponible, et elle vide beaucoup de doc.

- [ ] **Le routage des signaux ne pose aucune précondition** · effort [M]
      « C'est un invariant, **pas un oubli**. En ajouter une a déjà fait disparaître des flux » —
      cassé une fois par un `await ctx.waitForMeReady()` et un `if (ctx.isShuttingDown.value)
      return`, de façon intermittente. Le code *ressemble* à une garde manquante : c'est exactement
      ce qu'un relecteur « corrige ».
      Un test nommé `routing_does_not_gate_on_readiness` le protège mieux que trois paragraphes.
      Annotation : `docs/INDEX.md` · `docs/modules/webrtc2/architecture.md`
      - [ ] Code — sans objet · - [ ] Doc — trois paragraphes → une ligne · - [ ] Tests

- [ ] **`setLocalPeer` : async donc toujours truthy, et `undefined` même en succès** · effort [S]
      « Un `if (!ready) return` est **au mieux mort, au pire inversé** ». Deux tests le disent : un
      sur la valeur de retour, un sur le fait qu'aucun appelant ne la lit.
      Annotation : `docs/modules/webrtc2/architecture.md` · `docs/modules/webrtc2/flux.md`
      (le fait est déjà écrit **deux fois** — la sortie C en supprime une)
      - [ ] Code — sans objet · - [ ] Doc · - [ ] Tests

- [ ] **`connectToPeer` : `false` pour différer, `true` pour abandonner** · effort [S]
      Sémantique booléenne inversée par rapport à l'intuition : `true` signifie « pas d'erreur » et
      **annule** le retry — « plus aucune connexion ne se rétablit, silencieusement ».
      Sortie A envisageable (une énumération `RETRY` / `ABORT` au lieu d'un booléen) — à arbitrer.
      Annotation : `docs/modules/webrtc2/architecture.md` · `securite.md`
      - [ ] Code · - [ ] Doc · - [ ] Tests

- [ ] **`hasOpenConnection` ≠ `isConnectionEstablished`** · effort [M]
      « Les confondre a coûté une **panne définitive** » : un `peer.call()` jamais répondu laisse le
      `RTCPeerConnection` en `connecting` à vie — WebRTC ne bascule pas en `failed`, et PeerJS ne
      notifie pas le `close()` d'un appel non répondu. Résultat : écran noir chez le récepteur,
      **aucune erreur nulle part**.
      Le défaut est dans la lib tierce (sortie D pour la cause), mais les deux prédicats sont à nous :
      un test par prédicat, plus des noms plus contrastés, remplacent la section entière.
      Annotation : `docs/modules/webrtc2/architecture.md`
      - [ ] Code — renommer · - [ ] Doc · - [ ] Tests

- [ ] **`setTimeout(1000)` de `useStickyScroll`** · effort [S]
      Compense le chargement asynchrone des images ; « les simplifier réintroduit des sauts de
      scroll ». Cas d'école du « piège à ne PAS optimiser » — et cas d'école de sortie C.
      Annotation : `docs/modules/chat.md`
      - [ ] Code — sans objet · - [ ] Doc · - [ ] Tests

- [ ] **Les getters Pinia sont auto-déballés** · effort [S]
      « Un mock qui enveloppe un getter dans un `computed()` casse **silencieusement** » →
      `hasOpenConnection` renverrait **toujours `false`**, faux négatif muet. Le harnais a déjà
      produit cette panne.
      Sortie C au niveau du **harnais** : un test de conformité du mock (le paquet en a déjà un,
      `mockFidelity.test.js` — l'étendre plutôt que documenter).
      Annotation : `docs/architecture/conventions.md` · `docs/modules/webrtc2/tests.md`
      - [ ] Code — étendre `mockFidelity.test.js` · - [ ] Doc · - [ ] Tests

- [ ] **Les 9 « pièges de mock »** · effort [M]
      `docs/modules/webrtc2/tests.md` énumère neuf façons dont le harnais peut verdir pour
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
      Annotation : `docs/architecture/tests.md`
      - [ ] Code · - [ ] Doc · - [ ] Tests

## Lot 5 — À arbitrer, et assumés · sortie D

Trois entrées fermées en sortie D par la clôture du chantier sécurité : la faille résiduelle du
chemin (a) et l'usurpation intra-room sont des **bornes assumées** inscrites dans
[« Bornes non fermées »](../docs/modules/webrtc2/securite.md#bornes-non-fermées-connues) ; les
écritures muettes du graphe sont devenues les trois régimes de la couture, avec leurs deux
arbitrages datés.

- [ ] **`updateScene` applique une charge vide sans le dire** · effort [S] — **relevé le 01/09/2026**
      en corrigeant le renvoi de scène du Whiteboard. `loadWhiteBoard` rend `$page->content ?? null`
      quand aucun document n'existe ; côté client, `updateScene` finit par appeler
      `excalidrawAPI.updateScene({ elements: undefined })` — **no-op muet**. « Tableau vide » et
      « chargement raté » sont donc indistinguables à l'écran.
      ℹ️ **Reproduit, pas supposé** : en écrivant
      `Whiteboard/__tests__/WhiteboardComponent.connectionOpen.test.js`, un mock résolvant `null` a
      fait lever `data.hasOwnProperty` — le mock a donc dû résoudre une scène valide, et le fichier
      le dit.

- [ ] **`loadScene()` n'a aucun `.catch`, et il est appelé avant l'existence de son `$refs`** ·
      effort [S] — **relevé le 01/09/2026.** Tout échec HTTP y est un **rejet non traité**, sans
      trace. Et l'appel est dans `created()`, donc avant que `$refs.excalidrawElement` existe : il ne
      tient que par la latence réseau.

- [ ] **La fenêtre où `excalidrawAPI` n'est pas prêt à l'arrivée d'une scène** · effort [M] —
      **relevé le 01/09/2026.** `updateScene` abandonne sur un `console.error`, sans réessai — même
      classe de défaut que celui qui vient d'être corrigé. Mesuré **peu probable** (le renvoi arrive
      ~1 s après une connexion elle-même établie 1-3 s après le montage), et **c'est pour ça que le
      délai d'une seconde du renvoi doit rester** : il protège le **récepteur**, pas l'émetteur — ne
      pas l'« optimiser ». Sortie possible : signal `excalidraw-ready` + application différée de la
      dernière scène.

- [ ] **`getPayloadSizeBytes` accepte ce que BinaryPack refuse** · effort [M] — **ouvert le
      01/09/2026 par la vérification de D1**, qui l'a payé : voir le 🔴 du lot D1.
      Le garde anti-DoS mesure via `JSON.stringify`, qui accepte une `Map` (elle rend `{}`). Elle
      atteint donc `conn.send`, où **BinaryPack LÈVE** — de façon synchrone, dans le `forEach` de
      diffusion : les pairs suivants ne reçoivent rien et l'exception remonte à l'appelant. Le garde
      rejette bien une **fonction nue**, ce qui donne l'illusion d'être couvert.
      **Détectable à coût nul** : le `JSON.stringify` du garde est déjà fait, un `replacer` qui
      refuse `Map`/`Set`/instance de classe suffirait à transformer un throw en refus journalisé —
      exactement le traitement déjà réservé au dépassement de taille. Et **testable**, contrairement
      au bug lui-même : `usePeerTransport.mesh.test.js` porte déjà le cas « laisse passer une `Map` »,
      qui rougira le jour où le garde sera posé.
      ⚠️ **Alternative écartée, à ne pas re-proposer sans lire ceci** : `serialization: 'json'` sur la
      connexion data reproduirait la v1 pour tous les consommateurs — et **aucun n'envoie de binaire
      en production**, vérifié. Mais c'est une propriété de **transport**, avec une falaise de
      compatibilité entre deux onglets sur des bundles différents (le paquet a déjà ce risque
      documenté), et elle périmerait le cas `ArrayBuffer` épinglé.
      Annotation : `docs/modules/webrtc2/api.md` (la section « `sendData` peut LEVER ») ·
      `docs/modules/webrtc2/tests.md` (le piège de mock) · `docs/modules/webrtc2/securite.md` (même
      mécanique que le garde de taille)
      - [ ] Code · - [ ] Doc · - [ ] Tests

- [ ] **Le Whiteboard ne se synchronise que sur un relâchement de pointeur** · effort [M] —
      **relevé le 01/09/2026 en instruisant le cas de l'image collée.**
      `ExcalidrawElement` n'émet que **deux** événements : `excalidraw-mouseup` (sur `pointerup`) et
      `excalidraw-pointer` (sur `pointermove`). Le `onChange` qui émettrait `excalidraw-change` est
      **commenté dans le JSX** (l.36-38), et son écoute est commentée dans le composant Vue
      (`mounted` / `beforeUnmount` / la méthode `handleExcalidrawChange`).
      **Conséquence : tout ce qui ne finit pas par un relâchement de pointeur sur le canvas ne
      propage rien** — un collage (`Ctrl+V`), un `Ctrl+Z`, la touche Suppr, une insertion depuis la
      bibliothèque. L'auteur voit sa modification, les autres non, **jusqu'au prochain clic** — et
      sans un mot en console des deux côtés, puisque rien n'est même tenté. C'est ce qui a fait
      croire, un moment, que l'image butait sur les 64 Ko.
      ⚠️ **Antérieur à la migration** : la v1 avait les deux mêmes événements et le même `onChange`
      commenté. Ce n'est pas une régression de D1.
      ⚠️ **Et ce n'est pas une ligne à décommenter** : `onChange` tire à **chaque** modification, y
      compris pendant un tracé — brancher tel quel inonderait le canal de scènes complètes, chacune
      pouvant approcher le plafond. Un débounce ne suffit pas à le rendre raisonnable : c'est la même
      tâche que la synchronisation par **delta**, ci-dessus. Les traiter ensemble ou pas du tout.
      Annotation : aucune — le fait n'est écrit nulle part, et c'est le défaut
      - [ ] Code · - [ ] Doc · - [ ] Tests

- [ ] **`ExcalidrawElement.updateScene` lit `data.state`, que personne n'émet** · effort [S] —
      **relevé le 01/09/2026 en corrigeant D1.**
      `this.excalidrawAPI.updateScene({ elements: data.elements, appState: data.state, files: data.files })`
      — or l'émetteur envoie `{ elements, appState, files }`, et le serveur stocke la même forme.
      `data.state` vaut donc **toujours `undefined`** : l'`appState` transmis et **stocké** est mort
      depuis toujours, en v1 comme en v2. C'est ce fait qui a rendu le correctif de D1 gratuit.
      ⚠️ **Ce n'est PAS une faute de frappe à réparer.** Lire `data.appState` allumerait la
      réplication de l'appState : le scroll, le zoom et la sélection de l'émetteur seraient copiés
      chez le récepteur à chaque `mouseup` — et la `Map` `collaborators` reviendrait sur le fil.
      **Décision produit d'abord** : veut-on répliquer une vue, ou seulement un dessin ? Si non, le
      correctif est l'inverse — retirer `appState` de ce qui est **stocké** aussi, et la ligne
      devient `appState: undefined` explicite ou disparaît.
      Annotation : aucune aujourd'hui — le fait n'est écrit que dans `work/`, et c'est correct tant
      que la décision n'est pas prise
      - [ ] Code · - [ ] Doc · - [ ] Tests

- [ ] **La scène du Whiteboard n'a aucune découpe et le plafond de 64 Ko l'abandonne en silence** ·
      effort [M] — **ouvert le 01/09/2026 par D1**, et **assumé en l'état à cette date**.
      `update_scene` transporte `getSceneElements()` + `getFiles()` : le plus gros payload du paquet,
      et **le seul dont la taille est pilotée par l'utilisateur**. *(L'`appState` en faisait partie
      jusqu'au correctif de D1, qui l'a retiré — le terme dominant est désormais `files`.)* Une image
      collée dans le tableau, encodée en base64 dans `files`, franchit `MAX_PAYLOAD_BYTES` (64 Ko) — et
      l'émission est alors **entièrement annulée**, avec pour seule trace un `console.warn` chez
      l'émetteur. Symptôme produit : « le tableau ne se synchronise plus », sans erreur.
      ⚠️ **C'est une régression de la migration v1 → v2, pas une limite historique** : le `sendData`
      du store v1 n'avait aucun plafond (`safeStringify` puis `conn.send`, PeerJS chunkant lui-même).
      ✅ **MESURÉ le 01/09/2026, à deux navigateurs** — le chiffre que cette tâche réclamait :
      **`[Mesh] Payload ignoré: trop volumineux (294409 octets > 65536)`** pour une scène portant
      **une seule image collée**. Soit **4,5× le plafond**. Quelques tracés seuls passent sans
      problème ; c'est bien `files` (le dataURL base64) qui domine, et lui seul.
      **Ce que la mesure élimine :** passer le base64 en binaire ne gagnerait que ~27 % (≈ 215 Ko,
      toujours 3× trop), et un plafond relevé « un peu » ne résout rien — il faudrait des **Mo**.
      **Les sorties qui restent, et aucune n'est petite :**
      · **relever `MAX_PAYLOAD_BYTES` à l'échelle des images** — ⚠️ c'est la surface anti-DoS de
      [`securite.md`](../docs/modules/webrtc2/securite.md), appliquée aux **deux** bouts : accepter
      5 Mo en émission, c'est accepter que n'importe quel pair m'en pousse 5 Mo par trame ;
      · **sortir les images du canal data** — elles sont déjà persistées côté serveur sur un tableau
      `isSavable` (`saveWhiteBoard`) : n'émettre que les `elements` et laisser le récepteur chercher
      le fichier. ⚠️ Ne couvre **pas** les tableaux non savables, qui n'ont aucune copie serveur ;
      · **découper en frames applicatives**, ou **synchroniser par delta** — la seule qui fasse aussi
      baisser le débit de `update_scene` en régime nominal, et la seule qui traite le fond.
      Annotation : `docs/modules/webrtc2/api.md` (sous `api.sendData`, le ⚠️ qui nomme la scène
      Excalidraw) · `WhiteboardComponent.vue` (docblock de `handleExcalidrawMouseUp`) ·
      `work/webrtc-data-v1-v2.md` (écart 5, qui part avec la v1)
      - [ ] Code · - [ ] Doc · - [ ] Tests

- [ ] **`destroy()` de PeerJS émet `disconnected` avant de poser `_destroyed`** — bug de dépendance
      tierce, vérifié dans `peerjs@1.5.4` (l.1810 avant l.1781). Trois gardes empilées le
      compensent. Sortie D : décision datée, plus un test de conformité du mock (déjà partiellement
      là). Un rapport amont serait la seule sortie A.
      Annotation : `docs/modules/webrtc2/architecture.md`

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
      Annotation : `CLAUDE.md` · `docs/architecture/conventions.md` ·
      `resources/boost/guidelines/core.blade.php`

- [ ] **Front en français en dur** (6 `$t()` dans tout le paquet), et
      `src/resources/lang/fr/network.php` mélangeant libellés d'UI **et slugs de routes traduits**.
      « Un chantier à part entière » — donc une décision datée, pas un avertissement récurrent dans
      trois fichiers.
      Annotation : `CLAUDE.md` · `docs/architecture/conventions.md` ·
      `resources/boost/guidelines/core.blade.php`

- [ ] **Pas de `package.json` dans le paquet** (tout l'outillage front vit chez l'hôte) — répété
      dans 4 fichiers. Structurel et voulu : une décision écrite une fois, et un pointeur depuis les
      trois autres.
      Annotation : `CLAUDE.md` · `docs/INDEX.md` · `docs/architecture/tests.md` ·
      `resources/boost/guidelines/core.blade.php`

- [ ] **Dépendances implicites non déclarées** (`Dauvray\Estarter\*`, Backpack, mongodb,
      formdesigner) — « pas dans le `composer.json` mais requises », parce que les déclarer mettrait
      une URL interne dans le manifeste d'un paquet publié sur GitHub public. Contrainte réelle :
      décision datée, avec la liste maintenue à un seul endroit.
      Annotation : `docs/architecture/package.md` · `docs/architecture/tests.md`

- [ ] **`FakeNebulaGraph` fait du `str_contains`, il ne parse pas le nGQL** — « une requête
      syntaxiquement invalide passe au vert ». Doublure qui ment par construction ; la remplacer est
      un chantier. Décision datée, et le dire **dans le harnais** (un commentaire à l'endroit du
      `str_contains`) plutôt que dans deux fichiers de doc.
      Annotation : `docs/architecture/tests.md` · `docs/modules/webrtc2/securite.md`

- [x] **Trous de couverture** — **fermé en clôturant le plan de tests WebRTC2.** La citation
      (« **Rien** pour Feed, Comment, Server, User, System… ») était devenue **fausse sur quatre
      modules** : Feed, Server, User et System ont un filet. C'était exactement le mode de panne
      annoncé — une liste d'absences se périme sans virer au rouge.
      `docs/architecture/tests.md` dit désormais **où il y a un filet, pas combien**, avec la
      commande qui recense les fichiers ; ce qui reste réellement à découvert y tient en une ligne.
